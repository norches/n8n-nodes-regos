# ADR-0005: Codegen pipeline and programmatic implementation style

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** project owner + Claude (research: declarative vs programmatic constraints, swagger schema conventions)

## Context and Problem Statement

Full coverage of 920 endpoints requires generating node definitions from `openapi/regos_api_swagger.json`. n8n offers two implementation styles: declarative (JSON `routing`, recommended for plain REST) and programmatic (`execute()`). Which style, and how does generation work?

## Decision Drivers

- REGOS contract quirks: `ok:false` at HTTP 200; 8213 retry + shared token bucket; epoch-seconds dates; batch body assembly with `${…}` placeholders.
- Declarative routing has no retry/backoff hook and no way to share a token bucket across requests; the error contract would force a custom `postReceive` on every operation anyway.
- Verified rules *recommend* declarative for plain REST but allow programmatic where transformation/complex handling is required; triggers must be programmatic regardless.
- Generated output must be lint-clean, reviewable, and reproducible without runtime deps.

## Considered Options

1. Declarative with generated `routing` blocks + escape-hatch functions — rejected: 920 generated routing blobs, still full of custom hooks; retry/pacing impossible; worst of both worlds.
2. **Programmatic: one hand-written generic executor + generated data** — chosen.

## Decision Outcome

### Implementation style

One hand-written generic `execute()` (~300–500 lines, `nodes/shared/executor.ts`) shared by all 5 action nodes, driven entirely by generated data. All transport behavior comes from [ADR-0004](0004-regos-api-client-conventions.md) helpers.

### What is generated (per action node)

- Resource option lists (swagger tags → resources) and operation option lists.
- Field `INodeProperties` per operation, derived from the `{Resource}{Action}` request schema.
- `metadata.ts` map: `resource.operation → { path (literal spec casing), envelopeKind (offsettedArray | array | object | insert | raw), paginated, dateFields[], required[] }` — the single source of path strings.
- Shared: the 298-value event enum, grouped by domain, for the trigger.

Type mapping: int64 → `number`; epoch date fields → `dateTime` + `dateFields` flag; `ids[]` → comma-separated string or JSON; `filters[]` → `fixedCollection {Field, Operator, Value}`; nullable tri-state booleans → options (Default / Yes / No); enums → options.

### Generator mechanics

- TypeScript under `scripts/generate/`, run via `tsx` — **devDependencies only**; generated output imports nothing but `n8n-workflow` types.
- Output **committed** under `nodes/<Node>/generated/` with `// AUTO-GENERATED` headers ([ADR-0002](0002-coding-guidelines.md)); lint runs on it.
- Resource→node map: `scripts/generate/domains.json`; unmapped resources fail the build ([ADR-0001](0001-project-scope-and-architecture.md)).
- **Override layer:** `scripts/generate/overrides/**` — per-resource/per-operation JSON patches deep-merged after generation (display names, descriptions, hidden fields, deprecations). An override referencing a nonexistent operation **fails the build** (doubles as drift detection).
- CI: `generate --check` (regenerate + compare, so committed output can never drift from the spec); `generate --diff` emits an added/removed/changed summary for release notes.

### Credential (`RegosApi`)

- `integrationKey` — string, `typeOptions.password: true` (the secret gateway segment).
- `baseUrl` — string, default `https://integration.regos.uz/gateway/out` (override for testing; not secret).
- Rejected alternative: single "paste full gateway URL" field — either leaves the secret unmasked or masks the whole URL and hurts debugging. Docs show users where the key sits in the URL REGOS gives them.
- Credential test: POST `/CurrentTimeStamp/Get` with `{}` (cheapest call, no data-scope permissions); a response with `ok: false` is a **failure** and surfaces the REGOS description — necessary because failures arrive as HTTP 200.

### Versioning and swagger drift

- Nodes start at `version: 1`; use the version-array pattern only for breaking parameter-shape changes. Additive swagger syncs do not bump node versions.
- Package semver: additive sync → minor; fixes → patch; removed/renamed operation or parameter, credential change, node-version bump → major.
- Drift protocol: drop in new swagger → `npm run generate` → review `--diff` summary + git diff → tests → release.
- Endpoints removed upstream: keep the operation for one minor cycle throwing a clear "removed by REGOS" `NodeOperationError`, then drop in the next major. New event enum entries → regenerated trigger options, minor bump ("All Events" already tolerates unknown events).

## Consequences

- Good: all 920 operations behave uniformly through one tested executor; regeneration is mechanical and reviewable; zero runtime deps preserved.
- Bad: loses declarative's built-in pagination sugar (reimplemented once in the executor); committed generated code bloats diffs (accepted for reviewability).

## Links

- [openapi/regos_api_swagger.json](../../openapi/regos_api_swagger.json) — generator input of record
- [ADR-0001](0001-project-scope-and-architecture.md), [ADR-0002](0002-coding-guidelines.md), [ADR-0004](0004-regos-api-client-conventions.md)
