# n8n-nodes-regos

n8n community node package for the REGOS SaaS ERP (Uzbekistan retail/ERP). Target: **n8n verified community node**. Full generated coverage of the 920-endpoint REGOS Public API.

## Current phase

**Published; preparing 0.3.0 for re-submission (2026-07-22).** `0.2.1` is live on npm (strict mode restored, passes the scanner + `n8n-node cloud-support`) but the Creator Portal's **human** review returned one [HIGH] blocker: **multiple regular nodes in one package**. n8n allows only one regular node per package (+ a trigger). Consolidated the former 5 action nodes (`Regos`, `RegosDocuments`, `RegosPos`, `RegosCrm`, `RegosReports`) into a **single `Regos` node** where every REGOS resource is a Resource — full coverage kept ([ADR-0006](docs/adr/0006-consolidate-to-single-action-node.md), supersedes ADR-0001's node family). Ship as **0.3.0** (breaking: 4 node types removed), deprecate 0.1.x/0.2.x, notify the reviewer to re-run.

Earlier (0.2.0) fix, still in effect: `n8n.strict: false` had marked the package "NOT eligible for n8n Cloud verification" — a manifest flag the portal reads but the public scanner never checks; strict mode must stay on.

Release invariants — verify before every release:
- `npx n8n-node cloud-support` → **ENABLED** (strict mode + stock `eslint.config.mjs`). Never disable it.
- `npm run release` only (never `npm publish` — the prerelease guard blocks it).
- After publishing, run the "Scan published package" workflow from the Actions tab; the scanner CLI is unreliable on Windows (tar path escaping) and lints with inline eslint configs disabled, so scanner-enforced rules must be satisfied, never suppressed.

Local environment notes:
- Local dev needs **Node >= 20.19** (`@n8n/node-cli` uses `require(esm)`); machine runs Node 24.
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
nodes/Regos/                      # single action node + generated/ (all 175 resources)
nodes/RegosTrigger/
scripts/generate/                 # index.mts, domains.json, overrides/*.json
docs/{SPEC.md, adr/, reference/}
tests/*.test.mts
```

Dev-time TypeScript uses `.mts` on purpose: n8n's stock ESLint config scopes its rules to `**/*.ts`, so `.mts` keeps `scripts/`+`tests/` out of scope without touching the config (which strict mode requires to stay byte-identical).

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
