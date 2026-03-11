import { customType, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `VECTOR(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(",")
        .map(Number);
    },
  })(name);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  twitterHandle: text("twitter_handle"),
  linkedinHandle: text("linkedin_handle"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  key: text("key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const postEmbeddings = pgTable("post_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  postContent: text("post_content").notNull(),
  embedding: vector("embedding", 1536),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
