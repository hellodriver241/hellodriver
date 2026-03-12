# HelloDriver — Phase 0: Foundation

**Objective**: Set up monorepo, infrastructure, database schema, authentication, and CI/CD pipeline. Everything is testable via API health checks.

**Timeline**: ~5-7 days of focused work

**Deliverables**:
- ✅ GitHub repository with monorepo structure
- ✅ Backend API (Fastify) with health endpoint
- ✅ PostgreSQL + PostGIS schema (full 28 tables)
- ✅ Supabase Auth integration
- ✅ Redis TCP connection (Railway)
- ✅ CI/CD pipeline (GitHub Actions → Fly.io)
- ✅ Environment setup complete + secrets stored
- ✅ Local dev environment documented
- ✅ All infrastructure live and tested

**Success Criteria**:
- [ ] `GET /health` returns `{ status: "ok", database: "ok", redis: "ok" }` from Fly.io
- [ ] PostgreSQL schema fully applied (28 tables, 9 enums, 7 triggers visible in `pg_catalog`)
- [ ] Supabase JWT tokens can be verified in API
- [ ] Redis connection established (BullMQ and Socket.io can connect)
- [ ] GitHub Actions CI/CD automatically deploys to Fly.io on push to main

---

## Step 1: Create Monorepo Structure

### 1.1 Initialize pnpm workspace

```bash
cd hellodriver/main
pnpm init
```

Edit `package.json`:
```json
{
  "name": "hellodriver-monorepo",
  "version": "0.0.1",
  "private": true,
  "packageManager": "pnpm@9.0.0"
}
```

### 1.2 Create `pnpm-workspace.yaml`

```yaml
packages:
  - 'backend'
  - 'frontend'
  - 'packages/*'
```

### 1.3 Create folder structure

```bash
mkdir -p backend/src/{routes,services,db,validators,plugins,workers,utils}
mkdir -p backend/tests
mkdir -p frontend/mobile/{client,driver,shared}
mkdir -p frontend/admin/src
mkdir -p packages/{types,config,ui}
```

### 1.4 Create `turbo.json`

```json
{
  "$schema": "https://turbo.build/json-schema.json",
  "version": "1",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "outputs": ["coverage/**"],
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  },
  "globalEnv": ["NODE_ENV", "DATABASE_URL", "REDIS_URL"]
}
```

---

## Step 2: Backend Setup

### 2.1 Create `backend/package.json`

```json
{
  "name": "hellodriver-api",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:integration": "vitest --run src/**/*.integration.test.ts",
    "db:push": "drizzle-kit push:pg",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "fastify": "^4.25.2",
    "fastify-type-provider-zod": "^1.1.1",
    "@supabase/supabase-js": "^2.38.4",
    "zod": "^3.22.4",
    "drizzle-orm": "^0.29.4",
    "pg": "^8.11.3",
    "redis": "^4.6.12",
    "bullmq": "^5.3.2",
    "socket.io": "^4.7.2",
    "@socket.io/redis-streams-adapter": "^5.1.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.6",
    "vitest": "^1.1.0",
    "supertest": "^6.3.3",
    "@types/supertest": "^6.0.2",
    "drizzle-kit": "^0.20.14",
    "tsx": "^4.7.0"
  }
}
```

