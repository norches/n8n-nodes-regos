import { describe, expect, it, vi } from 'vitest';

import {
	parseIdList,
	parseJsonParameter,
	parseStringList,
	regosApiRequest,
	regosApiRequestAllItems,
	toEpochSeconds,
} from '../nodes/shared/GenericFunctions';

const node = { name: 'Regos', type: 'n8n-nodes-regos.regos', typeVersion: 1, position: [0, 0], parameters: {} };

function mockContext(responses: Array<unknown | Error>) {
	const calls: Array<{ url: string; body: unknown }> = [];
	let index = 0;
	return {
		calls,
		getNode: () => node,
		getCredentials: vi.fn(async () => ({
			integrationKey: 'test-key',
			baseUrl: 'https://integration.regos.uz/gateway/out',
		})),
		helpers: {
			httpRequest: vi.fn(async (options: { url: string; body: unknown }) => {
				calls.push({ url: options.url, body: options.body });
				const response = responses[Math.min(index, responses.length - 1)];
				index += 1;
				if (response instanceof Error) throw response;
				return response;
			}),
		},
	};
}

describe('regosApiRequest', () => {
	it('builds the gateway URL with the literal path and returns the envelope', async () => {
		const ctx = mockContext([{ ok: true, result: [{ id: 1 }] }]);
		const envelope = await regosApiRequest.call(ctx as never, 'pos/ChequeItemOperation/get', { a: 1 });
		expect(ctx.calls[0].url).toBe(
			'https://integration.regos.uz/gateway/out/test-key/v1/pos/ChequeItemOperation/get',
		);
		expect(envelope.ok).toBe(true);
	});

	it('throws NodeApiError with the REGOS code on ok:false', async () => {
		const ctx = mockContext([{ ok: false, result: { error: 1044, description: 'not found' } }]);
		await expect(regosApiRequest.call(ctx as never, 'Item/Get', {})).rejects.toThrow(
			/REGOS error 1044: not found/,
		);
	});

	it('attaches request and response debug context to application errors', async () => {
		const ctx = mockContext([{ ok: false, result: { error: 1008, description: 'bad params' } }]);
		try {
			await regosApiRequest.call(ctx as never, 'Item/Add', { name: 'Cola' });
			expect.unreachable('should have thrown');
		} catch (error) {
			const apiError = error as {
				description?: string;
				context: { request?: { method: string; path: string; body: unknown }; response?: { result: { error: number } } };
			};
			expect(apiError.description).toContain('POST Item/Add');
			expect(apiError.context.request).toEqual({ method: 'POST', path: 'Item/Add', body: { name: 'Cola' } });
			expect(apiError.context.response?.result.error).toBe(1008);
		}
	});

	it('retries on rate-limit code 8213 and succeeds', async () => {
		const ctx = mockContext([
			{ ok: false, result: { error: 8213, description: 'rate limited' } },
			{ ok: true, result: { fine: true } },
		]);
		const envelope = await regosApiRequest.call(ctx as never, 'Item/Get', {});
		expect(envelope.ok).toBe(true);
		expect(ctx.helpers.httpRequest).toHaveBeenCalledTimes(2);
	}, 15_000);

	it('gives up after bounded attempts on persistent 8213', async () => {
		const ctx = mockContext([{ ok: false, result: { error: 8213, description: 'rate limited' } }]);
		await expect(regosApiRequest.call(ctx as never, 'Item/Get', {})).rejects.toThrow(/after 5 attempts/);
		expect(ctx.helpers.httpRequest).toHaveBeenCalledTimes(5);
	}, 60_000);
});

describe('regosApiRequestAllItems', () => {
	it('follows next_offset and stops when it no longer advances', async () => {
		const ctx = mockContext([
			{ ok: true, result: [{ id: 1 }, { id: 2 }], next_offset: 2, total: 3 },
			{ ok: true, result: [{ id: 3 }], next_offset: 2, total: 3 },
		]);
		const items = await regosApiRequestAllItems.call(ctx as never, 'Item/Get', {});
		expect(items).toHaveLength(3);
		expect(ctx.helpers.httpRequest).toHaveBeenCalledTimes(2);
	});

	it('stops on an empty page', async () => {
		const ctx = mockContext([{ ok: true, result: [], next_offset: 0, total: 0 }]);
		const items = await regosApiRequestAllItems.call(ctx as never, 'Item/Get', {});
		expect(items).toHaveLength(0);
	});

	it('caps at maxItems', async () => {
		const ctx = mockContext([
			{ ok: true, result: [{ id: 1 }, { id: 2 }], next_offset: 2, total: 100 },
			{ ok: true, result: [{ id: 3 }, { id: 4 }], next_offset: 4, total: 100 },
		]);
		const items = await regosApiRequestAllItems.call(ctx as never, 'Item/Get', {}, 3);
		expect(items).toHaveLength(3);
	});
});

describe('value helpers', () => {
	const ctx = { getNode: () => node } as never;

	it('converts dates to epoch seconds', () => {
		expect(toEpochSeconds(ctx, '2026-06-26T10:00:00Z')).toBe(1782468000);
		expect(toEpochSeconds(ctx, 1782468000)).toBe(1782468000);
		expect(toEpochSeconds(ctx, 1782468000000)).toBe(1782468000);
	});

	it('parses ID lists', () => {
		expect(parseIdList(ctx, '1, 2,3')).toEqual([1, 2, 3]);
		expect(() => parseIdList(ctx, '1,x')).toThrow(/Invalid ID/);
	});

	it('parses string lists and JSON parameters', () => {
		expect(parseStringList('a, b,c')).toEqual(['a', 'b', 'c']);
		expect(parseJsonParameter(ctx, '{"a":1}', 'payload')).toEqual({ a: 1 });
		expect(() => parseJsonParameter(ctx, '{oops', 'payload')).toThrow(/not valid JSON/);
	});
});
