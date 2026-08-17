export type ObjectStorageErrorCode =
  | "invalid_object_key"
  | "invalid_object_request"
  | "object_not_found"
  | "object_already_exists"
  | "object_precondition_failed"
  | "object_too_large"
  | "unsupported_content_type"
  | "object_storage_unavailable"

export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** Raised before any adapter call when a key cannot be represented safely. */
export class InvalidObjectKeyError extends ObjectStorageError {
  readonly _tag = "InvalidObjectKeyError"

  constructor(reason: string) {
    super("invalid_object_key", `Object key is invalid: ${reason}`)
  }
}

/** Raised when request options are outside the configured policy or limits. */
export class InvalidObjectRequestError extends ObjectStorageError {
  readonly _tag = "InvalidObjectRequestError"

  constructor(reason: string) {
    super("invalid_object_request", `Object request is invalid: ${reason}`)
  }
}

export class ObjectNotFoundError extends ObjectStorageError {
  readonly _tag = "ObjectNotFoundError"

  constructor(readonly canonicalKey: string) {
    super("object_not_found", `Object ${canonicalKey} was not found`)
  }
}

export class ObjectAlreadyExistsError extends ObjectStorageError {
  readonly _tag = "ObjectAlreadyExistsError"

  constructor(readonly canonicalKey: string) {
    super("object_already_exists", `Object ${canonicalKey} already exists`)
  }
}

/**
 * Raised when an entity-tag precondition does not hold. Callers re-read the
 * object and retry, the same way form edits recover from revision conflicts.
 */
export class ObjectPreconditionFailedError extends ObjectStorageError {
  readonly _tag = "ObjectPreconditionFailedError"

  constructor(
    readonly canonicalKey: string,
    readonly expectedEtag: string,
    readonly actualEtag: string | null,
  ) {
    super(
      "object_precondition_failed",
      actualEtag === null
        ? `Object ${canonicalKey} no longer exists, so entity tag ${expectedEtag} cannot match`
        : `Object ${canonicalKey} has entity tag ${actualEtag}, not ${expectedEtag}`,
    )
  }
}

export class ObjectTooLargeError extends ObjectStorageError {
  readonly _tag = "ObjectTooLargeError"

  constructor(
    readonly canonicalKey: string,
    readonly byteLength: number,
    readonly maximumByteLength: number,
  ) {
    super(
      "object_too_large",
      `Object ${canonicalKey} is ${byteLength} bytes, over the ${maximumByteLength} byte limit`,
    )
  }
}

export class UnsupportedContentTypeError extends ObjectStorageError {
  readonly _tag = "UnsupportedContentTypeError"

  constructor(
    readonly canonicalKey: string,
    readonly contentType: string,
  ) {
    super("unsupported_content_type", `Content type ${contentType} is not allowed for this scope`)
  }
}

/**
 * Raised when a backend refuses or cannot answer a request. The message is
 * safe to log; provider payloads stay in `safeCause` and are never rendered.
 */
export class ObjectStorageUnavailableError extends ObjectStorageError {
  readonly _tag = "ObjectStorageUnavailableError"

  constructor(
    message: string,
    readonly safeCause?: unknown,
  ) {
    super("object_storage_unavailable", message)
  }
}

export type ObjectStoreFailure =
  | InvalidObjectKeyError
  | InvalidObjectRequestError
  | ObjectNotFoundError
  | ObjectAlreadyExistsError
  | ObjectPreconditionFailedError
  | ObjectTooLargeError
  | UnsupportedContentTypeError
  | ObjectStorageUnavailableError

export function isObjectStoreFailure(error: unknown): error is ObjectStoreFailure {
  return error instanceof ObjectStorageError
}
