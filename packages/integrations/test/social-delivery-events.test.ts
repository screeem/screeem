import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  decodeSocialDeliveryEventActionV1,
  decodeSocialDeliveryEventV1,
  encodeSocialDeliveryEventV1,
  materializeSocialDeliveryEventV1,
  UnsupportedSocialDeliveryEventVersionError,
} from "../src/social/index.js"

const ids = {
  event: "30000000-0000-4000-8000-000000000001",
  team: "30000000-0000-4000-8000-000000000002",
  target: "30000000-0000-4000-8000-000000000003",
  connection: "30000000-0000-4000-8000-000000000004",
  actor: "30000000-0000-4000-8000-000000000005",
  attempt: "30000000-0000-4000-8000-000000000006",
} as const

const metadata = {
  schema: "screeem.social-delivery-event",
  schemaVersion: 1,
  id: ids.event,
  teamId: ids.team,
  targetId: ids.target,
  provider: "instagram",
  sequence: 1,
  actor: { kind: "user", userId: ids.actor },
  occurredAt: "2026-09-02T09:00:00.000Z",
} as const

describe("social delivery event contracts", () => {
  it("materializes and round-trips a scheduled event", async () => {
    const decoded = await Effect.runPromise(materializeSocialDeliveryEventV1({
      eventType: "target.scheduled",
      data: {
        calendarRevision: 3,
        connectionId: ids.connection,
        externalAccountId: "instagram-account-1",
        publishAt: "2026-09-02T10:00:00.000Z",
      },
    }, metadata))
    const encoded = await Effect.runPromise(encodeSocialDeliveryEventV1(decoded))

    expect(encoded).toEqual({
      ...metadata,
      eventType: "target.scheduled",
      data: {
        calendarRevision: 3,
        connectionId: ids.connection,
        externalAccountId: "instagram-account-1",
        publishAt: "2026-09-02T10:00:00.000Z",
      },
    })
  })

  it.each([
    { eventType: "target.cancelled", data: { reason: "user_requested" } },
    { eventType: "target.superseded", data: { reason: "calendar_changed" } },
    { eventType: "publish.started", data: { attemptId: ids.attempt } },
    {
      eventType: "publish.progressed",
      data: { attemptId: ids.attempt, phase: "processing", receiptRevision: 1 },
    },
    {
      eventType: "publish.resumed",
      data: { attemptId: ids.attempt, receiptRevision: 1 },
    },
    {
      eventType: "publish.succeeded",
      data: {
        attemptId: ids.attempt,
        permalink: "https://www.instagram.com/p/example/",
        receiptRevision: 2,
        remotePostId: "remote-post-1",
      },
    },
    {
      eventType: "publish.uncertain",
      data: {
        attemptId: ids.attempt,
        errorCode: "provider_outcome_unknown",
        providerReference: "container-1",
      },
    },
    {
      eventType: "publish.failed",
      data: {
        attemptId: ids.attempt,
        errorCode: "provider_unavailable",
        receipt: { kind: "unchanged", revision: 1 },
        retryable: true,
        retryAt: "2026-09-02T09:05:00.000Z",
        retryMode: "resume",
      },
    },
    {
      eventType: "remote-delete.requested",
      data: { remotePostId: "remote-post-1" },
    },
    {
      eventType: "remote-delete.succeeded",
      data: { remotePostId: "remote-post-1" },
    },
    {
      eventType: "remote-delete.failed",
      data: {
        errorCode: "provider_unavailable",
        remotePostId: "remote-post-1",
        retryable: true,
        retryAt: "2026-09-02T09:05:00.000Z",
      },
    },
  ] as const)("accepts $eventType", async (action) => {
    await expect(Effect.runPromise(
      materializeSocialDeliveryEventV1(action, metadata),
    )).resolves.toBeDefined()
  })

  it("rejects authority fields and unknown actions", async () => {
    const authority = await Effect.runPromise(Effect.either(
      decodeSocialDeliveryEventActionV1({
        eventType: "publish.started",
        data: { attemptId: ids.attempt },
        teamId: ids.team,
      }),
    ))
    const unknown = await Effect.runPromise(Effect.either(
      decodeSocialDeliveryEventActionV1({ eventType: "publish.paused", data: {} }),
    ))

    expect(Either.isLeft(authority)).toBe(true)
    expect(Either.isLeft(unknown)).toBe(true)
  })

  it("rejects retry metadata on a terminal failure", async () => {
    const result = await Effect.runPromise(Effect.either(
      decodeSocialDeliveryEventActionV1({
        eventType: "publish.failed",
        data: {
          attemptId: ids.attempt,
          errorCode: "invalid_media",
          receipt: { kind: "unchanged", revision: null },
          retryable: false,
          retryAt: "2026-09-02T09:05:00.000Z",
          retryMode: null,
        },
      }),
    ))

    expect(Either.isLeft(result)).toBe(true)
  })

  it("reports a future event version separately", async () => {
    const result = await Effect.runPromise(Effect.either(
      decodeSocialDeliveryEventV1({
        ...metadata,
        schemaVersion: 2,
        eventType: "publish.started",
        data: { attemptId: ids.attempt },
      }),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsupportedSocialDeliveryEventVersionError)
      expect(result.left).toMatchObject({ receivedVersion: 2 })
    }
  })
})
