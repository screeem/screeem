import "server-only"

import {
  snapshotIntegrationConnection,
  snapshotIntegrationConnectionSummary,
  snapshotIntegrationIdentifier,
  snapshotIntegrationProviderName,
  snapshotIntegrationTeamControl,
  type IntegrationAvailabilityReason,
  type IntegrationConnection,
  type IntegrationConnectionSummary,
  type IntegrationIdentifier,
  type IntegrationProviderName,
  type IntegrationTeamControl,
} from "./contract"
import {
  snapshotStoredIntegrationCredential,
  type IntegrationConnectionStore,
  type IntegrationCredentialStore,
  type IntegrationTeamControlStore,
  type StoredIntegrationCredential,
} from "./stores"

export interface IntegrationProviderDescriptor {
  readonly name: IntegrationProviderName
  readonly displayName: string
  readonly enabled: boolean
}

export interface IntegrationProviderDefinition<Client> extends IntegrationProviderDescriptor {
  readonly open: (options: {
    readonly connection: IntegrationConnection
    readonly credential: StoredIntegrationCredential
  }) => Client | Promise<Client>
}

export interface ResolvedIntegration<Client> {
  readonly provider: IntegrationProviderDescriptor
  readonly connection: IntegrationConnection
  readonly client: Client
}

type StoredProvider = IntegrationProviderDefinition<unknown>

export class IntegrationProviderRegistry {
  private constructor(private readonly providers: ReadonlyMap<IntegrationProviderName, StoredProvider>) {}

  static create(): IntegrationProviderRegistry {
    return new IntegrationProviderRegistry(new Map())
  }

  register<Client>(input: IntegrationProviderDefinition<Client>): IntegrationProviderRegistry {
    const registration = snapshotDefinition(input)
    if (this.providers.has(registration.name)) {
      throw new Error(`Integration provider ${registration.name} is already registered`)
    }
    const providers = new Map(this.providers)
    providers.set(registration.name, registration as StoredProvider)
    return new IntegrationProviderRegistry(providers)
  }

  get(name: IntegrationProviderName): IntegrationProviderDescriptor | null {
    const registration = this.providers.get(snapshotIntegrationProviderName(name))
    return registration ? descriptor(registration) : null
  }

  list(): readonly IntegrationProviderDescriptor[] {
    return Object.freeze(
      [...this.providers.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(descriptor),
    )
  }

  summarize(
    inputConnection: IntegrationConnection,
    inputControl: IntegrationTeamControl,
    credentialPresent: boolean,
  ): IntegrationConnectionSummary {
    const connection = snapshotIntegrationConnection(inputConnection)
    const control = snapshotIntegrationTeamControl(inputControl)
    if (connection.teamId !== control.teamId) throw new TypeError("Integration scope mismatch")
    const registration = this.get(connection.provider)
    const availability = effectiveAvailability(
      registration,
      connection,
      control,
      credentialPresent,
    )
    return snapshotIntegrationConnectionSummary({
      id: connection.id,
      provider: connection.provider,
      revision: connection.revision,
      providerDisplayName: registration?.displayName ?? connection.provider,
      status: connection.status,
      health: connection.health,
      enabled: connection.enabled,
      availability,
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId,
      lastErrorCode: connection.lastErrorCode,
      lastCheckedAt: connection.lastCheckedAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    })
  }

  registeredDefinition<Client>(
    definition: IntegrationProviderDefinition<Client>,
  ): IntegrationProviderDefinition<Client> | null {
    const safe = snapshotDefinition(definition)
    const registered = this.providers.get(safe.name)
    if (!registered || registered.open !== safe.open) return null
    return registered as IntegrationProviderDefinition<Client>
  }
}

export class IntegrationResolutionError extends Error {
  constructor(
    readonly reason: Exclude<IntegrationAvailabilityReason, "available">,
    readonly provider: IntegrationProviderName,
  ) {
    super(`Integration ${provider} is unavailable`)
    this.name = "IntegrationResolutionError"
  }
}

export class IntegrationResolver {
  constructor(
    private readonly registry: IntegrationProviderRegistry,
    private readonly connections: IntegrationConnectionStore,
    private readonly controls: IntegrationTeamControlStore,
    private readonly credentials: IntegrationCredentialStore,
  ) {}

