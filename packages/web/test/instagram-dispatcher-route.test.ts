import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { GET } from "../src/app/api/internal/instagram-dispatcher/route"

function request(secret: string | null): NextRequest {
  const headers = new Headers()
  if (secret !== null) headers.set("authorization", `Bearer ${secret}`)
  return new NextRequest("http://localhost:3000/api/internal/instagram-dispatcher", { headers })
}

describe("instagram dispatcher route auth", () => {
  it("returns 503 when the worker is not configured", async () => {
    const previous = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      const response = await GET(request("anything"))
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        error: "Instagram dispatcher is not configured",
      })
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previous
    }
  })

  it("returns 401 for a wrong bearer token", async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = "test-secret"
    try {
      const response = await GET(request("wrong"))
      expect(response.status).toBe(401)
      const missing = await GET(new NextRequest(
        "http://localhost:3000/api/internal/instagram-dispatcher",
      ))
      expect(missing.status).toBe(401)
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previous
    }
  })
})
