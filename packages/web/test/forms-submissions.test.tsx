// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { Forms } from "../src/app/dashboard/Forms"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("form submission routing results", () => {
  it("shows routing results and filters by destination", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          forms: [
            {
              id: "form-one",
              name: "Qualification",
              endpoint_key: "public-key",
              allowed_origin: null,
              success_url: null,
              is_active: true,
              requires_turnstile: false,
              submission_schema: null,
              legacy_unstructured: false,
              availability: "active",
              published_version: 2,
              created_at: "2026-08-13T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          routes: ["review", "sales"],
          submissions: [submission("matched", "sales", "enterprise")],
        }),
      )
      .mockResolvedValueOnce(
        response({
          routes: ["review", "sales"],
          submissions: [submission("fallback", "review", null)],
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Forms teamId="team-one" canManage={false} />)

    await user.click(await screen.findByRole("button", { name: "Submissions" }))
    expect((await screen.findByText(/Routed to/)).textContent).toContain(
      "sales · matched enterprise",
    )

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter submissions by destination" }),
      "review",
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls[2]?.[0]).toBe(
        "/api/teams/team-one/forms/form-one/submissions?route=review",
      )
    })
    expect((await screen.findByText(/fallback/)).textContent).toContain("review · fallback")
  })

  it("does not let a slower route filter replace the latest result", async () => {
    const sales = deferredResponse()
    const review = deferredResponse()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ forms: [form] }))
      .mockResolvedValueOnce(
        response({
          routes: ["review", "sales"],
          submissions: [submission("matched", "sales", "enterprise")],
        }),
      )
      .mockImplementationOnce(() => sales.promise)
      .mockImplementationOnce(() => review.promise)
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Forms teamId="team-one" canManage={false} />)
    await user.click(await screen.findByRole("button", { name: "Submissions" }))
    const filter = screen.getByRole("combobox", { name: "Filter submissions by destination" })
    await user.selectOptions(filter, "sales")
    await user.selectOptions(filter, "review")

    act(() => {
      review.resolve(
        response({
          routes: ["review", "sales"],
          submissions: [submission("fallback", "review", null)],
        }),
      )
    })
    expect((await screen.findByText(/fallback/)).textContent).toContain("review · fallback")

    act(() => {
      sales.resolve(
        response({
          routes: ["review", "sales"],
          submissions: [submission("matched", "sales", "enterprise")],
        }),
      )
    })
    await waitFor(() => expect(screen.queryByText(/matched enterprise/)).toBeNull())
  })

  it("discards submission state and requests when the team changes", async () => {
    const oldTeamSubmissions = deferredResponse()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ forms: [form] }))
      .mockImplementationOnce(() => oldTeamSubmissions.promise)
      .mockResolvedValueOnce(
        response({
          forms: [{ ...form, id: "form-two", name: "New team form", endpoint_key: "new-key" }],
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    const view = render(<Forms teamId="team-one" canManage={false} />)
    await user.click(await screen.findByRole("button", { name: "Submissions" }))
    view.rerender(<Forms teamId="team-two" canManage={false} />)
    expect(await screen.findByText("New team form")).toBeTruthy()

    act(() => {
      oldTeamSubmissions.resolve(
        response({
          routes: ["sales"],
          submissions: [submission("matched", "sales", "enterprise")],
        }),
      )
    })

    await waitFor(() => expect(screen.queryByText(/matched enterprise/)).toBeNull())
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/teams/team-two/forms")
  })
})

const form = {
  id: "form-one",
  name: "Qualification",
  endpoint_key: "public-key",
  allowed_origin: null,
  success_url: null,
  is_active: true,
  requires_turnstile: false,
  submission_schema: null,
  legacy_unstructured: false,
  availability: "active",
  published_version: 2,
  created_at: "2026-08-13T00:00:00.000Z",
}

function submission(
  routing_status: "matched" | "fallback",
  routing_route: string,
  matched_rule_id: string | null,
) {
  return {
    id: `${routing_status}-submission`,
    payload: { employees: 500 },
    origin: null,
    created_at: "2026-08-13T09:00:00.000Z",
    publication_version: 2,
    routing_status,
    routing_route,
    matched_rule_id,
    routing_error: null,
  }
}

function response(body: unknown) {
  return { ok: true, json: async () => body }
}

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof response>) => void
  const promise = new Promise<ReturnType<typeof response>>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
