# `@screeem/routing`

Apply typed routing rules to plain form submissions. Rules are checked against the form schema and run by a restricted interpreter. The package does not evaluate JavaScript source.

## Form-builder usage

A form builder can pass its field definitions to `schemaFromForm`. Extra UI data, such as labels, is ignored.

```ts
import { createRouter, schemaFromForm } from "@screeem/routing"

const form = {
  fields: [
    { name: "name", label: "Full name", type: "string", required: true },
    { name: "employees", label: "Employees", type: "number", required: true },
    {
      name: "country",
      label: "Country",
      type: "enum",
      values: ["UK", "US"],
      required: true,
    },
  ],
} as const

const schema = schemaFromForm(form)

const routing = await createRouter().compile({
  version: 1,
  schema,
  rules: [
    {
      id: "uk-enterprise",
      when: `submission.employees >= 500 && submission.country === "UK"`,
      route: "sales",
    },
  ],
  fallback: "self-serve",
})

const result = await routing.run({
  name: "Ada",
  employees: 750,
  country: "UK",
})

// { route: "sales", matchedRule: "uk-enterprise", actions: [] }
```

`schemaFromForm` also accepts form data loaded from an API or database. It validates and copies the definition before compiling any rules. It rejects duplicate or unsafe field names, unsupported types, invalid enums, and accessor properties.

Supported form field types are `string`, `number`, `boolean`, and `enum`. A field name becomes its rule path. For example, `employees` becomes `submission.employees`.

## Code-first schemas

Use `defineSchema` when the form is defined in code.

```ts
import { defineSchema, field } from "@screeem/routing"

const schema = defineSchema({
  name: field.string({ required: true }),
  age: field.number({ required: true }),
})
```

## Optional fields

Use `exists` or `isEmpty` before reading an optional field.

```ts
exists(submission.phone) && startsWith(submission.phone, "+44")
```

Other built-in functions are `lower`, `upper`, `contains`, `startsWith`, `endsWith`, and `length`.

## Effect API

`runEffect` returns an `Effect` with a typed `RoutingExecutionError` error channel. `run` runs the same program and returns a Promise.

```ts
import { Effect } from "effect"

const result = await Effect.runPromise(routing.runEffect(submission))
```

Matched rules can run registered Effect actions:

```ts
import { Effect } from "effect"
import { createRouter, type } from "@screeem/routing"

const router = createRouter().registerAction({
  name: "notifySales",
  input: type.object({ name: type.string() }),
  run: ({ input }) => Effect.succeed({ queued: input.name }),
})
```

Actions receive an `AbortSignal` at `context.signal`. Pass it to network clients so timeouts and interruption can cancel their work. Actions should remain asynchronous and should not block the JavaScript event loop.

## Commands

Run commands from `packages/routing`:

```sh
make help
make check
```

`make check` runs type-checking, shuffled tests, the production build, and the formatting check.
