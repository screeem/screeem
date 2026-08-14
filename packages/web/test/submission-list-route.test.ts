import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getMembership: vi.fn(),
  createAdminClient: vi.fn(),
  listRecentRoutes: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock("@/lib/teams/server", () => ({ getMembership: mocks.getMembership }))
vi.mock("../src/lib/forms/routing-persistence", () => ({
  createFormPersistence: () => ({ listRecentRoutes: mocks.listRecentRoutes }),
}))

import { GET } from "../src/app/api/teams/[teamId]/forms/[formId]/submissions/route"

const context = { params: Promise.resolve({ teamId: "team-one", formId: "form-one" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-one" } } })
  mocks.getMembership.mockResolvedValue({ role: "owner" })
  mocks.listRecentRoutes.mockResolvedValue(["review", "sales"])
})

describe("submission routing filters", () => {
  it("rejects another tenant before opening the admin store", async () => {
    mocks.getMembership.mockResolvedValue(null)

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it("filters by route inside the selected tenant and returns available routes", async () => {
    const formQuery = query({ data: { id: "form-one" }, error: null })
    const submissionsQuery = query({
      data: [submissionRow()],
      error: null,
    })
    const deliveriesQuery = query({
      data: [
        {
          submission_id: "submission-one",
          delivery_key: "submission-one:routing.matched:0",
          registration_name: "notify",
          event_type: "routing.matched",
          delivery_kind: "routing_action",
          status: "succeeded",
          attempt_count: 1,
          last_error: null,
        },
      ],
      error: null,
    })
    const from = vi
      .fn()
      .mockReturnValueOnce(formQuery)
      .mockReturnValueOnce(submissionsQuery)
      .mockReturnValueOnce(deliveriesQuery)
    mocks.createAdminClient.mockReturnValue({ from })

    const response = await GET(request("sales"), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      submissions: [
        {
          id: "submission-one",
          payload: { employees: 500 },
          origin: null,
          created_at: "2026-08-13T09:00:00.000Z",
          publication_version: 2,
          routing_status: "matched",
          routing_route: "sales",
          matched_rule_id: "enterprise",
          routing_error: null,
          event_deliveries: [
            {
              submission_id: "submission-one",
              delivery_key: "submission-one:routing.matched:0",
              registration_name: "notify",
              event_type: "routing.matched",
              delivery_kind: "routing_action",
              status: "succeeded",
              attempt_count: 1,
              last_error: null,
            },
          ],
        },
      ],
      routes: ["review", "sales"],
    })
    expect(submissionsQuery.eq).toHaveBeenCalledWith("team_id", "team-one")
    expect(submissionsQuery.eq).toHaveBeenCalledWith("form_id", "form-one")
    expect(submissionsQuery.eq).toHaveBeenCalledWith("routing_route", "sales")
    expect(mocks.listRecentRoutes).toHaveBeenCalledWith("team-one", "form-one")
    expect(deliveriesQuery.eq).toHaveBeenCalledWith("team_id", "team-one")
    expect(deliveriesQuery.eq).toHaveBeenCalledWith("form_id", "form-one")
    expect(deliveriesQuery.in).toHaveBeenCalledWith("submission_id", ["submission-one"])
    expect(deliveriesQuery.order).toHaveBeenCalledWith("stream_sequence", { ascending: true })
    expect(deliveriesQuery.limit).toHaveBeenCalledWith(1000)
  })

  it("rejects an oversized route filter before querying storage", async () => {
    const response = await GET(request("x".repeat(257)), context)

    expect(response.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it("returns a storage error when event deliveries cannot be loaded", async () => {
    const formQuery = query({ data: { id: "form-one" }, error: null })
    const submissionsQuery = query({
      data: [submissionRow()],
      error: null,
    })
    const deliveriesQuery = query({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find public.form_event_deliveries in the schema cache",
      },
    })
    const from = vi
      .fn()
      .mockReturnValueOnce(formQuery)
      .mockReturnValueOnce(submissionsQuery)
      .mockReturnValueOnce(deliveriesQuery)
    mocks.createAdminClient.mockReturnValue({
      from,
    })
    mocks.listRecentRoutes.mockResolvedValueOnce(["sales"])

    const response = await GET(request(), context)

    expect(response.status).toBe(500)
  })

  it("rejects malformed successful storage results", async () => {
    const formQuery = query({ data: { id: "form-one" }, error: null })
    const submissionsQuery = query({ data: [submissionRow()], error: null })
    const actionsQuery = query({
      data: [{
        submission_id: "submission-one",
        delivery_key: "delivery-one",
        registration_name: "notify",
        event_type: "unknown.event",
        status: "pending",
        attempt_count: 0,
        last_error: null,
      }],
      error: null,
    })
    const from = vi
      .fn()
      .mockReturnValueOnce(formQuery)
      .mockReturnValueOnce(submissionsQuery)
      .mockReturnValueOnce(actionsQuery)
    mocks.createAdminClient.mockReturnValue({
      from,
    })
    mocks.listRecentRoutes.mockResolvedValueOnce(["sales"])

    const response = await GET(request(), context)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Stored submission data is invalid" })
  })

  it("does not turn a malformed route collection into an empty result", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(query({ data: { id: "form-one" }, error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
    mocks.createAdminClient.mockReturnValue({ from })
    mocks.listRecentRoutes.mockResolvedValueOnce(null)

    const response = await GET(request(), context)

    expect(response.status).toBe(500)
  })

  it("rejects a route result beyond the response bound", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(query({ data: { id: "form-one" }, error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
    mocks.createAdminClient.mockReturnValue({ from })
    mocks.listRecentRoutes.mockResolvedValueOnce(
      Array.from({ length: 257 }, (_, index) => `route-${index}`),
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(500)
  })
})

function request(route?: string) {
  const url = new URL("http://localhost/api/teams/team-one/forms/form-one/submissions")
  if (route !== undefined) url.searchParams.set("route", route)
  return new NextRequest(url)
}

function submissionRow() {
  return {
    id: "submission-one",
    payload: { employees: 500 },
    publication_version: 2,
    routing_status: "matched",
    routing_route: "sales",
    matched_rule_id: "enterprise",
    routing_error: null,
    origin: null,
    created_at: "2026-08-13T09:00:00.000Z",
  }
}

function query(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(result)
  builder.order.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.not.mockReturnValue(builder)
  return builder
}
