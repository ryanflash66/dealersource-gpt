import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
const url=process.env.DATABASE_URL;
if(!url){console.log('NOT RUN: DATABASE_URL is unset. Offline acceptance uses fixture-backed persistence; see docs/deploy.md for optional local PostGIS testing.');process.exitCode=2;}
else{for(const file of ['migrations/local-bootstrap.sql','migrations/001_schema.sql','migrations/002_dashboard.sql','tests/db-smoke.sql']){const r=spawnSync('psql',[url,'-v','ON_ERROR_STOP=1','-f',path.join(ROOT,file)],{stdio:'inherit'});if(r.error||r.status!==0){console.error('Local database test failed; no hosted service was substituted.');process.exitCode=1;break;}}}
