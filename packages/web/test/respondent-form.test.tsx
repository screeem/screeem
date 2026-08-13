// @vitest-environment jsdom

import type { FormDefinition } from "@screeem/forms"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FormEditor } from "../src/app/dashboard/forms/[formId]/FormEditor"
import { RespondentForm } from "../src/components/forms/RespondentForm"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("RespondentForm", () => {
  it("keeps answers editable after an invalid submit and accepts their corrections", async () => {
    const user = userEvent.setup()
    const submit = vi.fn()

    render(<RespondentForm definition={definition} onSubmit={submit} />)

    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(await screen.findByText("Name is required")).toBeTruthy()
    const name = screen.getByRole("textbox", { name: "Name" })
    const employees = screen.getByRole("spinbutton", { name: "Employees" })
    expect(name.hasAttribute("disabled")).toBe(false)
    expect(employees.hasAttribute("disabled")).toBe(false)
    expect(name.getAttribute("aria-required")).toBe("true")
    expect(employees.getAttribute("aria-required")).toBe("true")

    await user.type(name, "Ada Lovelace")
    await user.tab()
    await user.type(employees, "500")
    await user.tab()

    const button = screen.getByRole("button", { name: "Apply" })
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
    await user.click(button)

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({ name: "Ada Lovelace", employees: 500 })
    })
  })
})

