# n8n-nodes-regos

n8n community nodes for the [REGOS](https://regos.uz) SaaS ERP — a retail/ERP platform (inventory, documents, POS, CRM, loyalty) used primarily in Uzbekistan.

Full generated coverage of the REGOS Public API (920 endpoints) plus a webhook trigger for REGOS events.

**Status: pre-release.** Not yet published to npm.

## Nodes

| Node | Covers |
|---|---|
| **Regos** | Core master data: items, partners, accounts, dictionaries + Batch + utilities |
| **Regos Documents** | All document families (purchases, sales, orders, movements, inventory, invoices) and their operations |
| **Regos POS** | Point of sale: cheques, cash sessions, cash operations, fast items |
| **Regos CRM** | Leads, deals, chats, tickets, customers, loyalty cards, campaigns |
| **Regos Reports** | Reports, dashboards, widgets, logs |
| **Regos Trigger** | Webhook trigger with a selector over all 297 REGOS events |

## Credentials

1. In [REGOS Online](https://regos.online) go to **Business settings → Integrations** and create a **Local Integration**.
2. REGOS shows a gateway endpoint like `https://integration.regos.uz/gateway/out/<key>/v1/`.
3. In n8n, create a **REGOS API** credential and paste the `<key>` part as the **Integration Key**. Leave **Base URL** at its default unless REGOS gave you a different gateway host.

The credential test calls `CurrentTimeStamp/Get` through your gateway.

## Trigger setup

REGOS webhook registration is manual:

1. Add a **Regos Trigger** node and select the events you need (or **All Events**).
2. Copy the trigger's **Production URL**.
3. In REGOS Online, edit your Local Integration and add that URL to its **webhooks** list.

Notes:

- REGOS sends every event the integration is subscribed to; the node filters by your selected events.
- REGOS webhooks carry no signature. Optionally set a **Secret Token** in the node options and append `?token=<value>` to the URL you register in REGOS.
- **Deduplicate Events** (on by default) drops redelivered event IDs. **Resolve Data** fetches the full entity when the payload only contains an ID.
- Missed deliveries can be replayed for 7 days via the `Event → Get` operation on the **Regos** node (`last_event_id` cursor).

## Behavior details

- REGOS returns application errors as HTTP 200 with `{ok: false, result: {error, description}}` — the nodes surface these as node errors with the REGOS error code.
- Failed calls expose full debug context — the called endpoint path, the request body actually sent, and the raw REGOS response — in the error details, and on the output item when "Continue on Fail" is enabled. The integration key is never included.
- Rate limiting (2 req/s, burst 50 per integration) is handled automatically: client-side pacing plus bounded retry on REGOS error 8213.
- List operations support **Return All** with automatic `next_offset` pagination.
- Date parameters accept n8n date values and are sent as Unix epoch seconds.
- The **Batch** resource on the **Regos** node runs up to 50 API calls in one request, with `${stepKey.result.prop}` placeholders between steps.

## Development

```bash
npm install --ignore-scripts   # isolated-vm (transitive, unused at dev time) needs native build tools otherwise
npm run generate               # regenerate node descriptions from openapi/regos_api_swagger.json
npm run lint
npm test
npm run build
```

Requires Node.js >= 20.19 (the n8n node CLI uses `require(esm)`). See [CLAUDE.md](CLAUDE.md), [docs/SPEC.md](docs/SPEC.md), and [docs/adr/](docs/adr/README.md) for architecture and contribution rules.

## License

[MIT](LICENSE)
