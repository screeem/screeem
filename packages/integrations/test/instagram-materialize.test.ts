import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  encodeScheduledInstagramPostV1,
  InstagramAssetResolutionError,
  materializeScheduledInstagramPostV1,
} from "../src/social/instagram/index.js"

const ids = {
  target: "20000000-0000-4000-8000-000000000001",
  team: "20000000-0000-4000-8000-000000000002",
  post: "20000000-0000-4000-8000-000000000003",
  connection: "20000000-0000-4000-8000-000000000004",
  actor: "20000000-0000-4000-8000-000000000005",
  image: "20000000-0000-4000-8000-000000000006",
  otherImage: "20000000-0000-4000-8000-000000000007",
} as const

const checksum = `sha256:${"a".repeat(64)}`

function reference(assetId: string = ids.image) {
  return {
    schema: "screeem.social-media-asset",
    schemaVersion: 1,
    assetId,
    checksum,
  } as const
}

function input() {
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
      caption: "Ready to publish",
      isAiGenerated: false,
      image: { asset: reference(), altText: "A table beside a window" },
    },
  } as const
}

function metadata() {
  return {
    schema: "screeem.social-post-target",
    schemaVersion: 1,
    id: ids.target,
    teamId: ids.team,
    calendarPostId: ids.post,
    calendarRevision: 3,
    connectionId: ids.connection,
    schedule: input().schedule,
    createdBy: ids.actor,
    createdAt: "2026-09-01T12:00:00.000Z",
  } as const
}

function inspectedImage(assetId: string = ids.image) {
  return {
    ...reference(assetId),
    kind: "image",
    format: "jpeg",
    mimeType: "image/jpeg",
    sizeBytes: 2_400_000,
    width: 1_080,
    height: 1_350,
    durationMs: null,
  } as const
}

describe("Instagram target materialization", () => {
  it("replaces the client reference with the matching inspected asset", async () => {
    const target = await Effect.runPromise(
      materializeScheduledInstagramPostV1(input(), metadata(), [inspectedImage()]),
    )

    expect(target).toMatchObject({
      id: ids.target,
      provider: "instagram",
      template: {
        kind: "instagram.image",
        image: { asset: { assetId: ids.image, width: 1_080, height: 1_350 } },
      },
    })
  })

  it("takes the publish time from approved input rather than authority metadata", async () => {
    const target = await Effect.runPromise(
      materializeScheduledInstagramPostV1(
        input(),
        {
          ...metadata(),
          schedule: {
            publishAt: "2027-01-01T00:00:00.000Z",
            timezone: "UTC",
          },
        },
        [inspectedImage()],
      ).pipe(Effect.flatMap(encodeScheduledInstagramPostV1)),
    )

    expect(target.schedule).toMatchObject(input().schedule)
  })

  it("rejects missing and wrong-kind inspected media", async () => {
    const missing = await Effect.runPromise(Effect.either(
      materializeScheduledInstagramPostV1(input(), metadata(), []),
    ))
    const wrongKind = await Effect.runPromise(Effect.either(
      materializeScheduledInstagramPostV1(input(), metadata(), [{
        ...reference(),
        kind: "video",
        mimeType: "video/mp4",
        sizeBytes: 10_000_000,
        width: 1_080,
        height: 1_920,
        durationMs: 10_000,
        frameRate: 30,
        videoCodec: "h264",
        videoBitrateBps: 8_000_000,
        audioCodec: "aac",
        audioSampleRateHz: 48_000,
        audioBitrateBps: 128_000,
      }]),
    ))

    expect(Either.isLeft(missing)).toBe(true)
    expect(Either.isLeft(wrongKind)).toBe(true)
    if (Either.isLeft(missing)) {
      expect(missing.left).toBeInstanceOf(InstagramAssetResolutionError)
      expect(missing.left).toMatchObject({ assetId: ids.image, reason: "missing" })
    }
    if (Either.isLeft(wrongKind)) {
      expect(wrongKind.left).toMatchObject({ assetId: ids.image, reason: "wrong_kind" })
    }
  })

  it("rejects inspected assets that the input did not reference", async () => {
    const result = await Effect.runPromise(Effect.either(
      materializeScheduledInstagramPostV1(
        input(),
        metadata(),
        [inspectedImage(), inspectedImage(ids.otherImage)],
      ),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ assetId: ids.otherImage, reason: "unexpected" })
    }
  })
})