describe("FormEditor", () => {
  it("opens an explicit null legacy draft as a new structured draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          draft: null,
          legacy: true,
          availability: "draft",
          publishedVersion: null,
          lastPublishedDraftRevision: null,
        }),
      }),
    )

    render(
      <FormEditor teamId="team-one" formId="form-one" initialName="Enterprise qualification" />,
    )

    expect(await screen.findByRole("heading", { name: "Enterprise qualification" })).toBeTruthy()
    expect(screen.getByText("New structured draft")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(false)
  })

  it("recovers from a failed draft request without leaving the editor busy", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: { revision: 0, definition },
            legacy: false,
            availability: "draft",
            publishedVersion: null,
            lastPublishedDraftRevision: null,
          }),
        })
        .mockRejectedValueOnce(new TypeError("network unavailable")),
    )

    render(<FormEditor teamId="team-one" formId="form-one" />)

    expect(await screen.findByRole("heading", { name: "Qualification" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "+ Short text" }))
    await user.click(screen.getByRole("button", { name: "Save draft" }))

    expect(await screen.findByText("Could not save the draft")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(false)
  })

  it("saves form and visual routing changes through the same revision sequence", async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        responseBody({
          draft: { revision: 4, definition, routing: visualRouting },
          legacy: false,
          availability: "draft",
          publishedVersion: null,
          lastPublishedDraftRevision: null,
        }),
      )
      .mockResolvedValueOnce(
        responseBody({ draft: { revision: 5, definition, routing: visualRouting } }),
      )
      .mockResolvedValueOnce(
        responseBody({ draft: { revision: 6, definition, routing: visualRouting } }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<FormEditor teamId="team-one" formId="form-one" />)

    expect(await screen.findByRole("heading", { name: "Qualification" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "+ Short text" }))
    await user.click(screen.getByRole("button", { name: "Routing" }))
    const fallback = screen.getByLabelText("If no rule matches, send to")
    await user.clear(fallback)
    await user.type(fallback, "manual-review")
    await user.click(screen.getByRole("button", { name: "Save draft" }))

    await waitFor(() => expect(screen.getByText("Draft saved · revision 6")).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/teams/team-one/forms/form-one/draft")
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      expectedRevision: 4,
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/teams/team-one/forms/form-one/draft/routing",
    )
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      expectedRevision: 5,
      routing: {
        fallback: "manual-review",
        authoring: { version: 1, fallback: "manual-review" },
      },
    })
  })

  it("preserves expression-only routing until replacement is explicit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseBody({
          draft: {
            revision: 2,
            definition,
            routing: {
              version: 1,
              rules: [{ id: "advanced", when: "submission.employees >= 500", route: "sales" }],
              fallback: "review",
            },
          },
          legacy: false,
          availability: "draft",
          publishedVersion: null,
          lastPublishedDraftRevision: null,
        }),
      ),
    )
    const user = userEvent.setup()

    render(<FormEditor teamId="team-one" formId="form-one" />)

    await screen.findByRole("heading", { name: "Qualification" })
    await user.click(screen.getByRole("button", { name: "Routing" }))
    expect(screen.getByText("This routing was created through the API")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true)
    await user.click(screen.getByRole("button", { name: "Replace with visual rules" }))
    expect(screen.getByText("No routing rules yet")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(false)
  })

  it("does not visually rewrite runtime actions when authoring metadata disagrees", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseBody({
          draft: {
            revision: 2,
            definition,
            routing: {
              ...visualRouting,
              rules: [
                {
                  ...visualRouting.rules[0],
                  actions: [{ use: "notifySales" }],
                },
              ],
            },
          },
          legacy: false,
          availability: "draft",
          publishedVersion: null,
          lastPublishedDraftRevision: null,
        }),
      ),
    )
    const user = userEvent.setup()

    render(<FormEditor teamId="team-one" formId="form-one" />)

    await screen.findByRole("heading", { name: "Qualification" })
    await user.click(screen.getByRole("button", { name: "Routing" }))
    expect(screen.getByText("This routing was created through the API")).toBeTruthy()
    expect(screen.queryByLabelText("If no rule matches, send to")).toBeNull()
  })

  it("blocks a routing edit that races an in-flight save", async () => {
    const routeSave = deferredResponse()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        responseBody({
          draft: { revision: 4, definition, routing: visualRouting },
          legacy: false,
          availability: "draft",
          publishedVersion: null,
          lastPublishedDraftRevision: null,
        }),
      )
      .mockImplementationOnce(() => routeSave.promise)
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<FormEditor teamId="team-one" formId="form-one" />)

    await screen.findByRole("heading", { name: "Qualification" })
    await user.click(screen.getByRole("button", { name: "Routing" }))
    const fallback = screen.getByLabelText("If no rule matches, send to")
    await user.clear(fallback)
    await user.type(fallback, "first-change")

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }))
    await waitFor(() => expect(fallback.matches(":disabled")).toBe(true))
    fireEvent.change(fallback, { target: { value: "second-change" } })
    expect(fallback).toHaveProperty("value", "first-change")
    act(() => {
      routeSave.resolve(
        responseBody({ draft: { revision: 5, definition, routing: visualRouting } }),
      )
    })

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(
        true,
      ),
    )
    expect(screen.queryByText(/Unsaved changes/)).toBeNull()
    expect(fallback).toHaveProperty("value", "first-change")
  })

  it("disables build inputs while their current values are being saved", async () => {
    const definitionSave = deferredResponse()
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          responseBody({
            draft: { revision: 4, definition, routing: null },
            legacy: false,
            availability: "draft",
            publishedVersion: null,
            lastPublishedDraftRevision: null,
          }),
        )
        .mockImplementationOnce(() => definitionSave.promise),
    )
    const user = userEvent.setup()

    render(<FormEditor teamId="team-one" formId="form-one" />)

    await screen.findByRole("heading", { name: "Qualification" })
    await user.click(screen.getByRole("button", { name: "+ Short text" }))
    const title = screen.getByRole("textbox", { name: "Form title" })
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }))

    await waitFor(() => expect(title.matches(":disabled")).toBe(true))
    expect(screen.getByRole("button", { name: "Routing" }).hasAttribute("disabled")).toBe(true)
    await user.type(title, "Unsaved title")
    expect(title).toHaveProperty("value", "Qualification")
    act(() => {
      definitionSave.resolve(
        responseBody({ draft: { revision: 5, definition, routing: null } }),
      )
    })

    await waitFor(() => expect(title.matches(":disabled")).toBe(false))
    expect(screen.queryByText(/Unsaved changes/)).toBeNull()
  })
})

const definition: FormDefinition = {
  formatVersion: 1,
  title: "Qualification",
  submitLabel: "Apply",
  successMessage: "Received",
  fields: [
    {
      id: "name-field",
      name: "name",
      label: "Name",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "employees-field",
      name: "employees",
      label: "Employees",
      required: true,
      type: "number",
      control: "number",
      validation: { min: 1 },
    },
  ],
}

const visualRouting = {
  version: 1 as const,
  rules: [
    {
      id: "enterprise",
      when: "(submission.employees >= 500)",
      route: "enterprise-sales",
    },
  ],
  fallback: "commercial",
  authoring: {
    version: 1 as const,
    rules: [
      {
        id: "enterprise",
        combinator: "all" as const,
        conditions: [
          {
            id: "employee-condition",
            fieldId: "employees-field",
            operator: "greater_than_or_equal" as const,
            value: 500,
          },
        ],
        route: "enterprise-sales",
      },
    ],
    fallback: "commercial",
  },
}

function responseBody(value: unknown) {
  return { ok: true, json: async () => value }
}

function deferredResponse() {
  let resolve!: (response: ReturnType<typeof responseBody>) => void
  const promise = new Promise<ReturnType<typeof responseBody>>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
