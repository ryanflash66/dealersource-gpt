import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Layer,Provider,ProviderResult,Row,AppConfig } from '../types.ts';
import { ROOT } from '../config.ts';
import { shift,safeURL } from '../util.ts';
import { Transport } from '../transport.ts';

export const CATALOG:Record<Layer,Record<string,{env:string;paid?:boolean;credential?:string}>>={
 geocoding:{census:{env:'CENSUS_GEOCODER_URL'},nominatim:{env:'NOMINATIM_URL'},google:{env:'GOOGLE_GEOCODING_URL',paid:true,credential:'GOOGLE_MAPS_API_KEY'}},
 parcels:{nconemap:{env:'PARCELS_URL'},county:{env:'COUNTY_PARCELS_URL'},regrid:{env:'REGRID_URL',paid:true,credential:'REGRID_TOKEN'}},
 zoning:{official:{env:'ZONING_URL'}},
 drive_time:{osrm:{env:'OSRM_URL'},valhalla:{env:'VALHALLA_URL'},ors:{env:'ORS_URL',credential:'ORS_API_KEY'},google:{env:'GOOGLE_DISTANCE_URL',paid:true,credential:'GOOGLE_MAPS_API_KEY'}},
 traffic:{ncdot:{env:'NCDOT_AADT_URL'}},flood:{fema:{env:'FEMA_NFHL_URL'}},
 imagery:{nconemap:{env:'ORTHOIMAGERY_URL'},mapillary:{env:'MAPILLARY_URL',credential:'MAPILLARY_TOKEN'},google:{env:'GOOGLE_STREETVIEW_URL',paid:true,credential:'GOOGLE_MAPS_API_KEY'}},
 competitors:{overpass:{env:'OVERPASS_URL'},google:{env:'GOOGLE_PLACES_URL',paid:true,credential:'GOOGLE_MAPS_API_KEY'}},
 map_tiles:{pmtiles:{env:'PMTILES_URL'},mapbox:{env:'MAPBOX_STYLE_URL',paid:true,credential:'MAPBOX_TOKEN'},google:{env:'GOOGLE_MAP_TILES_URL',paid:true,credential:'GOOGLE_MAPS_API_KEY'}},
 crawling:{anycrawl:{env:'ANYCRAWL_URL'},cloud:{env:'ANYCRAWL_CLOUD_URL',paid:true,credential:'ANYCRAWL_API_KEY'}},
 social:{reddit:{env:'REDDIT_API_URL',credential:'REDDIT_ACCESS_TOKEN'}},
 email:{gmail:{env:'GMAIL_ACCESS_TOKEN'}},
 llm:{scheduled:{env:'AGENT_RESPONSES_PATH'},claude_api:{env:'ANTHROPIC_API_KEY',paid:true}}
};

async function fixtureResult(layer:Layer,provider:string,input:Row):Promise<ProviderResult>{
 const fixtures=JSON.parse(await readFile(path.join(ROOT,'fixtures','sites.json'),'utf8'));
 const s=fixtures.find((r:Row)=>r.external_id===input.external_id)||input.fixture;
 const now=(input.now??new Date().toISOString()).slice(0,10)+'T00:00:00.000Z';let data:any=null;
 if(layer==='crawling')data=JSON.parse(await readFile(path.join(ROOT,'fixtures','raw-listings.json'),'utf8'));
 else if(layer==='llm')data=input.raw?.listings??(input.raw?.value?input.raw:null);
 else if(layer==='social')data={listings:[],signals:[],note:'No personal contacts inferred from social posts'};
 else if(layer==='map_tiles')data={url:null,renderer:'offline-svg',attribution:'Synthetic original fixture map'};
 else if(s){
  const citation=(fact:string)=>`fixture://${fact}/${s.parcel_id}/${encodeURIComponent(s.suite)}`;
  if(layer==='geocoding')data={address:s.address,lat:s.lat+(provider==='nominatim'?.0001:0),lon:s.lon,identity:provider+':'+s.external_id};
  if(layer==='parcels')data={id:s.parcel_id,acreage:.25,centroid:[s.lon,s.lat],geometry:{type:'Polygon',coordinates:[[[s.lon-.001,s.lat-.001],[s.lon+.001,s.lat-.001],[s.lon+.001,s.lat+.001],[s.lon-.001,s.lat+.001],[s.lon-.001,s.lat-.001]]]},area_m2:1000};
  if(layer==='zoning')data={status:s.zoning_status,conditional_verified:s.conditions_met,official:true,section:s.zoning_section,layer_url:citation('zoning-layer'),use_table_url:citation('use-table'),confirmed_at:shift(now,-s.zoning_age_days),planning_email:s.planning_email,planning_contact_source:citation('official-contact')};
  if(layer==='drive_time')data={minutes:s.minutes,inside_isochrone:s.inside_isochrone,method:provider==='osrm'?'routing-threshold':'isochrone',home_base:input.home_base};
  if(layer==='traffic')data={aadt:s.traffic,fronting_road_id:'fixture-road-'+s.parcel_id,year:2025};
  if(layer==='flood')data={centroid_zone:s.centroid_zone,high_risk_fraction:s.high_risk_fraction,coverage_complete:s.flood_coverage_complete,geometry_checked:true};
  if(layer==='imagery')data={frontage_m:s.frontage_m,corner:s.corner,line_of_sight:s.line_of_sight,captured_at:now,image_url:'/fixture-site.svg'};
  if(layer==='competitors')data={count:s.competitors,radius_m:input.radius_m,brokers:[]};
 }
 return {data,raw:{fixture:true,layer,provider,data},source_url:`fixture://${layer}/${provider}/${input.external_id??'collection'}`,method:`fixture:${provider}`,synthetic:true};
}

