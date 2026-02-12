/**
 * Supabase client configuration
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
// Admin client with service role key (for server-side operations)
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});
// Regular client with anon key (for user operations)
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
