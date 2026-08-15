import postgres from "postgres"
import { routingActionFailure } from "@screeem/routing"
import { Effect } from "effect"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { snapshotFormEvent, type StoredFormEventDelivery } from "../src/lib/forms/form-actions"
import {
  drainPendingFormEventDeliveries,
  orderFormEventDeliveries,
} from "../src/lib/forms/form-event-deliveries"
import { createFormAutomationRegistry } from "../src/lib/forms/form-automation-registry"
import { PostgresFormPersistence } from "../src/lib/forms/routing-persistence"

vi.mock("server-only", () => ({}))

const retryableFailure = () => routingActionFailure({
  code: "temporary_failure",
  retryable: true,
  retryAfterMs: null,
})

const suite = process.env.FORM_PERSISTENCE_DB_TESTS === "1" ? describe : describe.skip

suite("PostgresFormPersistence", () => {
  const database = postgres(process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 4,
    prepare: false,
  })
  const persistence = new PostgresFormPersistence(database)
  let fixture: ReturnType<typeof identifiers>

  beforeEach(async () => {
    fixture = identifiers()
    await database`
      INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (${fixture.userId}, ${`${fixture.userId}@example.com`}, '{}'::jsonb, '{}'::jsonb, now(), now())
    `
    await database`
      INSERT INTO teams (id, name, created_by)
      VALUES (${fixture.tenantId}, 'Form persistence test', ${fixture.userId})
    `
    await database`
      INSERT INTO forms (
        id, team_id, name, created_by, is_active, legacy_unstructured,
        definition_availability, published_version
      ) VALUES (
        ${fixture.formId}, ${fixture.tenantId}, 'Form persistence test', ${fixture.userId},
        true, false, 'active', 1
      )
    `
    await database`
      INSERT INTO form_definition_versions (
        team_id, form_id, version, draft_revision, definition, routing_definition, published_at
      ) VALUES (
        ${fixture.tenantId}, ${fixture.formId}, 1, 1,
        ${database.json(definition)}, ${database.json(routing)}, now()
      )
    `
  })

  afterEach(async () => {
    await database`DELETE FROM form_event_deliveries WHERE team_id = ${fixture.tenantId}`
    await database`DELETE FROM teams WHERE created_by = ${fixture.userId}`
    await database`DELETE FROM auth.users WHERE id = ${fixture.userId}`
  })

  afterAll(() => database.end())

  it("atomically stores the submission and form event deliveries", async () => {
    const deliveries = plannedDeliveries(fixture)

    await expect(persistence.saveSubmission(saveInput(fixture, deliveries))).resolves.toBe("saved")

    const rows = await database<
      { readonly delivery_key: string; readonly sequence: number; readonly event_type: string }[]
    >`
      SELECT delivery_key, sequence, event_type
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId} AND event_id = ${deliveries[0]!.event.eventId}
      ORDER BY sequence
    `
    expect(rows).toEqual([
      {
        delivery_key: `${deliveries[0]!.event.eventId}:0`,
        sequence: 0,
        event_type: "routing.matched",
      },
      {
        delivery_key: `${deliveries[0]!.event.eventId}:1`,
        sequence: 1,
        event_type: "routing.matched",
      },
    ])
  })

  it("stores submission event deliveries without a routing publication", async () => {
    await database`
      UPDATE forms
      SET legacy_unstructured = true, definition_availability = 'draft', published_version = NULL
      WHERE team_id = ${fixture.tenantId} AND id = ${fixture.formId}
    `
    const event = snapshotFormEvent({
      eventId: `${fixture.submissionId}:submission.accepted`,
      type: "submission.accepted",
      occurredAt: "2026-08-14T09:00:00.000Z",
      tenantId: fixture.tenantId,
      formId: fixture.formId,
      payload: {
        publicationVersion: null,
        submissionId: fixture.submissionId,
        submission: { name: "Ada" },
        routing: { status: "not_configured", route: null, matchedRule: null, error: null },
      },
    })
    const [delivery] = orderFormEventDeliveries([{
      event,
      kind: "event_handler",
      registrationName: "archive",
      deliveryKey: `${event.eventId}:0`,
      sequence: 0,
    }], {
      tenantId: fixture.tenantId,
      formId: fixture.formId,
      publicationVersion: null,
      submissionId: fixture.submissionId,
    })

    await expect(
      persistence.saveSubmission({
        ...saveInput(fixture, []),
        publicationVersion: null,
        routing: { status: "not_configured", route: null, matchedRule: null, error: null },
        deliveries: [delivery],
      }),
    ).resolves.toBe("saved")

    const [stored] = await database<
      { readonly event_type: string; readonly publication_version: number | null }[]
    >`
      SELECT event_type, publication_version
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId} AND delivery_key = ${delivery.deliveryKey}
    `
    expect(stored).toEqual({ event_type: "submission.accepted", publication_version: null })
  })

  it("claims one ordered delivery at a time with fencing", async () => {
    const deliveries = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))

    await expect(persistence.claim(deliveries[1]!)).resolves.toBeNull()
    const claims = await Promise.all([
      persistence.claim(deliveries[0]!),
      persistence.claim(deliveries[0]!),
    ])
    expect(claims.filter(Boolean)).toEqual([{ attempt: 1 }])
    await persistence.succeed(deliveries[0]!, 1, { delivered: true })
    await expect(persistence.claim(deliveries[1]!)).resolves.toEqual({ attempt: 1 })
    await expect(persistence.succeed(deliveries[0]!, 1, undefined)).rejects.toThrow(
      "claim was lost",
    )
  })

  it("maps due work and enforces tenant publication scope", async () => {
    const [delivery] = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, [delivery!]))

    await expect(persistence.listPending(100)).resolves.toEqual({
      deliveries: [delivery],
      invalidCount: 0,
    })
    await expect(
      persistence.loadPublication({
        tenantId: fixture.tenantId,
        formId: fixture.formId,
        publicationVersion: 1,
      }),
    ).resolves.toEqual({ definition, routing })
    await expect(
      persistence.claim({
        ...delivery!,
        event: { ...delivery!.event, tenantId: crypto.randomUUID() },
      }),
    ).resolves.toBeNull()
  })

  it("terminalizes later deliveries after the final failed attempt", async () => {
    const deliveries = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        await database`
          UPDATE form_event_deliveries
          SET next_attempt_at = now() - interval '1 second'
          WHERE team_id = ${fixture.tenantId}
            AND delivery_key = ${deliveries[0]!.deliveryKey}
        `
      }
      await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt })
      await persistence.fail(deliveries[0]!, attempt, retryableFailure())
    }

    const rows = await database<
      { readonly delivery_key: string; readonly status: string; readonly last_error: string }[]
    >`
      SELECT delivery_key, status, last_error
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId} AND event_id = ${deliveries[0]!.event.eventId}
      ORDER BY sequence
    `
    expect(rows).toEqual([
      { delivery_key: deliveries[0]!.deliveryKey, status: "failed", last_error: "temporary_failure" },
      { delivery_key: deliveries[1]!.deliveryKey, status: "failed", last_error: "earlier_delivery_failed" },
    ])
  })

  it("honors bounded provider backoff and terminalizes a non-retryable failure", async () => {
    const deliveries = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))

    await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt: 1 })
    await persistence.fail(deliveries[0]!, 1, routingActionFailure({
      code: "salesforce_rate_limited",
      retryable: true,
      retryAfterMs: 180_000,
    }))

    const [deferred] = await database<{
      readonly attempt_count: number
      readonly next_attempt_at: Date
      readonly now: Date
      readonly status: string
    }[]>`
      SELECT attempt_count, next_attempt_at, statement_timestamp() AS now, status
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId}
        AND delivery_key = ${deliveries[0]!.deliveryKey}
    `
    expect(deferred?.status).toBe("pending")
    expect(deferred?.attempt_count).toBe(1)
    expect(deferred!.next_attempt_at.getTime() - deferred!.now.getTime()).toBeGreaterThan(170_000)

    await database`
      UPDATE form_event_deliveries
      SET next_attempt_at = now() - interval '1 second'
      WHERE team_id = ${fixture.tenantId}
        AND delivery_key = ${deliveries[0]!.deliveryKey}
    `
    await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt: 2 })
    await persistence.fail(deliveries[0]!, 2, routingActionFailure({
      code: "salesforce_invalid_request",
      retryable: false,
      retryAfterMs: null,
    }))

    const rows = await database<{ readonly status: string; readonly last_error: string }[]>`
      SELECT status, last_error
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId}
        AND event_id = ${deliveries[0]!.event.eventId}
      ORDER BY sequence
    `
    expect(rows).toEqual([
      { status: "failed", last_error: "salesforce_invalid_request" },
      { status: "failed", last_error: "earlier_delivery_failed" },
    ])
  })

  it("reconciles an expired final lease and its remaining stream", async () => {
    const deliveries = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) {
        await database`
          UPDATE form_event_deliveries
          SET next_attempt_at = now() - interval '1 second'
          WHERE team_id = ${fixture.tenantId}
            AND delivery_key = ${deliveries[0]!.deliveryKey}
        `
      }
      await persistence.claim(deliveries[0]!)
      await persistence.fail(deliveries[0]!, attempt, retryableFailure())
    }
    await database`
      UPDATE form_event_deliveries
      SET next_attempt_at = now() - interval '1 second'
      WHERE team_id = ${fixture.tenantId}
        AND delivery_key = ${deliveries[0]!.deliveryKey}
    `
    await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt: 3 })
    await database`
      UPDATE form_event_deliveries
      SET lease_expires_at = now() - interval '1 second'
      WHERE team_id = ${fixture.tenantId}
        AND delivery_key = ${deliveries[0]!.deliveryKey}
    `

    await expect(persistence.listPending(100)).resolves.toEqual({
      deliveries: [],
      invalidCount: 0,
    })
    const rows = await database<
      { readonly status: string; readonly last_error: string }[]
    >`
      SELECT status, last_error
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId}
      ORDER BY stream_sequence
    `
    expect(rows).toEqual([
      { status: "failed", last_error: "delivery_abandoned" },
      { status: "failed", last_error: "earlier_delivery_failed" },
    ])
  })

  it("stores the maximum supported action output with jsonb overhead", async () => {
    const [delivery] = plannedDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, [delivery!]))
    const claim = await persistence.claim(delivery!)
    const output = Array.from({ length: 4 }, () => "x".repeat(16_380))

    await persistence.succeed(delivery!, claim!.attempt, output)

    const [stored] = await database<{ readonly output: unknown }[]>`
      SELECT output FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId} AND delivery_key = ${delivery!.deliveryKey}
    `
    expect(stored?.output).toEqual(output)
  })

  it("recovers a submission lifecycle stream in one ordered drain", async () => {
    const calls: string[] = []
    const deliveries = lifecycleDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))
    const registry = createFormAutomationRegistry()
      .onEvent({
        name: "before-save",
        event: "submission.before_save",
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push("before-save")),
      })
      .onEvent({
        name: "accepted",
        event: "submission.accepted",
        delivery: "durable",
        run: () => Effect.sync(() => void calls.push("accepted")),
      })

    await expect(
      drainPendingFormEventDeliveries(persistence, 100, registry),
    ).resolves.toBe(2)
    expect(calls).toEqual(["before-save", "accepted"])
  })

  it("keeps unrelated durable handlers eligible after another handler fails", async () => {
    const deliveries = lifecycleDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, deliveries))

    await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt: 1 })
    await persistence.fail(deliveries[0]!, 1, routingActionFailure({
      code: "integration_connection_unavailable",
      retryable: false,
      retryAfterMs: null,
    }))

    await expect(persistence.listPending(100)).resolves.toEqual({
      deliveries: [deliveries[1]],
      invalidCount: 0,
    })
    await expect(persistence.claim(deliveries[1]!)).resolves.toEqual({ attempt: 1 })
  })

  it("keeps same-event handlers independent in the persisted queue", async () => {
    const event = lifecycleDeliveries(fixture)[1]!.event
    const deliveries = orderFormEventDeliveries([
      {
        event,
        kind: "event_handler",
        registrationName: "first-handler",
        deliveryKey: `${event.eventId}:0`,
        sequence: 0,
      },
      {
        event,
        kind: "event_handler",
        registrationName: "second-handler",
        deliveryKey: `${event.eventId}:1`,
        sequence: 1,
      },
    ], {
      tenantId: fixture.tenantId,
      formId: fixture.formId,
      publicationVersion: 1,
      submissionId: fixture.submissionId,
    })
    await persistence.saveSubmission(saveInput(fixture, deliveries))

    await expect(persistence.claim(deliveries[0]!)).resolves.toEqual({ attempt: 1 })
    await persistence.fail(deliveries[0]!, 1, routingActionFailure({
      code: "integration_connection_unavailable",
      retryable: false,
      retryAfterMs: null,
    }))

    await expect(persistence.claim(deliveries[1]!)).resolves.toEqual({ attempt: 1 })
  })

  it("quarantines malformed work while returning valid work and an operational error", async () => {
    const [malformed] = lifecycleDeliveries(fixture)
    await persistence.saveSubmission(saveInput(fixture, [malformed!]))
    await database`
      UPDATE form_event_deliveries
      SET event_payload = '{}'::jsonb
      WHERE team_id = ${fixture.tenantId} AND delivery_key = ${malformed!.deliveryKey}
    `
    const other = { ...fixture, submissionId: crypto.randomUUID() }
    const [valid] = lifecycleDeliveries(other)
    await persistence.saveSubmission(saveInput(other, [valid!]))

    await expect(persistence.listPending(100)).resolves.toEqual({
      deliveries: [valid],
      invalidCount: 1,
    })
    const [stored] = await database<{ readonly status: string; readonly last_error: string }[]>`
      SELECT status, last_error
      FROM form_event_deliveries
      WHERE team_id = ${fixture.tenantId} AND delivery_key = ${malformed!.deliveryKey}
    `
    expect(stored).toEqual({ status: "failed", last_error: "invalid_event_contract" })
  })
})

