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
		expect(Object.keys(spec.paths)).toHaveLength(872);
		expect(allOps).toHaveLength(871);
	});

	it('emits a single action node (one regular node per package; see ADR-0006)', () => {
		expect([...byNode.keys()]).toEqual(['Regos']);
		// Every mapped operation now lives on the one node.
		expect(byNode.get('Regos')).toHaveLength(871);
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
		// REGOS reads now filter via a generic `filters` predicate list.
		expect(fieldNames).toContain('filters');
	});

	it('classifies field kinds from the swagger schema', () => {
		const kindOf = (path: string, name: string) =>
			allOps.find((op) => op.path === path)?.fields.find((f) => f.api === name)?.kind;
		expect(kindOf('Item/Get', 'filters')).toBe('filters');
		expect(kindOf('Account/Edit', 'currency_id')).toBe('number');
		expect(kindOf('Account/Edit', 'name')).toBe('string');
		expect(kindOf('Campaign/Add', 'run_date')).toBe('dateTime');
		expect(kindOf('AccountOperationCategory/Add', 'positive')).toBe('triBoolean');
	});

	it('takes required fields from the swagger declaration, not a heuristic', () => {
		const req = (path: string) =>
			allOps
				.find((o) => o.path === path)!
				.fields.filter((f) => f.required)
				.map((f) => f.api)
				.sort();

		// Multi-field required set, straight from the spec's requestBody `required`.
		expect(req('Account/Add')).toEqual(['code', 'currency_id', 'name']);
		// Single-key mutation.
		expect(req('Account/Delete')).toEqual(['id']);
		// List reads declare no required filter, so the search stays runnable.
		expect(req('Item/Get')).toEqual([]);
		expect(req('DocPurchase/Get')).toEqual([]);
		expect(req('pos/DocCheque/get')).toEqual([]);

		// 618 ops carry at least one required field (was 4 under the retired heuristic).
		const withRequired = allOps.filter((o) => o.fields.some((f) => f.required));
		expect(withRequired.length).toBeGreaterThan(500);
	});

	it('resolves allOf-wrapped request bodies so operations are not empty', () => {
		// Item/Edit is `{ required:[id], allOf:[{$ref: ItemEdit}] }` — the fields come from
		// the referenced schema, which the resolver must unwrap.
		const itemEdit = allOps.find((o) => o.path === 'Item/Edit')!;
		expect(itemEdit.fields.length).toBeGreaterThan(5);
		expect(itemEdit.fields.some((f) => f.api === 'id' && f.required)).toBe(true);

		// Only genuinely parameterless endpoints have no fields (create-cheque, generate-barcode…).
		const emptyObjectOps = allOps.filter((o) => o.bodyKind === 'object' && o.fields.length === 0);
		expect(emptyObjectOps.length).toBeLessThan(10);
	});

	it('models array request bodies as a bulk item collection', () => {
		const bulk = allOps.find((o) => o.path === 'CommercialOfferOperation/Add')!;
		expect(bulk.bodyKind).toBe('array');
		expect(bulk.fields.map((f) => f.api).sort()).toEqual(
			expect.arrayContaining(['document_id', 'item_id', 'price', 'quantity']),
		);
		expect(bulk.fields.filter((f) => f.required).length).toBeGreaterThan(0);
		// Object-bodied operations are the default.
		expect(allOps.find((o) => o.path === 'Account/Add')!.bodyKind).toBe('object');
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

		for (const node of ['Regos']) {
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
		// Resolve Data maps an event to its entity's Get endpoint (filters-based lookup).
		expect(events.resolveMap.ItemAdded).toBe('Item/Get');
		expect(Object.keys(events.resolveMap).length).toBeGreaterThan(50);
	});
});
