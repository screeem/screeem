# `@screeem/forms`

Headless form definitions, editing operations, submission validation, and pluggable stores.

The package contains no React, browser, network, or database dependency. A form definition is plain data and is compatible with `schemaFromForm` from `@screeem/routing`.

Routing drafts are plain, schema-free data stored beside the form draft. Form and routing edits share one optimistic revision. Publishing compiles configured rules against the current fields and snapshots both into the same immutable version. Forms without routing remain valid.

## Routing authoring

Use the authoring helpers to build rules without writing expressions. Conditions refer to stable field IDs, so changing a submission key regenerates the runtime rule safely.

```ts
import {
  generateFormRoutingDefinition,
  type FormRoutingAuthoring,
} from "@screeem/forms"

const source: FormRoutingAuthoring = {
  version: 1,
  rules: [
    {
      id: "adult",
      combinator: "all",
      conditions: [
        {
          id: "age-check",
          fieldId: "age-field",
          operator: "greater_than_or_equal",
          value: 18,
        },
      ],
      route: "allow",
    },
  ],
  fallback: "review",
}

const result = generateFormRoutingDefinition(definition, source)
if (!result.ok) console.log(result.issues)
```

`testFormRouting` validates a sample submission before evaluating these rules. The generated routing definition retains the authoring source for later editing.

Routing definitions are limited to 3 MiB of UTF-8 JSON.

## Stores

Use the included in-memory stores for tests and prototypes, or implement the public store interfaces for your infrastructure. The `@screeem/forms/testing` export provides contract runners that check custom adapters against the same revision, routing compilation, publication, and immutability behavior as the in-memory stores.

## Supported controls

- text, email, and textarea (`string`)
- number (`number`)
- checkbox (`boolean`)
- single select (`enum`)

Definitions do not contain executable JavaScript or arbitrary validation functions.

## Effect

Effect is an optional host integration. Import from `@screeem/forms/effect` to
validate submissions with a typed error channel or adapt either public store
interface for use in an Effect program. Definitions and submitted values remain
plain data, so form builders and non-Effect consumers use the same model.

```ts
import { Effect } from "effect"
import { normalizeSubmissionEffect } from "@screeem/forms/effect"

const values = await Effect.runPromise(
  normalizeSubmissionEffect(definition, { name: "Ada", age: 21 }, { mode: "json" }),
)
```
