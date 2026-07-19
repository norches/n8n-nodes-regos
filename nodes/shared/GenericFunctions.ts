import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import type { RegosCredentials, RegosEnvelope, RegosErrorResult } from './types';

type RegosContext = IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions | IHookFunctions;

const RATE_LIMIT_ERROR_CODE = 8213;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 10_000;

// Client-side pacing: REGOS refills 2 requests/second per integration, burst up to 50.
// We stay slightly under the burst cap; the 8213 retry below is the backstop
// (the bucket is per-process, so clustered n8n instances each get their own).
const BUCKET_REFILL_PER_SECOND = 2;
const BUCKET_CAPACITY = 45;

interface TokenBucket {
	tokens: number;
	lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

async function takeToken(key: string): Promise<void> {
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { tokens: BUCKET_CAPACITY, lastRefill: Date.now() };
		buckets.set(key, bucket);
	}

	for (;;) {
		const now = Date.now();
		const refill = ((now - bucket.lastRefill) / 1000) * BUCKET_REFILL_PER_SECOND;
		bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + refill);
		bucket.lastRefill = now;

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return;
		}

		const waitMs = Math.ceil(((1 - bucket.tokens) / BUCKET_REFILL_PER_SECOND) * 1000);
		await sleep(waitMs);
	}
}

