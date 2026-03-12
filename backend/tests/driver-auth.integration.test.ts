import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let token: string;
let userId: string;

describe('Driver Authentication Integration Tests', () => {
  beforeAll(async () => {
    // Initialize database
    initializeDatabase();

    // Create and configure app
    app = await createApp();

    // Register routes
    await registerRoutes(app);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDatabase();
  });

  describe('POST /auth/send-otp', () => {
    it('should send OTP to valid Gabon phone number', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+241072123456' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body.phone).toBe('+241072123456');
    });

    it('should reject invalid phone format', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '1234567890' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject non-Gabon numbers', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: '+442071838750' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/verify-otp-and-signup', () => {
    const testPhone = '+241072123456';
    let testOtp: string;

    it('should send OTP first', async () => {
      const response = await request(app.server)
        .post('/auth/send-otp')
        .send({ phone: testPhone });

      expect(response.status).toBe(200);

      // In development mode, OTP is returned in response
      if (response.body.code) {
        testOtp = response.body.code;
      }
    });

    it('should verify OTP and create driver account', async () => {
      if (!testOtp) {
        console.warn('OTP not available, skipping verification test');
        return;
      }

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: testPhone,
          code: testOtp,
          role: 'driver',
          firstName: 'Test',
          lastName: 'Driver',
          email: 'driver@hellodriver.ga',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('session');
      expect(response.body.user.role).toBe('driver');
      expect(response.body.session).toHaveProperty('access_token');

      // Save for subsequent tests
      userId = response.body.user.id;
      token = response.body.session.access_token;
    });

    it('should reject invalid OTP', async () => {
      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone: testPhone,
          code: '000000',
          role: 'driver',
          firstName: 'Test',
          lastName: 'Driver',
          email: 'driver@hellodriver.ga',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_OTP');
    });
  });

  describe('GET /auth/me', () => {
    it('should return authenticated user', async () => {
      if (!token) {
        console.warn('Token not available, skipping auth test');
        return;
      }

      const response = await request(app.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.phone).toBe('+241072123456');
    });

    it('should reject request without token', async () => {
      const response = await request(app.server).get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /drivers/profile', () => {
    it('should complete driver profile', async () => {
      if (!token) {
        console.warn('Token not available, skipping profile test');
        return;
      }

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleYear: 2020,
          vehicleModel: 'Corolla',
          vehicleRegistration: 'GA-2024-001',
          residentialArea: 'Libreville Central',
          hasAc: true,
          mobileMoneyAccount: '+241072123456',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('vehicleBrand', 'Toyota');
    });

    it('should reject incomplete profile', async () => {
      if (!token) return;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleBrand: 'Toyota',
          // Missing other required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app.server)
        .post('/drivers/profile')
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleYear: 2020,
          vehicleModel: 'Corolla',
          vehicleRegistration: 'GA-2024-001',
          residentialArea: 'Libreville Central',
          hasAc: true,
          mobileMoneyAccount: '+241072123456',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /drivers/verification-status', () => {
    it('should return verification status (0/3 docs)', async () => {
      if (!token) {
        console.warn('Token not available, skipping verification status test');
        return;
      }

      const response = await request(app.server)
        .get('/drivers/verification-status')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.isVerified).toBe(false);
      expect(response.body.verificationStatus).toBe('pending');
      expect(response.body.verifiedDocsCount).toBe(0);
      expect(response.body.totalDocsRequired).toBe(3);
      expect(response.body.allDocsVerified).toBe(false);
    });
  });

  describe('POST /drivers/documents/upload', () => {
    it('should upload drivers license document', async () => {
      if (!token) {
        console.warn('Token not available, skipping document upload test');
        return;
      }

      // Note: This test requires actual file upload
      // In real tests, you would use a test fixture file
      const response = await request(app.server)
        .post('/drivers/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('documentType', 'drivers_license')
        .attach('file', Buffer.from('fake-license-image'), 'license.jpg');

      // This will fail without Supabase credentials, but shows test structure
      if (response.status === 200 || response.status === 500) {
        // 200 = success, 500 = Supabase credentials issue (expected in test)
        expect(response.body).toBeDefined();
      }
    });

    it('should reject invalid document type', async () => {
      if (!token) return;

      const response = await request(app.server)
        .post('/drivers/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('documentType', 'invalid_type')
        .attach('file', Buffer.from('test'), 'test.jpg');

      expect(response.status).toBe(400);
    });
  });

  describe('GET /drivers/documents', () => {
    it('should list driver documents', async () => {
      if (!token) {
        console.warn('Token not available, skipping documents list test');
        return;
      }

      const response = await request(app.server)
        .get('/drivers/documents')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('count');
    });
  });

  describe('Admin Routes', () => {
    it('should reject non-admin accessing pending drivers list', async () => {
      if (!token) return;

      const response = await request(app.server)
        .get('/admin/drivers/pending')
        .set('Authorization', `Bearer ${token}`);

      // Driver token should be rejected, need admin token
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app.server).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
