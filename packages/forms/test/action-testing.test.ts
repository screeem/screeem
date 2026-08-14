import { describe, expect, it } from "vitest"
import {
  fallbackSubmissionRouting,
  snapshotFormActionTestContext,
  snapshotFormActionTestResult,
  snapshotFormActionTesters,
} from "../src/index.js"

const definition = {
  formatVersion: 1,
  title: "Lead form",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [
    {
      id: "email",
      name: "email",
      label: "Email",
      required: true,
      type: "string",
      control: "email",
    },
  ],
} as const

describe("form action testing", () => {
  it("snapshots the tester input and structured UI result", () => {
    const controller = new AbortController()
    const context = snapshotFormActionTestContext(
      {
        definition,
        submission: { email: "person@example.com" },
        routing: fallbackSubmissionRouting("sales"),
      },
      controller.signal,
    )
    const result = snapshotFormActionTestResult({
      status: "success",
      summary: "Notification preview ready",
      details: [{ label: "Recipient", value: "sales@example.invalid" }],
    })

    expect(context).toEqual({
      definition,
      submission: { email: "person@example.com" },
      routing: fallbackSubmissionRouting("sales"),
      signal: controller.signal,
    })
    expect(Object.isFrozen(context.submission)).toBe(true)
    expect(result.details?.[0]).toEqual({
      label: "Recipient",
      value: "sales@example.invalid",
    })
    expect(Object.isFrozen(result.details)).toBe(true)
  })

  it("rejects malformed or oversized tester output", () => {
    expect(() => snapshotFormActionTestResult({ status: "done", summary: "No" })).toThrow(
      "Action test status is invalid",
    )
    expect(() =>
      snapshotFormActionTestResult({
        status: "success",
        summary: "Okay",
        details: Array.from({ length: 21 }, () => ({ label: "x", value: "y" })),
      }),
    ).toThrow("more than 20")
  })

  it("rejects accessors at the result boundary", () => {
    const result = { status: "success", summary: "Okay" }
    Object.defineProperty(result, "summary", { get: () => "unsafe" })
    expect(() => snapshotFormActionTestResult(result)).toThrow("summary must be a data property")
  })

  it("rejects duplicate testers and misspelled result fields", () => {
    const tester = { actionName: "notify", label: "Notify", test: async () => ({
      status: "success" as const,
      summary: "Ready",
    }) }
    expect(() => snapshotFormActionTesters([tester, tester])).toThrow("Duplicate form action tester")
    expect(() =>
      snapshotFormActionTestResult({ status: "success", summary: "Ready", detail: [] }),
    ).toThrow("unexpected properties")
  })
})
