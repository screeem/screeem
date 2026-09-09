import { Effect, Either } from "effect"

import {
  InvalidObjectKeyError,
  InvalidObjectRequestError,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  ObjectPreconditionFailedError,
  ObjectStorageError,
  ObjectTooLargeError,
  UnsupportedContentTypeError,
} from "./errors.js"
import type { ObjectKey } from "./keys.js"
import type { ObjectScopePolicy } from "./model.js"
import type { ObjectStore } from "./store.js"

type Awaitable<T> = T | Promise<T>

/**
 * Scopes every adapter fixture configures, so the memory adapter and any
 * hosted backend are exercised against identical policy.
 */
export const objectStoreContractScopes: readonly ObjectScopePolicy[] = Object.freeze([
  Object.freeze({
    scope: "contract",
    allowedContentTypes: Object.freeze(["image/png", "text/plain"]),
    maximumByteLength: 4_096,
    signedUrl: Object.freeze({ defaultSeconds: 60, maximumSeconds: 600 }),
  }),
  Object.freeze({
    scope: "contract-locked",
    allowedContentTypes: Object.freeze(["application/pdf"]),
    maximumByteLength: 1_024,
    allowPut: false,
    allowDelete: false,
  }),
]) as readonly ObjectScopePolicy[]

export interface ObjectStoreContractFixture {
  readonly store: ObjectStore
  /**
   * Two team identifiers the fixture may write under. Backends enforcing row
   * level security supply real teams; in-process adapters may use any segment.
   */
  readonly teams: { readonly primary: string; readonly secondary: string }
  readonly dispose?: () => Awaitable<void>
}

export type ObjectStoreContractFactory = () => Awaitable<ObjectStoreContractFixture>

export interface StoreContractCase {
  readonly name: string
  readonly run: () => Promise<void>
}

/**
 * Framework-agnostic contract cases for every ObjectStore adapter. Test
 * frameworks register each case separately so failures name one behaviour.
 */