export class FixtureProvider implements Provider {
 layer:Layer;id:string;paid:boolean;fixture=true;
 constructor(layer:Layer,id:string,paid=false){this.layer=layer;this.id=id;this.paid=paid;}
 execute(input:Row){return fixtureResult(this.layer,this.id,input);}
}

export class HTTPProvider implements Provider {
 layer:Layer;id:string;paid:boolean;fixture=false;endpoint:string;key:string;transport:Transport;env:NodeJS.ProcessEnv;
 constructor(layer:Layer,id:string,endpoint:string,key:string,transport:Transport,env:NodeJS.ProcessEnv){this.layer=layer;this.id=id;this.endpoint=endpoint;this.key=key;this.transport=transport;this.env=env;this.paid=!!CATALOG[layer][id].paid;}
 async execute(input:Row):Promise<ProviderResult>{
  let url=this.endpoint;let options:any={};let data:any;const h:Row={};
  if(this.key)h.Authorization='Bearer '+this.key;
  if(this.layer==='geocoding'){
   const u=new URL(url);
   if(this.id==='census'){u.searchParams.set('address',input.address);u.searchParams.set('benchmark','Public_AR_Current');u.searchParams.set('format','json');}
   else if(this.id==='nominatim'){u.searchParams.set('q',input.address);u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');h['User-Agent']='DealerSource/1.0';}
   else {u.searchParams.set('address',input.address);u.searchParams.set('key',this.key);delete h.Authorization;}
   url=u.toString();
  } else if(this.layer==='drive_time'&&this.id==='osrm'){
   url=url.replace(/\/$/,'')+`/route/v1/driving/${input.home_lon},${input.home_lat};${input.lon},${input.lat}?overview=false`;
  } else if(this.layer==='drive_time'&&this.id==='google'){
   const u=new URL(url);u.searchParams.set('origins',input.home_base);u.searchParams.set('destinations',`${input.lat},${input.lon}`);u.searchParams.set('key',this.key);url=u.toString();delete h.Authorization;
  } else if(this.layer==='drive_time'&&this.id==='ors'){
   h.Authorization=this.key;options={method:'POST',body:JSON.stringify({locations:[[input.home_lon,input.home_lat]],range:[input.max_drive_minutes*60]})};h['Content-Type']='application/json';
  } else if(this.layer==='drive_time'&&this.id==='valhalla'){
   options={method:'POST',body:JSON.stringify({locations:[{lat:input.home_lat,lon:input.home_lon},{lat:input.lat,lon:input.lon}],costing:'auto',units:'kilometers'})};h['Content-Type']='application/json';
  } else if(this.layer==='crawling'){
   safeURL(input.url);options={method:'POST',body:JSON.stringify({url:input.url,engine:'cheerio',formats:['html','markdown']})};h['Content-Type']='application/json';
  } else if(this.layer==='social'){
   const u=new URL(url.replace(/\/$/,'')+'/search');u.searchParams.set('q',`subreddit:${input.subreddit} (lease OR vacant OR closing)`);u.searchParams.set('sort','new');u.searchParams.set('limit','50');url=u.toString();h['User-Agent']='DealerSource/1.0';
  } else if(this.layer==='competitors'&&this.id==='overpass'){
   const around=`(around:${Number(input.radius_m)},${Number(input.lat)},${Number(input.lon)})`;const query=`[out:json][timeout:20];(nwr${around}[shop=car];nwr${around}[office=estate_agent];nwr${around}[office=property_management];);out center;`;
   options={method:'POST',body:new URLSearchParams({data:query}).toString()};h['Content-Type']='application/x-www-form-urlencoded';
  } else if(this.layer==='competitors'&&this.id==='google'){
   h['X-Goog-Api-Key']=this.key;h['X-Goog-FieldMask']='places.id,places.displayName,places.location';delete h.Authorization;h['Content-Type']='application/json';options={method:'POST',body:JSON.stringify({includedTypes:['car_dealer'],maxResultCount:20,locationRestriction:{circle:{center:{latitude:input.lat,longitude:input.lon},radius:input.radius_m}}})};
  } else if(this.layer==='map_tiles'){
   return {data:{url,renderer:this.id==='google'?'google':'maplibre',attribution:this.env.MAP_ATTRIBUTION??'Configured map provider'},raw:{configured_url:url},source_url:new URL(url).origin,method:this.id,synthetic:false};
  } else if(this.layer==='imagery'){
   if(this.id==='google')return {data:{image_url:null,frontage_m:null,corner:null,line_of_sight:null,reason:'Imagery interpretation requires a sourced model result; metadata alone is not visibility evidence'},raw:{provider:this.id},source_url:new URL(url).origin,method:this.id,synthetic:false};
   const u=new URL(url);u.searchParams.set('bbox',`${input.lon-.002},${input.lat-.002},${input.lon+.002},${input.lat+.002}`);if(this.id==='mapillary'){u.searchParams.set('fields','id,captured_at,thumb_1024_url,geometry');u.searchParams.set('access_token',this.key);delete h.Authorization;}url=u.toString();
  } else {
   const u=new URL(url);u.searchParams.set('f','json');u.searchParams.set('outFields','*');u.searchParams.set('returnGeometry','true');u.searchParams.set('outSR','4326');
   if(input.parcel?.geometry&&this.layer==='flood'){u.searchParams.set('geometry',JSON.stringify({rings:input.parcel.geometry.coordinates,spatialReference:{wkid:4326}}));u.searchParams.set('geometryType','esriGeometryPolygon');}
   else {u.searchParams.set('geometry',`${input.lon},${input.lat}`);u.searchParams.set('geometryType','esriGeometryPoint');}
   u.searchParams.set('inSR','4326');u.searchParams.set('spatialRel','esriSpatialRelIntersects');url=u.toString();
  }
  options.headers={...h,...options.headers};const raw=await this.transport.request(url,options,{provider:`${this.layer}:${this.id}`,paid:this.paid});
  data=normalizeResponse(this.layer,this.id,raw,input,this.env);
  return {data,raw,source_url:this.endpoint.split('?')[0],method:this.id,synthetic:false};
 }
}

export function normalizeResponse(layer:Layer,provider:string,raw:Row,input:Row,env:NodeJS.ProcessEnv={}):any{
 if(raw.error)throw new Error('Provider returned an error payload');
 if(raw.dealersource)return raw.dealersource;
 if(layer==='geocoding'){
  if(provider==='census'){const x=raw.result?.addressMatches?.[0];return x?{address:x.matchedAddress,lat:x.coordinates.y,lon:x.coordinates.x,identity:x.tigerLine?.tigerLineId}:null;}
  if(provider==='nominatim'){const x=Array.isArray(raw)?raw[0]:null;return x?{address:x.display_name,lat:Number(x.lat),lon:Number(x.lon),identity:String(x.place_id)}:null;}
  const x=raw.results?.[0];return x?{address:x.formatted_address,lat:x.geometry.location.lat,lon:x.geometry.location.lng,identity:x.place_id}:null;
 }
 if(layer==='drive_time'){
  let minutes=provider==='osrm'?raw.routes?.[0]?.duration/60:provider==='google'?raw.rows?.[0]?.elements?.[0]?.duration?.value/60:provider==='valhalla'?raw.trip?.summary?.time/60:NaN;
  if(provider==='ors'){const ring=raw.features?.[0]?.geometry?.coordinates?.[0];return {minutes:null,inside_isochrone:ring?pointInRing([input.lon,input.lat],ring):null,method:'isochrone'};}
  return Number.isFinite(minutes)?{minutes,inside_isochrone:minutes<=input.max_drive_minutes,method:'routing-threshold'}:null;
 }
 if(layer==='competitors'){const elements=raw.elements??[];return {count:provider==='overpass'?elements.filter((e:Row)=>e.tags?.shop==='car').length:(raw.places??[]).length,radius_m:input.radius_m,brokers:provider==='overpass'?elements.filter((e:Row)=>['estate_agent','property_management'].includes(e.tags?.office)).map((e:Row)=>({name:e.tags?.name??'Broker',url:e.tags?.website??e.tags?.['contact:website']??null})).filter((e:Row)=>e.url):[]};}
 if(layer==='crawling')return {html:raw.data?.html??raw.html??raw.data?.markdown??raw.markdown??'',listings:raw.listings};
 if(layer==='social')return {signals:(raw.data?.children??[]).map((x:Row)=>({id:x.data.id,title:x.data.title,url:'https://www.reddit.com'+x.data.permalink,body:x.data.selftext})),listings:[]};
 const features=raw.features??[];if(raw.exceededTransferLimit)throw new Error('Provider result truncated');const feature=features[0];const a=feature?.attributes??{};
 if(layer==='parcels'){const key=env.PARCEL_ID_FIELD??'PARNO';const rings=feature?.geometry?.rings;if(!a[key]||!rings)return null;return {id:String(a[key]),geometry:{type:'Polygon',coordinates:rings},centroid:polygonCentroid(rings),acreage:a[env.PARCEL_ACRES_FIELD??'GISACRES']??null};}
 if(layer==='zoning')return {status:'unknown',official:true,district:a[env.ZONING_DISTRICT_FIELD??'ZONE']??null,section:null,layer_url:env.ZONING_URL,use_table_url:env.ZONING_USE_TABLE_URL??null,planning_email:env.PLANNING_EMAIL??null,planning_contact_source:env.PLANNING_CONTACT_SOURCE??null};
 if(layer==='traffic')return a[env.AADT_FIELD??'AADT']?{aadt:Number(a[env.AADT_FIELD??'AADT']),fronting_road_id:a[env.ROAD_ID_FIELD??'ROAD_ID'],year:a.YEAR}:null;
 if(layer==='flood')return {features,coverage_complete:raw.coverage_complete===true,geometry_checked:false};
 if(layer==='imagery')return {image_url:raw.data?.[0]?.thumb_1024_url??null,captured_at:raw.data?.[0]?.captured_at??null,frontage_m:null,corner:null,line_of_sight:null};
 return raw;
}
export function polygonCentroid(rings:number[][][]):number[]{let area=0,x=0,y=0;for(const ring of rings)for(let i=0;i<ring.length-1;i++){const p=ring[i],q=ring[i+1],cross=p[0]*q[1]-q[0]*p[1];area+=cross;x+=(p[0]+q[0])*cross;y+=(p[1]+q[1])*cross;}if(Math.abs(area)<1e-12)throw new Error('Invalid parcel geometry');return [x/(3*area),y/(3*area)];}
export function pointInRing(point:number[],ring:number[][]):boolean {let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>point[1])!==(yj>point[1])&&point[0]<(xj-xi)*(point[1]-yi)/(yj-yi)+xi)inside=!inside;}return inside;}

