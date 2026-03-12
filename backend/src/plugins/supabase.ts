import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient;
  }
}

export default fp(async (app: FastifyInstance) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    app.log.warn('Supabase credentials not configured, auth will be mocked');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  app.decorate('supabase', supabase);
  app.log.info('Supabase client initialized');
});
