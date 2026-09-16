import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig,sourceDecision,ROOT } from './config.ts';
import { Registry } from './providers/index.ts';
import { FileStore,SupabaseStore } from './store.ts';
import { Model } from './model.ts';
import { createReport } from './report.ts';
import { Gmail,renderTemplate,allowedContact,contactDue,mailPaused } from './mail.ts';
import { assess,rank,score,current } from './gates.ts';
import { measureFlood } from './flood.ts';
import { id,canonical,iso,shift,safeURL } from './util.ts';
import type { Row,Store,Evidence,AppConfig,ProviderResult } from './types.ts';
export const STAGES=['discover','resolve','enrich','verify','score','report'];
export type Options={offline?:boolean;day?:string;dataDir?:string;configDir?:string;config?:AppConfig;store?:Store;registry?:Registry;env?:NodeJS.ProcessEnv;stage?:string;quiet?:boolean;resumeMail?:boolean};

function evidence(store:Store,site:Row,fact:string,value:any,source:string,now:string,days:number,method:string,synthetic:boolean,sourceKind:string,raw?:string):Evidence {
 const key=id(site.id,fact,value,source,method);const existing=store.all('evidence').find(e=>e.id===key);if(existing)return existing as Evidence;
 const e={id:key,site_id:site.id,fact,value,source_url:source,fetched_at:now,expires_at:shift(now,days),method,source_kind:sourceKind,synthetic,scope:site.suite,raw_document_id:raw};store.put('evidence',e);return e;
}
function rawDoc(store:Store,result:ProviderResult,sourceId:string,now:string):string {const key=id(sourceId,result.raw);if(!store.all('raw_documents').some(r=>r.id===key))store.put('raw_documents',{id:key,source_id:sourceId,source_url:result.source_url,payload:result.raw,fetched_at:now,synthetic:result.synthetic});return key;}
function latest(store:Store,siteId:string,fact:string):Evidence|undefined{return store.all('evidence').filter(e=>e.site_id===siteId&&e.fact===fact).sort((a,b)=>Date.parse(b.fetched_at)-Date.parse(a.fetched_at))[0] as Evidence|undefined;}