export class Registry {
 config:AppConfig;transport:Transport;env:NodeJS.ProcessEnv;offline:boolean;
 constructor(config:AppConfig,offline:boolean,env:NodeJS.ProcessEnv=process.env,transport?:Transport){this.config=config;this.offline=offline;this.env=env;this.transport=transport??new Transport(offline,config.providers.paid_enabled);
  for(const [layer,provider]of Object.entries(config.providers.selections))if(!CATALOG[layer as Layer]?.[provider])throw new Error(`Unknown provider ${layer}:${provider}`);
 }
 get(layer:Layer):Provider {
  const name=this.config.providers.selections[layer],spec=CATALOG[layer][name];if(spec.paid&&!this.config.providers.paid_enabled)throw new Error(`Paid provider disabled: ${layer}:${name}`);
  const endpoint=this.env[spec.env];const key=spec.credential?this.env[spec.credential]:'';
  if(this.offline||!endpoint||(spec.credential&&!key))return new FixtureProvider(layer,name,!!spec.paid);
  if(['email','llm'].includes(layer))throw new Error('Use the specialized mail/model adapter');
  return new HTTPProvider(layer,name,endpoint,key??'',this.transport,this.env);
 }
 status():Row[]{return Object.entries(this.config.providers.selections).map(([layer,name])=>{const s=CATALOG[layer as Layer][name];return {layer,provider:name,paid:!!s.paid,enabled:!s.paid||this.config.providers.paid_enabled,mode:this.offline||!this.env[s.env]||(s.credential&&!this.env[s.credential])?'fixture':'configured-live'};});}
}