  async resolve<Client>(
    teamId: IntegrationIdentifier,
    definition: IntegrationProviderDefinition<Client>,
  ): Promise<ResolvedIntegration<Client>> {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const requestedProvider = snapshotDefinition(definition)
    const provider = this.registry.registeredDefinition(requestedProvider)
    if (!provider) {
      throw new IntegrationResolutionError("provider_unregistered", requestedProvider.name)
    }
    if (!provider.enabled) throw new IntegrationResolutionError("global_disabled", provider.name)

    const control = snapshotIntegrationTeamControl(await this.controls.get(safeTeamId))
    if (control.teamId !== safeTeamId) throw new TypeError("Integration scope mismatch")
    if (!control.enabled) throw new IntegrationResolutionError("team_disabled", provider.name)

    const storedConnection = await this.connections.getByProvider(safeTeamId, provider.name)
    if (!storedConnection) {
      throw new IntegrationResolutionError("connection_unavailable", provider.name)
    }
    const connection = snapshotIntegrationConnection(storedConnection)
    if (connection.teamId !== safeTeamId || connection.provider !== provider.name) {
      throw new TypeError("Integration scope mismatch")
    }
    if (!connection.enabled) {
      throw new IntegrationResolutionError("connection_disabled", provider.name)
    }
    if (connection.status !== "connected") {
      throw new IntegrationResolutionError("connection_unavailable", provider.name)
    }

    const loadedCredential = await this.credentials.load(safeTeamId, connection.id)
    if (!loadedCredential) {
      throw new IntegrationResolutionError("credentials_unavailable", provider.name)
    }
    const storedCredential = snapshotStoredIntegrationCredential(loadedCredential)
    if (
      storedCredential.teamId !== safeTeamId ||
      storedCredential.connectionId !== connection.id
    ) {
      throw new TypeError("Integration scope mismatch")
    }
    const client = await provider.open({
      connection,
      credential: snapshotStoredIntegrationCredential(storedCredential),
    })
    return Object.freeze({ provider: descriptor(provider), connection, client })
  }
}

export function defineIntegrationProvider<Client>(
  input: IntegrationProviderDefinition<Client>,
): IntegrationProviderDefinition<Client> {
  return snapshotDefinition(input)
}

export function createIntegrationProviderRegistry(): IntegrationProviderRegistry {
  return IntegrationProviderRegistry.create()
}

function effectiveAvailability(
  registration: IntegrationProviderDescriptor | null,
  connection: IntegrationConnection,
  control: IntegrationTeamControl,
  credentialPresent: boolean,
): IntegrationAvailabilityReason {
  if (!registration) return "provider_unregistered"
  if (!registration.enabled) return "global_disabled"
  if (!control.enabled) return "team_disabled"
  if (!connection.enabled) return "connection_disabled"
  if (connection.status !== "connected") return "connection_unavailable"
  if (!credentialPresent) return "credentials_unavailable"
  return "available"
}

function snapshotDefinition<Client>(
  input: IntegrationProviderDefinition<Client>,
): IntegrationProviderDefinition<Client> {
  let descriptors: PropertyDescriptorMap
  let symbols: readonly symbol[]
  try {
    descriptors = Object.getOwnPropertyDescriptors(input)
    symbols = Object.getOwnPropertySymbols(input)
  } catch {
    throw new TypeError("Invalid integration provider registration")
  }
  const keys = Object.keys(descriptors)
  if (
    keys.length !== 4 ||
    !("name" in descriptors) ||
    !("displayName" in descriptors) ||
    !("enabled" in descriptors) ||
    !("open" in descriptors) ||
    symbols.length > 0
  ) {
    throw new TypeError("Invalid integration provider registration")
  }
  const name = snapshotIntegrationProviderName(dataValue(descriptors.name))
  const displayName = dataValue(descriptors.displayName)
  const enabled = dataValue(descriptors.enabled)
  const open = dataValue(descriptors.open)
  if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 80) {
    throw new TypeError("Invalid integration provider display name")
  }
  if (typeof enabled !== "boolean") throw new TypeError("Invalid integration provider state")
  if (typeof open !== "function") throw new TypeError("Invalid integration provider adapter")
  return Object.freeze({ name, displayName, enabled, open }) as IntegrationProviderDefinition<Client>
}

function descriptor(provider: StoredProvider): IntegrationProviderDescriptor {
  return Object.freeze({
    name: provider.name,
    displayName: provider.displayName,
    enabled: provider.enabled,
  })
}

function dataValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Invalid integration provider registration")
  }
  return descriptor.value
}
