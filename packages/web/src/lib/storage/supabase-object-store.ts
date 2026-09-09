import "server-only"

import {
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  ObjectPreconditionFailedError,
  ObjectStorageUnavailableError,
  ObjectTooLargeError,
  type AdapterListRequest,
  type AdapterObject,
  type AdapterPage,
  type AdapterPutRequest,
  type AdapterSignedDownload,
  type AdapterSignedDownloadRequest,
  type AdapterSignedUpload,
  type AdapterSignedUploadRequest,
  type AdapterStoredObject,
  type ObjectPrecondition,
  type ObjectStoreAdapter,
  type ObjectStoreFailure,
} from "@screeem/object-storage"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Effect } from "effect"

export interface SupabaseObjectStoreOptions {
  readonly client: SupabaseClient
  readonly bucket: string
  /**
   * The bucket file size limit, reported when Supabase rejects a payload the
   * scope policy allowed. Keep it aligned with the bucket configuration.
   */
  readonly bucketByteLimit?: number
}

/** Supabase issues upload signatures with a fixed lifetime that callers cannot choose. */
const supabaseUploadUrlSeconds = 2 * 60 * 60
const defaultBucketByteLimit = 50 * 1024 * 1024
/** Mirrors the metadata name rule the port enforces. */
const portMetadataName = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/

interface SupabaseResult<Value> {
  readonly data: Value | null
  readonly error: { readonly message: string; readonly status?: number; readonly statusCode?: string } | null
}

/**
 * Supabase Storage backend for the object storage port. Canonical keys are used
 * as bucket paths unchanged, so `teams/<team>/<scope>/...` prefixes stay
 * readable in Studio and usable by row level security policies.
 *
 * Four Supabase behaviours differ from the port's contract and are handled
 * explicitly rather than hidden:
 *
 * - Entity tag preconditions are compared before the write, because Storage has
 *   no conditional write. The check narrows the race but does not remove it, so
 *   it is not a substitute for a database transaction on contended keys.
 * - Upload signature lifetime is fixed by Storage. The requested expiry is not
 *   sent; the reported expiry is read from the signature itself.
 * - Cache lifetime is sent as a max-age count, which is what Storage expects,
 *   and parsed back out of the directive Storage stores.
 * - The Supabase client camel cases response keys, including the metadata names
 *   a caller wrote, so names are mapped back on read.
 */
