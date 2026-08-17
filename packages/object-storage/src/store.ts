import { Effect } from "effect"

import type {
  AdapterObject,
  AdapterPutRequest,
  AdapterStoredObject,
  ObjectStoreAdapter,
} from "./adapter.js"
import {
  InvalidObjectRequestError,
  ObjectStorageUnavailableError,
  ObjectTooLargeError,
  UnsupportedContentTypeError,
  isObjectStoreFailure,
  type ObjectStoreFailure,
} from "./errors.js"
import {
  canonicalObjectKey,
  canonicalObjectPrefix,
  defaultObjectKeyLimits,
  objectKey,
  objectPrefix,
  parseCanonicalObjectKey,
  type ObjectKey,
  type ObjectKeyLimits,
  type ObjectPrefix,
} from "./keys.js"
import {
  defaultObjectStorageLimits,
  maximumSupportedByteLength,
  type DeleteObjectOptions,
  type ListObjectsOptions,
  type ObjectMetadata,
  type ObjectPage,
  type ObjectPrecondition,
  type ObjectScopePolicy,
  type ObjectStorageLimits,
  type PutObjectRequest,
  type SignedDownload,
  type SignedDownloadOptions,
  type SignedUpload,
  type SignedUploadRequest,
  type SignedUrlLimits,
  type StoredObject,
} from "./model.js"

/**
 * Reads and writes tenant-scoped objects. Every operation validates its request
 * against the configured scopes before the backend is contacted, so expected
 * refusals stay in the typed error channel and never reach an adapter.
 */
export interface ObjectStore {
  put(request: PutObjectRequest): Effect.Effect<ObjectMetadata, ObjectStoreFailure>
  get(key: ObjectKey): Effect.Effect<StoredObject, ObjectStoreFailure>
  head(key: ObjectKey): Effect.Effect<ObjectMetadata, ObjectStoreFailure>
  delete(key: ObjectKey, options?: DeleteObjectOptions): Effect.Effect<void, ObjectStoreFailure>
  list(
    prefix: ObjectPrefix,
    options?: ListObjectsOptions,
  ): Effect.Effect<ObjectPage, ObjectStoreFailure>
  /** Issues a short-lived direct upload so large bytes bypass the app server. */
  createUploadUrl(request: SignedUploadRequest): Effect.Effect<SignedUpload, ObjectStoreFailure>
  createDownloadUrl(
    key: ObjectKey,
    options?: SignedDownloadOptions,
  ): Effect.Effect<SignedDownload, ObjectStoreFailure>
  describe(): ObjectStorageDescription
}

export interface ObjectStorageConfiguration {
  readonly scopes: readonly ObjectScopePolicy[]
  readonly keyLimits?: Partial<ObjectKeyLimits>
  readonly limits?: Partial<ObjectStorageLimits>
}

export interface ObjectScopeDescription {
  readonly scope: string
  readonly allowedContentTypes: readonly string[]
  readonly maximumByteLength: number
  readonly signedUrl: SignedUrlLimits
}

export interface ObjectStorageDescription {
  readonly adapter: string
  readonly scopes: readonly ObjectScopeDescription[]
  readonly keyLimits: ObjectKeyLimits
  readonly limits: ObjectStorageLimits
}

interface ResolvedScope {
  readonly scope: string
  readonly allowedContentTypes: readonly string[]
  readonly maximumByteLength: number
  readonly signedUrl: SignedUrlLimits
}

