import postgres from "postgres"
import { Effect, Either } from "effect"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PostgresInstagramSchedulingStore,
} from "../src/lib/integrations/social/instagram-scheduling"
import {
  PostgresSocialDeliveryEventStore,
} from "../src/lib/integrations/social/delivery-events"

const suite = process.env.INSTAGRAM_SCHEDULING_DB_TESTS === "1" ? describe : describe.skip

suite("Postgres Instagram scheduling", () => {
  const database = postgres(process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/unavailable", {
    max: 2,
    prepare: false,
  })
  let fixture: ReturnType<typeof identifiers>

  beforeEach(async () => {
    fixture = identifiers()
    await database`
      INSERT INTO auth.users (
        id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES (
        ${fixture.actor}, ${`${fixture.actor}@example.com`},
        '{}'::jsonb, '{}'::jsonb, now(), now()
      )
    `
    await database`
      INSERT INTO teams (id, name, created_by)
      VALUES (${fixture.team}, 'Instagram scheduling team', ${fixture.actor})
    `
    await database`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (${fixture.team}, ${fixture.actor}, 'owner')
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${fixture.createdEvent}, 'post.created',
        ${database.json({
          title: "Launch",
          copy: "Launch copy",
          date: "2026-09-02",
          time: "09:30",
          tags: [],
          targets: ["Instagram"],
        })},
        ${fixture.actor}
      )
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${fixture.configuredEvent},
        'instagram.target.configured',
        ${database.json({ expectedRevision: 1, input: instagramInput(fixture.asset) })},
        ${fixture.actor}
      )
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${fixture.reviewEvent},
        'approval.requested', '{"revision": 2}'::jsonb, ${fixture.actor}
      )
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${fixture.approvedEvent},
        'approval.granted', '{"revision": 2}'::jsonb, ${fixture.actor}
      )
    `
    await database`
      INSERT INTO integration_connections (
        id, team_id, provider, status, health, enabled, display_name,
        external_account_id, created_by, updated_by
      ) VALUES (
        ${fixture.connection}, ${fixture.team}, 'instagram', 'connected',
        'healthy', true, 'Studio account', 'instagram-account-1',
        ${fixture.actor}, ${fixture.actor}
      )
    `
    await database`
      INSERT INTO integration_credentials (
        team_id, connection_id, key_id, sealed_payload
      ) VALUES (${fixture.team}, ${fixture.connection}, 'key-v1', 'v1.ciphertext')
    `
    await database`
      INSERT INTO social_media_assets (
        id, team_id, bucket, object_key, object_etag, checksum, kind,
        byte_length, schema_version, asset_contract, created_by
      ) VALUES (
        ${fixture.asset}, ${fixture.team}, 'team-objects',
        ${`teams/${fixture.team}/social-post-media/${fixture.asset}`}, 'etag-1',
        ${checksum}, 'image', 2400000, 1,
        ${database.json(inspectedImage(fixture.asset))}, ${fixture.actor}
      )
    `
  })

  afterEach(async () => {
    await database`DELETE FROM teams WHERE created_by = ${fixture.actor}`
    await database`DELETE FROM auth.users WHERE id = ${fixture.actor}`
  })

  afterAll(() => database.end())

  it("materializes the approved config with tenant-bound inspected media", async () => {
    const target = await createTarget()
    const links = await database<{
      readonly target_id: string
      readonly asset_id: string
      readonly checksum: string
    }[]>`
      SELECT target_id, asset_id, checksum
      FROM social_post_target_assets
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `
    const events = await database<{
      readonly sequence: number
      readonly event_type: string
      readonly event_contract: Record<string, unknown>
    }[]>`
      SELECT sequence::int, event_type, event_contract
      FROM social_delivery_events
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
      ORDER BY sequence
    `

    expect(target).toMatchObject({
      teamId: fixture.team,
      calendarPostId: fixture.post,
      calendarRevision: 2,
      connectionId: fixture.connection,
      provider: "instagram",
    })
    expect(links).toEqual([{
      target_id: target.id,
      asset_id: fixture.asset,
      checksum,
    }])
    expect(events).toEqual([expect.objectContaining({
      sequence: 1,
      event_type: "target.scheduled",
      event_contract: expect.objectContaining({
        id: fixture.request,
        teamId: fixture.team,
        targetId: target.id,
        eventType: "target.scheduled",
      }),
    })])
    await expect(database`
      UPDATE social_delivery_events
      SET event_type = 'target.cancelled'
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_delivery_events_are_immutable/)
    await expect(database`
      DELETE FROM social_delivery_events
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_delivery_events_are_immutable/)
    await expect(database`
      UPDATE social_post_target_assets
      SET ordinal = 1
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_post_target_assets_are_immutable/)
    await expect(database`
      DELETE FROM social_post_target_assets
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_post_target_assets_are_immutable/)
    await expect(database`
      DELETE FROM social_post_targets
      WHERE team_id = ${fixture.team} AND id = ${target.id}
    `).rejects.toThrow(/social_post_target_immutable/)
    await expect(database`
      DELETE FROM social_media_assets
      WHERE team_id = ${fixture.team} AND id = ${fixture.asset}
    `).rejects.toThrow(/social_media_asset_immutable/)
  })

  it("supersedes the target when approved calendar content changes", async () => {
    const target = await createTarget()
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'copy.changed', '{"value": "Changed after approval"}'::jsonb,
        ${fixture.actor}
      )
    `
    const rows = await database<{
      readonly status: string
      readonly event_types: string[]
    }[]>`
      SELECT target.status, array_agg(event.event_type ORDER BY event.sequence) AS event_types
      FROM social_post_targets AS target
      JOIN social_delivery_events AS event
        ON event.team_id = target.team_id AND event.target_id = target.id
      WHERE target.team_id = ${fixture.team} AND target.id = ${target.id}
      GROUP BY target.status
    `

    expect(rows[0]?.status).toBe("superseded")
    expect(rows[0]?.event_types).toEqual(["target.scheduled", "target.superseded"])
  })

  it("cancels a target by appending a compensating event", async () => {
    const target = await createTarget()
    const cancelled = await cancelTarget(target.id)
    const replay = await cancelTarget(target.id)
    const rows = await database<{
      readonly status: string
      readonly transition_event_id: string | null
    }[]>`
      SELECT status, transition_event_id
      FROM social_post_targets
      WHERE team_id = ${fixture.team} AND id = ${target.id}
    `

    expect(cancelled).toMatchObject({
      id: fixture.cancelEvent,
      eventType: "target.cancelled",
      actor: { kind: "user", userId: fixture.actor },
      data: { reason: "user_requested" },
    })
    expect(replay).toEqual(cancelled)
    expect(rows[0]).toEqual({
      status: "cancelled",
      transition_event_id: fixture.cancelEvent,
    })
  })

  it("persists sanitized publish progress with a sealed private receipt", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    const progress = await appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.receipt",
    })
    const replay = await appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.receipt",
    })
    expect(replay).toEqual(progress)
    await expect(appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.different",
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "receipt_conflict",
    })
    await appendDeliveryEvent(target.id, fixture.publishProgressedEvent2, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 2 },
    }, {
      expectedPreviousRevision: 1,
      keyId: "key-v1",
      sealedPayload: "v1.receipt-two",
    })
    const succeeded = await appendDeliveryEvent(target.id, fixture.publishSucceededEvent, {
      eventType: "publish.succeeded",
      data: {
        attemptId: fixture.attempt,
        permalink: "https://www.instagram.com/p/example/",
        receiptRevision: 3,
        remotePostId: "remote-post-1",
      },
    }, {
      expectedPreviousRevision: 2,
      keyId: "key-v1",
      sealedPayload: "v1.receipt-three",
    })
    const succeededReplay = await appendDeliveryEvent(
      target.id,
      fixture.publishSucceededEvent,
      {
        eventType: "publish.succeeded",
        data: {
          attemptId: fixture.attempt,
          permalink: "https://www.instagram.com/p/example/",
          receiptRevision: 3,
          remotePostId: "remote-post-1",
        },
      },
      {
        expectedPreviousRevision: 2,
        keyId: "key-v1",
        sealedPayload: "v1.receipt-three",
      },
    )
    expect(succeededReplay).toEqual(succeeded)
    await expect(appendDeliveryEvent(target.id, fixture.publishSucceededEvent, {
      eventType: "publish.succeeded",
      data: {
        attemptId: fixture.attempt,
        permalink: "https://www.instagram.com/p/example/",
        receiptRevision: 3,
        remotePostId: "remote-post-1",
      },
    }, {
      expectedPreviousRevision: 2,
      keyId: "key-v1",
      sealedPayload: "v1.changed-terminal-receipt",
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "receipt_conflict",
    })
    await appendDeliveryEvent(target.id, fixture.deleteRequestedEvent, {
      eventType: "remote-delete.requested",
      data: { remotePostId: "remote-post-1" },
    })
    await appendDeliveryEvent(target.id, fixture.deleteSucceededEvent, {
      eventType: "remote-delete.succeeded",
      data: { remotePostId: "remote-post-1" },
    })

    const events = await database<{
      readonly event_type: string
      readonly event_contract: unknown
    }[]>`
      SELECT event_type, event_contract
      FROM social_delivery_events
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
      ORDER BY sequence
    `
    const receipts = await database<{
      readonly attempt_id: string
      readonly revision: number
      readonly sealed_payload: string
    }[]>`
      SELECT attempt_id, revision::int, sealed_payload
      FROM social_delivery_receipts
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
      ORDER BY revision
    `

    expect(events.map((event) => event.event_type)).toEqual([
      "target.scheduled",
      "publish.started",
      "publish.progressed",
      "publish.progressed",
      "publish.succeeded",
      "remote-delete.requested",
      "remote-delete.succeeded",
    ])
    expect(JSON.stringify(events)).not.toContain("v1.receipt")
    expect(receipts).toEqual([
      {
        attempt_id: fixture.attempt,
        revision: 1,
        sealed_payload: "v1.receipt",
      },
      {
        attempt_id: fixture.attempt,
        revision: 2,
        sealed_payload: "v1.receipt-two",
      },
      {
        attempt_id: fixture.attempt,
        revision: 3,
        sealed_payload: "v1.receipt-three",
      },
    ])
    await expect(database`
      UPDATE social_delivery_receipts
      SET sealed_payload = 'v1.rewritten'
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_delivery_receipts_are_immutable/)
    await expect(database`
      DELETE FROM social_delivery_receipts
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
    `).rejects.toThrow(/social_delivery_receipts_are_immutable/)
  })

  it("records an uncertain outcome and blocks automatic retry and cancellation", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    await appendDeliveryEvent(target.id, fixture.publishUncertainEvent, {
      eventType: "publish.uncertain",
      data: {
        attemptId: fixture.attempt,
        errorCode: "provider_outcome_unknown",
        providerReference: "container-1",
      },
    })

    await expect(appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.started",
      data: { attemptId: crypto.randomUUID() },
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "invalid_transition",
    })
    await expect(cancelTarget(target.id)).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "delivery_active",
    })
  })

  it("requires a provider progress receipt before publish success", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })

    await expect(appendDeliveryEvent(target.id, fixture.publishSucceededEvent, {
      eventType: "publish.succeeded",
      data: {
        attemptId: fixture.attempt,
        permalink: "https://www.instagram.com/p/example/",
        receiptRevision: 1,
        remotePostId: "remote-post-1",
      },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.direct-success",
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "invalid_transition",
    })
  })

  it("does not reuse an earlier publish attempt id for a retry", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    await appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.failed",
      data: {
        attemptId: fixture.attempt,
        errorCode: "provider_unavailable",
        receipt: { kind: "unchanged", revision: null },
        retryable: true,
        retryAt: null,
        retryMode: "restart",
      },
    })

    await expect(appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "invalid_transition",
    })

    await expect(appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.started",
      data: { attemptId: crypto.randomUUID() },
    })).resolves.toMatchObject({ eventType: "publish.started" })
  })

  it("resumes the same attempt from its last sealed processing receipt", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    await appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.processing",
    })
    await appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.failed",
      data: {
        attemptId: fixture.attempt,
        errorCode: "provider_unavailable",
        receipt: { kind: "unchanged", revision: 1 },
        retryable: true,
        retryAt: null,
        retryMode: "resume",
      },
    })
    await appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.resumed",
      data: { attemptId: fixture.attempt, receiptRevision: 1 },
    })
    await appendDeliveryEvent(target.id, fixture.publishProgressedEvent2, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 2 },
    }, {
      expectedPreviousRevision: 1,
      keyId: "key-v1",
      sealedPayload: "v1.processing-two",
    })

    const rows = await database<{
      readonly event_types: string[]
      readonly receipt_revisions: number[]
    }[]>`
      SELECT
        array_agg(DISTINCT event.event_type ORDER BY event.event_type)
          AS event_types,
        array_agg(DISTINCT receipt.revision::int ORDER BY receipt.revision::int)
          AS receipt_revisions
      FROM social_delivery_events AS event
      JOIN social_delivery_receipts AS receipt
        ON receipt.team_id = event.team_id AND receipt.target_id = event.target_id
      WHERE event.team_id = ${fixture.team} AND event.target_id = ${target.id}
    `
    expect(rows[0]?.event_types).toContain("publish.resumed")
    expect(rows[0]?.receipt_revisions).toEqual([1, 2])
  })

  it("finishes an in-flight attempt before superseding edited content", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'copy.changed', '{"value": "Edited during delivery"}'::jsonb,
        ${fixture.actor}
      )
    `
    const active = await database<{ readonly status: string }[]>`
      SELECT status
      FROM social_post_targets
      WHERE team_id = ${fixture.team} AND id = ${target.id}
    `
    expect(active[0]?.status).toBe("scheduled")

    await appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.processing",
    })
    await appendDeliveryEvent(target.id, crypto.randomUUID(), {
      eventType: "publish.failed",
      data: {
        attemptId: fixture.attempt,
        errorCode: "invalid_media",
        receipt: { kind: "recorded", phase: "failed", revision: 2 },
        retryable: false,
        retryAt: null,
        retryMode: null,
      },
    }, {
      expectedPreviousRevision: 1,
      keyId: "key-v1",
      sealedPayload: "v1.failed",
    })

    const terminal = await database<{
      readonly event_types: string[]
      readonly status: string
    }[]>`
      SELECT target.status,
        array_agg(event.event_type ORDER BY event.sequence) AS event_types
      FROM social_post_targets AS target
      JOIN social_delivery_events AS event
        ON event.team_id = target.team_id AND event.target_id = target.id
      WHERE target.team_id = ${fixture.team} AND target.id = ${target.id}
      GROUP BY target.status
    `
    expect(terminal[0]).toEqual({
      status: "superseded",
      event_types: [
        "target.scheduled",
        "publish.started",
        "publish.progressed",
        "publish.failed",
        "target.superseded",
      ],
    })
  })

  it("keeps a delivery event id bound to its canonical action", async () => {
    const target = await createTarget()
    const first = await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    const replay = await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })

    expect(replay).toEqual(first)
    await expect(appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: crypto.randomUUID() },
    })).rejects.toMatchObject({
      _tag: "SocialDeliveryEventStateError",
      reason: "request_conflict",
    })
  })

  it("serializes cancellation against a publish claim", async () => {
    const target = await createTarget()
    const schedulingStore = instagramStore()
    const deliveryStore = deliveryEventStore()
    const [cancellation, publish] = await Promise.all([
      Effect.runPromise(Effect.either(schedulingStore.cancelScheduledTarget({
        teamId: fixture.team,
        calendarPostId: fixture.post,
        targetId: target.id,
        expectedCalendarRevision: 2,
        requestId: fixture.cancelEvent,
        actorId: fixture.actor,
      }))),
      Effect.runPromise(Effect.either(deliveryStore.appendSystemEvent({
        teamId: fixture.team,
        targetId: target.id,
        eventId: fixture.publishStartedEvent,
        action: {
          eventType: "publish.started",
          data: { attemptId: fixture.attempt },
        },
      }))),
    ])

    expect(Number(Either.isRight(cancellation)) + Number(Either.isRight(publish))).toBe(1)
    expect(Number(Either.isLeft(cancellation)) + Number(Either.isLeft(publish))).toBe(1)
    const eventTypes = await database<{ readonly event_type: string }[]>`
      SELECT event_type
      FROM social_delivery_events
      WHERE team_id = ${fixture.team} AND target_id = ${target.id}
      ORDER BY sequence
    `
    expect(eventTypes.map((event) => event.event_type)).toEqual(
      Either.isRight(cancellation)
        ? ["target.scheduled", "target.cancelled"]
        : ["target.scheduled", "publish.started"],
    )
  })

  it("rejects a target for a reverted calendar post", async () => {
    const createdRows = await database<{ readonly id: number | string }[]>`
      SELECT id
      FROM calendar_events
      WHERE team_id = ${fixture.team}
        AND aggregate_id = ${fixture.post}
        AND client_event_id = ${fixture.createdEvent}
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload,
        reverts_event_id, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'change.reverted', '{}'::jsonb, ${createdRows[0]!.id}, ${fixture.actor}
      )
    `
    await database`
      UPDATE calendar_post_workflows
      SET status = 'approved', review_revision = 3, requested_by = ${fixture.actor}
      WHERE team_id = ${fixture.team} AND aggregate_id = ${fixture.post}
    `

    await expect(createTarget({
      expectedCalendarRevision: 3,
      requestId: crypto.randomUUID(),
    })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "calendar_missing",
    })
  })

  it("replays the request that created the target", async () => {
    const first = await createTarget()
    const replay = await createTarget()
    const rows = await database<{ readonly count: number }[]>`
      SELECT count(*)::int AS count
      FROM social_post_targets
      WHERE team_id = ${fixture.team}
    `

    expect(replay).toEqual(first)
    expect(rows[0]?.count).toBe(1)
  })

  it("rejects a second request id for the same revision", async () => {
    await createTarget()

    await expect(createTarget({ requestId: crypto.randomUUID() })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "request_conflict",
    })
  })

  it("keeps a request id bound to its original revision", async () => {
    await createTarget()
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'copy.changed', '{"value": "Approved revision three"}'::jsonb,
        ${fixture.actor}
      )
    `
    await approveRevision(3)

    await expect(createTarget({ expectedCalendarRevision: 3 })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "request_conflict",
    })
  })

  it("rejects media whose checksum was not inspected", async () => {
    await configureAndApprove(instagramInput(fixture.asset, `sha256:${"b".repeat(64)}`), 2)

    await expect(createTarget({
      expectedCalendarRevision: 3,
      requestId: crypto.randomUUID(),
    })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "asset_unavailable",
    })
  })

  it("reports malformed inspected metadata as unavailable media", async () => {
    const malformedAsset = crypto.randomUUID()
    await database`
      INSERT INTO social_media_assets (
        id, team_id, bucket, object_key, object_etag, checksum, kind,
        byte_length, schema_version, asset_contract, created_by
      ) VALUES (
        ${malformedAsset}, ${fixture.team}, 'team-objects',
        ${`teams/${fixture.team}/social-post-media/${malformedAsset}`}, 'etag-invalid',
        ${checksum}, 'image', 2400000, 1,
        ${database.json({
          schema: "screeem.social-media-asset",
          schemaVersion: 1,
          assetId: malformedAsset,
          checksum,
          kind: "image",
          sizeBytes: 2_400_000,
        })}, ${fixture.actor}
      )
    `
    await configureAndApprove(instagramInput(malformedAsset), 2)

    await expect(createTarget({
      expectedCalendarRevision: 3,
      requestId: crypto.randomUUID(),
    })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "asset_unavailable",
    })
  })

  it("does not resolve media from another team", async () => {
    const foreignAsset = crypto.randomUUID()
    const personalTeams = await database<{ readonly id: string }[]>`
      SELECT id FROM teams
      WHERE created_by = ${fixture.actor} AND id <> ${fixture.team}
      LIMIT 1
    `
    const personalTeam = personalTeams[0]?.id
    if (!personalTeam) throw new Error("Expected the signup trigger to create a personal team")
    await database`
      INSERT INTO social_media_assets (
        id, team_id, bucket, object_key, object_etag, checksum, kind,
        byte_length, schema_version, asset_contract, created_by
      ) VALUES (
        ${foreignAsset}, ${personalTeam}, 'team-objects',
        ${`teams/${personalTeam}/social-post-media/${foreignAsset}`}, 'etag-foreign',
        ${checksum}, 'image', 2400000, 1,
        ${database.json(inspectedImage(foreignAsset))}, ${fixture.actor}
      )
    `
    await configureAndApprove(instagramInput(foreignAsset), 2)

    await expect(createTarget({
      expectedCalendarRevision: 3,
      requestId: crypto.randomUUID(),
    })).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "asset_unavailable",
    })
  })

  it("rejects a replay after the connected account changes", async () => {
    await createTarget()
    await database`
      UPDATE integration_connections
      SET external_account_id = 'instagram-account-2', revision = revision + 1
      WHERE team_id = ${fixture.team} AND id = ${fixture.connection}
    `

    await expect(createTarget()).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "request_conflict",
    })
  })

  it("rejects scheduling while team integrations are disabled", async () => {
    await database`
      INSERT INTO integration_team_controls (
        team_id, enabled, disabled_by, disabled_at, updated_by
      ) VALUES (
        ${fixture.team}, false, ${fixture.actor}, now(), ${fixture.actor}
      )
    `

    await expect(createTarget()).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "integration_disabled",
    })
  })

  it("rejects scheduling when the credential is missing", async () => {
    await database`
      DELETE FROM integration_credentials
      WHERE team_id = ${fixture.team} AND connection_id = ${fixture.connection}
    `

    await expect(createTarget()).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "connection_unavailable",
    })
  })

  it("rejects tombstoned media", async () => {
    await database`
      UPDATE social_media_assets
      SET status = 'tombstoned', tombstoned_at = now()
      WHERE team_id = ${fixture.team} AND id = ${fixture.asset}
    `

    await expect(createTarget()).rejects.toMatchObject({
      _tag: "InstagramSchedulingStateError",
      reason: "asset_unavailable",
    })
  })

  it("keeps scheduling writes behind server routes", async () => {
    const privileges = await database<{
      readonly calendar_insert: boolean
      readonly asset_insert: boolean
      readonly target_insert: boolean
      readonly target_update: boolean
      readonly event_insert: boolean
      readonly event_update: boolean
      readonly receipt_select: boolean
      readonly service_event_insert: boolean
      readonly service_receipt_insert: boolean
    }[]>`
      SELECT
        has_table_privilege('authenticated', 'calendar_events', 'INSERT') AS calendar_insert,
        has_table_privilege('authenticated', 'social_media_assets', 'INSERT') AS asset_insert,
        has_table_privilege('authenticated', 'social_post_targets', 'INSERT') AS target_insert,
        has_table_privilege('authenticated', 'social_post_targets', 'UPDATE') AS target_update,
        has_table_privilege('authenticated', 'social_delivery_events', 'INSERT') AS event_insert,
        has_table_privilege('authenticated', 'social_delivery_events', 'UPDATE') AS event_update,
        has_table_privilege('authenticated', 'social_delivery_receipts', 'SELECT') AS receipt_select,
        has_table_privilege('service_role', 'social_delivery_events', 'INSERT') AS service_event_insert,
        has_table_privilege('service_role', 'social_delivery_receipts', 'INSERT') AS service_receipt_insert
    `

    expect(privileges[0]).toEqual({
      calendar_insert: false,
      asset_insert: false,
      target_insert: false,
      target_update: false,
      event_insert: false,
      event_update: false,
      receipt_select: false,
      service_event_insert: false,
      service_receipt_insert: false,
    })
  })

  it("deletes a team with delivery events and a private receipt", async () => {
    const target = await createTarget()
    await appendDeliveryEvent(target.id, fixture.publishStartedEvent, {
      eventType: "publish.started",
      data: { attemptId: fixture.attempt },
    })
    await appendDeliveryEvent(target.id, fixture.publishProgressedEvent, {
      eventType: "publish.progressed",
      data: { attemptId: fixture.attempt, phase: "processing", receiptRevision: 1 },
    }, {
      expectedPreviousRevision: 0,
      keyId: "key-v1",
      sealedPayload: "v1.receipt",
    })

    await expect(database`
      DELETE FROM teams WHERE id = ${fixture.team}
    `).resolves.toBeDefined()
  })

  async function configureAndApprove(input: ReturnType<typeof instagramInput>, revision: number) {
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'instagram.target.configured',
        ${database.json({ expectedRevision: revision, input })}, ${fixture.actor}
      )
    `
    await approveRevision(revision + 1)
  }

  async function approveRevision(revision: number) {
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'approval.requested', ${database.json({ revision })}, ${fixture.actor}
      )
    `
    await database`
      INSERT INTO calendar_events (
        team_id, aggregate_id, client_event_id, event_type, payload, actor_id
      ) VALUES (
        ${fixture.team}, ${fixture.post}, ${crypto.randomUUID()},
        'approval.granted', ${database.json({ revision })}, ${fixture.actor}
      )
    `
  }

  function createTarget(options: {
    readonly expectedCalendarRevision?: number
    readonly requestId?: string
  } = {}) {
    const store = instagramStore()
    return Effect.runPromise(Effect.either(store.createApprovedTarget({
      teamId: fixture.team,
      calendarPostId: fixture.post,
      expectedCalendarRevision: options.expectedCalendarRevision ?? 2,
      requestId: options.requestId ?? fixture.request,
      actorId: fixture.actor,
    }))).then(unwrapEffectResult)
  }

  function cancelTarget(targetId: string) {
    return Effect.runPromise(Effect.either(instagramStore().cancelScheduledTarget({
      teamId: fixture.team,
      calendarPostId: fixture.post,
      targetId,
      expectedCalendarRevision: 2,
      requestId: fixture.cancelEvent,
      actorId: fixture.actor,
    }))).then(unwrapEffectResult)
  }

  function appendDeliveryEvent(
    targetId: string,
    eventId: string,
    action: unknown,
    receipt?: {
      readonly expectedPreviousRevision: number
      readonly keyId: string
      readonly sealedPayload: string
    },
  ) {
    return Effect.runPromise(Effect.either(deliveryEventStore().appendSystemEvent({
      teamId: fixture.team,
      targetId,
      eventId,
      action,
      ...(receipt ? { receipt } : {}),
    }))).then(unwrapEffectResult)
  }

  function instagramStore() {
    return new PostgresInstagramSchedulingStore(
      database,
      () => fixture.target,
      () => new Date("2026-09-01T12:00:00.000Z"),
    )
  }

  function deliveryEventStore() {
    return new PostgresSocialDeliveryEventStore(
      database,
      () => new Date("2026-09-02T09:00:00.000Z"),
    )
  }
})

