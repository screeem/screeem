import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getMembership: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock("@/lib/teams/server", () => ({ getMembership: mocks.getMembership }))

import { GET } from "../src/app/api/teams/[teamId]/forms/[formId]/submissions/route"

const context = { params: Promise.resolve({ teamId: "team-one", formId: "form-one" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-one" } } })
  mocks.getMembership.mockResolvedValue({ role: "owner" })
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
      data: [{ id: "submission-one", routing_route: "sales" }],
      error: null,
    })
    const routesResult = {
      data: [{ route: "review" }, { route: "sales" }],
      error: null,
    }
    const rpc = vi.fn().mockResolvedValue(routesResult)
    const from = vi
      .fn()
      .mockReturnValueOnce(formQuery)
      .mockReturnValueOnce(submissionsQuery)
    mocks.createAdminClient.mockReturnValue({ from, rpc })

    const response = await GET(request("sales"), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      submissions: [{ id: "submission-one", routing_route: "sales" }],
      routes: ["review", "sales"],
    })
    expect(submissionsQuery.eq).toHaveBeenCalledWith("team_id", "team-one")
    expect(submissionsQuery.eq).toHaveBeenCalledWith("form_id", "form-one")
    expect(submissionsQuery.eq).toHaveBeenCalledWith("routing_route", "sales")
    expect(rpc).toHaveBeenCalledWith("list_form_submission_routes", {
      target_team_id: "team-one",
      target_form_id: "form-one",
    })
  })

  it("rejects an oversized route filter before querying storage", async () => {
    const response = await GET(request("x".repeat(257)), context)

    expect(response.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})

function request(route?: string) {
  const url = new URL("http://localhost/api/teams/team-one/forms/form-one/submissions")
  if (route !== undefined) url.searchParams.set("route", route)
  return new NextRequest(url)
}

function query(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    not: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(result)
  builder.order.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  builder.not.mockReturnValue(builder)
  return builder
}
