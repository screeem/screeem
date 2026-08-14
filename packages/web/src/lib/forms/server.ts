import "server-only"

import { compileFormRoutingDefinition } from "@screeem/forms"
import { createAdminClient } from "@/lib/supabase/admin"
import { productionFormAutomationRegistry } from "./form-registrations"
import { SupabaseFormDefinitionStore, SupabaseFormSubmissionStore } from "./supabase-store"

export function createFormDefinitionStore(teamId: string) {
  return new SupabaseFormDefinitionStore(createAdminClient(), teamId, (definition, routing) =>
    compileFormRoutingDefinition(
      definition,
      routing,
      productionFormAutomationRegistry.compilationRouter(),
    ),
  )
}

export function createFormSubmissionStore(teamId: string) {
  return new SupabaseFormSubmissionStore(createAdminClient(), teamId)
}