export function objectStoreContractCases(
  factory: ObjectStoreContractFactory,
): readonly StoreContractCase[] {
  return Object.freeze([
    contractCase("refuses keys and scopes it cannot represent safely", factory, async (context) => {
      await assertFails(
        context.store.put(request(context.key(["..", "escape.png"]))),
        InvalidObjectKeyError,
      )
      await assertFails(
        context.store.put(request({ ...context.key(["object.png"]), scope: "unregistered" })),
        InvalidObjectRequestError,
      )
      await assertFails(
        context.store.head({ teamId: context.teams.primary, scope: "contract", path: [] }),
        InvalidObjectKeyError,
      )
      await assertFails(
        context.store.head({ teamId: context.teams.primary, scope: "contract", path: ["a/b"] }),
        InvalidObjectKeyError,
      )
    }),

    contractCase("stores bytes and reports them unchanged", factory, async (context) => {
      const key = context.key(["stored.png"])
      const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
      const written = await run(
        context.store.put({
          key,
          bytes,
          contentType: "image/png",
          cacheMaxAgeSeconds: 60,
          metadata: { uploaded_by: "contract" },
        }),
      )

      assertEqual(written.canonicalKey, context.canonical(key), "written canonical key")
      assertEqual(written.byteLength, bytes.byteLength, "written byte length")
      assertEqual(written.contentType, "image/png", "written content type")
      assertEqual(written.metadata.uploaded_by, "contract", "written metadata")
      assertEqual(written.cacheMaxAgeSeconds, 60, "written cache lifetime")
      assert(written.etag.length > 0, "a write reports an entity tag")

      const read = await run(context.store.get(key))
      assertEqual(read.bytes.byteLength, bytes.byteLength, "read byte length")
      assert(
        bytes.every((byte, index) => read.bytes[index] === byte),
        "read bytes match the written bytes",
      )
      assertEqual(read.metadata.etag, written.etag, "read entity tag")

      const head = await run(context.store.head(key))
      assertEqual(head.etag, written.etag, "head entity tag")
      assertEqual(head.byteLength, bytes.byteLength, "head byte length")
    }),

    contractCase("reports missing objects instead of empty results", factory, async (context) => {
      const key = context.key(["absent.png"])

      await assertFails(context.store.get(key), ObjectNotFoundError)
      await assertFails(context.store.head(key), ObjectNotFoundError)
      await assertFails(context.store.delete(key), ObjectNotFoundError)
    }),

    contractCase("keeps first writer wins available", factory, async (context) => {
      const key = context.key(["exclusive.png"])
      await run(context.store.put({ ...request(key), precondition: { kind: "absent" } }))

      await assertFails(
        context.store.put({ ...request(key), precondition: { kind: "absent" } }),
        ObjectAlreadyExistsError,
      )
    }),

    contractCase("guards read modify write with entity tags", factory, async (context) => {
      const key = context.key(["guarded.png"])
      const first = await run(context.store.put(request(key, [1, 2, 3])))

      await assertFails(
        context.store.put({
          ...request(key, [4, 5, 6]),
          precondition: { kind: "etag", etag: "not-the-stored-tag" },
        }),
        ObjectPreconditionFailedError,
      )

      const second = await run(
        context.store.put({
          ...request(key, [4, 5, 6]),
          precondition: { kind: "etag", etag: first.etag },
        }),
      )
      assertEqual(second.byteLength, 3, "second write byte length")

      const stale = await assertFails(
        context.store.delete(key, { precondition: { kind: "etag", etag: first.etag } }),
        ObjectPreconditionFailedError,
      )
      assertEqual(stale.expectedEtag, first.etag, "stale precondition tag")

      await run(context.store.delete(key, { precondition: { kind: "etag", etag: second.etag } }))
      await assertFails(context.store.head(key), ObjectNotFoundError)
    }),

    contractCase("lists only the objects inside one team scope", factory, async (context) => {
      const listed = context.key(["listing", "inside.png"])
      const sibling = context.key(["other", "outside.png"])
      const otherTeam: ObjectKey = {
        teamId: context.teams.secondary,
        scope: "contract",
        path: [context.prefix, "listing", "inside.png"],
      }

      await run(context.store.put(request(listed)))
      await run(context.store.put(request(sibling)))
      await run(context.store.put(request(otherTeam)))
      context.track(otherTeam)

      const page = await run(
        context.store.list({
          teamId: context.teams.primary,
          scope: "contract",
          path: [context.prefix, "listing"],
        }),
      )
      const keys = page.objects.map((object) => object.canonicalKey)

      assertEqual(keys.length, 1, "objects under the listed prefix")
      assertEqual(keys[0], context.canonical(listed), "listed canonical key")
      assertEqual(page.cursor, null, "cursor for a complete listing")
    }),

    contractCase("paginates listings with an opaque cursor", factory, async (context) => {
      const keys = ["page-a.png", "page-b.png", "page-c.png"].map((name) =>
        context.key(["paged", name]),
      )
      for (const key of keys) {
        await run(context.store.put(request(key)))
      }

      const prefix = {
        teamId: context.teams.primary,
        scope: "contract",
        path: [context.prefix, "paged"],
      }
      const first = await run(context.store.list(prefix, { limit: 2 }))
      assertEqual(first.objects.length, 2, "first page size")
      assert(first.cursor !== null, "a partial listing reports a cursor")

      const second = await run(context.store.list(prefix, { limit: 2, cursor: first.cursor ?? "" }))
      const seen = [...first.objects, ...second.objects].map((object) => object.canonicalKey)

      assertEqual(seen.length, 3, "objects across both pages")
      assertEqual(new Set(seen).size, 3, "distinct objects across both pages")
      assertEqual(second.cursor, null, "cursor after the final page")
    }),

    contractCase("refuses payloads the scope does not accept", factory, async (context) => {
      const key = context.key(["rejected.png"])

      await assertFails(
        context.store.put({ ...request(key), contentType: "application/zip" }),
        UnsupportedContentTypeError,
      )
      await assertFails(
        context.store.put({
          key,
          bytes: new Uint8Array(8_192),
          contentType: "image/png",
        }),
        ObjectTooLargeError,
      )
      await assertFails(
        context.store.put({ ...request(key), contentType: "not-a-media-type" }),
        InvalidObjectRequestError,
      )
    }),

    contractCase("issues signed URLs inside the scope expiry", factory, async (context) => {
      const key = context.key(["signed.png"])
      const upload = await run(
        context.store.createUploadUrl({ key, contentType: "image/png", expiresInSeconds: 120 }),
      )

      assert(upload.url.startsWith("http"), "an upload URL is absolute")
      assert(Date.parse(upload.expiresAt) > 0, "an upload URL reports an expiry")
      assertEqual(upload.maximumByteLength, 4_096, "upload byte ceiling")

      await assertFails(
        context.store.createUploadUrl({
          key,
          contentType: "image/png",
          expiresInSeconds: 6_000,
        }),
        InvalidObjectRequestError,
      )
      await assertFails(
        context.store.createUploadUrl({ key, contentType: "image/png", overwrite: true }),
        InvalidObjectRequestError,
      )

      await run(context.store.put(request(key)))
      const download = await run(context.store.createDownloadUrl(key, { expiresInSeconds: 60 }))
      assert(download.url.startsWith("http"), "a download URL is absolute")
      assert(Date.parse(download.expiresAt) > 0, "a download URL reports an expiry")

      await assertFails(
        context.store.createDownloadUrl(key, { downloadFileName: 'report";.png' }),
        InvalidObjectRequestError,
      )
    }),
  ])
}

