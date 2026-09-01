import type { Effect } from "effect"

import type { ObjectStoreFailure } from "./errors.js"
import type { ObjectPrecondition } from "./model.js"

/**
 * The narrow surface a backend implements. Adapters receive already validated
 * canonical paths and payloads, so tenancy, key safety, content types, and
 * limits are enforced once for every backend instead of per adapter.
 *
 * Adapters fail with `ObjectStoreFailure` values. Any other error is treated as
 * a defect by the store that wraps them.
 */
export interface ObjectStoreAdapter {
  readonly name: string
  put(request: AdapterPutRequest): Effect.Effect<AdapterObject, ObjectStoreFailure>
  get(canonicalKey: string): Effect.Effect<AdapterStoredObject, ObjectStoreFailure>
  head(canonicalKey: string): Effect.Effect<AdapterObject, ObjectStoreFailure>
  delete(
    canonicalKey: string,
    precondition: ObjectPrecondition | null,
  ): Effect.Effect<void, ObjectStoreFailure>
  list(request: AdapterListRequest): Effect.Effect<AdapterPage, ObjectStoreFailure>
  createUploadUrl(
    request: AdapterSignedUploadRequest,
  ): Effect.Effect<AdapterSignedUpload, ObjectStoreFailure>
  createDownloadUrl(
    request: AdapterSignedDownloadRequest,
  ): Effect.Effect<AdapterSignedDownload, ObjectStoreFailure>
}

export interface AdapterPutRequest {
  readonly canonicalKey: string
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly cacheMaxAgeSeconds: number | null
  readonly metadata: Readonly<Record<string, string>>
  readonly precondition: ObjectPrecondition | null
}

export interface AdapterObject {
  readonly canonicalKey: string
  readonly contentType: string
  readonly byteLength: number
  readonly etag: string
  readonly lastModified: string
  readonly cacheMaxAgeSeconds: number | null
  readonly metadata: Readonly<Record<string, string>>
}

export interface AdapterStoredObject {
  readonly object: AdapterObject
  readonly bytes: Uint8Array
}

export interface AdapterListRequest {
  readonly canonicalPrefix: string
  readonly limit: number
  readonly cursor: string | null
}

export interface AdapterPage {
  readonly objects: readonly AdapterObject[]
  readonly cursor: string | null
}

export interface AdapterSignedUploadRequest {
  readonly canonicalKey: string
  readonly contentType: string
  readonly expiresInSeconds: number
  readonly maximumByteLength: number
  readonly overwrite: boolean
}

export interface AdapterSignedUpload {
  readonly url: string
  readonly method: "PUT" | "POST"
  readonly headers: Readonly<Record<string, string>>
  readonly expiresAt: string
}

export interface AdapterSignedDownloadRequest {
  readonly canonicalKey: string
  readonly expiresInSeconds: number
  readonly downloadFileName: string | null
}

export interface AdapterSignedDownload {
  readonly url: string
  readonly expiresAt: string
}
