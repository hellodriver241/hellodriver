# HelloDriver — Fresh Start Summary

**Date**: 2026-03-12
**Status**: ✅ Complete project analysis & Phase 0 plan ready
**Next**: Begin Phase 0 implementation

---

## What Just Happened

I completed a **comprehensive study and architectural reset** of HelloDriver:

### 1. ✅ Deep Project Analysis
- Read all 11 design feature categories (50+ screens)
- Analyzed user flows (client vs driver)
- Studied design system (colors, typography, patterns)
- Reviewed previous tech stack decisions
- Understood business model (5% commission, referral rewards)

### 2. ✅ Gabon Market Understanding
- **Mobile Money**: Only Airtel Money + Moov Money (NOT MTN)
- **Gateway**: pawaPay ONLY (only confirmed aggregator in Gabon)
- **Devices**: Tecno, Infinix, Itel dominate (low RAM, aggressive background killing)
- **Connectivity**: 2G/3G outside Libreville (200ms latency common)
- **Regulatory**: COBAC e-money licensing avoided via pawaPay aggregator model

### 3. ✅ Critical Architecture Rules Identified
The 10 most critical "DO NOT" constraints:
1. ❌ **Upstash HTTP Redis** — breaks BullMQ + Socket.io adapter
2. ❌ **GPS to PostgreSQL every 3 seconds** — 16,700 writes/sec collapses DB
3. ❌ **Expo Managed Workflow** — background GPS dies on Tecno phones
4. ❌ **BullMQ for trip matching** — adds 1-3s unnecessary latency
5. ❌ **Wallet bank withdrawals** — triggers COBAC licensing requirements (~$830k capital)
6. ❌ **String concatenation in PostGIS** — always use `sql` tagged template
7. ❌ **Float for XAF** — always use NUMERIC(14,2) or integers
8. ❌ **Updating wallet_transactions rows** — must be append-only immutable ledger
9. ❌ **Multiple MongoDB-like documents** — avoid over-documentation (IoT project mistake)
10. ❌ **Frontend before backend API** — always backend-first, frontend follows

