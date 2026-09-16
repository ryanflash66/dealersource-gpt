import type { Row } from './types.ts';
export class NetworkDisabled extends Error { constructor(){super('Network is disabled in offline mode');this.name='NetworkDisabled';} }
export class Transport {
 offline:boolean;paidEnabled:boolean;calls:Row[]=[];fetcher:typeof fetch;
 constructor(offline:boolean,paidEnabled=false,fetcher:typeof fetch=globalThis.fetch){this.offline=offline;this.paidEnabled=paidEnabled;this.fetcher=fetcher;}
 async request(url:string,options:any={},meta:Row={}):Promise<any>{
  if(this.offline)throw new NetworkDisabled();
  if(meta.paid&&!this.paidEnabled)throw new Error('Paid provider disabled');
  const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Unsafe endpoint');
  if(u.hostname==='nominatim.openstreetmap.org'||u.hostname==='tile.openstreetmap.org'||u.hostname==='vector.openstreetmap.org')throw new Error('Public OSM service forbidden for scheduled runs');
  this.calls.push({provider:meta.provider??'storage',cost_class:meta.paid?'paid':'free-or-self-hosted',endpoint:u.origin+u.pathname,method:options.method??'GET'});
  const response=await this.fetcher(url,{...options,redirect:'error',signal:options.signal??AbortSignal.timeout(15000)});
  if(!response.ok){const e:any=new Error(`Provider HTTP ${response.status}`);e.status=response.status;e.retryAfter=response.headers.get('retry-after');throw e;}
  if(options.responseType==='text')return response.text();
  const text=await response.text();if(text.length>8_000_000)throw new Error('Response limit exceeded');return text?JSON.parse(text):{};
 }
}
