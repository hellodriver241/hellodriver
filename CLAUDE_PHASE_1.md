# Phase 1: Auth + Profile Setup — Final Implementation Guide

**Duration**: 3 weeks (Backend: 1 week, Mobile: 2 weeks parallel)
**Goal**: Both client and driver can sign up via phone OTP, verify, and set up profile
**Test Gate**: Role select → Phone OTP → Profile → Dashboard accessible

---

## Screen Flow (from Figma)

```
Splash Screens (onboarding carousel)
  ↓
Role Selector ("Je suis : Client / Driver")  ← KEY SCREEN
  ↓
[CLIENT PATH]                    [DRIVER PATH]
Client Login                      Driver Login
  ↓                                 ↓
Client Signup                     Driver Signup
  ↓                                 ↓
Client Home                       Document Upload (4 screens)
                                    ↓
                                  Driver Dashboard (locked)
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
  phone: text('phone').unique().notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
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
  verificationStatus: text('verification_status').default('pending_verification'), // pending_verification, approved, rejected
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  driverProfileId: uuid('driver_profile_id').notNull().references(() => driverProfiles.id),
  documentType: text('document_type').notNull(), // 'license', 'id', 'insurance', 'vehicle_photo'
  storagePath: text('storage_path').notNull(), // Supabase Storage path
  status: text('status').default('pending_review'), // pending_review, approved, rejected
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  expiryDate: text('expiry_date'),
});
```

### Step 2: Validators (Zod)

**File**: `backend/src/validators/auth.ts`

```typescript
import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^\+241[0-9]{7,8}$/, 'Format: +241701234567');

export const roleSchema = z.enum(['client', 'driver']);

export const signupSchema = z.object({
  role: roleSchema,
  phone: phoneSchema,
  firstName: z.string().min(2).max(100),
  lastName: z.string().min(2).max(100),
  email: z.string().email().optional(),
});

export const otpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6).regex(/^\d{6}$/),
});

export const documentUploadSchema = z.object({
  documentType: z.enum(['license', 'id', 'insurance', 'vehicle_photo']),
});
```

