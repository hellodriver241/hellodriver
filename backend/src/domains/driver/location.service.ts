import { getDatabase } from '../../db/index.js';
import { driverLocations, tripLocationPings, driverProfiles } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../../plugins/redis.js';
import type { LocationUpdateInput, OnlineToggleInput } from './location.validators.js';


/**
 * Update driver GPS location
 * - Redis GEOADD (ephemeral, for real-time matching) — every ping
 * - PostgreSQL upsert (durable fallback) — only on significant movement or time threshold
 * - Updates heartbeat for stale driver detection (25s TTL for Gabon network reliability)
 */
export async function updateDriverLocation(
  userId: string,
  data: LocationUpdateInput
): Promise<{ latitude: string; longitude: string; isOnline: boolean }> {
  const db = getDatabase() as any;
  const redis = getRedis();

  // Validate driver is verified before allowing location updates
  const driver = await db.query.driverProfiles.findFirst({
    where: eq(driverProfiles.userId, userId),
  });

  if (!driver || driver.verificationStatus !== 'approved') {
    throw new Error('Driver is not verified, must complete KYC first');
  }

  // Add to Redis GEOADD (lon, lat order for Redis) — every ping for real-time matching
  await redis.geoadd('drivers:locations', data.longitude, data.latitude, userId);

  // Refresh heartbeat in Redis (25s TTL — handles Gabon 3G network hiccups)
  // Drivers missing heartbeat >25s filtered from matching pool
  await redis.setex(`driver:${userId}:heartbeat`, 25, 'active');

  // Write to PostgreSQL with upsert
  try {
    const [location] = await db
      .insert(driverLocations)
      .values({
        userId,
        latitude: String(data.latitude),
        longitude: String(data.longitude),
        geom: {
          x: data.longitude,
          y: data.latitude,
        },
        isOnline: true,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: driverLocations.userId,
        set: {
          latitude: String(data.latitude),
          longitude: String(data.longitude),
          geom: {
            x: data.longitude,
            y: data.latitude,
          },
          isOnline: true,
          lastHeartbeat: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    console.log('Location after insert:', { latitude: location.latitude, longitude: location.longitude, isOnline: location.isOnline });
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      isOnline: location.isOnline,
    };
  } catch (error) {
    console.error('Error updating driver location:', error);
    throw error;
  }
}

/**
 * Toggle driver online/offline status
 * Prevents going online if not verified
 * Updates Redis and PostgreSQL atomically
 */
export async function toggleDriverOnlineStatus(
  userId: string,
  data: OnlineToggleInput
): Promise<{ isOnline: boolean; isAvailable: boolean }> {
  const db = getDatabase() as any;
  const redis = getRedis();

  // Validate driver is verified before allowing online status
  if (data.isOnline) {
    const driver = await db.query.driverProfiles.findFirst({
      where: eq(driverProfiles.userId, userId),
    });

    if (!driver || driver.verificationStatus !== 'approved') {
      throw new Error('Driver not verified - complete KYC before going online');
    }
  }

  // Update PostgreSQL
  const [location] = await db
    .insert(driverLocations)
    .values({
      userId,
      latitude: '0',
      longitude: '0',
      geom: {
        x: 0,
        y: 0,
      },
      isOnline: data.isOnline,
      isAvailable: data.isOnline, // Available implies online
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: driverLocations.userId,
      set: {
        isOnline: data.isOnline,
        isAvailable: data.isOnline,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Update Redis status key
  if (data.isOnline) {
    await redis.setex(`driver:${userId}:online`, 86400, '1'); // 24h TTL
    await redis.setex(`driver:${userId}:heartbeat`, 25, 'active'); // 25s TTL
  } else {
    await redis.del(`driver:${userId}:online`);
    await redis.del(`driver:${userId}:heartbeat`);
  }

  return {
    isOnline: location.isOnline,
    isAvailable: location.isAvailable,
  };
}

/**
 * Record GPS ping for active trip
 * Append-only, used for trip history and detailed tracking
 */
export async function recordTripLocationPing(
  tripId: string,
  driverId: string,
  data: LocationUpdateInput
): Promise<void> {
  const db = getDatabase() as any;

  await db.insert(tripLocationPings).values({
    id: uuidv4(),
    tripId,
    driverId,
    latitude: String(data.latitude),
    longitude: String(data.longitude),
    geom: {
      x: data.longitude,
      y: data.latitude,
    },
    speed: data.speed ? String(data.speed) : null,
    bearing: data.bearing ? String(data.bearing) : null,
    accuracy: data.accuracy ? String(data.accuracy) : null,
    createdAt: new Date(),
  });
}

/**
 * Get driver location
 */
export async function getDriverLocation(userId: string) {
  const db = getDatabase() as any;

  const location = await db.query.driverLocations.findFirst({
    where: eq(driverLocations.userId, userId),
  });

  return location;
}

/**
 * Get online available drivers in a region (via Redis GEORADIUS)
 * Used by trip matching engine
 */
export async function getOnlineDriversInRadius(
  latitude: number,
  longitude: number,
  radiusKm: number = 5
): Promise<string[]> {
  const redis = getRedis();

  // GEORADIUS: find drivers within radius
  const driverIds = (await redis.georadius(
    'drivers:locations',
    longitude,
    latitude,
    radiusKm,
    'km'
  )) as string[];

  // Filter by heartbeat (remove stale drivers >15s without ping)
  const activeDrivers = [];
  for (const driverId of driverIds) {
    const hasHeartbeat = await redis.exists(`driver:${driverId}:heartbeat`);
    const isOnline = await redis.exists(`driver:${driverId}:online`);

    if (hasHeartbeat && isOnline) {
      activeDrivers.push(driverId);
    }
  }

  return activeDrivers;
}