const contentTypeEssence =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/
const contentTypeParameter = /^[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+$/
/**
 * Underscores must introduce a letter. Backends that report metadata in camel
 * case can then be mapped back to these names without ambiguity.
 */
const metadataName = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/
/** Content disposition safe. Rejects quotes and separators that could split the header. */
const safeDownloadFileName = /^[A-Za-z0-9 ._()[\]{}+-]{1,128}$/
/**
 * Values an adapter may render into a request or response header carry no
 * control characters, so no backend has to escape a line break for us. Adapters
 * remain responsible for encoding values outside ASCII.
 */
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/
const maximumCursorLength = 512

/**
 * Binds a backend to a scope policy. Configuration mistakes throw immediately,
 * matching how routing rejects invalid registrations, because they are authoring
 * errors rather than request failures.
 */
export function createObjectStore(
  adapter: ObjectStoreAdapter,
  configuration: ObjectStorageConfiguration,
): ObjectStore {
  const keyLimits = resolveKeyLimits(configuration.keyLimits)
  const limits = resolveLimits(configuration.limits)
  const scopes = resolveScopes(configuration.scopes, limits)

  const requireScope = (scope: string): ResolvedScope => {
    const resolved = scopes.get(scope)

    if (!resolved) {
      throw new InvalidObjectRequestError(`scope ${scope} is not configured`)
    }

    return resolved
  }

  const validatedKey = (key: ObjectKey): { readonly canonicalKey: string } => {
    const validKey = objectKey(key, keyLimits)
    requireScope(validKey.scope)
    return { canonicalKey: canonicalObjectKey(validKey, keyLimits) }
  }

  const toMetadata = (object: AdapterObject, expectedCanonicalKey: string | null): ObjectMetadata =>
    readAdapterObject(object, expectedCanonicalKey, keyLimits, limits, adapter.name)

  const store: ObjectStore = {
    put: (request) =>
      validated(() => {
        const key = objectKey(request.key, keyLimits)
        const scope = requireScope(key.scope)
        const canonicalKey = canonicalObjectKey(key, keyLimits)
        const bytes = readBytes(request.bytes)

        if (bytes.byteLength > scope.maximumByteLength) {
          throw new ObjectTooLargeError(canonicalKey, bytes.byteLength, scope.maximumByteLength)
        }

        return {
          canonicalKey,
          bytes,
          contentType: allowedContentType(scope, canonicalKey, request.contentType),
          cacheMaxAgeSeconds: readCacheMaxAgeSeconds(request.cacheMaxAgeSeconds, limits),
          metadata: readMetadata(request.metadata, limits),
          precondition: readPrecondition(request.precondition),
        } satisfies AdapterPutRequest
      }).pipe(
        Effect.flatMap((adapterRequest) =>
          adapterOperation(() => adapter.put(adapterRequest)).pipe(
            Effect.flatMap((object) =>
              validated(() => toMetadata(object, adapterRequest.canonicalKey)),
            ),
          ),
        ),
      ),

    get: (key) =>
      validated(() => validatedKey(key)).pipe(
        Effect.flatMap(({ canonicalKey }) =>
          adapterOperation(() => adapter.get(canonicalKey)).pipe(
            Effect.flatMap((stored) =>
              validated(() =>
                readAdapterStoredObject(stored, canonicalKey, toMetadata, adapter.name),
              ),
            ),
          ),
        ),
      ),

    head: (key) =>
      validated(() => validatedKey(key)).pipe(
        Effect.flatMap(({ canonicalKey }) =>
          adapterOperation(() => adapter.head(canonicalKey)).pipe(
            Effect.flatMap((object) => validated(() => toMetadata(object, canonicalKey))),
          ),
        ),
      ),

    delete: (key, options) =>
      validated(() => {
        const canonicalKey = validatedKey(key).canonicalKey
        const precondition = readPrecondition(options?.precondition)

        if (precondition?.kind === "absent") {
          throw new InvalidObjectRequestError("a delete precondition must be entity tag based")
        }

        return { canonicalKey, precondition }
      }).pipe(
        Effect.flatMap(({ canonicalKey, precondition }) =>
          adapterOperation(() => adapter.delete(canonicalKey, precondition)),
        ),
      ),

    list: (prefix, options) =>
      validated(() => {
        const validPrefix = objectPrefix(prefix, keyLimits)
        requireScope(validPrefix.scope)
        return {
          canonicalPrefix: canonicalObjectPrefix(validPrefix, keyLimits),
          limit: readLimit(options?.limit, limits.maximumListPageSize),
          cursor: readCursor(options?.cursor),
        }
      }).pipe(
        Effect.flatMap((request) =>
          adapterOperation(() => adapter.list(request)).pipe(
            Effect.flatMap((page) =>
              validated(() => {
                const objects = page.objects.map((object) => {
                  const metadata = toMetadata(object, null)

                  if (!metadata.canonicalKey.startsWith(request.canonicalPrefix)) {
                    throw new ObjectStorageUnavailableError(
                      `The ${adapter.name} adapter listed an object outside the requested prefix`,
                    )
                  }

                  return metadata
                })

                if (objects.length > request.limit) {
                  throw new ObjectStorageUnavailableError(
                    `The ${adapter.name} adapter returned more objects than requested`,
                  )
                }

                return Object.freeze({
                  objects: Object.freeze(objects),
                  cursor: page.cursor === null ? null : readCursor(page.cursor),
                }) satisfies ObjectPage
              }),
            ),
          ),
        ),
      ),

    createUploadUrl: (request) =>
      validated(() => {
        const key = objectKey(request.key, keyLimits)
        const scope = requireScope(key.scope)
        const canonicalKey = canonicalObjectKey(key, keyLimits)
        const maximumByteLength = readMaximumByteLength(
          request.maximumByteLength,
          scope.maximumByteLength,
          canonicalKey,
        )

        return {
          key,
          canonicalKey,
          contentType: allowedContentType(scope, canonicalKey, request.contentType),
          expiresInSeconds: readExpiry(request.expiresInSeconds, scope.signedUrl),
          maximumByteLength,
        }
      }).pipe(
        Effect.flatMap(({ key, ...request }) =>
          adapterOperation(() => adapter.createUploadUrl(request)).pipe(
            Effect.flatMap((upload) =>
              validated(
                () =>
                  Object.freeze({
                    key,
                    url: readUrl(upload.url, adapter.name),
                    method: upload.method === "POST" ? ("POST" as const) : ("PUT" as const),
                    headers: readMetadata(upload.headers, limits, "header"),
                    expiresAt: readTimestamp(upload.expiresAt, adapter.name),
                    maximumByteLength: request.maximumByteLength,
                  }) satisfies SignedUpload,
              ),
            ),
          ),
        ),
      ),

    createDownloadUrl: (key, options) =>
      validated(() => {
        const validKey = objectKey(key, keyLimits)
        const scope = requireScope(validKey.scope)

        return {
          key: validKey,
          canonicalKey: canonicalObjectKey(validKey, keyLimits),
          expiresInSeconds: readExpiry(options?.expiresInSeconds, scope.signedUrl),
          downloadFileName: readDownloadFileName(options?.downloadFileName),
        }
      }).pipe(
        Effect.flatMap(({ key, ...request }) =>
          adapterOperation(() => adapter.createDownloadUrl(request)).pipe(
            Effect.flatMap((download) =>
              validated(
                () =>
                  Object.freeze({
                    key,
                    url: readUrl(download.url, adapter.name),
                    expiresAt: readTimestamp(download.expiresAt, adapter.name),
                  }) satisfies SignedDownload,
              ),
            ),
          ),
        ),
      ),

    describe: () =>
      Object.freeze({
        adapter: adapter.name,
        scopes: Object.freeze(
          [...scopes.values()].map((scope) =>
            Object.freeze({
              scope: scope.scope,
              allowedContentTypes: scope.allowedContentTypes,
              maximumByteLength: scope.maximumByteLength,
              signedUrl: scope.signedUrl,
            }),
          ),
        ),
        keyLimits,
        limits,
      }),
  }

  return Object.freeze(store)
}

/**
 * Runs synchronous policy checks inside a program. Expected refusals become
 * typed failures; anything else is a defect, so a broken adapter or caller
 * cannot be mistaken for a storage rule.
 */
function validated<Value>(check: () => Value): Effect.Effect<Value, ObjectStoreFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(check())
    } catch (error) {
      return isObjectStoreFailure(error) ? Effect.fail(error) : Effect.die(error)
    }
  })
}

