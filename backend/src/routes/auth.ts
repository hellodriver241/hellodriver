import { FastifyInstance } from 'fastify';
import { signupSchema, otpSchema } from '../validators/auth.js';
import { createUser, getUser, getUserWithProfile } from '../services/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // Step 1: Send OTP
  app.post('/auth/send-otp', async (request, reply) => {
    const { phone } = signupSchema.pick({ phone: true }).parse(request.body);

    try {
      const { error } = await app.supabase.auth.signInWithOtp({ phone });

      if (error) {
        app.log.error(`Supabase OTP error: ${error.message}`);
        return reply.code(400).send({ error: { code: 'OTP_SEND_FAILED', message: error.message } });
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
      const { data, error } = await app.supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });

      if (error || !data.user) {
        app.log.error(`OTP verification failed: ${error?.message || 'No user returned'}`);
        return reply.code(400).send({ error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP' } });
      }

      // data.user.id is the Supabase auth user ID
      const authId = data.user.id;

      // Check if user already exists in our database
      let user = await getUser(authId);
      if (!user) {
        // Create new user with role-specific profile
        user = await createUser(authId, role, phone, firstName, lastName, email);
      }

      return reply.code(200).send({
        user,
        session: {
          access_token: data.session?.access_token,
          refresh_token: data.session?.refresh_token,
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