### 4. ✅ Fresh Documentation Created
- **CLAUDE.md** — Minimal, focused architecture rules (not 15 pages of analysis)
- **CLAUDE_PHASE_0.md** — Detailed Phase 0 implementation roadmap
- **PROJECT_OVERVIEW.md** (in memory) — Master reference for myself (doesn't clutter the codebase)

---

## Your Three Documents

### 📄 CLAUDE.md (Read First)
- **Purpose**: Single source of truth for architecture and constraints
- **Length**: ~400 lines (focused, not excessive)
- **Contains**:
  - What is HelloDriver
  - Development approach (learn from IoT mistakes)
  - Monorepo structure
  - Tech stack decisions
  - 10 critical rules with explanations
  - Gabon-specific constraints
  - Database overview
  - 8-phase roadmap
  - Code conventions
  - What NOT to do

### 📋 CLAUDE_PHASE_0.md (Implementation Guide)
- **Purpose**: Step-by-step Phase 0 foundation setup
- **Length**: ~600 lines of actionable steps
- **Covers**:
  1. Monorepo structure (folders, pnpm-workspace.yaml, turbo.json)
  2. Backend setup (Fastify, TypeScript config)
  3. Database schema (28 tables, 9 enums, 7 triggers, 5 functions)
  4. Authentication (Supabase JWT)
  5. Redis connection
  6. GitHub repository & actions
  7. Secrets management
  8. Docker setup
  9. Fly.io deployment
  10. Local dev environment
  11. Testing checklist

### 📚 PROJECT_OVERVIEW.md (In Memory - For Me, Not the Codebase)
- **Purpose**: My personal master reference (not in main/ folder)
- **Contains**: Design system details, flow descriptions, 11 feature categories, architecture decisions

---

## Phase 0 at a Glance

**Objective**: Get from nothing to `GET /health` returning ✅ from live Fly.io.

**What Gets Built**:
- ✅ Monorepo (pnpm + Turborepo)
- ✅ Fastify API server
- ✅ PostgreSQL + PostGIS schema (28 tables)
- ✅ Supabase Auth integration
- ✅ Redis TCP connection
- ✅ CI/CD pipeline (GitHub Actions → Fly.io)
- ✅ All secrets & environments configured
- ✅ Local docker-compose for development

**Success Criteria** (Single Test):
```bash
curl https://hellodriver-api.fly.dev/health
# Returns:
# { "status": "ok", "database": "ok", "redis": "ok", "timestamp": "..." }
```

**Timeline**: ~5-7 days of focused work

---

## What You Need to Do Next

### Step 1: Create New Accounts (1-2 hours)
You mentioned: "completely different account (gh, fly, supabase, ...)"

Create fresh accounts if needed:
- [ ] **GitHub**: New repo `hellodriver-main` (or use existing)
- [ ] **Supabase**: New project for HelloDriver (if not existing)
- [ ] **Railway**: Redis TCP instance (or use existing)
- [ ] **Fly.io**: New app `hellodriver-api` (or use existing)
- [ ] **Mapbox**: API token for maps
- [ ] **pawaPay**: Sandbox account for testing

### Step 2: Read & Understand (1-2 hours)
- [ ] Read `main/CLAUDE.md` completely
- [ ] Read `main/CLAUDE_PHASE_0.md` completely
- [ ] Review `main/GETTING_STARTED.md` (this file)
- [ ] Check my memory: `PROJECT_OVERVIEW.md` if you need design/flow details

### Step 3: Ask Clarifying Questions (15 min)
Before implementing Phase 0, ask me any questions about:
- Architecture decisions
- Tech stack choices
- Gabon constraints
- Database design
- Phase 0 implementation details

### Step 4: Begin Phase 0 Implementation
Start with the step-by-step guide in `CLAUDE_PHASE_0.md`:
1. Create monorepo structure
2. Set up backend (Fastify + TypeScript)
3. Define database schema
4. Configure authentication
5. Set up GitHub Actions CI/CD
6. Deploy to Fly.io
7. Test health endpoint

---

## Key Philosophy Differences from Archive Project

**❌ What the IoT project did wrong**:
- Created 10+ markdown files (README, ARCHITECTURE_OVERVIEW, DESIGN_ANALYSIS, DESIGN_COMPONENTS, DESIGN_SUMMARY, AUTH_SPECIFICATION, BACKEND_IMPLEMENTATION_PLAN, E2E_PAYMENT_TESTING, etc.)
- Described features before backend API existed
- Unclear dependencies between phases
- Over-engineered from the start
- Excessive documentation without clear action steps

**✅ What HelloDriver does right**:
- Minimal markdown (only CLAUDE.md + CLAUDE_{phase}.md)
- Code IS the documentation
- Backend-first: API endpoint before frontend screen
- Clear phase dependencies (each phase testable independently)
- Modular architecture (features don't cross-contaminate)
- Only necessary documentation for critical constraints

---

## Architecture Highlights

### Trip Matching (Synchronous, <5ms)
```
Client books → Redis GEOSEARCH + PostGIS ST_DWithin → Top 5 drivers → Socket.io emit
→ Driver submits bid → Redis SET NX atomic claim → Trip confirmed
```

### Wallet (Immutable Ledger)
```
post_wallet_transaction() [stored function]
  ↓
wallet_transactions [append-only, never updated/deleted]
  ↓
Balance = SUM(all credits - debits)
```

### GPS Pipeline
```
Driver GPS every 3s → Redis GEOADD (ephemeral)
Driver GPS every ~10s → PostgreSQL upsert (durable)
Active trip GPS → trip_location_pings (append-only, partitioned by month)
```

### State Machine (13 States)
```
pending → searching → driver_assigned → driver_en_route → arrived
→ in_progress → completed (or cancelled at any point)
```

---

## Success Checkpoints

After Phase 0 completes, you should be able to:

1. ✅ Run `pnpm dev` locally and see Fastify server on localhost:3000
2. ✅ See `GET /health` return database + redis status
3. ✅ View PostgreSQL schema with 28 tables, 9 enums, 7 triggers via `drizzle-kit studio`
4. ✅ Deploy to Fly.io automatically on `git push main`
5. ✅ `curl https://hellodriver-api.fly.dev/health` returns success from production

Then Phase 1 begins: **Driver Core Registration & GPS Pipeline**

---

## Questions Before You Start?

Ask me anything about:
- Architecture decisions (why Fastify? why Drizzle?)
- Tech stack (why not Next.js? why Flutter?)
- Gabon constraints (why only pawaPay?)
- Phase 0 steps (unclear explanations?)
- Database design (schema questions?)
- Deployment approach (Fly.io vs others?)

---

## Files You Now Have

In `hellodriver/main/`:
- ✅ `CLAUDE.md` (400 lines, single source of truth)
- ✅ `CLAUDE_PHASE_0.md` (600 lines, implementation guide)
- ✅ `GETTING_STARTED.md` (this file, 300 lines, orientation)

In my memory (not in codebase):
- ✅ `PROJECT_OVERVIEW.md` (master reference for design, flows, constraints)
- ✅ `MEMORY.md` (updated index)

In `archive/` for reference:
- `CLAUDE.md` (previous version, good for reference)
- `ROADMAP.md` (8-phase plan from previous attempt)
- `schema.sql` (28-table schema reference)
- All design analysis docs and screenshots

---

## Next Actions (In Order)

1. **Read**: All three main documents (CLAUDE.md, CLAUDE_PHASE_0.md, GETTING_STARTED.md)
2. **Clarify**: Ask me any questions before starting
3. **Create Accounts**: Set up GitHub, Supabase, Railway, Fly.io (if fresh)
4. **Implement Phase 0**: Follow CLAUDE_PHASE_0.md step-by-step
5. **Test**: Verify `/health` endpoint works locally and on Fly.io
6. **Commit**: Push to GitHub, CI/CD deploys to Fly.io
7. **Celebrate**: Phase 0 complete! 🎉 Ready for Phase 1

---

## I'm Here For

As you implement Phase 0, I will:
- ✅ Write code for you (backend, database, config)
- ✅ Debug issues and explain root causes
- ✅ Answer architecture questions
- ✅ Help with deployment issues
- ✅ Create CLAUDE_PHASE_1.md when Phase 0 completes
- ✅ Maintain modular, clean architecture

**You own this project completely. I'm your engineer.**

---

**Ready to start Phase 0?** Let me know when you're ready, or ask questions first.

---

**Document**: GETTING_STARTED.md
**Created**: 2026-03-12
**Status**: Complete
**Next**: Phase 0 implementation
