import { describe, expect, it } from 'vitest';

import { buildEvents, buildModel, loadDomains, loadSpec } from '../scripts/generate/index.mts';

const spec = loadSpec();
const domains = loadDomains();
const byNode = buildModel(spec, domains);
const allOps = [...byNode.values()].flat();

describe('generator invariants', () => {
	it('maps every swagger endpoint except the excluded batch', () => {
		expect(Object.keys(spec.paths)).toHaveLength(920);
		expect(allOps).toHaveLength(919);
	});

	it('covers all five nodes', () => {
		expect([...byNode.keys()].sort()).toEqual([
			'Regos',
			'RegosCrm',
			'RegosDocuments',
			'RegosPos',
			'RegosReports',
		]);
	});

	it('preserves literal path casing, including /pos/* and mixed-case actions', () => {
		const paths = new Set(allOps.map((op) => op.path));
		expect(paths.has('Item/Get')).toBe(true);
		expect(paths.has('pos/ChequeItemOperation/AddByBarcode')).toBe(true);
		expect(paths.has('pos/ChequeItemOperation/get')).toBe(true);
		expect(paths.has('CurrentTimeStamp/Get')).toBe(true);
		// batch is excluded from generation (hand-written UI)
		expect(paths.has('batch')).toBe(false);
	});

	it('derives unique resource.operation keys', () => {
		const keys = allOps.map((op) => `${op.resource}.${op.value}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('disambiguates POS variants of duplicated operations', () => {
		const chequePayment = allOps.filter((op) => op.resource === 'ChequePaymentOperation');
		const values = chequePayment.map((op) => op.value).sort();
		expect(values).toContain('get');
		expect(values).toContain('posGet');
	});

	it('marks offsetted list endpoints as paginated and strips their limit/offset fields', () => {
		const itemGet = allOps.find((op) => op.path === 'Item/Get');
		expect(itemGet?.envelope).toBe('offsettedArray');
		expect(itemGet?.paginated).toBe(true);
		const fieldNames = itemGet?.fields.map((f) => f.api) ?? [];
		expect(fieldNames).not.toContain('limit');
		expect(fieldNames).not.toContain('offset');
		expect(fieldNames).toContain('ids');
	});

	it('classifies field kinds from the swagger schema', () => {
		const itemGet = allOps.find((op) => op.path === 'Item/Get');
		const kind = (name: string) => itemGet?.fields.find((f) => f.api === name)?.kind;
		expect(kind('ids')).toBe('idList');
		expect(kind('deleted_mark')).toBe('triBoolean');
		expect(kind('filters')).toBe('filters');
		expect(kind('type')).toBe('options');

		const docPurchaseGet = allOps.find((op) => op.path === 'DocPurchase/Get');
		expect(docPurchaseGet?.fields.find((f) => f.api === 'start_date')?.kind).toBe('dateTime');
	});

	it('emits 297 trigger events (enum minus the Default sentinel) with a resolve map', () => {
		const events = buildEvents(spec, domains);
		expect(events.options).toHaveLength(297);
		const values = events.options.map((o) => (o as { value: string }).value);
		expect(values).not.toContain('Default');
		expect(values).toContain('DocOrderDeliveryStatusSet');
		expect(events.resolveMap.ItemAdded).toBe('Item/Get');
	});
});
