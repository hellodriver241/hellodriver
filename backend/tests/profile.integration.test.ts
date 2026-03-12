import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/core/app';
import { registerRoutes } from '../src/routes';
import { initializeDatabase, closeDatabase } from '../src/db/index';
import { getOTPForTesting } from '../src/domains/sms/sms.service';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

describe('Driver Profile Integration Tests', () => {
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

  describe('POST /drivers/profile', () => {
    let driverToken: string;
    let driverId: string;

    beforeAll(async () => {
      const phone = '+241072111111';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Driver',
          lastName: 'Test',
        });

      driverToken = response.body.session.access_token;
      driverId = response.body.user.id;
    });

    it('should reject profile with invalid age (too young)', async () => {
      const phone = '+241072222222';
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
          firstName: 'Young',
          lastName: 'Driver',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '2010-05-15', // 14 years old
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+241072222222',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject profile with vehicle year too old', async () => {
      const phone = '+241072333333';
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
          firstName: 'Old',
          lastName: 'Car',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 1985, // Pre-1990
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: false,
          mobileMoneyAccount: '+241072333333',
        });

      expect(response.status).toBe(400);
    });

    it('should accept AC as boolean', async () => {
      const phone = '+241072444444';
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
          firstName: 'No',
          lastName: 'AC',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2010,
          vehicleRegistration: 'GA-2010-XYZ',
          residentialArea: 'Gue Gue',
          hasAc: false, // No AC
          mobileMoneyAccount: '+241072444444',
        });

      expect(response.status).toBe(200);
    });

    it('should validate vehicle registration format', async () => {
      const phone = '+241072555555';
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
          firstName: 'Bad',
          lastName: 'Registration',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'ga-lowercase-bad', // Should be uppercase
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+241072555555',
        });

      expect(response.status).toBe(400);
    });

    it('should reject profile without authentication', async () => {
      const response = await request(app.server)
        .post('/drivers/profile')
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+241072111111',
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject non-driver role submitting profile', async () => {
      const phone = '+241066666666';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const signupRes = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'client', // Client, not driver
          firstName: 'Client',
          lastName: 'User',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+241072666666',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    it('should validate vehicle brand format', async () => {
      const phone = '+241077777777';
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
          firstName: 'Brand',
          lastName: 'Test',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: '@@@InvalidBrand', // Special characters
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+241077777777',
        });

      expect(response.status).toBe(400);
    });

    it('should validate mobile money account format', async () => {
      const phone = '+241078888888';
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
          firstName: 'Money',
          lastName: 'Account',
        });

      const token = signupRes.body.session.access_token;

      const response = await request(app.server)
        .post('/drivers/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dateOfBirth: '1990-05-15',
          vehicleBrand: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleYear: 2015,
          vehicleRegistration: 'GA-2015-ABC',
          residentialArea: 'Gue Gue',
          hasAc: true,
          mobileMoneyAccount: '+33123456789', // France phone, not Gabon
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /drivers/verification-status', () => {
    let driverToken: string;

    beforeAll(async () => {
      const phone = '+241079999999';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Verify',
          lastName: 'Status',
        });

      driverToken = response.body.session.access_token;
    });

    it('should reject request without authentication', async () => {
      const response = await request(app.server).get('/drivers/verification-status');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /drivers/documents/upload', () => {
    let driverToken: string;

    beforeAll(async () => {
      const phone = '+241070000000';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Document',
          lastName: 'Upload',
        });

      driverToken = response.body.session.access_token;
    });

    it('should reject document upload without authentication', async () => {
      const response = await request(app.server).post('/drivers/documents/upload');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /drivers/documents', () => {
    let driverToken: string;

    beforeAll(async () => {
      const phone = '+241071111110';
      await request(app.server)
        .post('/auth/send-otp')
        .send({ phone });

      const otp = getOTPForTesting(phone);

      const response = await request(app.server)
        .post('/auth/verify-otp-and-signup')
        .send({
          phone,
          code: otp,
          role: 'driver',
          firstName: 'Documents',
          lastName: 'List',
        });

      driverToken = response.body.session.access_token;
    });

    it('should list driver documents', async () => {
      const response = await request(app.server)
        .get('/drivers/documents')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return empty array for new driver', async () => {
      const response = await request(app.server)
        .get('/drivers/documents')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should reject request without authentication', async () => {
      const response = await request(app.server).get('/drivers/documents');

      expect(response.status).toBe(401);
    });
  });
});
