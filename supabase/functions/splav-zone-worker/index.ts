import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import '../../../military-autopilot.js';
import {getLibrary} from '../_shared/pdfium-library.mjs';
import {createZoneWorker} from './core.mjs';
Deno.serve(createZoneWorker({createClient,getLibrary,planner:(globalThis as any).CRMMilitaryAutopilot,
 env:(name:string)=>Deno.env.get(name)}));
