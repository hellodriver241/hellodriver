import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  signupSchema,
  otpSchema,
  profileUpdateSchema,
  type SignupInput,
  type OtpInput,
} from './auth.validators.js';
import {
  createUser,
  getUser,
  getUserByPhone,
  getUserWithProfile,
  updateUser,
  phoneExists,
} from './auth.service.js';
import { sendOTP, verifyOTP } from '../sms/sms.service.js';
import { authenticate } from '../../shared/errors/handlers.js';
import { errors } from '../../shared/errors/AppError.js';

/**
 * Register auth routes
 */
export async function registerAuthRoutes(app: FastifyInstance) {
  /**
   * POST /auth/send-otp
   * Send OTP to phone number
   */
  app.post('/auth/send-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone } = signupSchema.pick({ phone: true }).parse(request.body);

    try {
      const result = await sendOTP(phone);

      if (!result.success) {
        throw errors.otpSendFailed(result.error);
      }

      return reply.code(200).send({
        message: 'OTP sent to phone',
        phone,
      });
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err && 'code' in err) {
        throw err;
      }
      throw errors.otpSendFailed();
    }
  });

  /**
   * POST /auth/verify-otp-and-signup
   * Verify OTP and create user account
   */
  app.post(
    '/auth/verify-otp-and-signup',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = otpSchema.merge(
        signupSchema.pick({ role: true, firstName: true, lastName: true, email: true })
      );

      const { phone, code, role, firstName, lastName, email } = bodySchema.parse(request.body);

      try {
        // Verify OTP
        const otpResult = await verifyOTP(phone, code);

        if (!otpResult.success) {
          throw errors.invalidOtp(otpResult.error);
        }

        // Check if user already exists
        let user = await getUserByPhone(phone);

        if (!user) {
          const authId = uuidv4();
          user = await createUser(authId, role, phone, firstName, lastName, email);
        }

        if (!user) {
          throw errors.internalError('Failed to create user');
        }

        // Sign access token (short-lived: 15 minutes)
        const accessToken = app.jwt.sign(
          { sub: user.id, role: user.role, phone: user.phone, type: 'access' },
          { expiresIn: '15m' }
        );

        // Sign refresh token (long-lived: 7 days)
        const refreshToken = app.jwt.sign(
          { sub: user.id, role: user.role, phone: user.phone, type: 'refresh' },
          { expiresIn: '7d' }
        );

        return reply.code(201).send({
          user,
          session: {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 900, // 15 minutes in seconds
          },
        });
      } catch (err) {
        if (err instanceof Error && 'statusCode' in err && 'code' in err) {
          throw err;
        }
        console.error('OTP verification error:', err instanceof Error ? err.message : String(err));
        throw errors.internalError('OTP verification failed');
      }
    }
  );

  /**
   * GET /auth/me
   * Get current authenticated user
   */
  app.get('/auth/me', { onRequest: [authenticate] }, async (request: FastifyRequest) => {
    const result = await getUserWithProfile((request.user as any).sub);

    if (!result) {
      throw errors.userNotFound();
    }

    return result;
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh_token } = request.body as { refresh_token?: string };

    if (!refresh_token) {
      throw errors.validationFailed({ refresh_token: 'Refresh token is required' });
    }

    try {
      // Verify the refresh token
      const payload = app.jwt.verify(refresh_token) as any;

      // Ensure it's actually a refresh token
      if (payload.type !== 'refresh') {
        throw errors.unauthorized();
      }

      // Fetch user to ensure still active
      const userWithProfile = await getUserWithProfile(payload.sub as string);
      if (!userWithProfile) {
        throw errors.userNotFound();
      }
      const user = userWithProfile.user;

      // Issue new access token
      const accessToken = app.jwt.sign(
        { sub: user.id, role: user.role, phone: user.phone, type: 'access' },
        { expiresIn: '15m' }
      );

      return reply.code(200).send({
        access_token: accessToken,
        expires_in: 900, // 15 minutes in seconds
      });
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err && 'code' in err) {
        throw err;
      }
      throw errors.unauthorized();
    }
  });

  /**
   * PATCH /auth/profile
   * Update authenticated user profile
   */
  app.patch(
    '/auth/profile',
    { onRequest: [authenticate] },
    async (request: FastifyRequest) => {
      const data = profileUpdateSchema.parse(request.body);

      const user = await updateUser((request.user as any).sub, data);

      if (!user) {
        throw errors.userNotFound();
      }

      return user;
    }
  );
}
