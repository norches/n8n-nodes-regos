# Generator overrides

Per-operation curation applied on top of the swagger-derived model. Never edit files under
`nodes/*/generated/` directly — patch here and run `npm run generate`.

Each `*.json` file in this directory is a map of `"<Tag>.<operationValue>"` to a patch:

```json
{
	"Item.getExt": {
		"displayName": "Get Many (Extended)",
		"description": "Retrieve many items including prices, stock quantities and image URLs",
		"required": ["id"]
	}
}
```

| Key | Effect |
|---|---|
| `displayName` | Replaces the operation name in the Operation dropdown |
| `description` | Replaces the generated sentence shown under the operation name |
| `required` | API field names to force as required top-level parameters (instead of Additional Fields) |

Why this exists: the REGOS swagger carries **no** operation summaries, descriptions, or
`required[]` arrays, so every label the user sees is derived by the generator. Overrides are how
the highest-traffic operations get human-written wording.

Both a patch key that names an operation the swagger no longer has, and a `required` entry naming a
field that operation does not have, **fail the build** — this doubles as drift detection (ADR-0005).
