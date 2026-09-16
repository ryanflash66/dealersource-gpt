import { spawnSync } from 'node:child_process';
import { readdirSync,mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
const files=readdirSync(path.join(ROOT,'tests')).filter(f=>f.endsWith('.test.ts')).sort().map(f=>path.join(ROOT,'tests',f));
if(!files.length)throw new Error('No tests discovered');
const result=spawnSync(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','--import',path.join(ROOT,'tests','no-network.mjs'),...files],{cwd:ROOT,encoding:'utf8',timeout:120000,maxBuffer:8_000_000,env:{PATH:process.env.PATH??'',TZ:'UTC',NODE_NO_WARNINGS:'1'}});
const output=(result.stdout??'')+(result.stderr??'');mkdirSync(path.join(ROOT,'.data'),{recursive:true});writeFileSync(path.join(ROOT,'.data','tests.tap'),output);process.stdout.write(output);process.exitCode=result.status??1;
