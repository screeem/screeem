import { Cause, Effect, Either, Exit, Option } from "effect"
import { describe, expect, it } from "vitest"

import {
  createMemoryObjectStoreAdapter,
  createObjectStore,
  InvalidObjectRequestError,
  ObjectNotFoundError,
  type ObjectKey,
  type ObjectStore,
} from "../src/index.js"
import { objectStoreContractCases, objectStoreContractScopes } from "../src/testing.js"

describe("memory object store", () => {
  for (const testCase of objectStoreContractCases(() => ({
    store: createObjectStore(createMemoryObjectStoreAdapter(), {
      scopes: objectStoreContractScopes,
    }),
    teams: { primary: "team-primary", secondary: "team-secondary" },
  }))) {
    it(testCase.name, testCase.run)
  }

  it("keeps stored bytes isolated from later caller mutation", async () => {
    const store = contractStore()
    const key = imageKey(["isolation.png"])
    const bytes = Uint8Array.from([1, 2, 3])

    await succeed(store.put({ key, bytes, contentType: "image/png" }))
    bytes[0] = 99

    const read = await succeed(store.get(key))
    expect([...read.bytes]).toEqual([1, 2, 3])

    read.bytes[1] = 42
    const reread = await succeed(store.get(key))
    expect([...reread.bytes]).toEqual([1, 2, 3])
  })

  it("returns the same entity tag for identical bytes and a new tag for changed bytes", async () => {
    const store = contractStore()
    const key = imageKey(["etag.png"])

    const first = await succeed(store.put({ key, bytes: bytes([7, 7]), contentType: "image/png" }))
    const repeat = await succeed(store.put({ key, bytes: bytes([7, 7]), contentType: "image/png" }))
    const changed = await succeed(
      store.put({ key, bytes: bytes([7, 8]), contentType: "image/png" }),
    )

    expect(repeat.etag).toBe(first.etag)
    expect(changed.etag).not.toBe(first.etag)
  })

  it("normalizes content type parameters and preserves the charset", async () => {
    const store = contractStore()
    const key = imageKey(["notes.txt"])

    const written = await succeed(
      store.put({ key, bytes: bytes([104, 105]), contentType: "TEXT/Plain; Charset=UTF-8" }),
    )

    expect(written.contentType).toBe("text/plain; charset=utf-8")
  })

  it("reports the configured policy for host diagnostics", () => {
    const description = contractStore().describe()

    expect(description.adapter).toBe("memory")
    expect(description.scopes.map((scope) => scope.scope)).toEqual(["contract", "contract-locked"])
    expect(description.scopes[0]?.signedUrl).toEqual({ defaultSeconds: 60, maximumSeconds: 600 })
  })

  it("refuses metadata that a backend could not carry", async () => {
    const store = contractStore()
    const key = imageKey(["metadata.png"])

    await expectFailure(
      store.put({
        key,
        bytes: bytes([1]),
        contentType: "image/png",
        metadata: { "Not Allowed": "value" },
      }),
      InvalidObjectRequestError,
    )
    await expectFailure(
      store.put({
        key,
        bytes: bytes([1]),
        contentType: "image/png",
        metadata: { note: "x".repeat(300) },
      }),
      InvalidObjectRequestError,
    )
  })

  it("refuses values that could split a header an adapter writes", async () => {
    const store = contractStore()
    const key = imageKey(["injection.png"])

    for (const note of ["line\r\nInjected: evil", "null\u0000byte", "bell\u0007"]) {
      await expectFailure(
        store.put({ key, bytes: bytes([1]), contentType: "image/png", metadata: { note } }),
        InvalidObjectRequestError,
      )
    }

    await expectFailure(
      store.put({
        key,
        bytes: bytes([1]),
        contentType: "image/png",
        precondition: { kind: "etag", etag: 'tag"\r\nInjected: evil' },
      }),
      InvalidObjectRequestError,
    )
    await expectFailure(
      store.delete(key, { precondition: { kind: "etag", etag: "tag\r\n" } }),
      InvalidObjectRequestError,
    )

    // Entity tags backends really issue stay usable.
    const written = await succeed(store.put({ key, bytes: bytes([1]), contentType: "image/png" }))
    await succeed(
      store.put({
        key,
        bytes: bytes([2]),
        contentType: "image/png",
        precondition: { kind: "etag", etag: written.etag },
      }),
    )
  })

  it("refuses adapter objects that omit a declared field", async () => {
    const adapter = createMemoryObjectStoreAdapter()
    const store = createObjectStore(
      {
        ...adapter,
        head: (canonicalKey: string) =>
          Effect.succeed({
            canonicalKey,
            contentType: "image/png",
            byteLength: 1,
            etag: "tag",
            lastModified: new Date(0).toISOString(),
            metadata: {},
          } as never),
      },
      { scopes: objectStoreContractScopes },
    )

    const result = await Effect.runPromise(Effect.either(store.head(imageKey(["partial.png"]))))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.code).toBe("object_storage_unavailable")
      expect(result.left.message).toContain("cache lifetime")
    }
  })

  it("refuses listing limits above the configured page size", async () => {
    const store = contractStore()

    await expectFailure(
      store.list({ teamId: "team-primary", scope: "contract" }, { limit: 1_000 }),
      InvalidObjectRequestError,
    )
  })

  it("refuses a delete precondition that cannot apply to a delete", async () => {
    const store = contractStore()

    await expectFailure(
      store.delete(imageKey(["precondition.png"]), { precondition: { kind: "absent" } }),
      InvalidObjectRequestError,
    )
  })

  it("signs downloads only for objects that exist", async () => {
    const store = contractStore()

    await expectFailure(store.createDownloadUrl(imageKey(["unsigned.png"])), ObjectNotFoundError)
  })

  it("rejects configurations that authors cannot have meant", () => {
    const adapter = createMemoryObjectStoreAdapter()

    expect(() => createObjectStore(adapter, { scopes: [] })).toThrow(/at least one/)
    expect(() =>
      createObjectStore(adapter, {
        scopes: [
          { scope: "media", allowedContentTypes: ["image/png"], maximumByteLength: 1 },
          { scope: "media", allowedContentTypes: ["image/png"], maximumByteLength: 1 },
        ],
      }),
    ).toThrow(/configured twice/)
    expect(() =>
      createObjectStore(adapter, {
        scopes: [{ scope: "media", allowedContentTypes: ["image/png"], maximumByteLength: 0 }],
      }),
    ).toThrow(/byte limit/)
    expect(() =>
      createObjectStore(adapter, {
        scopes: [{ scope: "media", allowedContentTypes: ["images"], maximumByteLength: 16 }],
      }),
    ).toThrow(/invalid content type/)
    expect(() =>
      createObjectStore(adapter, {
        scopes: [{ scope: "media/sub", allowedContentTypes: ["image/png"], maximumByteLength: 16 }],
      }),
    ).toThrow(/usable path segment/)
  })

  it("treats a broken adapter as a defect rather than a storage rule", async () => {
    const adapter = createMemoryObjectStoreAdapter()
    const store = createObjectStore(
      {
        ...adapter,
        get: () => Effect.fail(new TypeError("adapter bug") as never),
      },
      { scopes: objectStoreContractScopes },
    )

    const exit = await Effect.runPromiseExit(store.get(imageKey(["defect.png"])))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const defect = Cause.dieOption(exit.cause)

      expect(Option.isSome(defect)).toBe(true)
      expect(Option.getOrThrow(defect)).toBeInstanceOf(TypeError)
      expect(Cause.isFailType(exit.cause)).toBe(false)
    }
  })

  it("refuses adapter results that leave the requested key", async () => {
    const adapter = createMemoryObjectStoreAdapter()
    const store = createObjectStore(
      {
        ...adapter,
        head: () =>
          Effect.succeed({
            canonicalKey: "teams/other-team/contract/leaked.png",
            contentType: "image/png",
            byteLength: 1,
            etag: "tag",
            lastModified: new Date(0).toISOString(),
            cacheMaxAgeSeconds: null,
            metadata: {},
          }),
      },
      { scopes: objectStoreContractScopes },
    )

    const result = await Effect.runPromise(Effect.either(store.head(imageKey(["leaked.png"]))))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.code).toBe("object_storage_unavailable")
      expect(result.left.message).toContain("unrelated object")
    }
  })
})

function contractStore(): ObjectStore {
  return createObjectStore(createMemoryObjectStoreAdapter(), { scopes: objectStoreContractScopes })
}

function imageKey(path: readonly string[]): ObjectKey {
  return { teamId: "team-primary", scope: "contract", path }
}

function bytes(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values)
}

async function succeed<Value, Failure extends Error>(
  effect: Effect.Effect<Value, Failure>,
): Promise<Value> {
  const result = await Effect.runPromise(Effect.either(effect))

  if (Either.isLeft(result)) {
    throw result.left
  }

  return result.right
}

async function expectFailure<Failure extends Error, Expected extends Failure>(
  effect: Effect.Effect<unknown, Failure>,
  ErrorType: abstract new (...args: never[]) => Expected,
): Promise<void> {
  const result = await Effect.runPromise(Effect.either(effect))

  expect(Either.isLeft(result)).toBe(true)
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(ErrorType)
  }
}
