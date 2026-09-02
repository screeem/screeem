import { Data, Effect, Schema } from "effect"

import {
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  ScheduledSocialPostTargetMetadataV1Schema,
  SocialMediaAssetReferenceV1Schema,
  SocialPostScheduleV1Schema,
} from "../scheduling.js"

const maximumCarouselItems = 10
const maximumCaptionLength = 2_200
const maximumAltTextLength = 1_000
const minimumReelDurationMs = 3_000
const maximumReelDurationMs = 900_000
const maximumReelSizeBytes = 1_000_000_000
const maximumVideoBitrateBps = 25_000_000
const maximumAudioBitrateBps = 128_000
const disallowedPostText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u

const InstagramCaptionSchema = Schema.String.pipe(
  Schema.maxLength(maximumCaptionLength),
  Schema.filter((value) => !disallowedPostText.test(value), {
    message: () => "Instagram captions cannot contain control characters",
  }),
).annotations({ identifier: "InstagramCaption" })

const InstagramImageAltTextSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(maximumAltTextLength),
  Schema.filter((value) => !disallowedPostText.test(value), {
    message: () => "Instagram image alt text cannot contain control characters",
  }),
).annotations({ identifier: "InstagramImageAltText" })

export const InstagramImageAssetV1Schema = Schema.Struct({
  ...SocialMediaAssetReferenceV1Schema.fields,
  kind: Schema.Literal("image"),
  format: Schema.Literal("jpeg"),
  mimeType: Schema.Literal("image/jpeg"),
  sizeBytes: PositiveSafeIntegerSchema,
  width: PositiveSafeIntegerSchema,
  height: PositiveSafeIntegerSchema,
  durationMs: Schema.Null,
}).annotations({
  identifier: "InstagramImageAssetV1",
  description: "Server-inspected standard JPEG metadata; compatibility is rechecked at dispatch",
})

export type InstagramImageAssetV1 = typeof InstagramImageAssetV1Schema.Type
export type InstagramImageAssetV1Encoded = typeof InstagramImageAssetV1Schema.Encoded

function publishingVideoAssetSchema(identifier: string, description: string) {
  return Schema.Struct({
    ...SocialMediaAssetReferenceV1Schema.fields,
    kind: Schema.Literal("video"),
    mimeType: Schema.Literal("video/mp4", "video/quicktime"),
    sizeBytes: PositiveSafeIntegerSchema.pipe(
      Schema.lessThanOrEqualTo(maximumReelSizeBytes),
    ),
    width: PositiveSafeIntegerSchema.pipe(
      Schema.lessThanOrEqualTo(1_920),
    ),
    height: PositiveSafeIntegerSchema,
    durationMs: PositiveSafeIntegerSchema.pipe(
      Schema.greaterThanOrEqualTo(minimumReelDurationMs),
      Schema.lessThanOrEqualTo(maximumReelDurationMs),
    ),
    frameRate: Schema.Number.pipe(
      Schema.greaterThanOrEqualTo(23),
      Schema.lessThanOrEqualTo(60),
    ),
    videoCodec: Schema.Literal("h264", "hevc"),
    videoBitrateBps: PositiveSafeIntegerSchema.pipe(
      Schema.lessThanOrEqualTo(maximumVideoBitrateBps),
    ),
    audioCodec: Schema.NullOr(Schema.Literal("aac")),
    audioSampleRateHz: Schema.NullOr(Schema.Literal(48_000)),
    audioBitrateBps: Schema.NullOr(
      PositiveSafeIntegerSchema.pipe(
        Schema.lessThanOrEqualTo(maximumAudioBitrateBps),
      ),
    ),
  }).pipe(
    Schema.filter(
      ({ audioBitrateBps, audioCodec, audioSampleRateHz }) =>
        (audioCodec === null && audioSampleRateHz === null && audioBitrateBps === null) ||
        (audioCodec === "aac" && audioSampleRateHz === 48_000 && audioBitrateBps !== null),
      {
        message: () =>
          "Instagram video audio metadata must describe either AAC audio or a silent video",
      },
    ),
  ).annotations({ identifier, description })
}

