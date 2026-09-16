import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,rm,access,readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
const verification=path.join(ROOT,'.verify');await mkdir(verification,{recursive:true});const directory=await mkdtemp(path.join(verification,'fresh-clone-'));
const git=process.env.GIT_BINARY??'git';
const env={PATH:process.env.PATH??'',TZ:'UTC',NODE_NO_WARNINGS:'1',GIT_TERMINAL_PROMPT:'0'};
const results:any[]=[];
function command(program:string,args:string[],cwd:string,expected=0){const r=spawnSync(program,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:8_000_000});results.push({command:[program,...args].map(x=>x.replaceAll(ROOT,'<repo>').replaceAll(directory,'<fresh>')).join(' '),exit_code:r.status,pass:r.status===expected,stdout:(r.stdout??'').slice(-6000),stderr:(r.stderr??'').slice(-1000)});assert.equal(r.status,expected,r.stderr||r.stdout);return r.stdout??'';}
try{
 assert.equal(command(git,['status','--porcelain'],ROOT).trim(),'','Commit current work before acceptance');
 command(git,['clone','--no-local','--no-hardlinks',ROOT,directory],ROOT);
 await assert.rejects(access(path.join(directory,'.env')));
 command(process.execPath,['--import','./tests/no-network.mjs','scripts/test.ts'],directory);
 const run=(data:string,extra:string[]=[])=>command(process.execPath,['--import','./tests/no-network.mjs','src/cli.ts','--offline','--quiet','--day','2026-09-16','--data-dir',data,...extra],directory);
 run('.data/acceptance');let report=JSON.parse(await readFile(path.join(directory,'.data/acceptance/report.json'),'utf8'));
 const viable=report.report.sites.filter((s:any)=>s.viable);assert.equal(viable.length,5);
 for(const site of viable)for(const g of Object.values(site.gates) as any[]){assert.equal(g.status,'pass');assert.ok(g.evidence_ids.length);for(const eid of g.evidence_ids){const e=report.report.evidence.find((e:any)=>e.evidence_id===eid);assert.ok(e?.source_url&&e?.fetched_at&&e?.expires_at);assert.ok(Date.parse(e.expires_at)>Date.parse(report.report.run_date));}}
 assert.equal(report.report.external_calls.length,0);assert.equal(report.messages.length,4);
 run('.data/acceptance');report=JSON.parse(await readFile(path.join(directory,'.data/acceptance/report.json'),'utf8'));assert.equal(report.messages.length,0);assert.equal(report.run.counts.outbound,0);
 const configDir=path.join(directory,'.data','config-switch');await mkdir(configDir,{recursive:true});for(const file of ['business.yaml','sources.yaml','providers.yaml'])await writeFile(path.join(configDir,file),await readFile(path.join(directory,file)));
 const providers=JSON.parse(await readFile(path.join(configDir,'providers.yaml'),'utf8'));providers.selections.geocoding='nominatim';await writeFile(path.join(configDir,'providers.yaml'),JSON.stringify(providers,null,2));
 run('.data/nominatim',['--config-dir',configDir]);const switched=JSON.parse(await readFile(path.join(directory,'.data/nominatim/state.json'),'utf8'));const original=JSON.parse(await readFile(path.join(directory,'.data/acceptance/state.json'),'utf8'));assert.notEqual(original.tables.sites[0].geo.identity,switched.tables.sites[0].geo.identity);assert.notEqual(original.tables.sites[0].geo.lat,switched.tables.sites[0].geo.lat);
 command(process.execPath,['--import','./tests/no-network.mjs','scripts/build.ts'],directory);const html=await readFile(path.join(directory,'dist/index.html'),'utf8');for(const view of ['shortlist','pipeline','exceptions','config'])assert.ok(html.includes('data-view="'+view+'"'));
 const dashboard=JSON.parse(await readFile(path.join(directory,'dist/report.json'),'utf8'));assert.equal(dashboard.report.offline,true);assert.equal(dashboard.report.external_calls.length,0);
 const finalStatus=command(git,['status','--porcelain'],directory);assert.equal(finalStatus.trim(),'');
 await mkdir(path.join(ROOT,'.data'),{recursive:true});await writeFile(path.join(ROOT,'.data/acceptance.json'),JSON.stringify({status:'PASS',scope:'Section 13 offline fixture acceptance; no hosted integrations exercised',viable_sites:5,replay_outbound:0,paid_endpoint_calls:0,fresh_clone_no_env:true,network_guard:true,git_clean:true,results},null,2)+'\n');console.log(JSON.stringify({acceptance:'PASS',viable_sites:5,replay_outbound:0,provider_switch:'PASS',paid_endpoint_calls:0,fresh_clone_no_env:true,git_clean:true}));
}finally{await rm(directory,{recursive:true,force:true});}
