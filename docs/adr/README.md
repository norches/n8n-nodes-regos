# Architecture Decision Records

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-project-scope-and-architecture.md) | Project scope and high-level architecture | Accepted | 2026-07-18 |
| [0002](0002-coding-guidelines.md) | Coding guidelines and repository conventions | Accepted | 2026-07-18 |
| [0003](0003-trigger-node-design.md) | Trigger node design | Accepted | 2026-07-18 |
| [0004](0004-regos-api-client-conventions.md) | REGOS API client conventions | Accepted | 2026-07-18 |
| [0005](0005-codegen-pipeline-and-implementation-style.md) | Codegen pipeline and programmatic implementation style | Accepted | 2026-07-18 |
| [0006](0006-consolidate-to-single-action-node.md) | Consolidate the action-node family into a single node | Accepted | 2026-07-22 |

Read [ADR-0001](0001-project-scope-and-architecture.md) first — it frames everything else. Note its node-family decision is superseded by [ADR-0006](0006-consolidate-to-single-action-node.md) (one action node, not five).

## Process

- **When an ADR is required:** any decision affecting architecture, the public surface (nodes, credentials, parameters), coding conventions, or n8n verified-program compliance. Write the ADR before or together with the implementation.
- **Template:** [template.md](template.md) (MADR-lite). Keep "Considered Options" honest — rejected alternatives stop future sessions from re-litigating.
- **Naming:** `NNNN-kebab-case-title.md`, 4-digit zero-padded, monotonically increasing, numbers never reused.
- **Status lifecycle:** `Proposed → Accepted → Deprecated | Superseded by ADR-NNNN`. Superseded ADRs keep their file; the new ADR links back.
- Update the index table above whenever an ADR is added or changes status.
