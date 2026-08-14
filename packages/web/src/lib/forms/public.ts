import {
  snapshotFormDefinition,
  snapshotFormRoutingDefinition,
  type FormAvailability,
  type FormRoutingDefinition,
  type PublishedForm,
} from "@screeem/forms"

type SupabaseAdmin = ReturnType<(typeof import("@/lib/supabase/admin"))["createAdminClient"]>
const MAX_CACHED_PUBLICATIONS = 16
const MAX_CACHED_PUBLICATION_BYTES = 8 * 1024 * 1024

interface CachedPublication {
  readonly promise: Promise<PublishedForm>
  bytes: number
}

const publicationCache = new Map<string, CachedPublication>()
let publicationCacheBytes = 0

export interface PublicFormRecord {
  readonly id: string
  readonly teamId: string
  readonly allowedOrigin: string | null
  readonly successUrl: string | null
  readonly legacyUnstructured: boolean
  readonly definitionAvailability: FormAvailability
  readonly publishedVersion: number | null
  readonly requiresTurnstile: boolean
  readonly submissionSchema: unknown | null
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
): Promise<PublishedForm | null> {
  if (form.publishedVersion === null) {
    if (form.legacyUnstructured) return null
    throw new PublicDefinitionUnavailableError()
  }
  if (form.definitionAvailability !== "active") {
    throw new PublicDefinitionUnavailableError()
  }

  const key = `${form.teamId}:${form.id}:${form.publishedVersion}`
  const cached = publicationCache.get(key)
  if (cached) {
    publicationCache.delete(key)
    publicationCache.set(key, cached)
    return cached.promise
  }

  const entry: CachedPublication = {
    promise: loadPublishedVersion(admin, form, form.publishedVersion)
      .then((published) => {
        if (publicationCache.get(key) === entry) {
          entry.bytes = encodedBytes(published)
          publicationCacheBytes += entry.bytes
          trimPublicationCache()
        }
        return published
      })
      .catch((error) => {
        if (publicationCache.get(key) === entry) removeCachedPublication(key, entry)
        throw error
      }),
    bytes: 0,
  }
  publicationCache.set(key, entry)
  trimPublicationCache()
  return entry.promise
}

async function loadPublishedVersion(
  admin: SupabaseAdmin,
  form: PublicFormRecord,
  version: number,
): Promise<PublishedForm> {
  const { data, error } = await admin
    .from("form_definition_versions")
    .select("definition, routing_definition, published_at")
    .eq("team_id", form.teamId)
    .eq("form_id", form.id)
    .eq("version", version)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new PublicDefinitionUnavailableError()

  return Object.freeze({
    formId: form.id,
    version,
    definition: snapshotFormDefinition(data.definition, { publishable: true }),
    routing: snapshotRuntimeRouting(data.routing_definition),
    publishedAt: data.published_at,
  })
}

function snapshotRuntimeRouting(value: unknown): FormRoutingDefinition | null {
  if (value === null) return null
  const routing = snapshotFormRoutingDefinition(value)
  return Object.freeze({
    version: routing.version,
    rules: Object.freeze(
      routing.rules.map(({ id, when, route, actions }) =>
        Object.freeze({
          id,
          when,
          route,
          ...(actions === undefined ? {} : { actions }),
        }),
      ),
    ),
    fallback: routing.fallback,
  })
}

function trimPublicationCache() {
  while (
    publicationCache.size > MAX_CACHED_PUBLICATIONS ||
    publicationCacheBytes > MAX_CACHED_PUBLICATION_BYTES
  ) {
    const oldest = publicationCache.entries().next().value
    if (oldest === undefined) break
    removeCachedPublication(oldest[0], oldest[1])
  }
}

function removeCachedPublication(key: string, entry: CachedPublication) {
  if (!publicationCache.delete(key)) return
  publicationCacheBytes -= entry.bytes
}

function encodedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
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
