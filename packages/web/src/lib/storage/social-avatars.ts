import "server-only"

import {
  ObjectNotFoundError,
  ObjectTooLargeError,
  UnsupportedContentTypeError,
  type ObjectKey,
  type ObjectScopePolicy,
  type ObjectStore,
} from "@screeem/object-storage"
import { Effect, Either } from "effect"

import { runAfterResponse } from "../forms/after-response"
import { createTeamObjectStore } from "./server"

export const socialAvatarScope = "social-avatars"

/**
 * Raster formats only. An avatar is rendered inside the post preview, so a
 * scriptable format such as SVG is never cached or served from our own origin.
 */
export const socialAvatarScopes: readonly ObjectScopePolicy[] = Object.freeze([
  Object.freeze({
    scope: socialAvatarScope,
    allowedContentTypes: Object.freeze(["image/png", "image/jpeg", "image/webp"]),
    maximumByteLength: 512 * 1024,
  }),
]) as readonly ObjectScopePolicy[]

const upstreamTimeoutMs = 3_000
const freshForMs = 7 * 24 * 60 * 60 * 1_000

export interface SocialAvatarRequest {
  /** Always the team the API key belongs to, never a value from tool input. */
  readonly teamId: string
  readonly accountId: string
  readonly platform: "twitter" | "linkedin"
  readonly handle: string
}

export interface UpstreamAvatar {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface SocialAvatarOptions {
  readonly store?: ObjectStore
  readonly fetchUpstream?: (request: SocialAvatarRequest) => Promise<UpstreamAvatar | null>
  readonly schedule?: (task: () => Promise<void>) => Promise<void>
  readonly now?: () => Date
}

/**
 * Keyed by account id, which is never reused: disconnecting an account deletes
 * the row and reconnecting inserts a fresh id, so a cached avatar can never be
 * served for a different account.
 *
 * The cost of that safety is orphans. Nothing deletes the object when an account
 * or team goes away, because the disconnect path runs in the browser against the
 * user's own session and has no service role to reach storage with. Reclaiming
 * them wants either a server route for disconnecting or a swept job alongside
 * the existing `/api/internal/form-event-deliveries` cron.
 */
export function socialAvatarKey(teamId: string, accountId: string): ObjectKey {
  return { teamId, scope: socialAvatarScope, path: [accountId] }
}

/**
 * Returns the avatar for a connected account as a data URL, reading from team
 * storage first and falling back to the upstream service.
 *
 * The preview is rendered inside Claude, so the image travels inline rather than
 * as a URL the sandbox would have to fetch. What storage removes is the upstream
 * request from the hot path: a cached avatar is served without contacting
 * anyone, and a stale one is refreshed after the response rather than during it.
 *
 * Every failure degrades to the previous behaviour and finally to no avatar. A
 * post preview is never blocked by storage or by the upstream service.
 *
 * The trade for that speed is freshness: a picture changed upstream is not seen
 * until the cached copy goes stale, so an avatar can trail reality by a week.
 */
export async function socialAvatarDataUrl(
  request: SocialAvatarRequest,
  options: SocialAvatarOptions = {},
): Promise<string | undefined> {
  try {
    return await resolveAvatar(request, options)
  } catch (error) {
    // The guarantee above has to hold structurally, not by inspection. Building
    // the store throws on a misconfigured deployment, and a storage defect
    // arrives as a rejected promise rather than a typed failure, so both would
    // otherwise escape into the tool call and fail every account in it.
    console.error("Social avatar lookup failed", error)
    return undefined
  }
}

async function resolveAvatar(
  request: SocialAvatarRequest,
  options: SocialAvatarOptions,
): Promise<string | undefined> {
  const store = options.store ?? createTeamObjectStore(socialAvatarScopes)
  const fetchUpstream = options.fetchUpstream ?? fetchUpstreamAvatar
  const schedule = options.schedule ?? runAfterResponse
  const now = options.now ?? (() => new Date())
  const key = socialAvatarKey(request.teamId, request.accountId)

  const cached = await run(store.get(key))

  if (cached !== null) {
    if (isStale(cached.metadata.lastModified, now())) {
      await schedule(async () => {
        await quietly(async () => {
          const refreshed = await fetchUpstream(request)
          if (refreshed) await run(putAvatar(store, key, refreshed))
        })
      })
    }

    return dataUrl(cached.bytes, cached.metadata.contentType)
  }

  const upstream = await fetchUpstream(request)

  if (!upstream) {
    return undefined
  }

  await schedule(async () => {
    await quietly(() => run(putAvatar(store, key, upstream)))
  })

  return dataUrl(upstream.bytes, upstream.contentType)
}

function putAvatar(store: ObjectStore, key: ObjectKey, avatar: UpstreamAvatar) {
  return store.put({
    key,
    bytes: avatar.bytes,
    contentType: avatar.contentType,
    cacheMaxAgeSeconds: 3_600,
  })
}

async function fetchUpstreamAvatar(
  request: SocialAvatarRequest,
): Promise<UpstreamAvatar | null> {
  try {
    const response = await fetch(`https://unavatar.io/${request.platform}/${request.handle}`, {
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    })

    if (!response.ok) return null

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    }
  } catch {
    return null
  }
}

function isStale(lastModified: string, now: Date): boolean {
  const written = Date.parse(lastModified)

  return Number.isNaN(written) || now.getTime() - written > freshForMs
}

function dataUrl(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`
}

/**
 * Storage failures are treated as a cache miss. A first call has nothing stored,
 * and some avatars are simply not cacheable, so only unexpected faults are
 * logged; the rest are ordinary outcomes.
 */
async function run<Value>(effect: Effect.Effect<Value, Error>): Promise<Value | null> {
  try {
    const result = await Effect.runPromise(Effect.either(effect))

    if (Either.isLeft(result)) {
      if (!expected(result.left)) {
        console.error("Social avatar storage request failed", result.left)
      }

      return null
    }

    return result.right
  } catch (defect) {
    // Effect.either reroutes the typed failure channel only. A defect, which is
    // how the storage layer reports a broken adapter, rejects the promise.
    console.error("Social avatar storage defect", defect)
    return null
  }
}

/** Work scheduled after the response has nobody left to catch its failures. */
async function quietly(task: () => Promise<unknown>): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.error("Social avatar background work failed", error)
  }
}

function expected(error: Error): boolean {
  return (
    error instanceof ObjectNotFoundError ||
    // An avatar the scope will not hold, such as a vector or an oversized image,
    // is served straight through and simply never cached.
    error instanceof UnsupportedContentTypeError ||
    error instanceof ObjectTooLargeError
  )
}
