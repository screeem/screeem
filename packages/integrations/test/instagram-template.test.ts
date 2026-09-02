import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  decodeInstagramScheduledPostInputV1,
  decodeScheduledInstagramPostV1,
  encodeScheduledInstagramPostV1,
  InvalidInstagramPostContractError,
  UnsupportedInstagramPostVersionError,
} from "../src/social/instagram/index.js"

const ids = {
  target: "10000000-0000-4000-8000-000000000001",
  team: "10000000-0000-4000-8000-000000000002",
  post: "10000000-0000-4000-8000-000000000003",
  connection: "10000000-0000-4000-8000-000000000004",
  actor: "10000000-0000-4000-8000-000000000005",
  image: "10000000-0000-4000-8000-000000000006",
  video: "10000000-0000-4000-8000-000000000007",
  image2: "10000000-0000-4000-8000-000000000008",
} as const

const checksum = `sha256:${"a".repeat(64)}`

function metadata() {
  return {
    schema: "screeem.social-post-target",
    schemaVersion: 1,
    id: ids.target,
    teamId: ids.team,
    calendarPostId: ids.post,
    calendarRevision: 4,
    connectionId: ids.connection,
    provider: "instagram",
    schedule: {
      publishAt: "2026-09-01T17:30:00.000Z",
      timezone: "Europe/London",
    },
    createdBy: ids.actor,
    createdAt: "2026-08-31T18:00:00.000Z",
  } as const
}

function assetReference(assetId: string) {
  return {
    schema: "screeem.social-media-asset",
    schemaVersion: 1,
    assetId,
    checksum,
  } as const
}

function imageAsset(assetId: string = ids.image) {
  return {
    ...assetReference(assetId),
    kind: "image",
    format: "jpeg",
    mimeType: "image/jpeg",
    sizeBytes: 4_000_000,
    width: 1_080,
    height: 1_350,
    durationMs: null,
  } as const
}

function videoAsset() {
  return {
    ...assetReference(ids.video),
    kind: "video",
    mimeType: "video/mp4",
    sizeBytes: 18_340_211,
    width: 1_080,
    height: 1_920,
    durationMs: 28_400,
    frameRate: 30,
    videoCodec: "h264",
    videoBitrateBps: 8_000_000,
    audioCodec: "aac",
    audioSampleRateHz: 48_000,
    audioBitrateBps: 128_000,
  } as const
}

function imageTemplate() {
  return {
    kind: "instagram.image",
    version: 1,
    caption: "A scheduled image",
    isAiGenerated: false,
    image: { asset: imageAsset(), altText: "A desk by a window" },
  } as const
}

function scheduledImagePost() {
  return { ...metadata(), template: imageTemplate() } as const
}

async function expectInvalid(input: unknown) {
  const result = await Effect.runPromise(Effect.either(decodeScheduledInstagramPostV1(input)))
  expect(Either.isLeft(result)).toBe(true)
  if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidInstagramPostContractError)
}