function unwrapEffectResult<A, E>(result: Either.Either<A, E>): A {
  if (Either.isLeft(result)) throw result.left
  return result.right
}

function identifiers() {
  return {
    actor: crypto.randomUUID(),
    team: crypto.randomUUID(),
    post: crypto.randomUUID(),
    asset: crypto.randomUUID(),
    connection: crypto.randomUUID(),
    target: crypto.randomUUID(),
    request: crypto.randomUUID(),
    cancelEvent: crypto.randomUUID(),
    attempt: crypto.randomUUID(),
    publishStartedEvent: crypto.randomUUID(),
    publishProgressedEvent: crypto.randomUUID(),
    publishProgressedEvent2: crypto.randomUUID(),
    publishSucceededEvent: crypto.randomUUID(),
    publishUncertainEvent: crypto.randomUUID(),
    deleteRequestedEvent: crypto.randomUUID(),
    deleteSucceededEvent: crypto.randomUUID(),
    createdEvent: crypto.randomUUID(),
    configuredEvent: crypto.randomUUID(),
    reviewEvent: crypto.randomUUID(),
    approvedEvent: crypto.randomUUID(),
  }
}

const checksum = `sha256:${"a".repeat(64)}`

function instagramInput(assetId: string, assetChecksum = checksum) {
  return {
    schema: "screeem.instagram-scheduled-post-input",
    schemaVersion: 1,
    schedule: {
      publishAt: "2026-09-02T08:30:00.000Z",
      timezone: "Europe/London",
    },
    template: {
      kind: "instagram.image",
      version: 1,
      caption: "Launch copy",
      isAiGenerated: false,
      image: {
        asset: {
          schema: "screeem.social-media-asset",
          schemaVersion: 1,
          assetId,
          checksum: assetChecksum,
        },
        altText: null,
      },
    },
  }
}

function inspectedImage(assetId: string) {
  return {
    schema: "screeem.social-media-asset",
    schemaVersion: 1,
    assetId,
    checksum,
    kind: "image",
    format: "jpeg",
    mimeType: "image/jpeg",
    sizeBytes: 2_400_000,
    width: 1_080,
    height: 1_350,
    durationMs: null,
  }
}
