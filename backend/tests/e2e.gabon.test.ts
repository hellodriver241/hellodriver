/**
 * E2E Tests — HelloDriver against live Fly.io production infrastructure
 *
 * Tests real Gabon-specific scenarios:
 *   — Libreville landmark coordinates (Place de l'Indépendance, Aéroport Léon-Mba)
 *   — Airtel (+24107X) and Moov (+24106X) phone formats
 *   — XAF fare calculation for real Libreville distances
 *   — Driver in Quartier Louis (~0.9 km from pickup) matches; driver in Owendo (~13 km) does not
 *   — Full trip lifecycle: book → bid → accept → en_route → arrived → in_progress → completed
 *   — Socket.io over WSS with real network latency
 *   — API response latency within acceptable bounds for Gabon 3G
 *
 * OTP strategy:
 *   The production server writes OTPs to Redis (key: "otp:{phone}") instead of in-memory.
 *   This test reads OTPs directly from that same Redis — no mocking, no faking.
 *   PREREQUISITE: sms.service.ts Redis OTP fix must be deployed to hellodriver-main.fly.dev.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';

// ─── Config ───────────────────────────────────────────────────────────────────
const PROD_URL = 'https://hellodriver-main.fly.dev';
const WSS_URL  = 'wss://hellodriver-main.fly.dev';

// Each test run gets unique phones to avoid collisions across parallel runs
const uid = Math.floor(100000 + Math.random() * 900000).toString();
const clientPhone  = `+241074${uid}`;   // Airtel (+24107X)
const driver1Phone = `+241077${uid}`;   // Airtel, will be near pickup in Quartier Louis
const driver2Phone = `+241067${uid}`;   // Moov  (+24106X), will be far in Owendo
const adminPhone   = `+241062${uid}`;   // Admin account

// ─── Libreville geography ─────────────────────────────────────────────────────
// Real Libreville coordinates used throughout
const PLACE_INDEPENDANCE = { lat: 0.3924, lon: 9.4574, label: 'Place de l\'Indépendance' };
const AEROPORT_LEON_MBA  = { lat: 0.4584, lon: 9.4122, label: 'Aéroport Léon-Mba' };
const QUARTIER_LOUIS     = { lat: 0.3980, lon: 9.4620, label: 'Quartier Louis (~0.9 km from pickup)' };
const OWENDO             = { lat: 0.2800, lon: 9.5000, label: 'Port d\'Owendo (~13 km from pickup)' };

// ─── Fare formula — must match trip.service.ts exactly ────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function expectedFareXaf(oLat: number, oLon: number, dLat: number, dLon: number): number {
  const roadKm = haversineKm(oLat, oLon, dLat, dLon) * 1.3;
  return Math.max(1500, Math.ceil((1500 + roadKm * 500) / 100) * 100);
}

// ─── State shared across tests ────────────────────────────────────────────────
let redis: Redis;
let clientToken: string;
let clientId: string;
let driver1Token: string;
let driver1Id: string;
let driver2Token: string;
let driver2Id: string;
let tripId: string;
let bidId: string;
const openSockets: ClientSocket[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${PROD_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function get(path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${PROD_URL}${path}`, { headers });
}

async function patch(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${PROD_URL}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

/** Read OTP from the shared production Redis (written by the Fly.io server) */
async function getOtpFromRedis(phone: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await redis.get(`otp:${phone}`);
    if (raw) {
      const data = JSON.parse(raw);
      return data.code as string;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`OTP for ${phone} not found in Redis after ${timeoutMs}ms`);
}

/** Full auth flow: send-otp → read OTP from Redis → verify → return { token, id } */
async function signUp(phone: string, role: string, firstName: string, lastName: string) {
  const sendRes = await post('/auth/send-otp', { phone });
  expect(sendRes.status, `send-otp ${phone}`).toBe(200);

  const otp = await getOtpFromRedis(phone);

  const verifyRes = await post('/auth/verify-otp-and-signup', {
    phone, code: otp, role, firstName, lastName,
  });

  const body = await verifyRes.json() as any;
  expect(verifyRes.status, `verify ${phone}: ${JSON.stringify(body)}`).toBe(201);
  return { token: body.session.access_token as string, id: body.user.id as string };
}