export const InstagramReelVideoAssetV1Schema = publishingVideoAssetSchema(
  "InstagramReelVideoAssetV1",
  "Server-inspected video metadata accepted by the version 1 Reel profile",
)

export type InstagramReelVideoAssetV1 = typeof InstagramReelVideoAssetV1Schema.Type
export type InstagramReelVideoAssetV1Encoded =
  typeof InstagramReelVideoAssetV1Schema.Encoded

const InstagramTemplateBaseFieldsV1 = {
  version: Schema.Literal(1),
  caption: InstagramCaptionSchema,
  isAiGenerated: Schema.NullOr(Schema.Boolean),
}

const InstagramReelVideoSelectionV1Schema = Schema.Struct({
  asset: InstagramReelVideoAssetV1Schema,
  coverTimestampMs: Schema.NullOr(NonNegativeSafeIntegerSchema),
}).pipe(
  Schema.filter(
    ({ asset, coverTimestampMs }) =>
      coverTimestampMs === null || coverTimestampMs < asset.durationMs,
    { message: () => "Reel cover timestamp must be within the video duration" },
  ),
).annotations({ identifier: "InstagramReelVideoSelectionV1" })

export const InstagramImageTemplateV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.image"),
  image: Schema.Struct({
    asset: InstagramImageAssetV1Schema,
    altText: Schema.NullOr(InstagramImageAltTextSchema),
  }),
}).annotations({ identifier: "InstagramImageTemplateV1" })

export type InstagramImageTemplateV1 = typeof InstagramImageTemplateV1Schema.Type
export type InstagramImageTemplateV1Encoded =
  typeof InstagramImageTemplateV1Schema.Encoded

export const InstagramReelTemplateV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.reel"),
  video: InstagramReelVideoSelectionV1Schema,
  shareToFeed: Schema.Boolean,
}).annotations({ identifier: "InstagramReelTemplateV1" })

export type InstagramReelTemplateV1 = typeof InstagramReelTemplateV1Schema.Type
export type InstagramReelTemplateV1Encoded = typeof InstagramReelTemplateV1Schema.Encoded

export const InstagramCarouselItemV1Schema = Schema.Struct({
  kind: Schema.Literal("image"),
  asset: InstagramImageAssetV1Schema,
  altText: Schema.NullOr(InstagramImageAltTextSchema),
}).annotations({ identifier: "InstagramCarouselItemV1" })

export type InstagramCarouselItemV1 = typeof InstagramCarouselItemV1Schema.Type
export type InstagramCarouselItemV1Encoded = typeof InstagramCarouselItemV1Schema.Encoded

export const InstagramCarouselTemplateV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.carousel"),
  items: Schema.Array(InstagramCarouselItemV1Schema).pipe(
    Schema.minItems(2),
    Schema.maxItems(maximumCarouselItems),
  ),
}).annotations({ identifier: "InstagramCarouselTemplateV1" })

export type InstagramCarouselTemplateV1 = typeof InstagramCarouselTemplateV1Schema.Type
export type InstagramCarouselTemplateV1Encoded =
  typeof InstagramCarouselTemplateV1Schema.Encoded

export const InstagramTemplateV1Schema = Schema.Union(
  InstagramImageTemplateV1Schema,
  InstagramReelTemplateV1Schema,
  InstagramCarouselTemplateV1Schema,
).annotations({ identifier: "InstagramTemplateV1" })

export type InstagramTemplateV1 = typeof InstagramTemplateV1Schema.Type
export type InstagramTemplateV1Encoded = typeof InstagramTemplateV1Schema.Encoded

const InstagramImagePostInputV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.image"),
  image: Schema.Struct({
    asset: SocialMediaAssetReferenceV1Schema,
    altText: Schema.NullOr(InstagramImageAltTextSchema),
  }),
})

