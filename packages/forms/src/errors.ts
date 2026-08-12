import type { FormIssue, FormRoutingIssue, SubmissionIssue } from "./model.js"

export class FormsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class InvalidFormDefinitionError extends FormsError {
  constructor(readonly issues: readonly FormIssue[]) {
    super("invalid_form_definition", issues[0]?.message ?? "Form definition is invalid")
  }
}

export class InvalidFormRoutingError extends FormsError {
  constructor(readonly issues: readonly FormRoutingIssue[]) {
    super("invalid_form_routing", issues[0]?.message ?? "Form routing is invalid")
  }
}

export class FormNotFoundError extends FormsError {
  constructor(readonly formId: string) {
    super("form_not_found", `Form ${formId} was not found`)
  }
}

export class PublishedFormNotFoundError extends FormsError {
  constructor(
    readonly formId: string,
    readonly version?: number,
  ) {
    super(
      "published_form_not_found",
      version === undefined
        ? `Form ${formId} has no published version`
        : `Form ${formId} has no published version ${version}`,
    )
  }
}

export class FormRevisionConflictError extends FormsError {
  constructor(
    readonly formId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      "form_revision_conflict",
      `Form ${formId} draft revision is ${actualRevision}, not ${expectedRevision}`,
    )
  }
}

export class InvalidSubmissionError extends FormsError {
  constructor(readonly issues: readonly SubmissionIssue[]) {
    super("invalid_submission", issues[0]?.message ?? "Submission is invalid")
  }
}