function adapterOperation<Value>(
  operation: () => Effect.Effect<Value, ObjectStoreFailure>,
): Effect.Effect<Value, ObjectStoreFailure> {
  return Effect.suspend(operation).pipe(
    Effect.catchAll((error) =>
      isObjectStoreFailure(error) ? Effect.fail(error) : Effect.die(error),
    ),
  )
}

function readAdapterObject(
  object: AdapterObject,
  expectedCanonicalKey: string | null,
  keyLimits: ObjectKeyLimits,
  limits: ObjectStorageLimits,
  adapterName: string,
): ObjectMetadata {
  const unavailable = (reason: string): ObjectStorageUnavailableError =>
    new ObjectStorageUnavailableError(`The ${adapterName} adapter returned ${reason}`)

  if (typeof object !== "object" || object === null) {
    throw unavailable("a malformed object")
  }

  if (typeof object.canonicalKey !== "string") {
    throw unavailable("an object without a canonical key")
  }

  if (expectedCanonicalKey !== null && object.canonicalKey !== expectedCanonicalKey) {
    throw unavailable(`the unrelated object ${object.canonicalKey}`)
  }

  if (typeof object.etag !== "string" || object.etag.length === 0) {
    throw unavailable("an object without an entity tag")
  }

  if (!Number.isSafeInteger(object.byteLength) || object.byteLength < 0) {
    throw unavailable("an object with an invalid byte length")
  }

  if (object.cacheMaxAgeSeconds !== null && typeof object.cacheMaxAgeSeconds !== "number") {
    throw unavailable("an object without a cache lifetime")
  }

  let key: ObjectKey
  try {
    key = parseCanonicalObjectKey(object.canonicalKey, keyLimits)
  } catch {
    throw unavailable(`the unusable canonical key ${object.canonicalKey}`)
  }

  return Object.freeze({
    key,
    canonicalKey: object.canonicalKey,
    contentType: normalizedContentType(object.contentType),
    byteLength: object.byteLength,
    etag: object.etag,
    lastModified: readTimestamp(object.lastModified, adapterName),
    cacheMaxAgeSeconds:
      object.cacheMaxAgeSeconds === null
        ? null
        : readCacheMaxAgeSeconds(object.cacheMaxAgeSeconds, limits),
    metadata: readMetadata(object.metadata, limits),
  })
}

