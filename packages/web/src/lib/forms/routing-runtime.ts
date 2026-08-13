import {
  compileFormRoutingSelector,
  failedSubmissionRouting,
  fallbackSubmissionRouting,
  matchedSubmissionRouting,
  notConfiguredSubmissionRouting,
  type FormDefinition,
  type FormRoutingDefinition,
  type SubmissionRoutingResult,
} from "@screeem/forms"

const MAX_CACHED_SELECTORS = 16
const selectorCache = new Map<string, ReturnType<typeof compileFormRoutingSelector>>()

export async function evaluatePublishedFormRouting(
  formId: string,
  version: number,
  definition: FormDefinition,
  routing: FormRoutingDefinition | null,
  submission: Readonly<Record<string, string | number | boolean>>,
): Promise<SubmissionRoutingResult> {
  if (routing === null) return notConfiguredSubmissionRouting()

  try {
    const key = `${formId}:${version}`
    let selector = selectorCache.get(key)
    if (selector) {
      selectorCache.delete(key)
      selectorCache.set(key, selector)
    } else {
      selector = compileFormRoutingSelector(definition, routing)
      selectorCache.set(key, selector)
      selector.catch(() => {
        if (selectorCache.get(key) === selector) selectorCache.delete(key)
      })
      while (selectorCache.size > MAX_CACHED_SELECTORS) {
        const oldest = selectorCache.keys().next().value
        if (oldest === undefined) break
        selectorCache.delete(oldest)
      }
    }

    const result = await (await selector).run(submission)
    return result.matchedRule === null
      ? fallbackSubmissionRouting(result.route)
      : matchedSubmissionRouting(result.route, result.matchedRule)
  } catch {
    return failedSubmissionRouting("routing_evaluation_failed")
  }
}