export function createSupabaseObjectStoreAdapter(
  options: SupabaseObjectStoreOptions,
): ObjectStoreAdapter {
  const bucketByteLimit = options.bucketByteLimit ?? defaultBucketByteLimit
  const files = () => options.client.storage.from(options.bucket)

  const currentEtag = (canonicalKey: string): Effect.Effect<string | null, ObjectStoreFailure> =>
    request(
      () => files().info(canonicalKey),
      canonicalKey,
      bucketByteLimit,
      0,
    ).pipe(
      Effect.map((info) => readString(info.etag) ?? readString(info.version)),
      Effect.catchIf(
        (error): error is ObjectNotFoundError => error instanceof ObjectNotFoundError,
        () => Effect.succeed(null),
      ),
    )

  const requirePrecondition = (
    canonicalKey: string,
    precondition: ObjectPrecondition | null,
  ): Effect.Effect<void, ObjectStoreFailure> => {
    if (precondition === null || precondition.kind === "absent") {
      return Effect.void
    }

    return currentEtag(canonicalKey).pipe(
      Effect.flatMap((etag) =>
        etag === precondition.etag
          ? Effect.void
          : Effect.fail(new ObjectPreconditionFailedError(canonicalKey, precondition.etag, etag)),
      ),
    )
  }

  const adapter: ObjectStoreAdapter = {
    name: "supabase-storage",

    put: (put: AdapterPutRequest): Effect.Effect<AdapterObject, ObjectStoreFailure> =>
      requirePrecondition(put.canonicalKey, put.precondition).pipe(
        Effect.flatMap(() =>
          request(
            () =>
              files().upload(put.canonicalKey, put.bytes, {
                contentType: put.contentType,
                upsert: put.precondition?.kind !== "absent",
                // Storage expects a max-age count, not a directive, and renders
                // the header itself.
                ...(put.cacheMaxAgeSeconds === null
                  ? {}
                  : { cacheControl: String(put.cacheMaxAgeSeconds) }),
                metadata: { ...put.metadata },
              }),
            put.canonicalKey,
            bucketByteLimit,
            put.bytes.byteLength,
          ),
        ),
        Effect.flatMap(() => adapter.head(put.canonicalKey)),
      ),

    get: (canonicalKey: string): Effect.Effect<AdapterStoredObject, ObjectStoreFailure> =>
      adapter.head(canonicalKey).pipe(
        Effect.flatMap((object) =>
          request(
            () => files().download(canonicalKey),
            canonicalKey,
            bucketByteLimit,
            0,
          ).pipe(
            Effect.flatMap((blob) =>
              Effect.tryPromise({
                try: async () => new Uint8Array(await blob.arrayBuffer()),
                catch: (cause) =>
                  new ObjectStorageUnavailableError(
                    `Could not read the downloaded object ${canonicalKey}`,
                    cause,
                  ),
              }),
            ),
            // The downloaded payload is authoritative for length, so a stale
            // size in object metadata cannot fail an otherwise good read.
            Effect.map((bytes) => ({ object: { ...object, byteLength: bytes.byteLength }, bytes })),
          ),
        ),
      ),

    head: (canonicalKey: string): Effect.Effect<AdapterObject, ObjectStoreFailure> =>
      request(() => files().info(canonicalKey), canonicalKey, bucketByteLimit, 0).pipe(
        Effect.flatMap((info) => {
          const etag = readString(info.etag) ?? readString(info.version)

          if (etag === null) {
            return Effect.fail(
              new ObjectStorageUnavailableError(
                `Supabase Storage reported ${canonicalKey} without an entity tag`,
              ),
            )
          }

          return Effect.succeed({
            canonicalKey,
            contentType: readString(info.contentType) ?? "application/octet-stream",
            byteLength: readNumber(info.size) ?? 0,
            etag,
            lastModified:
              readTimestamp(info.lastModified) ??
              readTimestamp(info.updatedAt) ??
              new Date(0).toISOString(),
            cacheMaxAgeSeconds: readCacheMaxAgeSeconds(info.cacheControl),
            metadata: readUserMetadata(info.metadata),
          })
        }),
      ),

    delete: (
      canonicalKey: string,
      precondition: ObjectPrecondition | null,
    ): Effect.Effect<void, ObjectStoreFailure> =>
      requirePrecondition(canonicalKey, precondition).pipe(
        Effect.flatMap(() =>
          request(() => files().remove([canonicalKey]), canonicalKey, bucketByteLimit, 0),
        ),
        Effect.flatMap((removed) =>
          Array.isArray(removed) && removed.length > 0
            ? Effect.void
            : Effect.fail(new ObjectNotFoundError(canonicalKey)),
        ),
      ),

    list: (listRequest: AdapterListRequest): Effect.Effect<AdapterPage, ObjectStoreFailure> =>
      request(
        () =>
          files().listV2({
            prefix: listRequest.canonicalPrefix,
            limit: listRequest.limit,
            sortBy: { column: "name", order: "asc" },
            ...(listRequest.cursor === null ? {} : { cursor: listRequest.cursor }),
          }),
        listRequest.canonicalPrefix,
        bucketByteLimit,
        0,
      ).pipe(
        Effect.map((page) => ({
          objects: page.objects.map((object) => ({
            canonicalKey: listedCanonicalKey(object, listRequest.canonicalPrefix),
            contentType: readString(object.metadata?.mimetype) ?? "application/octet-stream",
            byteLength: readNumber(object.metadata?.size) ?? 0,
            etag: readString(object.metadata?.eTag) ?? object.id,
            lastModified:
              readTimestamp(object.updated_at) ??
              readTimestamp(object.created_at) ??
              new Date(0).toISOString(),
            cacheMaxAgeSeconds: readCacheMaxAgeSeconds(object.metadata?.cacheControl),
            // Listings carry system metadata only, matching object storage
            // conventions. Read an object to see the metadata a caller wrote.
            metadata: {},
          })),
          cursor: page.hasNext ? (readString(page.nextCursor) ?? null) : null,
        })),
      ),

    createUploadUrl: (
      upload: AdapterSignedUploadRequest,
    ): Effect.Effect<AdapterSignedUpload, ObjectStoreFailure> =>
      request(
        () => files().createSignedUploadUrl(upload.canonicalKey, { upsert: upload.overwrite }),
        upload.canonicalKey,
        bucketByteLimit,
        0,
      ).pipe(
        Effect.map((signed) => ({
          url: signed.signedUrl,
          method: "PUT" as const,
          headers: {
            "content-type": upload.contentType,
            "x-upsert": String(upload.overwrite),
          },
          expiresAt: signatureExpiry(signed.signedUrl),
        })),
      ),

    createDownloadUrl: (
      download: AdapterSignedDownloadRequest,
    ): Effect.Effect<AdapterSignedDownload, ObjectStoreFailure> =>
      request(
        () =>
          files().createSignedUrl(
            download.canonicalKey,
            download.expiresInSeconds,
            download.downloadFileName === null ? {} : { download: download.downloadFileName },
          ),
        download.canonicalKey,
        bucketByteLimit,
        0,
      ).pipe(
        Effect.map((signed) => ({
          url: signed.signedUrl,
          expiresAt: new Date(Date.now() + download.expiresInSeconds * 1_000).toISOString(),
        })),
      ),
  }

  return Object.freeze(adapter)
}

