import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { snapshotIntegrationIdentifier, snapshotIntegrationProviderName } from "../src/lib/integrations/contract"
import {
  MemoryIntegrationConnectionStore,
  MemoryIntegrationCredentialStore,
  MemoryIntegrationTeamControlStore,
} from "../src/lib/integrations/memory-stores"
import {
  createIntegrationProviderRegistry,
  defineIntegrationProvider,
  IntegrationResolutionError,
  IntegrationResolver,
  type IntegrationProviderReference,
} from "../src/lib/integrations/provider-registry"
import { snapshotSealedIntegrationCredential } from "../src/lib/integrations/stores"
import { snapshotIntegrationType } from "@screeem/forms"

const now = "2026-08-14T10:00:00.000Z"
const teamOne = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000001")
const teamTwo = snapshotIntegrationIdentifier("72000000-0000-0000-0000-000000000002")
const userOne = snapshotIntegrationIdentifier("73000000-0000-0000-0000-000000000001")
const providerName = snapshotIntegrationProviderName("example")
const open = vi.fn(({ connection }) => ({ connectionId: connection.id }))

function provider(enabled = true) {
  return defineIntegrationProvider({
    name: providerName,
    type: snapshotIntegrationType("example"),
    displayName: "Example",
    enabled,
    open,
  })
}

describe("integration provider registry", () => {
  it("snapshots registrations and rejects a duplicate name", () => {
    const definition = { ...provider() }
    const registry = createIntegrationProviderRegistry().register(definition)
    definition.displayName = "Mutated"

    expect(registry.get(providerName)?.displayName).toBe("Example")
    expect(() => registry.register({ ...definition, displayName: "Second" })).toThrow(
      "already registered",
    )
    expect(createIntegrationProviderRegistry().get(providerName)).toBeNull()
  })

  it("requires credential presence before reporting availability", async () => {
    const registry = createIntegrationProviderRegistry().register(provider())
    const connections = new MemoryIntegrationConnectionStore()
    const connection = await connections.create(teamOne, {
      provider: providerName,
      status: "connected",
      actorId: userOne,
      createdAt: now,
    })
    const controls = new MemoryIntegrationTeamControlStore()

    expect(registry.summarize(connection, await controls.get(teamOne), false)).toMatchObject({
      availability: "credentials_unavailable",
    })
    expect(registry.summarize(connection, await controls.get(teamOne), true)).toMatchObject({
      availability: "available",
    })
  })

  describe("resolver", () => {
    let connections: MemoryIntegrationConnectionStore
    let credentials: MemoryIntegrationCredentialStore
    let controls: MemoryIntegrationTeamControlStore

    beforeEach(() => {
      vi.clearAllMocks()
      connections = new MemoryIntegrationConnectionStore()
      credentials = new MemoryIntegrationCredentialStore(connections)
      controls = new MemoryIntegrationTeamControlStore()
    })

    it("opens a provider client without returning serializable credentials", async () => {
      const connection = await connections.create(teamOne, {
        provider: providerName,
        status: "connected",
        actorId: userOne,
        createdAt: now,
      })
      await credentials.compareAndSet(
        teamOne,
        connection.id,
        null,
        snapshotSealedIntegrationCredential({ keyId: "key-v1", sealed: "v1.Y2lwaGVy" }),
        now,
      )
      const definition = provider()
      const registry = createIntegrationProviderRegistry().register(definition)
      const resolver = new IntegrationResolver(
        registry,
        connections,
        controls,
        credentials,
      )
      const reference = registry.reference(definition)

      const resolved = await resolver.resolve(teamOne, reference)
      expect(resolved.client).toEqual({ connectionId: connection.id })
      expect(JSON.stringify(resolved)).not.toMatch(/credential|cipher|key-v1/i)
      await expect(resolver.resolve(teamTwo, reference)).rejects.toMatchObject({
        reason: "connection_unavailable",
      })
    })

    it("rejects a store result outside the requested tenant before reading credentials", async () => {
      const connection = await connections.create(teamTwo, {
        provider: providerName,
        status: "connected",
        actorId: userOne,
        createdAt: now,
      })
      vi.spyOn(connections, "getByProvider").mockResolvedValue(connection)
      const load = vi.spyOn(credentials, "load")
      const definition = provider()
      const registry = createIntegrationProviderRegistry().register(definition)
      const resolver = new IntegrationResolver(
        registry,
        connections,
        controls,
        credentials,
      )

      await expect(resolver.resolve(teamOne, registry.reference(definition))).rejects.toThrow(
        "scope mismatch",
      )
      expect(load).not.toHaveBeenCalled()
    })

    it("does not reread a hostile registration after snapshotting it", async () => {
      const definition = provider()
      const registry = createIntegrationProviderRegistry().register(definition)
      const hostile = new Proxy({
        name: providerName,
        type: snapshotIntegrationType("example"),
      }, {
        get(target, property, receiver) {
          if (property === "name") throw new Error("secret from getter")
          return Reflect.get(target, property, receiver)
        },
      }) as unknown as IntegrationProviderReference<unknown>
      const resolver = new IntegrationResolver(
        registry,
        connections,
        controls,
        credentials,
      )

      await expect(resolver.resolve(teamOne, hostile)).rejects.toMatchObject({
        reason: "provider_unregistered",
        provider: providerName,
      })
      expect(open).not.toHaveBeenCalled()
    })

    it("does not open a provider after resolution is aborted", async () => {
      const connection = await connections.create(teamOne, {
        provider: providerName,
        status: "connected",
        actorId: userOne,
        createdAt: now,
      })
      await credentials.compareAndSet(
        teamOne,
        connection.id,
        null,
        snapshotSealedIntegrationCredential({ keyId: "key-v1", sealed: "v1.Y2lwaGVy" }),
        now,
      )
      const stored = await credentials.load(teamOne, connection.id)
      let releaseCredential!: () => void
      const load = vi.spyOn(credentials, "load").mockImplementation(() =>
        new Promise((resolve) => {
          releaseCredential = () => resolve(stored)
        }),
      )
      const definition = provider()
      const registry = createIntegrationProviderRegistry().register(definition)
      const resolver = new IntegrationResolver(registry, connections, controls, credentials)
      const controller = new AbortController()

      const resolution = resolver.resolve(
        teamOne,
        registry.reference(definition),
        controller.signal,
      )
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
      controller.abort()
      releaseCredential()

      await expect(resolution).rejects.toMatchObject({ name: "AbortError" })
      expect(open).not.toHaveBeenCalled()
    })

    it.each([
      ["global", "global_disabled"],
      ["team", "team_disabled"],
      ["connection", "connection_disabled"],
    ] as const)("blocks %s kill switches before loading credentials", async (level, reason) => {
      const connection = await connections.create(teamOne, {
        provider: providerName,
        status: "connected",
        enabled: level !== "connection",
        actorId: userOne,
        createdAt: now,
      })
      if (level === "team") await controls.setEnabled(teamOne, null, false, userOne, now)
      const load = vi.spyOn(credentials, "load")
      const definition = provider(level !== "global")
      const registry = createIntegrationProviderRegistry().register(definition)
      const resolver = new IntegrationResolver(
        registry,
        connections,
        controls,
        credentials,
      )

      await expect(resolver.resolve(teamOne, registry.reference(definition))).rejects.toEqual(
        expect.objectContaining<Partial<IntegrationResolutionError>>({ reason }),
      )
      expect(load).not.toHaveBeenCalled()
      expect(connection.provider).toBe(providerName)
    })
  })
})
