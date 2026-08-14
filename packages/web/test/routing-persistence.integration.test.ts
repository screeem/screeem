import postgres from "postgres"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { PostgresFormRoutingPersistence } from "../src/lib/forms/routing-persistence"
import type { PlannedFormRoutingAction } from "../src/lib/forms/routing-actions"

const runDatabaseTests = process.env.FORM_ROUTING_DB_TESTS === "1"
const databaseUrl = process.env.DATABASE_URL
const suite = runDatabaseTests ? describe : describe.skip

suite("PostgresFormRoutingPersistence", () => {
  const database = postgres(databaseUrl ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 4,
    prepare: false,
  })
  const persistence = new PostgresFormRoutingPersistence(database)
  let fixture: ReturnType<typeof identifiers>

  beforeEach(async () => {
    fixture = identifiers()
    await database`
      INSERT INTO auth.users (
        id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES (
        ${fixture.userId},
        ${`${fixture.userId}@example.com`},
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      )
    `
    await database`
      INSERT INTO teams (id, name, created_by)
      VALUES (${fixture.tenantId}, 'Routing persistence test', ${fixture.userId})
    `
    await database`
      INSERT INTO forms (
        id,
        team_id,
        name,
        created_by,
        is_active,
        legacy_unstructured,
        definition_availability,
        published_version
      ) VALUES (
        ${fixture.formId},
        ${fixture.tenantId},
        'Routing persistence test',
        ${fixture.userId},
        true,
        false,
        'active',
        1
      )
    `
    await database`
      INSERT INTO form_definition_versions (
        team_id, form_id, version, draft_revision, definition, routing_definition, published_at
      ) VALUES (
        ${fixture.tenantId},
        ${fixture.formId},
        1,
        1,
        ${database.json(definition)},
        ${database.json(routing)},
        now()
      )
    `
  })

  afterEach(async () => {
    await database`
      DELETE FROM form_submission_action_executions
      WHERE team_id = ${fixture.tenantId}
    `
    await database`DELETE FROM teams WHERE created_by = ${fixture.userId}`
    await database`DELETE FROM auth.users WHERE id = ${fixture.userId}`
  })

  afterAll(async () => {
    await database.end()
  })

  it("stores the submission and action plan atomically for the exact tenant publication", async () => {
    const status = await persistence.saveSubmission(saveInput(fixture, actions))

    expect(status).toBe("saved")
    const submissions = await database<{ readonly team_id: string; readonly routing_route: string }[]>`
      SELECT team_id, routing_route
      FROM form_submissions
      WHERE id = ${fixture.submissionId}
    `
    const storedActions = await database<
      { readonly action_key: string; readonly action_index: number; readonly status: string }[]
    >`
      SELECT action_key, action_index, status
      FROM form_submission_action_executions
      WHERE team_id = ${fixture.tenantId}
        AND submission_id = ${fixture.submissionId}
      ORDER BY action_index
    `
    expect(submissions).toEqual([{ team_id: fixture.tenantId, routing_route: "sales" }])
    expect(storedActions).toEqual([
      { action_key: "qualified:0", action_index: 0, status: "pending" },
      { action_key: "qualified:1", action_index: 1, status: "pending" },
    ])

    const unavailable = await persistence.saveSubmission({
      ...saveInput({ ...fixture, submissionId: crypto.randomUUID() }, []),
      tenantId: crypto.randomUUID(),
    })
    expect(unavailable).toBe("unavailable")
  })

  it("claims once and preserves action order across concurrent workers", async () => {
    await persistence.saveSubmission(saveInput(fixture, actions))
    const actionIdentifiers = executionIdentifiers(fixture)

    expect(await persistence.claim(actionIdentifiers, actions[1]!)).toBeNull()
    const claims = await Promise.all([
      persistence.claim(actionIdentifiers, actions[0]!),
      persistence.claim(actionIdentifiers, actions[0]!),
    ])
    expect(claims.filter(Boolean)).toEqual([{ attempt: 1 }])

    await persistence.succeed(actionIdentifiers, actions[0]!, 1, { delivered: true })
    expect(await persistence.claim(actionIdentifiers, actions[1]!)).toEqual({ attempt: 1 })
    await expect(
      persistence.succeed(actionIdentifiers, actions[0]!, 1, undefined),
    ).rejects.toThrow("claim was lost")
  })

  it("stores a maximum wire-sized action output with jsonb overhead", async () => {
    const [action] = actions
    await persistence.saveSubmission(saveInput(fixture, [action!]))
    const actionIdentifiers = executionIdentifiers(fixture)
    const claim = await persistence.claim(actionIdentifiers, action!)
    const output = Array.from({ length: 4 }, () => "x".repeat(16_380))

    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThanOrEqual(
      65_536,
    )
    await persistence.succeed(actionIdentifiers, action!, claim!.attempt, output)

    const [stored] = await database<{ readonly status: string; readonly output: unknown }[]>`
      SELECT status, output
      FROM form_submission_action_executions
      WHERE team_id = ${fixture.tenantId}
        AND submission_id = ${fixture.submissionId}
        AND action_key = ${action.key}
    `
    expect(stored).toEqual({ status: "succeeded", output })
  })

  it("maps due work and loads only the exact tenant publication", async () => {
    const [action] = actions
    await persistence.saveSubmission(saveInput(fixture, [action!]))

    const due = await persistence.listPending(100)
    expect(due).toContainEqual({
        tenantId: fixture.tenantId,
        formId: fixture.formId,
        submissionId: fixture.submissionId,
        publicationVersion: 1,
        action,
        submission: { name: "Ada" },
        routing: {
          status: "matched",
          route: "sales",
          matchedRule: "qualified",
          error: null,
        },
      })
    await expect(
      persistence.loadPublication(executionIdentifiers(fixture)),
    ).resolves.toEqual({ definition, routing })

    const wrongTenant = { ...executionIdentifiers(fixture), tenantId: crypto.randomUUID() }
    await expect(persistence.claim(wrongTenant, action!)).resolves.toBeNull()
    await expect(persistence.loadPublication(wrongTenant)).rejects.toThrow(
      "publication is unavailable",
    )
  })

  it("retries with fencing and terminalizes the remaining ordered actions", async () => {
    await persistence.saveSubmission(saveInput(fixture, actions))
    const actionIdentifiers = executionIdentifiers(fixture)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        await database`
          UPDATE form_submission_action_executions
          SET next_attempt_at = now() - interval '1 second'
          WHERE team_id = ${fixture.tenantId}
            AND submission_id = ${fixture.submissionId}
            AND action_key = ${actions[0]!.key}
        `
      }
      expect(await persistence.claim(actionIdentifiers, actions[0]!)).toEqual({ attempt })
      await persistence.fail(actionIdentifiers, actions[0]!, attempt, "temporary_failure")
    }

    const rows = await database<
      { readonly action_key: string; readonly status: string; readonly last_error: string }[]
    >`
      SELECT action_key, status, last_error
      FROM form_submission_action_executions
      WHERE team_id = ${fixture.tenantId}
        AND submission_id = ${fixture.submissionId}
      ORDER BY action_index
    `
    expect(rows).toEqual([
      { action_key: "qualified:0", status: "failed", last_error: "temporary_failure" },
      { action_key: "qualified:1", status: "failed", last_error: "earlier_action_failed" },
    ])
    expect(await persistence.claim(actionIdentifiers, actions[1]!)).toBeNull()
  })

  it("recovers an expired final lease without executing the action again", async () => {
    await persistence.saveSubmission(saveInput(fixture, actions))
    await database`
      UPDATE form_submission_action_executions
      SET
        status = 'running',
        attempt_count = 3,
        lease_expires_at = now() - interval '1 second'
      WHERE team_id = ${fixture.tenantId}
        AND submission_id = ${fixture.submissionId}
        AND action_key = ${actions[0]!.key}
    `

    const pending = await persistence.listPending(100)
    expect(
      pending.find(({ submissionId }) => submissionId === fixture.submissionId),
    ).toBeUndefined()

    const rows = await database<
      { readonly action_key: string; readonly status: string; readonly last_error: string }[]
    >`
      SELECT action_key, status, last_error
      FROM form_submission_action_executions
      WHERE team_id = ${fixture.tenantId}
        AND submission_id = ${fixture.submissionId}
      ORDER BY action_index
    `
    expect(rows).toEqual([
      {
        action_key: "qualified:0",
        status: "failed",
        last_error: "action_execution_abandoned",
      },
      { action_key: "qualified:1", status: "failed", last_error: "earlier_action_failed" },
    ])
  })
})

