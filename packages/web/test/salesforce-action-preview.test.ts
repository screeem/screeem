import {
  matchedSubmissionRouting,
  type FormDefinition,
} from "@screeem/forms"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { SalesforceActionPreviewService } from "../src/lib/integrations/salesforce/action-preview-service"
import { createSalesforceLeadActionTester } from "../src/lib/integrations/salesforce/action-preview"

const teamId = "72000000-0000-0000-0000-000000000001"
const connectionId = "71000000-0000-0000-0000-000000000001"

describe("Salesforce action preview", () => {
  it("uses only the read-only describe boundary and returns a proposed mapping", async () => {
    const describeObject = vi.fn().mockResolvedValue(leadDescription())
    const upsertRecord = vi.fn()
    const resolve = vi.fn().mockResolvedValue({
      connection: connection(),
      client: { describeObject, upsertRecord },
    })
    const service = new SalesforceActionPreviewService({
      externalIdField: "Screeem_Delivery_Key__c",
      resolve,
    })
    const signal = new AbortController().signal

    const result = await service.previewLead(teamId as never, previewContext(), signal)

    expect(resolve).toHaveBeenCalledWith(teamId, signal)
    expect(describeObject).toHaveBeenCalledWith("Lead", signal)
    expect(upsertRecord).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: "success",
      summary: "Salesforce is ready for this Lead action.",
      details: [
        { label: "Operation", value: "Upsert Lead" },
        { label: "Organization", value: "Goldman Sachs" },
        { label: "Destination", value: "enterprise-sales" },
        { label: "External ID", value: "Screeem_Delivery_Key__c · generated when submitted" },
        { label: "Last name", value: "Lovelace" },
        { label: "Company", value: "Analytical Engines" },
        { label: "Email", value: "ada@example.com" },
      ],
    })
  })

  it("warns instead of inventing missing form mappings", async () => {
    const service = new SalesforceActionPreviewService({
      externalIdField: "Screeem_Delivery_Key__c",
      resolve: vi.fn().mockResolvedValue({
        connection: connection(),
        client: { describeObject: vi.fn().mockResolvedValue(leadDescription()) },
      }),
    })

    const result = await service.previewLead(
      teamId as never,
      {
        definition,
        submission: { last_name: "", company: "", email: "ada@example.com" },
        routing: matchedSubmissionRouting("enterprise-sales", "enterprise"),
        action: {
          id: "action-1",
          use: "crm.upsertLead",
          inputs: [
            { input: "lastName", fieldId: "last-name-field" },
            { input: "company", fieldId: "company-field" },
            { input: "email", fieldId: "email-field" },
          ],
          input: { lastName: "", company: "", email: "ada@example.com" },
        },
      },
      new AbortController().signal,
    )

    expect(result.status).toBe("warning")
    expect(result.details).toContainEqual({ label: "Last name", value: "Not mapped" })
    expect(result.details).toContainEqual({ label: "Company", value: "Not mapped" })
  })

  it("warns when the configured External ID is absent from Lead metadata", async () => {
    const description = leadDescription()
    const service = new SalesforceActionPreviewService({
      externalIdField: "Missing_External_Id__c",
      resolve: vi.fn().mockResolvedValue({
        connection: connection(),
        client: { describeObject: vi.fn().mockResolvedValue(description) },
      }),
    })

    const result = await service.previewLead(
      teamId as never,
      previewContext(),
      new AbortController().signal,
    )

    expect(result.status).toBe("warning")
    expect(result.details).toContainEqual({
      label: "Missing fields",
      value: "Missing_External_Id__c",
    })
  })

  it.each([
    ["ordinary field", { externalId: false }, "Screeem_Delivery_Key__c"],
    ["non-unique External ID", { unique: false }, "Screeem_Delivery_Key__c"],
    ["create-only mapped field", { updateable: false }, "Company"],
    ["update-only mapped field", { createable: false }, "Company"],
  ])("warns for an incompatible %s", async (_name, update, fieldName) => {
    const service = new SalesforceActionPreviewService({
      externalIdField: "Screeem_Delivery_Key__c",
      resolve: vi.fn().mockResolvedValue({
        connection: connection(),
        client: {
          describeObject: vi.fn().mockResolvedValue(descriptionWith(fieldName, update)),
        },
      }),
    })

    const result = await service.previewLead(
      teamId as never,
      previewContext(),
      new AbortController().signal,
    )

    expect(result.status).toBe("warning")
    expect(result.details).toContainEqual({
      label: "Incompatible fields",
      value: fieldName,
    })
  })

  it("rejects invalid action configuration before resolving tenant credentials", async () => {
    const resolve = vi.fn()
    const service = new SalesforceActionPreviewService({
      externalIdField: "not a Salesforce API name",
      resolve,
    })

    await expect(service.previewLead(
      teamId as never,
      previewContext(),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "invalid_configuration" })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("posts the canonical form context with the caller signal and validates the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "success",
      summary: "Salesforce is ready.",
      details: [{ label: "Operation", value: "Upsert Lead" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const tester = createSalesforceLeadActionTester(teamId, connectionId, fetcher)
    const signal = new AbortController().signal

    const result = await tester.test({
      definition,
      submission: submission(),
      routing: matchedSubmissionRouting("enterprise-sales", "enterprise"),
      action: previewAction(),
      signal,
    })

    expect(result.summary).toBe("Salesforce is ready.")
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(
      `/api/teams/${teamId}/forms/${connectionId}/actions/crm.upsertLead/preview`,
    )
    expect(init.signal).toBe(signal)
    expect(JSON.parse(String(init.body))).toEqual(previewContext())
  })

  it("maps disconnected and rate-limited responses to fixed local messages", async () => {
    const disconnected = createSalesforceLeadActionTester(
      teamId,
      connectionId,
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private database detail" }), {
        status: 409,
      })),
    )
    const limited = createSalesforceLeadActionTester(
      teamId,
      connectionId,
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private provider detail" }), {
        status: 429,
      })),
    )
    const context = {
      definition,
      submission: submission(),
      routing: matchedSubmissionRouting("enterprise-sales", "enterprise"),
      action: previewAction(),
      signal: new AbortController().signal,
    }

    await expect(disconnected.test(context)).rejects.toThrow(
      "Connect or reconnect Salesforce before previewing this action.",
    )
    await expect(limited.test(context)).rejects.toThrow(
      "Salesforce is rate limited. Try the preview again later.",
    )
  })
})