export async function runPipeline(options:Options={}):Promise<Row>{
 const config=options.config??await loadConfig(options.configDir);const b=config.business;const offline=options.offline??false;const env=options.env??process.env;
 const directory=options.dataDir??path.join(ROOT,'.data');const registry=options.registry??new Registry(config,offline,env);const now=iso(options.day?options.day.includes('T')?options.day:options.day+'T10:00:00Z':new Date());
 const owned=!options.store;const store=options.store??(!offline&&env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY?await SupabaseStore.open(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,(u,o)=>registry.transport.request(u,o)):await FileStore.open(path.join(directory,'state.json')));
 const model=new Model(registry),gmail=new Gmail(registry);const run:Row={id:randomUUID(),started_at:now,day:now.slice(0,10),mode:offline?'offline':'auto',stages:[],counts:{discovered:0,new_sites:0,outbound:0,inbound:0},errors:[],provider_calls:[],complete:false};
 if(options.resumeMail){store.state.controls.sending_paused=false;store.state.controls.pause_reason=null;}
 store.put('runs',run);const log=(event:string,details:Row={})=>{const item={time:now,run_id:run.id,event,...details};if(!options.quiet)console.log(JSON.stringify(item));};
 let home:Row={lat:35.6127,lon:-77.3664};
 const failed=(stage:string,error:any,siteId?:string)=>{const item={stage,site_id:siteId??null,message:String(error.message).slice(0,1000)};run.errors.push(item);log('error',item);};
 try{
  for(const stage of STAGES){if(options.stage&&options.stage!==stage)continue;
   try{
    if(stage==='discover'){
     for(const source of config.sources.sources){const decision=sourceDecision(source);store.put('sources',{...source,excluded_reason:decision.allowed?null:decision.reason});if(!decision.allowed)continue;
      try{
       let result:ProviderResult;
       if(source.url.startsWith('fixture:'))result=await new (await import('./providers/index.ts')).FixtureProvider('crawling','anycrawl').execute({now});
       else if(source.kind==='manual')continue;
       else if(source.kind==='reddit'){
        const social=registry.get('social');result=await social.execute({subreddit:config.sources.subreddits.join('+'),now});
       }else{safeURL(source.url);result=await registry.get('crawling').execute({url:source.url,now,kind:source.kind});}
       const doc=rawDoc(store,result,source.id,now);const extracted=await model.extract(result.data??{},result.source_url);
       store.put('raw_documents',{id:doc,extraction:extracted,extraction_method:registry.config.providers.selections.llm});
       for(const listing of extracted){
        const listingId=id(source.id,listing.external_id),siteId=id(canonical(listing.address),canonical(listing.suite??'office'));
        const prior=store.all('sites').find(s=>s.id===siteId);const prevListing=store.all('listings').find(l=>l.id===listingId);run.counts.discovered++;
        if(!prior){store.put('sites',{...listing,id:siteId,listing_id:listing.external_id,first_seen:now,source_url:result.source_url,source_ids:[source.id],synthetic:result.synthetic,stage:'discovered'});run.counts.new_sites++;}
        else store.put('sites',{id:siteId,source_ids:[...new Set([...(prior.source_ids??[]),source.id])]});
        store.put('listings',{id:listingId,site_id:siteId,source_id:source.id,raw_document_id:doc,extraction:listing,first_seen:prevListing?.first_seen??now,last_seen:now});
        const site=store.all('sites').find(s=>s.id===siteId)!;
        if(listing.quote_written&&Number.isFinite(listing.base_monthly))evidence(store,site,'rent',{monthly:listing.base_monthly,currency:'USD',written:true},result.source_url,shift(site.first_seen,-(listing.quote_age_days??0)),b.evidence.rent_days,'written_quote',result.synthetic,'leasing',doc);
        if(listing.leasing_email&&JSON.stringify(result.raw).toLowerCase().includes(listing.leasing_email.toLowerCase()))store.put('contacts',{id:id(listing.leasing_email.toLowerCase()),email:listing.leasing_email.toLowerCase(),kind:'leasing',source_url:result.source_url,synthetic:result.synthetic,do_not_contact:store.all('contacts').find(c=>c.id===id(listing.leasing_email.toLowerCase()))?.do_not_contact??false});
       }
      }catch(e){failed(stage,e);}
     }
    }
    if(stage==='resolve'){
     const geo=registry.get('geocoding');if(!geo.fixture){const h=await geo.execute({address:b.search.home_base,now});if(!h.data)throw new Error('Home geocode unresolved');home=h.data;}
     for(const site of store.all('sites'))try{
      const geoResult=await geo.execute({...site,now});rawDoc(store,geoResult,'provider-geocoding',now);if(!geoResult.data)throw new Error('Site geocode unresolved');
      const parcel=await registry.get('parcels').execute({...site,...geoResult.data,now});const doc=rawDoc(store,parcel,'provider-parcels',now);if(!parcel.data?.id)throw new Error('Parcel unresolved');
      store.put('parcels',{...parcel.data,id:parcel.data.id,raw_document_id:doc});store.put('sites',{id:site.id,geo:geoResult.data,parcel_id:parcel.data.id,stage:'resolved'});
     }catch(e){failed(stage,e,site.id);}
    }
    if(stage==='enrich'){
     for(const site of store.all('sites')){if(!site.geo)continue;const parcel=store.all('parcels').find(p=>p.id===site.parcel_id);
      for(const layer of ['zoning','flood','traffic','drive_time','imagery','competitors'] as const)try{
       const result=await registry.get(layer).execute({...site,...site.geo,parcel,home_base:b.search.home_base,home_lat:home.lat,home_lon:home.lon,max_drive_minutes:b.search.max_drive_minutes,radius_m:b.search.competitor_radius_m,now});const doc=rawDoc(store,result,'provider-'+layer,now);
       let value=result.data;if(layer==='flood'&&value?.features&&parcel)value=measureFlood(parcel,value.features,b.flood.high_risk_zones);
       if(!value)throw new Error(`No ${layer} evidence`);
       if(layer==='zoning'){
        const contact=value.planning_email;if(contact&&value.planning_contact_source){const old=store.all('contacts').find(c=>c.id===id(contact.toLowerCase()));store.put('contacts',{id:id(contact.toLowerCase()),email:contact.toLowerCase(),kind:'official',source_url:value.planning_contact_source,synthetic:result.synthetic,do_not_contact:old?.do_not_contact??false});site.planning_email=contact;}
        evidence(store,site,'zoning',value,result.source_url,value.confirmed_at??now,b.evidence.zoning_days,value.method??'official_layer_and_use_table',result.synthetic,'official',doc);
       }else if(layer==='flood')evidence(store,site,'flood',value,result.source_url,now,b.evidence.flood_days,'centroid_and_area',result.synthetic,'official',doc);
       else {const field=layer==='drive_time'?'drive':layer;store.put('sites',{id:site.id,[field]:value});evidence(store,site,field,value,result.source_url,now,b.evidence.context_days,result.method,result.synthetic,'context',doc);}
      }catch(e){failed(stage,e,site.id);}
     }
     for(const broker of store.all('sites').flatMap(s=>s.competitors?.brokers??[])){if(!broker.url)continue;safeURL(broker.url);const sid=id('broker',broker.url);if(!store.all('sources').some(s=>s.id===sid))store.put('sources',{id:sid,kind:'crawl',url:broker.url,robots_txt:'unknown',terms_status:'unclear',enabled:false,cadence:'daily',excluded_reason:'Discovered broker requires terms/robots review'});}
    }
    if(stage==='verify'){
     for(const site of store.all('sites')){
      const a=assess(site,store.all('evidence') as Evidence[],b,now);store.put('sites',{id:site.id,...a});
      if(Object.values(a.gates).some((g:any)=>g.status==='FAIL')||a.blockers.some((x:string)=>/Drive-time|Enclosed office|capacity|Shared site excluded/.test(x)))continue;
      const unknown=Object.entries(a.gates).filter(([,g]:any)=>g.status==='UNKNOWN').map(([f])=>f);
      for(const fact of unknown){const caseId=id(site.id,fact);if(store.all('cases').some(c=>c.id===caseId&&c.status!=='resolved'))continue;
       const recipient=fact==='rent'?site.leasing_email:site.planning_email;const contact=store.all('contacts').find(c=>c.email===recipient);
       const valid=contact&&allowedContact(recipient,contact.source_url,contact.kind,contact.synthetic);
       store.put('cases',{id:caseId,site_id:site.id,listing_id:site.listing_id,fact,recipient:valid?recipient:null,contact_kind:contact?.kind??null,owner:fact==='rent'?'leasing_contact':'planning_authority',status:valid?'open':'escalated',created_at:now,next_action:valid?'send approved inquiry':'No verified published recipient; obtain official data',next_action_at:now,followups:0});
      }
     }
     const ingestReplies=async()=>{
     const pending=store.all('messages').filter(m=>m.status==='pending_model').map(m=>m.payload);
     for(const raw of [...pending,...await gmail.replies(store)]){
      const mid=id('inbound',raw.external_id);const existing=store.all('messages').find(m=>m.id===mid);if(existing&&existing.status!=='pending_model')continue;
      const c=store.all('cases').find(c=>raw.case_id?c.id===raw.case_id:c.listing_id===raw.site_listing_id&&c.fact===raw.fact);if(!c)continue;
      const answer=await model.classify(raw,c);store.put('messages',{id:mid,site_id:c.site_id,case_id:c.id,direction:'inbound',created_at:existing?.created_at??now,provider_id:raw.external_id,body:raw.body,payload:raw,status:answer.pending?'pending_model':'received',synthetic:gmail.fixture});if(!existing)run.counts.inbound++;
      if(answer.stop){const contact=store.all('contacts').find(x=>x.email===raw.from);if(contact)store.put('contacts',{id:contact.id,do_not_contact:true});store.put('cases',{id:c.id,status:'suppressed',next_action:'Contact requested stop'});continue;}
      if(answer.accepted){const site=store.all('sites').find(s=>s.id===c.site_id)!;const source=gmail.fixture?'fixture://gmail/'+raw.external_id:'https://mail.google.com/mail/u/0/#all/'+raw.external_id;
       const doc=rawDoc(store,{raw,data:answer.value,source_url:source,method:'email',synthetic:gmail.fixture},'gmail',now);
       evidence(store,site,c.fact,answer.value,source,now,b.evidence[c.fact+'_days']??7,c.fact==='zoning'?'authority_email':'written_quote',gmail.fixture,c.contact_kind,doc);store.put('cases',{id:c.id,status:'resolved',next_action:'Reassess site'});
      }
     }
     };
     await ingestReplies();
     for(const c of store.all('cases')){
      if(!['open','awaiting_reply'].includes(c.status)||Date.parse(c.next_action_at)>Date.parse(now))continue;
      const site=store.all('sites').find(s=>s.id===c.site_id)!;const contact=store.all('contacts').find(x=>x.email===c.recipient);
      if(!contact||contact.do_not_contact){store.put('cases',{id:c.id,status:'suppressed',next_action:'Do not contact'});continue;}
      if(mailPaused(store,b.mail,now))break;
      if(c.status==='awaiting_reply'&&c.followups>=b.mail.max_followups){store.put('cases',{id:c.id,status:'escalated',next_action:'No response after configured follow-ups'});continue;}
      if(!contactDue(store,site,c.recipient,now,b.mail.followup_days))continue;
      const previous=store.all('messages').find(m=>m.case_id===c.id&&['dispatching','uncertain'].includes(m.status));if(previous){store.put('cases',{id:c.id,status:'escalated',next_action:'Reconcile uncertain send; never blindly resend'});continue;}
      const attempt=store.all('messages').filter(m=>m.case_id===c.id&&m.direction==='outbound').length;
      const message={id:id(c.id,attempt),run_id:run.id,site_id:site.id,case_id:c.id,direction:'outbound',recipient:c.recipient,created_at:now,body:renderTemplate(c.fact,site),status:'dispatching',synthetic:gmail.fixture};
      store.put('messages',message);await store.save();
      try{const sent=await gmail.send(message);store.put('messages',{id:message.id,status:'sent',provider_id:sent.id,thread_id:sent.threadId});store.put('cases',{id:c.id,status:'awaiting_reply',followups:Math.max(0,attempt),next_action:'Await reply or follow up',next_action_at:shift(now,b.mail.followup_days)});run.counts.outbound++;}
      catch(e:any){store.put('messages',{id:message.id,status:'uncertain',error:e.message});store.put('cases',{id:c.id,status:'escalated',next_action:'Reconcile uncertain send'});if(e.status===429||e.status===403){store.state.controls.sending_paused=true;store.state.controls.pause_reason='Gmail quota or authorization error';}failed(stage,e,site.id);}
      await store.save();
     }
     await ingestReplies();
    }
    if(stage==='score')for(const site of store.all('sites')){const rent=latest(store,site.id,'rent');store.put('sites',{id:site.id,current_rent:current(rent,now)?rent!.value.monthly:null,...assess(site,store.all('evidence') as Evidence[],b,now)});const s=store.all('sites').find(x=>x.id===site.id)!;const value=score(s,b);store.put('scores',{id:id(site.id,now.slice(0,10)),site_id:site.id,as_of:now,...value});store.put('sites',{id:site.id,score:value});}
    if(stage==='report'){
     const report=dashboardData(store,config,registry,now);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'dashboard.json'),JSON.stringify(report,null,2)+'\n');
     await writeFile(path.join(directory,'digest.md'),`# DealerSource ${now.slice(0,10)}\n\n${report.mode} data. ${report.shortlist.length} viable sites; ${store.all('cases').filter(c=>c.status!=='resolved').length} unresolved cases.\n\n`+report.shortlist.map((s:Row)=>`- ${s.title}: USD ${s.current_rent}/month; score ${s.score.total}; ${s.shared?'SHARED':'standalone'}. All three gates pass with evidence.\n`).join(''));
    }
    run.stages.push({stage,status:'complete'});log('stage_complete',{stage});
   }catch(e){failed(stage,e);run.stages.push({stage,status:'failed'});}
   store.put('runs',run);await store.save();
  }
  if(model.requests.length)run.errors.push({stage:'model',message:'Scheduled agent responses pending; rerun after filling bounded responses'});
  run.provider_calls=registry.transport.calls;run.complete=run.errors.length===0;run.finished_at=now;store.put('runs',run);await store.save();await model.writeRequests(directory);const sharedReport=createReport(store,config,registry,now,run);await writeFile(path.join(directory,'report.json'),JSON.stringify(sharedReport,null,2)+'\n');if(store instanceof SupabaseStore)await store.publish(sharedReport);
  const report=dashboardData(store,config,registry,now);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'dashboard.json'),JSON.stringify(report,null,2)+'\n');log('run_complete',{...run.counts,viable:report.shortlist.length,errors:run.errors.length});return {...run,shortlist:report.shortlist,case_count:store.all('cases').length,model_requests:model.requests.length};
 }finally{if(owned)await store.close();}
}
export function dashboardData(store:Store,config:AppConfig,registry:Registry,now:string):Row {
 const sites=store.all('sites').map(s=>({...s,...assess(s,store.all('evidence') as Evidence[],config.business,now)}));
 return {generated_at:now,mode:sites.every(s=>s.synthetic)?'FIXTURE':'LIVE OR MIXED: inspect evidence provenance',shortlist:rank(sites),sites,cases:store.all('cases').map(({body,...c})=>c),evidence:store.all('evidence'),sources:store.all('sources'),runs:store.all('runs').map(r=>({id:r.id,started_at:r.started_at,complete:r.complete,counts:r.counts,errors:r.errors})),controls:store.state.controls,providers:registry.status(),business:config.business,expired:store.all('evidence').filter(e=>!current(e as Evidence,now)).map(e=>({id:e.id,site_id:e.site_id,fact:e.fact,expires_at:e.expires_at}))};
}