const ClientVideoSelectionV1Schema = Schema.Struct({
  asset: SocialMediaAssetReferenceV1Schema,
  coverTimestampMs: Schema.NullOr(
    NonNegativeSafeIntegerSchema.pipe(
      Schema.lessThanOrEqualTo(maximumReelDurationMs),
    ),
  ),
})

const InstagramReelPostInputV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.reel"),
  video: ClientVideoSelectionV1Schema,
  shareToFeed: Schema.Boolean,
})

const InstagramCarouselPostInputItemV1Schema = Schema.Struct({
  kind: Schema.Literal("image"),
  asset: SocialMediaAssetReferenceV1Schema,
  altText: Schema.NullOr(InstagramImageAltTextSchema),
})

const InstagramCarouselPostInputV1Schema = Schema.Struct({
  ...InstagramTemplateBaseFieldsV1,
  kind: Schema.Literal("instagram.carousel"),
  items: Schema.Array(InstagramCarouselPostInputItemV1Schema).pipe(
    Schema.minItems(2),
    Schema.maxItems(maximumCarouselItems),
  ),
})

export const InstagramPostInputTemplateV1Schema = Schema.Union(
  InstagramImagePostInputV1Schema,
  InstagramReelPostInputV1Schema,
  InstagramCarouselPostInputV1Schema,
).annotations({ identifier: "InstagramPostInputTemplateV1" })

export type InstagramPostInputTemplateV1 = typeof InstagramPostInputTemplateV1Schema.Type
export type InstagramPostInputTemplateV1Encoded =
  typeof InstagramPostInputTemplateV1Schema.Encoded

export const InstagramScheduledPostInputV1Schema = Schema.Struct({
  schema: Schema.Literal("screeem.instagram-scheduled-post-input"),
  schemaVersion: Schema.Literal(1),
  schedule: SocialPostScheduleV1Schema,
  template: InstagramPostInputTemplateV1Schema,
}).annotations({
  identifier: "InstagramScheduledPostInputV1",
  description: "User-editable Instagram scheduling input without server-owned authority fields",
})

export type InstagramScheduledPostInputV1 = typeof InstagramScheduledPostInputV1Schema.Type
export type InstagramScheduledPostInputV1Encoded =
  typeof InstagramScheduledPostInputV1Schema.Encoded

export const ScheduledInstagramPostV1Schema = Schema.extend(
  ScheduledSocialPostTargetMetadataV1Schema,
  Schema.Struct({
    provider: Schema.Literal("instagram"),
    template: InstagramTemplateV1Schema,
  }),
).annotations({ identifier: "ScheduledInstagramPostV1" })

export type ScheduledInstagramPostV1 = typeof ScheduledInstagramPostV1Schema.Type
export type ScheduledInstagramPostV1Encoded = typeof ScheduledInstagramPostV1Schema.Encoded

export class InvalidInstagramPostContractError extends Data.TaggedError(
  "InvalidInstagramPostContractError",
)<{
  readonly contract: "input" | "scheduled-post" | "template"
}> {
  readonly code = "invalid_instagram_post_contract" as const

  get message(): string {
    return `Invalid Instagram ${this.contract} contract`
  }
}

export class UnsupportedInstagramPostVersionError extends Data.TaggedError(
  "UnsupportedInstagramPostVersionError",
)<{
  readonly contract: "input" | "scheduled-post" | "template"
  readonly part: "asset" | "envelope" | "template"
  readonly receivedVersion: number
}> {
  readonly code = "unsupported_instagram_post_version" as const

  get message(): string {
    return `Unsupported Instagram ${this.part} version`
  }
}

export type InstagramPostContractError =
  | InvalidInstagramPostContractError
  | UnsupportedInstagramPostVersionError

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const

const decodeTemplate = Schema.decodeUnknown(InstagramTemplateV1Schema, strictParseOptions)
const decodeInput = Schema.decodeUnknown(InstagramScheduledPostInputV1Schema, strictParseOptions)
const decodeScheduledPost = Schema.decodeUnknown(
  ScheduledInstagramPostV1Schema,
  strictParseOptions,
)

