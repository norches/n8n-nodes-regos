# ADR-0006: Consolidate the action-node family into a single node

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** project owner + Claude (trigger: n8n verification review finding)
- **Supersedes:** the node-family decision in [ADR-0001](0001-project-scope-and-architecture.md) (its Option 3)

## Context and Problem Statement

The n8n Creator Portal review of `n8n-nodes-regos` returned a single **[HIGH]** blocker:

> **Multiple regular nodes in a single package.** This package registers 5 regular (non-trigger) nodes (Regos, RegosDocuments, RegosPos, RegosCrm, RegosReports). n8n allows only one regular node per package (an accompanying trigger node is fine). Please consolidate them into a single action node with each surface exposed as a resource (the shape used by Notion, HubSpot, Airtable, etc.). Do not split into multiple npm packages — that would create several distinct n8n nodes for one third-party service, which violates the one-node-per-service convention.

[ADR-0001](0001-project-scope-and-architecture.md) had **explicitly rejected** the single-node shape (its "Option 2"): the merged node measures **1,380 top-level `INodeProperties` (4,172 counting fields nested in collections), ~930 KB** of generated properties, and ADR-0001 cited node-detail-view (NDV) load, "no n8n precedent (largest native nodes ≈ 25 resources)," and verified-review risk. The 5-node domain split existed precisely to avoid that mega-node. The reviewer — the authority that owns the verification bar — now **requires** that shape. So the earlier rejection is overruled by the party whose acceptance it was hedging against.

## Decision Drivers

- **Hard verification rule:** one regular node per package (+ an optional trigger). Non-negotiable for verified status.
- **No multi-package escape hatch:** the reviewer forbids splitting into several npm packages (would create several nodes for one service).
- **Owner mandate stands:** full coverage of the API surface — no curation to shrink the node (ADR-0001 decision driver, reaffirmed 2026-07-22).
- The 5-node NDV-performance concern was **self-imposed**; the reviewer requiring this shape removes the "red flag in verified review" that motivated it.

## Considered Options

1. **Keep 5 nodes** — rejected: fails the [HIGH] blocker; not resubmittable.
2. **Split into 5 npm packages, one node each** — rejected: reviewer explicitly forbids it; also breaks single-credential reuse.
3. **One node + curate the surface down** — rejected: contradicts the owner's full-coverage mandate; n8n has no lazy-loading of node properties, so curation is the only size lever, and the owner declined it.
4. **One node, full coverage, every REGOS resource a Resource** — chosen.

## Decision Outcome

Chosen: **Option 4.** Package `n8n-nodes-regos` ships **one regular node `Regos`** (type `n8n-nodes-regos.regos`) plus the existing **`Regos Trigger`** and the one `RegosApi` credential.

- The single `Regos` node exposes **all 175 REGOS resources** (swagger tags) as options on its **Resource** dropdown, plus the hand-written **Batch** resource. Each resource keeps its **Operation** dropdown and per-operation fields, exactly as before — only the node boundary changes.
- **Full coverage retained:** all 919 generated operations (batch excluded from generation) live on the one node.
- Implementation is a **data-flattening** change, not a rewrite: the generator already emitted `resource(tag) → operation` data with a *global* operation-value collision check and a shared executor/credential/transport. Consolidation = collapse `scripts/generate/domains.json` to a single `Regos` node (union of the former five tag lists) and point `NODE_DIRS` at one output dir. See [ADR-0005](0005-codegen-pipeline-and-implementation-style.md).
- The four removed node types (`regosDocuments`, `regosPos`, `regosCrm`, `regosReports`) are deleted. This is **breaking** and ships as **0.3.0**; 0.1.x/0.2.x are deprecated on npm.

## Consequences

- Good: satisfies the one-node-per-package verified rule; single searchable Resource picker matches the Notion/HubSpot/Airtable convention users expect; full coverage preserved; one node registration instead of five.
- Bad: the node description is large (~930 KB, 1,380 top-level params). n8n renders only the **active** resource's fields via `displayOptions`, so editing stays responsive, but the one-time node-description load is heavy. This is the accepted tradeoff — the reviewer requires the shape.
- Breaking: workflows referencing the four removed node types must switch to `regos` and re-pick Resource/Operation (documented in CHANGELOG).
- Neutral: `scripts/generate/domains.json` no longer expresses product-domain grouping; the resource dropdown is one flat alphabetized list.

## Links

- [ADR-0001](0001-project-scope-and-architecture.md) — superseded node-family decision (Option 3)
- [ADR-0005](0005-codegen-pipeline-and-implementation-style.md) — codegen pipeline the consolidation rides on
- [ADR-0003](0003-trigger-node-design.md) — the trigger node, unaffected (allowed alongside the single action node)
- n8n verified community node guidelines — one regular node per package
