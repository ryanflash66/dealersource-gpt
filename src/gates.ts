import type { Evidence,Gate,Row } from './types.ts';
import { cents } from './util.ts';
export function current(e:Evidence|undefined,now:string):boolean {return !!e&&!!e.source_url&&!!e.method&&Number.isFinite(Date.parse(e.fetched_at))&&Number.isFinite(Date.parse(e.expires_at))&&Date.parse(e.fetched_at)<=Date.parse(now)&&Date.parse(e.expires_at)>Date.parse(now);}
function result(status:Gate['status'],reason:string,e?:Evidence):Gate{return {status,reason,evidence_id:e?.id??null,source_url:e?.source_url??null,fetched_at:e?.fetched_at??null,expires_at:e?.expires_at??null};}
export function gate(fact:string,e:Evidence|undefined,b:Row,now:string):Gate {
 if(!current(e,now))return result('UNKNOWN',e?'Evidence expired or invalid':'Evidence missing',e);
 const v=e!.value;
 if(fact==='rent'){
  const n=cents(v?.monthly);if(n===null||v?.written!==true||v?.currency!=='USD')return result('UNKNOWN','A written USD base rent quote is required',e);
  return result(n>=cents(b.rent.min_monthly)!&&n<=cents(b.rent.max_monthly)!?'PASS':'FAIL','Written base rent compared with both hard bounds',e);
 }
 if(fact==='zoning'){
  if(!v?.official||!v.section||!['authority_email','official_form_response','official_layer_and_use_table'].includes(e!.method))return result('UNKNOWN','Competent official source and exact citation required',e);
  if(e!.method==='official_layer_and_use_table'&&(!v.layer_url||!v.use_table_url))return result('UNKNOWN','Both official zoning layer and use table required',e);
  if(v.status==='prohibited')return result('FAIL','Used motor vehicle sales prohibited',e);
  if(v.status==='permitted'||(v.status==='conditional'&&v.conditional_verified===true))return result('PASS','Written/official permitted use supported',e);
  return result('UNKNOWN','Conditional use is not verified or permitted use is unknown',e);
 }
 if(fact==='flood'){
  if(v?.coverage_complete!==true||v?.geometry_checked!==true||!Number.isFinite(v.high_risk_fraction)||v.high_risk_fraction<0||v.high_risk_fraction>1||!v.centroid_zone)return result('UNKNOWN','Complete centroid and area assessment required',e);
  const high=b.flood.high_risk_zones.includes(String(v.centroid_zone).toUpperCase());
  return result(!high&&v.high_risk_fraction<.5?'PASS':'FAIL','Centroid and more than half the parcel must be outside high-risk zones',e);
 }
 return result('UNKNOWN','Unsupported gate',e);
}
export function assess(site:Row,evidence:Evidence[],b:Row,now:string):Row {
 const latest=(fact:string)=>evidence.filter(e=>e.site_id===site.id&&e.fact===fact).sort((a,c)=>Date.parse(c.fetched_at)-Date.parse(a.fetched_at))[0];
 const gates=Object.fromEntries(['zoning','rent','flood'].map(f=>[f,gate(f,latest(f),b,now)]));
 const blockers:string[]=[];if(site.available!==true)blockers.push('Availability unknown or unavailable');
 if(b.site.office_required&&site.office?.enclosed!==true)blockers.push('Enclosed office required');
 if(b.site.office_required&&(!(site.office?.sqft>=b.dealer.minimum_office_sqft)||site.office?.separate_entrance!==true))blockers.push('Established office size/entrance check not met');
 if(!(site.display_count>=b.site.min_vehicle_display))blockers.push('Vehicle display capacity not met');
 if(site.signage_available!==true||site.records_storage!==true||site.public_contact_hours!==true)blockers.push('Established-place operational checks unresolved');
 if(site.shared&&(b.site.shared_lot==='exclude'||site.sublease_consent!==true))blockers.push('Shared site excluded or written sublease consent missing');
 if(!Number.isFinite(site.drive?.minutes)||site.drive.minutes>b.search.max_drive_minutes||site.drive.inside_isochrone!==true)blockers.push('Drive-time search boundary not verified');
 const viable=Object.values(gates).every((g:any)=>g.status==='PASS')&&blockers.length===0;
 const warnings:string[]=[];if(site.shared)warnings.push('Shared/subleased site: last-resort ranking');if(latest('flood')?.value?.centroid_zone==='X_SHADED')warnings.push('Shaded X flood warning');
 const failed=Object.values(gates).some((g:any)=>g.status==='FAIL');return {gates,blockers,warnings,viable,stage:viable?'verified':failed||blockers.length?'excluded':'verification',assessed_at:now};
}
export function score(site:Row,b:Row):Row {
 const clamp=(n:number)=>Math.max(0,Math.min(1,n));const weights=b.ranking.weights;
 const rent=site.current_rent;const width=b.rent.max_monthly-b.rent.min_monthly;
 const parts={traffic:clamp((site.traffic?.aadt??0)/b.ranking.traffic_reference),visibility:clamp(.5*clamp((site.imagery?.frontage_m??0)/b.ranking.frontage_reference_m)+.2*(site.imagery?.corner?1:0)+.3*clamp(site.imagery?.line_of_sight??0)),distance:clamp(1-(site.drive?.minutes??b.search.max_drive_minutes)/b.search.max_drive_minutes),rent:width?clamp((b.rent.max_monthly-(rent??b.rent.max_monthly))/width):1,competitors:1/(1+Math.max(0,site.competitors?.count??100))};
 const totalWeight=Object.values(weights).reduce((a:number,v:any)=>a+v,0);const weighted=Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,Math.round(v*weights[k]/totalWeight*10000)/100]));
 return {total:Math.round(Object.values(weighted).reduce((a:number,v:any)=>a+v,0)*100)/100,components:parts,weighted,missing_context:['traffic','imagery','competitors'].filter(k=>!site[k])};
}
export function rank(sites:Row[]):Row[]{return sites.filter(s=>s.viable).sort((a,b)=>Number(!!a.shared)-Number(!!b.shared)||(b.score?.total??0)-(a.score?.total??0)||a.id.localeCompare(b.id));}
