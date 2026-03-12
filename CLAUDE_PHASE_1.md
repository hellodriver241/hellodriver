# Phase 1: Auth + Profile Setup — Implementation Guide

**Duration**: 3 weeks (Backend: 1 week, Mobile: 2 weeks parallel)
**Goal**: Both client and driver can sign up, verify phone, and set up profile
**Test Gate**: Sign up → Phone OTP → Profile complete → Dashboard accessible

---

## Architecture

### Authentication Flow
```
User selects role (Splash)
  ↓
Phone login (Supabase Auth) OR OAuth (Google/Facebook)
  ↓
Phone OTP verification (if phone auth)
  ↓
Create user + profile in PostgreSQL
  ↓
Client → Home dashboard
Driver → Document upload (must upload to go online)
```

### JWT Token Structure
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "phone": "+241701234567",
  "app_metadata": {
    "role": "client" | "driver"
  }
}
```

---

## Backend Implementation (Week 1)

### Step 1: Database Schema

**File**: `backend/src/db/schema.ts` (Drizzle)

```typescript
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  authId: uuid('auth_id').notNull().unique(),
  role: text('role').notNull(), // 'client' | 'driver'
  phone: text('phone').unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const clientProfiles = pgTable('client_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  phoneVerified: boolean('phone_verified').default(false),
  emailVerified: boolean('email_verified').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const driverProfiles = pgTable('driver_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  phoneVerified: boolean('phone_verified').default(false),
  verificationStatus: text('verification_status').default('pending_verification'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  driverProfileId: uuid('driver_profile_id').notNull().references(() => driverProfiles.id),
  documentType: text('document_type').notNull(), // 'license', 'id', 'insurance', 'vehicle_photo'
  storagePath: text('storage_path').notNull(), // Supabase path
  status: text('status').default('pending_review'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  expiryDate: text('expiry_date'),
});
```

### Step 2: Validators

**File**: `backend/src/validators/auth.ts`

```typescript
import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^\+241[0-9]{7,8}$/, 'Invalid Gabon phone number. Format: +241701234567');

export const signupSchema = z.object({
  role: z.enum(['client', 'driver']),
  phone: phoneSchema,
  firstName: z.string().min(2).max(100),
  lastName: z.string().min(2).max(100),
  provider: z.enum(['phone', 'google', 'facebook']),
});

export const otpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6),
});

export const profileUpdateSchema = z.object({
  firstName: z.string().min(2).max(100).optional(),
  lastName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
});
```

### Step 3: Supabase Auth Plugin

**File**: `backend/src/plugins/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import fp from 'fastify-plugin';

export default fp(async (app) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  app.decorate('supabase', supabase);
});

declare global {
  namespace FastifyInstance {
    interface FastifyInstance {
      supabase: SupabaseClient;
    }
  }
}
```

### Step 4: Auth Service

**File**: `backend/src/services/auth.ts`

```typescript
import { db } from '../db';
import { users, clientProfiles, driverProfiles } from '../db/schema';
import { eq } from 'drizzle-orm';

export async function createUser(
  authId: string,
  role: 'client' | 'driver',
  phone: string,
  firstName: string,
  lastName: string
) {
  // Create user
  const [user] = await db
    .insert(users)
    .values({
      authId,
      role,
      phone,
      firstName,
      lastName,
    })
    .returning();

  // Create profile based on role
  if (role === 'client') {
    await db
      .insert(clientProfiles)
      .values({
        userId: user.id,
        phoneVerified: true,
      });
  } else {
    await db
      .insert(driverProfiles)
      .values({
        userId: user.id,
        phoneVerified: true,
      });
  }

  return user;
}

export async function getUser(authId: string) {
  return db.query.users.findFirst({
    where: eq(users.authId, authId),
  });
}
```

### Step 5: Auth Routes

**File**: `backend/src/routes/auth.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { signupSchema, otpSchema } from '../validators/auth';
import { createUser, getUser } from '../services/auth';

