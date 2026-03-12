import { getDatabase } from '../../db/index.js';
import { users, clientProfiles, driverProfiles } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { User, DriverProfile, ClientProfile } from './auth.types.js';

/**
 * Create a new user with role-specific profile
 * Handles race condition: if phone already exists, returns existing user instead of erroring
 * Uses database transaction to ensure atomic user + profile creation
 */
export async function createUser(
  authId: string,
  role: 'client' | 'driver',
  phone: string,
  firstName: string,
  lastName: string,
  email?: string
): Promise<User> {
  const db = getDatabase();

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
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

      if (!user) {
        throw new Error('Failed to create user');
      }

      // Create role-specific profile
      if (role === 'client') {
        await tx.insert(clientProfiles).values({
          userId: user.id,
          phoneVerified: true,
        });
      } else {
        await tx.insert(driverProfiles).values({
          userId: user.id,
        });
      }

      return {
        id: user.id,
        authId: user.authId,
        role: user.role as 'client' | 'driver' | 'admin',
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email || undefined,
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date(),
      } as User;
    });
  } catch (err) {
    // Handle race condition: if phone already exists due to concurrent request,
    // fetch and return the existing user instead of failing
    if (err instanceof Error && 'code' in err && (err as any).code === '23505') {
      // PostgreSQL unique constraint violation error code
      const existingUser = await getUserByPhone(phone);
      if (existingUser) {
        return existingUser;
      }
    }
    throw err;
  }
}

/**
 * Get user by authId
 */
export async function getUser(authId: string): Promise<User | undefined> {
  const db = getDatabase();

  const user = await db.query.users.findFirst({
    where: eq(users.authId, authId),
  });

  if (!user) return undefined;

  return {
    id: user.id,
    authId: user.authId,
    role: user.role as 'client' | 'driver' | 'admin',
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email || undefined,
    createdAt: user.createdAt || new Date(),
    updatedAt: user.updatedAt || new Date(),
  } as User;
}

/**
 * Get user with role-specific profile by userId
 */
export async function getUserWithProfile(userId: string) {
  const db = getDatabase();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) return null;

  const userTyped: User = {
    id: user.id,
    authId: user.authId,
    role: user.role as 'client' | 'driver' | 'admin',
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email || undefined,
    createdAt: user.createdAt || new Date(),
    updatedAt: user.updatedAt || new Date(),
  };

  if (user.role === 'client') {
    const profile = await db.query.clientProfiles.findFirst({
      where: eq(clientProfiles.userId, user.id),
    });
    return { user: userTyped, profile, profileType: 'client' as const };
  } else {
    const profile = await db.query.driverProfiles.findFirst({
      where: eq(driverProfiles.userId, user.id),
    });
    return { user: userTyped, profile, profileType: 'driver' as const };
  }
}

/**
 * Update user profile fields by userId
 */
export async function updateUser(
  userId: string,
  updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
  }
) {
  const db = getDatabase();

  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}

/**
 * Check if phone already exists
 */
export async function phoneExists(phone: string): Promise<boolean> {
  const db = getDatabase();

  const user = await db.query.users.findFirst({
    where: eq(users.phone, phone),
  });

  return !!user;
}

/**
 * Get user by phone number
 */
export async function getUserByPhone(phone: string): Promise<User | undefined> {
  const db = getDatabase();

  const user = await db.query.users.findFirst({
    where: eq(users.phone, phone),
  });

  if (!user) return undefined;

  return {
    id: user.id,
    authId: user.authId,
    role: user.role as 'client' | 'driver' | 'admin',
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email || undefined,
    createdAt: user.createdAt || new Date(),
    updatedAt: user.updatedAt || new Date(),
  } as User;
}