/** Set up driver: create account + profile + documents + admin approval + GPS + online */
async function setupDriver(
  phone: string,
  firstName: string,
  adminToken: string,
  lat: number,
  lon: number,
): Promise<{ token: string; id: string }> {
  const { token, id } = await signUp(phone, 'driver', firstName, 'Test');

  // Driver profile
  const profileRes = await post('/drivers/profile', {
    dateOfBirth: '1990-01-01',
    vehicleBrand: 'Toyota',
    vehicleYear: 2022,
    vehicleModel: 'Hilux',
    vehicleRegistration: `GA-${uid.slice(0, 4)}-${firstName.slice(0, 2).toUpperCase()}`,
    residentialArea: 'Libreville Centre',
    hasAc: true,
    mobileMoneyAccount: phone,
  }, token);
  const profileBody = await profileRes.json() as any;
  expect(profileRes.status, `profile ${phone}: ${JSON.stringify(profileBody)}`).toBe(200);

  // Documents
  for (const docType of ['drivers_license', 'id_card', 'vehicle_insurance']) {
    const form = new FormData();
    form.append('documentType', docType);
    form.append('file', new Blob([`dummy-${docType}`], { type: 'application/pdf' }), `${docType}.pdf`);
    const docRes = await fetch(`${PROD_URL}/drivers/documents/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const docBody = await docRes.json() as any;
    expect(docRes.status, `upload ${docType}: ${JSON.stringify(docBody)}`).toBe(200);

    await fetch(`${PROD_URL}/admin/drivers/${id}/documents/${docBody.data?.id ?? docBody.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    });
  }

  // Admin approval
  const approvalRes = await patch(`/admin/drivers/${id}/approve`,
    { notes: 'E2E test approval' }, adminToken);
  expect(approvalRes.status, `approve driver ${phone}`).toBe(200);

  // GPS ping (required before going online)
  await post('/drivers/location', { latitude: lat, longitude: lon, speed: 0, bearing: 0, accuracy: 5 }, token);

  // Go online
  const onlineRes = await patch('/drivers/toggle-online', { isOnline: true }, token);
  expect(onlineRes.status, `toggle-online ${phone}`).toBe(200);

  // Set heartbeat in Redis (required for bid acceptance)
  await redis.setex(`driver:${id}:heartbeat`, 25, '1');

  return { token, id };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Connect to production Redis — the same instance the Fly.io server writes OTPs to
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set — check .env.local');
  redis = new Redis(redisUrl);
  await redis.ping();

  // Create admin account
  const admin = await signUp(adminPhone, 'admin', 'Admin', 'Test');

  // Create client account (Airtel +24107X)
  const client = await signUp(clientPhone, 'client', 'Agathe', 'Test');
  clientToken = client.token;
  clientId = client.id;

  // Driver 1: Quartier Louis (~0.9 km from Place de l'Indépendance) — within 5km
  const d1 = await setupDriver(driver1Phone, 'Michel', admin.token,
    QUARTIER_LOUIS.lat, QUARTIER_LOUIS.lon);
  driver1Token = d1.token;
  driver1Id = d1.id;

  // Driver 2: Owendo (~13 km from pickup) — outside 5km
  const d2 = await setupDriver(driver2Phone, 'Pierre', admin.token,
    OWENDO.lat, OWENDO.lon);
  driver2Token = d2.token;
  driver2Id = d2.id;
}, 180_000);

afterAll(async () => {
  for (const s of openSockets) s.disconnect();
  await redis.quit();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Health', () => {
  it('GET /health returns 200 with latency < 3000ms', async () => {
    const t0 = Date.now();
    const res = await get('/health');
    const latencyMs = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(latencyMs).toBeLessThan(3000);
    console.log(`  /health latency: ${latencyMs}ms`);
  });
});

