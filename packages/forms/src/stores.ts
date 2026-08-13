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
  FormRoutingDefinition,
  PublishedForm,
  StoredSubmission,
  SubmissionRoutingResult,
} from "./model.js"
import {
  compileFormRoutingDefinition,
  snapshotFormRoutingDefinition,
  type FormRoutingCompiler,
} from "./routing.js"
import { snapshotSubmissionRoutingResult } from "./routing-result.js"

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
  /** Saves routing against the same optimistic revision used by form edits. */
  saveRoutingDraft(
    formId: string,
    expectedRevision: number,
    routing: FormRoutingDefinition | null,
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
  list(formId: string, options?: SubmissionListOptions): Promise<readonly StoredSubmission[]>
}

export interface SubmissionListOptions {
  readonly route?: string
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

  constructor(
    private readonly compileRouting: FormRoutingCompiler = compileFormRoutingDefinition,
  ) {}

  async create(formId: string, definition: FormDefinition): Promise<FormRecord> {
    if (this.#forms.has(formId)) {
      throw new FormAlreadyExistsError(formId)
    }

    const draft = snapshotDraft(formId, 0, definition, null)
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

    const draft = snapshotDraft(
      formId,
      expectedRevision + 1,
      definition,
      state.draft.routing,
    )
    state.draft = draft
    return snapshotDraftValue(draft)
  }

  async saveRoutingDraft(
    formId: string,
    expectedRevision: number,
    routing: FormRoutingDefinition | null,
  ): Promise<FormDraft> {
    const state = this.#requireForm(formId)
    assertRevision(state, expectedRevision)
    const safeRouting = routing === null ? null : snapshotFormRoutingDefinition(routing)
    const draft = snapshotDraft(
      formId,
      expectedRevision + 1,
      state.draft.definition,
      safeRouting,
    )
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
    assertDraftNotPublished(state, expectedRevision)

    // Build and validate the complete immutable version before changing state.
    // If validation throws, the current pointer and history remain untouched.
    const draft = snapshotDraftValue(state.draft)
    const definition = snapshotFormDefinition(draft.definition, { publishable: true })
    const routing =
      draft.routing === null
        ? null
        : await this.compileRouting(definition, draft.routing)

    // Compilation may be asynchronous. Revalidate the shared revision and the
    // publication marker immediately before mutating state so a concurrent
    // edit or publication cannot make this snapshot stale.
    assertRevision(state, expectedRevision)
    assertDraftNotPublished(state, expectedRevision)
    const published = snapshotPublished({
      formId,
      version: (state.publishedVersion ?? 0) + 1,
      definition,
      routing,
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

  async list(
    formId: string,
    options: SubmissionListOptions = {},
  ): Promise<readonly StoredSubmission[]> {
    const route = snapshotRouteFilter(options.route)
    return Object.freeze(
      (this.#submissions.get(formId) ?? [])
        .filter((submission) => route === undefined || submission.routing.route === route)
        .map((submission) => snapshotSubmission(submission)),
    )
  }
}

function assertRevision(state: StoredFormState, expectedRevision: number): void {
  if (state.draft.revision !== expectedRevision) {
    throw new FormRevisionConflictError(state.formId, expectedRevision, state.draft.revision)
  }
}

function assertDraftNotPublished(state: StoredFormState, expectedRevision: number): void {
  if (state.lastPublishedDraftRevision === expectedRevision) {
    throw new FormDraftAlreadyPublishedError(state.formId, expectedRevision)
  }
}

function snapshotDraft(
  formId: string,
  revision: number,
  definition: FormDefinition,
  routing: FormRoutingDefinition | null,
): FormDraft {
  return Object.freeze({
    formId,
    revision,
    definition: snapshotFormDefinition(definition),
    routing: routing === null ? null : snapshotFormRoutingDefinition(routing),
  })
}

function snapshotDraftValue(draft: FormDraft): FormDraft {
  return snapshotDraft(draft.formId, draft.revision, draft.definition, draft.routing)
}

function snapshotPublished(published: PublishedForm): PublishedForm {
  return Object.freeze({
    formId: published.formId,
    version: published.version,
    definition: snapshotFormDefinition(published.definition, { publishable: true }),
    routing:
      published.routing === null ? null : snapshotFormRoutingDefinition(published.routing),
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
  let routing: SubmissionRoutingResult
  try {
    routing = snapshotSubmissionRoutingResult(submission.routing)
  } catch {
    throw invalidSubmission(
      "invalid_routing_result",
      "Submission routing result is invalid",
    )
  }
  return Object.freeze({
    id: submission.id,
    formId: submission.formId,
    publicationVersion: submission.publicationVersion,
    values,
    routing,
    createdAt: submission.createdAt,
  })
}

function snapshotRouteFilter(route: string | undefined): string | undefined {
  if (route === undefined) return undefined
  if (typeof route !== "string" || route.length > 256) {
    throw new TypeError("Submission route filter is invalid")
  }
  return route
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
