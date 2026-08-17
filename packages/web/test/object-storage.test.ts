import {
  createObjectStore,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  ObjectPreconditionFailedError,
  ObjectStorageUnavailableError,
  ObjectTooLargeError,
  type ObjectScopePolicy,
} from "@screeem/object-storage"
import { Effect, Either } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { createTeamObjectStore, objectStorageConfigured } from "../src/lib/storage/server"
import { createSupabaseObjectStoreAdapter } from "../src/lib/storage/supabase-object-store"

const bucketByteLimit = 1_000_000
const scopes: readonly ObjectScopePolicy[] = [
  {
    scope: "post-media",
    allowedContentTypes: ["image/png"],
    maximumByteLength: 4_096,
    signedUrl: { defaultSeconds: 60, maximumSeconds: 600 },
  },
]
const teamId = "5f2b8c1e-8a1d-4d3f-9a2b-0c7e6d5f4a3b"
const canonicalKey = `teams/${teamId}/post-media/cover.png`

describe("Supabase object store adapter", () => {
  let storage: FakeStorage

  beforeEach(() => {
    storage = createFakeStorage()
  })

  it("reports the metadata Supabase holds for an object", async () => {
    storage.objects.set(canonicalKey, {
      etag: '"abc123"',
      size: 12,
      contentType: "image/png",
      cacheControl: "max-age=3600",
      lastModified: "Tue, 17 Feb 2026 10:00:00 GMT",
      // The Supabase client camel cases response keys, including metadata names.
      metadata: { uploadedBy: "tester", "Not A Name": "dropped", count: 4 },
    })

    const object = await succeed(adapter().head(canonicalKey))

    expect(object).toEqual({
      canonicalKey,
      contentType: "image/png",
      byteLength: 12,
      etag: '"abc123"',
      cacheMaxAgeSeconds: 3600,
      lastModified: new Date("Tue, 17 Feb 2026 10:00:00 GMT").toISOString(),
      metadata: { uploaded_by: "tester" },
    })
  })

  it("maps Supabase refusals to storage failures", async () => {
    storage.error = { message: "Object not found", status: 404, statusCode: "404" }
    expect(await failure(adapter().head(canonicalKey))).toBeInstanceOf(ObjectNotFoundError)

    storage.error = { message: "The resource already exists", status: 409, statusCode: "409" }
    expect(await failure(adapter().head(canonicalKey))).toBeInstanceOf(ObjectAlreadyExistsError)

    storage.error = { message: "Internal server error", status: 500, statusCode: "500" }
    const unavailable = await failure(adapter().head(canonicalKey))
    expect(unavailable).toBeInstanceOf(ObjectStorageUnavailableError)
    expect(unavailable.message).not.toContain("Internal server error")
  })

  it("reports the bucket ceiling when Supabase rejects an oversized payload", async () => {
    storage.error = {
      message: "The object exceeded the maximum allowed size",
      status: 413,
      statusCode: "413",
    }

    const error = await failure(
      adapter().put({
        canonicalKey,
        bytes: new Uint8Array(2_048),
        contentType: "image/png",
        cacheMaxAgeSeconds: null,
        metadata: {},
        precondition: null,
      }),
    )

    expect(error).toBeInstanceOf(ObjectTooLargeError)
    expect((error as ObjectTooLargeError).byteLength).toBe(2_048)
    expect((error as ObjectTooLargeError).maximumByteLength).toBe(bucketByteLimit)
  })

  it("checks an entity tag before writing and leaves the object untouched on a mismatch", async () => {
    storage.objects.set(canonicalKey, { etag: '"current"', size: 3, contentType: "image/png" })

    const error = await failure(
      adapter().put({
        canonicalKey,
        bytes: Uint8Array.from([1, 2, 3]),
        contentType: "image/png",
        cacheMaxAgeSeconds: null,
        metadata: {},
        precondition: { kind: "etag", etag: '"stale"' },
      }),
    )

    expect(error).toBeInstanceOf(ObjectPreconditionFailedError)
    expect((error as ObjectPreconditionFailedError).actualEtag).toBe('"current"')
    expect(storage.uploads).toEqual([])
  })

  it("requests a first writer wins upload only when the caller asked for one", async () => {
    await succeed(
      adapter().put({
        canonicalKey,
        bytes: Uint8Array.from([1]),
        contentType: "image/png",
        cacheMaxAgeSeconds: 60,
        metadata: { note: "first" },
        precondition: { kind: "absent" },
      }),
    )
    expect(storage.uploads[0]?.options.upsert).toBe(false)
    expect(storage.uploads[0]?.options.cacheControl).toBe("60")

    await succeed(
      adapter().put({
        canonicalKey,
        bytes: Uint8Array.from([1]),
        contentType: "image/png",
        cacheMaxAgeSeconds: null,
        metadata: {},
        precondition: null,
      }),
    )
    expect(storage.uploads[1]?.options.upsert).toBe(true)
    expect(storage.uploads[1]?.options.cacheControl).toBeUndefined()
  })

  it("prefers the downloaded length over stored metadata", async () => {
    storage.objects.set(canonicalKey, { etag: '"abc"', size: 99, contentType: "image/png" })
    storage.bytes.set(canonicalKey, Uint8Array.from([9, 9, 9]))

    const stored = await succeed(adapter().get(canonicalKey))

    expect([...stored.bytes]).toEqual([9, 9, 9])
    expect(stored.object.byteLength).toBe(3)
  })

  it("reports a missing object when nothing was removed", async () => {
    storage.objects.set(canonicalKey, { etag: '"abc"', size: 1, contentType: "image/png" })
    storage.removed = []

    expect(await failure(adapter().delete(canonicalKey, null))).toBeInstanceOf(ObjectNotFoundError)
  })

  it("maps a listing page and carries the cursor only while more remain", async () => {
    storage.list = {
      hasNext: true,
      nextCursor: "cursor-2",
      folders: [{ key: `teams/${teamId}/post-media/2026/`, name: "2026" }],
      objects: [
        {
          id: "object-id",
          key: canonicalKey,
          name: "cover.png",
          updated_at: "2026-02-17T10:00:00.000Z",
          created_at: "2026-02-16T10:00:00.000Z",
          metadata: {
            eTag: '"listed"',
            size: 12,
            mimetype: "image/png",
            cacheControl: "max-age=1",
          },
        },
      ],
    }

    const page = await succeed(
      adapter().list({
        canonicalPrefix: `teams/${teamId}/post-media/`,
        limit: 10,
        cursor: null,
      }),
    )

    expect(page.cursor).toBe("cursor-2")
    expect(page.objects).toEqual([
      {
        canonicalKey,
        contentType: "image/png",
        byteLength: 12,
        etag: '"listed"',
        cacheMaxAgeSeconds: 1,
        lastModified: "2026-02-17T10:00:00.000Z",
        metadata: {},
      },
    ])

    storage.list = { ...storage.list, hasNext: false }
    expect(
      (
        await succeed(
          adapter().list({
            canonicalPrefix: `teams/${teamId}/post-media/`,
            limit: 10,
            cursor: null,
          }),
        )
      ).cursor,
    ).toBeNull()
  })

  it("resolves listed keys whether Supabase reports a full path or a relative name", async () => {
    const page = (name: string) => ({
      hasNext: false,
      folders: [],
      objects: [
        {
          id: "object-id",
          name,
          updated_at: "2026-02-17T10:00:00.000Z",
          created_at: "2026-02-16T10:00:00.000Z",
          metadata: { eTag: '"listed"', size: 1, mimetype: "image/png" },
        },
      ],
    })
    const listPrefix = {
      canonicalPrefix: `teams/${teamId}/post-media/`,
      limit: 10,
      cursor: null,
    }

    storage.list = page(canonicalKey)
    const full = await succeed(adapter().list(listPrefix))
    expect(full.objects[0]?.canonicalKey).toBe(canonicalKey)

    storage.list = page("cover.png")
    const relative = await succeed(adapter().list(listPrefix))
    expect(relative.objects[0]?.canonicalKey).toBe(canonicalKey)
  })

  it("reports the real lifetime of an upload signature", async () => {
    const expiry = Math.floor(Date.parse("2026-02-17T12:00:00.000Z") / 1_000)
    storage.uploadToken = jwt({ exp: expiry })

    const upload = await succeed(
      adapter().createUploadUrl({
        canonicalKey,
        contentType: "image/png",
        expiresInSeconds: 60,
        maximumByteLength: 4_096,
      }),
    )

    expect(upload.expiresAt).toBe("2026-02-17T12:00:00.000Z")
    expect(upload.method).toBe("PUT")
    expect(upload.headers["content-type"]).toBe("image/png")
  })

  it("falls back to the documented upload lifetime when the signature cannot be read", async () => {
    storage.uploadToken = "not-a-token"

    const upload = await succeed(
      adapter().createUploadUrl({
        canonicalKey,
        contentType: "image/png",
        expiresInSeconds: 60,
        maximumByteLength: 4_096,
      }),
    )

    expect(Date.parse(upload.expiresAt)).toBeGreaterThan(Date.now())
  })

  it("passes the requested download expiry and file name to Supabase", async () => {
    storage.objects.set(canonicalKey, { etag: '"abc"', size: 1, contentType: "image/png" })

    await succeed(
      adapter().createDownloadUrl({
        canonicalKey,
        expiresInSeconds: 120,
        downloadFileName: "cover.png",
      }),
    )

    expect(storage.signedDownloads[0]).toEqual({
      path: canonicalKey,
      expiresIn: 120,
      options: { download: "cover.png" },
    })
  })

  it("enforces the scope policy before Supabase is contacted", async () => {
    const store = createObjectStore(adapter(), { scopes })
    const key = { teamId, scope: "post-media", path: ["cover.png"] }

    const rejected = await Effect.runPromise(
      Effect.either(
        store.put({ key, bytes: new Uint8Array(8_192), contentType: "image/png" }),
      ),
    )

    expect(Either.isLeft(rejected)).toBe(true)
    expect(storage.uploads).toEqual([])

    storage.objects.set(canonicalKey, { etag: '"abc"', size: 1, contentType: "image/png" })
    const head = await succeed(store.head(key))
    expect(head.key).toEqual(key)
    expect(head.canonicalKey).toBe(canonicalKey)
  })

  function adapter() {
    return createSupabaseObjectStoreAdapter({
      client: { storage: { from: () => storage.api } } as never,
      bucket: "team-objects",
      bucketByteLimit,
    })
  }
})

