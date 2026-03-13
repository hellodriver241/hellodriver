import { getDatabase } from '../../db/index.js';
import { getRedis } from '../../plugins/redis.js';
import { getIO } from '../../plugins/socketio.js';
import { trips, tripBids, driverProfiles } from '../../db/schema.js';
import { eq, and, gte, ne, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getOnlineDriversInRadius } from '../driver/location.service.js';
import { VALID_TRANSITIONS } from './trip.types.js';
import type { Trip, TripBid, TripStatus } from './trip.types.js';
import type {
  BookTripInput,
  SubmitBidInput,
  UpdateTripStatusInput,
} from './trip.validators.js';

// Haversine distance formula (km)
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Fare estimation: straight-line × 1.3 road factor × 500 XAF/km + 1500 base
function calculateFareEstimate(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): number {
  const straightLineKm = haversineDistance(originLat, originLon, destLat, destLon);
  const roadDistanceKm = straightLineKm * 1.3;
  const baseAmount = 1500;
  const perKmRate = 500;
  return Math.max(
    baseAmount,
    Math.ceil((baseAmount + roadDistanceKm * perKmRate) / 100) * 100
  );
}

// Delete Redis keys matching a pattern safely (SCAN-based — DEL does not support wildcards)
async function deleteKeysByPattern(pattern: string): Promise<void> {
  const redis = getRedis();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

/**
 * Book a trip: create trip, find nearby drivers, return fare estimate
 */
export async function bookTrip(
  clientId: string,
  data: BookTripInput
): Promise<{
  trip: Trip;
  availableDriverCount: number;
  fareEstimateXaf: number;
}> {
  const db = getDatabase() as any;
  const redis = getRedis();

  const availableDriverIds = await getOnlineDriversInRadius(
    Number(data.originLatitude),
    Number(data.originLongitude),
    5
  );

  const fareEstimateXaf = calculateFareEstimate(
    Number(data.originLatitude),
    Number(data.originLongitude),
    Number(data.destinationLatitude),
    Number(data.destinationLongitude)
  );

  const tripId = uuidv4();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 min

  const [trip] = await db
    .insert(trips)
    .values({
      id: tripId,
      clientId,
      status: 'pending_bids' as TripStatus,
      originAddress: data.originAddress || null,
      originLatitude: String(data.originLatitude),
      originLongitude: String(data.originLongitude),
      originGeom: { x: data.originLongitude, y: data.originLatitude },
      destinationAddress: data.destinationAddress || null,
      destinationLatitude: String(data.destinationLatitude),
      destinationLongitude: String(data.destinationLongitude),
      destinationGeom: { x: data.destinationLongitude, y: data.destinationLatitude },
      fareEstimateXaf,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
    })
    .returning();

  await redis.setex(`trip:${tripId}:state`, 120, 'pending_bids');

  return {
    trip: trip as Trip,
    availableDriverCount: availableDriverIds.length,
    fareEstimateXaf,
  };
}

/**
 * Submit a bid on a trip (atomically claim via Redis SET NX)
 */
export async function submitBid(
  driverId: string,
  tripId: string,
  data: SubmitBidInput
): Promise<TripBid> {
  const db = getDatabase() as any;
  const redis = getRedis();

  const driver = await db.query.driverProfiles.findFirst({
    where: eq(driverProfiles.userId, driverId),
  });

  if (!driver || driver.verificationStatus !== 'approved') {
    throw new Error('Driver not verified - complete KYC before bidding');
  }

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });

  if (!trip) throw new Error('Trip not found');
  if (trip.status !== 'pending_bids') throw new Error('Trip no longer accepting bids');

  // Reject bids on trips whose 2-min window has passed
  if (trip.expiresAt && new Date() > new Date(trip.expiresAt)) {
    throw new Error('Trip has expired');
  }

  const activeTrip = await redis.get(`driver:${driverId}:active_trip`);
  if (activeTrip) throw new Error('Driver already has an active trip');

  // Atomic claim: SET NX prevents same driver bidding twice within 30s TTL
  const bidKey = `bid:${tripId}:${driverId}`;
  const bidData = JSON.stringify({
    driverId,
    amountXaf: data.amountXaf,
    etaMinutes: data.etaMinutes,
    createdAt: new Date().toISOString(),
  });

  const claimed = await redis.set(bidKey, bidData, 'EX', 30, 'NX');
  if (!claimed) throw new Error('This driver already bid on this trip (409)');

  const bidId = uuidv4();
  let bid: any;
  try {
    const [inserted] = await db
      .insert(tripBids)
      .values({
        id: bidId,
        tripId,
        driverId,
        amountXaf: data.amountXaf,
        etaMinutes: data.etaMinutes,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: trip.expiresAt,
      })
      .returning();
    bid = inserted;
  } catch (err: any) {
    // Roll back the Redis claim so the driver can retry cleanly
    await redis.del(bidKey);
    // PostgreSQL unique_violation (23505) from the (trip_id, driver_id) constraint
    if (err.code === '23505') {
      throw new Error('This driver already bid on this trip (409)');
    }
    throw err;
  }

  // Notify client in real-time
  try {
    getIO().to(`trip:${tripId}`).emit('bid:received', {
      bidId: bid.id,
      driverId,
      amountXaf: data.amountXaf,
      etaMinutes: data.etaMinutes,
      createdAt: bid.createdAt,
    });
  } catch {
    // Socket.io failure is non-fatal — bid is persisted in DB
  }

  return bid as TripBid;
}

