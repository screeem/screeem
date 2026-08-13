import {
  bigint,
  boolean,
  foreignKey,
  index,
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
    definitionAvailability: text("definition_availability").notNull().default("draft"),
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
    origin: text("origin"),
    userAgent: text("user_agent"),
    qualificationRoute: text("qualification_route"),
    qualificationMatchedRule: text("qualification_matched_rule"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("form_submissions_team_form_created_idx").on(
      table.teamId,
      table.formId,
      table.createdAt.desc(),
    ),
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
