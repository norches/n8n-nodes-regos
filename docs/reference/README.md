# REGOS API reference snapshots

Read-only snapshots taken **2026-07-18** from [docs.regos.uz](https://docs.regos.uz/ru/api) (HTML page bodies, Russian). They exist so the project can be developed without re-fetching the docs site.

**Conflict rules:**

- `../../openapi/regos_api_swagger.json` is authoritative wherever it disagrees with these pages — with one exception: the **webhook delivery envelope**, where the integration-handler docs add a `HandleWebhook` wrapper that the swagger does not model (see [ADR-0003](../adr/0003-trigger-node-design.md)).
- Event count: swagger's `WebHookActionsEnum` has **298** entries; `webhooks.html` lists 297. Swagger wins — the generated trigger event list comes from swagger.

## Which file answers what

| File | Answers |
|---|---|
| `../../openapi/regos_api_swagger.json` | Source of truth for codegen: 920 endpoints, 176 tags, all request/response schemas, `WebHookActionsEnum` (298 events) |
| `making_http_calls.html` | Request format, required headers, `{ok, result}` envelope, ErrorResult shape, POST-only rule |
| `api_quick_start.html` | End-to-end walkthrough: getting the gateway endpoint, first calls, entity model (Item / Doc* / Operation*) |
| `call_rate_limit.html` | Rate limiting: token bucket 2 req/s refill, burst 50, error code 8213 |
| `batch.html` | Batch semantics: max 50 steps, `${stepKey.result.prop}` placeholders, `stop_on_error`, 10 s/step timeout, blocked methods, no nesting |
| `errors.html` | Full application error catalog (codes 1000–9999) + HTTP status semantics |
| `webhooks.html` | Full event catalog (297 listed), flat delivery envelope, persistent vs transient events, `Event/Get` 7-day replay |
| `local_integrations.html` | Local integrations: the v1 auth model (gateway URL as credential, manual webhook URL registration in REGOS UI) |
| `reusable_integrations.html`, `reusable_integrations_basic_flow.html` | Reusable-integration flow: Connect/Disconnect/Reconnect/UpdateSettings/HandleWebhook handler methods, `connected_integration_id` — source of the wrapped webhook envelope; relevant to v2 auto-provisioning |
| `sso_*.html` (12 files) | REGOS SSO / OAuth 2.0 / OpenID Connect (auth.regos.uz): authorize, token, userinfo, introspect, revoke, logout, JWKS, code flow, client-credentials flow, errors, login button. **v2 OAuth credential only — ignore for v1** |
| `embed_token.html` | Embed-token flow for iframe integrations inside REGOS UI (not needed for nodes) |
| `regos_system_basic_info.html` | REGOS platform overview: modules (Online, Store Management, CashServer, POS, VCR, API) + terminology |
