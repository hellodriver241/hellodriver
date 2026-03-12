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

        // Sign JWT token
        const token = app.jwt.sign(
          { sub: user.id, role: user.role, phone: user.phone },
          { expiresIn: '7d' }
        );

        return reply.code(200).send({
          user,
          session: {
            access_token: token,
            refresh_token: token, // TODO: Implement refresh token rotation
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
