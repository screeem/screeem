import { createField, createFormDefinition, snapshotFormDefinition } from "./definition.js"
import {
  FormNotFoundError,
  FormRevisionConflictError,
  InvalidFormDefinitionError,
  InvalidFormRoutingError,
  InvalidSubmissionError,
  PublishedFormNotFoundError,
} from "./errors.js"
import type { FormDefinition, FormRoutingDefinition, StoredSubmission } from "./model.js"
import {
  matchedSubmissionRouting,
  notConfiguredSubmissionRouting,
} from "./routing-result.js"
import {
  FormAlreadyExistsError,
  FormDraftAlreadyPublishedError,
  type FormDefinitionStore,
  type FormSubmissionStore,
  FormUnavailableError,
  SubmissionAlreadyExistsError,
} from "./stores.js"

type Awaitable<T> = T | Promise<T>

export interface StoreContractFixture<T> {
  readonly store: T
  readonly dispose?: () => Awaitable<void>
}

export type StoreContractFactory<T> = () => Awaitable<StoreContractFixture<T>>

export interface StoreContractCase {
  readonly name: string
  readonly run: () => Promise<void>
}

/**
 * Framework-agnostic contract cases for every FormDefinitionStore adapter.
 * Test frameworks can register each case separately for focused diagnostics.
 */
