import { describe, expect, it, vi } from "vitest"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationListResponse,
  snapshotIntegrationProviderName,
} from "../src/lib/integrations/contract"
import {
  SealedIntegrationCredential,
  snapshotSealedIntegrationCredential,
} from "../src/lib/integrations/stores"

vi.mock("server-only", () => ({}))

const connectionId = "71000000-0000-0000-0000-000000000001"
const teamId = "72000000-0000-0000-0000-000000000001"
const userId = "73000000-0000-0000-0000-000000000001"

describe("integration contracts", () => {
  it("snapshots safe connection metadata without retaining caller state", () => {
    const source = connection()
    const snapshot = snapshotIntegrationConnection(source)
    source.displayName = "Changed"

    expect(snapshot.displayName).toBe("Sales workspace")
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it("canonicalizes identifiers and rejects unknown response fields", () => {
    expect(snapshotIntegrationIdentifier(teamId.toUpperCase())).toBe(teamId)
    expect(() => snapshotIntegrationIdentifier("team-one")).toThrow("Invalid integration identifier")
    expect(() => snapshotIntegrationProviderName("Salesforce")).toThrow(
      "Invalid integration provider",
    )
    expect(() =>
      snapshotIntegrationListResponse({ integrations: [], credentials: "secret" }),
    ).toThrow("Invalid integration list response")
  })

  it("keeps the credential envelope exact, redacted, and byte bounded", () => {
    const credential = snapshotSealedIntegrationCredential({
      keyId: "integration-key-v1",
      sealed: "v1.b3BhcXVlLWNpcGhlcnRleHQ",
    })

    expect(credential.keyId).toBe("integration-key-v1")
    expect(credential.sealed).toBe("v1.b3BhcXVlLWNpcGhlcnRleHQ")
    expect(JSON.stringify(credential)).toBe('"[REDACTED]"')
    expect(() =>
      snapshotSealedIntegrationCredential({
        keyId: "integration-key-v1",
        sealed: "actual-access-token",
      }),
    ).toThrow("Invalid sealed integration credential")
    expect(() => SealedIntegrationCredential.create("key-v1", "actual-access-token")).toThrow(
      "Invalid sealed integration credential",
    )
    expect(() =>
      SealedIntegrationCredential.create("key-v1", `v1.${"x".repeat(131_073)}`),
    ).toThrow("Invalid sealed integration credential")
  })

  it("rejects connection states that cannot exist in Postgres", () => {
    expect(() =>
      snapshotIntegrationConnection({ ...connection(), enabled: false, disabledAt: null }),
    ).toThrow("Invalid integration disabled state")
    expect(() =>
      snapshotIntegrationConnection({
        ...connection(),
        status: "connected",
        disconnectedAt: "2026-08-14T10:00:00.000Z",
      }),
    ).toThrow("Invalid integration disconnected state")
  })
})

function connection() {
  return {
    id: connectionId,
    teamId,
    provider: "example",
    revision: 1,
    status: "connected" as const,
    health: "healthy" as const,
    enabled: true,
    displayName: "Sales workspace",
    externalAccountId: "external-one",
    lastErrorCode: null,
    lastCheckedAt: "2026-08-14T10:00:00.000Z",
    createdBy: userId,
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedBy: userId,
    updatedAt: "2026-08-14T10:00:00.000Z",
    disabledBy: null,
    disabledAt: null,
    disconnectedBy: null,
    disconnectedAt: null,
  }
}
