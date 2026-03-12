import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { signupSchema, otpSchema } from '../validators/auth.js';
import { createUser, getUser, getUserWithProfile } from '../services/auth.js';
import { sendOTP, verifyOTP } from '../services/sms.js';

export async function authRoutes(app: FastifyInstance) {
  // Step 1: Send OTP
  app.post('/auth/send-otp', async (request, reply) => {
    const { phone } = signupSchema.pick({ phone: true }).parse(request.body);

    try {
      const result = await sendOTP(phone);

      if (!result.success) {
        app.log.error(`SMS OTP error: ${result.error}`);
        return reply.code(400).send({ error: { code: 'OTP_SEND_FAILED', message: result.error } });
      }

      return reply.code(200).send({
        message: 'OTP sent to phone',
        phone,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      app.log.error(`OTP error: ${errorMessage}`);
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send OTP' } });
    }
  });

  // Step 2: Verify OTP and create user
  app.post('/auth/verify-otp-and-signup', async (request, reply) => {
    const bodySchema = otpSchema.merge(
      signupSchema.pick({ role: true, firstName: true, lastName: true, email: true })
    );
    const { phone, code, role, firstName, lastName, email } = bodySchema.parse(request.body);

    try {
      // Verify OTP using custom SMS service
      const otpResult = await verifyOTP(phone, code);

      if (!otpResult.success) {
        app.log.error(`OTP verification failed: ${otpResult.error}`);
        return reply.code(400).send({ error: { code: 'INVALID_OTP', message: otpResult.error } });
      }

      // Generate a unique auth ID for this user
      const authId = uuidv4();

      // Check if user already exists in our database
      let user = await getUser(authId);
      if (!user) {
        // Create new user with role-specific profile
        user = await createUser(authId, role, phone, firstName, lastName, email);
      }

      // Sign the JWT token for the user
      const token = app.jwt.sign({ sub: authId, role, phone }, { expiresIn: '7d' });

      return reply.code(200).send({
        user,
        session: {
          access_token: token,
          refresh_token: token, // In production, implement refresh token rotation
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      app.log.error(`Verification error: ${errorMessage}`);
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'OTP verification failed' } });
    }
  });

  // Get current user
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      const result = await getUserWithProfile((request.user as any).sub);
      if (!result) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return reply.send(result);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch user' });
    }
  });

  // Update profile
  app.patch('/auth/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { firstName, lastName, email } = signupSchema
      .pick({ firstName: true, lastName: true, email: true })
      .partial()
      .parse(request.body);

    try {
      const { getDatabase } = await import('../db/index.js');
      const { users } = await import('../db/schema.js');
      const { eq } = await import('drizzle-orm');

      const db = getDatabase();
      const [user] = await db
        .update(users)
        .set({ firstName, lastName, email })
        .where(eq(users.authId, (request.user as any).sub))
        .returning();

      return reply.send(user);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'Profile update failed' });
    }
  });
}