function readAdapterStoredObject(
  stored: AdapterStoredObject,
  canonicalKey: string,
  toMetadata: (object: AdapterObject, expectedCanonicalKey: string | null) => ObjectMetadata,
  adapterName: string,
): StoredObject {
  const metadata = toMetadata(stored.object, canonicalKey)
  const bytes = readBytes(stored.bytes)

  if (bytes.byteLength !== metadata.byteLength) {
    throw new ObjectStorageUnavailableError(
      `The ${adapterName} adapter returned ${bytes.byteLength} bytes for a ${metadata.byteLength} byte object`,
    )
  }

  return Object.freeze({ metadata, bytes })
}

function readBytes(bytes: unknown): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new InvalidObjectRequestError("object bytes must be a Uint8Array")
  }

  return bytes
}

function allowedContentType(scope: ResolvedScope, canonicalKey: string, value: unknown): string {
  const contentType = normalizedContentType(value)
  const [type] = contentType.split("/")
  const essence = contentType.split(";")[0] ?? contentType

  if (
    !scope.allowedContentTypes.includes(essence) &&
    !scope.allowedContentTypes.includes(`${type}/*`)
  ) {
    throw new UnsupportedContentTypeError(canonicalKey, essence)
  }

  return contentType
}

function normalizedContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidObjectRequestError("a content type must be a string")
  }

  const [essence, ...parameters] = value.split(";")

  if (essence === undefined || !contentTypeEssence.test(essence.trim())) {
    throw new InvalidObjectRequestError(`content type ${value} is not a valid media type`)
  }

  const normalizedParameters = parameters.map((parameter) => {
    const trimmed = parameter.trim()

    if (!contentTypeParameter.test(trimmed)) {
      throw new InvalidObjectRequestError(`content type ${value} has an unsupported parameter`)
    }

    return trimmed.toLowerCase()
  })

  return [essence.trim().toLowerCase(), ...normalizedParameters].join("; ")
}