function request<Value>(
  operation: () => PromiseLike<SupabaseResult<Value>>,
  canonicalKey: string,
  bucketByteLimit: number,
  byteLength: number,
): Effect.Effect<Value, ObjectStoreFailure> {
  return Effect.tryPromise({
    try: async () => operation(),
    catch: (cause) =>
      new ObjectStorageUnavailableError(
        `Supabase Storage could not be reached for ${canonicalKey}`,
        cause,
      ),
  }).pipe(
    Effect.flatMap((result) => {
      if (result.error) {
        return Effect.fail(
          storageFailure(result.error, canonicalKey, bucketByteLimit, byteLength),
        )
      }

      if (result.data === null) {
        return Effect.fail(
          new ObjectStorageUnavailableError(
            `Supabase Storage returned no result for ${canonicalKey}`,
          ),
        )
      }

      return Effect.succeed(result.data)
    }),
  )
}

function storageFailure(
  error: { readonly message: string; readonly status?: number; readonly statusCode?: string },
  canonicalKey: string,
  bucketByteLimit: number,
  byteLength: number,
): ObjectStoreFailure {
  const status = error.status ?? Number.parseInt(error.statusCode ?? "", 10)
  const message = error.message.toLowerCase()

  if (status === 404 || message.includes("not found")) {
    return new ObjectNotFoundError(canonicalKey)
  }

  if (status === 409 || message.includes("already exists") || message.includes("duplicate")) {
    return new ObjectAlreadyExistsError(canonicalKey)
  }

  if (status === 413 || message.includes("exceeded the maximum allowed size")) {
    return new ObjectTooLargeError(canonicalKey, byteLength, bucketByteLimit)
  }

  return new ObjectStorageUnavailableError(
    `Supabase Storage refused the request for ${canonicalKey}`,
    error,
  )
}

/**
 * Reads the expiry claim from an upload signature so the reported lifetime is
 * the real one. The claim is only read, never trusted for authorization.
 */
function signatureExpiry(signedUrl: string): string {
  const fallback = new Date(Date.now() + supabaseUploadUrlSeconds * 1_000).toISOString()

  try {
    const token = new URL(signedUrl).searchParams.get("token")
    const payload = token?.split(".")[1]

    if (payload === undefined) {
      return fallback
    }

    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    const expiry =
      typeof claims === "object" && claims !== null
        ? (claims as { readonly exp?: unknown }).exp
        : undefined

    return typeof expiry === "number" && Number.isFinite(expiry)
      ? new Date(expiry * 1_000).toISOString()
      : fallback
  } catch {
    return fallback
  }
}

/**
 * Storage versions differ on how a listed object names itself: some report a
 * `key` holding the full path, others report only `name`, which is the full path
 * for a flat listing and relative to the prefix for a delimited one. The prefix
 * decides which of those a value is, and the store validates the result.
 */
function listedCanonicalKey(
  object: { readonly key?: string; readonly name?: string },
  canonicalPrefix: string,
): string {
  const reported = readString(object.key) ?? readString(object.name)

  if (reported === null) {
    return ""
  }

  return reported.startsWith(canonicalPrefix) ? reported : `${canonicalPrefix}${reported}`
}

/**
 * The Supabase client camel cases every response key, including the metadata
 * names a caller wrote, so `uploaded_by` comes back as `uploadedBy`. Port
 * metadata names always introduce a letter after an underscore, which makes this
 * mapping the exact inverse. Names the port would reject are dropped.
 */
function readUserMetadata(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {}
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map((entry): readonly [string, unknown] => [
      entry[0].replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      entry[1],
    ])
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && portMetadataName.test(entry[0]),
    )

  return Object.fromEntries(entries)
}

/** Reads the max-age count out of the directive Storage stores. */
function readCacheMaxAgeSeconds(value: unknown): number | null {
  if (typeof value !== "string") {
    return null
  }

  const maxAge = /(?:^|[\s,])max-age=(\d{1,10})(?:$|[\s,;])/.exec(`${value},`)
  const seconds = maxAge === null ? Number.NaN : Number.parseInt(maxAge[1] ?? "", 10)

  return Number.isSafeInteger(seconds) ? seconds : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null
  }

  return new Date(value).toISOString()
}
