import { snapshotFormDefinition } from "./definition.js"
import {
  FormNotFoundError,
  FormRevisionConflictError,
  FormsError,
  InvalidSubmissionError,
  PublishedFormNotFoundError,
} from "./errors.js"
import type {
  FormAvailability,
  FormDefinition,
  FormDraft,
  FormRecord,
  PublishedForm,
  StoredSubmission,
} from "./model.js"

export type PublishedAvailability = Extract<FormAvailability, "active" | "paused">

export class FormAlreadyExistsError extends FormsError {
  constructor(readonly formId: string) {
    super("form_already_exists", `Form ${formId} already exists`)
  }
}

export class SubmissionAlreadyExistsError extends FormsError {
  constructor(readonly submissionId: string) {
    super("submission_already_exists", `Submission ${submissionId} already exists`)
  }
}

export class FormUnavailableError extends FormsError {
  constructor(
    readonly formId: string,
    readonly availability: FormAvailability,
  ) {
    super("form_unavailable", `Form ${formId} is ${availability}`)
  }
}

export class FormDraftAlreadyPublishedError extends FormsError {
  constructor(
    readonly formId: string,
    readonly revision: number,
  ) {
    super(
      "form_draft_already_published",
      `Form ${formId} draft revision ${revision} is already published`,
    )
  }
}

export interface FormDefinitionStore {
  create(formId: string, definition: FormDefinition): Promise<FormRecord>
  get(formId: string): Promise<FormRecord>
  getDraft(formId: string): Promise<FormDraft>
  saveDraft(
    formId: string,
    expectedRevision: number,
    definition: FormDefinition,
  ): Promise<FormDraft>
  /** Atomically publishes a draft revision, which may be published only once. */
  publish(formId: string, expectedRevision: number, publishedAt: string): Promise<PublishedForm>
  /** Returns the current publication only while the form is active. */
  getActive(formId: string): Promise<PublishedForm>
  /** Reads immutable publication history regardless of current availability. */
  getPublished(formId: string, version: number): Promise<PublishedForm>
  setAvailability(formId: string, availability: PublishedAvailability): Promise<FormRecord>
}

export interface FormSubmissionStore {
  save(submission: StoredSubmission): Promise<StoredSubmission>
  list(formId: string): Promise<readonly StoredSubmission[]>
}

interface StoredFormState {
  readonly formId: string
  availability: FormAvailability
  draft: FormDraft
  publishedVersion: number | null
  lastPublishedDraftRevision: number | null
  readonly versions: Map<number, PublishedForm>
}

/**
 * A complete store implementation for tests, playgrounds, and local prototypes.
 * It intentionally enforces the same revision and publication rules expected of
 * persistent adapters instead of behaving like a permissive mock.
 */
export class MemoryFormDefinitionStore implements FormDefinitionStore {
  readonly #forms = new Map<string, StoredFormState>()

  async create(formId: string, definition: FormDefinition): Promise<FormRecord> {
    if (this.#forms.has(formId)) {
      throw new FormAlreadyExistsError(formId)
    }

    const draft = snapshotDraft(formId, 0, definition)
    const state: StoredFormState = {
      formId,
      availability: "draft",
      draft,
      publishedVersion: null,
      lastPublishedDraftRevision: null,
      versions: new Map(),
    }
    this.#forms.set(formId, state)
    return snapshotRecord(state)
  }

