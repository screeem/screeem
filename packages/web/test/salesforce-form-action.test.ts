import {
  matchedSubmissionRouting,
  type FormDefinition,
  type FormRoutingDefinition,
} from "@screeem/forms"
import type { RoutingActionFailure } from "@screeem/routing"
import { describe, expect, it, vi } from "vitest"
import {
  executeFormEventDeliveries,
  orderFormEventDeliveries,
  planFormRoutingDeliveries,
  type FormEventDeliveryStore,
} from "../src/lib/forms/form-event-deliveries"
import { snapshotFormEvent } from "../src/lib/forms/form-actions"
import { createFormAutomationRegistry } from "../src/lib/forms/form-automation-registry"
import type {
  IntegrationAutomationAccess,
  IntegrationAutomationRuntime,
} from "../src/lib/integrations/automation-runtime"
import { snapshotIntegrationProviderName } from "../src/lib/integrations/contract"
import {
  createIntegrationProviderRegistry,
  defineIntegrationProvider,
  IntegrationResolutionError,
} from "../src/lib/integrations/provider-registry"
import {
  createSalesforceUpsertLeadAction,
} from "../src/lib/integrations/salesforce/action"
import { FakeSalesforceClient } from "../src/lib/integrations/salesforce/client"
import { SalesforceError } from "../src/lib/integrations/salesforce/contract"

vi.mock("server-only", () => ({}))

