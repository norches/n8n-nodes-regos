# ADR-0004: REGOS API client conventions

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** project owner + Claude

## Context and Problem Statement

All 920 operations across 5 action nodes (plus the trigger's Resolve Data / GetWebhookInfo calls) hit the same gateway with the same contract quirks: application errors as HTTP 200, a token-bucket rate limit, offset pagination, epoch dates, and literal-casing paths. These behaviors must be implemented exactly once.

## Decision Drivers

- One choke point for fixes across 920 generated operations.
- REGOS contract: HTTP status is meaningless for application errors.
- Rate limit is per `connected_integration_id`: 2 req/s refill, burst 50, code 8213 on exhaustion.
- Zero runtime deps — only `this.helpers.httpRequest` underneath.

## Considered Options

1. Per-operation request logic (generated) — rejected: duplicates fragile behavior 920 times.
2. **Single shared helper module (`nodes/shared/GenericFunctions.ts`) used by everything** — chosen.

## Decision Outcome

### Transport

- Always `POST`, `Content-Type: application/json;charset=utf-8`.
- Requests go through `this.helpers.httpRequestWithAuthentication('regosApi', options)`. The
  credential is still read directly to build the gateway URL — the integration key is a path
  segment, which no `authenticate` block can inject — but the request itself stays on the
  authenticated helper so credential handling remains n8n's.
  - *Amended 2026-07-20:* the first attempt used plain `httpRequest` with an `eslint-disable` for
    `@n8n/community-nodes/no-http-request-with-manual-auth`. `@n8n/scan-community-package` lints
    with inline configs disabled, so the suppression was void and verification failed. The
    credential now carries a minimal `authenticate` block (Content-Type only) and the helper call
    satisfies the rule as written.
- URL = `{baseUrl}/{integrationKey}/v1/{literal path}` — path strings come only from the generated metadata map, preserving **literal swagger casing** (`/Item/Get`, but `/batch` and all `/pos/*` endpoints keep their lowercase prefix and mixed-case actions). Casing is never normalized anywhere.

### Envelope and errors

- `ok: true` → unwrap and return `result` (plus `next_offset`/`total` for paged envelopes).
- `ok: false` → throw `NodeApiError` with message `REGOS error <code>: <description>`, the REGOS code preserved in error context, and a hint pointing at the error catalog ([docs/reference/errors.html](../reference/errors.html)). **HTTP status is never used to detect application errors**; 4xx/5xx only occur from infrastructure/proxy.

### Retry and pacing

- Bounded jittered exponential backoff — 5 attempts, ~500 ms base, ~10 s cap — on: REGOS code **8213**, HTTP 429/5xx, transient network errors. Applies inside pagination loops too.
- Client-side token bucket, module scope, keyed by integration key: 2 req/s refill, burst cap ~45 (safety margin under 50). **Always on, no user knob in v1.**
- Known caveat: the bucket is per-process; multi-main/queue-mode n8n runs several buckets. The 8213 retry is the backstop.

### Pagination and output shaping

- `regosApiRequestAllItems` loops `offset = next_offset` until exhausted; generated **Return All** / **Limit** parameters on every offsetted-array operation (standard n8n pattern).
- Array results → one n8n item per element; single objects → one item; `InsertResult` → `{id}`; mass-change results → `{row_affected, ids}`.

### Dates

- Wire format is **Unix epoch seconds (int64)** (`start_date`/`end_date`, `last_update`, …). UI parameters are n8n `dateTime`; conversion happens centrally in the executor using the generated `dateFields` metadata.

### continueOnFail

- Executor catches per item and emits `{ json: { error, code } }` with `pairedItem`.

### Batch

- Exposed as an explicit **`Batch → Execute`** operation on the core `Regos` node:
  - UI: `stop_on_error` boolean + steps `fixedCollection` (`Key`, `path`, `payload` as JSON), plus a raw-JSON alternative mode.
  - Serializer emits capital **`Key`** literally (swagger `BatchStep` quirk); max 50 steps; nesting forbidden.
  - `${stepKey.result.prop}` placeholders are passed through untouched (no collision with n8n `{{ }}` expressions — documented).
  - Output: **one item per step response** (`key`, `status`, unwrapped `response`); individual step failures never throw — callers inspect statuses.
- The client **never batches implicitly** in v1.

## Consequences

- Good: uniform behavior everywhere; contract quirks handled once; generated code stays pure data.
- Bad: always-on pacing may slow bulk workflows (bounded by REGOS's own limit anyway); per-process bucket is imperfect in clustered n8n.

## Links

- [ADR-0005](0005-codegen-pipeline-and-implementation-style.md) — metadata map that drives the executor
- [docs/reference/call_rate_limit.html](../reference/call_rate_limit.html), [docs/reference/batch.html](../reference/batch.html), [docs/reference/making_http_calls.html](../reference/making_http_calls.html)