export function decodeInstagramTemplateV1(
  input: unknown,
): Effect.Effect<InstagramTemplateV1, InstagramPostContractError> {
  const unsupported = unsupportedVersion(input, "template", false)
  return unsupported === null
    ? decodeTemplate(input).pipe(
        Effect.mapError(() => new InvalidInstagramPostContractError({ contract: "template" })),
      )
    : Effect.fail(unsupported)
}

export function decodeInstagramScheduledPostInputV1(
  input: unknown,
): Effect.Effect<InstagramScheduledPostInputV1, InstagramPostContractError> {
  const unsupported = unsupportedVersion(input, "input", true)
  return unsupported === null
    ? decodeInput(input).pipe(
        Effect.mapError(() => new InvalidInstagramPostContractError({ contract: "input" })),
      )
    : Effect.fail(unsupported)
}

export function decodeScheduledInstagramPostV1(
  input: unknown,
): Effect.Effect<ScheduledInstagramPostV1, InstagramPostContractError> {
  const unsupported = unsupportedVersion(input, "scheduled-post", true)
  return unsupported === null
    ? decodeScheduledPost(input).pipe(
        Effect.mapError(() =>
          new InvalidInstagramPostContractError({ contract: "scheduled-post" })
        ),
      )
    : Effect.fail(unsupported)
}

export const encodeInstagramScheduledPostInputV1 = Schema.encode(
  InstagramScheduledPostInputV1Schema,
)
export const encodeScheduledInstagramPostV1 = Schema.encode(ScheduledInstagramPostV1Schema)

function unsupportedVersion(
  input: unknown,
  contract: "input" | "scheduled-post" | "template",
  envelope: boolean,
): UnsupportedInstagramPostVersionError | null {
  const root = objectRecord(input)
  if (root === null) return null
  const expectedEnvelope = contract === "input"
    ? root.schema === "screeem.instagram-scheduled-post-input"
    : contract === "scheduled-post"
      ? root.schema === "screeem.social-post-target" && root.provider === "instagram"
      : true
  if (envelope && expectedEnvelope && root.schemaVersion !== 1) {
    return isPositiveSafeInteger(root.schemaVersion)
      ? new UnsupportedInstagramPostVersionError({
          contract,
          part: "envelope",
          receivedVersion: root.schemaVersion,
        })
      : null
  }
  const template = objectRecord(envelope ? root.template : root)
  if (
    expectedEnvelope &&
    template !== null &&
    isInstagramTemplateKind(template.kind) &&
    template.version !== 1
  ) {
    return isPositiveSafeInteger(template.version)
      ? new UnsupportedInstagramPostVersionError({
          contract,
          part: "template",
          receivedVersion: template.version,
        })
      : null
  }
  const assetVersion = (expectedEnvelope || !envelope) &&
      template !== null &&
      isInstagramTemplateKind(template.kind)
    ? unsupportedAssetVersion(template)
    : null
  return assetVersion === null
    ? null
    : new UnsupportedInstagramPostVersionError({
        contract,
        part: "asset",
        receivedVersion: assetVersion,
      })
}

function unsupportedAssetVersion(template: Record<string, unknown>): number | null {
  const assets = template.kind === "instagram.image"
    ? [objectRecord(objectRecord(template.image)?.asset)]
    : template.kind === "instagram.reel"
      ? [objectRecord(objectRecord(template.video)?.asset)]
      : Array.isArray(template.items)
        ? template.items.map((item) => {
            const record = objectRecord(item)
            return record?.kind === "image" ? objectRecord(record.asset) : null
          })
        : []
  for (const asset of assets) {
    if (
      asset?.schema === "screeem.social-media-asset" &&
      isPositiveSafeInteger(asset.schemaVersion) &&
      asset.schemaVersion !== 1
    ) {
      return asset.schemaVersion
    }
  }
  return null
}

function isInstagramTemplateKind(input: unknown): boolean {
  return input === "instagram.image" ||
    input === "instagram.reel" ||
    input === "instagram.carousel"
}

function isPositiveSafeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) > 0
}

function objectRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null
}