describe("Salesforce form action", () => {
  it("uses the tenant-bound client and stable delivery key for one logical upsert", async () => {
    const client = new FakeSalesforceClient()
    const runtime = runtimeFor(client)
    const registry = registryFor(runtime)
    const store = new DeliveryStore()

    await execute(store, registry)
    await execute(store, registry)

    expect(runtime.forTenant).toHaveBeenCalledWith(tenantId)
    expect(client.upserts).toEqual([{
      objectName: "Lead",
      externalIdField: "Screeem_Delivery_Key__c",
      externalId: `${submissionId}:routing.matched:0`,
      values: {
        LastName: "Lovelace",
        Company: "Analytical Engines",
        Email: "ada@example.com",
      },
    }])
    expect(store.output).toEqual({ id: "00Q000000000001", created: true })
  })

  it("preserves a bounded Salesforce rate-limit disposition", async () => {
    const client = new FakeSalesforceClient()
    client.upsertRecord = vi.fn().mockRejectedValue(
      new SalesforceError("rate_limited", true, 180_000),
    )
    const store = new DeliveryStore()

    await execute(store, registryFor(runtimeFor(client)))

    expect(store.failure).toEqual({
      code: "salesforce_rate_limited",
      retryable: true,
      retryAfterMs: 180_000,
    })
  })

  it("reuses the durable idempotency key when local completion is ambiguous", async () => {
    const client = new FakeSalesforceClient()
    const upsert = vi.spyOn(client, "upsertRecord")
    const registry = registryFor(runtimeFor(client))
    const store = new AmbiguousSuccessStore()

    await expect(execute(store, registry)).rejects.toThrow("completion unavailable")
    await execute(store, registry)

    expect(upsert.mock.calls.map((call) => call[2])).toEqual([
      `${submissionId}:routing.matched:0`,
      `${submissionId}:routing.matched:0`,
    ])
    expect(store.output).toEqual({ id: "00Q000000000001", created: true })
  })

  it("returns a typed terminal failure when the event tenant is disabled", async () => {
    const runtime = runtimeRejecting(
      new IntegrationResolutionError("team_disabled", provider.name),
    )
    const store = new DeliveryStore()

    await execute(store, registryFor(runtime))

    expect(runtime.forTenant).toHaveBeenCalledWith(tenantId)
    expect(store.failure).toEqual({
      code: "integration_team_disabled",
      retryable: false,
      retryAfterMs: null,
    })
  })

  it("classifies an expired Salesforce credential as requiring reauthorization", async () => {
    const client = new FakeSalesforceClient()
    vi.spyOn(client, "upsertRecord").mockRejectedValueOnce(
      new SalesforceError("authentication_failed", false),
    )
    const store = new DeliveryStore()

    await execute(store, registryFor(runtimeFor(client)))

    expect(store.failure).toEqual({
      code: "salesforce_reauthorization_required",
      retryable: false,
      retryAfterMs: null,
    })
  })

  it("fails malformed external-id configuration without resolving credentials", async () => {
    const client = new FakeSalesforceClient()
    const runtime = runtimeFor(client)
    const store = new DeliveryStore()

    await execute(store, registryFor(runtime, "not a Salesforce API name"))

    expect(store.failure).toEqual({
      code: "salesforce_invalid_configuration",
      retryable: false,
      retryAfterMs: null,
    })
    expect(runtime.open).not.toHaveBeenCalled()
  })

  it("aborts the provider operation at the action timeout", async () => {
    vi.useFakeTimers()
    try {
      const client = new FakeSalesforceClient()
      let observedSignal: AbortSignal | undefined
      client.upsertRecord = vi.fn(
        async (_object, _field, _id, _values, signal) => {
          observedSignal = signal
          return await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new SalesforceError("provider_unavailable", true)),
              { once: true },
            )
          })
        },
      )
      const execution = execute(new DeliveryStore(), registryFor(runtimeFor(client)))

      await vi.advanceTimersByTimeAsync(14_001)
      await execution

      expect(observedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

const tenantId = "00000000-0000-4000-8000-000000000001"
const submissionId = "00000000-0000-4000-8000-000000000002"

const providerDefinition = defineIntegrationProvider({
  name: snapshotIntegrationProviderName("salesforce"),
  displayName: "Salesforce",
  enabled: true,
  open: async () => new FakeSalesforceClient(),
})
const providerRegistry = createIntegrationProviderRegistry().register(providerDefinition)
const provider = providerRegistry.reference(providerDefinition)

const definition: FormDefinition = {
  formatVersion: 1,
  title: "Lead",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [
    {
      id: "last-name",
      name: "lastName",
      label: "Last name",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "company",
      name: "company",
      label: "Company",
      required: true,
      type: "string",
      control: "text",
    },
    {
      id: "email",
      name: "email",
      label: "Email",
      required: true,
      type: "string",
      control: "email",
    },
  ],
}

const routing: FormRoutingDefinition = {
  version: 1,
  rules: [{
    id: "sales",
    when: "true",
    route: "salesforce",
    actions: [{
      use: "salesforceUpsertLead",
      with: "({ lastName: submission.lastName, company: submission.company, email: submission.email })",
    }],
  }],
  fallback: "review",
}

function registryFor(
  runtime: IntegrationAutomationRuntime,
  externalIdField = "Screeem_Delivery_Key__c",
) {
  return createFormAutomationRegistry(runtime).registerAction(
    createSalesforceUpsertLeadAction(provider, externalIdField),
  )
}

function runtimeFor(client: FakeSalesforceClient) {
  return runtimeOpening(async () => client)
}

function runtimeRejecting(error: Error) {
  return runtimeOpening(async () => { throw error })
}

function runtimeOpening(open: () => Promise<FakeSalesforceClient>) {
  const openClient = vi.fn(open)
  const access: IntegrationAutomationAccess = {
    open: async <Client>() => await openClient() as unknown as Client,
  }
  return {
    forTenant: vi.fn(() => access),
    open: openClient,
  }
}

async function execute(
  store: DeliveryStore,
  registry: ReturnType<typeof registryFor>,
) {
  const event = snapshotFormEvent({
    eventId: `${submissionId}:routing.matched`,
    type: "routing.matched",
    occurredAt: "2026-08-15T00:00:00.000Z",
    tenantId,
    formId: "00000000-0000-4000-8000-000000000003",
    payload: {
      publicationVersion: 1,
      submissionId,
      submission: {
        lastName: "Lovelace",
        company: "Analytical Engines",
        email: "ada@example.com",
      },
      ruleId: "sales",
      route: "salesforce",
    },
  }) as import("../src/lib/forms/form-actions").FormEvent<"routing.matched">
  const deliveries = orderFormEventDeliveries(
    planFormRoutingDeliveries(
      routing,
      matchedSubmissionRouting("salesforce", "sales"),
      event,
      registry,
    ),
    {
      tenantId,
      formId: event.formId,
      publicationVersion: 1,
      submissionId,
    },
  )
  return executeFormEventDeliveries({ definition, routing, deliveries, store, registry })
}

class DeliveryStore implements FormEventDeliveryStore {
  output: unknown
  failure: RoutingActionFailure | null = null
  private complete = false

  async claim() {
    if (this.complete) return null
    return { attempt: 1 }
  }

  async succeed(_delivery: unknown, _attempt: number, output: unknown) {
    this.complete = true
    this.output = output
  }

  async fail(_delivery: unknown, _attempt: number, failure: RoutingActionFailure) {
    this.complete = !failure.retryable
    this.failure = failure
  }
}

class AmbiguousSuccessStore extends DeliveryStore {
  private rejectCompletion = true

  override async succeed(delivery: unknown, attempt: number, output: unknown) {
    if (this.rejectCompletion) {
      this.rejectCompletion = false
      throw new Error("completion unavailable")
    }
    await super.succeed(delivery, attempt, output)
  }
}
