import { Schema } from "effect"

export const SafeIntegerSchema = Schema.Int.pipe(
  Schema.filter(Number.isSafeInteger, {
    message: () => "Expected a safe integer",
  }),
).annotations({ identifier: "SafeInteger" })

export const NonNegativeSafeIntegerSchema = SafeIntegerSchema.pipe(
  Schema.greaterThanOrEqualTo(0),
).annotations({ identifier: "NonNegativeSafeInteger" })

export const PositiveSafeIntegerSchema = SafeIntegerSchema.pipe(
  Schema.greaterThan(0),
).annotations({ identifier: "PositiveSafeInteger" })

export const SocialMediaAssetReferenceV1Schema = Schema.Struct({
  schema: Schema.Literal("screeem.social-media-asset"),
  schemaVersion: Schema.Literal(1),
  assetId: Schema.UUID,
  checksum: Schema.String.pipe(
    Schema.pattern(/^sha256:[a-f0-9]{64}$/),
  ),
}).annotations({
  identifier: "SocialMediaAssetReferenceV1",
  description: "Immutable media selection that the server verifies before scheduling",
})

export type SocialMediaAssetReferenceV1 = typeof SocialMediaAssetReferenceV1Schema.Type
export type SocialMediaAssetReferenceV1Encoded =
  typeof SocialMediaAssetReferenceV1Schema.Encoded

export const SocialPostScheduleV1Schema = Schema.Struct({
  publishAt: Schema.DateTimeUtc,
  timezone: Schema.TimeZoneNamed,
}).annotations({ identifier: "SocialPostScheduleV1" })

export type SocialPostScheduleV1 = typeof SocialPostScheduleV1Schema.Type
export type SocialPostScheduleV1Encoded = typeof SocialPostScheduleV1Schema.Encoded

export const ScheduledSocialPostTargetMetadataV1Schema = Schema.Struct({
  schema: Schema.Literal("screeem.social-post-target"),
  schemaVersion: Schema.Literal(1),
  id: Schema.UUID,
  teamId: Schema.UUID,
  calendarPostId: Schema.UUID,
  calendarRevision: PositiveSafeIntegerSchema,
  connectionId: Schema.UUID,
  schedule: SocialPostScheduleV1Schema,
  createdBy: Schema.UUID,
  createdAt: Schema.DateTimeUtc,
}).annotations({
  identifier: "ScheduledSocialPostTargetMetadataV1",
  description: "Server-owned metadata for one immutable social delivery target",
})

export type ScheduledSocialPostTargetMetadataV1 =
  typeof ScheduledSocialPostTargetMetadataV1Schema.Type
export type ScheduledSocialPostTargetMetadataV1Encoded =
  typeof ScheduledSocialPostTargetMetadataV1Schema.Encoded
