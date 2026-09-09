import { Data, Effect, Schema } from "effect"

import { PositiveSafeIntegerSchema } from "./scheduling.js"

const ExternalAccountIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(256),
)

const RemotePostIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(256),
)

const ProviderReferenceSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(512),
)

const PublishErrorCodeSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9_]{0,127}$/),
)

const PermalinkSchema = Schema.String.pipe(
  Schema.maxLength(2_048),
  Schema.pattern(/^https:\/\//),
)

export const SocialDeliveryActorV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("system"),
    source: Schema.Literal("database", "dispatcher", "scheduler"),
  }),
  Schema.Struct({ kind: Schema.Literal("user"), userId: Schema.UUID }),
).annotations({ identifier: "SocialDeliveryActorV1" })

export const TargetScheduledActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("target.scheduled"),
  data: Schema.Struct({
    calendarRevision: PositiveSafeIntegerSchema,
    connectionId: Schema.UUID,
    externalAccountId: ExternalAccountIdSchema,
    publishAt: Schema.DateTimeUtc,
  }),
})

export const TargetCancelledActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("target.cancelled"),
  data: Schema.Struct({
    reason: Schema.Literal("system", "user_requested"),
  }),
})

export const TargetSupersededActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("target.superseded"),
  data: Schema.Struct({
    reason: Schema.Literal("calendar_changed", "replacement_scheduled", "system"),
  }),
})

export const PublishStartedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.started"),
  data: Schema.Struct({ attemptId: Schema.UUID }),
})

export const PublishProgressedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.progressed"),
  data: Schema.Struct({
    attemptId: Schema.UUID,
    phase: Schema.Literal("processing"),
    receiptRevision: PositiveSafeIntegerSchema,
  }),
})

export const PublishResumedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.resumed"),
  data: Schema.Struct({
    attemptId: Schema.UUID,
    receiptRevision: PositiveSafeIntegerSchema,
  }),
})

export const PublishSucceededActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.succeeded"),
  data: Schema.Struct({
    attemptId: Schema.UUID,
    permalink: Schema.NullOr(PermalinkSchema),
    receiptRevision: PositiveSafeIntegerSchema,
    remotePostId: Schema.NullOr(RemotePostIdSchema),
  }),
})

export const PublishFailedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.failed"),
  data: Schema.Struct({
    attemptId: Schema.UUID,
    errorCode: PublishErrorCodeSchema,
    receipt: Schema.Union(
      Schema.Struct({
        kind: Schema.Literal("unchanged"),
        revision: Schema.NullOr(PositiveSafeIntegerSchema),
      }),
      Schema.Struct({
        kind: Schema.Literal("recorded"),
        phase: Schema.Literal("failed"),
        revision: PositiveSafeIntegerSchema,
      }),
    ),
    retryable: Schema.Boolean,
    retryAt: Schema.NullOr(Schema.DateTimeUtc),
    retryMode: Schema.NullOr(Schema.Literal("restart", "resume")),
  }).pipe(
    Schema.filter(
      ({ receipt, retryable, retryAt, retryMode }) => {
        if (!retryable) return retryAt === null && retryMode === null
        if (receipt.kind === "recorded") return false
        if (retryMode === null) return false
        return receipt.revision === null
          ? retryMode === "restart"
          : retryMode === "resume"
      },
      { message: () => "Publish failure retry state is inconsistent" },
    ),
  ),
})

export const PublishUncertainActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("publish.uncertain"),
  data: Schema.Struct({
    attemptId: Schema.UUID,
    errorCode: PublishErrorCodeSchema,
    providerReference: Schema.NullOr(ProviderReferenceSchema),
  }),
})

export const RemoteDeleteRequestedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("remote-delete.requested"),
  data: Schema.Struct({ remotePostId: RemotePostIdSchema }),
})

export const RemoteDeleteSucceededActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("remote-delete.succeeded"),
  data: Schema.Struct({ remotePostId: RemotePostIdSchema }),
})

export const RemoteDeleteFailedActionV1Schema = Schema.Struct({
  eventType: Schema.Literal("remote-delete.failed"),
  data: Schema.Struct({
    errorCode: PublishErrorCodeSchema,
    remotePostId: RemotePostIdSchema,
    retryable: Schema.Boolean,
    retryAt: Schema.NullOr(Schema.DateTimeUtc),
  }).pipe(
    Schema.filter(
      ({ retryable, retryAt }) => retryable || retryAt === null,
      { message: () => "Terminal remote-delete failures cannot have a retry time" },
    ),
  ),
})

export const SocialDeliveryEventActionV1Schema = Schema.Union(
  TargetScheduledActionV1Schema,
  TargetCancelledActionV1Schema,
  TargetSupersededActionV1Schema,
  PublishStartedActionV1Schema,
  PublishProgressedActionV1Schema,
  PublishResumedActionV1Schema,
  PublishSucceededActionV1Schema,
  PublishFailedActionV1Schema,
  PublishUncertainActionV1Schema,
  RemoteDeleteRequestedActionV1Schema,
  RemoteDeleteSucceededActionV1Schema,
  RemoteDeleteFailedActionV1Schema,
).annotations({ identifier: "SocialDeliveryEventActionV1" })

export type SocialDeliveryEventActionV1 = typeof SocialDeliveryEventActionV1Schema.Type
export type SocialDeliveryEventActionV1Encoded =
  typeof SocialDeliveryEventActionV1Schema.Encoded

