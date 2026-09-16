import { readFile,writeFile,mkdir,rename,rm,stat } from 'node:fs/promises';
import path from 'node:path';
import { TABLES } from './types.ts';
import type { Row,State,Store,Table } from './types.ts';
import { id } from './util.ts';
export function emptyState():State { return {version:1,revision:0,tables:Object.fromEntries(TABLES.map(t=>[t,[]])) as State['tables'],controls:{sending_paused:false,pause_reason:null}}; }
export function validateState(s:State):void { if(s.version!==1||!TABLES.every(t=>Array.isArray(s.tables?.[t]))||!s.controls)throw new Error('Unsupported or corrupt database state'); }
export class MemoryStore implements Store {
 state:State;
 constructor(state=emptyState()){validateState(state);this.state=state;}
 all(table:Table):Row[]{return this.state.tables[table];}
 put(table:Table,row:Row):Row { if(!row.id)throw new Error('Row ID required');const list=this.all(table);const i=list.findIndex(r=>r.id===row.id);if(i<0)list.push(structuredClone(row));else list[i]={...list[i],...structuredClone(row)};return list.find(r=>r.id===row.id)!; }
 async save():Promise<void>{this.state.revision++;}
 async close():Promise<void>{}
}
export class FileStore extends MemoryStore {
 file:string;lock:string;held=false;
 constructor(file:string,state:State){super(state);this.file=file;this.lock=file+'.lock';}
 static async open(file:string):Promise<FileStore>{
  await mkdir(path.dirname(file),{recursive:true});
  try{await mkdir(file+'.lock')}catch(e:any){if(e.code==='EEXIST')throw new Error('Database locked by another run; investigate before removing the lock');throw e;}
  try{let s=emptyState();try{s=JSON.parse(await readFile(file,'utf8'))}catch(e:any){if(e.code!=='ENOENT')throw e;}
   const store=new FileStore(file,s);store.held=true;return store;
  }catch(e){await rm(file+'.lock',{recursive:true,force:true});throw e;}
 }
 async save(){if(!this.held)throw new Error('Store closed');this.state.revision++;const tmp=this.file+'.tmp';await writeFile(tmp,JSON.stringify(this.state,null,2)+'\n',{mode:0o600});await rename(tmp,this.file);}
 async close(){if(this.held){this.held=false;await rm(this.lock,{recursive:true,force:true});}}
}
export type RequestFn=(url:string,options?:any)=>Promise<any>;
export class SupabaseStore extends MemoryStore {
 url:string;key:string;request:RequestFn;lease:string;
 constructor(url:string,key:string,request:RequestFn,state:State,lease:string){super(state);this.url=url;this.key=key;this.request=request;this.lease=lease;}
 static async open(url:string,key:string,request:RequestFn):Promise<SupabaseStore>{
  const lease=id(Date.now(),Math.random());
  const result=await request(url.replace(/\/$/,'')+'/rest/v1/rpc/acquire_pipeline',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({lease_token:lease})});
  if(!result?.state)throw new Error('Supabase lease/state unavailable');return new SupabaseStore(url.replace(/\/$/,''),key,request,result.state,lease);
 }
 async save(){const revision=this.state.revision;const next=structuredClone(this.state);next.revision++;
  await this.request(this.url+'/rest/v1/rpc/save_pipeline',{method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({lease_token:this.lease,expected_revision:revision,new_state:next})});this.state=next;
 }
 async publish(report:Row){await this.request(this.url+'/rest/v1/rpc/publish_dashboard',{method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({new_report:report})});}
 async close(){await this.request(this.url+'/rest/v1/rpc/release_pipeline',{method:'POST',headers:{apikey:this.key,Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({lease_token:this.lease})});}
}
export async function readState(file:string):Promise<State>{try{const s=JSON.parse(await readFile(file,'utf8'));validateState(s);return s}catch(e:any){if(e.code==='ENOENT')return emptyState();throw e;}}