export async function authRoutes(app: FastifyInstance) {
  // Sign up (phone or OAuth)
  app.post<{ Body: typeof signupSchema._type }>('/auth/signup', async (request, reply) => {
    const { role, phone, firstName, lastName, provider } = request.body;

    try {
      if (provider === 'phone') {
        // Send OTP via Supabase
        const { error } = await app.supabase.auth.signInWithOtp({ phone });
        if (error) throw error;

        return reply.code(200).send({
          message: 'OTP sent to phone',
          phone,
        });
      } else if (provider === 'google' || provider === 'facebook') {
        // OAuth flow (handled by frontend)
        return reply.code(200).send({
          message: `Use ${provider} OAuth flow`,
          provider,
        });
      }
    } catch (err) {
      app.log.error(err);
      return reply.code(400).send({ error: 'Signup failed' });
    }
  });

  // Verify OTP and create user
  app.post<{ Body: typeof otpSchema._type }>('/auth/verify-otp', async (request, reply) => {
    const { phone, code } = request.body;

    try {
      const { data, error } = await app.supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });

      if (error) throw error;

      // Check if user exists
      let user = await getUser(data.user.id);
      if (!user) {
        // Create new user (profile role will be in session metadata)
        const role = request.body.role || 'client'; // From request
        user = await createUser(
          data.user.id,
          role,
          phone,
          request.body.firstName || 'User',
          request.body.lastName || 'User'
        );
      }

      return reply.code(200).send({
        user,
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(400).send({ error: 'OTP verification failed' });
    }
  });

  // Get current user
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await getUser(request.user.sub);
    return reply.send({ user });
  });
}
```

### Step 6: Register Auth Routes

**File**: `backend/src/index.ts`

```typescript
import { authRoutes } from './routes/auth';

// ... in app init
await app.register(authRoutes);
```

### Step 7: Supabase Storage Plugin

**File**: `backend/src/plugins/storage.ts`

```typescript
import fp from 'fastify-plugin';
import { createClient } from '@supabase/supabase-js';

export default fp(async (app) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  app.decorate('storage', supabase.storage);
});
```

### Step 8: Document Upload Routes

**File**: `backend/src/routes/driver.ts`

```typescript
import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuid } from 'uuid';
import { documents } from '../db/schema';
import { db } from '../db';

export async function driverRoutes(app: FastifyInstance) {
  // Upload document
  app.post<{ Params: { documentType: string } }>(
    '/driver/documents/:documentType',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { documentType } = request.params;
      const file = await request.file();

      if (!file) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      try {
        const fileName = `${request.user.sub}/${documentType}/${uuid()}-${file.filename}`;

        const { error } = await app.storage
          .from('driver-documents')
          .upload(fileName, await file.toBuffer());

        if (error) throw error;

        // Save to DB
        const [doc] = await db
          .insert(documents)
          .values({
            driverProfileId: request.user.driverProfileId,
            documentType,
            storagePath: fileName,
          })
          .returning();

        return reply.code(200).send(doc);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: 'Upload failed' });
      }
    }
  );

  // Get driver documents
  app.get(
    '/driver/documents',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const docs = await db.query.documents.findMany({
        where: (d) => eq(d.driverProfileId, request.user.driverProfileId),
      });
      return reply.send(docs);
    }
  );
}
```

---

## Mobile Implementation (Weeks 1-2, Parallel)

### Client App (React Native / Flutter)

**Auth Store** (Zustand):
```typescript
interface AuthState {
  user: User | null;
  role: 'client' | 'driver' | null;
  token: string | null;
  loading: boolean;
  signUp: (role, phone, firstName, lastName) => Promise<void>;
  verifyOtp: (code) => Promise<void>;
  login: (phone, password) => Promise<void>;
  logout: () => void;
  initialize: () => Promise<void>;
}
```

**Screens**:
1. Splash: Role selector
2. Phone login: +241 format input
3. OTP verification: 6-digit code
4. Profile setup: Name + email
5. Home: Placeholder

### Driver App (React Native / Flutter)

**Screens**:
1. Splash: Role selector
2. Phone login + OTP
3. Profile setup: Name + email
4. Document upload: License, ID, Insurance, Vehicle photo
5. Pending verification: Status badge + can't toggle online
6. Dashboard: Locked until verified

---

## Testing

### Backend Tests

```typescript
// auth.test.ts
describe('POST /auth/signup', () => {
  it('should send OTP for valid phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        role: 'client',
        phone: '+241701234567',
        firstName: 'Jean',
        lastName: 'Paul',
        provider: 'phone',
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

### Mobile Tests

- Phone format validation
- Role selection state
- OTP input (6 digits only)
- Document upload progress
- Auth state persistence

---

## Deployment

### Supabase Config
1. Enable phone authentication (+241)
2. Configure Google OAuth (optional)
3. Configure Facebook OAuth (optional)
4. Set up Supabase Storage bucket: `driver-documents`

### Environment Variables
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxx...
SUPABASE_JWT_SECRET=dSS69wOz...
```

### Fly.io Secrets
```bash
flyctl secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_KEY=... \
  SUPABASE_JWT_SECRET=...
```

---

## Acceptance Criteria

- [ ] User can sign up with phone (+241 format)
- [ ] OTP sent to phone (Supabase)
- [ ] User verifies OTP and gets JWT
- [ ] User profile created (client_profiles or driver_profiles)
- [ ] Driver can upload documents
- [ ] JWT contains role claim
- [ ] Client redirected to home
- [ ] Driver redirected to document upload
- [ ] All integration tests pass

---

**Status**: Ready for Implementation
**Assigned**: Backend (1 week) + Mobile (2 weeks parallel)
