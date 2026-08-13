import {
  createRouter,
  schemaFromForm,
  type RoutingResult,
} from "@screeem/routing"
import type { FormDefinition, FormRoutingDefinition } from "@screeem/forms"

export interface QualificationResult {
  readonly route: string
  readonly matchedRule: string | null
}

/**
 * Runs the immutable routing definition published with a form. A null result
 * means qualification was not configured for this publication.
 */
export async function qualifySubmission(
  definition: FormDefinition,
  routing: FormRoutingDefinition | null,
  submission: Readonly<Record<string, string | number | boolean>>,
): Promise<QualificationResult | null> {
  if (routing === null) return null

  const compiled = await createRouter().compile({
    version: routing.version,
    schema: schemaFromForm(definition),
    rules: routing.rules,
    fallback: routing.fallback,
  })
  const result: RoutingResult = await compiled.run(submission)
  return Object.freeze({ route: result.route, matchedRule: result.matchedRule })
}
