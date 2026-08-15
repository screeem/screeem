import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  getMembership: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("../src/lib/teams/server", () => ({
  canManage: (role: string) => role === "owner" || role === "admin",
  getMembership: mocks.getMembership,
}))

import { authorizeTeam } from "../src/lib/teams/authorization"

describe("team authorization cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stops waiting for a deferred user lookup when the request is aborted", async () => {
    const controller = new AbortController()
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: mocks.getUser } })
    mocks.getUser.mockReturnValueOnce(new Promise(() => undefined))

    const pending = authorizeTeam(
      "72000000-0000-0000-0000-000000000001",
      true,
      controller.signal,
    )
    controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(mocks.getMembership).not.toHaveBeenCalled()
  })

  it("passes the request signal through the membership boundary", async () => {
    const controller = new AbortController()
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: mocks.getUser } })
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "user-one" } } })
    mocks.getMembership.mockResolvedValueOnce({ role: "owner" })

    await expect(authorizeTeam(
      "72000000-0000-0000-0000-000000000001",
      true,
      controller.signal,
    )).resolves.toMatchObject({ membership: { role: "owner" } })

    expect(mocks.getMembership).toHaveBeenCalledWith(
      "user-one",
      "72000000-0000-0000-0000-000000000001",
      controller.signal,
    )
  })
})
