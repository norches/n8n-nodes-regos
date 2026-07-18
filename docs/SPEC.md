# n8n-nodes-regos — Functional Specification

Living document. Facts about *what* we build live here; *why* lives in [docs/adr/](adr/README.md); invariants and cheat-sheets live in [CLAUDE.md](../CLAUDE.md).

## Overview

**REGOS** is a SaaS ERP for medium/large retail, used primarily in Uzbekistan. Modules: REGOS Online (web back office), Store Management, CashServer, POS, VCR (fiscal virtual cash register), and a Public API (920 POST endpoints behind a per-integration gateway). See [docs/reference/regos_system_basic_info.html](reference/regos_system_basic_info.html).

**This package** (`n8n-nodes-regos`) lets n8n users automate REGOS: full API coverage as action nodes plus a webhook trigger for REGOS events.

**Target users:** REGOS merchants and their integrators automating ERP flows (orders, inventory, purchasing, CRM, loyalty, reporting) in n8n.

**Distribution goal:** n8n **verified community node** (installable on n8n Cloud); plain npm install for self-hosted works from the first publish.

## Deliverables

Node family (reasoning: [ADR-0001](adr/0001-project-scope-and-architecture.md)):

| Node | Contents |
|---|---|
| `Regos` | Core master data (Item, Partner, Account, dictionaries) + Batch + utility (CurrentTimeStamp, Event, Webhook info) |
| `Regos Documents` | All `Doc*` document families + their `*Operation` counterparts |
| `Regos POS` | `/pos/*` (51 endpoints) + Cheque/Session families |
| `Regos CRM` | Lead, Deal, Chat, ChatMessage, Ticket, Campaign, Channel, Client, loyalty/bonus |
| `Regos Reports` | Report/analytics, ActionLog |
| `Regos Trigger` | Webhook trigger, 298-event selector ([ADR-0003](adr/0003-trigger-node-design.md)) |

One credential: `RegosApi` — masked `integrationKey` + `baseUrl`, test via `/CurrentTimeStamp/Get` ([ADR-0005](adr/0005-codegen-pipeline-and-implementation-style.md)).

## Functional requirements

- **Full endpoint coverage** — all 920 swagger operations, generated ([ADR-0005](adr/0005-codegen-pipeline-and-implementation-style.md)); Resource/Operation UX per n8n guidelines.
- **Pagination** — Return All / Limit on every offsetted-array operation, looping `next_offset` ([ADR-0004](adr/0004-regos-api-client-conventions.md)).
- **Error surfacing** — REGOS application errors (HTTP 200 + `ok:false`) thrown as `NodeApiError` with REGOS code + description; automatic bounded retry on rate-limit code 8213 and infra 429/5xx.
- **Rate pacing** — always-on client-side token bucket (2 req/s, burst ~45) per integration key.
- **Batch** — explicit `Batch → Execute` operation (50-step limit, `${stepKey.result.prop}` placeholders, per-step results as items).
- **Trigger** — single webhook node: 298-event multi-select filter, envelope normalization (wrapped `HandleWebhook` + flat shapes), event_id dedupe (default on), optional Resolve Data (fetch full entity), optional secret query parameter; manual URL registration in REGOS UI with in-node instructions.
- **Credential test** — verifies the gateway key with the cheapest call, treating `ok:false` as failure.

## v1 auth model

User creates a **Local Integration** at regos.online (Business settings → Integrations), providing a name, endpoint, and webhook URLs; REGOS returns a gateway endpoint `https://integration.regos.uz/gateway/out/{integrationKey}/v1/`. The key segment is the credential. See [docs/reference/local_integrations.html](reference/local_integrations.html) and [docs/reference/api_quick_start.html](reference/api_quick_start.html).

## Non-goals / v2 roadmap

- OAuth / REGOS SSO (auth.regos.uz, OpenID Connect) flow that creates Local Integrations from inside n8n — v2; reference material kept in `docs/reference/sso_*.html`.
- Webhook auto-registration (requires reusable-integration auth at api.regos.uz).
- `/Event/Get` polling/backfill trigger mode (7-day replay) — `Event/Get` is still exposed as a normal action operation for manual backfill workflows.
- Implicit client-side batching.

## Constraints

n8n verified-program requirements (details in [CLAUDE.md](../CLAUDE.md) and [ADR-0002](adr/0002-coding-guidelines.md)): zero runtime dependencies; naming + keyword conventions; lint + `@n8n/scan-community-package` gates; GitHub Actions provenance publishing; programmatic trigger style.

## Acceptance criteria (v1 release)

1. `npm run lint` and `npx @n8n/scan-community-package` pass.
2. `npm run generate --check` proves committed generated output matches `openapi/regos_api_swagger.json`.
3. Unit tests green (executor, helpers, generator invariants, trigger normalization).
4. Package installs into self-hosted n8n via community-nodes UI; all 6 nodes appear; credential test works against a real gateway key.
5. Published to npm with provenance via GitHub Actions.
6. Submitted through the n8n Creator Portal.

## Decision log

See [docs/adr/README.md](adr/README.md) — ADR-0001…0005 accepted 2026-07-18.