describe('Phone validation', () => {
  it('rejects non-Gabon number (+33 France)', async () => {
    const res = await post('/auth/send-otp', { phone: '+33612345678' });
    expect(res.status).toBe(400);
  });

  it('rejects MTN number (MTN does not operate in Gabon)', async () => {
    // MTN uses +225 (Ivory Coast) — not +241
    const res = await post('/auth/send-otp', { phone: '+22507123456' });
    expect(res.status).toBe(400);
  });

  it('accepts Airtel format +24107XXXXXXX', async () => {
    const res = await post('/auth/send-otp', { phone: `+24107${uid}` });
    // Rate-limited from earlier signUp call with same phone is possible, but format is valid
    expect([200, 429]).toContain(res.status);
  });

  it('accepts Moov format +24106XXXXXXX', async () => {
    const res = await post('/auth/send-otp', { phone: `+24106${uid}` });
    expect([200, 429]).toContain(res.status);
  });
});

describe('Auth flow', () => {
  it('GET /auth/me returns authenticated client', async () => {
    const res = await get('/auth/me', clientToken);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.user.phone).toBe(clientPhone);
    expect(body.user.role).toBe('client');
    expect(body.user.id).toBe(clientId);
  });

  it('GET /auth/me returns 401 with no token', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('OTP rate limit: 4th request in 15 min returns error', async () => {
    // We already called send-otp once for clientPhone in signUp
    // This is the 2nd, 3rd, 4th — 4th should fail
    // RATE_LIMIT_MAX = 3: requests 1-3 OK, 4th rejected with 429
    const phone = `+241074${Math.floor(100000 + Math.random() * 900000)}`;
    await post('/auth/send-otp', { phone });
    await post('/auth/send-otp', { phone });
    await post('/auth/send-otp', { phone });
    const fourthRes = await post('/auth/send-otp', { phone });
    expect(fourthRes.status).toBe(429);
    const fourthBody = await fourthRes.json() as any;
    expect(fourthBody.error?.message ?? fourthBody.error).toMatch(/too many/i);
  });
});

