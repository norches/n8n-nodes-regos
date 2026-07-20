# n8n-nodes-regos

n8n community nodes for the [REGOS](https://regos.uz) SaaS ERP — a retail/ERP platform (inventory, documents, POS, CRM, loyalty) used primarily in Uzbekistan.

Full coverage of the REGOS Public API (920 endpoints) plus a webhook trigger for all 297 REGOS events.

## Installation

In n8n, go to **Settings → Community Nodes → Install**, enter the package name:

```
n8n-nodes-regos
```

See n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

## Credentials

1. In [REGOS Online](https://regos.online) go to **Business settings → Integrations** and create a **Local Integration**.
2. REGOS shows a gateway endpoint like `https://integration.regos.uz/gateway/out/<key>/v1/`.
3. In n8n, create a **REGOS API** credential and paste the `<key>` part as the **Integration Key**. Leave **Base URL** at its default unless REGOS gave you a different gateway host.

The integration key is the only secret — it authenticates every call. Use the credential's **Test** button to verify it (it calls `CurrentTimeStamp/Get`).

## Nodes

| Node | Covers |
|---|---|
| **Regos** | Core master data: items, partners, accounts, warehouses, dictionaries + Batch + utilities |
| **Regos Documents** | All document families (purchases, sales, orders, movements, inventory, invoices) and their line-item operations |
| **Regos POS** | Point of sale: cheques, cash sessions, cash operations, fast items |
| **Regos CRM** | Leads, deals, chats, tickets, customers, loyalty cards, campaigns |
| **Regos Reports** | Reports, dashboards, widgets, logs |
| **Regos Trigger** | Webhook trigger with a selector over all 297 REGOS events |

**Why five action nodes?** REGOS is a single service with a very large API. Putting all 176 resources in one node would produce a node description with ~9,000 parameters, which makes the n8n node detail view slow and unusable. The API is therefore split along REGOS's own product boundaries. All six nodes share one credential and one gateway. The reasoning is recorded in [ADR-0001](docs/adr/0001-project-scope-and-architecture.md).

## Operations

Every node follows n8n's **Resource → Operation** pattern, which maps directly onto REGOS API paths:

| REGOS API path | Node | Resource | Operation |
|---|---|---|---|
| `Item/Get` | Regos | Item | Get Many |
| `Item/Add` | Regos | Item | Add |
| `DocPurchase/Perform` | Regos Documents | Doc Purchase | Perform |
| `pos/DocCheque/Close` | Regos POS | POS Doc Cheque | Close |

Notes:

- Operations that act on a single record (edit, delete, perform, …) show the record **ID** as a required field. Everything else lives under **Additional Fields**.
- List operations support **Return All** with automatic pagination, or a **Limit**.
- Date fields accept normal n8n date values and are converted to REGOS's Unix-epoch-seconds format.
- The **Regos** node has a **Batch** resource that runs up to 50 REGOS calls in one request, with `${stepKey.result.prop}` placeholders passing values between steps.

## Example workflows

### 1. Sync the item catalog on a schedule

Schedule Trigger → Regos (Item → Get Many, Return All) → your destination.

```json
{
  "name": "REGOS item sync",
  "nodes": [
    {
      "parameters": { "rule": { "interval": [{ "field": "hours", "hoursInterval": 6 }] } },
      "id": "1f6a0f42-0f0f-4f8e-9b5a-1a2b3c4d5e6f",
      "name": "Every 6 hours",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0]
    },
    {
      "parameters": { "resource": "item", "operation": "get", "returnAll": true, "additionalFields": {} },
      "id": "2f6a0f42-0f0f-4f8e-9b5a-1a2b3c4d5e70",
      "name": "Regos",
      "type": "n8n-nodes-regos.regos",
      "typeVersion": 1,
      "position": [220, 0],
      "credentials": { "regosApi": { "id": "1", "name": "REGOS account" } }
    }
  ],
  "connections": { "Every 6 hours": { "main": [[{ "node": "Regos", "type": "main", "index": 0 }]] } }
}
```

### 2. React to a retail order status change

Regos Trigger (event `DocOrderDeliveryStatusSet`, **Resolve Data** on) → IF → notify.

```json
{
  "name": "REGOS order status watcher",
  "nodes": [
    {
      "parameters": { "events": ["DocOrderDeliveryStatusSet"], "options": { "resolveData": true } },
      "id": "3f6a0f42-0f0f-4f8e-9b5a-1a2b3c4d5e71",
      "name": "Regos Trigger",
      "type": "n8n-nodes-regos.regosTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "webhookId": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      "credentials": { "regosApi": { "id": "1", "name": "REGOS account" } }
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "version": 2 },
          "conditions": [
            {
              "leftValue": "={{ $json.data.status }}",
              "rightValue": "Completed",
              "operator": { "type": "string", "operation": "equals" }
            }
          ],
          "combinator": "and"
        }
      },
      "id": "4f6a0f42-0f0f-4f8e-9b5a-1a2b3c4d5e72",
      "name": "Is completed?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [220, 0]
    }
  ],
  "connections": { "Regos Trigger": { "main": [[{ "node": "Is completed?", "type": "main", "index": 0 }]] } }
}
```

Copy either block and paste it onto an n8n canvas to import it, then select your own credential.

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

## REGOS error codes

REGOS reports application errors with HTTP 200 and an error code between 1000 and 9999. The nodes raise these as `REGOS error <code>: <description>`. The description text comes from the REGOS API and is in Russian.

| Range | Meaning |
|---|---|
| 1000–1999 | Validation, access and business-rule errors (e.g. **1008** invalid input parameters, **1044** record not found, **1007** insufficient privileges) |
| 2000–2999 | Database and third-party integration errors |
| 3000–3999 | Internal application errors |
| 4000–4999 | Loyalty, discount and messaging errors |
| 5000–5999 | Cash register, shift and receipt errors |
| 8213 | Rate limit exceeded — the nodes retry this automatically with backoff |
| 9000–9999 | Authorization errors (e.g. an invalid or revoked integration key) |

The full catalog is in the REGOS documentation (Russian): <https://docs.regos.uz/ru/api/intro/errors>.

## Resources

- [REGOS API documentation](https://docs.regos.uz/ru/api) (Russian)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Project specification](docs/SPEC.md) and [architecture decisions](docs/adr/README.md)

## Development

```bash
npm install --ignore-scripts   # isolated-vm (transitive, unused at dev time) needs native build tools otherwise
npm run generate               # regenerate node descriptions from openapi/regos_api_swagger.json
npm run lint
npm test
npm run build
```

Requires Node.js >= 20.19. Node descriptions under `nodes/*/generated/` are produced by `scripts/generate/` — edit the generator or its `overrides/`, never the generated files.

`docs/reference/` holds read-only snapshots of the vendor's own API documentation (in Russian) kept for development reference. They are not part of the published package, which ships `dist/` only.

## License

[MIT](LICENSE)
