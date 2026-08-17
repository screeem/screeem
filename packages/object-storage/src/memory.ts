import { Effect } from "effect"

import type {
  AdapterListRequest,
  AdapterObject,
  AdapterPage,
  AdapterPutRequest,
  AdapterSignedDownload,
  AdapterSignedDownloadRequest,
  AdapterSignedUpload,
  AdapterSignedUploadRequest,
  AdapterStoredObject,
  ObjectStoreAdapter,
} from "./adapter.js"
import {
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  ObjectPreconditionFailedError,
  isObjectStoreFailure,
  type ObjectStoreFailure,
} from "./errors.js"
import type { ObjectPrecondition } from "./model.js"

export interface MemoryObjectStoreOptions {
  /** Base URL used to fabricate signed URLs. It is never contacted. */
  readonly signedUrlBaseUrl?: string
  /** Injectable clock so tests can assert timestamps without waiting. */
  readonly now?: () => Date
}

export interface MemoryObjectStoreAdapter extends ObjectStoreAdapter {
  /** Canonical keys currently held, in sorted order, for test assertions. */
  keys(): readonly string[]
  clear(): void
}

const defaultSignedUrlBaseUrl = "https://memory.object-storage.invalid"

interface MemoryEntry {
  readonly canonicalKey: string
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly etag: string
  readonly lastModified: string
  readonly cacheMaxAgeSeconds: number | null
  readonly metadata: Readonly<Record<string, string>>
}

/**
 * In-process backend for tests, the development playground, and any host that
 * has no bucket configured yet. It owns its copy of every payload, so callers
 * cannot mutate stored bytes after writing them.
 */
export function createMemoryObjectStoreAdapter(
  options: MemoryObjectStoreOptions = {},
): MemoryObjectStoreAdapter {
  const entries = new Map<string, MemoryEntry>()
  const baseUrl = (options.signedUrlBaseUrl ?? defaultSignedUrlBaseUrl).replace(/\/+$/, "")
  const now = options.now ?? (() => new Date())

  const requireEntry = (canonicalKey: string): MemoryEntry => {
    const entry = entries.get(canonicalKey)

    if (!entry) {
      throw new ObjectNotFoundError(canonicalKey)
    }

    return entry
  }

  const checkPrecondition = (
    canonicalKey: string,
    precondition: ObjectPrecondition | null,
  ): void => {
    if (precondition === null) {
      return
    }

    const existing = entries.get(canonicalKey)

    if (precondition.kind === "absent") {
      if (existing) {
        throw new ObjectAlreadyExistsError(canonicalKey)
      }

      return
    }

    if (!existing || existing.etag !== precondition.etag) {
      throw new ObjectPreconditionFailedError(
        canonicalKey,
        precondition.etag,
        existing?.etag ?? null,
      )
    }
  }

  const expiry = (expiresInSeconds: number): string =>
    new Date(now().getTime() + expiresInSeconds * 1_000).toISOString()

  const adapter: MemoryObjectStoreAdapter = {
    name: "memory",

    put: (request: AdapterPutRequest): Effect.Effect<AdapterObject, ObjectStoreFailure> =>
      attempt(() => {
        checkPrecondition(request.canonicalKey, request.precondition)

        const bytes = Uint8Array.from(request.bytes)
        const entry: MemoryEntry = Object.freeze({
          canonicalKey: request.canonicalKey,
          bytes,
          contentType: request.contentType,
          etag: entityTag(bytes, request.contentType),
          lastModified: now().toISOString(),
          cacheMaxAgeSeconds: request.cacheMaxAgeSeconds,
          metadata: Object.freeze({ ...request.metadata }),
        })

        entries.set(request.canonicalKey, entry)
        return describeEntry(entry)
      }),

    get: (canonicalKey: string): Effect.Effect<AdapterStoredObject, ObjectStoreFailure> =>
      attempt(() => {
        const entry = requireEntry(canonicalKey)
        return Object.freeze({
          object: describeEntry(entry),
          bytes: Uint8Array.from(entry.bytes),
        })
      }),

    head: (canonicalKey: string): Effect.Effect<AdapterObject, ObjectStoreFailure> =>
      attempt(() => describeEntry(requireEntry(canonicalKey))),

    delete: (
      canonicalKey: string,
      precondition: ObjectPrecondition | null,
    ): Effect.Effect<void, ObjectStoreFailure> =>
      attempt(() => {
        requireEntry(canonicalKey)
        checkPrecondition(canonicalKey, precondition)
        entries.delete(canonicalKey)
      }),

    list: (request: AdapterListRequest): Effect.Effect<AdapterPage, ObjectStoreFailure> =>
      attempt(() => {
        const matching = [...entries.values()]
          .filter((entry) => entry.canonicalKey.startsWith(request.canonicalPrefix))
          .filter((entry) => request.cursor === null || entry.canonicalKey > request.cursor)
          .sort((left, right) => (left.canonicalKey < right.canonicalKey ? -1 : 1))
        const page = matching.slice(0, request.limit)
        const last = page[page.length - 1]

        return Object.freeze({
          objects: Object.freeze(page.map(describeEntry)),
          cursor: last && matching.length > page.length ? last.canonicalKey : null,
        })
      }),

    createUploadUrl: (
      request: AdapterSignedUploadRequest,
    ): Effect.Effect<AdapterSignedUpload, ObjectStoreFailure> =>
      attempt(() =>
        Object.freeze({
          url: `${baseUrl}/${request.canonicalKey}?upload=1`,
          method: "PUT" as const,
          headers: Object.freeze({ content_type: request.contentType }),
          expiresAt: expiry(request.expiresInSeconds),
        }),
      ),

    createDownloadUrl: (
      request: AdapterSignedDownloadRequest,
    ): Effect.Effect<AdapterSignedDownload, ObjectStoreFailure> =>
      attempt(() => {
        requireEntry(request.canonicalKey)
        return Object.freeze({
          url: `${baseUrl}/${request.canonicalKey}?download=1`,
          expiresAt: expiry(request.expiresInSeconds),
        })
      }),

    keys: () => Object.freeze([...entries.keys()].sort()),
    clear: () => entries.clear(),
  }

  return Object.freeze(adapter)
}

function attempt<Value>(operation: () => Value): Effect.Effect<Value, ObjectStoreFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(operation())
    } catch (error) {
      return isObjectStoreFailure(error) ? Effect.fail(error) : Effect.die(error)
    }
  })
}

function describeEntry(entry: MemoryEntry): AdapterObject {
  return Object.freeze({
    canonicalKey: entry.canonicalKey,
    contentType: entry.contentType,
    byteLength: entry.bytes.byteLength,
    etag: entry.etag,
    lastModified: entry.lastModified,
    cacheMaxAgeSeconds: entry.cacheMaxAgeSeconds,
    metadata: entry.metadata,
  })
}

/**
 * Content derived tag, so rewriting identical bytes keeps the same tag and
 * preconditions behave the way callers expect from a real backend.
 */
function entityTag(bytes: Uint8Array, contentType: string): string {
  const low = hashBytes(bytes, hashString(contentType, 0x811c9dc5))
  const high = hashBytes(bytes, hashString(contentType, 0x9e3779b1))
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}-${bytes.byteLength.toString(16)}`
}

function hashBytes(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  }

  return hash
}

function hashString(text: string, seed: number): number {
  let hash = seed >>> 0

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0
  }

  return hash
}
