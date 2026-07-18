# Generator overrides

Per-operation curation applied on top of the swagger-derived model. Never edit files under
`nodes/*/generated/` directly — patch here and run `npm run generate`.

Each `*.json` file in this directory is a map of `"<Tag>.<operationValue>"` to a patch:

```json
{
	"Item.getExt": { "displayName": "Get Extended" }
}
```

Supported patch keys: `displayName` (operation display name). More keys are added as needed.

A patch referencing an operation that no longer exists in the swagger **fails the build** —
this doubles as drift detection (see ADR-0005).
