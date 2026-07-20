import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../nodes/shared/GenericFunctions', async (importOriginal) => {
	const original = await importOriginal<typeof import('../nodes/shared/GenericFunctions')>();
	return {
		...original,
		regosApiRequest: vi.fn(),
		regosApiRequestAllItems: vi.fn(),
	};
});

import { regosApiRequest, regosApiRequestAllItems } from '../nodes/shared/GenericFunctions';
import { executeRegosNode } from '../nodes/shared/executor';
import type { NodeOperationsMeta } from '../nodes/shared/types';

const node = { name: 'Regos', type: 'n8n-nodes-regos.regos', typeVersion: 1, position: [0, 0], parameters: {} };

const metaWithRequired: NodeOperationsMeta = {
	account: {
		delete: {
			path: 'Account/Delete',
			envelope: 'object',
			paginated: false,
			fields: [{ api: 'id', param: 'id', kind: 'number', required: true }],
		},
	},
};

const meta: NodeOperationsMeta = {
	item: {
		get: {
			path: 'Item/Get',
			envelope: 'offsettedArray',
			paginated: true,
			fields: [
				{ api: 'ids', param: 'ids', kind: 'idList', required: false },
				{ api: 'deleted_mark', param: 'deleted_mark', kind: 'triBoolean', required: false },
				{ api: 'start_date', param: 'start_date', kind: 'dateTime', required: false },
				{ api: 'filters', param: 'filters', kind: 'filters', required: false },
			],
		},
	},
};

function mockExecuteContext(parameters: Record<string, unknown>) {
	return {
		getNode: () => node,
		getInputData: () => [{ json: {} }],
		continueOnFail: () => false,
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
	};
}

describe('executeRegosNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('serializes fields into the REGOS body and emits one item per result row', async () => {
		vi.mocked(regosApiRequest).mockResolvedValueOnce({
			ok: true,
			result: [{ id: 1 }, { id: 2 }],
			next_offset: 0,
			total: 2,
		});

		const ctx = mockExecuteContext({
			resource: 'item',
			operation: 'get',
			returnAll: false,
			limit: 25,
			additionalFields: {
				ids: '1, 2',
				deleted_mark: 'false',
				start_date: '2026-06-26T10:00:00Z',
				filters: { filter: [{ field: 'name', operator: 'Like', value: 'Cola' }] },
			},
		});

		const output = await executeRegosNode(ctx as never, meta);

		expect(vi.mocked(regosApiRequest).mock.calls[0][0]).toBe('Item/Get');
		const body = vi.mocked(regosApiRequest).mock.calls[0][1] as Record<string, unknown>;
		expect(body.ids).toEqual([1, 2]);
		expect(body.deleted_mark).toBe(false);
		expect(body.start_date).toBe(1782468000);
		expect(body.filters).toEqual([{ Field: 'name', Operator: 'Like', Value: 'Cola' }]);
		expect(body.limit).toBe(25);

		expect(output[0]).toHaveLength(2);
		expect(output[0][0].json).toEqual({ id: 1 });
		expect(output[0][0].pairedItem).toEqual({ item: 0 });
	});

	it('uses the paginated helper when Return All is enabled', async () => {
		vi.mocked(regosApiRequestAllItems).mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

		const ctx = mockExecuteContext({
			resource: 'item',
			operation: 'get',
			returnAll: true,
			additionalFields: {},
		});

		const output = await executeRegosNode(ctx as never, meta);
		expect(regosApiRequestAllItems).toHaveBeenCalledWith('Item/Get', {});
		expect(output[0]).toHaveLength(3);
	});

	it('sends a batch request with capitalized Key and emits one item per step response', async () => {
		vi.mocked(regosApiRequest).mockResolvedValueOnce({
			ok: true,
			result: [
				{ key: 'ProducerAdd', status: 200, response: { ok: true, result: { new_id: 4 } } },
				{ key: 'ProducerGet', status: 200, response: { ok: true, result: [{ id: 4 }] } },
			],
		});

		const ctx = mockExecuteContext({
			resource: 'batch',
			operation: 'execute',
			inputMode: 'steps',
			stopOnError: true,
			steps: {
				step: [
					{ key: 'ProducerAdd', path: 'Producer/Add', payload: '{"name":"Coca-Cola"}' },
					{ key: 'ProducerGet', path: 'Producer/Get', payload: '{"ids":["${ProducerAdd.result.new_id}"]}' },
				],
			},
		});

		const output = await executeRegosNode(ctx as never, meta);

		expect(vi.mocked(regosApiRequest).mock.calls[0][0]).toBe('batch');
		const body = vi.mocked(regosApiRequest).mock.calls[0][1] as {
			stop_on_error: boolean;
			requests: Array<Record<string, unknown>>;
		};
		expect(body.stop_on_error).toBe(true);
		expect(body.requests[0].Key).toBe('ProducerAdd');
		expect(body.requests[0].path).toBe('Producer/Add');
		expect(body.requests[1].payload).toEqual({ ids: ['${ProducerAdd.result.new_id}'] });

		expect(output[0]).toHaveLength(2);
	});

	it('emits an error item instead of throwing when continueOnFail is on', async () => {
		vi.mocked(regosApiRequest).mockRejectedValueOnce(new Error('REGOS error 1044: not found'));

		const ctx = {
			...mockExecuteContext({ resource: 'item', operation: 'get', returnAll: false, limit: 50, additionalFields: {} }),
			continueOnFail: () => true,
		};

		const output = await executeRegosNode(ctx as never, meta);
		expect(output[0]).toHaveLength(1);
		expect(output[0][0].json.error).toMatch(/1044/);
	});

	it('reads required fields as top-level parameters, not from additionalFields', async () => {
		vi.mocked(regosApiRequest).mockResolvedValueOnce({ ok: true, result: { row_affected: 1 } });

		// Mirrors n8n: getNodeParameter throws when the parameter is absent and no
		// fallback is supplied. This is what a required-field/property mismatch looks like.
		const parameters: Record<string, unknown> = { resource: 'account', operation: 'delete', id: 42 };
		const ctx = {
			getNode: () => node,
			getInputData: () => [{ json: {} }],
			continueOnFail: () => false,
			getNodeParameter: (name: string, _index: number, ...rest: unknown[]) => {
				if (name in parameters) return parameters[name];
				if (rest.length > 0) return rest[0];
				throw new Error(`Could not get parameter "${name}"`);
			},
		};

		const output = await executeRegosNode(ctx as never, metaWithRequired);

		expect(vi.mocked(regosApiRequest).mock.calls[0][0]).toBe('Account/Delete');
		expect(vi.mocked(regosApiRequest).mock.calls[0][1]).toEqual({ id: 42 });
		expect(output[0]).toHaveLength(1);
	});

	it('includes request/response debug context in continueOnFail items when available', async () => {
		const apiError = Object.assign(new Error('REGOS error 1008: bad params'), {
			context: {
				request: { method: 'POST', path: 'Item/Get', body: { ids: [1] } },
				response: { ok: false, result: { error: 1008, description: 'bad params' } },
			},
		});
		vi.mocked(regosApiRequest).mockRejectedValueOnce(apiError);

		const ctx = {
			...mockExecuteContext({ resource: 'item', operation: 'get', returnAll: false, limit: 50, additionalFields: {} }),
			continueOnFail: () => true,
		};

		const output = await executeRegosNode(ctx as never, meta);
		expect(output[0][0].json.request).toEqual({ method: 'POST', path: 'Item/Get', body: { ids: [1] } });
		expect((output[0][0].json.response as { result: { error: number } }).result.error).toBe(1008);
	});
});
