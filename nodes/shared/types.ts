// Shared types for the REGOS client, executor, and generated metadata.

/** How a successful REGOS response envelope is shaped (derived from swagger response schema names). */
export type EnvelopeKind = 'offsettedArray' | 'array' | 'object' | 'insert' | 'raw';

/** How a request-body field is edited in the UI and serialized to the API. */
export type FieldKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'triBoolean'
	| 'dateTime'
	| 'options'
	| 'idList'
	| 'stringList'
	| 'filters'
	| 'json';

export interface FieldMeta {
	/** API body key, verbatim from the swagger request schema (usually snake_case). */
	api: string;
	/** n8n parameter name (same as `api`; optional fields live inside the additionalFields collection). */
	param: string;
	kind: FieldKind;
	required: boolean;
}

export interface OperationMeta {
	/** Literal swagger path without leading slash, casing preserved (e.g. "Item/Get", "pos/DocCheque/Create"). */
	path: string;
	envelope: EnvelopeKind;
	/** True when the response is an offsetted array and the request supports limit/offset. */
	paginated: boolean;
	fields: FieldMeta[];
}

/** resource -> operation -> metadata */
export type NodeOperationsMeta = Record<string, Record<string, OperationMeta>>;

export interface RegosCredentials {
	integrationKey: string;
	baseUrl: string;
}

export interface RegosErrorResult {
	error: number;
	description: string;
}

export interface RegosEnvelope {
	ok: boolean;
	result: unknown;
	next_offset?: number;
	total?: number;
}
