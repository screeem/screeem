// @vitest-environment jsdom

import type { FormDefinition } from "@screeem/forms"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
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