### 2.2 Create `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"],
      "@hellodriver/types": ["../packages/types/src"],
      "@hellodriver/config": ["../packages/config/src"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 2.3 Create `backend/src/index.ts` (Fastify server)

```typescript
import Fastify from 'fastify';
import { Database } from './db';
import { createHealthRoute } from './routes/health';

const fastify = Fastify({
  logger: { level: 'info' },
});

// Plugins
await fastify.register(Database);

// Routes
fastify.register(createHealthRoute);

// Start
const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

await fastify.listen({ port, host });
console.log(`🚀 Server running on http://${host}:${port}`);
```

### 2.4 Create `backend/src/routes/health.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';

export async function createHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    try {
      // Check database
      await db.execute(sql`SELECT 1`);

      // Check Redis
      const redis = fastify.redis;
      await redis.ping();

      return {
        status: 'ok',
        database: 'ok',
        redis: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      reply.code(500);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
```

### 2.5 Create `backend/src/db/index.ts` (Database plugin)

```typescript
import { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

declare global {
  namespace FastifyInstance {
    interface FastifyInstance {
      db: ReturnType<typeof drizzle>;
    }
  }
}

export async function Database(fastify: FastifyInstance) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    min: 2,
    idleTimeoutMillis: 10000,
  });

  const db = drizzle(pool);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export { db };
```

---

## Step 3: Database Schema (PostgreSQL + PostGIS)

### 3.1 Create `backend/src/db/schema.ts` (Full 28-table schema)

**This is the largest file. See SCHEMA_REFERENCE.md for complete SQL.**

Key entities to define:
- `users` (identity)
- `driver_profiles` (verification, vehicle)
- `driver_locations` (PostGIS POINT)
- `trips` (booking + state machine)
- `trip_bids` (bidding)
- `payments` (transactions)
- `wallets` (balance tracking)
- `wallet_transactions` (append-only ledger)
- `zones` (surge pricing regions, PostGIS POLYGON)
- `documents` (verification)
- `vehicles` (registry)
- And 18+ more support tables

### 3.2 Create `backend/src/db/migrations`

Use `drizzle-kit` to generate migrations:
```bash
cd backend
pnpm drizzle-kit generate:pg
```

### 3.3 Create `backend/src/db/triggers.sql`

Define 7 triggers:
1. `updated_at` trigger (auto-update timestamp)
2. Trip state machine trigger (validate 13-state transitions)
3. Wallet overdraft guard trigger
4. And 4 more for audit/housekeeping

### 3.4 Create `backend/src/db/functions.sql`

Define 5 functions:
1. `post_wallet_transaction()` — immutable wallet updates
2. `calculate_trip_fare()` — fare calculation with surge
3. `update_driver_rating()` — rating aggregation
4. And 2 more for helper operations

---

## Step 4: Authentication Setup

### 4.1 Create `backend/src/plugins/auth.ts` (Supabase JWT verification)

```typescript
import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

declare global {
  namespace FastifyInstance {
    interface FastifyRequest {
      user?: { id: string; role: 'client' | 'driver' | 'admin' };
    }
  }
}

export async function AuthPlugin(fastify: FastifyInstance) {
  fastify.decorate('authenticate', async function (request) {
    const authHeader = request.headers.authorization;
    if (!authHeader) throw new Error('No auth header');

    const token = authHeader.replace('Bearer ', '');
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);

    const { payload } = await jwtVerify(token, secret);
    request.user = {
      id: payload.sub!,
      role: (payload.role || 'client') as 'client' | 'driver' | 'admin',
    };
  });
}
```

### 4.2 Create `backend/src/plugins/redis.ts` (Redis connection)

```typescript
import { FastifyInstance } from 'fastify';
import { createClient } from 'redis';

declare global {
  namespace FastifyInstance {
    interface FastifyInstance {
      redis: ReturnType<typeof createClient>;
    }
  }
}

export async function RedisPlugin(fastify: FastifyInstance) {
  const redis = createClient({
    url: process.env.REDIS_URL,
  });

  redis.on('error', (err) => console.error('Redis error:', err));

  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
}
```

---

## Step 5: GitHub Repository Setup

### 5.1 Initialize Git

```bash
cd hellodriver/main
git init
git remote add origin https://github.com/yourusername/hellodriver-main.git
git branch -M main
```

### 5.2 Create `.gitignore`

```
node_modules/
dist/
.env
.env.local
.env.*.local
*.db
.DS_Store
coverage/
pnpm-lock.yaml
```

### 5.3 Create `README.md` (Minimal)

```markdown
# HelloDriver

Ride-hailing platform for Libreville, Gabon.

## Quick Start

```bash
pnpm install
pnpm dev
```

See CLAUDE.md for architecture.
```

### 5.4 Create GitHub Actions CI/CD (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to Fly.io

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## Step 6: Environment & Secrets

### 6.1 Create `.env.example`

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/hellodriver?sslmode=require

# Redis
REDIS_URL=redis://:password@host:22632

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_JWT_SECRET=xxx

# API
PORT=3000
NODE_ENV=development
```

### 6.2 Store in GitHub Secrets

- `FLY_API_TOKEN` (for CI/CD)
- `DATABASE_URL` (Supabase)
- `REDIS_URL` (Railway)
- `SUPABASE_JWT_SECRET` (from Supabase settings)

### 6.3 Store in Fly.io Secrets

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  SUPABASE_JWT_SECRET="..."
```

---

## Step 7: Fly.io & Docker

### 7.1 Create `backend/Dockerfile` (Multi-stage)

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY pnpm-lock.yaml .
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime stage
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY pnpm-lock.yaml .
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/backend/dist ./backend/dist

EXPOSE 3000
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "backend/dist/index.js"]
```

### 7.2 Create `fly.toml`

```toml
app = "hellodriver-api"
primary_region = "jnb"

[build]
dockerfile = "backend/Dockerfile"

[env]
NODE_ENV = "production"

[http_service]
internal_port = 3000
force_https = true
auto_stop_machines = false
auto_start_machines = true

[[http_service.checks]]
grace_period = "10s"
interval = 10000
method = "GET"
path = "/health"
protocol = "http"
timeout = 5000
type = "http"

[[services]]
protocol = "tcp"
internal_port = 3000

[[services.ports]]
port = 3000
```

---

## Step 8: Local Development Setup

### 8.1 Docker Compose for Local DB & Redis

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: hellodriver
      POSTGRES_PASSWORD: localpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 8.2 Development Workflow

```bash
# Start local infrastructure
docker-compose up -d

# Install dependencies
pnpm install

# Set local .env
cp .env.example .env
# Edit .env with local values

# Run migrations
cd backend && pnpm drizzle-kit push:pg

# Start dev server
pnpm dev
```

---

## Step 9: Testing Health Check

### 9.1 Local Testing

```bash
curl http://localhost:3000/health
# Expected: { "status": "ok", "database": "ok", "redis": "ok" }
```

### 9.2 Production Testing (Fly.io)

```bash
curl https://hellodriver-api.fly.dev/health
# Expected: same response
```

---

## Checklist

- [ ] GitHub repository created and initialized
- [ ] Monorepo structure (folders, workspaces.yaml, turbo.json)
- [ ] Backend package.json and tsconfig.json
- [ ] Fastify server with health endpoint
- [ ] Database schema (28 tables) defined in Drizzle
- [ ] PostgreSQL migrations generated
- [ ] 7 triggers and 5 functions SQL created
- [ ] Supabase project created with PostgreSQL 16 + PostGIS
- [ ] Supabase Auth configured (phone OTP enabled)
- [ ] Supabase JWT secret saved in GitHub secrets
- [ ] Railway Redis TCP instance created
- [ ] REDIS_URL stored in GitHub secrets and Fly.io
- [ ] Fly.io app created (jnb region)
- [ ] fly.toml configured with health checks
- [ ] Docker image builds successfully
- [ ] GitHub Actions workflow configured
- [ ] CI/CD deploys to Fly.io on push
- [ ] `GET /health` returns `{ status: "ok", ... }` from Fly.io
- [ ] .env.example created and documented
- [ ] docker-compose.yml for local dev
- [ ] Local dev environment tested

---

## Next Phase

Once Phase 0 passes all tests, Phase 1 begins: **Driver Core Registration & GPS Pipeline**

---

**Status**: 🟡 Phase 0 Ready to Implement
**Owner**: You
**Created**: 2026-03-12