interface FakeObject {
  readonly etag: string
  readonly size: number
  readonly contentType: string
  readonly cacheControl?: string
  readonly lastModified?: string
  readonly metadata?: Record<string, unknown>
}

interface FakeListPage {
  hasNext: boolean
  nextCursor?: string
  folders: { key?: string; name: string }[]
  objects: {
    id: string
    key?: string
    name: string
    updated_at: string
    created_at: string
    metadata: Record<string, unknown>
  }[]
}

interface FakeStorage {
  objects: Map<string, FakeObject>
  bytes: Map<string, Uint8Array>
  uploads: { path: string; options: Record<string, unknown> }[]
  signedDownloads: { path: string; expiresIn: number; options: unknown }[]
  removed: unknown[] | null
  list: FakeListPage
  uploadToken: string
  error: { message: string; status?: number; statusCode?: string } | null
  api: Record<string, (...args: never[]) => unknown>
}

function createFakeStorage(): FakeStorage {
  const state: FakeStorage = {
    objects: new Map(),
    bytes: new Map(),
    uploads: [],
    signedDownloads: [],
    removed: null,
    list: { hasNext: false, folders: [], objects: [] },
    uploadToken: jwt({ exp: Math.floor(Date.now() / 1_000) + 7_200 }),
    error: null,
    api: {},
  }

  const fail = () => ({ data: null, error: state.error })

  state.api = {
    info: ((path: string) => {
      if (state.error) return Promise.resolve(fail())

      const object = state.objects.get(path)

      if (!object) {
        return Promise.resolve({
          data: null,
          error: { message: "Object not found", status: 404, statusCode: "404" },
        })
      }

      return Promise.resolve({
        data: {
          id: path,
          version: "version-1",
          name: path,
          bucketId: "team-objects",
          updatedAt: "2026-02-17T10:00:00.000Z",
          createdAt: "2026-02-16T10:00:00.000Z",
          size: object.size,
          contentType: object.contentType,
          etag: object.etag,
          ...(object.cacheControl === undefined ? {} : { cacheControl: object.cacheControl }),
          ...(object.lastModified === undefined ? {} : { lastModified: object.lastModified }),
          metadata: object.metadata ?? {},
        },
        error: null,
      })
    }) as never,

    upload: ((path: string, body: Uint8Array, options: Record<string, unknown>) => {
      if (state.error) return Promise.resolve(fail())

      state.uploads.push({ path, options })
      state.bytes.set(path, body)
      state.objects.set(path, {
        etag: `"upload-${state.uploads.length}"`,
        size: body.byteLength,
        contentType: String(options.contentType),
        ...(typeof options.cacheControl === "string"
          ? { cacheControl: options.cacheControl }
          : {}),
        metadata: (options.metadata as Record<string, unknown> | undefined) ?? {},
      })

      return Promise.resolve({ data: { id: path, path, fullPath: path }, error: null })
    }) as never,

    download: ((path: string) => {
      if (state.error) return Promise.resolve(fail())

      const bytes = state.bytes.get(path)

      return Promise.resolve(
        bytes
          ? // Copied into a fresh array so the part is backed by a plain
            // ArrayBuffer, which is what BlobPart accepts, and so the fake hands
            // back an independent buffer the way a real download does.
            { data: new Blob([new Uint8Array(bytes)]), error: null }
          : { data: null, error: { message: "Object not found", status: 404, statusCode: "404" } },
      )
    }) as never,

    remove: ((paths: string[]) => {
      if (state.error) return Promise.resolve(fail())

      const removed = state.removed ?? paths.map((path) => ({ name: path }))
      for (const path of paths) {
        state.objects.delete(path)
        state.bytes.delete(path)
      }

      return Promise.resolve({ data: removed, error: null })
    }) as never,

    listV2: (() =>
      state.error ? Promise.resolve(fail()) : Promise.resolve({ data: state.list, error: null })) as never,

    createSignedUploadUrl: ((path: string) =>
      state.error
        ? Promise.resolve(fail())
        : Promise.resolve({
            data: {
              signedUrl: `https://storage.invalid/object/upload/sign/${path}?token=${state.uploadToken}`,
              token: state.uploadToken,
              path,
            },
            error: null,
          })) as never,

    createSignedUrl: ((path: string, expiresIn: number, options: unknown) => {
      if (state.error) return Promise.resolve(fail())

      state.signedDownloads.push({ path, expiresIn, options })

      return Promise.resolve({
        data: { signedUrl: `https://storage.invalid/object/sign/${path}?token=signed` },
        error: null,
      })
    }) as never,
  }

  return state
}

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")
  return `header.${payload}.signature`
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

async function failure<Failure extends Error>(
  effect: Effect.Effect<unknown, Failure>,
): Promise<Failure> {
  const result = await Effect.runPromise(Effect.either(effect))

  if (Either.isRight(result)) {
    throw new Error("Expected the operation to fail")
  }

  return result.left
}

describe("object storage host wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses to run without a bucket in production", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    vi.stubEnv("NODE_ENV", "production")

    expect(objectStorageConfigured()).toBe(false)
    expect(() => createTeamObjectStore(scopes)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it("announces the in-process fallback outside production", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    vi.stubEnv("NODE_ENV", "test")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const store = createTeamObjectStore(scopes)

    expect(store.describe().adapter).toBe("memory")
    expect(warn).toHaveBeenCalledWith(
      "Object storage has no bucket configured; using in-process storage",
    )
    warn.mockRestore()
  })

  it("uses Supabase Storage once credentials are present", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")

    expect(objectStorageConfigured()).toBe(true)
    expect(createTeamObjectStore(scopes).describe().adapter).toBe("supabase-storage")
  })
})
