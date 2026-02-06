# Quick Start Guide

Get Screeem running in 5 minutes.

## 1. Start PostgreSQL

```bash
docker-compose up -d
```

Verify it's running:
```bash
docker ps | grep screeem-postgres
```

## 2. Run Migrations

```bash
cd packages/api
pnpm migrate
```

You should see:
```
🔄 Running migrations...
📝 Applying 001_initial_schema.sql...
✅ 001_initial_schema.sql applied successfully
✨ Applied 1 migration(s)
```

## 3. Start the API Server

```bash
pnpm dev
```

You should see:
```
✅ Database connected
🚀 Server listening on port 3000
📝 Environment: development
```

## 4. Test the API

Open http://localhost:3000 in your browser or:

```bash
curl http://localhost:3000
```

Response:
```json
{
  "name": "Screeem API",
  "version": "0.1.0",
  "environment": "development"
}
```

Health check:
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "database": "connected"
}
```

## What's Working

✅ **Foundation**
- PostgreSQL database with all tables
- Event store with LISTEN/NOTIFY
- Type-safe event sourcing library
- Fastify API server
- Environment validation
- SQL migrations

## What's Next

The foundation is complete! Next phases:

1. **Authentication** - Magic link endpoints
2. **Organizations** - CRUD API endpoints
3. **Post Scheduling** - Event-sourced commands and SSE
4. **Frontend** - Vite + React + TanStack
5. **Twitter** - OAuth and publishing

See `IMPLEMENTATION_STATUS.md` for the full roadmap.

## Troubleshooting

**Database connection error?**
```bash
# Check if PostgreSQL is running
docker ps

# View PostgreSQL logs
docker logs screeem-postgres

# Restart PostgreSQL
docker-compose restart
```

**Port 3000 already in use?**

Edit `packages/api/.env`:
```
PORT=3001
```

**Migration errors?**

Reset the database:
```bash
docker-compose down -v  # WARNING: Deletes all data
docker-compose up -d
cd packages/api && pnpm migrate
```

## Useful Commands

```bash
# View database tables
docker exec -it screeem-postgres psql -U screeem -d screeem -c "\dt"

# View events table
docker exec -it screeem-postgres psql -U screeem -d screeem -c "SELECT * FROM events;"

# Stop everything
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v
```