function previewContext() {
  return {
    definition,
    submission: submission(),
    routing: matchedSubmissionRouting("enterprise-sales", "enterprise"),
    action: previewAction(),
  }
}

function previewAction() {
  return {
    id: "action-1",
    use: "crm.upsertLead",
    inputs: [
      { input: "lastName", fieldId: "last-name-field" },
      { input: "company", fieldId: "company-field" },
      { input: "email", fieldId: "email-field" },
    ],
    input: {
      lastName: "Lovelace",
      company: "Analytical Engines",
      email: "ada@example.com",
    },
  }
}

function submission() {
  return {
    last_name: "Lovelace",
    company: "Analytical Engines",
    email: "ada@example.com",
  }
}

const definition: FormDefinition = {
  formatVersion: 1,
  title: "Lead qualification",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [
    {
      id: "last-name-field",
      name: "last_name",
      label: "Last name",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "company-field",
      name: "company",
      label: "Company",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "email-field",
      name: "email",
      label: "Work email",
      required: true,
      type: "string",
      control: "email",
    },
  ],
}

function connection() {
  return {
    id: connectionId,
    teamId,
    provider: "salesforce",
    revision: 1,
    status: "connected",
    health: "healthy",
    enabled: true,
    displayName: "Goldman Sachs",
    externalAccountId: "00D000000000001",
    lastErrorCode: null,
    lastCheckedAt: "2026-08-15T10:00:00.000Z",
    createdBy: null,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedBy: null,
    updatedAt: "2026-08-15T10:00:00.000Z",
    disabledBy: null,
    disabledAt: null,
    disconnectedBy: null,
    disconnectedAt: null,
  } as const
}

function leadDescription() {
  return {
    name: "Lead",
    label: "Lead",
    fields: ["LastName", "Company", "Email", "Screeem_Delivery_Key__c"].map((name) => ({
      name,
      label: name,
      type: "string",
      createable: true,
      updateable: true,
      nillable: name === "Email",
      externalId: name === "Screeem_Delivery_Key__c",
      unique: name === "Screeem_Delivery_Key__c",
    })),
  }
}

function descriptionWith(fieldName: string, update: Record<string, boolean>) {
  const description = leadDescription()
  return {
    ...description,
    fields: description.fields.map((field) =>
      field.name === fieldName ? { ...field, ...update } : field,
    ),
  }
}
