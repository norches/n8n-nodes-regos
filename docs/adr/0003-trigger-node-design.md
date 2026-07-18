# ADR-0003: Trigger node design

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** project owner + Claude (research: webhooks.html catalog extraction, n8n trigger conventions)

## Context and Problem Statement

REGOS can push events to a Local Integration's registered webhook URLs. There are **298 event actions** (swagger `WebHookActionsEnum`; `webhooks.html` lists 297 — swagger wins) across 68 domain groups. Two envelope shapes are documented, there is no delivery signature, webhook URLs are registered **manually in the REGOS UI** when the user creates/edits their Local Integration, and persistent events can be replayed for 7 days via `Event/Get`. How should the n8n trigger work?

## Decision Drivers

- n8n mandates programmatic style for trigger/webhook nodes.
- n8n UX convention (GitHub/Stripe/Asana triggers): one trigger node with a multi-select Events parameter — not a node per event.
- Registration cannot be automated in v1: `Integration/Add|Edit` requires reusable-integration auth at `api.regos.uz`, not the local gateway key.
- ~85% of event payloads carry only `{id}` (or `{uuid}` for Report / POS cheque/session / PromoBonus groups).
- REGOS documents no retry, ordering, or signature semantics.

## Considered Options

1. One node per event — rejected: 298 nodes; against every n8n precedent.
2. Polling-only trigger via `Event/Get` — rejected as primary: adds latency; kept as future backfill mode.
3. **Single programmatic webhook trigger node with Events multi-select** — chosen.

## Decision Outcome

Single node **`Regos Trigger`** (programmatic):

### Events parameter

- Searchable `multiOptions` populated from the generated 298-value event enum (domain group noted in each option's description), plus an **"All Events" (`*`)** option.
- **Events act as an incoming filter, not a subscription**: REGOS sends whatever the Local Integration was configured for in the REGOS UI; the node drops deliveries whose event is not selected. This is stated in the node's description and docs.

### Registration model (manual)

- Static n8n webhook. Node notice + docs instruct: *paste the workflow's Production URL into your Local Integration's webhook list at regos.online → Business settings → Integrations.*
- `webhookMethods.default`:
  - `create()` — sets a static-data flag; best-effort call to `/ConnectedIntegration/GetWebhookInfo` to log a warning if no webhook appears configured; **never hard-fails**.
  - `checkExists()` — reads the flag.
  - `delete()` — clears the flag.
- Auto-registration is deferred (see ADR-0001 deferred list).

### Envelope normalization (verbatim rule)

Both documented shapes must be handled:

```
if (body.action === "HandleWebhook")        // wrapped (integration-handler docs)
  emit { event: body.data.action, event_id: body.event_id, occurred_at: body.occurred_at,
         connected_integration_id: body.connected_integration_id, data: body.data.data }
else                                        // flat (webhooks.html)
  emit { event: body.action, event_id: body.event_id, occurred_at: body.occurred_at, data: body.data }
```

Respond `200` immediately (`onReceived`) per REGOS guidance; heavy work happens downstream in the workflow.

### Options

- **Deduplicate Events** (default **on**) — bounded LRU of recent `event_id`s in workflow static data (~500 entries / 24 h TTL).
- **Resolve Data** (default **off**) — for thin `{id}`/`{uuid}` payloads, fetch the full entity via a generated event→`{Resource}/Get` map; unmapped events pass through unchanged. Documented as spending rate-limit budget.
- **Secret query parameter** (optional) — user appends `?token=…` to the URL they paste into REGOS; node rejects mismatches.

### Recorded risks / caveats

- **No HMAC/signature exists.** Baseline security is capability-URL secrecy; the secret query parameter is the only hardening available.
- Retry/backoff and ordering are undocumented by REGOS — consumers must be idempotent on `event_id` (REGOS explicitly says `event_id` is not sortable).
- Transient events (`ChatWriting`, `ChatSuggest`) are never replayable via `Event/Get`; flagged in their option descriptions.

## Consequences

- Good: matches n8n trigger conventions; one node covers all 298 events; robust against both envelope shapes.
- Bad: manual URL registration is user friction (mitigated by docs + `GetWebhookInfo` warning); missed deliveries are unrecoverable until an `Event/Get` backfill mode ships.

## Links

- [docs/reference/webhooks.html](../reference/webhooks.html) — event catalog + flat envelope
- [docs/reference/reusable_integrations_basic_flow.html](../reference/reusable_integrations_basic_flow.html) — HandleWebhook wrapped envelope
- [ADR-0004](0004-regos-api-client-conventions.md) — client used by Resolve Data / GetWebhookInfo