describe("versioned Instagram post templates", () => {
  it("round-trips a durable image target without losing either version", async () => {
    const encoded = scheduledImagePost()
    const decoded = await Effect.runPromise(decodeScheduledInstagramPostV1(encoded))
    const roundTrip = await Effect.runPromise(encodeScheduledInstagramPostV1(decoded))

    expect(decoded.template.kind).toBe("instagram.image")
    expect(roundTrip).toEqual(encoded)
  })

  it("decodes an explicit Reel destination and an image carousel", async () => {
    const reel = await Effect.runPromise(decodeScheduledInstagramPostV1({
      ...metadata(),
      template: {
        kind: "instagram.reel",
        version: 1,
        caption: "Behind the scenes",
        isAiGenerated: null,
        shareToFeed: true,
        video: { asset: videoAsset(), coverTimestampMs: 1_500 },
      },
    }))
    const carousel = await Effect.runPromise(decodeScheduledInstagramPostV1({
      ...metadata(),
      template: {
        kind: "instagram.carousel",
        version: 1,
        caption: "Two parts",
        isAiGenerated: true,
        items: [
          { kind: "image", asset: imageAsset(), altText: null },
          { kind: "image", asset: imageAsset(ids.image2), altText: "Second image" },
        ],
      },
    }))

    expect(reel.template.kind).toBe("instagram.reel")
    expect(reel.template).toMatchObject({ shareToFeed: true })
    expect(carousel.template.kind).toBe("instagram.carousel")
  })

  it("keeps authority-bearing fields out of client scheduling input", async () => {
    const input = {
      schema: "screeem.instagram-scheduled-post-input",
      schemaVersion: 1,
      schedule: metadata().schedule,
      template: {
        kind: "instagram.image",
        version: 1,
        caption: "Chosen by the user",
        isAiGenerated: false,
        image: { asset: assetReference(ids.image), altText: null },
      },
    } as const

    await expect(Effect.runPromise(decodeInstagramScheduledPostInputV1(input))).resolves.toBeDefined()
    const overposted = await Effect.runPromise(Effect.either(
      decodeInstagramScheduledPostInputV1({ ...input, teamId: ids.team }),
    ))
    expect(Either.isLeft(overposted)).toBe(true)
    if (Either.isLeft(overposted)) {
      expect(overposted.left).toBeInstanceOf(InvalidInstagramPostContractError)
    }

    const fakeInspection = await Effect.runPromise(Effect.either(
      decodeInstagramScheduledPostInputV1({
        ...input,
        template: {
          ...input.template,
          image: {
            ...input.template.image,
            asset: { ...input.template.image.asset, mimeType: "image/jpeg" },
          },
        },
      }),
    ))
    expect(Either.isLeft(fakeInspection)).toBe(true)
    if (Either.isLeft(fakeInspection)) {
      expect(fakeInspection.left).toBeInstanceOf(InvalidInstagramPostContractError)
    }
  })

  it("classifies an unsupported envelope version separately", async () => {
    const result = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({ ...scheduledImagePost(), schemaVersion: 2 }),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsupportedInstagramPostVersionError)
      expect(result.left).toMatchObject({ receivedVersion: 2 })
    }
  })

  it("classifies an unsupported template version separately", async () => {
    const result = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({
        ...scheduledImagePost(),
        template: { ...imageTemplate(), version: 2 },
      }),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsupportedInstagramPostVersionError)
      expect(result.left).toMatchObject({ receivedVersion: 2 })
    }
  })

  it("classifies a future asset-reference version separately", async () => {
    const result = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({
        ...scheduledImagePost(),
        template: {
          ...imageTemplate(),
          image: {
            ...imageTemplate().image,
            asset: { ...imageAsset(), schemaVersion: 2 },
          },
        },
      }),
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsupportedInstagramPostVersionError)
      expect(result.left).toMatchObject({ part: "asset", receivedVersion: 2 })
    }
  })

  it("does not classify foreign or malformed payloads as future contracts", async () => {
    const foreign = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({ ...scheduledImagePost(), schema: "foreign", schemaVersion: 2 }),
    ))
    const wrongProvider = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({ ...scheduledImagePost(), provider: "foreign", schemaVersion: 2 }),
    ))
    const wrongKind = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({
        ...scheduledImagePost(),
        template: { ...imageTemplate(), kind: "foreign", version: 2 },
      }),
    ))
    const malformedVersion = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({ ...scheduledImagePost(), schemaVersion: "2" }),
    ))
    const unrelatedFutureAsset = await Effect.runPromise(Effect.either(
      decodeScheduledInstagramPostV1({
        ...scheduledImagePost(),
        extra: {
          schema: "screeem.social-media-asset",
          schemaVersion: 2,
        },
      }),
    ))

    for (const result of [
      foreign,
      wrongProvider,
      wrongKind,
      malformedVersion,
      unrelatedFutureAsset,
    ]) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidInstagramPostContractError)
      }
    }
  })

  it("rejects an unknown top-level field", async () => {
    await expectInvalid({ ...scheduledImagePost(), unknown: "not persisted" })
  })

  it("rejects a nested arbitrary media URL even when all metadata is valid", async () => {
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: {
          ...imageTemplate().image,
          url: "https://untrusted.example/post.jpg",
        },
      },
    })
  })

  it("rejects image kind, format, and MIME mismatches", async () => {
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, asset: { ...imageAsset(), kind: "video" } },
      },
    })
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, asset: { ...imageAsset(), format: "mpo" } },
      },
    })
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, asset: { ...imageAsset(), mimeType: "image/png" } },
      },
    })
  })

  it("rejects invalid asset IDs and checksums", async () => {
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, asset: { ...imageAsset(), assetId: "not-a-uuid" } },
      },
    })
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, asset: { ...imageAsset(), checksum: "sha256:nope" } },
      },
    })
  })

  it("rejects control characters in captions and alt text", async () => {
    await expectInvalid({
      ...scheduledImagePost(),
      template: { ...imageTemplate(), caption: "bad\u0000caption" },
    })
    await expectInvalid({
      ...scheduledImagePost(),
      template: {
        ...imageTemplate(),
        image: { ...imageTemplate().image, altText: "bad\u0000alt text" },
      },
    })
  })

  it("requires consistent inspected audio metadata and bounded bitrates", async () => {
    const reel = {
      ...metadata(),
      template: {
        kind: "instagram.reel",
        version: 1,
        caption: "A Reel",
        isAiGenerated: false,
        shareToFeed: false,
        video: { asset: videoAsset(), coverTimestampMs: null },
      },
    } as const

    await expectInvalid({
      ...reel,
      template: {
        ...reel.template,
        video: {
          ...reel.template.video,
          asset: { ...videoAsset(), audioCodec: null },
        },
      },
    })
    await expectInvalid({
      ...reel,
      template: {
        ...reel.template,
        video: {
          ...reel.template.video,
          asset: { ...videoAsset(), videoBitrateBps: 25_000_001 },
        },
      },
    })
  })

  it("requires the cover timestamp to be strictly inside the video", async () => {
    const asset = videoAsset()
    await expectInvalid({
      ...metadata(),
      template: {
        kind: "instagram.reel",
        version: 1,
        caption: "A Reel",
        isAiGenerated: false,
        shareToFeed: true,
        video: { asset, coverTimestampMs: asset.durationMs },
      },
    })
  })

  it("requires carousels to contain between two and ten items", async () => {
    const template = {
      kind: "instagram.carousel",
      version: 1,
      caption: "Carousel",
      isAiGenerated: false,
    } as const
    const item = { kind: "image", asset: imageAsset(), altText: null } as const

    await expectInvalid({ ...metadata(), template: { ...template, items: [item] } })
    await expectInvalid({
      ...metadata(),
      template: { ...template, items: Array.from({ length: 11 }, () => item) },
    })
  })

  it("rejects carousel video in V1", async () => {
    await expectInvalid({
      ...metadata(),
      template: {
        kind: "instagram.carousel",
        version: 1,
        caption: "Video carousel",
        isAiGenerated: false,
        items: [
          { kind: "image", asset: imageAsset(), altText: null },
          { kind: "video", asset: videoAsset(), coverTimestampMs: null },
        ],
      },
    })
  })
})
