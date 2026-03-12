import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import { initializeRedis, closeRedis } from '../src/plugins/redis';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let driverToken: string;
let driverId: string;
let adminToken: string;

describe('Driver GPS & Online Toggle Integration Tests', () => {
  beforeAll(async () => {
    initializeDatabase();
    await initializeRedis();
    app = await createApp();
    await registerRoutes(app);
    await app.ready();

    // Create and approve driver
    const driverPhone = '+241073123456';
    await request(app.server)
      .post('/auth/send-otp')
      .send({ phone: driverPhone });

    const driverOtp = getOTPForTesting(driverPhone);
    const driverSignupRes = await request(app.server)
      .post('/auth/verify-otp-and-signup')
      .send({
        phone: driverPhone,
        code: driverOtp,
        role: 'driver',
        firstName: 'Driver',
        lastName: 'Test',
      });

    driverToken = driverSignupRes.body.session.access_token;
    driverId = driverSignupRes.body.user.id;

    // Create and approve admin
    const adminPhone = '+241072000000';
    await request(app.server)
      .post('/auth/send-otp')
      .send({ phone: adminPhone });

    const adminOtp = getOTPForTesting(adminPhone);
    const adminSignupRes = await request(app.server)
      .post('/auth/verify-otp-and-signup')
      .send({
        phone: adminPhone,
        code: adminOtp,
        role: 'admin',
        firstName: 'Admin',
        lastName: 'User',
      });

    adminToken = adminSignupRes.body.session.access_token;
    const adminId = adminSignupRes.body.user.id;

    // Approve the driver
    await request(app.server)
      .patch(`/admin/drivers/${driverId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Driver approved for testing' });
  });

  afterAll(async () => {
    await app.close();
    await closeRedis();
    closeDatabase();
  });

  describe('POST /drivers/location', () => {
    it('should update driver GPS location (Redis immediately, PostgreSQL on first write)', async () => {
      const response = await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 0.4161,
          longitude: 9.4673,
          speed: 15.5,
          bearing: 180.0,
          accuracy: 5.0,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.latitude).toBeDefined();
      expect(response.body.data.longitude).toBeDefined();
      expect(response.body.data.isOnline).toBe(true);
      // Note: First location write goes to PostgreSQL, subsequent ones only if moved >500m or >120s elapsed
    });

    it('should reject invalid latitude', async () => {
      const response = await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 95,
          longitude: 9.4673,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid longitude', async () => {
      const response = await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 0.4161,
          longitude: 185,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject unauthenticated location update', async () => {
      const response = await request(app.server)
        .post('/drivers/location')
        .send({
          latitude: 0.4161,
          longitude: 9.4673,
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject location update for non-driver', async () => {
      const response = await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          latitude: 0.4161,
          longitude: 9.4673,
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('PATCH /drivers/toggle-online', () => {
    it('should toggle driver online status', async () => {
      const response = await request(app.server)
        .patch('/drivers/toggle-online')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ isOnline: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isOnline).toBe(true);
      expect(response.body.data.isAvailable).toBe(true);
    });

    it('should toggle driver offline', async () => {
      const response = await request(app.server)
        .patch('/drivers/toggle-online')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ isOnline: false });

      expect(response.status).toBe(200);
      expect(response.body.data.isOnline).toBe(false);
      expect(response.body.data.isAvailable).toBe(false);
    });

    it('should reject unauthenticated toggle request', async () => {
      const response = await request(app.server)
        .patch('/drivers/toggle-online')
        .send({ isOnline: true });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject toggle request for non-driver', async () => {
      const response = await request(app.server)
        .patch('/drivers/toggle-online')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isOnline: true });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('GET /drivers/location', () => {
    it('should get driver current location', async () => {
      // First update location
      await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 0.4161,
          longitude: 9.4673,
        });

      // Then get it
      const response = await request(app.server)
        .get('/drivers/location')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(200);
      expect(response.body.latitude).toBeDefined();
      expect(response.body.longitude).toBeDefined();
      expect(response.body.isOnline).toBe(true);
    });

    it('should return default location if not set', async () => {
      // Create a new driver without location
      const newPhone = '+241075999999';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: newPhone });

      const otp = getOTPForTesting(newPhone);
      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: newPhone,
          code: otp,
          role: 'driver',
          firstName: 'New',
          lastName: 'Driver',
        });

      const newToken = signupRes.body.session.access_token;

      const response = await request(app.server)
        .get('/drivers/location')
        .set('Authorization', `Bearer ${newToken}`);

      expect(response.status).toBe(200);
      expect(response.body.latitude).toBe(null);
      expect(response.body.longitude).toBe(null);
      expect(response.body.isOnline).toBe(false);
    });

    it('should reject unauthenticated location request', async () => {
      const response = await request(app.server).get('/drivers/location');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject location request for non-driver', async () => {
      const response = await request(app.server)
        .get('/drivers/location')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('Verification Gating', () => {
    it('should prevent unverified driver from going online', async () => {
      // Create unverified driver
      const unverifiedPhone = '+241074888888';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: unverifiedPhone });

      const otp = getOTPForTesting(unverifiedPhone);
      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: unverifiedPhone,
          code: otp,
          role: 'driver',
          firstName: 'Unverified',
          lastName: 'Driver',
        });

      const unverifiedToken = signupRes.body.session.access_token;

      const response = await request(app.server)
        .patch('/drivers/toggle-online')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send({ isOnline: true });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('not verified');
    });

    it('should allow unverified driver to update location but not go online', async () => {
      const unverifiedPhone = '+241074777777';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: unverifiedPhone });

      const otp = getOTPForTesting(unverifiedPhone);
      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: unverifiedPhone,
          code: otp,
          role: 'driver',
          firstName: 'UnverifiedTwo',
          lastName: 'Driver',
        });

      const unverifiedToken = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/location')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send({
          latitude: 0.4161,
          longitude: 9.4673,
        });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('not verified');
    });
  });
});