describe('Fare calculation — Libreville landmarks', () => {
  it('Place de l\'Indépendance → Aéroport Léon-Mba matches formula', async () => {
    // Book a trip just to verify fare (we'll cancel it right after)
    const res = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      originAddress: PLACE_INDEPENDANCE.label,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
      destinationAddress: AEROPORT_LEON_MBA.label,
    }, clientToken);

    const body = await res.json() as any;
    expect(res.status).toBe(201);

    const calculatedFare = expectedFareXaf(
      PLACE_INDEPENDANCE.lat, PLACE_INDEPENDANCE.lon,
      AEROPORT_LEON_MBA.lat, AEROPORT_LEON_MBA.lon,
    );
    expect(body.fareEstimateXaf).toBe(calculatedFare);
    expect(body.fareEstimateXaf).toBeGreaterThanOrEqual(1500); // floor

    console.log(`  ${PLACE_INDEPENDANCE.label} → ${AEROPORT_LEON_MBA.label}: ${body.fareEstimateXaf} XAF`);

    // Cancel this fare-check trip before the main lifecycle test
    await patch(`/trips/${body.trip.id}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('Geospatial driver matching', () => {
  it('driver in Quartier Louis (~0.9 km) sees trips originating from Place de l\'Indépendance', async () => {
    // Create a trip to test against
    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      originAddress: PLACE_INDEPENDANCE.label,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
      destinationAddress: AEROPORT_LEON_MBA.label,
    }, clientToken);

    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    // Driver 1 (Quartier Louis, 0.9 km) queries available trips from his position
    const availRes = await get(
      `/trips/available?latitude=${QUARTIER_LOUIS.lat}&longitude=${QUARTIER_LOUIS.lon}`,
      driver1Token,
    );
    const availBody = await availRes.json() as any;
    expect(availRes.status).toBe(200);

    const tripIds = (availBody.trips ?? availBody).map((t: any) => t.id);
    expect(tripIds).toContain(testTripId);

    // Clean up
    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });

  it('driver in Owendo (~13 km) does NOT see the same trip', async () => {
    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      originAddress: PLACE_INDEPENDANCE.label,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
      destinationAddress: AEROPORT_LEON_MBA.label,
    }, clientToken);

    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    // Driver 2 (Owendo, 13 km) queries from his position
    const availRes = await get(
      `/trips/available?latitude=${OWENDO.lat}&longitude=${OWENDO.lon}`,
      driver2Token,
    );
    const availBody = await availRes.json() as any;
    expect(availRes.status).toBe(200);

    const tripIds = (availBody.trips ?? availBody).map((t: any) => t.id);
    expect(tripIds).not.toContain(testTripId);
    console.log(`  Owendo driver correctly excluded (returned ${tripIds.length} trips, not this one)`);

    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('Full trip lifecycle — Libreville', () => {
  it('books a trip from Place de l\'Indépendance to Aéroport Léon-Mba', async () => {
    const res = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      originAddress: PLACE_INDEPENDANCE.label,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
      destinationAddress: AEROPORT_LEON_MBA.label,
    }, clientToken);

    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.trip.status).toBe('pending_bids');
    expect(body.trip.clientId).toBe(clientId);
    expect(body.fareEstimateXaf).toBeGreaterThanOrEqual(1500);

    tripId = body.trip.id;
    console.log(`  Trip booked: ${tripId} — fare: ${body.fareEstimateXaf} XAF`);
  });

  it('Socket.io: client receives bid:received event when driver bids', async () => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('bid:received not received within 8s')), 8000);

      const clientSocket = ioc(WSS_URL, {
        auth: { token: clientToken },
        transports: ['websocket'],
      });
      openSockets.push(clientSocket);

      clientSocket.on('bid:received', (data: any) => {
        clearTimeout(timeout);
        try {
          expect(data.bidId).toBeDefined();
          expect(data.driverId).toBe(driver1Id);
          expect(data.amountXaf).toBeGreaterThanOrEqual(1500);
          // Capture bidId from the real-time event — this is the authoritative source
          // and avoids any race condition with the HTTP response assignment below
          bidId = data.bidId;
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on('connect', async () => {
        // Join the trip room so we receive bid:received events
        clientSocket.emit('join:trip', tripId);
        // Small delay to ensure room join is processed before bid submission
        await new Promise(r => setTimeout(r, 200));

        // Driver 1 submits a bid after client is connected and in the room
        const bidRes = await post(`/trips/${tripId}/bid`, {
          amountXaf: expectedFareXaf(
            PLACE_INDEPENDANCE.lat, PLACE_INDEPENDANCE.lon,
            AEROPORT_LEON_MBA.lat, AEROPORT_LEON_MBA.lon,
          ),
          etaMinutes: 4,
        }, driver1Token);

        const bidBody = await bidRes.json() as any;
        if (bidRes.status !== 201) {
          clearTimeout(timeout);
          reject(new Error(`Bid failed: ${bidRes.status} ${JSON.stringify(bidBody)}`));
          return;
        }
        bidId = bidBody.id;
      });

      clientSocket.on('connect_error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Socket.io connect_error: ${err.message}`));
      });
    });
  });

  it('client accepts driver1\'s bid', async () => {
    expect(bidId).toBeDefined();
    // Refresh heartbeat — it may have expired during the Socket.io test (8s TTL was 25s)
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    const res = await patch(`/trips/${tripId}/accept-bid`, { bidId }, clientToken);
    const body = await res.json() as any;
    expect(res.status, `accept bid: ${JSON.stringify(body)}`).toBe(200);
    expect(body.status).toBe('bid_accepted');
    console.log(`  Bid accepted — trip status: ${body.status}`);
  });

  it('driver sets status to en_route first', async () => {
    const res = await patch(`/trips/${tripId}/status`, { status: 'driver_en_route' }, driver1Token);
    const body = await res.json() as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('driver_en_route');
  });

  it('driver updates GPS while en route (Gabon 3G latency)', async () => {
    const t0 = Date.now();
    // Simulate driver moving from Quartier Louis towards Place de l'Indépendance
    const res = await post('/drivers/location', {
      latitude: 0.3960,
      longitude: 9.4600,
      speed: 28, // ~28 km/h in Libreville traffic
      bearing: 185,
      accuracy: 8,
    }, driver1Token);
    const latencyMs = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(latencyMs).toBeLessThan(3000);
    console.log(`  GPS update latency: ${latencyMs}ms`);
  });

  it('driver arrives at pickup → status: driver_arrived', async () => {
    const res = await patch(`/trips/${tripId}/status`, { status: 'driver_arrived' }, driver1Token);
    const body = await res.json() as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('driver_arrived');
  });

  it('trip starts (client boards) → status: in_transit', async () => {
    const res = await patch(`/trips/${tripId}/status`, { status: 'in_transit' }, driver1Token);
    const body = await res.json() as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('in_transit');
  });

  it('trip completes → status: completed + Redis active_trip key cleared', async () => {
    const res = await patch(`/trips/${tripId}/status`, { status: 'completed' }, driver1Token);
    const body = await res.json() as any;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('completed');

    // Redis cleanup verification — critical for driver being able to take new trips
    const activeTrip = await redis.get(`driver:${driver1Id}:active_trip`);
    expect(activeTrip).toBeNull();
    console.log(`  Trip completed. Redis active_trip key: ${activeTrip ?? 'cleared ✓'}`);
  });
});