### Step 3: Auth Service

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
  lastName: string,
  email?: string
) {
  const [user] = await db
    .insert(users)
    .values({
      authId,
      role,
      phone,
      firstName,
      lastName,
      email,
    })
    .returning();

  // Create role-specific profile
  if (role === 'client') {
    await db.insert(clientProfiles).values({
      userId: user.id,
      phoneVerified: true,
    });
  } else {
    await db.insert(driverProfiles).values({
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

export async function getUserWithProfile(authId: string) {
  const user = await getUser(authId);
  if (!user) return null;

  if (user.role === 'client') {
    const profile = await db.query.clientProfiles.findFirst({
      where: eq(clientProfiles.userId, user.id),
    });
    return { user, profile };
  } else {
    const profile = await db.query.driverProfiles.findFirst({
      where: eq(driverProfiles.userId, user.id),
    });
    return { user, profile };
  }
}
```

### Step 4: Auth Routes

**File**: `backend/src/routes/auth.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { signupSchema, otpSchema } from '../validators/auth';
import { createUser, getUser, getUserWithProfile } from '../services/auth';

export async function authRoutes(app: FastifyInstance) {
  // Step 1: Send OTP
  app.post('/auth/send-otp', async (request, reply) => {
    const { phone } = signupSchema.pick({ phone: true }).parse(request.body);

    try {
      const { error } = await app.supabase.auth.signInWithOtp({ phone });
      if (error) throw error;

      return reply.code(200).send({
        message: 'OTP sent to phone',
        phone,
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(400).send({ error: 'Failed to send OTP' });
    }
  });

  // Step 2: Verify OTP and create user
  app.post('/auth/verify-otp-and-signup', async (request, reply) => {
    const { phone, code, role, firstName, lastName, email } = otpSchema
      .merge(signupSchema.pick({ role: true, firstName: true, lastName: true, email: true }))
      .parse(request.body);

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
        user = await createUser(data.user.id, role, phone, firstName, lastName, email);
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
    const result = await getUserWithProfile(request.user.sub);
    return reply.send(result);
  });

  // Update profile
  app.patch('/auth/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { firstName, lastName, email } = signupSchema
      .pick({ firstName: true, lastName: true, email: true })
      .partial()
      .parse(request.body);

    try {
      const [user] = await db
        .update(users)
        .set({ firstName, lastName, email })
        .where(eq(users.authId, request.user.sub))
        .returning();

      return reply.send(user);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'Profile update failed' });
    }
  });
}
```

### Step 5: Document Upload Routes

**File**: `backend/src/routes/driver.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { documents } from '../db/schema';
import { db } from '../db';
import { eq } from 'drizzle-orm';

export async function driverRoutes(app: FastifyInstance) {
  // Upload document
  app.post(
    '/driver/documents/:documentType',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { documentType } = request.params as { documentType: string };
      const file = await request.file();

      if (!file) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      try {
        // Get driver profile
        const driverProfile = await db.query.driverProfiles.findFirst({
          where: (d) =>
            db.sql`${eq(d.userId, request.user.sub)}`,
        });

        if (!driverProfile) {
          return reply.code(404).send({ error: 'Driver profile not found' });
        }

        const fileName = `${request.user.sub}/${documentType}/${uuid()}-${file.filename}`;

        const { error } = await app.storage
          .from('driver-documents')
          .upload(fileName, await file.toBuffer());

        if (error) throw error;

        const [doc] = await db
          .insert(documents)
          .values({
            driverProfileId: driverProfile.id,
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
      try {
        const driverProfile = await db.query.driverProfiles.findFirst({
          where: (d) =>
            db.sql`${eq(d.userId, request.user.sub)}`,
        });

        if (!driverProfile) {
          return reply.code(404).send({ error: 'Driver profile not found' });
        }

        const docs = await db.query.documents.findMany({
          where: (d) =>
            db.sql`${eq(d.driverProfileId, driverProfile.id)}`,
        });

        return reply.send(docs);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch documents' });
      }
    }
  );
}
```

### Step 6: Register Routes in index.ts

```typescript
import { authRoutes } from './routes/auth';
import { driverRoutes } from './routes/driver';

// ... in app init
await app.register(authRoutes);
await app.register(driverRoutes);
```

---

## Mobile Implementation (Weeks 1-2, Parallel)

### Client App (React Native / Flutter)

**Screens**:
1. **Splash** → Onboarding carousel (3 slides)
2. **Role Selector** ("Je suis : Client / Driver")
3. **Phone Login** (+241 input, Send OTP button)
4. **OTP Verification** (6-digit code, verify button)
5. **Profile Setup** (First name, Last name, Email - optional)
6. **Home Dashboard** (Placeholder)

**Auth Store** (Zustand):
```typescript
interface AuthState {
  user: User | null;
  role: 'client' | 'driver' | null;
  token: string | null;
  phone: string | null;
  loading: boolean;
  selectRole: (role) => void;
  sendOtp: (phone) => Promise<void>;
  verifyOtp: (code) => Promise<void>;
  updateProfile: (firstName, lastName, email?) => Promise<void>;
  logout: () => void;
  initialize: () => Promise<void>;
}
```

### Driver App (React Native / Flutter)

**Screens**:
1. **Splash** → Onboarding carousel (3 slides)
2. **Role Selector** ("Je suis : Client / Driver")
3. **Phone Login** (Send OTP)
4. **OTP Verification** (Verify code)
5. **Profile Setup** (First name, Last name, Email - optional)
6. **Document Upload** (4 screens):
   - License upload (camera/file)
   - ID upload (camera/file)
   - Insurance upload (camera/file)
   - Vehicle photo upload (camera/file)
7. **Pending Verification** (Status badge, "Documents under review")
8. **Driver Dashboard** (Locked until verified)

---

## API Endpoints (Phase 1)

```
POST /auth/send-otp
  Request: { phone: "+241701234567" }
  Response: { message, phone }

POST /auth/verify-otp-and-signup
  Request: { phone, code, role, firstName, lastName, email? }
  Response: { user, token, refreshToken }

GET /auth/me
  Response: { user, profile }

PATCH /auth/profile
  Request: { firstName?, lastName?, email? }
  Response: { user }

POST /driver/documents/:documentType
  Request: FormData { file }
  Response: { document }

GET /driver/documents
  Response: [{ document }]
```

---

## Supabase Configuration

1. **Enable Phone Authentication**:
   - Settings → Authentication → Phone OTP
   - SMS provider: Select appropriate (Africa's Talking or Twilio for Gabon)
   - OTP expiry: 10 minutes

2. **Optional: OAuth** (Google + Facebook):
   - Settings → Authentication → Providers
   - Add Google Client ID (from oauth_credentials.md)
   - Add Facebook App ID

3. **Create Storage Bucket**:
   - Storage → Create bucket "driver-documents"
   - Set policies: authenticated users can upload to their own folder

---

## Testing Strategy

### Backend Tests
```typescript
// auth.test.ts
describe('POST /auth/send-otp', () => {
  it('should send OTP for valid Gabon phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: { phone: '+241701234567' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should reject invalid phone format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: { phone: '+1234567890' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/verify-otp-and-signup', () => {
  it('should create user on valid OTP', async () => {
    // Mock Supabase OTP verification
    // Create user and profile
    // Return token
  });
});
```

### Mobile Tests
- Role selector: Verify both roles show, navigation works
- Phone input: Format validation, +241 prefix, 7-8 digits
- OTP input: 6 digits only, verify button enabled when complete
- Profile fields: Optional email, required name fields
- Document upload: File picker, progress indicator, success state

---

## Acceptance Criteria

✅ User taps "Client" or "Driver" on role selector
✅ User enters phone (+241 format) and receives OTP
✅ User enters 6-digit OTP and verifies
✅ User enters name + optional email
✅ Client is redirected to Home screen
✅ Driver is redirected to Document Upload screen
✅ Driver can upload 4 document types
✅ Documents show "Pending review" status
✅ Driver cannot toggle online until verified
✅ All integration tests pass
✅ Fly.io deployment succeeds

---

## Deployment Checklist

- [ ] Supabase: Phone OTP configured + SMS provider set up
- [ ] Supabase: Storage bucket "driver-documents" created
- [ ] GitHub Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET
- [ ] Fly.io: Secrets deployed
- [ ] Mobile: Auth store connected to API
- [ ] Mobile: Role selector implemented
- [ ] Mobile: Document upload working

---

**Status**: 🚀 **READY TO IMPLEMENT**
**Start Date**: 2026-03-12
**Backend Owner**: Claude (autonomous)
**Mobile Owner**: Claude (autonomous)
**Test Lead**: Claude + Integration tests

---

**Last Updated**: 2026-03-12
**Version**: FINAL (based on actual Figma design + 5 critical fixes)
