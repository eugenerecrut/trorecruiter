import postgres from 'npm:postgres@3.4.7';
import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import {createIsolatedControlHandler} from './handler.mjs';

const env=(name:string)=>Deno.env.get(name);
Deno.serve(createIsolatedControlHandler({
 env,
 async withQuery<T>(run:(query:(sql:string,params:string[])=>Promise<{rows:unknown[]}>)=>Promise<T>){
  const url=env('SPLAV_ISOLATED_DB_URL');
  if(!url)throw Error('Isolated database connection missing');
  const sql=postgres(url,{max:1,prepare:false,connect_timeout:5});
  try{return await run(async(statement,params)=>({rows:await sql.unsafe(statement,params)}));}
  finally{await sql.end({timeout:3});}
 },
 async authenticate({projectURL,publicKey}:{projectURL:string;publicKey:string}){
  const email=env('SPLAV_ISOLATED_EMAIL'),password=env('SPLAV_ISOLATED_PASSWORD');
  if(!email||!password)return null;
  const client=createClient(projectURL,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.auth.signInWithPassword({email,password});
  return result.error||!result.data.user||!result.data.session?null:{userId:result.data.user.id,jwt:result.data.session.access_token};
 }
}));
