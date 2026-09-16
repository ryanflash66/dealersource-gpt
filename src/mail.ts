import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.ts';
import { id,email } from './util.ts';
import type { Row,Store } from './types.ts';
import { Registry } from './providers/index.ts';
export const TEMPLATES:Record<string,string>={
 rent:'Please confirm the current written monthly base rent in USD, what exact office and display area it includes, and any additional charges for {address}, {suite}. This is a factual inquiry, not an offer.',
 zoning:'For {address}, {suite}, is used motor vehicle sales with outdoor display a permitted or approved conditional use? Please cite the exact applicable section and any unmet conditions. This is an inquiry, not a permit application.',
 flood:'Please identify the official flood information for parcel {parcel}. We need centroid and majority-area high-risk coverage, with its source and effective date.',
 premises:'Please confirm the enclosed office, display capacity, signage permission, and any written shared-lot/sublease consent for {address}, {suite}. This is not an offer.'
};
export function renderTemplate(fact:string,site:Row):string {const t=TEMPLATES[fact];if(!t)throw new Error('Unknown template');return t.replaceAll('{address}',String(site.address).replace(/[\r\n]/g,' ')).replaceAll('{suite}',String(site.suite??'office').replace(/[\r\n]/g,' ')).replaceAll('{parcel}',String(site.parcel_id??'unknown').replace(/[\r\n]/g,' '))+'\n\nAutomated verification assistant acting for the dealership. Reply STOP to stop these inquiries.';}
export function allowedContact(recipient:string,provenance:string,kind:string,synthetic:boolean):boolean {
 if(!email(recipient)||!provenance||!['leasing','official'].includes(kind))return false;
 if(synthetic)return provenance.startsWith('fixture:')&&recipient.endsWith('@example.invalid');
 try{const u=new URL(provenance);return u.protocol==='https:'&&!recipient.endsWith('.invalid')}catch{return false;}
}
export function mailPaused(store:Store,config:Row,now:string):string|null {
 if(config.paused)return 'Paused in configuration';if(store.state.controls.sending_paused)return store.state.controls.pause_reason??'Sending paused';
 const cutoff=Date.parse(now)-86400000;
 const sent=store.all('messages').filter(m=>m.direction==='outbound'&&Date.parse(m.created_at)>=cutoff&&['sent','bounced'].includes(m.status));
 const bounced=sent.filter(m=>m.status==='bounced');if(sent.length&&bounced.length/sent.length*100>config.bounce_pause_pct){store.state.controls.sending_paused=true;store.state.controls.pause_reason='24-hour bounce rate exceeded configured threshold';return store.state.controls.pause_reason;}
 return null;
}
export function contactDue(store:Store,site:Row,recipient:string,now:string,days:number):boolean {
 const last=store.all('messages').filter(m=>m.direction==='outbound'&&m.site_id===site.id&&m.recipient===recipient).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 return !last||Date.parse(now)-Date.parse(last.created_at)>=days*86400000;
}
export class Gmail {
 registry:Registry;fixture:boolean;sender:string;token:string;
 constructor(registry:Registry){this.registry=registry;this.token=registry.env.GMAIL_ACCESS_TOKEN??'';const refresh=registry.env.GMAIL_REFRESH_TOKEN&&registry.env.GMAIL_CLIENT_ID&&registry.env.GMAIL_CLIENT_SECRET;this.fixture=registry.offline||!(this.token||refresh);this.sender=this.fixture?'owner@example.invalid':registry.config.business.mail.sender==='owner'?(registry.env.GMAIL_OWNER_ADDRESS??''):(registry.env.GMAIL_OPERATOR_ADDRESS??'');}
 async ensureToken(){if(this.fixture||this.token)return;const e=this.registry.env;const response=await this.registry.transport.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:e.GMAIL_CLIENT_ID!,client_secret:e.GMAIL_CLIENT_SECRET!,refresh_token:e.GMAIL_REFRESH_TOKEN!,grant_type:'refresh_token'}).toString()},{provider:'email:oauth'});if(!response.access_token)throw new Error('Gmail OAuth refresh failed');this.token=response.access_token;}
 async send(message:Row):Promise<Row>{
  if(!email(this.sender)||!email(message.recipient))throw new Error('Invalid sender or recipient');
  if(this.fixture)return {id:'fixture-sent-'+message.id,threadId:'fixture-thread-'+message.case_id,synthetic:true};
  if(this.sender.endsWith('.invalid')||message.recipient.endsWith('.invalid'))throw new Error('Fixture recipient cannot receive live email');
  await this.ensureToken();
  const subject=`DealerSource verification ${message.case_id}`;
  const mime=[`From: ${this.sender}`,`To: ${message.recipient}`,`Reply-To: ${this.sender}`,`Subject: ${subject}`,`Message-ID: <${message.id}@dealersource.local>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','',message.body].join('\r\n');
  return this.registry.transport.request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')})},{provider:'email:gmail'});
 }
 async replies(store:Store):Promise<Row[]>{
  if(this.fixture){const replies=JSON.parse(await readFile(path.join(ROOT,'fixtures','replies.json'),'utf8'));return replies.filter((r:Row)=>store.all('cases').some(c=>c.listing_id===r.site_listing_id&&c.fact===r.fact&&store.all('messages').some(m=>m.case_id===c.id&&m.direction==='outbound'&&m.status==='sent')));}
  await this.ensureToken();
  const out:Row[]=[];const threads=new Set(store.all('messages').filter(m=>m.direction==='outbound'&&m.thread_id).map(m=>m.thread_id));
  for(const thread of threads){const result=await this.registry.transport.request('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+encodeURIComponent(thread)+'?format=full',{headers:{Authorization:'Bearer '+this.token}},{provider:'email:gmail'});
   const outgoing=store.all('messages').find(m=>m.thread_id===thread&&m.direction==='outbound');if(!outgoing)continue;
   for(const message of result.messages??[]){if(message.id===outgoing.provider_id||store.all('messages').some(m=>m.provider_id===message.id))continue;const headers=message.payload?.headers??[];const get=(n:string)=>headers.find((h:Row)=>h.name.toLowerCase()===n)?.value??'';const from=(get('from').match(/<([^>]+)>/)?.[1]??get('from')).toLowerCase();
    const pieces:string[]=[];const walk=(part:Row)=>{if(part.mimeType==='text/plain'&&part.body?.data)pieces.push(Buffer.from(part.body.data,'base64url').toString('utf8'));for(const p of part.parts??[])walk(p)};walk(message.payload??{});
    out.push({external_id:message.id,case_id:outgoing.case_id,from,body:pieces.join('\n').slice(0,50000),fact:store.all('cases').find(c=>c.id===outgoing.case_id)?.fact,autoreply:!!get('auto-submitted'),synthetic:false});
   }
  }
  return out;
 }
}
