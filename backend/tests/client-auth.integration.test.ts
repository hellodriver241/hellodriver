import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

describe('Client Authentication Integration Tests', () => {
  beforeAll(async () => {
    initializeDatabase();
    app = await createApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDatabase();
  });

  describe('POST /auth/send-otp (Client)', () => {
    it('should send OTP to valid Gabon Airtel phone', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+241072654321' });

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('+241072654321');
      expect(response.body.message).toContain('OTP');
    });

    it('should send OTP to valid Gabon Moov phone', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+241062654321' });

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('+241062654321');
    });

    it('should reject non-Gabon phone numbers', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+33123456789' }); // France number

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject phone without + prefix', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '241072654321' });

      expect(response.status).toBe(400);
    });

    it('should reject phone with invalid operator prefix', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+241051234567' }); // 05 is not valid in Gabon

      expect(response.status).toBe(400);
    });

    it('should reject empty phone', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/verify-otp-and-signup (Client)', () => {
    it('should successfully signup client with valid OTP', async () => {
      const phone = '+241062111111';

      // Send OTP
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      // Get OTP for testing
      const otp = getOTPForTesting(phone);

      // Verify and signup as client
      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'jean@example.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('client');
      expect(response.body.user.phone).toBe(phone);
      expect(response.body.user.firstName).toBe('Jean');
      expect(response.body.user.lastName).toBe('Dupont');
      expect(response.body.user.email).toBe('jean@example.com');
      expect(response.body.session.access_token).toBeDefined();
      expect(response.body.session.refresh_token).toBeDefined();
      expect(response.body.session.expires_in).toBe(900); // 15 minutes
    });

    it('should accept French accented names', async () => {
      const phone = '+241071234567';

      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'François',
          lastName: "O'Brien-Müller",
          email: 'francois@example.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.firstName).toBe('François');
      expect(response.body.user.lastName).toBe("O'Brien-Müller");
    });

    it('should reject missing first name', async () => {
      const phone = '+241071234568';

      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          lastName: 'Dupont',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject invalid email format', async () => {
      const phone = '+241072345678';

      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'not-an-email',
        });

      expect(response.status).toBe(400);
    });

    it('should lowercase email on signup', async () => {
      const phone = '+241061234569';

      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'JEAN@EXAMPLE.COM',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe('jean@example.com');
    });

    it('should handle duplicate phone signup (race condition)', async () => {
      const phone = '+241072987654';

      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      // First signup
      const response1 = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Jean',
          lastName: 'Dupont',
        });

      expect(response1.status).toBe(201);

      // Try signup again with same phone
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp2 = getOTPForTesting(phone);

      const response2 = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp2,
          role: 'client',
          firstName: 'Different',
          lastName: 'Name',
        });

      // Should return existing user
      expect(response2.status).toBe(201);
      expect(response2.body.user.id).toBe(response1.body.user.id);
    });
  });

  describe('GET /auth/me (Client)', () => {
    let clientToken: string;
    let clientUserId: string;

    beforeAll(async () => {
      const phone = '+241063333333';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Test',
          lastName: 'Client',
        });

      clientToken = response.body.session.access_token;
      clientUserId = response.body.user.id;
    });

    it('should return authenticated client user profile', async () => {
      const response = await request(app.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('client');
      expect(response.body.profileType).toBe('client');
      expect(response.body.profile).toBeDefined();
    });

    it('should reject request without token', async () => {
      const response = await request(app.server).get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app.server)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /auth/profile (Client)', () => {
    let clientToken: string;
    let clientUserId: string;

    beforeAll(async () => {
      const phone = '+241064444444';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Original',
          lastName: 'Name',
          email: 'original@example.com',
        });

      clientToken = response.body.session.access_token;
      clientUserId = response.body.user.id;
    });

    it('should update client profile name', async () => {
      const response = await request(app.server)
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          firstName: 'Updated',
          lastName: 'Surname',
        });

      expect(response.status).toBe(200);
      expect(response.body.firstName).toBe('Updated');
      expect(response.body.lastName).toBe('Surname');
    });

    it('should update only email without changing name', async () => {
      const response = await request(app.server)
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          email: 'newemail@example.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('newemail@example.com');
    });

    it('should reject update without authentication', async () => {
      const response = await request(app.server)
        .patch('/auth/profile')
        .send({
          firstName: 'Hacker',
        });

      expect(response.status).toBe(401);
    });

    it('should reject invalid name format on update', async () => {
      const response = await request(app.server)
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          firstName: '123',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/refresh (Client)', () => {
    let refreshToken: string;

    beforeAll(async () => {
      const phone = '+241065555555';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client',
          firstName: 'Refresh',
          lastName: 'Token',
        });

      refreshToken = response.body.session.refresh_token;
    });

    it('should issue new access token from refresh token', async () => {
      const response = await request(app.server)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.access_token).toBeDefined();
      expect(response.body.expires_in).toBe(900); // 15 minutes
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app.server)
        .post('/auth/refresh')
        .send({ refresh_token: 'invalid.token.here' });

      expect(response.status).toBe(401);
    });

    it('should reject missing refresh token', async () => {
      const response = await request(app.server)
        .post('/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
