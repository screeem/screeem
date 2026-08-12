import {
  FormAlreadyExistsError,
  FormDraftAlreadyPublishedError,
  FormNotFoundError,
  FormRevisionConflictError,
  FormUnavailableError,
  InvalidFormDefinitionError,
  InvalidFormRoutingError,
  PublishedFormNotFoundError,
} from "@screeem/forms"
import { NextResponse } from "next/server"
import { FormDefinitionNotFoundError } from "./supabase-store"

export function formErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvalidFormDefinitionError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 })
  }
  if (error instanceof InvalidFormRoutingError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 })
  }
  if (error instanceof FormRevisionConflictError) {
    return NextResponse.json(
      { error: error.message, currentRevision: error.actualRevision },
      { status: 409 },
    )
  }
  if (
    error instanceof FormAlreadyExistsError ||
    error instanceof FormDraftAlreadyPublishedError ||
    error instanceof FormUnavailableError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (
    error instanceof FormNotFoundError ||
    error instanceof FormDefinitionNotFoundError ||
    error instanceof PublishedFormNotFoundError
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  console.error("Form lifecycle request failed", error)
  return NextResponse.json({ error: "Could not update the form" }, { status: 500 })
}