function readCacheMaxAgeSeconds(value: unknown, limits: ObjectStorageLimits): number | null {
  if (value === undefined) {
    return null
  }

  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > limits.maximumCacheMaxAgeSeconds
  ) {
    throw new InvalidObjectRequestError(
      `a cache lifetime must be between 0 and ${limits.maximumCacheMaxAgeSeconds} seconds`,
    )
  }

  return value as number
}

function readMetadata(
  value: unknown,
  limits: ObjectStorageLimits,
  label = "metadata",
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return Object.freeze({})
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidObjectRequestError(`${label} must be a plain object`)
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const names = Object.keys(descriptors)

  if (names.length > limits.maximumMetadataEntries) {
    throw new InvalidObjectRequestError(
      `${label} allows at most ${limits.maximumMetadataEntries} entries`,
    )
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new InvalidObjectRequestError(`${label} must not contain symbol keys`)
  }

  const entries = names.map((name): readonly [string, string] => {
    const descriptor = descriptors[name]

    if (!descriptor || !("value" in descriptor)) {
      throw new InvalidObjectRequestError(`${label} must contain data properties`)
    }

    if (label === "metadata" && !metadataName.test(name)) {
      throw new InvalidObjectRequestError(`${label} name ${name} is not allowed`)
    }

    if (
      typeof descriptor.value !== "string" ||
      descriptor.value.length > limits.maximumMetadataValueLength
    ) {
      throw new InvalidObjectRequestError(
        `${label} value for ${name} must be a string of at most ${limits.maximumMetadataValueLength} characters`,
      )
    }

    if (controlCharacters.test(descriptor.value)) {
      throw new InvalidObjectRequestError(
        `${label} value for ${name} must not contain control characters`,
      )
    }

    return [name, descriptor.value]
  })

  return Object.freeze(Object.fromEntries(entries))
}

function readPrecondition(value: unknown): ObjectPrecondition | null {
  if (value === undefined) {
    return null
  }

  if (typeof value !== "object" || value === null) {
    throw new InvalidObjectRequestError("a precondition must be an object")
  }

  const precondition = value as Partial<ObjectPrecondition>

  if (precondition.kind === "absent") {
    return Object.freeze({ kind: "absent" as const })
  }

  if (precondition.kind === "etag") {
    const etag = (precondition as { readonly etag?: unknown }).etag

    if (
      typeof etag !== "string" ||
      etag.length === 0 ||
      etag.length > 256 ||
      controlCharacters.test(etag)
    ) {
      throw new InvalidObjectRequestError(
        "an entity tag precondition needs a non-empty tag without control characters",
      )
    }

    return Object.freeze({ kind: "etag" as const, etag })
  }

  throw new InvalidObjectRequestError("a precondition must be absent or entity tag based")
}

function readLimit(value: unknown, maximum: number): number {
  if (value === undefined) {
    return maximum
  }

  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new InvalidObjectRequestError(`a listing limit must be between 1 and ${maximum}`)
  }

  return value as number
}

function readCursor(value: unknown): string | null {
  if (value === undefined) {
    return null
  }

  if (typeof value !== "string" || value.length === 0 || value.length > maximumCursorLength) {
    throw new InvalidObjectRequestError("a listing cursor must be a short non-empty string")
  }

  return value
}

function readExpiry(value: unknown, limits: SignedUrlLimits): number {
  if (value === undefined) {
    return limits.defaultSeconds
  }

  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > limits.maximumSeconds
  ) {
    throw new InvalidObjectRequestError(
      `a signed URL expiry must be between 1 and ${limits.maximumSeconds} seconds`,
    )
  }

  return value as number
}

function readMaximumByteLength(value: unknown, scopeMaximum: number, canonicalKey: string): number {
  if (value === undefined) {
    return scopeMaximum
  }

  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InvalidObjectRequestError("a maximum byte length must be a positive integer")
  }

  if ((value as number) > scopeMaximum) {
    throw new ObjectTooLargeError(canonicalKey, value as number, scopeMaximum)
  }

  return value as number
}

function readDownloadFileName(value: unknown): string | null {
  if (value === undefined) {
    return null
  }

  if (typeof value !== "string" || !safeDownloadFileName.test(value)) {
    throw new InvalidObjectRequestError(
      "a download file name must be plain text without separators or control characters",
    )
  }

  return value
}

