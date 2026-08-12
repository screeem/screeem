import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { SupabaseFormDefinitionStore, SupabaseFormSubmissionStore } from "./supabase-store"

export function createFormDefinitionStore(teamId: string) {
  return new SupabaseFormDefinitionStore(createAdminClient(), teamId)
}

export function createFormSubmissionStore(teamId: string) {
  return new SupabaseFormSubmissionStore(createAdminClient(), teamId)
}
