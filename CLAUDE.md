# HelloDriver — CLAUDE.md

You are the full owner and lead engineer of HelloDriver. This is the single source of truth for architecture, constraints, and working approach.

**Last Updated**: 2026-03-12
**Status**: Foundation Phase (Phase 0) — Starting fresh

---

## What is HelloDriver

A **peer-to-peer ride-hailing platform for Libreville, Gabon** with real-time driver bidding.

- **Clients**: Book rides, pay via card or mobile money, rate drivers
- **Drivers**: Accept ride offers, submit price bids, earn via platform commission
- **Payment**: Mobile Money (Airtel Money + Moov Money) via pawaPay
- **Currency**: XAF (Central African Franc)
- **Revenue**: 5% platform commission per trip
- **Language**: French (all UIs)

---

## Development Approach

### Work in Parallel, But Respect Dependencies
- **Backend Phase X → Frontend Feature X.Y** (never frontend before backend is ready)
- Each Phase is independently testable before moving to the next
- Minimal documentation: only CLAUDE.md + CLAUDE_{phase}.md files
- Code is the documentation; markdown is for critical constraints only

### Organization (Learn from IoT Project Failures)
**Do NOT**:
- Over-document with multiple analysis/design/overview files
- Describe features before backend API exists
- Create feature code without clear backend dependency
- Leave unclear state after each phase

**DO**:
- Clear roadmap: Phase 0 → Phase 1 → Phase 2 (testable at each step)
- Feature-first: backend API first, frontend screens after
- Modular code: each feature is isolated, no cross-feature dependencies
- Minimal markdown: one CLAUDE.md + one CLAUDE_{phase}.md per phase

---

## Monorepo Structure

