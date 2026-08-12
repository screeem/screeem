import { snapshotFormDefinition, type FormDefinition } from "@screeem/forms"

type SupabaseAdmin = ReturnType<(typeof import("@/lib/supabase/admin"))["createAdminClient"]>

export interface PublicFormRecord {
  readonly id: string
  readonly teamId: string
  readonly allowedOrigin: string | null
  readonly successUrl: string | null
  readonly legacyUnstructured: boolean
  readonly definitionAvailability: "draft" | "active" | "paused"
  readonly publishedVersion: number | null
  readonly requiresTurnstile: boolean
  readonly submissionSchema: unknown | null
}

export interface ActivePublicFormDefinition {
  readonly formId: string
  readonly version: number
  readonly definition: FormDefinition
  readonly publishedAt: string
}

export async function findPublicForm(
  admin: SupabaseAdmin,
  endpointKey: string,
): Promise<PublicFormRecord | null> {
  const { data, error } = await admin
    .from("forms")
    .select(
      "id, team_id, allowed_origin, success_url, is_active, legacy_unstructured, definition_availability, published_version, requires_turnstile, submission_schema",
    )
    .eq("endpoint_key", endpointKey)
    .maybeSingle()

  if (error) throw error
  if (!data?.is_active) return null

  return {
    id: data.id,
    teamId: data.team_id,
    allowedOrigin: data.allowed_origin,
    successUrl: data.success_url,
    legacyUnstructured: data.legacy_unstructured,
    definitionAvailability: data.definition_availability,
    publishedVersion: numberOrNull(data.published_version),
    requiresTurnstile: data.requires_turnstile,
    submissionSchema: data.submission_schema,
  }
}

/**
 * Returns null only for a legacy form that has never published a definition.
 * Structured draft and paused forms are intentionally unavailable publicly.
 */
export async function loadActivePublicDefinition(
  admin: SupabaseAdmin,
  form: PublicFormRecord,
): Promise<ActivePublicFormDefinition | null> {
  if (form.publishedVersion === null) {
    if (form.legacyUnstructured) return null
    throw new PublicDefinitionUnavailableError()
  }
  if (form.definitionAvailability !== "active") {
    throw new PublicDefinitionUnavailableError()
  }

  const { data, error } = await admin
    .from("form_definition_versions")
    .select("definition, published_at")
    .eq("team_id", form.teamId)
    .eq("form_id", form.id)
    .eq("version", form.publishedVersion)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new PublicDefinitionUnavailableError()

  return {
    formId: form.id,
    version: form.publishedVersion,
    definition: snapshotFormDefinition(data.definition, { publishable: true }),
    publishedAt: data.published_at,
  }
}

export class PublicDefinitionUnavailableError extends Error {
  readonly name = "PublicDefinitionUnavailableError"
}

function numberOrNull(value: unknown): number | null {
  if (value === null) return null
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Published form version is invalid")
  }
  return number
}
