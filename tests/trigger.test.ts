import { describe, expect, it } from 'vitest';

import { normalizeRegosEvent, rememberEvent } from '../nodes/RegosTrigger/RegosTrigger.node';

describe('normalizeRegosEvent', () => {
	it('unwraps the HandleWebhook envelope', () => {
		const normalized = normalizeRegosEvent({
			action: 'HandleWebhook',
			event_id: 'e-1',
			occurred_at: '2026-06-26T10:00:00Z',
			connected_integration_id: 'ci-1',
			data: { action: 'DocOrderDeliveryStatusSet', data: { id: 54321, status: 'Completed' } },
		});
		expect(normalized).toEqual({
			event: 'DocOrderDeliveryStatusSet',
			event_id: 'e-1',
			occurred_at: '2026-06-26T10:00:00Z',
			connected_integration_id: 'ci-1',
			data: { id: 54321, status: 'Completed' },
		});
	});

	it('accepts the flat envelope', () => {
		const normalized = normalizeRegosEvent({
			event_id: 'e-2',
			occurred_at: '2026-06-26T10:00:00Z',
			action: 'ItemAdded',
			data: { id: 7 },
		});
		expect(normalized?.event).toBe('ItemAdded');
		expect(normalized?.data).toEqual({ id: 7 });
	});

	it('rejects unrecognized payloads', () => {
		expect(normalizeRegosEvent({ hello: 'world' })).toBeUndefined();
		expect(normalizeRegosEvent({ action: 'HandleWebhook', data: {} })).toBeUndefined();
	});
});

describe('rememberEvent', () => {
	it('deduplicates within the TTL', () => {
		const seen: Record<string, number> = {};
		expect(rememberEvent(seen, 'e-1', 1_000)).toBe(true);
		expect(rememberEvent(seen, 'e-1', 2_000)).toBe(false);
		expect(rememberEvent(seen, 'e-2', 2_000)).toBe(true);
	});

	it('expires entries after 24h', () => {
		const seen: Record<string, number> = {};
		rememberEvent(seen, 'e-1', 0);
		expect(rememberEvent(seen, 'e-1', 25 * 60 * 60 * 1000)).toBe(true);
	});

	it('bounds the seen set to 500 entries', () => {
		const seen: Record<string, number> = {};
		for (let i = 0; i < 600; i++) rememberEvent(seen, `e-${i}`, i);
		expect(Object.keys(seen).length).toBeLessThanOrEqual(500);
		// oldest evicted, newest kept
		expect(seen['e-599']).toBeDefined();
		expect(seen['e-0']).toBeUndefined();
	});
});
