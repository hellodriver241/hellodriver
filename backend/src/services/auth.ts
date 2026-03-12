import { getDatabase } from '../db/index.js';
import { users, clientProfiles, driverProfiles } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function createUser(
  authId: string,
  role: 'client' | 'driver',
  phone: string,
  firstName: string,
  lastName: string,
  email?: string
) {
  const db = getDatabase();

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
  const db = getDatabase();
  return db.query.users.findFirst({
    where: eq(users.authId, authId),
  });
}

export async function getUserWithProfile(authId: string) {
  const db = getDatabase();
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
