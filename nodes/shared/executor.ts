import type { IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	parseIdList,
	parseJsonParameter,
	parseStringList,
	regosApiRequest,
	regosApiRequestAllItems,
	toEpochSeconds,
	toNodeError,
} from './GenericFunctions';
import type { FieldMeta, NodeOperationsMeta, OperationMeta } from './types';

function serializeField(
	context: IExecuteFunctions,
	field: FieldMeta,
	rawValue: unknown,
): unknown {
	if (rawValue === undefined || rawValue === null) return undefined;

	switch (field.kind) {
		case 'string':
		case 'options':
			return rawValue === '' ? undefined : rawValue;
		case 'number':
			return rawValue === '' ? undefined : Number(rawValue);
		case 'boolean':
			return Boolean(rawValue);
		case 'triBoolean':
			if (rawValue === '' || rawValue === 'default') return undefined;
			return rawValue === 'true' || rawValue === true;
		case 'dateTime':
			return rawValue === '' ? undefined : toEpochSeconds(context, rawValue);
		case 'idList': {
			const ids = parseIdList(context, rawValue);
			return ids.length === 0 ? undefined : ids;
		}
		case 'stringList': {
			const values = parseStringList(rawValue);
			return values.length === 0 ? undefined : values;
		}
		case 'filters': {
			const collection = rawValue as { filter?: Array<{ field: string; operator: string; value: string }> };
			const filters = collection.filter ?? [];
			if (filters.length === 0) return undefined;
			// REGOS Filter schema uses capitalized keys: { Field, Operator, Value }.
			return filters.map((f) => ({ Field: f.field, Operator: f.operator, Value: f.value }));
		}
		case 'json':
			return parseJsonParameter(context, rawValue, field.param);
		default:
			return rawValue;
	}
}

function buildRequestBody(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: OperationMeta,
): JsonObject {
	const body: JsonObject = {};

	const additionalFields = context.getNodeParameter('additionalFields', itemIndex, {}) as JsonObject;

	for (const field of operation.fields) {
		const rawValue = field.required
			? context.getNodeParameter(field.param, itemIndex)
			: additionalFields[field.param];

		const serialized = serializeField(context, field, rawValue);
		if (serialized !== undefined) body[field.api] = serialized as JsonObject[keyof JsonObject];
	}

	return body;
}

function envelopeToItems(result: unknown, envelope: OperationMeta['envelope']): JsonObject[] {
	if (envelope === 'offsettedArray' || envelope === 'array') {
		const rows = Array.isArray(result) ? result : [result];
		return rows.map((row) => (typeof row === 'object' && row !== null ? (row as JsonObject) : { value: row }));
	}
	if (result === null || result === undefined) return [{}];
	if (Array.isArray(result)) {
		return result.map((row) => (typeof row === 'object' && row !== null ? (row as JsonObject) : { value: row }));
	}
	if (typeof result === 'object') return [result as JsonObject];
	return [{ value: result } as unknown as JsonObject];
}

async function executeBatch(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<JsonObject[]> {
	const inputMode = context.getNodeParameter('inputMode', itemIndex) as string;
	let requestBody: JsonObject;

	if (inputMode === 'json') {
		const raw = context.getNodeParameter('requestJson', itemIndex) as string;
		requestBody = parseJsonParameter(context, raw, 'requestJson') as JsonObject;
	} else {
		const stopOnError = context.getNodeParameter('stopOnError', itemIndex, false) as boolean;
		const stepsCollection = context.getNodeParameter('steps', itemIndex, {}) as {
			step?: Array<{ key: string; path: string; payload: string }>;
		};
		const steps = stepsCollection.step ?? [];
		if (steps.length === 0) {
			throw new NodeOperationError(context.getNode(), 'Add at least one batch step', { itemIndex });
		}
		if (steps.length > 50) {
			throw new NodeOperationError(context.getNode(), 'REGOS batch supports at most 50 steps', { itemIndex });
		}
		requestBody = {
			stop_on_error: stopOnError,
			requests: steps.map((step) => ({
				// REGOS BatchStep uses a capitalized "Key" alongside lowercase "path"/"payload".
				Key: step.key,
				path: step.path,
				payload: parseJsonParameter(context, step.payload, 'payload') ?? {},
			})),
		} as unknown as JsonObject;
	}

	const envelope = await regosApiRequest.call(context, 'batch', requestBody);
	const result = envelope.result as { responses?: JsonObject[] } | JsonObject[];

	// One output item per step response; step failures are data, not thrown errors.
	const responses = Array.isArray(result) ? result : (result?.responses ?? []);
	return responses.map((response) => response);
}

/**
 * Generic executor shared by all REGOS action nodes. All behavior is driven by
 * the generated operations metadata; "batch" is the single hand-written special case.
 */
export async function executeRegosNode(
	context: IExecuteFunctions,
	meta: NodeOperationsMeta,
): Promise<INodeExecutionData[][]> {
	const items = context.getInputData();
	const returnData: INodeExecutionData[] = [];

	const resource = context.getNodeParameter('resource', 0) as string;
	const operationName = context.getNodeParameter('operation', 0) as string;

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			let outputs: JsonObject[];

			if (resource === 'batch') {
				outputs = await executeBatch(context, itemIndex);
			} else {
				const operation = meta[resource]?.[operationName];
				if (!operation) {
					throw new NodeOperationError(
						context.getNode(),
						`Unknown operation "${operationName}" for resource "${resource}"`,
						{ itemIndex },
					);
				}

				const body = buildRequestBody(context, itemIndex, operation);

				if (operation.paginated) {
					const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
					if (returnAll) {
						const all = await regosApiRequestAllItems.call(context, operation.path, body);
						outputs = envelopeToItems(all, 'array');
					} else {
						const limit = context.getNodeParameter('limit', itemIndex, 50) as number;
						body.limit = limit;
						const envelope = await regosApiRequest.call(context, operation.path, body);
						outputs = envelopeToItems(envelope.result, operation.envelope);
					}
				} else {
					const envelope = await regosApiRequest.call(context, operation.path, body);
					outputs = envelopeToItems(envelope.result, operation.envelope);
				}
			}

			for (const output of outputs) {
				returnData.push({ json: output, pairedItem: { item: itemIndex } });
			}
		} catch (error) {
			if (context.continueOnFail()) {
				const errorPayload = error as { message?: string; context?: { data?: unknown } };
				returnData.push({
					json: { error: errorPayload.message ?? String(error) },
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			throw toNodeError(context, error, itemIndex);
		}
	}

	return [returnData];
}