function readUrl(value: unknown, adapterName: string): string {
  if (typeof value !== "string" || !/^https?:\/\/[^\s"']+$/.test(value)) {
    throw new ObjectStorageUnavailableError(`The ${adapterName} adapter returned an unusable URL`)
  }

  return value
}

function readTimestamp(value: unknown, adapterName: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ObjectStorageUnavailableError(
      `The ${adapterName} adapter returned an unusable timestamp`,
    )
  }

  return value
}

function resolveKeyLimits(overrides: Partial<ObjectKeyLimits> | undefined): ObjectKeyLimits {
  const limits = Object.freeze({ ...defaultObjectKeyLimits, ...overrides })

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Object key limit ${name} must be a positive integer`)
    }
  }

  return limits
}

function resolveLimits(overrides: Partial<ObjectStorageLimits> | undefined): ObjectStorageLimits {
  const signedUrl = Object.freeze({
    ...defaultObjectStorageLimits.signedUrl,
    ...overrides?.signedUrl,
  })
  const limits = Object.freeze({ ...defaultObjectStorageLimits, ...overrides, signedUrl })

  assertSignedUrlLimits(limits.signedUrl, "the default signed URL policy")

  for (const name of [
    "maximumCacheMaxAgeSeconds",
    "maximumListPageSize",
    "maximumMetadataEntries",
    "maximumMetadataValueLength",
  ] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) {
      throw new Error(`Object storage limit ${name} must be a positive integer`)
    }
  }

  return limits
}

function resolveScopes(
  scopes: readonly ObjectScopePolicy[],
  limits: ObjectStorageLimits,
): ReadonlyMap<string, ResolvedScope> {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("Object storage requires at least one configured scope")
  }

  const resolved = new Map<string, ResolvedScope>()

  for (const policy of scopes) {
    if (resolved.has(policy.scope)) {
      throw new Error(`Object storage scope ${policy.scope} is configured twice`)
    }

    try {
      objectKey({ teamId: "team", scope: policy.scope, path: ["object"] })
    } catch {
      throw new Error(`Object storage scope ${policy.scope} is not a usable path segment`)
    }

    if (
      !Number.isSafeInteger(policy.maximumByteLength) ||
      policy.maximumByteLength <= 0 ||
      policy.maximumByteLength > maximumSupportedByteLength
    ) {
      throw new Error(
        `Object storage scope ${policy.scope} needs a byte limit between 1 and ${maximumSupportedByteLength}`,
      )
    }

    if (!Array.isArray(policy.allowedContentTypes) || policy.allowedContentTypes.length === 0) {
      throw new Error(`Object storage scope ${policy.scope} needs at least one content type`)
    }

    const allowedContentTypes = policy.allowedContentTypes.map((allowed: unknown) => {
      const normalized = typeof allowed === "string" ? allowed.trim().toLowerCase() : ""
      const isWildcard = normalized.endsWith("/*")
      const essence = isWildcard ? normalized.replace("/*", "/placeholder") : normalized

      if (!contentTypeEssence.test(essence)) {
        throw new Error(
          `Object storage scope ${policy.scope} declares the invalid content type ${String(allowed)}`,
        )
      }

      return normalized
    })

    const signedUrl = Object.freeze({ ...limits.signedUrl, ...policy.signedUrl })
    assertSignedUrlLimits(signedUrl, `the signed URL policy for scope ${policy.scope}`)

    resolved.set(
      policy.scope,
      Object.freeze({
        scope: policy.scope,
        allowedContentTypes: Object.freeze(allowedContentTypes),
        maximumByteLength: policy.maximumByteLength,
        signedUrl,
      }),
    )
  }

  return resolved
}

function assertSignedUrlLimits(limits: SignedUrlLimits, label: string): void {
  if (
    !Number.isSafeInteger(limits.defaultSeconds) ||
    !Number.isSafeInteger(limits.maximumSeconds) ||
    limits.defaultSeconds < 1 ||
    limits.maximumSeconds < limits.defaultSeconds
  ) {
    throw new Error(`${label} needs a default expiry within its maximum expiry`)
  }
}