export function formDefinitionStoreContractCases(
  factory: StoreContractFactory<FormDefinitionStore>,
): readonly StoreContractCase[] {
  return Object.freeze([
    contractCase("rejects reads for missing forms and versions", factory, async (store) => {
      await assertRejects(() => store.get("contract-missing"), FormNotFoundError)
      await assertRejects(() => store.getDraft("contract-missing"), FormNotFoundError)
      await assertRejects(() => store.getActive("contract-missing"), FormNotFoundError)
      await assertRejects(() => store.getPublished("contract-missing", 1), FormNotFoundError)
    }),
    contractCase("creates one isolated draft per form id", factory, async (store) => {
      const definition = definitionWithTitle("Initial")
      const created = await store.create("contract-create", definition)

      assertEqual(created.formId, "contract-create", "created form id")
      assertEqual(created.availability, "draft", "new form availability")
      assertEqual(created.draft.revision, 0, "initial draft revision")
      assertEqual(created.draft.routing, null, "initial routing draft")
      assertEqual(created.publishedVersion, null, "initial published version")
      await assertRejects(() => store.create("contract-create", definition), FormAlreadyExistsError)
    }),
    contractCase("returns defensive definition snapshots", factory, async (store) => {
      const input = mutableDefinition("Snapshot input")
      const created = await store.create("contract-snapshot", input)
      input.title = "Mutated input"
      input.fields[0]!.label = "Mutated field"
      attemptMutation(created.draft.definition, "title", "Mutated output")
      attemptMutation(created.draft.definition.fields[0]!, "label", "Mutated output field")

      const reread = await store.get("contract-snapshot")
      assertEqual(reread.draft.definition.title, "Snapshot input", "stored title snapshot")
      assertEqual(reread.draft.definition.fields[0]?.label, "Name", "stored field snapshot")
      assert(
        reread !== created && reread.draft !== created.draft,
        "record reads must return new snapshots",
      )
    }),
    contractCase("enforces optimistic draft revisions", factory, async (store) => {
      await store.create("contract-revision", definitionWithTitle("Revision zero"))
      const saved = await store.saveDraft(
        "contract-revision",
        0,
        definitionWithTitle("Revision one"),
      )
      assertEqual(saved.revision, 1, "saved revision")

      const error = await assertRejects(
        () => store.saveDraft("contract-revision", 0, definitionWithTitle("Stale write")),
        FormRevisionConflictError,
      )
      assertEqual(error.expectedRevision, 0, "conflict expected revision")
      assertEqual(error.actualRevision, 1, "conflict actual revision")
      assertEqual(
        (await store.getDraft("contract-revision")).definition.title,
        "Revision one",
        "stale save must not change the draft",
      )
    }),
    contractCase("shares revisions between form and routing drafts", factory, async (store) => {
      await store.create("contract-routing-revision", definitionWithTitle("Routing revision"))
      const routing = routingDefinition(
        "exists(submission.name) && submission.name === \"Ada\"",
      )
      const saved = await store.saveRoutingDraft("contract-routing-revision", 0, routing)

      assertEqual(saved.revision, 1, "routing save revision")
      assertEqual(saved.routing?.fallback, "review", "saved routing fallback")
      await assertRejects(
        () =>
          store.saveDraft(
            "contract-routing-revision",
            0,
            definitionWithTitle("Stale form edit"),
          ),
        FormRevisionConflictError,
      )
      await assertRejects(
        () => store.saveRoutingDraft("contract-routing-revision", 0, null),
        FormRevisionConflictError,
      )
      assertEqual(
        (await store.getDraft("contract-routing-revision")).routing?.rules[0]?.id,
        "qualified",
        "stale writes preserve routing",
      )
    }),
    contractCase("rejects invalid drafts before persistence", factory, async (store) => {
      await store.create("contract-invalid-draft", definitionWithTitle("Valid"))
      const invalid = {
        ...definitionWithTitle("Invalid"),
        fields: [
          createField("text", { id: "duplicate", name: "same", label: "First" }),
          createField("text", { id: "duplicate", name: "same", label: "Second" }),
        ],
      } as FormDefinition

      await assertRejects(
        () => store.saveDraft("contract-invalid-draft", 0, invalid),
        InvalidFormDefinitionError,
      )
      assertEqual(
        (await store.getDraft("contract-invalid-draft")).revision,
        0,
        "invalid save must not increment revision",
      )
    }),
    contractCase(
      "publishes atomically and leaves the previous version active on failure",
      factory,
      async (store) => {
        await store.create("contract-atomic", definitionWithTitle("Published one"))
        const first = await store.publish("contract-atomic", 0, "2026-01-01T00:00:00.000Z")
        assertEqual(first.version, 1, "first publication version")

        const draft = await store.saveDraft(
          "contract-atomic",
          0,
          createFormDefinition("Empty draft"),
        )
        await assertRejects(
          () => store.publish("contract-atomic", draft.revision, "2026-01-02T00:00:00.000Z"),
          InvalidFormDefinitionError,
        )

        const active = await store.getActive("contract-atomic")
        assertEqual(active.version, 1, "active version after failed publication")
        assertEqual(active.definition.title, "Published one", "active definition after failure")
        await assertRejects(
          () => store.getPublished("contract-atomic", 2),
          PublishedFormNotFoundError,
        )
      },
    ),
    contractCase(
      "compiles routing before atomically publishing a version",
      factory,
      async (store) => {
        await store.create("contract-routing-publish", definitionWithTitle("Routing publish"))
        const validDraft = await store.saveRoutingDraft(
          "contract-routing-publish",
          0,
          routingDefinition("exists(submission.name) && submission.name === \"Ada\""),
        )
        const first = await store.publish(
          "contract-routing-publish",
          validDraft.revision,
          "2026-01-01T00:00:00.000Z",
        )
        assertEqual(first.routing?.rules[0]?.route, "sales", "published routing snapshot")
        attemptMutation(first.routing!.rules[0]!, "route", "mutated")
        assertEqual(
          (await store.getPublished("contract-routing-publish", 1)).routing?.rules[0]?.route,
          "sales",
          "published routing defensive copy",
        )

        const invalidDraft = await store.saveRoutingDraft(
          "contract-routing-publish",
          validDraft.revision,
          routingDefinition("submission.removed === true"),
        )
        const error = await assertRejects(
          () =>
            store.publish(
              "contract-routing-publish",
              invalidDraft.revision,
              "2026-01-02T00:00:00.000Z",
            ),
          InvalidFormRoutingError,
        )
        assertEqual(error.issues[0]?.ruleId, "qualified", "routing diagnostic rule id")
        assertEqual(
          (await store.getActive("contract-routing-publish")).version,
          1,
          "failed routing publication preserves active version",
        )
        await assertRejects(
          () => store.getPublished("contract-routing-publish", 2),
          PublishedFormNotFoundError,
        )
      },
    ),
    contractCase(
      "keeps monotonically versioned publication history immutable",
      factory,
      async (store) => {
        await store.create("contract-history", definitionWithTitle("Version one"))
        const first = await store.publish("contract-history", 0, "2026-01-01T00:00:00.000Z")
        attemptMutation(first.definition, "title", "Mutated publication")
        const draft = await store.saveDraft(
          "contract-history",
          0,
          definitionWithTitle("Version two"),
        )
        const second = await store.publish(
          "contract-history",
          draft.revision,
          "2026-01-02T00:00:00.000Z",
        )

        assertEqual(second.version, 2, "second publication version")
        assertEqual((await store.getActive("contract-history")).version, 2, "active pointer")
        assertEqual(
          (await store.getPublished("contract-history", 1)).definition.title,
          "Version one",
          "historical definition",
        )
        const historical = await store.getPublished("contract-history", 1)
        attemptMutation(historical.definition.fields[0]!, "label", "Mutated history")
        assertEqual(
          (await store.getPublished("contract-history", 1)).definition.fields[0]?.label,
          "Name",
          "historical read snapshot",
        )
        assertEqual(
          (await store.getPublished("contract-history", 2)).definition.title,
          "Version two",
          "latest definition",
        )
      },
    ),
    contractCase(
      "publishes one draft revision at most once under concurrency",
      factory,
      async (store) => {
        await store.create("contract-repeat-publish", definitionWithTitle("One draft"))
        const attempts = await Promise.allSettled([
          store.publish("contract-repeat-publish", 0, "2026-01-01T00:00:00.000Z"),
          store.publish("contract-repeat-publish", 0, "2026-01-02T00:00:00.000Z"),
        ])
        const published = attempts.filter(
          (
            attempt,
          ): attempt is PromiseFulfilledResult<
            Awaited<ReturnType<FormDefinitionStore["publish"]>>
          > => attempt.status === "fulfilled",
        )
        const rejected = attempts.filter(
          (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
        )

        assertEqual(published.length, 1, "successful concurrent publications")
        assertEqual(rejected.length, 1, "rejected concurrent publications")
        assert(
          rejected[0]?.reason instanceof FormDraftAlreadyPublishedError ||
            rejected[0]?.reason instanceof FormRevisionConflictError,
          "losing publication must report a draft conflict",
        )

        await assertRejects(
          () => store.publish("contract-repeat-publish", 0, "2026-01-02T00:00:00.000Z"),
          FormDraftAlreadyPublishedError,
        )
        assertEqual(
          (await store.getActive("contract-repeat-publish")).version,
          published[0]!.value.version,
          "repeated publication must not create another version",
        )
        await assertRejects(
          () => store.getPublished("contract-repeat-publish", 2),
          PublishedFormNotFoundError,
        )
      },
    ),
    contractCase(
      "rejects stale publication revisions without partial state",
      factory,
      async (store) => {
        await store.create("contract-publish-conflict", definitionWithTitle("Initial"))
        await store.saveDraft("contract-publish-conflict", 0, definitionWithTitle("Current"))

        await assertRejects(
          () => store.publish("contract-publish-conflict", 0, "2026-01-01T00:00:00.000Z"),
          FormRevisionConflictError,
        )
        await assertRejects(
          () => store.getActive("contract-publish-conflict"),
          PublishedFormNotFoundError,
        )
      },
    ),
    contractCase("pauses and resumes only published forms", factory, async (store) => {
      await store.create("contract-availability", definitionWithTitle("Availability"))
      await assertRejects(
        () => store.setAvailability("contract-availability", "paused"),
        PublishedFormNotFoundError,
      )

      await store.publish("contract-availability", 0, "2026-01-01T00:00:00.000Z")
      assertEqual(
        (await store.setAvailability("contract-availability", "paused")).availability,
        "paused",
        "paused availability",
      )
      assertEqual(
        (await store.getPublished("contract-availability", 1)).version,
        1,
        "paused form retains publication history",
      )
      const unavailable = await assertRejects(
        () => store.getActive("contract-availability"),
        FormUnavailableError,
      )
      assertEqual(unavailable.availability, "paused", "unavailable state")
      assertEqual(
        (await store.setAvailability("contract-availability", "active")).availability,
        "active",
        "resumed availability",
      )
      assertEqual(
        (await store.getActive("contract-availability")).version,
        1,
        "resumed form exposes the active publication",
      )
    }),
  ])
}

/** Run all definition-store contract cases without depending on a test framework. */
export async function runFormDefinitionStoreContract(
  factory: StoreContractFactory<FormDefinitionStore>,
): Promise<void> {
  await runContractCases(formDefinitionStoreContractCases(factory))
}

/** Framework-agnostic contract cases for every FormSubmissionStore adapter. */
export function formSubmissionStoreContractCases(
  factory: StoreContractFactory<FormSubmissionStore>,
): readonly StoreContractCase[] {
  return Object.freeze([
    contractCase("returns an empty list for a form with no submissions", factory, async (store) => {
      assertEqual((await store.list("contract-empty")).length, 0, "empty submission list")
    }),
    contractCase("stores publication association and isolates forms", factory, async (store) => {
      await store.save(submission("submission-1", "form-a", 2, { age: 21 }))
      await store.save(submission("submission-2", "form-b", 1, { approved: true }))
      await store.save(submission("submission-3", "form-a", 3, { age: 22 }))

      const formA = await store.list("form-a")
      assertEqual(formA.length, 2, "form-a submission count")
      const byId = new Map(formA.map((item) => [item.id, item]))
      assertEqual(byId.get("submission-1")?.publicationVersion, 2, "first publication association")
      assertEqual(byId.get("submission-3")?.publicationVersion, 3, "second publication association")
      assertEqual((await store.list("form-b")).length, 1, "form-b submission count")
    }),
    contractCase("returns defensive submission snapshots", factory, async (store) => {
      const input = submission("submission-snapshot", "form-snapshot", 1, { name: "Ada" })
      const saved = await store.save(input)
      ;(input.values as Record<string, string | number | boolean>).name = "Mutated input"
      attemptMutation(saved.values, "name", "Mutated output")

      const firstRead = await store.list("form-snapshot")
      assertEqual(firstRead[0]?.values.name, "Ada", "stored submission snapshot")
      attemptMutation(firstRead[0]!.values, "name", "Mutated list")
      const secondRead = await store.list("form-snapshot")
      assertEqual(secondRead[0]?.values.name, "Ada", "repeated submission snapshot")
      assert(firstRead !== secondRead, "list calls must return distinct snapshots")
    }),
    contractCase("filters submissions by selected route", factory, async (store) => {
      await store.save({
        ...submission("submission-sales", "form-routes", 1, { name: "Ada" }),
        routing: matchedSubmissionRouting("sales", "qualified"),
      })
      await store.save({
        ...submission("submission-review", "form-routes", 1, { name: "Grace" }),
        routing: matchedSubmissionRouting("review", "manual"),
      })

      const sales = await store.list("form-routes", { route: "sales" })
      assertEqual(sales.length, 1, "route-filtered submission count")
      assertEqual(sales[0]?.routing.route, "sales", "selected route")
    }),
    contractCase("rejects duplicate submission ids", factory, async (store) => {
      await store.save(submission("submission-duplicate", "form-a", 1, { name: "First" }))
      await assertRejects(
        () => store.save(submission("submission-duplicate", "form-b", 2, { name: "Duplicate" })),
        SubmissionAlreadyExistsError,
      )
      assertEqual((await store.list("form-b")).length, 0, "duplicate must not be stored")
    }),
    contractCase("rejects unsafe or non-domain submission values", factory, async (store) => {
      const unsafeValues = Object.create(null) as Record<string, string>
      Object.defineProperty(unsafeValues, "constructor", {
        value: "unsafe",
        enumerable: true,
      })
      await assertRejects(
        () =>
          store.save({
            ...submission("submission-unsafe", "form-a", 1, {}),
            values: unsafeValues,
          }),
        InvalidSubmissionError,
      )
      await assertRejects(
        () =>
          store.save({
            ...submission("submission-invalid-routing", "form-a", 1, {}),
            routing: {
              status: "matched",
              route: "sales",
              matchedRule: null,
              error: null,
            } as unknown as StoredSubmission["routing"],
          }),
        InvalidSubmissionError,
      )
    }),
  ])
}

/** Run all submission-store contract cases without depending on a test framework. */
export async function runFormSubmissionStoreContract(
  factory: StoreContractFactory<FormSubmissionStore>,
): Promise<void> {
  await runContractCases(formSubmissionStoreContractCases(factory))
}

function contractCase<T>(
  name: string,
  factory: StoreContractFactory<T>,
  exercise: (store: T) => Promise<void>,
): StoreContractCase {
  return Object.freeze({
    name,
    run: async () => {
      const fixture = await factory()
      try {
        await exercise(fixture.store)
      } finally {
        await fixture.dispose?.()
      }
    },
  })
}

async function runContractCases(cases: readonly StoreContractCase[]): Promise<void> {
  const failures: Error[] = []
  for (const testCase of cases) {
    try {
      await testCase.run()
    } catch (error) {
      failures.push(
        new Error(`Store contract failed: ${testCase.name}`, {
          cause: error,
        }),
      )
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Store contract failed")
}

function definitionWithTitle(title: string): FormDefinition {
  return snapshotFormDefinition({
    ...createFormDefinition(title),
    fields: [createField("text", { id: "field-name", name: "name", label: "Name" })],
  })
}

function mutableDefinition(title: string): {
  title: string
  fields: Array<{ label: string } & Record<string, unknown>>
} & FormDefinition {
  return JSON.parse(JSON.stringify(definitionWithTitle(title))) as {
    title: string
    fields: Array<{ label: string } & Record<string, unknown>>
  } & FormDefinition
}

function submission(
  id: string,
  formId: string,
  publicationVersion: number | null,
  values: Record<string, string | number | boolean>,
): StoredSubmission {
  return {
    id,
    formId,
    publicationVersion,
    values,
    routing: notConfiguredSubmissionRouting(),
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function routingDefinition(when: string): FormRoutingDefinition {
  return {
    version: 1,
    rules: [{ id: "qualified", when, route: "sales" }],
    fallback: "review",
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`)
  }
}

async function assertRejects<T extends Error>(
  operation: () => Promise<unknown>,
  ErrorType: abstract new (...args: never[]) => T,
): Promise<T> {
  try {
    await operation()
  } catch (error) {
    if (error instanceof ErrorType) return error
    throw new Error(`Expected ${ErrorType.name}, received ${String(error)}`, { cause: error })
  }
  throw new Error(`Expected ${ErrorType.name} to be thrown`)
}

function attemptMutation(target: object, key: string, value: unknown): void {
  try {
    ;(target as Record<string, unknown>)[key] = value
  } catch {
    // Frozen snapshots may reject writes. A later read proves storage isolation.
  }
}
