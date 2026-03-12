import { FastifyInstance } from 'fastify';
import { signupSchema, otpSchema } from '../validators/auth.js';
import { createUser, getUser, getUserWithProfile } from '../services/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // Step 1: Send OTP
  app.post('/auth/send-otp', async (request, reply) => {
    const { phone } = signupSchema.pick({ phone: true }).parse(request.body);

    try {
      // TODO: Integrate with Supabase Auth to send OTP
      // const { error } = await app.supabase.auth.signInWithOtp({ phone });

      // For now, return success message
      return reply.code(200).send({
        message: 'OTP sent to phone',
        phone,
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(400).send({ error: 'Failed to send OTP' });
    }
  });

  // Step 2: Verify OTP and create user
  app.post('/auth/verify-otp-and-signup', async (request, reply) => {
    const bodySchema = otpSchema.merge(
      signupSchema.pick({ role: true, firstName: true, lastName: true, email: true })
    );
    const { phone, code, role, firstName, lastName, email } = bodySchema.parse(request.body);

    try {
      // TODO: Integrate with Supabase Auth to verify OTP
      // const { data, error } = await app.supabase.auth.verifyOtp({
      //   phone,
      //   token: code,
      //   type: 'sms',
      // });

      // For now, mock the verification
      const mockAuthId = '00000000-0000-0000-0000-000000000000'; // Mock UUID

      // Check if user exists
      let user = await getUser(mockAuthId);
      if (!user) {
        user = await createUser(mockAuthId, role, phone, firstName, lastName, email);
      }

      return reply.code(200).send({
        user,
        token: 'mock-access-token', // Mock token
        refreshToken: 'mock-refresh-token',
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(400).send({ error: 'OTP verification failed' });
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
