import { describe, expect, it } from 'vitest';

import {
	applyOverrides,
	buildEvents,
	buildModel,
	loadDomains,
	loadOverrides,
	loadSpec,
} from '../scripts/generate/index.mts';

const spec = loadSpec();
const domains = loadDomains();
const byNode = buildModel(spec, domains);
applyOverrides(byNode, loadOverrides());
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

	it('never requires a key on a list-shaped read (it is a filter there, not a key)', () => {
		// REGOS marks nothing required in the swagger, so the response shape plus the verb is
		// the only signal. Requiring a filter makes the whole search unusable in the editor.
		const listReads = ['pos/DocCheque/get', 'pos/DocSession/get', 'Tag/Get', 'PromoProgramSetting/Get'];
		for (const path of listReads) {
			const op = allOps.find((o) => o.path === path);
			expect(op, path).toBeDefined();
			expect(op?.fields.filter((f) => f.required), path).toHaveLength(0);
		}

		// ...while a mutation on the same list-shaped envelope keeps its key.
		const addRetailCard = allOps.find((o) => o.path === 'pos/DocCheque/AddRetailCard');
		expect(addRetailCard?.fields.some((f) => f.required && f.api === 'uuid')).toBe(true);

		// An override can opt a read back in (exercises the patch.required branch).
		const widgetData = allOps.find((o) => o.path === 'WidgetData/Get');
		expect(widgetData?.fields.some((f) => f.required && f.api === 'id')).toBe(true);
		expect(widgetData?.description).toContain('widget ID');
	});

	it('marks the scalar primary key required on non-list operations', () => {
		const accountDelete = allOps.find((op) => op.path === 'Account/Delete');
		const id = accountDelete?.fields.find((f) => f.api === 'id');
		expect(id?.required).toBe(true);

		// `ids` on a paginated list is a filter, not a required key
		const itemGet = allOps.find((op) => op.path === 'Item/Get');
		expect(itemGet?.fields.every((f) => !f.required)).toBe(true);
	});

	it('gives every operation a human-readable description, never a raw path', () => {
		expect(allOps.every((op) => op.description.length > 0)).toBe(true);
		expect(allOps.some((op) => op.description.startsWith('Call '))).toBe(false);
		expect(allOps.find((op) => op.path === 'Account/Delete')?.description).toBe(
			'Delete an account',
		);
		// overrides win over the generated sentence
		expect(allOps.find((op) => op.path === 'Item/GetExt')?.description).toContain(
			'prices, stock quantities',
		);
	});

	it('emits a matching top-level property for every required metadata field', async () => {
		// The executor reads required fields with getNodeParameter(name, itemIndex) and no
		// fallback, so a required field without a matching property throws at runtime.
		const { generateOutputs } = await import('../scripts/generate/index.mts');
		const outputs = await generateOutputs();

		for (const node of ['Regos', 'RegosDocuments', 'RegosPos', 'RegosCrm', 'RegosReports']) {
			const metadata = outputs.get(`nodes/${node}/generated/metadata.ts`) ?? '';
			const properties = outputs.get(`nodes/${node}/generated/properties.ts`) ?? '';
			const requiredInMetadata = (metadata.match(/required: true/g) ?? []).length;
			const requiredInProperties = (properties.match(/required: true/g) ?? []).length;
			expect(requiredInProperties, node).toBe(requiredInMetadata);
		}
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
