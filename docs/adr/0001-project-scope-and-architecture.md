# ADR-0001: Project scope and high-level architecture

- **Status:** Accepted — **node-family decision superseded by [ADR-0006](0006-consolidate-to-single-action-node.md)** (2026-07-22: n8n verification requires one regular node per package, so the 5-node split below collapsed into a single `Regos` node). The scope, generation, and shared-infrastructure decisions here still stand.
- **Date:** 2026-07-18
- **Deciders:** project owner + Claude (research: swagger surface map, n8n verified-node requirements)

## Context and Problem Statement

We are building an n8n community node package for the REGOS SaaS ERP, targeting **verified community node** status. The REGOS Public API ("Regos API Public" v1, OpenAPI 3.1.1) exposes **920 endpoints across 176 tags / 169 path groups**, is **100% POST** with JSON bodies, and sits behind a per-integration gateway URL (`https://integration.regos.uz/gateway/out/{integrationKey}/v1/{Method}`) obtained by creating a Local Integration in the REGOS UI. There is no code yet. How much of the API do we cover, and with what package structure?

## Decision Drivers

- Owner decision: **full coverage** of the API surface, not a curated subset.
- 920 endpoints are impossible to hand-write and hand-maintain — generation from the swagger is mandatory.
- Verified-node constraints: zero runtime dependencies, lint gates, provenance publishing (see [ADR-0002](0002-coding-guidelines.md)).
- n8n editor (NDV) performance and reviewability: node descriptions are loaded whole into the editor.
- API drift: REGOS updates the swagger; regeneration must be cheap and reviewable.

## Considered Options

1. Hand-curated subset of popular resources — rejected: contradicts owner decision; endless "please add endpoint X" churn.
2. Single `Regos` node with all 175 resources — rejected: the combined node description is **1,380 top-level `INodeProperties`** (4,172 counting fields nested inside collections), measured from the generated output; real NDV performance risk; no n8n precedent (largest native nodes ≈ 25 resources); red flag in verified review. *(Corrected 2026-07-20: this ADR originally estimated "~9,000+", which overstated the real figure by roughly 6.5×.)*
3. **Domain-split node family, fully generated** — chosen.

## Decision Outcome

> **Superseded by [ADR-0006](0006-consolidate-to-single-action-node.md):** the 5-action-node family below was consolidated into a **single `Regos` action node** (each REGOS resource is a Resource) to meet n8n's one-regular-node-per-package verified rule. Option 2 ("Single `Regos` node") — rejected here — is the shape n8n's reviewer ultimately required. The rest of this decision (full coverage, generation, one credential/transport/executor, committed generated output) is unchanged.

Package **`n8n-nodes-regos`** (unscoped, MIT, English) containing **5 action nodes + 1 trigger node + 1 credential**:

| Node | Contents (by swagger tag / path group) |
|---|---|
| `Regos` | Core master data (Item, Partner, Account, dictionaries: Brand, Color, Country, Currency, Unit, TaxVat, PriceType, …) + **Batch** + utility (CurrentTimeStamp, Event, Webhook info) |
| `Regos Documents` | All `Doc*` families and their `*Operation` counterparts |
| `Regos POS` | `/pos/*` (51 endpoints) + Cheque/Session families |
| `Regos CRM` | Lead, Deal, Chat, ChatMessage, Ticket, Campaign, Channel, Client, loyalty/bonus (RetailCard, PromoBonus, …) |
| `Regos Reports` | Report/analytics, ActionLog |
| `Regos Trigger` | Webhook trigger with 298-event selector ([ADR-0003](0003-trigger-node-design.md)) |

Credential: `RegosApi` — see [ADR-0005](0005-codegen-pipeline-and-implementation-style.md) for fields and test.

Structural rules:

- The **resource→node assignment lives in generator config** (`scripts/generate/domains.json`). The generator **fails CI when the swagger introduces a resource not present in the map**, forcing a conscious placement decision.
- **Codegen is dev-time only; generated output is committed** to the repo (reviewable diffs, verified-scan transparency, reproducible builds; generate-on-install is impossible anyway under the zero-runtime-deps rule).
- All nodes share one credential, one transport/helper module, and one generic executor ([ADR-0004](0004-regos-api-client-conventions.md), [ADR-0005](0005-codegen-pipeline-and-implementation-style.md)).
- Scaffold from `npm create @n8n/node` (n8n starter layout, `@n8n/node-cli`).

Planned repository layout:

```
package.json                      # scaffold phase; n8n attr: 6 nodes + 1 credential; zero runtime deps
openapi/regos_api_swagger.json    # vendored spec of record (codegen input)
credentials/RegosApi.credentials.ts
nodes/shared/{GenericFunctions.ts, executor.ts}
nodes/{Regos,RegosDocuments,RegosPos,RegosCrm,RegosReports}/   # .node.ts + .node.json + svg + generated/
nodes/RegosTrigger/               # RegosTrigger.node.ts + generated/events.ts
scripts/generate/                 # index.ts, mappers/, domains.json, overrides/
docs/{SPEC.md, adr/, reference/}
tests/
.github/workflows/{ci.yml, publish.yml}   # scaffold phase
```

Explicitly deferred decisions (each gets its own ADR when picked up):

- OAuth/REGOS-SSO credential that provisions Local Integrations from inside n8n (v2; SSO reference dumps retained for this).
- Webhook auto-registration ([ADR-0003](0003-trigger-node-design.md) records why it is manual in v1).
- `/Event/Get` polling/backfill trigger mode.
- Any implicit client-side batching ([ADR-0004](0004-regos-api-client-conventions.md) forbids it in v1).

## Consequences

- Good: full coverage with a small hand-written core; swagger updates become regenerate-and-review; each node stays within the size range of large native n8n nodes.
- Bad: large generated diff surface in the repo; 5 node registrations instead of 1; cross-domain workflows mix several node types.
- Risk: n8n reserves the right to reject verified submissions that compete with paid features or on review-size grounds — assess before Creator Portal submission.

## Links

- [docs/SPEC.md](../SPEC.md) — functional spec
- [docs/reference/README.md](../reference/README.md) — API reference index
- [openapi/regos_api_swagger.json](../../openapi/regos_api_swagger.json)