/**
 * Accept a bid: assign driver, transition trip, reject other bids.
 * DB transaction with status guard prevents double-accept race condition.
 */
export async function acceptBid(
  clientId: string,
  tripId: string,
  bidId: string
): Promise<Trip> {
  const db = getDatabase() as any;
  const redis = getRedis();

  // Pre-fetch bid for early validation
  const bid = await db.query.tripBids.findFirst({
    where: and(eq(tripBids.id, bidId), eq(tripBids.tripId, tripId)),
  });

  if (!bid) throw new Error('Bid not found');
  if (bid.status !== 'pending') throw new Error('Bid no longer valid');

  if (bid.expiresAt && new Date() > new Date(bid.expiresAt)) {
    throw new Error('Bid has expired');
  }

  // Verify driver is still online before committing
  const heartbeat = await redis.get(`driver:${bid.driverId}:heartbeat`);
  if (!heartbeat) throw new Error('Driver is no longer online');

  let updatedTrip: any;

  await db.transaction(async (tx: any) => {
    // WHERE clause includes status = 'pending_bids' as a guard:
    // if another acceptBid() ran first, status is already 'bid_accepted'
    // and this update returns 0 rows, throwing before any bids are touched.
    const [updated] = await tx
      .update(trips)
      .set({
        status: 'bid_accepted' as TripStatus,
        driverId: bid.driverId,
        finalFareXaf: bid.amountXaf,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(trips.id, tripId),
          eq(trips.clientId, clientId),
          eq(trips.status, 'pending_bids')
        )
      )
      .returning();

    if (!updated) {
      throw new Error('Trip is not available for acceptance (already accepted or not yours)');
    }

    updatedTrip = updated;

    await tx
      .update(tripBids)
      .set({ status: 'accepted' })
      .where(eq(tripBids.id, bidId));

    await tx
      .update(tripBids)
      .set({ status: 'rejected' })
      .where(and(eq(tripBids.tripId, tripId), ne(tripBids.id, bidId)));
  });

  // Post-transaction Redis side effects
  await redis.setex(`driver:${bid.driverId}:active_trip`, 7200, tripId);
  await redis.del(`trip:${tripId}:state`);
  await deleteKeysByPattern(`bid:${tripId}:*`); // SCAN-based, not wildcard DEL

  // Notify driver and client in real-time
  try {
    getIO().to(`trip:${tripId}`).emit('bid:accepted', {
      bidId,
      driverId: bid.driverId,
      tripId,
      finalFareXaf: bid.amountXaf,
    });
  } catch {
    // Socket.io failure is non-fatal — trip state is persisted in DB
  }

  return updatedTrip as Trip;
}