const definition = {
  formatVersion: 1,
  title: "Qualification",
  fields: [
    {
      id: "name-field",
      name: "name",
      label: "Name",
      required: true,
      type: "string",
      control: "text",
    },
  ],
}

const routing = {
  version: 1,
  rules: [
    {
      id: "qualified",
      when: "true",
      route: "sales",
      actions: [{ use: "notify", with: "submission.name" }, { use: "audit" }],
    },
  ],
  fallback: "review",
}

const actions: readonly PlannedFormRoutingAction[] = [
  { key: "qualified:0", name: "notify", index: 0, ruleId: "qualified" },
  { key: "qualified:1", name: "audit", index: 1, ruleId: "qualified" },
]

function identifiers() {
  return {
    userId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    formId: crypto.randomUUID(),
    submissionId: crypto.randomUUID(),
  }
}

function executionIdentifiers(fixture: ReturnType<typeof identifiers>) {
  return {
    tenantId: fixture.tenantId,
    formId: fixture.formId,
    submissionId: fixture.submissionId,
    publicationVersion: 1,
  }
}

function saveInput(
  fixture: ReturnType<typeof identifiers>,
  plannedActions: readonly PlannedFormRoutingAction[],
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
    actions: plannedActions,
    origin: "https://example.com",
    userAgent: "test",
  }
}
