import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { createHandler } from './user-admin-core.mjs';
Deno.serve(createHandler(createClient, (name: string) => Deno.env.get(name)));
