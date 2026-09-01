import postgres from "postgres"
import { Effect, Either } from "effect"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PostgresInstagramSchedulingStore,
} from "../src/lib/integrations/social/instagram-scheduling"

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
    const rows = await database<{ readonly status: string }[]>`
      SELECT status FROM social_post_targets
      WHERE team_id = ${fixture.team} AND id = ${target.id}
    `

    expect(rows[0]?.status).toBe("superseded")
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
    }[]>`
      SELECT
        has_table_privilege('authenticated', 'calendar_events', 'INSERT') AS calendar_insert,
        has_table_privilege('authenticated', 'social_media_assets', 'INSERT') AS asset_insert,
        has_table_privilege('authenticated', 'social_post_targets', 'INSERT') AS target_insert,
        has_table_privilege('authenticated', 'social_post_targets', 'UPDATE') AS target_update
    `

    expect(privileges[0]).toEqual({
      calendar_insert: false,
      asset_insert: false,
      target_insert: false,
      target_update: false,
    })
  })

  it("deletes a team that has a scheduled target", async () => {
    await createTarget()

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
    const store = new PostgresInstagramSchedulingStore(
      database,
      () => fixture.target,
      () => new Date("2026-09-01T12:00:00.000Z"),
    )
    return Effect.runPromise(Effect.either(store.createApprovedTarget({
      teamId: fixture.team,
      calendarPostId: fixture.post,
      expectedCalendarRevision: options.expectedCalendarRevision ?? 2,
      requestId: options.requestId ?? fixture.request,
      actorId: fixture.actor,
    }))).then((result) => {
      if (Either.isLeft(result)) throw result.left
      return result.right
    })
  }
})

function identifiers() {
  return {
    actor: crypto.randomUUID(),
    team: crypto.randomUUID(),
    post: crypto.randomUUID(),
    asset: crypto.randomUUID(),
    connection: crypto.randomUUID(),
    target: crypto.randomUUID(),
    request: crypto.randomUUID(),
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