function backoffDelay(attempt: number): number {
	const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
	return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function isRetryableHttpError(error: unknown): boolean {
	const status = (error as { httpCode?: string; statusCode?: number }).httpCode
		? Number((error as { httpCode: string }).httpCode)
		: (error as { statusCode?: number }).statusCode;
	if (status === 429 || (status !== undefined && status >= 500)) return true;

	const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
	return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

/**
 * Perform one REGOS API call. `path` must be the literal swagger path (casing preserved,
 * e.g. "Item/Get", "pos/DocCheque/Create", "batch") — never normalize it.
 *
 * Application errors arrive as HTTP 200 + { ok: false, result: { error, description } };
 * they are thrown as NodeApiError. Rate-limit code 8213 and transient HTTP/network
 * failures are retried with jittered exponential backoff.
 *
 * Returns the full envelope so callers can use next_offset/total for pagination.
 */
export async function regosApiRequest(
	this: RegosContext,
	path: string,
	body: JsonObject = {},
): Promise<RegosEnvelope> {
	const credentials = (await this.getCredentials('regosApi')) as unknown as RegosCredentials;
	const baseUrl = credentials.baseUrl.replace(/\/+$/, '');
	const url = `${baseUrl}/${credentials.integrationKey}/v1/${path}`;

	const options: IHttpRequestOptions = {
		method: 'POST',
		url,
		headers: { 'Content-Type': 'application/json;charset=utf-8' },
		body,
		json: true,
	};

	// Debug context attached to every failure: the literal endpoint and the body actually
	// sent, plus the raw REGOS response. The integration key lives only in the URL, which is
	// intentionally NOT included here.
	const request = { method: 'POST', path, body };

	const fail = (cause: Record<string, unknown>, message: string, description: string): never => {
		const error = new NodeApiError(this.getNode(), { request, ...cause } as unknown as JsonObject, {
			message,
			description,
		});
		error.context.request = request;
		if (cause.response !== undefined) error.context.response = cause.response;
		throw error;
	};

	let lastError: unknown;

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (attempt > 0) await sleep(backoffDelay(attempt - 1));
		await takeToken(credentials.integrationKey);

		let response: RegosEnvelope;
		try {
			// REGOS auth is the integration key embedded in the URL path — there is nothing an
			// `authenticate` block could inject, so httpRequestWithAuthentication is not applicable.
			// Recorded in ADR-0004.
			// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
			response = (await this.helpers.httpRequest(options)) as RegosEnvelope;
		} catch (error) {
			lastError = error;
			if (isRetryableHttpError(error)) continue;
			const httpError = error as { message?: string; httpCode?: string; statusCode?: number };
			return fail(
				{ error: httpError.message ?? String(error), status: httpError.httpCode ?? httpError.statusCode ?? null },
				`REGOS request failed: ${httpError.message ?? 'unknown HTTP error'}`,
				`POST ${path} — the request did not reach the REGOS application layer (infrastructure/network error).`,
			);
		}

		if (response?.ok === true) return response;

		const errorResult = (response?.result ?? {}) as Partial<RegosErrorResult>;
		if (errorResult.error === RATE_LIMIT_ERROR_CODE) {
			lastError = errorResult;
			continue;
		}

		return fail(
			{ response },
			`REGOS error ${errorResult.error ?? 'unknown'}: ${errorResult.description ?? 'no description'}`,
			`POST ${path} — REGOS returns application errors with HTTP 200. Error catalog: https://docs.regos.uz/ru/api/intro/errors`,
		);
	}

	const lastErrorPayload =
		typeof lastError === 'object' && lastError !== null ? lastError : { error: String(lastError) };
	return fail(
		{ lastError: lastErrorPayload },
		`REGOS request to ${path} failed after ${MAX_ATTEMPTS} attempts (rate limit or transient errors)`,
		`POST ${path} — every attempt was rejected with rate-limit code 8213 or a transient network/HTTP error.`,
	);
}

/**
 * Fetch all pages of an offsetted-array endpoint by following next_offset.
 * `maxItems` caps the total (0 = unlimited).
 */
export async function regosApiRequestAllItems(
	this: RegosContext,
	path: string,
	body: JsonObject = {},
	maxItems = 0,
): Promise<unknown[]> {
	const items: unknown[] = [];
	let offset = typeof body.offset === 'number' ? body.offset : 0;

	for (;;) {
		const pageBody: JsonObject = { ...body, offset };
		if (maxItems > 0) pageBody.limit = Math.min(500, maxItems - items.length);

		const envelope = await regosApiRequest.call(this, path, pageBody);
		const page = Array.isArray(envelope.result) ? envelope.result : [];
		items.push(...page);

		if (maxItems > 0 && items.length >= maxItems) return items.slice(0, maxItems);
		if (page.length === 0) return items;

		const nextOffset = envelope.next_offset;
		// next_offset of 0/undefined or a non-advancing offset means the feed is exhausted.
		if (typeof nextOffset !== 'number' || nextOffset <= offset) return items;
		offset = nextOffset;
	}
}

/**
 * Normalize any caught error to an n8n node error: NodeApiError/NodeOperationError pass
 * through unchanged, everything else is wrapped in NodeOperationError.
 */
export function toNodeError(
	context: RegosContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(context.getNode(), error as Error, { itemIndex });
}

/** Convert an n8n dateTime parameter value to REGOS wire format: Unix epoch seconds. */
export function toEpochSeconds(context: RegosContext, value: unknown): number {
	if (typeof value === 'number') {
		// Values that look like epoch milliseconds get converted down to seconds.
		return value > 100_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
	}
	if (value instanceof Date) return Math.floor(value.getTime() / 1000);
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
	}
	throw new NodeOperationError(context.getNode(), `Cannot convert value to a date: ${String(value)}`);
}

/** Parse a comma-separated list of numeric IDs ("1, 2,3") into numbers. */
export function parseIdList(context: RegosContext, value: unknown): number[] {
	if (Array.isArray(value)) return value.map((v) => Number(v));
	if (typeof value === 'number') return [value];
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part !== '')
			.map((part) => {
				const n = Number(part);
				if (Number.isNaN(n)) {
					throw new NodeOperationError(context.getNode(), `Invalid ID in list: "${part}"`);
				}
				return n;
			});
	}
	return [];
}

/** Parse a comma-separated list of strings into an array of trimmed strings. */
export function parseStringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part !== '');
	}
	return [];
}

/** Parse a JSON string parameter, with a clear error on invalid input. */
export function parseJsonParameter(context: RegosContext, value: unknown, parameterName: string): unknown {
	if (typeof value !== 'string') return value;
	if (value.trim() === '') return undefined;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(context.getNode(), `Parameter "${parameterName}" is not valid JSON`);
	}
}