export const SocialDeliveryEventMetadataV1Schema = Schema.Struct({
  schema: Schema.Literal("screeem.social-delivery-event"),
  schemaVersion: Schema.Literal(1),
  id: Schema.UUID,
  teamId: Schema.UUID,
  targetId: Schema.UUID,
  provider: Schema.Literal("instagram"),
  sequence: PositiveSafeIntegerSchema,
  actor: SocialDeliveryActorV1Schema,
  occurredAt: Schema.DateTimeUtc,
}).annotations({ identifier: "SocialDeliveryEventMetadataV1" })

export type SocialDeliveryEventMetadataV1 = typeof SocialDeliveryEventMetadataV1Schema.Type
export type SocialDeliveryEventMetadataV1Encoded =
  typeof SocialDeliveryEventMetadataV1Schema.Encoded

const metadataFields = SocialDeliveryEventMetadataV1Schema.fields

export const SocialDeliveryEventV1Schema = Schema.Union(
  Schema.Struct({ ...metadataFields, ...TargetScheduledActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...TargetCancelledActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...TargetSupersededActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishStartedActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishProgressedActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishResumedActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishSucceededActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishFailedActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...PublishUncertainActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...RemoteDeleteRequestedActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...RemoteDeleteSucceededActionV1Schema.fields }),
  Schema.Struct({ ...metadataFields, ...RemoteDeleteFailedActionV1Schema.fields }),
).annotations({
  identifier: "SocialDeliveryEventV1",
  description: "One immutable fact in a social target delivery stream",
})

export type SocialDeliveryEventV1 = typeof SocialDeliveryEventV1Schema.Type
export type SocialDeliveryEventV1Encoded = typeof SocialDeliveryEventV1Schema.Encoded

export class InvalidSocialDeliveryEventContractError extends Data.TaggedError(
  "InvalidSocialDeliveryEventContractError",
)<{ readonly contract: "action" | "event" | "metadata" }> {
  readonly code = "invalid_social_delivery_event_contract" as const
}

export class UnsupportedSocialDeliveryEventVersionError extends Data.TaggedError(
  "UnsupportedSocialDeliveryEventVersionError",
)<{ readonly receivedVersion: number }> {
  readonly code = "unsupported_social_delivery_event_version" as const
}

export type SocialDeliveryEventContractError =
  | InvalidSocialDeliveryEventContractError
  | UnsupportedSocialDeliveryEventVersionError

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const

const decodeAction = Schema.decodeUnknown(
  SocialDeliveryEventActionV1Schema,
  strictParseOptions,
)
const decodeEvent = Schema.decodeUnknown(SocialDeliveryEventV1Schema, strictParseOptions)
const decodeMetadata = Schema.decodeUnknown(
  SocialDeliveryEventMetadataV1Schema,
  strictParseOptions,
)
const encodeMetadata = Schema.encode(SocialDeliveryEventMetadataV1Schema)

export function decodeSocialDeliveryEventActionV1(
  input: unknown,
): Effect.Effect<SocialDeliveryEventActionV1, InvalidSocialDeliveryEventContractError> {
  return decodeAction(input).pipe(
    Effect.mapError(() => new InvalidSocialDeliveryEventContractError({ contract: "action" })),
  )
}

export function decodeSocialDeliveryEventV1(
  input: unknown,
): Effect.Effect<SocialDeliveryEventV1, SocialDeliveryEventContractError> {
  const version = unsupportedVersion(input)
  return version === null
    ? decodeEvent(input).pipe(
        Effect.mapError(() => new InvalidSocialDeliveryEventContractError({ contract: "event" })),
      )
    : Effect.fail(version)
}

export function materializeSocialDeliveryEventV1(
  action: unknown,
  metadata: unknown,
): Effect.Effect<SocialDeliveryEventV1, SocialDeliveryEventContractError> {
  return Effect.gen(function* () {
    const decodedAction = yield* decodeSocialDeliveryEventActionV1(action)
    const decodedMetadata = yield* decodeMetadata(metadata).pipe(
      Effect.mapError(() => new InvalidSocialDeliveryEventContractError({ contract: "metadata" })),
    )
    const encodedAction = yield* encodeSocialDeliveryEventActionV1(decodedAction).pipe(
      Effect.mapError(() => new InvalidSocialDeliveryEventContractError({ contract: "action" })),
    )
    const encodedMetadata = yield* encodeMetadata(decodedMetadata).pipe(
      Effect.mapError(() => new InvalidSocialDeliveryEventContractError({ contract: "metadata" })),
    )
    return yield* decodeSocialDeliveryEventV1({ ...encodedMetadata, ...encodedAction })
  })
}

export const encodeSocialDeliveryEventV1 = Schema.encode(SocialDeliveryEventV1Schema)
export const encodeSocialDeliveryEventActionV1 = Schema.encode(
  SocialDeliveryEventActionV1Schema,
)

function unsupportedVersion(input: unknown): UnsupportedSocialDeliveryEventVersionError | null {
  const record = objectRecord(input)
  if (record?.schema !== "screeem.social-delivery-event" || record.schemaVersion === 1) {
    return null
  }
  return Number.isSafeInteger(record.schemaVersion) && Number(record.schemaVersion) > 0
    ? new UnsupportedSocialDeliveryEventVersionError({
        receivedVersion: Number(record.schemaVersion),
      })
    : null
}

function objectRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null
}