  async get(formId: string): Promise<FormRecord> {
    return snapshotRecord(this.#requireForm(formId))
  }

  async getDraft(formId: string): Promise<FormDraft> {
    return snapshotDraftValue(this.#requireForm(formId).draft)
  }

  async saveDraft(
    formId: string,
    expectedRevision: number,
    definition: FormDefinition,
  ): Promise<FormDraft> {
    const state = this.#requireForm(formId)
    assertRevision(state, expectedRevision)

    const draft = snapshotDraft(formId, expectedRevision + 1, definition)
    state.draft = draft
    return snapshotDraftValue(draft)
  }

  async publish(
    formId: string,
    expectedRevision: number,
    publishedAt: string,
  ): Promise<PublishedForm> {
    const state = this.#requireForm(formId)
    assertRevision(state, expectedRevision)
    if (state.lastPublishedDraftRevision === expectedRevision) {
      throw new FormDraftAlreadyPublishedError(formId, expectedRevision)
    }

    // Build and validate the complete immutable version before changing state.
    // If validation throws, the current pointer and history remain untouched.
    const published = snapshotPublished({
      formId,
      version: (state.publishedVersion ?? 0) + 1,
      definition: snapshotFormDefinition(state.draft.definition, { publishable: true }),
      publishedAt,
    })

    state.versions.set(published.version, published)
    state.publishedVersion = published.version
    state.lastPublishedDraftRevision = expectedRevision
    if (state.availability === "draft") state.availability = "active"
    return snapshotPublished(published)
  }

  async getActive(formId: string): Promise<PublishedForm> {
    const state = this.#requireForm(formId)
    if (state.publishedVersion === null) throw new PublishedFormNotFoundError(formId)
    if (state.availability !== "active") {
      throw new FormUnavailableError(formId, state.availability)
    }
    return this.#requirePublished(state, state.publishedVersion)
  }

  async getPublished(formId: string, version: number): Promise<PublishedForm> {
    const state = this.#requireForm(formId)
    return this.#requirePublished(state, version)
  }

  async setAvailability(formId: string, availability: PublishedAvailability): Promise<FormRecord> {
    const state = this.#requireForm(formId)
    if (state.publishedVersion === null) throw new PublishedFormNotFoundError(formId)
    state.availability = availability
    return snapshotRecord(state)
  }

  #requireForm(formId: string): StoredFormState {
    const state = this.#forms.get(formId)
    if (!state) throw new FormNotFoundError(formId)
    return state
  }

  #requirePublished(state: StoredFormState, version: number): PublishedForm {
    const published = state.versions.get(version)
    if (!published) throw new PublishedFormNotFoundError(state.formId, version)
    return snapshotPublished(published)
  }
}

/** In-memory submission storage with immutable inputs and outputs. */
export class MemoryFormSubmissionStore implements FormSubmissionStore {
  readonly #submissions = new Map<string, StoredSubmission[]>()
  readonly #ids = new Set<string>()

  async save(submission: StoredSubmission): Promise<StoredSubmission> {
    if (this.#ids.has(submission.id)) {
      throw new SubmissionAlreadyExistsError(submission.id)
    }

    const stored = snapshotSubmission(submission)
    const current = this.#submissions.get(stored.formId) ?? []
    current.push(stored)
    this.#submissions.set(stored.formId, current)
    this.#ids.add(stored.id)
    return snapshotSubmission(stored)
  }

  async list(formId: string): Promise<readonly StoredSubmission[]> {
    return Object.freeze(
      (this.#submissions.get(formId) ?? []).map((submission) => snapshotSubmission(submission)),
    )
  }
}

function assertRevision(state: StoredFormState, expectedRevision: number): void {
  if (state.draft.revision !== expectedRevision) {
    throw new FormRevisionConflictError(state.formId, expectedRevision, state.draft.revision)
  }
}

function snapshotDraft(formId: string, revision: number, definition: FormDefinition): FormDraft {
  return Object.freeze({
    formId,
    revision,
    definition: snapshotFormDefinition(definition),
  })
}

function snapshotDraftValue(draft: FormDraft): FormDraft {
  return snapshotDraft(draft.formId, draft.revision, draft.definition)
}

function snapshotPublished(published: PublishedForm): PublishedForm {
  return Object.freeze({
    formId: published.formId,
    version: published.version,
    definition: snapshotFormDefinition(published.definition, { publishable: true }),
    publishedAt: published.publishedAt,
  })
}

function snapshotRecord(state: StoredFormState): FormRecord {
  return Object.freeze({
    formId: state.formId,
    availability: state.availability,
    draft: snapshotDraftValue(state.draft),
    publishedVersion: state.publishedVersion,
  })
}

function snapshotSubmission(submission: StoredSubmission): StoredSubmission {
  const values = snapshotSubmissionValues(submission.values)
  return Object.freeze({
    id: submission.id,
    formId: submission.formId,
    publicationVersion: submission.publicationVersion,
    values,
    createdAt: submission.createdAt,
  })
}

function snapshotSubmissionValues(
  input: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
  if (!isPlainObject(input)) {
    throw invalidSubmission("invalid_values", "Submission values must be a plain object")
  }

  const values: Record<string, string | number | boolean> = Object.create(null)
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !("value" in descriptor)) {
      throw invalidSubmission(
        "accessor_not_allowed",
        "Submission values must be data properties",
        key,
      )
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw invalidSubmission("unsafe_field", `Submission field ${key} is not safe`, key)
    }
    const value = descriptor.value
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw invalidSubmission("invalid_value", `Submission field ${key} has an invalid value`, key)
    }
    Object.defineProperty(values, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    })
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw invalidSubmission("symbol_not_allowed", "Submission values cannot use symbol fields")
  }
  return Object.freeze(values)
}

function invalidSubmission(code: string, message: string, field?: string): InvalidSubmissionError {
  return new InvalidSubmissionError([
    Object.freeze({ code, message, ...(field === undefined ? {} : { field }) }),
  ])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
