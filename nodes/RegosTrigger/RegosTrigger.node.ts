import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { regosApiRequest } from '../shared/GenericFunctions';
import { eventResolveMap, webhookEvents } from './generated/events';

const DEDUPE_MAX_ENTRIES = 500;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

interface NormalizedEvent {
	event: string;
	event_id?: string;
	occurred_at?: string;
	connected_integration_id?: string;
	data: IDataObject;
}

/**
 * REGOS documents two delivery envelopes (see ADR-0003):
 *  - wrapped: { action: "HandleWebhook", event_id, occurred_at, connected_integration_id,
 *              data: { action: "<Event>", data: {...} } }
 *  - flat:    { event_id, occurred_at, action: "<Event>", data: {...} }
 */
export function normalizeRegosEvent(body: IDataObject): NormalizedEvent | undefined {
	if (body.action === 'HandleWebhook') {
		const inner = (body.data ?? {}) as IDataObject;
		if (typeof inner.action !== 'string') return undefined;
		return {
			event: inner.action,
			event_id: body.event_id as string | undefined,
			occurred_at: body.occurred_at as string | undefined,
			connected_integration_id: body.connected_integration_id as string | undefined,
			data: (inner.data ?? {}) as IDataObject,
		};
	}
	if (typeof body.action === 'string') {
		return {
			event: body.action,
			event_id: body.event_id as string | undefined,
			occurred_at: body.occurred_at as string | undefined,
			data: (body.data ?? {}) as IDataObject,
		};
	}
	return undefined;
}

/** Bounded seen-set for event_id dedupe kept in workflow static data. */
export function rememberEvent(
	seen: Record<string, number>,
	eventId: string,
	now: number,
): boolean {
	for (const [id, timestamp] of Object.entries(seen)) {
		if (now - timestamp > DEDUPE_TTL_MS) delete seen[id];
	}
	if (seen[eventId] !== undefined) return false;

	const ids = Object.keys(seen);
	if (ids.length >= DEDUPE_MAX_ENTRIES) {
		const oldest = ids.sort((a, b) => seen[a] - seen[b]).slice(0, ids.length - DEDUPE_MAX_ENTRIES + 1);
		for (const id of oldest) delete seen[id];
	}

	seen[eventId] = now;
	return true;
}

export class RegosTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Regos Trigger',
		name: 'regosTrigger',
		icon: { light: 'file:regos.svg', dark: 'file:regos.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when REGOS sends an event webhook',
		defaults: { name: 'Regos Trigger' },
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'regosApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Register this webhook in REGOS manually: copy the Production URL above and add it to your Local Integration\'s webhook list at regos.online → Business settings → Integrations. REGOS sends every event the integration is subscribed to; this node then filters by the events selected below.',
				name: 'registrationNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'Which REGOS events start the workflow. Deliveries for unselected events are acknowledged and dropped.',
				options: [{ name: 'All Events', value: '*' }, ...webhookEvents],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Deduplicate Events',
						name: 'dedupe',
						type: 'boolean',
						default: true,
						description:
							'Whether to drop deliveries whose event ID was already processed (REGOS delivery retries are undocumented; consumers should be idempotent)',
					},
					{
						displayName: 'Resolve Data',
						name: 'resolveData',
						type: 'boolean',
						default: false,
						description:
							'Whether to fetch the full entity from REGOS when the event payload only contains an ID. Spends rate-limit budget; only works for events with a matching Get endpoint.',
					},
					{
						displayName: 'Secret Token',
						name: 'secretToken',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description:
							'If set, deliveries must include this value as a "token" query parameter (append ?token=... to the URL you register in REGOS). REGOS webhooks carry no signature; this is the only hardening available.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			// Registration is manual in the REGOS UI (Local Integration webhook list), so these
			// lifecycle hooks only track local state and never fail activation.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return this.getWorkflowStaticData('node').registered === true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				staticData.registered = true;

				try {
					const info = await regosApiRequest.call(this, 'ConnectedIntegration/GetWebhookInfo', {});
					this.logger.debug('REGOS webhook info', { info: info.result as IDataObject });
				} catch (error) {
					this.logger.warn(
						`Regos Trigger could not verify webhook registration (${(error as Error).message}). ` +
							'Make sure the Production URL is added to your Local Integration in REGOS.',
					);
				}
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				delete staticData.registered;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		const options = this.getNodeParameter('options', {}) as {
			dedupe?: boolean;
			resolveData?: boolean;
			secretToken?: string;
		};

		if (options.secretToken) {
			const query = this.getQueryData() as IDataObject;
			if (query.token !== options.secretToken) {
				const res = this.getResponseObject();
				res.status(403).json({ ok: false });
				return { noWebhookResponse: true };
			}
		}

		const normalized = normalizeRegosEvent(body);
		// Unrecognized payloads and unselected events are acknowledged with 200 and dropped —
		// REGOS retry behavior is undocumented, so never error on valid deliveries.
		if (!normalized) return {};

		const events = this.getNodeParameter('events', []) as string[];
		if (!events.includes('*') && !events.includes(normalized.event)) return {};

		if (options.dedupe !== false && normalized.event_id) {
			const staticData = this.getWorkflowStaticData('node');
			const seen = (staticData.seenEvents ?? {}) as Record<string, number>;
			staticData.seenEvents = seen;
			if (!rememberEvent(seen, normalized.event_id, Date.now())) return {};
		}

		let output: IDataObject = { ...normalized };

		if (options.resolveData === true) {
			const resolvePath = eventResolveMap[normalized.event];
			const id = normalized.data.id;
			if (resolvePath && typeof id === 'number') {
				try {
					const envelope = await regosApiRequest.call(this, resolvePath, { ids: [id] });
					const rows = Array.isArray(envelope.result) ? envelope.result : [];
					if (rows.length > 0) output = { ...output, resolved: rows[0] as IDataObject };
				} catch (error) {
					this.logger.warn(`Regos Trigger could not resolve ${normalized.event} data: ${(error as Error).message}`);
				}
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray([output])],
		};
	}
}
