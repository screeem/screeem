import Database from "better-sqlite3";
import path from "path";

export interface TrackedPost {
  id: number;
  platform: string;
  url: string;
  author_name: string;
  post_text: string;
  slack_user_id: string;
  slack_user_name: string;
  slack_channel_id: string;
  slack_message_ts: string;
  created_at: string;
}

export interface PostStats {
  total_posts: number;
  by_platform: Record<string, number>;
  by_user: Record<string, number>;
}

let db: Database.Database;

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath || path.join(process.cwd(), "amplification.db");
    db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      post_text TEXT NOT NULL DEFAULT '',
      slack_user_id TEXT NOT NULL,
      slack_user_name TEXT NOT NULL DEFAULT '',
      slack_channel_id TEXT NOT NULL,
      slack_message_ts TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tracked_posts_platform ON tracked_posts(platform);
    CREATE INDEX IF NOT EXISTS idx_tracked_posts_slack_user_id ON tracked_posts(slack_user_id);
    CREATE INDEX IF NOT EXISTS idx_tracked_posts_created_at ON tracked_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tracked_posts_url ON tracked_posts(url);
  `);
}

export function insertPost(post: Omit<TrackedPost, "id" | "created_at">): TrackedPost {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tracked_posts (platform, url, author_name, post_text, slack_user_id, slack_user_name, slack_channel_id, slack_message_ts)
    VALUES (@platform, @url, @author_name, @post_text, @slack_user_id, @slack_user_name, @slack_channel_id, @slack_message_ts)
  `);
  const result = stmt.run(post);
  return db.prepare("SELECT * FROM tracked_posts WHERE id = ?").get(result.lastInsertRowid) as TrackedPost;
}

export function getPostByMessageTs(messageTs: string): TrackedPost | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM tracked_posts WHERE slack_message_ts = ?").get(messageTs) as TrackedPost | undefined;
}

export function getAllPosts(limit = 50, offset = 0): TrackedPost[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tracked_posts ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as TrackedPost[];
}

export function getPostsByPlatform(platform: string, limit = 50, offset = 0): TrackedPost[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tracked_posts WHERE platform = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(platform, limit, offset) as TrackedPost[];
}

export function getPostsByUser(slackUserId: string, limit = 50, offset = 0): TrackedPost[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tracked_posts WHERE slack_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(slackUserId, limit, offset) as TrackedPost[];
}

export function getStats(): PostStats {
  const db = getDb();

  const total = db.prepare("SELECT COUNT(*) as count FROM tracked_posts").get() as { count: number };

  const platformRows = db.prepare("SELECT platform, COUNT(*) as count FROM tracked_posts GROUP BY platform ORDER BY count DESC").all() as { platform: string; count: number }[];
  const by_platform: Record<string, number> = {};
  for (const row of platformRows) {
    by_platform[row.platform] = row.count;
  }

  const userRows = db.prepare("SELECT slack_user_name, COUNT(*) as count FROM tracked_posts GROUP BY slack_user_id ORDER BY count DESC").all() as { slack_user_name: string; count: number }[];
  const by_user: Record<string, number> = {};
  for (const row of userRows) {
    by_user[row.slack_user_name || "unknown"] = row.count;
  }

  return {
    total_posts: total.count,
    by_platform,
    by_user,
  };
}

export function searchPosts(query: string, limit = 50): TrackedPost[] {
  const db = getDb();
  const pattern = `%${query}%`;
  return db.prepare(
    "SELECT * FROM tracked_posts WHERE url LIKE ? OR post_text LIKE ? OR author_name LIKE ? ORDER BY created_at DESC LIMIT ?"
  ).all(pattern, pattern, pattern, limit) as TrackedPost[];
}
