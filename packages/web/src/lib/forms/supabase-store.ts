import "server-only"

import {
  FormAlreadyExistsError,
  FormDraftAlreadyPublishedError,
  FormNotFoundError,
  FormRevisionConflictError,
  FormsError,
  FormUnavailableError,
  compileFormRoutingDefinition,
  InvalidSubmissionError,
  PublishedFormNotFoundError,
  SubmissionAlreadyExistsError,
  snapshotFormDefinition,
  snapshotFormRoutingDefinition,
  type FormAvailability,
  type FormDefinition,
  type FormDefinitionStore,
  type FormDraft,
  type FormRecord,
  type FormRoutingCompiler,
  type FormRoutingDefinition,
  type FormSubmissionStore,
  type PublishedAvailability,
  type PublishedForm,
  type StoredSubmission,
} from "@screeem/forms"
import type { SupabaseClient } from "@supabase/supabase-js"

export class FormDefinitionNotFoundError extends FormsError {
  constructor(readonly formId: string) {
    super("form_definition_not_found", `Form ${formId} has no structured definition`)
  }
}

type FormRow = {
  id: string
  definition_availability: string
  draft_definition: unknown
  routing_draft: unknown
  draft_revision: number | string
  published_version: number | string | null
}

type PublishedRow = {
  form_id: string
  version: number | string
  definition: unknown
  routing_definition: unknown
  published_at: string
}

type SubmissionRow = {
  id: string
  form_id: string
  publication_version: number | string | null
  payload: unknown
  created_at: string
}

/** Maps a database form row to the framework-independent store value. */
export function mapFormRecord(row: FormRow): FormRecord {
  if (row.draft_definition === null) throw new FormDefinitionNotFoundError(row.id)
  const availability = parseAvailability(row.definition_availability)
  const revision = parseInteger(row.draft_revision, "draft revision")
  return Object.freeze({
    formId: row.id,
    availability,
    draft: Object.freeze({
      formId: row.id,
      revision,
      definition: snapshotFormDefinition(row.draft_definition),
      routing:
        row.routing_draft === null
          ? null
          : snapshotFormRoutingDefinition(row.routing_draft),
    }),
    publishedVersion:
      row.published_version === null
        ? null
        : parseInteger(row.published_version, "published version"),
  })
}

/** Maps an immutable publication row and validates its stored definition. */
export function mapPublishedForm(row: PublishedRow): PublishedForm {
  return Object.freeze({
    formId: row.form_id,
    version: parseInteger(row.version, "published version"),
    definition: snapshotFormDefinition(row.definition, { publishable: true }),
    routing:
      row.routing_definition === null
        ? null
        : snapshotFormRoutingDefinition(row.routing_definition),
    publishedAt: row.published_at,
  })
}

/** Maps a stored normalized submission without returning its JSON reference. */
export function mapStoredSubmission(row: SubmissionRow): StoredSubmission {
  return Object.freeze({
    id: row.id,
    formId: row.form_id,
    publicationVersion:
      row.publication_version === null
        ? null
        : parseInteger(row.publication_version, "publication version"),
    values: snapshotValues(row.payload),
    createdAt: row.created_at,
  })
}

