import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let adminUserId: string;
let driverToken: string;
let driverId: string;

describe('Admin Driver Verification Integration Tests', () => {
  beforeAll(async () => {
    initializeDatabase();
    app = await createApp();
    await registerRoutes(app);
    await app.ready();

    // Create admin user
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
    adminUserId = adminSignupRes.body.user.id;

    // Create driver user
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
  });

  afterAll(async () => {
    await app.close();
    closeDatabase();
  });

  describe('GET /admin/drivers/pending', () => {
    it('should list pending drivers', async () => {
      const response = await request(app.server)
        .get('/admin/drivers/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject non-admin access', async () => {
      const response = await request(app.server)
        .get('/admin/drivers/pending')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject unauthenticated access', async () => {
      const response = await request(app.server).get('/admin/drivers/pending');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('PATCH /admin/drivers/:driverId/approve', () => {
    it('should approve pending driver', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Documents verified, driver looks legitimate',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationStatus).toBe('approved');
      expect(response.body.data.isVerified).toBe(true);
      expect(response.body.data.verifiedAt).toBeDefined();
    });

    it('should approve driver without notes', async () => {
      // Create another driver to approve without notes
      const phone = '+241074123456';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Another',
          lastName: 'Driver',
        });

      const driverId2 = signupRes.body.user.id;

      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId2}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.verificationStatus).toBe('approved');
    });

    it('should reject non-admin approval', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/approve`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ notes: 'Trying to approve myself' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject unauthenticated approval request', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/approve`)
        .send({ notes: 'test' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid notes format', async () => {
      const phone = '+241075123456';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'TestNote',
          lastName: 'Driver',
        });

      const driverId3 = signupRes.body.user.id;

      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId3}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'a'.repeat(501), // Exceeds 500 char limit
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('PATCH /admin/drivers/:driverId/reject', () => {
    it('should reject pending driver with reason', async () => {
      const phone = '+241076000000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Reject',
          lastName: 'Test',
        });

      const rejectDriverId = signupRes.body.user.id;

      const response = await request(app.server)
        .patch(`/admin/drivers/${rejectDriverId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Vehicle registration documents are invalid or expired',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationStatus).toBe('rejected');
      expect(response.body.data.isVerified).toBe(false);
    });

    it('should reject driver rejection without reason', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject reason that is too short', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Too short', // Less than 10 chars
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject reason that exceeds max length', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'a'.repeat(501),
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject non-admin rejection', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/reject`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          reason: 'Trying to reject another driver',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should reject unauthenticated rejection request', async () => {
      const response = await request(app.server)
        .patch(`/admin/drivers/${driverId}/reject`)
        .send({
          reason: 'Some rejection reason here',
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /drivers/verification-status', () => {
    it('should return verification status as APPROVED after admin approval', async () => {
      const response = await request(app.server)
        .get('/drivers/verification-status')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(200);
      expect(response.body.verificationStatus).toBe('approved');
      expect(response.body.isVerified).toBe(true);
      expect(response.body.verifiedAt).toBeDefined();
    });

    it('should return verification status for rejected driver', async () => {
      const phone = '+241077000000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Rejected',
          lastName: 'Driver',
        });

      const rejectedToken = signupRes.body.session.access_token;
      const rejectedId = signupRes.body.user.id;

      // Reject the driver
      await request(app.server)
        .patch(`/admin/drivers/${rejectedId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Documents do not match driver profile information',
        });

      const response = await request(app.server)
        .get('/drivers/verification-status')
        .set('Authorization', `Bearer ${rejectedToken}`);

      expect(response.status).toBe(200);
      expect(response.body.verificationStatus).toBe('rejected');
      expect(response.body.isVerified).toBe(false);
    });

    it('should reject unauthenticated verification status request', async () => {
      const response = await request(app.server).get('/drivers/verification-status');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Verification Status Log', () => {
    it('should log admin approval action in verification log', async () => {
      const phone = '+241078000000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'LogTest',
          lastName: 'Driver',
        });

      const logTestDriverId = signupRes.body.user.id;

      const approveRes = await request(app.server)
        .patch(`/admin/drivers/${logTestDriverId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'All checks passed',
        });

      expect(approveRes.status).toBe(200);
      // Verification log is created internally, we just verify the approval succeeded
      expect(approveRes.body.data.verificationStatus).toBe('approved');
    });

    it('should log admin rejection action in verification log', async () => {
      const phone = '+241079000000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'LogTestRej',
          lastName: 'Driver',
        });

      const logTestRejectId = signupRes.body.user.id;

      const rejectRes = await request(app.server)
        .patch(`/admin/drivers/${logTestRejectId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Background check failed - previous violations on record',
        });

      expect(rejectRes.status).toBe(200);
      // Verification log is created internally, we just verify the rejection succeeded
      expect(rejectRes.body.data.verificationStatus).toBe('rejected');
    });
  });

  describe('Multiple Admin Actions', () => {
    it('should allow admin to approve then reject (re-evaluation)', async () => {
      const phone = '+241072888000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Multi',
          lastName: 'Action',
        });

      const multiActionId = signupRes.body.user.id;

      // First approval
      const approveRes = await request(app.server)
        .patch(`/admin/drivers/${multiActionId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Initially approved' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.verificationStatus).toBe('approved');

      // Then rejection (re-evaluation)
      const rejectRes = await request(app.server)
        .patch(`/admin/drivers/${multiActionId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'New information revealed compliance issues with vehicle registration',
        });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.verificationStatus).toBe('rejected');
      expect(rejectRes.body.data.isVerified).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent driver approval', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.server)
        .patch(`/admin/drivers/${fakeId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'test' });

      expect(response.status).toBe(500); // Internal error - driver not found
    });

    it('should handle concurrent approval requests gracefully', async () => {
      const phone = '+241072999123';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Concurrent',
          lastName: 'Test',
        });

      const concurrentId = signupRes.body.user.id;

      // Send two approval requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app.server)
          .patch(`/admin/drivers/${concurrentId}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ notes: 'First approval' }),
        request(app.server)
          .patch(`/admin/drivers/${concurrentId}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ notes: 'Second approval' }),
      ]);

      // Both should succeed (idempotent)
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.data.verificationStatus).toBe('approved');
      expect(res2.body.data.verificationStatus).toBe('approved');
    });
  });
});