const definition = {
  formatVersion: 1,
  title: "Qualification",
  fields: [{
    id: "name-field",
    name: "name",
    label: "Name",
    required: true,
    type: "string",
    control: "text",
  }],
}

const routing = {
  version: 1,
  rules: [{
    id: "qualified",
    when: "true",
    route: "sales",
    actions: [{ use: "notify", with: "submission.name" }, { use: "audit" }],
  }],
  fallback: "review",
}

function identifiers() {
  return {
    userId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    formId: crypto.randomUUID(),
    submissionId: crypto.randomUUID(),
  }
}

function plannedDeliveries(fixture: ReturnType<typeof identifiers>): readonly StoredFormEventDelivery[] {
  const event = snapshotFormEvent({
    eventId: `${fixture.submissionId}:routing.matched`,
    type: "routing.matched",
    occurredAt: "2026-08-14T09:00:00.000Z",
    tenantId: fixture.tenantId,
    formId: fixture.formId,
    payload: {
      publicationVersion: 1,
      submissionId: fixture.submissionId,
      submission: { name: "Ada" },
      ruleId: "qualified",
      route: "sales",
    },
  })
  return orderFormEventDeliveries(
    ["notify", "audit"].map((registrationName, sequence) => ({
      event,
      kind: "routing_action" as const,
      registrationName,
      deliveryKey: `${event.eventId}:${sequence}`,
      sequence,
    })),
    {
      tenantId: fixture.tenantId,
      formId: fixture.formId,
      publicationVersion: 1,
      submissionId: fixture.submissionId,
    },
  )
}

