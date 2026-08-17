import {
  InvalidObjectKeyError,
  InvalidObjectRequestError,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  ObjectPreconditionFailedError,
  ObjectTooLargeError,
  UnsupportedContentTypeError,
} from "@screeem/object-storage"
import { NextResponse } from "next/server"

/** Maps storage failures to responses without echoing backend detail. */
export function objectStorageErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvalidObjectKeyError || error instanceof InvalidObjectRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof UnsupportedContentTypeError) {
    return NextResponse.json({ error: error.message }, { status: 415 })
  }
  if (error instanceof ObjectTooLargeError) {
    return NextResponse.json(
      { error: error.message, maximumByteLength: error.maximumByteLength },
      { status: 413 },
    )
  }
  if (error instanceof ObjectPreconditionFailedError) {
    return NextResponse.json(
      { error: error.message, currentEtag: error.actualEtag },
      { status: 412 },
    )
  }
  if (error instanceof ObjectAlreadyExistsError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof ObjectNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  console.error("Object storage request failed", error)
  return NextResponse.json({ error: "Could not complete the storage request" }, { status: 500 })
}
