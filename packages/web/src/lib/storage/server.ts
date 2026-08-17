import "server-only"

import {
  createMemoryObjectStoreAdapter,
  createObjectStore,
  type ObjectScopePolicy,
  type ObjectStore,
  type ObjectStoreAdapter,
} from "@screeem/object-storage"

import { createAdminClient } from "../supabase/admin"
import { createSupabaseObjectStoreAdapter } from "./supabase-object-store"

const defaultBucket = "team-objects"

/** Whether Supabase credentials for a bucket are present. */
export function objectStorageConfigured(): boolean {
  return supabaseUrl().length > 0 && serviceRoleKey().length > 0
}

export function objectStorageBucket(): string {
  const bucket = process.env.SUPABASE_OBJECT_STORAGE_BUCKET

  return typeof bucket === "string" && bucket.length > 0 ? bucket : defaultBucket
}

/**
 * Builds a store for the scopes a feature declares. Scopes stay with the
 * feature that owns them, so the storage layer never accepts content types or
 * sizes that nothing has asked for.
 *
 * Callers must take `ObjectKey.teamId` from the authenticated session's team and
 * never from request input. Server-side reads and writes use the service role,
 * which bypasses the row level security policies on `storage.objects`, so the
 * key is the only thing keeping one team out of another team's objects here.
 */
export function createTeamObjectStore(scopes: readonly ObjectScopePolicy[]): ObjectStore {
  return createObjectStore(objectStorageAdapter(), { scopes })
}

function objectStorageAdapter(): ObjectStoreAdapter {
  if (!objectStorageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    }

    // Development and tests run without a bucket. The fallback keeps objects in
    // one process only, so it is announced rather than assumed.
    console.warn("Object storage has no bucket configured; using in-process storage")
    return createMemoryObjectStoreAdapter()
  }

  const bucketByteLimit = readByteLimit(process.env.SUPABASE_OBJECT_STORAGE_MAX_BYTES)

  return createSupabaseObjectStoreAdapter({
    client: createAdminClient(),
    bucket: objectStorageBucket(),
    ...(bucketByteLimit === null ? {} : { bucketByteLimit }),
  })
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
}

function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
}

function readByteLimit(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
