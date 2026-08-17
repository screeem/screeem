import type { ObjectKey } from "./keys.js"

/** Describes a stored object without transferring its bytes. */
export interface ObjectMetadata {
  readonly key: ObjectKey
  readonly canonicalKey: string
  readonly contentType: string
  readonly byteLength: number
  /** Backend entity tag, used for read-modify-write preconditions. */
  readonly etag: string
  readonly lastModified: string
  /** Cache lifetime in seconds, or null when the backend reported none. */
  readonly cacheMaxAgeSeconds: number | null
  readonly metadata: Readonly<Record<string, string>>
}

export interface StoredObject {
  readonly metadata: ObjectMetadata
  readonly bytes: Uint8Array
}

/**
 * Guards a write against concurrent changes. `absent` writes only when nothing
 * is stored yet; `etag` writes only when the stored tag still matches.
 */
export type ObjectPrecondition =
  | { readonly kind: "absent" }
  | { readonly kind: "etag"; readonly etag: string }

export interface PutObjectRequest {
  readonly key: ObjectKey
  readonly bytes: Uint8Array
  readonly contentType: string
  /**
   * Cache lifetime in seconds. A number rather than a directive string, so no
   * caller composes a response header and every backend renders it natively.
   */
  readonly cacheMaxAgeSeconds?: number
  readonly metadata?: Readonly<Record<string, string>>
  readonly precondition?: ObjectPrecondition
}

export interface DeleteObjectOptions {
  readonly precondition?: ObjectPrecondition
}

export interface ListObjectsOptions {
  readonly limit?: number
  readonly cursor?: string
}

export interface ObjectPage {
  readonly objects: readonly ObjectMetadata[]
  /** Opaque continuation token, or null when the listing is complete. */
  readonly cursor: string | null
}

export interface SignedUploadRequest {
  readonly key: ObjectKey
  readonly contentType: string
  readonly expiresInSeconds?: number
  readonly maximumByteLength?: number
}

export interface SignedUpload {
  readonly key: ObjectKey
  readonly url: string
  readonly method: "PUT" | "POST"
  readonly headers: Readonly<Record<string, string>>
  readonly expiresAt: string
  readonly maximumByteLength: number
}

export interface SignedDownloadOptions {
  readonly expiresInSeconds?: number
  readonly downloadFileName?: string
}

export interface SignedDownload {
  readonly key: ObjectKey
  readonly url: string
  readonly expiresAt: string
}

export interface SignedUrlLimits {
  readonly defaultSeconds: number
  readonly maximumSeconds: number
}

/**
 * Per-scope rules. Every scope declares its accepted content types and size
 * ceiling up front, so a new upload surface cannot widen what a bucket accepts
 * without an explicit registration.
 */
export interface ObjectScopePolicy {
  readonly scope: string
  /** Exact types such as `image/png`, or a subtype wildcard such as `image/*`. */
  readonly allowedContentTypes: readonly string[]
  readonly maximumByteLength: number
  readonly signedUrl?: Partial<SignedUrlLimits>
}

export interface ObjectStorageLimits {
  readonly maximumCacheMaxAgeSeconds: number
  readonly maximumListPageSize: number
  readonly maximumMetadataEntries: number
  readonly maximumMetadataValueLength: number
  readonly signedUrl: SignedUrlLimits
}

export const defaultObjectStorageLimits: ObjectStorageLimits = Object.freeze({
  maximumCacheMaxAgeSeconds: 365 * 24 * 60 * 60,
  maximumListPageSize: 100,
  maximumMetadataEntries: 10,
  maximumMetadataValueLength: 256,
  signedUrl: Object.freeze({ defaultSeconds: 300, maximumSeconds: 3_600 }),
})

/** The largest object any scope may declare, as a guard against typos. */
export const maximumSupportedByteLength = 50 * 1024 * 1024
