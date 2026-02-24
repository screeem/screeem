import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  twitterHandle: text("twitter_handle"),
  linkedinHandle: text("linkedin_handle"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
