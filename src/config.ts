import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, Row } from './types.ts';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export async function loadConfig(directory=ROOT):Promise<AppConfig> {
 const read=async(name:string)=>JSON.parse(await readFile(path.join(directory,name),'utf8'));
 const config={business:await read('business.yaml'),providers:await read('providers.yaml'),sources:await read('sources.yaml')};
 validateConfig(config);return config;
}
export function validateConfig(c:AppConfig):void {
 const b=c.business;if(!b?.search?.home_base||!Number.isFinite(b.search.max_drive_minutes)||b.search.max_drive_minutes<=0)throw new Error('Invalid search');
 if(!Number.isFinite(b.rent?.min_monthly)||!Number.isFinite(b.rent?.max_monthly)||b.rent.min_monthly<0||b.rent.max_monthly<b.rent.min_monthly)throw new Error('Invalid rent range');
 if(!['exclude','last_resort','allowed'].includes(b.site?.shared_lot)||!Number.isInteger(b.site.min_vehicle_display)||b.site.min_vehicle_display<0||typeof b.site.office_required!=='boolean')throw new Error('Invalid site configuration');
 if(b.dealer?.license_status!=='held')throw new Error('This application screens premises for a held license');
 const w=b.ranking?.weights;const keys=['traffic','visibility','distance','rent','competitors'];if(!w||keys.some(k=>!Number.isFinite(w[k])||w[k]<0)||keys.some((k,i)=>i>0&&w[keys[i-1]]<w[k])||keys.reduce((s,k)=>s+w[k],0)<=0)throw new Error('Weights must be nonnegative and ordered by specified priority');
 if(!Array.isArray(b.flood?.high_risk_zones)||!Number.isInteger(b.mail?.followup_days)||b.mail.followup_days<1||!Number.isInteger(b.mail.max_followups)||b.mail.max_followups<0||b.mail.bounce_pause_pct<0||b.mail.bounce_pause_pct>100||!['owner','operator'].includes(b.mail.sender))throw new Error('Invalid verification policy');
 try{new Intl.DateTimeFormat('en',{timeZone:b.schedule.timezone}).format()}catch{throw new Error('Invalid timezone')}
 if(typeof b.schedule.cron!=='string'||b.schedule.cron.trim().split(/\s+/).length!==5)throw new Error('Invalid cron');
 if(typeof c.providers?.paid_enabled!=='boolean'||!c.providers.selections||!Array.isArray(c.sources?.sources))throw new Error('Invalid provider/source configuration');
 const ids=new Set();for(const s of c.sources.sources){if(!s.id||ids.has(s.id)||!['crawl','reddit','rss','manual'].includes(s.kind)||!['allowed','disallowed','unknown'].includes(s.robots_txt)||!['allowed','prohibited','unclear'].includes(s.terms_status))throw new Error('Invalid or duplicate source');ids.add(s.id);}
}
export function sourceDecision(s:Row):{allowed:boolean;reason:string} {
 if(s.terms_status==='prohibited')return {allowed:false,reason:'Terms prohibit collection'};
 if(s.robots_txt==='disallowed')return {allowed:false,reason:'robots.txt disallows collection'};
 if(s.terms_status!=='allowed')return {allowed:false,reason:'Terms require explicit review'};
 if(s.robots_txt!=='allowed')return {allowed:false,reason:'Robots permission unknown'};
 if(!s.enabled)return {allowed:false,reason:'Disabled'};
 return {allowed:true,reason:'Allowed'};
}