export class SupabaseFormDefinitionStore implements FormDefinitionStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly teamId: string,
    private readonly compileRouting: FormRoutingCompiler = compileFormRoutingDefinition,
  ) {}

  async create(formId: string, definition: FormDefinition): Promise<FormRecord> {
    const safeDefinition = snapshotFormDefinition(definition)
    const { error } = await this.client.rpc("initialize_form_definition", {
      target_team_id: this.teamId,
      target_form_id: formId,
      new_definition: safeDefinition,
    })
    if (error) throw mapDatabaseError(error, formId)
    return this.get(formId)
  }

  async get(formId: string): Promise<FormRecord> {
    const row = await this.readFormRow(formId)
    return mapFormRecord(row)
  }

  async getDraft(formId: string): Promise<FormDraft> {
    return (await this.get(formId)).draft
  }

  async saveDraft(
    formId: string,
    expectedRevision: number,
    definition: FormDefinition,
  ): Promise<FormDraft> {
    const safeDefinition = snapshotFormDefinition(definition)
    const { data, error } = await this.client.rpc("save_form_definition_draft", {
      target_team_id: this.teamId,
      target_form_id: formId,
      expected_revision: expectedRevision,
      new_definition: safeDefinition,
    })
    if (error) throw mapDatabaseError(error, formId, expectedRevision)
    const result = requireObject(data, "save draft result")
    return Object.freeze({
      formId: readString(result, "form_id"),
      revision: parseInteger(result.revision, "draft revision"),
      definition: snapshotFormDefinition(result.definition),
      routing:
        result.routing === null ? null : snapshotFormRoutingDefinition(result.routing),
    })
  }

  async saveRoutingDraft(
    formId: string,
    expectedRevision: number,
    routing: FormRoutingDefinition | null,
  ): Promise<FormDraft> {
    const safeRouting = routing === null ? null : snapshotFormRoutingDefinition(routing)
    const { data, error } = await this.client.rpc("save_form_routing_draft", {
      target_team_id: this.teamId,
      target_form_id: formId,
      expected_revision: expectedRevision,
      new_routing: safeRouting,
    })
    if (error) throw mapDatabaseError(error, formId, expectedRevision)
    const result = requireObject(data, "save routing draft result")
    return Object.freeze({
      formId: readString(result, "form_id"),
      revision: parseInteger(result.revision, "draft revision"),
      definition: snapshotFormDefinition(result.definition),
      routing:
        result.routing === null ? null : snapshotFormRoutingDefinition(result.routing),
    })
  }

  async publish(
    formId: string,
    expectedRevision: number,
    publishedAt: string,
  ): Promise<PublishedForm> {
    const current = await this.getDraft(formId)
    if (current.revision !== expectedRevision) {
      throw new FormRevisionConflictError(formId, expectedRevision, current.revision)
    }
    snapshotFormDefinition(current.definition, { publishable: true })
    if (current.routing !== null) {
      await this.compileRouting(current.definition, current.routing)
    }

    const { data, error } = await this.client.rpc("publish_form_definition", {
      target_team_id: this.teamId,
      target_form_id: formId,
      expected_revision: expectedRevision,
      publication_time: publishedAt,
    })
    if (error) throw mapDatabaseError(error, formId, expectedRevision)
    const result = requireObject(data, "publish result")
    return mapPublishedForm({
      form_id: readString(result, "form_id"),
      version: parseInteger(result.version, "published version"),
      definition: result.definition,
      routing_definition: result.routing,
      published_at: readString(result, "published_at"),
    })
  }

  async getActive(formId: string): Promise<PublishedForm> {
    const record = await this.get(formId)
    if (record.publishedVersion === null) throw new PublishedFormNotFoundError(formId)
    if (record.availability !== "active") {
      throw new FormUnavailableError(formId, record.availability)
    }
    return this.getPublished(formId, record.publishedVersion)
  }

  async getPublished(formId: string, version: number): Promise<PublishedForm> {
    await this.requireTeamForm(formId)
    const { data, error } = await this.client
      .from("form_definition_versions")
      .select("form_id, version, definition, routing_definition, published_at")
      .eq("team_id", this.teamId)
      .eq("form_id", formId)
      .eq("version", version)
      .maybeSingle()
    if (error) throw new FormsError("form_store_error", error.message)
    if (!data) throw new PublishedFormNotFoundError(formId, version)
    return mapPublishedForm(data as PublishedRow)
  }

  async setAvailability(formId: string, availability: PublishedAvailability): Promise<FormRecord> {
    const current = await this.get(formId)
    if (current.publishedVersion === null) throw new PublishedFormNotFoundError(formId)
    const { data, error } = await this.client
      .from("forms")
      .update({
        definition_availability: availability,
        is_active: availability === "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", formId)
      .eq("team_id", this.teamId)
      .not("published_version", "is", null)
      .select(FORM_COLUMNS)
      .maybeSingle()
    if (error) throw new FormsError("form_store_error", error.message)
    if (!data) throw new FormNotFoundError(formId)
    return mapFormRecord(data as FormRow)
  }

  private async readFormRow(formId: string): Promise<FormRow> {
    const { data, error } = await this.client
      .from("forms")
      .select(FORM_COLUMNS)
      .eq("id", formId)
      .eq("team_id", this.teamId)
      .maybeSingle()
    if (error) throw new FormsError("form_store_error", error.message)
    if (!data) throw new FormNotFoundError(formId)
    return data as FormRow
  }

  private async requireTeamForm(formId: string): Promise<void> {
    const { data, error } = await this.client
      .from("forms")
      .select("id")
      .eq("id", formId)
      .eq("team_id", this.teamId)
      .maybeSingle()
    if (error) throw new FormsError("form_store_error", error.message)
    if (!data) throw new FormNotFoundError(formId)
  }
}