function lifecycleDeliveries(
  fixture: ReturnType<typeof identifiers>,
): readonly StoredFormEventDelivery[] {
  const routingResult = {
    status: "matched" as const,
    route: "sales",
    matchedRule: "qualified",
    error: null,
  }
  const planned = (["submission.before_save", "submission.accepted"] as const).map(
    (type, index) => {
      const event = snapshotFormEvent({
        eventId: `${fixture.submissionId}:${type}`,
        type,
        occurredAt: `2026-08-14T09:00:0${index}.000Z`,
        tenantId: fixture.tenantId,
        formId: fixture.formId,
        payload: {
          publicationVersion: 1,
          submissionId: fixture.submissionId,
          submission: { name: "Ada" },
          routing: routingResult,
        },
      })
      return {
        event,
        kind: "event_handler" as const,
        registrationName: type === "submission.before_save" ? "before-save" : "accepted",
        deliveryKey: `${event.eventId}:0`,
        sequence: 0,
      }
    },
  )
  return orderFormEventDeliveries(planned, {
    tenantId: fixture.tenantId,
    formId: fixture.formId,
    publicationVersion: 1,
    submissionId: fixture.submissionId,
  })
}

function saveInput(
  fixture: ReturnType<typeof identifiers>,
  deliveries: readonly StoredFormEventDelivery[],
) {
  return {
    submissionId: fixture.submissionId,
    tenantId: fixture.tenantId,
    formId: fixture.formId,
    publicationVersion: 1,
    payload: { name: "Ada" },
    routing: {
      status: "matched" as const,
      route: "sales",
      matchedRule: "qualified",
      error: null,
    },
    deliveries,
    origin: "https://example.com",
    userAgent: "test",
  }
}
