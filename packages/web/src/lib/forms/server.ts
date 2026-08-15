import "server-only"

import {
  compileFormRoutingDefinition,
  generateFormRoutingDefinition,
  InvalidFormRoutingError,
  routingAuthoringMatchesDefinition,
  type FormDefinition,
  type FormRoutingDefinition,
} from "@screeem/forms"
import { createAdminClient } from "@/lib/supabase/admin"
import { formIntegrationActions } from "@/lib/integrations/action-catalog"
import { productionFormAutomationRegistry } from "./form-registrations"
import { SupabaseFormDefinitionStore, SupabaseFormSubmissionStore } from "./supabase-store"

export function createFormDefinitionStore(teamId: string) {
  return new SupabaseFormDefinitionStore(createAdminClient(), teamId, (definition, routing) => {
    assertFormRoutingAuthoring(definition, routing)
    return compileFormRoutingDefinition(
      definition,
      routing,
      productionFormAutomationRegistry.compilationRouter(),
    )
  })
}

export function assertFormRoutingAuthoring(
  definition: FormDefinition,
  routing: FormRoutingDefinition,
) {
  if (!routing.authoring) return
  const generated = generateFormRoutingDefinition(
    definition,
    routing.authoring,
    formIntegrationActions,
  )
  if (!generated.ok) throw new InvalidFormRoutingError(generated.issues)
  if (!routingAuthoringMatchesDefinition(definition, routing, formIntegrationActions)) {
    throw new InvalidFormRoutingError([
      {
        code: "routing_authoring_mismatch",
        message: "Visual routing actions do not match the generated runtime definition",
      },
    ])
  }
}

export function createFormSubmissionStore(teamId: string) {
  return new SupabaseFormSubmissionStore(createAdminClient(), teamId)
}
