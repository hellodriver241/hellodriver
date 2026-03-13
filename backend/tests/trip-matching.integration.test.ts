import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import { initializeRedis, closeRedis, getRedis } from '../src/plugins/redis';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let clientToken: string;
let clientId: string;
let driverToken: string;
let driverId: string;
let adminToken: string;
let tripId: string;
let bidId: string;

describe('Trip Matching Integration Tests', () => {
  beforeAll(async () => {
    initializeDatabase();
    await initializeRedis();
    app = await createApp();
    await registerRoutes(app);
    await app.ready();

    // Create and authenticate client
    const clientPhone = '+241071000001';
    await request(app.server)
      .post('/auth/send-otp')
      .send({ phone: clientPhone });

    const clientOtp = getOTPForTesting(clientPhone);
    const clientRes = await request(app.server)
      .post('/auth/verify-otp-and-signup')
      .send({
        phone: clientPhone,
        code: clientOtp,
        role: 'client',
        firstName: 'Client',
        lastName: 'Test',
      });

    clientToken = clientRes.body.session.access_token;
    clientId = clientRes.body.user.id;

    // Create and authenticate driver
    const driverPhone = '+241073000001';
    await request(app.server)
      .post('/auth/send-otp')
      .send({ phone: driverPhone });

    const driverOtp = getOTPForTesting(driverPhone);
    const driverRes = await request(app.server)
      .post('/auth/verify-otp-and-signup')
      .send({
        phone: driverPhone,
        code: driverOtp,
        role: 'driver',
        firstName: 'Driver',
        lastName: 'Test',
      });

    driverToken = driverRes.body.session.access_token;
    driverId = driverRes.body.user.id;

    // Clear any stale Redis keys from previous test runs
    const redis = getRedis();
    await redis.del(`driver:${driverId}:active_trip`);

    // Create and authenticate admin
    const adminPhone = '+241072000001';
    await request(app.server)
      .post('/auth/send-otp')
      .send({ phone: adminPhone });

    const adminOtp = getOTPForTesting(adminPhone);
    const adminRes = await request(app.server)
      .post('/auth/verify-otp-and-signup')
      .send({
        phone: adminPhone,
        code: adminOtp,
        role: 'admin',
        firstName: 'Admin',
        lastName: 'User',
      });

    adminToken = adminRes.body.session.access_token;

    // Complete driver profile and approve
    await request(app.server)
      .post('/drivers/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        dateOfBirth: '1990-01-15',
        vehicleBrand: 'Toyota',
        vehicleYear: 2020,
        vehicleModel: 'Corolla',
        vehicleRegistration: 'GA-2020-001',
        residentialArea: 'Libreville Centre',
        hasAc: true,
        mobileMoneyAccount: '+24106123456',
      });

    // Upload dummy documents (normally multipart, but simplified for test)
    for (const docType of ['drivers_license', 'id_card', 'vehicle_insurance']) {
      const uploadRes = await request(app.server)
        .post('/drivers/documents/upload')
        .set('Authorization', `Bearer ${driverToken}`)
        .field('documentType', docType)
        .attach('file', Buffer.from('dummy pdf'), 'dummy.pdf');

      const docId = uploadRes.body.id;

      // Approve document
      await request(app.server)
        .post(`/admin/drivers/${driverId}/documents/${docId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
    }

    // Approve driver
    await request(app.server)
      .patch(`/admin/drivers/${driverId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Driver approved for testing' });

    // Driver goes online (requires GPS ping first)
    await request(app.server)
      .post('/drivers/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        latitude: 0.4161,
        longitude: 9.4673,
        speed: 0,
        bearing: 0,
        accuracy: 5,
      });

    await request(app.server)
      .patch('/drivers/toggle-online')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ isOnline: true });
  });

  afterAll(async () => {
    await app.close();
    await closeRedis();
    closeDatabase();
  });

  describe('POST /trips/book', () => {
    it('should book a trip and return available drivers count', async () => {
      const response = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          originAddress: 'Downtown Libreville',
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
          destinationAddress: 'Airport',
        });

      expect(response.status).toBe(201);
      expect(response.body.trip).toBeDefined();
      expect(response.body.trip.status).toBe('pending_bids');
      expect(response.body.trip.clientId).toBe(clientId);
      expect(response.body.availableDriverCount).toBeGreaterThanOrEqual(0);
      expect(response.body.fareEstimateXaf).toBeGreaterThan(0);

      tripId = response.body.trip.id;
    });

    it('should reject booking by non-client', async () => {
      const response = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject invalid coordinates', async () => {
      const response = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 91, // > 90
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /trips/:id/bid', () => {
    it('should submit a bid on the trip', async () => {
      const response = await request(app.server)
        .post(`/trips/${tripId}/bid`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          amountXaf: 3500,
          etaMinutes: 12,
        });

      expect(response.status).toBe(201);
      expect(response.body.driverId).toBe(driverId);
      expect(response.body.status).toBe('pending');
      expect(response.body.amountXaf).toBe(3500);
      expect(response.body.etaMinutes).toBe(12);

      bidId = response.body.id;
    });

    it('should reject duplicate bid from same driver', async () => {
      const response = await request(app.server)
        .post(`/trips/${tripId}/bid`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          amountXaf: 3200,
          etaMinutes: 10,
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should reject bid by non-driver', async () => {
      const response = await request(app.server)
        .post(`/trips/${tripId}/bid`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          amountXaf: 3500,
          etaMinutes: 12,
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject invalid bid amount', async () => {
      // Create another trip first
      const tripRes = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      const trip2Id = tripRes.body.trip.id;

      const response = await request(app.server)
        .post(`/trips/${trip2Id}/bid`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          amountXaf: 100000, // > 50000
          etaMinutes: 12,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /trips/:id/accept-bid', () => {
    it('should reject accept by non-client', async () => {
      // Driver tries to accept their own bid — requireClient middleware blocks this
      const response = await request(app.server)
        .patch(`/trips/${tripId}/accept-bid`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ bidId });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should accept a bid and transition trip to bid_accepted', async () => {
      const response = await request(app.server)
        .patch(`/trips/${tripId}/accept-bid`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ bidId });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('bid_accepted');
      expect(response.body.driverId).toBe(driverId);
      expect(response.body.finalFareXaf).toBe(3500);
    });
  });

  describe('PATCH /trips/:id/status', () => {
    it('should transition trip to driver_en_route', async () => {
      const response = await request(app.server)
        .patch(`/trips/${tripId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'driver_en_route' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('driver_en_route');
    });

    it('should transition trip to driver_arrived', async () => {
      const response = await request(app.server)
        .patch(`/trips/${tripId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'driver_arrived' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('driver_arrived');
    });

    it('should transition trip to in_transit', async () => {
      const response = await request(app.server)
        .patch(`/trips/${tripId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('in_transit');
    });

    it('should transition trip to completed', async () => {
      const response = await request(app.server)
        .patch(`/trips/${tripId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'completed' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(response.body.completedAt).toBeDefined();
    });

    it('should reject invalid state transition', async () => {
      // Create another trip
      const tripRes = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      const trip2Id = tripRes.body.trip.id;

      const response = await request(app.server)
        .patch(`/trips/${trip2Id}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'completed' }); // pending_bids -> completed (invalid)

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should reject status update by wrong role', async () => {
      // Advance a fresh trip to bid_accepted, then have the client attempt a driver-only transition.
      // (pending_bids → driver_en_route is an invalid transition, so we need bid_accepted first
      // to isolate the role check from the transition check.)
      const roleTestTripRes = await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      const roleTestTripId = roleTestTripRes.body.trip.id;

      const roleTestBidRes = await request(app.server)
        .post(`/trips/${roleTestTripId}/bid`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ amountXaf: 3500, etaMinutes: 12 });

      const roleTestBidId = roleTestBidRes.body.id;

      await request(app.server)
        .patch(`/trips/${roleTestTripId}/accept-bid`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ bidId: roleTestBidId });

      // bid_accepted → driver_en_route is a valid transition, but only the assigned driver can do it
      const response = await request(app.server)
        .patch(`/trips/${roleTestTripId}/status`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ status: 'driver_en_route' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /trips/:id', () => {
    it('should return trip details', async () => {
      const response = await request(app.server)
        .get(`/trips/${tripId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      expect(response.body.trip.id).toBe(tripId);
      expect(response.body.trip.status).toBe('completed');
    });

    it('should reject unauthorized access', async () => {
      // Create another user to test unauthorized access
      const otherPhone = '+241074000001';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: otherPhone });

      const otherOtp = getOTPForTesting(otherPhone);
      const otherRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: otherPhone,
          code: otherOtp,
          role: 'client',
          firstName: 'Other',
          lastName: 'User',
        });

      const otherToken = otherRes.body.session.access_token;

      const response = await request(app.server)
        .get(`/trips/${tripId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      // Route returns 404 (not 403) to avoid leaking that the trip exists
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /trips/available', () => {
    it('should list available trips for driver', async () => {
      // Create a new pending trip
      await request(app.server)
        .post('/trips/book')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          originLatitude: 0.4161,
          originLongitude: 9.4673,
          destinationLatitude: 0.4300,
          destinationLongitude: 9.5000,
        });

      const response = await request(app.server)
        .get('/trips/available?latitude=0.4161&longitude=9.4673')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((t: any) => t.status === 'pending_bids')).toBe(
        true
      );
    });

    it('should reject non-driver access', async () => {
      const response = await request(app.server)
        .get('/trips/available?latitude=0.4161&longitude=9.4673')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject missing coordinates', async () => {
      const response = await request(app.server)
        .get('/trips/available')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(400);
    });
  });
});
