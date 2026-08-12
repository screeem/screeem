import { Effect } from "effect"

import { InvalidFormDefinitionError, InvalidSubmissionError, FormsError } from "./errors.js"
import type {
  FormDefinition,
  FormDraft,
  FormRecord,
  PublishedForm,
  StoredSubmission,
} from "./model.js"
import {
  normalizeSubmission,
  type NormalizedSubmission,
  type NormalizeSubmissionOptions,
} from "./submission.js"
import type { FormDefinitionStore, FormSubmissionStore, PublishedAvailability } from "./stores.js"

export type SubmissionValidationError = InvalidFormDefinitionError | InvalidSubmissionError

/**
 * Validate untrusted form values in an Effect program. Expected definition and
 * submission failures stay in the typed error channel; unexpected failures are
 * defects.
 */
export function normalizeSubmissionEffect<const Definition extends FormDefinition>(
  definition: Definition,
  input: unknown,
  options: NormalizeSubmissionOptions,
): Effect.Effect<NormalizedSubmission<Definition>, SubmissionValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(normalizeSubmission(definition, input, options))
    } catch (error) {
      if (error instanceof InvalidFormDefinitionError || error instanceof InvalidSubmissionError) {
        return Effect.fail(error)
      }
      return Effect.die(error)
    }
  })
}

export interface EffectFormDefinitionStore {
  create(formId: string, definition: FormDefinition): Effect.Effect<FormRecord, FormsError>
  get(formId: string): Effect.Effect<FormRecord, FormsError>
  getDraft(formId: string): Effect.Effect<FormDraft, FormsError>
  saveDraft(
    formId: string,
    expectedRevision: number,
    definition: FormDefinition,
  ): Effect.Effect<FormDraft, FormsError>
  publish(
    formId: string,
    expectedRevision: number,
    publishedAt: string,
  ): Effect.Effect<PublishedForm, FormsError>
  getActive(formId: string): Effect.Effect<PublishedForm, FormsError>
  getPublished(formId: string, version: number): Effect.Effect<PublishedForm, FormsError>
  setAvailability(
    formId: string,
    availability: PublishedAvailability,
  ): Effect.Effect<FormRecord, FormsError>
}

export interface EffectFormSubmissionStore {
  save(submission: StoredSubmission): Effect.Effect<StoredSubmission, FormsError>
  list(formId: string): Effect.Effect<readonly StoredSubmission[], FormsError>
}

/** Adapt any Promise-based definition store for composition in Effect hosts. */
export function toEffectFormDefinitionStore(store: FormDefinitionStore): EffectFormDefinitionStore {
  const adapter: EffectFormDefinitionStore = {
    create: (formId, definition) => storeOperation(() => store.create(formId, definition)),
    get: (formId) => storeOperation(() => store.get(formId)),
    getDraft: (formId) => storeOperation(() => store.getDraft(formId)),
    saveDraft: (formId, expectedRevision, definition) =>
      storeOperation(() => store.saveDraft(formId, expectedRevision, definition)),
    publish: (formId, expectedRevision, publishedAt) =>
      storeOperation(() => store.publish(formId, expectedRevision, publishedAt)),
    getActive: (formId) => storeOperation(() => store.getActive(formId)),
    getPublished: (formId, version) => storeOperation(() => store.getPublished(formId, version)),
    setAvailability: (formId, availability) =>
      storeOperation(() => store.setAvailability(formId, availability)),
  }
  return Object.freeze(adapter)
}

/** Adapt any Promise-based submission store for composition in Effect hosts. */
export function toEffectFormSubmissionStore(store: FormSubmissionStore): EffectFormSubmissionStore {
  const adapter: EffectFormSubmissionStore = {
    save: (submission) => storeOperation(() => store.save(submission)),
    list: (formId) => storeOperation(() => store.list(formId)),
  }
  return Object.freeze(adapter)
}

function storeOperation<A>(operation: () => Promise<A>): Effect.Effect<A, FormsError> {
  return Effect.tryPromise(operation).pipe(
    Effect.catchAll((error) =>
      error instanceof FormsError ? Effect.fail(error) : Effect.die(error),
    ),
  )
}
