import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { SalesforceHttpClient } from "../src/lib/integrations/salesforce/client"
import { snapshotSalesforceAccessCredential } from "../src/lib/integrations/salesforce/contract"
import { SalesforceOAuthAdapter } from "../src/lib/integrations/salesforce/oauth"

const suite = process.env.SALESFORCE_SANDBOX_TESTS === "1" ? describe : describe.skip

suite("Salesforce sandbox contract", () => {
  it("refreshes and exercises identity, limits, and Lead describe", async () => {
    const previous = snapshotSalesforceAccessCredential({
      accessToken: required("SALESFORCE_SANDBOX_ACCESS_TOKEN"),
      refreshToken: required("SALESFORCE_SANDBOX_REFRESH_TOKEN"),
      instanceUrl: required("SALESFORCE_SANDBOX_INSTANCE_URL"),
      identityUrl: required("SALESFORCE_SANDBOX_IDENTITY_URL"),
      issuedAt: new Date().toISOString(),
    })
    const oauth = new SalesforceOAuthAdapter({
      clientId: required("SALESFORCE_SANDBOX_CLIENT_ID"),
      clientSecret: process.env.SALESFORCE_SANDBOX_CLIENT_SECRET || undefined,
      loginUrl: "https://test.salesforce.com",
      callbackUrl: "http://localhost:3000/api/integrations/salesforce/callback",
    })
    const refreshed = await oauth.refresh(previous.refreshToken, previous)
    const client = new SalesforceHttpClient(
      {
        async get() { return refreshed },
        async refresh() { return refreshed },
      },
      (token, signal) => oauth.revoke(token, signal),
    )

    await expect(client.identity()).resolves.toMatchObject({
      organizationId: expect.any(String),
      userId: expect.any(String),
    })
    await expect(client.testConnection()).resolves.toMatchObject({
      remaining: expect.anything(),
      maximum: expect.anything(),
    })
    await expect(client.describeObject("Lead")).resolves.toMatchObject({
      name: "Lead",
      fields: expect.any(Array),
    })
  }, 60_000)
})

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
