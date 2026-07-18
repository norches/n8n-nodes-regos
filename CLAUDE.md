# n8n-nodes-regos

n8n community node package for the REGOS SaaS ERP (Uzbekistan retail/ERP). Target: **n8n verified community node**. Full generated coverage of the 920-endpoint REGOS Public API.

## Current phase

**Scaffolded and generated (2026-07-18).** Package builds, lints clean, 28 unit tests pass, generated output covers all 919 non-batch endpoints + 297 trigger events. Not yet published to npm. Remaining before first release: real-gateway smoke test, GitHub repo (replace OWNER placeholders in package.json/README/codex files), `npm run release` + Creator Portal submission. Keep this section current when phases change.

Local environment notes:
- Local dev needs **Node >= 20.19** (`@n8n/node-cli` uses `require(esm)`; this machine's system Node 20.15 is too old — builds were run with a portable Node 22).
- Install with `npm install --ignore-scripts`: the transitive `isolated-vm` dep (via @n8n/node-cli → ai-node-sdk, unused at dev time) otherwise fails its native build on Windows without VS build tools.

## Hard rules (never violate)

- NEVER add a runtime dependency — `dependencies` stays empty (verified requirement). HTTP via `this.helpers.httpRequest`.
- NEVER trust HTTP status for REGOS errors — application errors arrive as **HTTP 200** + `{ok:false, result:{error, description}}`; 4xx/5xx means infra/proxy only.
- NEVER normalize REGOS path casing — use literal swagger paths: `/Item/Get` PascalCase, but `/batch` and all 51 `/pos/*` endpoints have lowercase prefixes and mixed-case actions (`getcurrent`, `AddByBarcode`).
- NEVER hand-edit generated files (`// AUTO-GENERATED` header) — change the generator or its overrides, then regenerate.
- Webhook deliveries arrive in TWO envelope shapes — always normalize ([ADR-0003](docs/adr/0003-trigger-node-design.md)).
- All REGOS API calls are POST with a JSON body, even reads.
- Everything in English.

## REGOS API cheat-sheet

- Base URL: `https://integration.regos.uz/gateway/out/{integrationKey}/v1/{Method}` — the key segment IS the auth (Local Integration credential).
- Envelope: `{ok: true, result}` | `{ok: false, result: {error: 1000–9999, description}}`.
- Rate limit: token bucket per integration — 2 req/s refill, burst 50; exhausted → HTTP 200 + error code **8213** → retry with backoff.
- Pagination: request `limit` + `offset`; response `result[]` + `next_offset` + `total`; Return All loops on `next_offset`.
- Dates: Unix epoch **seconds**, int64 (`start_date`/`end_date`; e.g. `last_update: 1534151629`).
- Batch: POST `/batch`, max 50 steps `{Key, path, payload}` (capital `Key`), `${stepKey.result.prop}` placeholders, no nesting, 10 s/step, some methods blocked (e.g. `Item/Import`).
- Events: **298 actions** (swagger `WebHookActionsEnum` — authoritative; webhooks.html lists 297). Most payloads are `{id}` only (`uuid` for Report / POS cheque/session / PromoBonus). `/Event/Get` replays persistent events for 7 days via `last_event_id`; transient events (`ChatWriting`, `ChatSuggest`) are never replayable.
- No webhook signature/HMAC — security = webhook URL secrecy (+ optional secret query param, ADR-0003).

## n8n verified-node constraints

- Zero runtime dependencies; package name `n8n-nodes-regos`; `keywords` includes `n8n-community-node-package`.
- Must pass `npx @n8n/scan-community-package` + ESLint (`@n8n/eslint-plugin-community-nodes`, legacy `eslint-plugin-n8n-nodes-base`).
- Publish only via GitHub Actions with npm provenance (mandatory since 2026-05-01; `@n8n/node-cli >= 0.23.0`).
- Trigger/webhook nodes must be programmatic style; credential must define a `test`.
- Submission via n8n Creator Portal; n8n may reject nodes competing with its paid features.

## Repo layout

```
openapi/regos_api_swagger.json    # spec of record, codegen input
credentials/RegosApi.credentials.ts
nodes/shared/{GenericFunctions.ts, executor.ts}
nodes/{Regos,RegosDocuments,RegosPos,RegosCrm,RegosReports}/   # + generated/
nodes/RegosTrigger/
scripts/generate/                 # index.ts, mappers/, domains.json, overrides/
docs/{SPEC.md, adr/, reference/}
tests/
```

## Commands

- `npm run generate` — regenerate `nodes/*/generated/**` from `openapi/regos_api_swagger.json` (`generate:check` = CI drift gate, `generate:diff` = what would change)
- `npm run lint` / `lint:fix` — n8n community-node ESLint (do not fix generated files by hand; fix the generator)
- `npm test` — vitest (helpers, executor, generator invariants, trigger normalization)
- `npm run build` — `n8n-node build` → `dist/`
- `npm run dev` — `n8n-node dev` loop against a local n8n
- `npm run release` — interactive release (tag push triggers the provenance publish workflow)

## Where to look things up

- What we're building (features, node family, roadmap): [docs/SPEC.md](docs/SPEC.md)
- Why decisions were made: [docs/adr/README.md](docs/adr/README.md) — read [ADR-0001](docs/adr/0001-project-scope-and-architecture.md) first
- Raw REGOS API answers: [docs/reference/README.md](docs/reference/README.md) (file→topic index)
- Codegen source of truth: [openapi/regos_api_swagger.json](openapi/regos_api_swagger.json)

## ADR process

Any decision touching architecture, public surface, conventions, or verified compliance gets an ADR before/with implementation. Template + index: [docs/adr/README.md](docs/adr/README.md).
