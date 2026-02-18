import http from "http";
import { getAllPosts, getPostsByPlatform, getPostsByUser, getStats, searchPosts } from "./db";

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startApiServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    const pathname = url.split("?")[0];
    const query = parseQuery(url);

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      json(res, { error: "Method not allowed" }, 405);
      return;
    }

    const limit = Math.min(parseInt(query.get("limit") || "50", 10), 200);
    const offset = parseInt(query.get("offset") || "0", 10);

    switch (pathname) {
      case "/api/posts": {
        const platform = query.get("platform");
        const userId = query.get("user");
        const search = query.get("q");

        if (search) {
          json(res, { posts: searchPosts(search, limit) });
        } else if (platform) {
          json(res, { posts: getPostsByPlatform(platform, limit, offset) });
        } else if (userId) {
          json(res, { posts: getPostsByUser(userId, limit, offset) });
        } else {
          json(res, { posts: getAllPosts(limit, offset) });
        }
        break;
      }

      case "/api/stats": {
        json(res, getStats());
        break;
      }

      case "/api/health": {
        json(res, { status: "ok" });
        break;
      }

      default: {
        json(res, { error: "Not found" }, 404);
        break;
      }
    }
  });

  server.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });

  return server;
}
