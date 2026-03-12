import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  authId: uuid('auth_id').notNull().unique(),
  role: text('role').notNull(), // 'client' | 'driver'
  phone: varchar('phone', { length: 20 }).unique().notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
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
  driverProfileId: uuid('driver_profile_id')
    .notNull()
    .references(() => driverProfiles.id),
  documentType: text('document_type').notNull(), // 'license', 'id', 'insurance', 'vehicle_photo'
  storagePath: text('storage_path').notNull(), // Supabase Storage path
  status: text('status').default('pending_review'), // pending_review, approved, rejected
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  expiryDate: varchar('expiry_date', { length: 10 }), // YYYY-MM-DD format
});