export class SupabaseFormSubmissionStore implements FormSubmissionStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly teamId: string,
  ) {}

  async save(submission: StoredSubmission): Promise<StoredSubmission> {
    const safe = snapshotSubmission(submission)
    await this.requireTeamForm(safe.formId)
    const { data, error } = await this.client
      .from("form_submissions")
      .insert({
        id: safe.id,
        team_id: this.teamId,
        form_id: safe.formId,
        publication_version: safe.publicationVersion,
        payload: safe.values,
        created_at: safe.createdAt,
      })
      .select(SUBMISSION_COLUMNS)
      .single()
    if (error) {
      if (error.code === "23505") throw new SubmissionAlreadyExistsError(safe.id)
      throw new FormsError("submission_store_error", error.message)
    }
    return mapStoredSubmission(data as SubmissionRow)
  }

  async list(formId: string): Promise<readonly StoredSubmission[]> {
    await this.requireTeamForm(formId)
    const { data, error } = await this.client
      .from("form_submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("team_id", this.teamId)
      .eq("form_id", formId)
      .order("created_at", { ascending: false })
    if (error) throw new FormsError("submission_store_error", error.message)
    return Object.freeze(((data ?? []) as SubmissionRow[]).map(mapStoredSubmission))
  }

  private async requireTeamForm(formId: string): Promise<void> {
    const { data, error } = await this.client
      .from("forms")
      .select("id")
      .eq("id", formId)
      .eq("team_id", this.teamId)
      .maybeSingle()
    if (error) throw new FormsError("submission_store_error", error.message)
    if (!data) throw new FormNotFoundError(formId)
  }
}

const FORM_COLUMNS =
  "id, definition_availability, draft_definition, routing_draft, draft_revision, published_version"
const SUBMISSION_COLUMNS = "id, form_id, publication_version, payload, created_at"

function mapDatabaseError(
  error: { message: string },
  formId: string,
  expectedRevision?: number,
): Error {
  if (error.message.includes("form_not_found")) return new FormNotFoundError(formId)
  if (error.message.includes("form_already_exists")) return new FormAlreadyExistsError(formId)
  if (error.message.includes("form_definition_not_found")) {
    return new FormDefinitionNotFoundError(formId)
  }
  if (error.message.includes("form_draft_already_published")) {
    return new FormDraftAlreadyPublishedError(formId, expectedRevision ?? 0)
  }
  const conflict = /form_revision_conflict:(\d+)/.exec(error.message)
  if (conflict) {
    return new FormRevisionConflictError(formId, expectedRevision ?? 0, Number(conflict[1]))
  }
  return new FormsError("form_store_error", error.message)
}

function parseAvailability(value: string): FormAvailability {
  if (value === "draft" || value === "active" || value === "paused") return value
  throw new FormsError("invalid_stored_form", `Unknown form availability ${value}`)
}

function parseInteger(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FormsError("invalid_stored_form", `Invalid ${label}`)
  }
  return parsed
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FormsError("form_store_error", `Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function readString(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== "string") {
    throw new FormsError("form_store_error", `Invalid ${key} in database response`)
  }
  return result
}

function snapshotSubmission(submission: StoredSubmission): StoredSubmission {
  return Object.freeze({
    id: submission.id,
    formId: submission.formId,
    publicationVersion: submission.publicationVersion,
    values: snapshotValues(submission.values),
    createdAt: submission.createdAt,
  })
}

function snapshotValues(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidStoredSubmission("Submission values must be a plain object")
  }
  let prototype: object | null
  let keys: string[]
  let symbols: symbol[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Object.getOwnPropertyNames(value)
    symbols = Object.getOwnPropertySymbols(value)
  } catch {
    throw invalidStoredSubmission("Submission values could not be read safely")
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidStoredSubmission("Submission values must be a plain object")
  }
  if (symbols.length > 0) {
    throw invalidStoredSubmission("Submission values cannot use symbol fields")
  }
  const result: Record<string, string | number | boolean> = Object.create(null)
  for (const key of keys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw invalidStoredSubmission(`Submission field ${key} is not safe`, key)
    }
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      throw invalidStoredSubmission(`Submission field ${key} could not be read safely`, key)
    }
    if (!descriptor || !("value" in descriptor)) {
      throw invalidStoredSubmission("Submission values must be data properties", key)
    }
    const item = descriptor.value
    if (
      typeof item !== "string" &&
      typeof item !== "boolean" &&
      (typeof item !== "number" || !Number.isFinite(item))
    ) {
      throw invalidStoredSubmission(`Submission field ${key} has an invalid value`, key)
    }
    result[key] = item
  }
  return Object.freeze(result)
}

function invalidStoredSubmission(message: string, field?: string): InvalidSubmissionError {
  return new InvalidSubmissionError([
    Object.freeze({
      code: "invalid_stored_submission",
      message,
      ...(field === undefined ? {} : { field }),
    }),
  ])
}
