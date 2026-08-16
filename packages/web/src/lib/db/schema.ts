import type { FormAvailability, SubmissionRoutingStatus } from "@screeem/forms"
import { sql } from "drizzle-orm"
import {
  formEventDeliveryKinds,
  formEventDeliveryStatuses,
} from "../forms/form-delivery-contract"
import {
  integrationConnectionStatuses,
  type IntegrationErrorCode,
  integrationHealthStatuses,
} from "../integrations/contract"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
})

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    teamId: uuid("team_id").notNull(),
    platform: text("platform").notNull(),
    handle: text("handle").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("social_accounts_team_created_idx").on(table.teamId, table.createdAt)],
)

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    teamId: uuid("team_id").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    clientEventId: uuid("client_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    revertsEventId: bigint("reverts_event_id", { mode: "number" }),
    actorId: uuid("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("calendar_events_team_client_key").on(table.teamId, table.clientEventId),
    index("calendar_events_team_id_id_idx").on(table.teamId, table.id),
    index("calendar_events_aggregate_id_id_idx").on(table.teamId, table.aggregateId, table.id),
  ],
)

export const calendarPostWorkflows = pgTable(
  "calendar_post_workflows",
  {
    teamId: uuid("team_id").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    status: text("status", {
      enum: ["draft", "in_review", "changes_requested", "approved"],
    }).notNull().default("draft"),
    reviewRevision: bigint("review_revision", { mode: "number" }),
    requestedBy: uuid("requested_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.aggregateId] }),
    index("calendar_post_workflows_team_status_idx").on(table.teamId, table.status),
  ],
)

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    teamId: uuid("team_id").notNull(),
    key: text("key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("api_keys_team_user_idx").on(table.teamId, table.userId)],
)

export const publicApiKeys = pgTable(
  "public_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("public_api_keys_team_created_idx").on(table.teamId, table.createdAt.desc()),
  ],
)

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
})

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_members_user_team_idx").on(table.userId, table.teamId),
    index("team_members_team_joined_idx").on(table.teamId, table.joinedAt),
  ],
)

