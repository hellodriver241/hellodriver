import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  varchar,
  integer,
  date,
  numeric,
  geometry,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  authId: uuid('auth_id').notNull().unique(),
  role: text('role').notNull(), // 'client' | 'driver' | 'admin'
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

  // Profile info
  dateOfBirth: date('date_of_birth'),
  vehicleBrand: varchar('vehicle_brand', { length: 100 }),
  vehicleYear: integer('vehicle_year'),
  vehicleModel: varchar('vehicle_model', { length: 100 }),
  vehicleRegistration: varchar('vehicle_registration', { length: 50 }),
  residentialArea: varchar('residential_area', { length: 100 }),
  hasAc: boolean('has_ac'),
  mobileMoneyAccount: varchar('mobile_money_account', { length: 20 }), // Airtel or Moov number

  // Verification
  isVerified: boolean('is_verified').default(false),
  verificationStatus: text('verification_status').default('pending'), // 'pending' | 'approved' | 'rejected'
  verifiedAt: timestamp('verified_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const driverDocuments = pgTable('driver_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  documentType: text('document_type').notNull(), // 'drivers_license' | 'id_card' | 'vehicle_insurance'
  storageUrl: varchar('storage_url'), // Supabase Storage public URL
  uploadStatus: text('upload_status').default('pending'), // 'pending' | 'verified' | 'rejected'
  rejectionReason: text('rejection_reason'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedByAdminId: uuid('verified_by_admin_id').references(() => users.id),
});

export const driverVerificationLog = pgTable('driver_verification_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: text('action').notNull(), // 'doc_uploaded' | 'doc_approved' | 'doc_rejected' | 'driver_approved' | 'driver_rejected'
  adminId: uuid('admin_id').references(() => users.id),
  details: text('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const driverLocations = pgTable('driver_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
  isOnline: boolean('is_online').default(false),
  isAvailable: boolean('is_available').default(false),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const tripLocationPings = pgTable('trip_location_pings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tripId: uuid('trip_id').notNull(),
  driverId: uuid('driver_id').notNull().references(() => users.id),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  geom: geometry('geom', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
  speed: numeric('speed', { precision: 5, scale: 2 }),
  bearing: numeric('bearing', { precision: 5, scale: 2 }),
  accuracy: numeric('accuracy', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
