import { Data, Effect, Schema } from "effect"

import {
  InstagramImageAssetV1Schema,
  InstagramReelVideoAssetV1Schema,
  decodeInstagramScheduledPostInputV1,
  decodeScheduledInstagramPostV1,
  encodeInstagramScheduledPostInputV1,
  InvalidInstagramPostContractError,
  type InstagramPostContractError,
  type InstagramScheduledPostInputV1Encoded,
  type ScheduledInstagramPostV1,
} from "./template.js"

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const

const decodeInspectedAsset = Schema.decodeUnknown(
  Schema.Union(InstagramImageAssetV1Schema, InstagramReelVideoAssetV1Schema),
  strictParseOptions,
)

type InspectedAsset =
  | typeof InstagramImageAssetV1Schema.Type
  | typeof InstagramReelVideoAssetV1Schema.Type

export class InstagramAssetResolutionError extends Data.TaggedError(
  "InstagramAssetResolutionError",
)<{
  readonly assetId: string | null
  readonly reason: "duplicate" | "invalid" | "missing" | "unexpected" | "wrong_kind"
}> {
  readonly code = "instagram_asset_resolution_failed" as const

  get message(): string {
    return this.assetId === null
      ? "Instagram inspected media could not be resolved"
      : `Instagram media ${this.assetId} could not be resolved`
  }
}

export type InstagramMaterializationError =
  | InstagramPostContractError
  | InstagramAssetResolutionError

/**
 * Replaces client asset references with server-inspected media and validates
 * the complete target before persistence.
 */
export function materializeScheduledInstagramPostV1(
  input: unknown,
  metadata: unknown,
  inspectedAssets: readonly unknown[],
): Effect.Effect<ScheduledInstagramPostV1, InstagramMaterializationError> {
  return Effect.gen(function* () {
    const decodedInput = yield* decodeInstagramScheduledPostInputV1(input)
    const encodedInput = yield* encodeInstagramScheduledPostInputV1(decodedInput).pipe(
      Effect.mapError(() => new InvalidInstagramPostContractError({ contract: "input" })),
    )
    const assets = yield* decodeAssets(inspectedAssets)
    const references = templateReferences(encodedInput)
    const expectedKeys = new Set(references.map(({ reference }) => assetKey(reference)))

    for (const [key, asset] of assets) {
      if (!expectedKeys.has(key)) {
        return yield* Effect.fail(new InstagramAssetResolutionError({
          assetId: asset.assetId,
          reason: "unexpected",
        }))
      }
    }

    const template = yield* Effect.try({
      try: () => resolveTemplate(encodedInput, assets),
      catch: (error) => error instanceof InstagramAssetResolutionError
        ? error
        : new InstagramAssetResolutionError({ assetId: null, reason: "invalid" }),
    })
    const authority = objectRecord(metadata)
    if (authority === null) {
      return yield* Effect.fail(new InstagramAssetResolutionError({
        assetId: null,
        reason: "invalid",
      }))
    }

    return yield* decodeScheduledInstagramPostV1({
      ...authority,
      provider: "instagram",
      schedule: encodedInput.schedule,
      template,
    })
  })
}

function decodeAssets(
  inputs: readonly unknown[],
): Effect.Effect<ReadonlyMap<string, InspectedAsset>, InstagramAssetResolutionError> {
  return Effect.forEach(inputs, (input) =>
    decodeInspectedAsset(input).pipe(
      Effect.mapError(() => new InstagramAssetResolutionError({
        assetId: objectString(input, "assetId"),
        reason: "invalid",
      })),
    )
  ).pipe(
    Effect.flatMap((decoded) => {
      const assets = new Map<string, InspectedAsset>()
      for (const asset of decoded) {
        const key = assetKey(asset)
        if (assets.has(key)) {
          return Effect.fail(new InstagramAssetResolutionError({
            assetId: asset.assetId,
            reason: "duplicate",
          }))
        }
        assets.set(key, asset)
      }
      return Effect.succeed(assets)
    }),
  )
}

function templateReferences(input: InstagramScheduledPostInputV1Encoded) {
  const template = input.template
  if (template.kind === "instagram.image") {
    return [{ expectedKind: "image" as const, reference: template.image.asset }]
  }
  if (template.kind === "instagram.reel") {
    return [{ expectedKind: "video" as const, reference: template.video.asset }]
  }
  return template.items.map((item) => ({
    expectedKind: "image" as const,
    reference: item.asset,
  }))
}

function resolveTemplate(
  input: InstagramScheduledPostInputV1Encoded,
  assets: ReadonlyMap<string, InspectedAsset>,
) {
  const template = input.template
  if (template.kind === "instagram.image") {
    return {
      ...template,
      image: {
        ...template.image,
        asset: resolveAsset(template.image.asset, "image", assets),
      },
    }
  }
  if (template.kind === "instagram.reel") {
    return {
      ...template,
      video: {
        ...template.video,
        asset: resolveAsset(template.video.asset, "video", assets),
      },
    }
  }
  return {
    ...template,
    items: template.items.map((item) => ({
      ...item,
      asset: resolveAsset(item.asset, "image", assets),
    })),
  }
}

function resolveAsset(
  reference: { readonly assetId: string; readonly checksum: string },
  expectedKind: "image" | "video",
  assets: ReadonlyMap<string, InspectedAsset>,
): InspectedAsset {
  const asset = assets.get(assetKey(reference))
  if (!asset) {
    throw new InstagramAssetResolutionError({
      assetId: reference.assetId,
      reason: "missing",
    })
  }
  if (asset.kind !== expectedKind) {
    throw new InstagramAssetResolutionError({
      assetId: reference.assetId,
      reason: "wrong_kind",
    })
  }
  return asset
}

function assetKey(reference: { readonly assetId: string; readonly checksum: string }): string {
  return `${reference.assetId}:${reference.checksum}`
}

function objectRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null
}

function objectString(input: unknown, key: string): string | null {
  const value = objectRecord(input)?.[key]
  return typeof value === "string" ? value : null
}
