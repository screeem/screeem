import { describe, expect, it, vi } from "vitest"

import {
  FormDraftAlreadyPublishedError,
  FormRevisionConflictError,
  MemoryFormDefinitionStore,
  MemoryFormSubmissionStore,
  PublishedFormNotFoundError,
  createField,
  createFormDefinition,
  type FormRoutingDefinition,
} from "../src/index.js"
import {
  formDefinitionStoreContractCases,
  formSubmissionStoreContractCases,
} from "../src/testing.js"

describe("MemoryFormDefinitionStore", () => {
  for (const testCase of formDefinitionStoreContractCases(() => ({
    store: new MemoryFormDefinitionStore(),
  }))) {
    it(testCase.name, testCase.run)
  }

  it("rejects a publication when its draft changes during routing compilation", async () => {
    const compiler = deferredCompiler()
    const store = new MemoryFormDefinitionStore(compiler.compile)
    await store.create("concurrent-edit", formDefinition("Initial"))
    const draft = await store.saveRoutingDraft("concurrent-edit", 0, routing())

    const publication = store.publish(
      "concurrent-edit",
      draft.revision,
      "2026-01-01T00:00:00.000Z",
    )
    await compiler.started
    await store.saveDraft("concurrent-edit", draft.revision, formDefinition("Changed"))
    compiler.release()

    await expect(publication).rejects.toBeInstanceOf(FormRevisionConflictError)
    await expect(store.getActive("concurrent-edit")).rejects.toBeInstanceOf(
      PublishedFormNotFoundError,
    )
  })

  it("publishes a routing draft only once when compilations overlap", async () => {
    const compiler = deferredCompiler(2)
    const store = new MemoryFormDefinitionStore(compiler.compile)
    await store.create("concurrent-publish", formDefinition("Concurrent"))
    const draft = await store.saveRoutingDraft("concurrent-publish", 0, routing())

    const publications = Promise.allSettled([
      store.publish("concurrent-publish", draft.revision, "2026-01-01T00:00:00.000Z"),
      store.publish("concurrent-publish", draft.revision, "2026-01-02T00:00:00.000Z"),
    ])
    await compiler.started
    compiler.release()

    const results = await publications
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(({ status }) => status === "rejected")
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(FormDraftAlreadyPublishedError),
    })
    await expect(store.getPublished("concurrent-publish", 2)).rejects.toBeInstanceOf(
      PublishedFormNotFoundError,
    )
  })
})

describe("MemoryFormSubmissionStore", () => {
  for (const testCase of formSubmissionStoreContractCases(() => ({
    store: new MemoryFormSubmissionStore(),
  }))) {
    it(testCase.name, testCase.run)
  }
})

function deferredCompiler(requiredStarts = 1) {
  let release!: () => void
  let markStarted!: () => void
  let starts = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const compile = vi.fn(async (_definition, routing: FormRoutingDefinition) => {
    starts += 1
    if (starts === requiredStarts) markStarted()
    await gate
    return routing
  })
  return { compile, release, started }
}

function formDefinition(title: string) {
  return {
    ...createFormDefinition(title),
    fields: [createField("text", { id: "name", name: "name", label: "Name" })],
  }
}

function routing(): FormRoutingDefinition {
  return {
    version: 1,
    rules: [{ id: "named", when: 'submission.name === "Ada"', route: "sales" }],
    fallback: "review",
  }
}
