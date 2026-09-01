import "server-only"

import type { ObjectKey, ObjectScopePolicy } from "@screeem/object-storage"

export const socialPostMediaScope = "social-post-media"

/** The current private bucket caps every object at 50 MiB. */
export const socialPostMediaMaximumBytes = 50 * 1024 * 1024

export const socialPostMediaScopes: readonly ObjectScopePolicy[] = Object.freeze([
  Object.freeze({
    scope: socialPostMediaScope,
    allowedContentTypes: Object.freeze([
      "image/jpeg",
      "video/mp4",
      "video/quicktime",
    ]),
    maximumByteLength: socialPostMediaMaximumBytes,
    allowPut: false,
    allowDelete: false,
    allowSignedUploadOverwrite: false,
    signedUrl: Object.freeze({ defaultSeconds: 15 * 60, maximumSeconds: 60 * 60 }),
  }),
]) as readonly ObjectScopePolicy[]

export function socialPostMediaKey(teamId: string, assetId: string): ObjectKey {
  if (!uuid.test(assetId)) throw new TypeError("Invalid social media asset id")
  return { teamId, scope: socialPostMediaScope, path: [assetId] }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