/**
 * Update trip status with state machine validation
 */
export async function updateTripStatus(
  userId: string,
  tripId: string,
  data: UpdateTripStatusInput
): Promise<Trip> {
  const db = getDatabase() as any;
  const redis = getRedis();
  const newStatus = data.status as TripStatus;

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });

  if (!trip) throw new Error('Trip not found');

  const currentStatus = trip.status as TripStatus;

  if (!VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }

  // Role-based permission enforcement
  if (
    ['driver_en_route', 'driver_arrived', 'in_transit', 'completed'].includes(newStatus) &&
    trip.driverId !== userId
  ) {
    throw new Error('Only the assigned driver can update driver-related status');
  }

  if (newStatus === 'cancelled_by_client' && trip.clientId !== userId) {
    throw new Error('Only the client can cancel a trip');
  }

  if (newStatus === 'cancelled_by_driver' && trip.driverId !== userId) {
    throw new Error('Only the driver can cancel a trip');
  }

  const updateData: any = { status: newStatus, updatedAt: new Date() };
  if (newStatus === 'completed') {
    updateData.completedAt = new Date();
  }

  const [updatedTrip] = await db
    .update(trips)
    .set(updateData)
    .where(eq(trips.id, tripId))
    .returning();

  // Clean up Redis for terminal states
  if (['completed', 'cancelled_by_client', 'cancelled_by_driver'].includes(newStatus)) {
    if (trip.driverId) {
      await redis.del(`driver:${trip.driverId}:active_trip`);
    }
  }

  // Notify both parties in real-time
  try {
    getIO().to(`trip:${tripId}`).emit('trip:status_changed', {
      tripId,
      newStatus,
      previousStatus: currentStatus,
      driverId: trip.driverId,
      timestamp: updatedTrip.updatedAt,
    });
  } catch {
    // Socket.io failure is non-fatal — status is persisted in DB
  }

  return updatedTrip as Trip;
}

/**
 * Get trip details with active (non-expired) bids
 */
export async function getTripById(
  userId: string,
  tripId: string
): Promise<{ trip: Trip; bids?: TripBid[] }> {
  const db = getDatabase() as any;

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });

  if (!trip) throw new Error('Trip not found');

  if (trip.clientId !== userId && trip.driverId !== userId) {
    throw new Error('Unauthorized');
  }

  let bids: TripBid[] | undefined;

  if (trip.status === 'pending_bids') {
    // Only return bids that haven't expired yet
    bids = await db.query.tripBids.findMany({
      where: and(
        eq(tripBids.tripId, tripId),
        gte(tripBids.expiresAt, new Date())
      ),
    });
  }

  return { trip: trip as Trip, bids: bids as TripBid[] | undefined };
}

/**
 * Get available (non-expired) trips near driver position
 */
export async function getAvailableTrips(
  driverId: string,
  originLatitude: number,
  originLongitude: number
): Promise<Trip[]> {
  const db = getDatabase() as any;

  const now = new Date();

  // PostGIS ST_DWithin hits the GIST spatial index — sub-5ms at any realistic scale.
  // 5 000 m = 5 km matching radius. ::geography cast gives metre-accurate spherical distance.
  const availableTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.status, 'pending_bids'),
        gte(trips.expiresAt, now),
        isNotNull(trips.originGeom),
        sql`ST_DWithin(
          origin_geom::geography,
          ST_SetSRID(ST_MakePoint(${originLongitude}, ${originLatitude}), 4326)::geography,
          5000
        )`,
      ),
    )
    .orderBy(trips.createdAt)
    .limit(50);

  return availableTrips as Trip[];
}