interface ContractContext {
  readonly store: ObjectStore
  readonly teams: ObjectStoreContractFixture["teams"]
  /** Unique per case, so cases stay isolated on a shared backend. */
  readonly prefix: string
  key(path: readonly string[]): ObjectKey
  canonical(key: ObjectKey): string
  track(key: ObjectKey): void
}

function contractCase(
  name: string,
  factory: ObjectStoreContractFactory,
  exercise: (context: ContractContext) => Promise<void>,
): StoreContractCase {
  return Object.freeze({
    name,
    run: async () => {
      const fixture = await factory()
      const prefix = `case-${name.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 96)
      const written: ObjectKey[] = []
      const context: ContractContext = {
        store: fixture.store,
        teams: fixture.teams,
        prefix,
        key: (path) => {
          const key: ObjectKey = {
            teamId: fixture.teams.primary,
            scope: "contract",
            path: [prefix, ...path],
          }
          written.push(key)
          return key
        },
        canonical: (key) => `teams/${key.teamId}/${key.scope}/${key.path.join("/")}`,
        track: (key) => written.push(key),
      }

      try {
        await exercise(context)
      } finally {
        for (const key of written) {
          await Effect.runPromise(Effect.ignore(fixture.store.delete(key)))
        }
        await fixture.dispose?.()
      }
    },
  })
}

function request(
  key: ObjectKey,
  bytes: readonly number[] = [1, 2, 3, 4],
): {
  readonly key: ObjectKey
  readonly bytes: Uint8Array
  readonly contentType: string
} {
  return { key, bytes: Uint8Array.from(bytes), contentType: "image/png" }
}

async function run<Value>(effect: Effect.Effect<Value, ObjectStorageError>): Promise<Value> {
  const result = await Effect.runPromise(Effect.either(effect))

  if (Either.isLeft(result)) {
    throw new Error(`Expected success, received ${result.left.code}: ${result.left.message}`, {
      cause: result.left,
    })
  }

  return result.right
}

async function assertFails<T extends ObjectStorageError>(
  effect: Effect.Effect<unknown, ObjectStorageError>,
  ErrorType: abstract new (...args: never[]) => T,
): Promise<T> {
  const result = await Effect.runPromise(Effect.either(effect))

  if (Either.isLeft(result)) {
    if (result.left instanceof ErrorType) return result.left
    throw new Error(`Expected ${ErrorType.name}, received ${String(result.left)}`, {
      cause: result.left,
    })
  }

  throw new Error(`Expected ${ErrorType.name}, received a successful result`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`)
  }
}