```
hellodriver/main/
├── backend/                  # Node.js 22 + Fastify API
│   ├── src/
│   │   ├── routes/          # All API endpoints
│   │   ├── services/        # Business logic
│   │   ├── db/              # Drizzle ORM + schema
│   │   ├── validators/      # Zod schemas
│   │   ├── plugins/         # Fastify plugins (DB, Redis, Socket.io, Auth)
│   │   ├── workers/         # BullMQ job handlers
│   │   └── index.ts         # Main server
│   ├── tests/               # Vitest + Supertest integration tests
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── mobile/              # Flutter mobile apps
│   │   ├── client/          # Passenger app
│   │   ├── driver/          # Driver app
│   │   └── shared/          # Shared Flutter packages
│   │
│   └── admin/               # Web admin dashboard (React/Vite)
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/                # Shared code across apps
│   ├── types/               # TypeScript types + Zod validators
│   ├── config/              # Shared config (tsconfig, eslint)
│   └── ui/                  # Design system (if web UI needed)
│
├── CLAUDE.md               # This file
├── package.json            # Root monorepo
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Tech Stack (No Negotiations)

| Layer | Technology | Why |
|-------|-----------|-----|
| **Language** | TypeScript | Type safety across all apps |
| **Monorepo** | pnpm + Turborepo | Shared packages, fast builds |
| **Backend** | Fastify + Node.js 22 | Lightweight, WebSocket support, Zod integration |
| **Real-time** | Socket.io + Redis Streams | Trip matching, GPS tracking, bid notifications |
| **Database** | PostgreSQL 16 + PostGIS + Supabase | Sub-5ms geographic queries |
| **Cache/Queue** | Redis TCP + BullMQ | Atomic claims, job persistence, webhooks |
| **ORM** | Drizzle | Type-safe SQL, PostGIS support |
| **Auth** | Supabase Auth | Phone OTP, Google/Facebook OAuth |
| **Frontend** | **Flutter** | Cross-platform (iOS/Android), native performance |
| **Maps** | Mapbox | Real-time tracking, routing, geocoding |
| **Payments** | pawaPay | Only viable gateway for Gabon |
| **Hosting** | Fly.io (jnb region) + Railway | API: Fly.io, Redis: Railway, DB: Supabase |

---

## Critical Architecture Rules (Read Carefully)

### 1. Trip Matching is SYNCHRONOUS
- **NOT** BullMQ (adds 1-3s latency)
- Client books → Fastify handler (sync) → Redis GEOSEARCH → PostGIS ST_DWithin → Socket.io emit → Driver accepts → Atomic claim via Redis SET NX
- **Sub-5ms matching** required for UX
- BullMQ is for: webhook retries, notifications, scheduled payouts only

### 2. GPS Never Writes to PostgreSQL on Every Ping
- Driver sends GPS every 3s
- **Redis GEOADD only** on each ping (ephemeral)
- PostgreSQL upsert every ~10s (durable fallback)
- `trip_location_pings` append-only, partitioned by month (during active trips only)
- **Math check**: 100 drivers × 167 pings/sec = 16,700 writes/sec would collapse DB

### 3. Expo BARE Workflow is Mandatory for Driver App
- **NOT** Expo Managed Workflow (background GPS dies on Tecno/Infinix/Samsung)
- **MUST** use `react-native-background-geolocation` (Transistor Software)
- **MUST** use `react-native-foreground-service` (persistent notification keeps GPS alive)
- Test on real Tecno POVA 3 with screen off

### 4. Redis Must Be TCP, Never HTTP
- **Upstash HTTP-based Redis breaks BullMQ and Socket.io adapter**
- Use Railway Redis or Redis Cloud with native TCP endpoint
- Set `maxmemory-policy: noeviction` (payment jobs must never be silently evicted)

### 5. Wallet is Immutable
- **NEVER** write directly to `wallets.balance_xaf`
- **ALWAYS** call `post_wallet_transaction()` stored function
- `wallet_transactions` rows are never updated/deleted (append-only ledger)
- Overdraft guard trigger raises exception if balance goes negative

### 6. Payment Idempotency is Mandatory
- Store `idempotency_key` in PostgreSQL **BEFORE** calling pawaPay API
- Verify HMAC SHA256 signature on every webhook
- Poll for stuck payments every 30s (webhook fallback)

### 7. Hello Monnaie (Wallet) Cannot Have Bank Withdrawals
- Users can only spend credits on rides
- **NEVER** allow direct cash withdrawal to bank account
- Would trigger COBAC e-money licensing (~$830k minimum capital)
- pawaPay deposits only → wallet balance → ride spending only

### 8. Socket.io GPS Rooms are Personal
- GPS rooms: `trip:<trip_id>` (max 2 members: driver + client)
- Use `volatile.emit` for position updates (drop if congested, stale anyway)
- Matching rooms: `zone:<grid_hash>` (drivers auto-join their zone)
- Transports: `['websocket']` only (no polling fallback)

### 9. Always-On Compute Required
- Supabase PostgreSQL must NOT scale to zero in production
- Cold starts break trip matching (request timeouts)
- Enable always-on compute on Supabase settings

### 10. Stale Driver Detection
- Every GPS ping refreshes `driver:<id>:heartbeat` (10s TTL)
- Filter Redis GEOSEARCH against heartbeat
- Drivers missing heartbeat >15s removed from matching pool

---

## Gabon-Specific Constraints (Do Not Get Wrong)

| Topic | Fact | Impact |
|-------|------|--------|
| **Mobile Money** | Only Airtel Money + Moov Money. **MTN does NOT operate in Gabon.** | Can only support 2 operators |
| **Payment Gateway** | **pawaPay ONLY** — only confirmed aggregator with Gabon operator partnerships | No alternatives exist |
| **Devices** | Tecno, Infinix, Itel dominate. Android 90%+. | Must test background GPS on real Tecno |
| **Connectivity** | 2G/3G outside Libreville. 200ms latency common. | Design graceful offline fallbacks |
| **Regulatory** | COBAC e-money license (~$830k capital) needed for withdrawals. | No bank withdrawals at launch |
| **Currency** | XAF has no decimals in practice | Store as NUMERIC(14,2) or integers, never float |
| **Language** | French (Gabon dialect) | All UIs must be fluent French |
| **Time Zone** | WAT (UTC+1) | Store UTC, display Africa/Libreville timezone |

---

## Database Schema Overview

**28 tables, 9 enums, 7 triggers, 5 functions, 3 views, ~40 indexes**

### Core Entities
- `users` — identity (phone, email, role: client/driver/admin)
- `driver_profiles` — extended driver info (verification_status, vehicle_category, rating)
- `driver_locations` — real-time location (PostGIS POINT, is_available, is_online)
- `trips` — trip records (origin, destination, status: 13 states, fare_xaf)
- `trip_bids` — driver bids (driver_id, amount_xaf, eta_minutes)
- `payments` — payment records (status, amount_xaf, operator: airtel_money/moov_money)
- `wallets` — balance tracking (balance_xaf — immutable, via post_wallet_transaction only)
- `wallet_transactions` — append-only ledger (debit/credit, amount_xaf, reason)
- `zones` — surge pricing regions (PostGIS POLYGON)

### Indexes
- `idx_driver_locations_available_geom` (partial GIST on available=true, online=true)
- Trip state indexes on status, created_at for sorting
- Wallet transaction indexes on user_id, created_at

---

## Implementation Roadmap (8 Phases)

| Phase | Goal | Key Deliverables | Status |
|-------|------|------------------|--------|
| **0** | Foundation | Monorepo, schema, auth, API health check, CI/CD to Fly.io | ⏭️ **IN PROGRESS** |
| **1** | Driver Core | Registration, documents, GPS heartbeat, online/offline toggle | Planned |
| **2** | Trip Matching | Booking API, PostGIS matching, Redis bidding, 13-state machine | Planned |
| **3** | Payments | pawaPay integration, immutable wallet, deposits, payouts | Planned |
| **4** | Mobile Apps | Flutter client + driver apps, Mapbox tracking, earnings dashboard | Planned |
| **5** | WhatsApp Bot | Meta Cloud API, Claude AI agent, French conversational | Planned |
| **6** | Admin Panel | Document verification, live map, disputes, surge editor | Planned |
| **7** | Analytics | Driver earnings dashboard, heatmaps, referral tracking | Planned |
| **8** | Production Hardening | k6 load tests, security audit, network simulation | Planned |

**Each phase is independently testable** — no phase depends on the next for basic functionality.

---

## Code Conventions

### Validators & Types
- All API input: Zod schemas (fastify-type-provider-zod)
- All types: TypeScript, exported from `packages/types`
- Shared validators: `packages/validators`

### Database
- All PostGIS queries use `sql` tagged template (never string concatenation)
- All financial values: integers (XAF) or NUMERIC(14,2) — never float
- Dates: TIMESTAMPTZ (UTC), always
- Foreign key constraints + cascades

### Errors
- Shape: `{ error: { code: string, message: string } }`
- HTTP status codes: 400 (input), 401 (auth), 403 (permission), 500 (server)
- Custom error factories with context

### Background Jobs
- **Attempts**: 5 with exponential backoff
- **Retention**: removeOnFail: false (investigate failures)
- **Timeouts**: No job >5 minutes (Redis stream concerns)

---

## Testing Requirements

- **Integration Tests**: Every API route (Vitest + Supertest)
- **Database Tests**: PostGIS queries against local Docker PostgreSQL
- **GPS Tests**: Physical Tecno POVA 3 device with screen off
- **Load Tests**: k6 with African network simulation (200ms latency, 5% loss)
- **Payment Tests**: pawaPay sandbox before production

---

## Do NOT

- Do not use Upstash Redis (HTTP-based breaks BullMQ)
- Do not write GPS pings to PostgreSQL on every 3s interval
- Do not use Expo Managed Workflow
- Do not use BullMQ for trip matching
- Do not allow wallet withdrawals to bank accounts
- Do not use MTN as a Gabon operator (it doesn't exist)
- Do not use Stripe, Bizao, Notchpay, CinetPay for Gabon
- Do not update wallet_transactions rows after insert
- Do not write to wallets.balance_xaf directly
- Do not use Next.js App Router for web UIs (use Vite PWA)
- Do not create over-documentation (this is the only CLAUDE.md + per-phase CLAUDE_{phase}.md)

---

## Infrastructure Setup (New Fresh Accounts)

### GitHub
- New repository: `hellodriver-main` (fresh, not legacy)
- Branch protection: main requires PR reviews + CI/CD passing

### Supabase
- New project for HelloDriver (Libreville region if available, else EU with fastest replica to jnb)
- PostgreSQL 16 + PostGIS enabled
- Always-on compute enabled
- **JWT Secret**: Saved in GitHub secrets (will be generated during Phase 0)

### Railway
- Redis TCP instance (not Upstash)
- Store `REDIS_URL` in Fly.io secrets

### Fly.io
- New app: `hellodriver-api` (jnb region)
- Health check on `/health` endpoint
- Secrets: DATABASE_URL, REDIS_URL, JWT_SECRET

### Mapbox
- New project token for maps + geocoding

### pawaPay
- Sandbox account for testing (test phone numbers provided in docs)
- Production credentials saved in Fly.io secrets

---

## Contact & Governance

- **Owner**: You (full authority)
- **Documentation**: CLAUDE.md + CLAUDE_{phase}.md only
- **Code is law**: Implementation details in code, not markdown
- **Phases are sacred**: No skipping phases, each independently testable

---

**Ready to build. Phase 0 starts now.**
