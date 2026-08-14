import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ drain: vi.fn() }))

vi.mock("@/lib/forms/form-event-deliveries", () => ({
  drainPendingFormEventDeliveries: mocks.drain,
}))
vi.mock("@/lib/forms/routing-persistence", () => ({
  createFormPersistence: () => ({}),
}))

import { GET } from "../src/app/api/internal/form-event-deliveries/route"

describe("form event delivery worker", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "worker-secret")
    mocks.drain.mockResolvedValue(3)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("rejects requests without the cron secret", async () => {
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.drain).not.toHaveBeenCalled()
  })

  it("drains pending deliveries for an authorized worker", async () => {
    const response = await GET(request("Bearer worker-secret"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 3 })
    expect(mocks.drain).toHaveBeenCalledOnce()
  })

  it("fails closed when the worker secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "")

    const response = await GET(request("Bearer worker-secret"))

    expect(response.status).toBe(503)
    expect(mocks.drain).not.toHaveBeenCalled()
  })
})

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/internal/form-event-deliveries", {
    headers: authorization ? { authorization } : {},
  })
}
