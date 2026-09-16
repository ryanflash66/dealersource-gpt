import { mkdir,copyFile,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../src/config.ts';
import { runPipeline } from '../src/pipeline.ts';
export async function build(output=path.join(ROOT,'dist'),env:NodeJS.ProcessEnv=process.env):Promise<string>{
 await mkdir(output,{recursive:true});
 for(const file of ['index.html','tokens.css','styles.css'])await copyFile(path.join(ROOT,'dashboard',file),path.join(output,file));
 await copyFile(path.join(ROOT,'dashboard','app.ts'),path.join(output,'app.js'));
 const runtime={supabase_url:env.PUBLIC_SUPABASE_URL??null,supabase_anon_key:env.PUBLIC_SUPABASE_ANON_KEY??null,maplibre_script_url:env.MAPLIBRE_SCRIPT_URL??null,pmtiles_script_url:env.PMTILES_SCRIPT_URL??null,map_style_url:env.MAP_STYLE_URL??null};
 if(runtime.supabase_url&&!runtime.supabase_anon_key)throw new Error('Public Supabase URL requires its public anon key');
 await writeFile(path.join(output,'runtime-config.json'),JSON.stringify(runtime,null,2)+'\n');
 if(!runtime.supabase_url){const data=path.join(ROOT,'.data','dashboard-build');await runPipeline({offline:true,day:'2026-09-16',dataDir:data,env:{},quiet:true});await copyFile(path.join(data,'report.json'),path.join(output,'report.json'));}
 else await rm(path.join(output,'report.json'),{force:true});
 await writeFile(path.join(output,'fixture-site.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" fill="#edf1f2"/><path d="M0 165H600" stroke="#b7c6ca" stroke-width="25"/><rect x="55" y="55" width="125" height="90" fill="#aebfc4"/><rect x="68" y="70" width="32" height="32" fill="#fff"/><rect x="114" y="80" width="45" height="65" fill="#768f98"/><g fill="#70858c"><rect x="225" y="98" width="70" height="35" rx="8"/><rect x="335" y="98" width="70" height="35" rx="8"/></g><text x="470" y="35" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#304850">SYNTHETIC SITE</text></svg>');
 return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){await build();console.log('Dashboard built: dist/ (no network or dependency installation).');}
