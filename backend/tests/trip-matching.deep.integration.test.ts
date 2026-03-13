/**
 * Deep Trip Matching Integration Tests
 *
 * Tests the critical behaviors the smoke tests miss:
 *  1. Fare formula — exact XAF for known coordinates
 *  2. Geospatial radius — driver 8 km away doesn't see nearby trips
 *  3. Multiple drivers — DB audit trail after bid acceptance (accepted/rejected)
 *  4. Redis NX race — two concurrent bids from the same driver: exactly one wins
 *  5. Active trip guard — driver with an ongoing trip can't bid on another
 *  6. Redis cleanup on completion — active_trip key is deleted
 *  7. Redis cleanup on cancellation — active_trip key is deleted
 *  8. Bid window expiry — bidding on an expired trip is rejected
 *  9. Expired trips absent from available list
 * 10. Heartbeat guard — acceptBid fails when driver's heartbeat is gone
 * 11. Socket.io bid:received — event actually arrives
 * 12. Socket.io trip:status_changed — event actually arrives
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { io as ioc } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase, getDatabase } from '../src/db/index';
import { initializeRedis, closeRedis, getRedis } from '../src/plugins/redis';
import { initializeSocketIO, closeSocketIO } from '../src/plugins/socketio';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import { trips, tripBids } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';

// ─── Fare formula (mirrored from trip.service.ts — if this diverges the test catches it) ───
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function expectedFareXaf(oLat: number, oLon: number, dLat: number, dLon: number): number {
  const roadKm = haversineKm(oLat, oLon, dLat, dLon) * 1.3;
  return Math.max(1500, Math.ceil((1500 + roadKm * 500) / 100) * 100);
}

// ─── Test coordinates ─────────────────────────────────────────────────────────────────────
// Downtown Libreville → Airport  (~4 km, → fare = 4 100 XAF)
const ORIGIN = { lat: 0.4161, lon: 9.4673, addr: 'Downtown Libreville' };
const DEST   = { lat: 0.4300, lon: 9.5000, addr: 'Airport' };
// A point ~8 km north of ORIGIN — outside the 5 km matching radius
const FAR    = { lat: 0.4880, lon: 9.4673 };

// ─── Shared state ─────────────────────────────────────────────────────────────────────────
let app: FastifyInstance;
let serverPort: number;
const testSockets: ClientSocket[] = [];

let clientToken: string;
let clientId: string;
let driver1Token: string;
let driver1Id: string;
let driver2Token: string;
let driver2Id: string;
let adminToken: string;

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────

/** Create + approve + put online a driver account */
async function setupDriver(
  phone: string,
  firstName: string,
  lat: number,
  lon: number,
): Promise<{ token: string; id: string }> {
  await request(app.server).post('/auth/send-otp').send({ phone });
  const otp = getOTPForTesting(phone);
  const signup = await request(app.server)
    .post('/auth/verify-otp-and-signup')
    .send({ phone, code: otp, role: 'driver', firstName, lastName: 'Deep' });

  const token = signup.body.session.access_token;
  const id = signup.body.user.id;

  await request(app.server)
    .post('/drivers/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({
      dateOfBirth: '1990-01-01',
      vehicleBrand: 'Toyota',
      vehicleYear: 2021,
      vehicleModel: 'Hilux',
      vehicleRegistration: `GA-2021-${phone.slice(-3)}`,
      residentialArea: 'Libreville Centre',
      hasAc: true,
      mobileMoneyAccount: '+24106000001',
    });

  for (const docType of ['drivers_license', 'id_card', 'vehicle_insurance']) {
    const up = await request(app.server)
      .post('/drivers/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('documentType', docType)
      .attach('file', Buffer.from('dummy pdf'), 'dummy.pdf');
    await request(app.server)
      .post(`/admin/drivers/${id}/documents/${up.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  await request(app.server)
    .patch(`/admin/drivers/${id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ notes: 'Approved for deep tests' });

  // GPS ping sets heartbeat + adds to Redis geo set
  await request(app.server)
    .post('/drivers/location')
    .set('Authorization', `Bearer ${token}`)
    .send({ latitude: lat, longitude: lon, speed: 0, bearing: 0, accuracy: 5 });

  await request(app.server)
    .patch('/drivers/toggle-online')
    .set('Authorization', `Bearer ${token}`)
    .send({ isOnline: true });

  return { token, id };
}

/** Book a fresh trip from the global client */
async function bookTrip(): Promise<string> {
  const res = await request(app.server)
    .post('/trips/book')
    .set('Authorization', `Bearer ${clientToken}`)
    .send({
      originLatitude: ORIGIN.lat,
      originLongitude: ORIGIN.lon,
      originAddress: ORIGIN.addr,
      destinationLatitude: DEST.lat,
      destinationLongitude: DEST.lon,
      destinationAddress: DEST.addr,
    });
  return res.body.trip.id as string;
}

/** Accept a bid and return the updated trip */
async function acceptBid(tripId: string, bidId: string) {
  return request(app.server)
    .patch(`/trips/${tripId}/accept-bid`)
    .set('Authorization', `Bearer ${clientToken}`)
    .send({ bidId });
}

/** Advance trip through all states to completed (driver1) */
async function completeTrip(tripId: string) {
  for (const status of [
    'driver_en_route',
    'driver_arrived',
    'in_transit',
    'completed',
  ] as const) {
    await request(app.server)
      .patch(`/trips/${tripId}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status });
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  initializeDatabase();
  await initializeRedis();
  app = await createApp();
  await registerRoutes(app);
  await app.ready();
  initializeSocketIO(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  serverPort = (app.server.address() as AddressInfo).port;

  // ── Admin ────────────────────────────────────────────────────────────────────
  const adminPhone = '+241072000002';
  await request(app.server).post('/auth/send-otp').send({ phone: adminPhone });
  const adminOtp = getOTPForTesting(adminPhone);
  const adminRes = await request(app.server)
    .post('/auth/verify-otp-and-signup')
    .send({ phone: adminPhone, code: adminOtp, role: 'admin', firstName: 'Admin', lastName: 'Deep' });
  adminToken = adminRes.body.session.access_token;

  // ── Client ───────────────────────────────────────────────────────────────────
  const clientPhone = '+241071000002';
  await request(app.server).post('/auth/send-otp').send({ phone: clientPhone });
  const clientOtp = getOTPForTesting(clientPhone);
  const clientRes = await request(app.server)
    .post('/auth/verify-otp-and-signup')
    .send({ phone: clientPhone, code: clientOtp, role: 'client', firstName: 'Client', lastName: 'Deep' });
  clientToken = clientRes.body.session.access_token;
  clientId = clientRes.body.user.id;

  // ── Drivers ───────────────────────────────────────────────────────────────────
  ({ token: driver1Token, id: driver1Id } = await setupDriver('+241073000002', 'Alpha', ORIGIN.lat, ORIGIN.lon));
  ({ token: driver2Token, id: driver2Id } = await setupDriver('+241073000003', 'Beta', ORIGIN.lat + 0.005, ORIGIN.lon + 0.005));

  // Clear any stale active-trip keys from prior runs
  const redis = getRedis();
  await redis.del(`driver:${driver1Id}:active_trip`);
  await redis.del(`driver:${driver2Id}:active_trip`);
}, 120_000);

afterAll(async () => {
  for (const s of testSockets) s.disconnect();
  await closeSocketIO();
  await app.close();
  await closeRedis();
  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FARE FORMULA
// ═══════════════════════════════════════════════════════════════════════════════
describe('Fare formula', () => {
  it('returns the correct XAF for known coordinates', async () => {
    const expected = expectedFareXaf(ORIGIN.lat, ORIGIN.lon, DEST.lat, DEST.lon);
    // Sanity check our own formula before asserting the API matches it
    expect(expected).toBe(4100); // pre-computed from haversine(0.4161,9.4673→0.4300,9.5000)

    const res = await request(app.server)
      .post('/trips/book')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        originLatitude: ORIGIN.lat,
        originLongitude: ORIGIN.lon,
        destinationLatitude: DEST.lat,
        destinationLongitude: DEST.lon,
      });

    expect(res.status).toBe(201);
    expect(res.body.fareEstimateXaf).toBe(expected);
  });

  it('returns base fare (1 500 XAF) when origin equals destination (floor guard)', async () => {
    // Zero distance → roadKm = 0 → formula yields 1 500 + 0 = 1 500 exactly → floor applies
    const expected = expectedFareXaf(ORIGIN.lat, ORIGIN.lon, ORIGIN.lat, ORIGIN.lon);
    expect(expected).toBe(1500);

    const res = await request(app.server)
      .post('/trips/book')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        originLatitude: ORIGIN.lat,
        originLongitude: ORIGIN.lon,
        destinationLatitude: ORIGIN.lat,
        destinationLongitude: ORIGIN.lon,
      });

    expect(res.status).toBe(201);
    expect(res.body.fareEstimateXaf).toBe(1500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GEOSPATIAL RADIUS
// ═══════════════════════════════════════════════════════════════════════════════
describe('Geospatial radius filtering', () => {
  it('driver within 5 km sees the available trip', async () => {
    await bookTrip();
    const res = await request(app.server)
      .get(`/trips/available?latitude=${ORIGIN.lat}&longitude=${ORIGIN.lon}`)
      .set('Authorization', `Bearer ${driver1Token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((t: any) => t.status === 'pending_bids')).toBe(true);
  });

  it('driver 8 km away does NOT see the available trip', async () => {
    // Book a trip at ORIGIN; query from FAR (8 km north)
    const tripId = await bookTrip();

    const res = await request(app.server)
      .get(`/trips/available?latitude=${FAR.lat}&longitude=${FAR.lon}`)
      .set('Authorization', `Bearer ${driver1Token}`);

    expect(res.status).toBe(200);
    // The specific trip booked at ORIGIN should not appear at 8 km distance
    const found = (res.body as any[]).find((t: any) => t.id === tripId);
    expect(found).toBeUndefined();

    // Also verify the haversine distance really is > 5 km
    const distKm = haversineKm(FAR.lat, FAR.lon, ORIGIN.lat, ORIGIN.lon);
    expect(distKm).toBeGreaterThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MULTIPLE DRIVERS — DB AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════════
describe('Multiple drivers bidding — DB state after acceptance', () => {
  it('accepting driver1 bid marks driver2 bid as rejected in the DB', async () => {
    const tripId = await bookTrip();

    // Both drivers bid
    const bid1Res = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bid1Res.status).toBe(201);
    const bid1Id = bid1Res.body.id;

    const bid2Res = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({ amountXaf: 3200, etaMinutes: 12 });
    expect(bid2Res.status).toBe(201);
    const bid2Id = bid2Res.body.id;

    // Client accepts driver1's bid
    const acceptRes = await acceptBid(tripId, bid1Id);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.driverId).toBe(driver1Id);

    // Directly inspect DB rows — this is what the smoke tests never verified
    const db = getDatabase() as any;
    const bid1Row = await db.query.tripBids.findFirst({ where: eq(tripBids.id, bid1Id) });
    const bid2Row = await db.query.tripBids.findFirst({ where: eq(tripBids.id, bid2Id) });

    expect(bid1Row.status).toBe('accepted');
    expect(bid2Row.status).toBe('rejected'); // ← the losing bid must be rejected, not left pending

    // Clean up: complete the trip so driver1 is free for subsequent tests
    await completeTrip(tripId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REDIS NX RACE — CONCURRENT BIDS FROM SAME DRIVER
// ═══════════════════════════════════════════════════════════════════════════════
describe('Redis NX atomic claim', () => {
  it('two simultaneous bids from the same driver: exactly one wins (201), one loses (409)', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();

    // Fire both requests at the same time
    const [res1, res2] = await Promise.all([
      request(app.server)
        .post(`/trips/${tripId}/bid`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ amountXaf: 2800, etaMinutes: 8 }),
      request(app.server)
        .post(`/trips/${tripId}/bid`)
        .set('Authorization', `Bearer ${driver1Token}`)
        .send({ amountXaf: 2800, etaMinutes: 8 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]); // exactly one succeeds

    const successRes = [res1, res2].find(r => r.status === 201)!;
    const conflictRes = [res1, res2].find(r => r.status === 409)!;
    expect(conflictRes.body.error.code).toBe('CONFLICT');

    // Only one DB row should exist for this driver+trip
    const db = getDatabase() as any;
    const bids = await db.query.tripBids.findMany({
      where: eq(tripBids.tripId, tripId),
    });
    const driver1Bids = bids.filter((b: any) => b.driverId === driver1Id);
    expect(driver1Bids).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ACTIVE TRIP GUARD
// ═══════════════════════════════════════════════════════════════════════════════
describe('Active trip guard', () => {
  it('driver with an ongoing trip cannot bid on a new one', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    // Trip A: driver1 bids, client accepts → driver1 now has active_trip
    const tripAId = await bookTrip();
    const bidARes = await request(app.server)
      .post(`/trips/${tripAId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bidARes.status).toBe(201);
    await acceptBid(tripAId, bidARes.body.id);

    // Verify Redis key is set
    const activeTrip = await redis.get(`driver:${driver1Id}:active_trip`);
    expect(activeTrip).toBe(tripAId);

    // Trip B: driver1 tries to bid → blocked
    const tripBId = await bookTrip();
    const bidBRes = await request(app.server)
      .post(`/trips/${tripBId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });

    expect(bidBRes.status).toBe(400);
    expect(bidBRes.body.error.message).toMatch(/active trip/i);

    // Clean up: complete trip A
    await completeTrip(tripAId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6 & 7. REDIS CLEANUP ON COMPLETION / CANCELLATION
// ═══════════════════════════════════════════════════════════════════════════════
describe('Redis active_trip cleanup', () => {
  it('active_trip key is deleted when trip reaches completed', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();
    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bidRes.status).toBe(201);
    await acceptBid(tripId, bidRes.body.id);

    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBe(tripId);

    await completeTrip(tripId);

    // Key must be gone
    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBeNull();
  });

  it('active_trip key is deleted when client cancels the trip', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();
    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bidRes.status).toBe(201);
    await acceptBid(tripId, bidRes.body.id);

    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBe(tripId);

    // Client cancels
    const cancelRes = await request(app.server)
      .patch(`/trips/${tripId}/status`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'cancelled_by_client' });
    expect(cancelRes.status).toBe(200);

    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBeNull();
  });

  it('active_trip key is deleted when driver cancels the trip', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();
    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bidRes.status).toBe(201);
    await acceptBid(tripId, bidRes.body.id);

    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBe(tripId);

    // Driver cancels (valid from bid_accepted state)
    const cancelRes = await request(app.server)
      .patch(`/trips/${tripId}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'cancelled_by_driver' });
    expect(cancelRes.status).toBe(200);

    expect(await redis.get(`driver:${driver1Id}:active_trip`)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8 & 9. BID WINDOW EXPIRY
// ═══════════════════════════════════════════════════════════════════════════════
describe('Bid window expiry', () => {
  it('cannot bid on a trip whose 2-min window has closed', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();

    // Force the trip's bid window to expire by setting expiresAt to the past
    const db = getDatabase() as any;
    await db.update(trips)
      .set({ expiresAt: new Date(Date.now() - 5000) })
      .where(eq(trips.id, tripId));

    const res = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('expired trip is absent from the available trips list', async () => {
    const tripId = await bookTrip();

    // Expire it
    const db = getDatabase() as any;
    await db.update(trips)
      .set({ expiresAt: new Date(Date.now() - 5000) })
      .where(eq(trips.id, tripId));

    const res = await request(app.server)
      .get(`/trips/available?latitude=${ORIGIN.lat}&longitude=${ORIGIN.lon}`)
      .set('Authorization', `Bearer ${driver1Token}`);

    expect(res.status).toBe(200);
    const found = (res.body as any[]).find((t: any) => t.id === tripId);
    expect(found).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. HEARTBEAT GUARD
// ═══════════════════════════════════════════════════════════════════════════════
describe('Heartbeat guard on acceptBid', () => {
  it('acceptBid fails when the driver heartbeat has expired', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const tripId = await bookTrip();

    // Driver1 bids
    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3000, etaMinutes: 10 });
    expect(bidRes.status).toBe(201);
    const bidId = bidRes.body.id;

    // Simulate driver going stale: delete their heartbeat
    await redis.del(`driver:${driver1Id}:heartbeat`);

    // Client tries to accept → service must reject
    const acceptRes = await acceptBid(tripId, bidId);
    expect(acceptRes.status).toBe(400);
    expect(acceptRes.body.error.message).toMatch(/no longer online/i);

    // Restore heartbeat so driver1 works for subsequent tests
    await redis.setex(`driver:${driver1Id}:heartbeat`, 25, 'active');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11 & 12. SOCKET.IO REAL-TIME EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
describe('Socket.io real-time events', () => {
  function connectSocket(token: string): ClientSocket {
    const socket = ioc(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    testSockets.push(socket);
    return socket;
  }

  function waitForConnect(socket: ClientSocket): Promise<void> {
    if (socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
      socket.once('connect', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
      socket.once(event, (data: T) => { clearTimeout(t); resolve(data); });
    });
  }

  it('bid:received is emitted to the trip room when a driver submits a bid', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    // Client connects and joins the trip room
    const clientSocket = connectSocket(clientToken);
    await waitForConnect(clientSocket);

    const tripId = await bookTrip();
    clientSocket.emit('join:trip', tripId);

    // Listen for event before the bid is submitted
    const eventPromise = waitForEvent<any>(clientSocket, 'bid:received');

    await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3500, etaMinutes: 9 });

    const event = await eventPromise;
    expect(event.driverId).toBe(driver1Id);
    expect(event.amountXaf).toBe(3500);
    expect(event.etaMinutes).toBe(9);
    expect(event.bidId).toBeDefined();
  });

  it('bid:accepted is emitted when the client accepts a bid', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const driverSocket = connectSocket(driver1Token);
    await waitForConnect(driverSocket);

    const tripId = await bookTrip();
    driverSocket.emit('join:trip', tripId);

    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3500, etaMinutes: 9 });
    expect(bidRes.status).toBe(201);
    const bidId = bidRes.body.id;

    const eventPromise = waitForEvent<any>(driverSocket, 'bid:accepted');

    await acceptBid(tripId, bidId);

    const event = await eventPromise;
    expect(event.tripId).toBe(tripId);
    expect(event.driverId).toBe(driver1Id);
    expect(event.finalFareXaf).toBe(3500);

    // Clean up
    await completeTrip(tripId);
  });

  it('trip:status_changed is emitted on every status update', async () => {
    const redis = getRedis();
    await redis.del(`driver:${driver1Id}:active_trip`);

    const clientSocket = connectSocket(clientToken);
    await waitForConnect(clientSocket);

    const tripId = await bookTrip();
    clientSocket.emit('join:trip', tripId);

    const bidRes = await request(app.server)
      .post(`/trips/${tripId}/bid`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ amountXaf: 3500, etaMinutes: 9 });
    await acceptBid(tripId, bidRes.body.id);

    // Listen then fire the status update
    const eventPromise = waitForEvent<any>(clientSocket, 'trip:status_changed');

    await request(app.server)
      .patch(`/trips/${tripId}/status`)
      .set('Authorization', `Bearer ${driver1Token}`)
      .send({ status: 'driver_en_route' });

    const event = await eventPromise;
    expect(event.tripId).toBe(tripId);
    expect(event.newStatus).toBe('driver_en_route');
    expect(event.previousStatus).toBe('bid_accepted');

    // Clean up
    await completeTrip(tripId);
  });
});
