import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { proxy } from "../src/proxy"

describe("development playground proxy", () => {
  it("bypasses Supabase for the canonical playground URL", async () => {
    const response = await proxy(new NextRequest("http://127.0.0.1:43817/_dev/form-builder"))

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("redirects the encoded filesystem path to the canonical playground URL", async () => {
    const request = new NextRequest("http://127.0.0.1:43817/%5Fdev/form-builder?fixture=lead")
    const response = await proxy(request)

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/_dev/form-builder")
    expect(location.search).toBe("?fixture=lead")
  })
})