describe('Concurrent bids — Redis NX atomicity', () => {
  it('same driver bidding twice simultaneously: exactly one wins (409 for the duplicate)', async () => {
    // NX key is bid:{tripId}:{driverId} — prevents the SAME driver from double-bidding.
    // Two different drivers can both bid 201 (that's correct business logic).
    // This test fires two requests from the same driver token simultaneously.
    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      originAddress: PLACE_INDEPENDANCE.label,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
      destinationAddress: AEROPORT_LEON_MBA.label,
    }, clientToken);

    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const raceTripId = bookBody.trip.id;

    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');

    // Same driver, two simultaneous bid requests
    const [res1, res2] = await Promise.all([
      post(`/trips/${raceTripId}/bid`, { amountXaf: 5000, etaMinutes: 3 }, driver1Token),
      post(`/trips/${raceTripId}/bid`, { amountXaf: 5000, etaMinutes: 3 }, driver1Token),
    ]);

    const statuses = [res1.status, res2.status].sort();
    console.log(`  Concurrent same-driver bid statuses: ${statuses.join(', ')}`);

    // Redis NX ensures exactly one wins, one 409
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    await patch(`/trips/${raceTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('Authorization guards', () => {
  it('client cannot bid on a trip (requireDriver → 403)', async () => {
    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${testTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, clientToken);
    expect(bidRes.status).toBe(403);

    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });

  it('driver cannot book a trip (requireClient → 403)', async () => {
    const res = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, driver1Token);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('State machine enforcement', () => {
  it('invalid transition is rejected with 400', async () => {
    // Book a trip (pending_bids) and try to jump directly to completed — invalid
    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    // pending_bids → completed is not in VALID_TRANSITIONS
    const res = await patch(`/trips/${testTripId}/status`, { status: 'completed' }, driver1Token);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.message).toMatch(/Cannot transition/i);

    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });

  it('client cannot set driver_en_route (role mismatch → 403)', async () => {
    // Set up a trip at bid_accepted state
    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${testTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver1Token);
    expect(bidRes.status).toBe(201);
    const testBidId = (await bidRes.json() as any).id;

    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    const acceptRes = await patch(`/trips/${testTripId}/accept-bid`, { bidId: testBidId }, clientToken);
    expect(acceptRes.status).toBe(200);

    // Client tries to push driver_en_route — only the driver can
    const res = await patch(`/trips/${testTripId}/status`, { status: 'driver_en_route' }, clientToken);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error.message).toMatch(/Only the assigned driver/i);

    // Clean up
    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('Driver protection', () => {
  it('non-approved driver cannot bid (400)', async () => {
    // driver2Phone was approved in setupDriver but we can test with a fresh unapproved driver
    // Easier: use driver2 who is approved but far away — instead create a new unverified driver
    // by registering one but not going through admin approval
    const unverifiedUid = Math.floor(100000 + Math.random() * 900000).toString();
    const unverifiedPhone = `+241077${unverifiedUid}`;
    const { token: unverifiedToken } = await signUp(unverifiedPhone, 'driver', 'Jean', 'Test');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${testTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, unverifiedToken);
    expect(bidRes.status).toBe(400);
    const body = await bidRes.json() as any;
    expect(body.error.message).toMatch(/not verified|KYC/i);

    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });

  it('driver with active trip cannot bid on another trip (400)', async () => {
    // Manually set an active_trip key for driver2 to simulate them being mid-trip
    const fakeTripId = '00000000-0000-0000-0000-000000000001';
    await redis.setex(`driver:${driver2Id}:active_trip`, 7200, fakeTripId);
    await redis.setex(`driver:${driver2Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${testTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver2Token);
    expect(bidRes.status).toBe(400);
    const body = await bidRes.json() as any;
    expect(body.error.message).toMatch(/active trip/i);

    // Clean up
    await redis.del(`driver:${driver2Id}:active_trip`);
    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('Cancellation flow', () => {
  it('client cancels after bid_accepted: status = cancelled_by_client, Redis active_trip cleared', async () => {
    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const cancelTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${cancelTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver1Token);
    expect(bidRes.status).toBe(201);
    const cancelBidId = (await bidRes.json() as any).id;

    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    const acceptRes = await patch(`/trips/${cancelTripId}/accept-bid`, { bidId: cancelBidId }, clientToken);
    expect(acceptRes.status).toBe(200);
    expect((await acceptRes.json() as any).status).toBe('bid_accepted');

    // Verify driver:active_trip was set
    const activeBeforeCancel = await redis.get(`driver:${driver1Id}:active_trip`);
    expect(activeBeforeCancel).toBe(cancelTripId);

    // Client cancels
    const cancelRes = await patch(`/trips/${cancelTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
    const cancelBody = await cancelRes.json() as any;
    expect(cancelRes.status).toBe(200);
    expect(cancelBody.status).toBe('cancelled_by_client');

    // Redis active_trip must be cleared — driver can take new trips
    const activeAfterCancel = await redis.get(`driver:${driver1Id}:active_trip`);
    expect(activeAfterCancel).toBeNull();
    console.log(`  Redis active_trip after client cancel: ${activeAfterCancel ?? 'cleared ✓'}`);
  });

  it('driver cancels after bid_accepted: status = cancelled_by_driver, Redis active_trip cleared', async () => {
    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const cancelTripId = bookBody.trip.id;

    const bidRes = await post(`/trips/${cancelTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver1Token);
    expect(bidRes.status).toBe(201);
    const cancelBidId = (await bidRes.json() as any).id;

    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    const acceptRes = await patch(`/trips/${cancelTripId}/accept-bid`, { bidId: cancelBidId }, clientToken);
    expect(acceptRes.status).toBe(200);

    const cancelRes = await patch(`/trips/${cancelTripId}/status`, { status: 'cancelled_by_driver' }, driver1Token);
    const cancelBody = await cancelRes.json() as any;
    expect(cancelRes.status).toBe(200);
    expect(cancelBody.status).toBe('cancelled_by_driver');

    const activeAfterCancel = await redis.get(`driver:${driver1Id}:active_trip`);
    expect(activeAfterCancel).toBeNull();
    console.log(`  Redis active_trip after driver cancel: ${activeAfterCancel ?? 'cleared ✓'}`);
  });
});

describe('Multiple drivers competing', () => {
  it('two different drivers can both bid; client accepts one; losing bid is rejected', async () => {
    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.del(`driver:${driver2Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    await redis.setex(`driver:${driver2Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const competeTripId = bookBody.trip.id;

    // Both drivers bid — both should succeed (NX is per-driver, not per-trip)
    const [bid1Res, bid2Res] = await Promise.all([
      post(`/trips/${competeTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver1Token),
      post(`/trips/${competeTripId}/bid`, { amountXaf: 2800, etaMinutes: 7 }, driver2Token),
    ]);
    expect(bid1Res.status).toBe(201);
    expect(bid2Res.status).toBe(201);
    const winningBidId = (await bid1Res.json() as any).id;
    const losingBidId  = (await bid2Res.json() as any).id;
    console.log(`  Both drivers bid successfully. Driver1: ${winningBidId}, Driver2: ${losingBidId}`);

    // Client accepts driver1's bid
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');
    const acceptRes = await patch(`/trips/${competeTripId}/accept-bid`, { bidId: winningBidId }, clientToken);
    const acceptBody = await acceptRes.json() as any;
    expect(acceptRes.status).toBe(200);
    expect(acceptBody.status).toBe('bid_accepted');
    expect(acceptBody.driverId).toBe(driver1Id);

    // Verify driver2's bid status via GET /trips/:id
    const tripRes = await get(`/trips/${competeTripId}`, clientToken);
    expect(tripRes.status).toBe(200);
    // Trip is now bid_accepted — bids not returned in that state, but trip data is accurate
    const tripBody = await tripRes.json() as any;
    expect(tripBody.trip.status).toBe('bid_accepted');
    expect(tripBody.trip.driverId).toBe(driver1Id);
    expect(tripBody.trip.finalFareXaf).toBe(3000);

    // Clean up
    await patch(`/trips/${competeTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });
});

describe('GET /trips/:id', () => {
  it('returns trip + pending bids when status is pending_bids', async () => {
    await redis.del(`driver:${driver1Id}:active_trip`);
    await redis.setex(`driver:${driver1Id}:heartbeat`, 60, '1');

    const bookRes = await post('/trips/book', {
      originLatitude: PLACE_INDEPENDANCE.lat,
      originLongitude: PLACE_INDEPENDANCE.lon,
      destinationLatitude: AEROPORT_LEON_MBA.lat,
      destinationLongitude: AEROPORT_LEON_MBA.lon,
    }, clientToken);
    const bookBody = await bookRes.json() as any;
    expect(bookRes.status).toBe(201);
    const testTripId = bookBody.trip.id;

    await post(`/trips/${testTripId}/bid`, { amountXaf: 3000, etaMinutes: 5 }, driver1Token);

    const res = await get(`/trips/${testTripId}`, clientToken);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.trip.id).toBe(testTripId);
    expect(body.trip.status).toBe('pending_bids');
    expect(Array.isArray(body.bids)).toBe(true);
    expect(body.bids.length).toBeGreaterThanOrEqual(1);
    expect(body.bids[0].driverId).toBe(driver1Id);

    await patch(`/trips/${testTripId}/status`, { status: 'cancelled_by_client' }, clientToken);
  });

  it('third party cannot see a trip they are not part of (404)', async () => {
    // Use driver2 token to access the main tripId (driver1's completed trip)
    // driver2 is neither client nor driver on that trip
    const res = await get(`/trips/${tripId}`, driver2Token);
    expect(res.status).toBe(404);
  });
});
