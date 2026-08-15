import {
  snapshotFormActionTestResult,
  type FormActionTestContext,
  type FormActionTester,
} from "@screeem/forms"
import { crmUpsertLeadActionName } from "../crm/contract"

const maximumPreviewResponseBytes = 16_384

export function createSalesforceLeadActionTester(
  teamId: string,
  formId: string,
  fetcher: typeof fetch = fetch,
): FormActionTester {
  return Object.freeze({
    actionName: crmUpsertLeadActionName,
    label: "CRM lead readiness",
    description:
      "Checks Salesforce against this action’s mapped Lead values. Nothing is created or queued.",
    timeoutMs: 12_000,
    async test(context: FormActionTestContext) {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/forms/${encodeURIComponent(formId)}` +
          `/actions/${crmUpsertLeadActionName}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            definition: context.definition,
            submission: context.submission,
            routing: context.routing,
            action: context.action,
          }),
          signal: context.signal,
        },
      )
      const body = await readBoundedJson(response)
      if (!response.ok) throw new Error(previewError(response.status))
      return snapshotFormActionTestResult(body)
    },
  })
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximumPreviewResponseBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("The action preview returned an invalid response.")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error("The action preview returned an invalid response.")
  }
}

function previewError(status: number) {
  if (status === 409) return "Connect or reconnect Salesforce before previewing this action."
  if (status === 429) return "Salesforce is rate limited. Try the preview again later."
  if (status === 408) return "The Salesforce preview timed out."
  if (status === 413) return "This form is too large to preview safely."
  if (status === 404) return "This form is no longer available."
  if (status === 401 || status === 403) return "Manager access is required to preview integrations."
  return "The Salesforce preview could not be completed."
}
