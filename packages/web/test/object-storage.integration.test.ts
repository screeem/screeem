import { createObjectStore } from "@screeem/object-storage"
import { objectStoreContractCases, objectStoreContractScopes } from "@screeem/object-storage/testing"
import { createClient } from "@supabase/supabase-js"
import { describe, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { createSupabaseObjectStoreAdapter } from "../src/lib/storage/supabase-object-store"

/**
 * Runs the shared adapter contract against local Supabase Storage. It is opt in
 * because it needs the Dockerized stack from `make infra-up`.
 *
 * OBJECT_STORAGE_DB_TESTS=1 pnpm --filter @screeem/web test:object-storage-db
 */
const suite = process.env.OBJECT_STORAGE_DB_TESTS === "1" ? describe : describe.skip

suite("Supabase Storage object store", () => {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:1",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "missing-service-role-key",
  )
  const store = createObjectStore(
    createSupabaseObjectStoreAdapter({
      client,
      bucket: process.env.SUPABASE_OBJECT_STORAGE_BUCKET ?? "team-objects",
    }),
    { scopes: objectStoreContractScopes },
  )

  for (const testCase of objectStoreContractCases(() => ({
    store,
    teams: {
      primary: "0a1b2c3d-0000-4000-8000-000000000001",
      secondary: "0a1b2c3d-0000-4000-8000-000000000002",
    },
  }))) {
    it(testCase.name, testCase.run, 30_000)
  }
})