export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("team_invitations_team_expires_idx").on(table.teamId, table.expiresAt)],
)

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    status: text("status", { enum: integrationConnectionStatuses }).notNull(),
    health: text("health", { enum: integrationHealthStatuses }).notNull().default("unknown"),
    enabled: boolean("enabled").notNull().default(true),
    displayName: text("display_name"),
    externalAccountId: text("external_account_id"),
    lastErrorCode: text("last_error_code").$type<IntegrationErrorCode>(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disabledBy: uuid("disabled_by"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disconnectedBy: uuid("disconnected_by"),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [
    unique("integration_connections_team_id_id_key").on(table.teamId, table.id),
    unique("integration_connections_team_provider_key").on(table.teamId, table.provider),
    index("integration_connections_team_created_idx").on(
      table.teamId,
      table.createdAt.desc(),
    ),
    check("integration_connections_provider_check", sql`${table.provider} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check("integration_connections_revision_check", sql`${table.revision} > 0`),
    check("integration_connections_status_check", sql`${table.status} IN ('connected', 'reauthorization_required', 'disconnected')`),
    check("integration_connections_health_check", sql`${table.health} IN ('unknown', 'healthy', 'degraded')`),
    check("integration_connections_display_name_check", sql`${table.displayName} IS NULL OR char_length(${table.displayName}) BETWEEN 1 AND 160`),
    check("integration_connections_external_account_id_check", sql`${table.externalAccountId} IS NULL OR char_length(${table.externalAccountId}) BETWEEN 1 AND 256`),
    check("integration_connections_last_error_code_check", sql`${table.lastErrorCode} IS NULL OR ${table.lastErrorCode} IN ('authentication_failed', 'authorization_failed', 'invalid_configuration', 'invalid_request', 'provider_unavailable', 'rate_limited', 'unknown')`),
    check(
      "integration_connections_disabled_state_check",
      sql`(${table.enabled} AND ${table.disabledAt} IS NULL) OR (NOT ${table.enabled} AND ${table.disabledAt} IS NOT NULL)`,
    ),
    check(
      "integration_connections_disconnected_state_check",
      sql`(${table.status} = 'disconnected' AND ${table.disconnectedAt} IS NOT NULL) OR (${table.status} <> 'disconnected' AND ${table.disconnectedAt} IS NULL)`,
    ),
  ],
)

export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    teamId: uuid("team_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    keyId: text("key_id").notNull(),
    sealedPayload: text("sealed_payload").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.connectionId] }),
    foreignKey({
      columns: [table.teamId, table.connectionId],
      foreignColumns: [integrationConnections.teamId, integrationConnections.id],
    }).onDelete("cascade"),
    check("integration_credentials_key_id_check", sql`${table.keyId} ~ '^[A-Za-z0-9._-]{1,128}$'`),
    check("integration_credentials_sealed_payload_check", sql`octet_length(${table.sealedPayload}) BETWEEN 1 AND 131072 AND ${table.sealedPayload} ~ '^v[0-9]+[.][A-Za-z0-9_-]+([.][A-Za-z0-9_-]+)*$'`),
    check("integration_credentials_revision_check", sql`${table.revision} > 0`),
  ],
)

export const integrationTeamControls = pgTable(
  "integration_team_controls",
  {
    teamId: uuid("team_id")
      .primaryKey()
      .references(() => teams.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    disabledBy: uuid("disabled_by"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("integration_team_controls_revision_check", sql`${table.revision} > 0`),
    check(
      "integration_team_controls_disabled_state_check",
      sql`(${table.enabled} AND ${table.disabledAt} IS NULL) OR (NOT ${table.enabled} AND ${table.disabledAt} IS NOT NULL)`,
    ),
  ],
)

export const integrationOauthAttempts = pgTable(
  "integration_oauth_attempts",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.provider] }),
    unique("integration_oauth_attempts_identity_key").on(
      table.teamId,
      table.provider,
      table.attemptId,
    ),
    index("integration_oauth_attempts_expires_idx").on(table.expiresAt),
    check("integration_oauth_attempts_provider_check", sql`${table.provider} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check("integration_oauth_attempts_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").notNull(),
    userId: uuid("user_id").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    returnPath: text("return_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("integration_oauth_states_team_provider_key").on(table.teamId, table.provider),
    foreignKey({
      columns: [table.teamId, table.provider, table.attemptId],
      foreignColumns: [
        integrationOauthAttempts.teamId,
        integrationOauthAttempts.provider,
        integrationOauthAttempts.attemptId,
      ],
    }).onDelete("cascade"),
    index("integration_oauth_states_expires_idx").on(table.expiresAt),
    check("integration_oauth_states_state_hash_check", sql`${table.stateHash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("integration_oauth_states_provider_check", sql`${table.provider} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check("integration_oauth_states_verifier_check", sql`char_length(${table.codeVerifier}) BETWEEN 43 AND 128 AND ${table.codeVerifier} ~ '^[A-Za-z0-9._~-]+$'`),
    check("integration_oauth_states_return_path_check", sql`char_length(${table.returnPath}) BETWEEN 1 AND 512 AND ${table.returnPath} LIKE '/%' AND ${table.returnPath} NOT LIKE '//%'`),
    check("integration_oauth_states_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const integrationRefreshLeases = pgTable(
  "integration_refresh_leases",
  {
    teamId: uuid("team_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    ownerToken: text("owner_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.connectionId] }),
    foreignKey({
      columns: [table.teamId, table.connectionId],
      foreignColumns: [integrationConnections.teamId, integrationConnections.id],
    }).onDelete("cascade"),
    index("integration_refresh_leases_expires_idx").on(table.expiresAt),
    check("integration_refresh_leases_owner_check", sql`${table.ownerToken} ~ '^[A-Za-z0-9_-]{32,128}$'`),
    check("integration_refresh_leases_expiry_check", sql`${table.expiresAt} > ${table.updatedAt}`),
  ],
)

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull(),
    name: text("name").notNull(),
    endpointKey: uuid("endpoint_key").notNull().defaultRandom().unique(),
    allowedOrigin: text("allowed_origin"),
    successUrl: text("success_url"),
    isActive: boolean("is_active").notNull().default(true),
    requiresTurnstile: boolean("requires_turnstile").notNull().default(false),
    submissionSchema: jsonb("submission_schema"),
    legacyUnstructured: boolean("legacy_unstructured").notNull().default(true),
    definitionAvailability: text("definition_availability")
      .$type<FormAvailability>()
      .notNull()
      .default("draft"),
    draftDefinition: jsonb("draft_definition"),
    routingDraft: jsonb("routing_draft"),
    draftRevision: bigint("draft_revision", { mode: "number" }).notNull().default(0),
    publishedVersion: bigint("published_version", { mode: "number" }),
    lastPublishedDraftRevision: bigint("last_published_draft_revision", { mode: "number" }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("forms_team_id_id_key").on(table.teamId, table.id),
    index("forms_team_created_idx").on(table.teamId, table.createdAt.desc()),
  ],
)

export const formDefinitionVersions = pgTable(
  "form_definition_versions",
  {
    teamId: uuid("team_id").notNull(),
    formId: uuid("form_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    draftRevision: bigint("draft_revision", { mode: "number" }).notNull(),
    definition: jsonb("definition").notNull(),
    routingDefinition: jsonb("routing_definition"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.formId, table.version] }),
    unique("form_definition_versions_form_draft_revision_key").on(
      table.teamId,
      table.formId,
      table.draftRevision,
    ),
    foreignKey({
      columns: [table.teamId, table.formId],
      foreignColumns: [forms.teamId, forms.id],
    }).onDelete("cascade"),
  ],
)

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull(),
    formId: uuid("form_id").notNull(),
    publicationVersion: bigint("publication_version", { mode: "number" }),
    payload: jsonb("payload").notNull(),
    routingStatus: text("routing_status")
      .$type<SubmissionRoutingStatus>()
      .notNull()
      .default("not_configured"),
    routingRoute: text("routing_route"),
    matchedRuleId: text("matched_rule_id"),
    routingError: text("routing_error"),
    origin: text("origin"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("form_submissions_team_form_created_idx").on(
      table.teamId,
      table.formId,
      table.createdAt.desc(),
    ),
    index("form_submissions_team_form_route_created_idx")
      .on(table.teamId, table.formId, table.routingRoute, table.createdAt.desc())
      .where(sql`${table.routingRoute} IS NOT NULL`),
    unique("form_submissions_team_form_id_key").on(table.teamId, table.formId, table.id),
    foreignKey({
      columns: [table.teamId, table.formId],
      foreignColumns: [forms.teamId, forms.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.teamId, table.formId, table.publicationVersion],
      foreignColumns: [
        formDefinitionVersions.teamId,
        formDefinitionVersions.formId,
        formDefinitionVersions.version,
      ],
    }),
  ],
)

export const formEventDeliveries = pgTable(
  "form_event_deliveries",
  {
    teamId: uuid("team_id").notNull(),
    formId: uuid("form_id").notNull(),
    publicationVersion: bigint("publication_version", { mode: "number" }),
    submissionId: uuid("submission_id").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    eventOccurredAt: timestamp("event_occurred_at", { withTimezone: true }).notNull(),
    eventPayload: jsonb("event_payload").notNull(),
    deliveryKind: text("delivery_kind", { enum: formEventDeliveryKinds })
      .notNull(),
    registrationName: text("registration_name").notNull(),
    deliveryKey: text("delivery_key").notNull(),
    sequence: integer("sequence").notNull(),
    streamSequence: integer("stream_sequence").notNull(),
    status: text("status", { enum: formEventDeliveryStatuses })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    output: jsonb("output"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.eventId, table.deliveryKey] }),
    unique("form_event_delivery_sequence_key").on(
      table.teamId,
      table.eventId,
      table.sequence,
    ),
    unique("form_event_delivery_stream_sequence_key").on(
      table.teamId,
      table.submissionId,
      table.streamSequence,
    ),
    index("form_event_delivery_pending_idx")
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} = 'pending' AND ${table.attemptCount} < 3`),
    index("form_event_delivery_running_lease_idx")
      .on(table.leaseExpiresAt, table.createdAt)
      .where(sql`${table.status} = 'running'`),
    index("form_event_delivery_team_form_created_idx").on(
      table.teamId,
      table.formId,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.teamId, table.formId, table.submissionId],
      foreignColumns: [formSubmissions.teamId, formSubmissions.formId, formSubmissions.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.teamId, table.formId, table.publicationVersion],
      foreignColumns: [
        formDefinitionVersions.teamId,
        formDefinitionVersions.formId,
        formDefinitionVersions.version,
      ],
    }),
  ],
)
