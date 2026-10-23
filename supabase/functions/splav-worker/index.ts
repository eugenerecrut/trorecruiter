import { createClient } from 'npm:@supabase/supabase-js@2';
import { createWorkerHandler } from './worker-core.mjs';
Deno.serve(createWorkerHandler({createClient,env:(name:string)=>Deno.env.get(name),
  waitUntil:(task:Promise<unknown>)=>(globalThis as any).EdgeRuntime.waitUntil(task),
  log:(event:unknown)=>console.log('splav-worker',JSON.stringify(event))}));
