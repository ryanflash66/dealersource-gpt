export type GateStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type Row = Record<string, any>;
export type Layer = 'geocoding'|'parcels'|'zoning'|'drive_time'|'traffic'|'flood'|'imagery'|'competitors'|'map_tiles'|'crawling'|'social'|'email'|'llm';
export const TABLES = ['sources','raw_documents','listings','sites','parcels','evidence','cases','messages','contacts','scores','runs'] as const;
export type Table = typeof TABLES[number];
export interface Evidence { id:string; site_id:string; fact:string; value:any; source_url:string; fetched_at:string; expires_at:string; method:string; source_kind:string; synthetic:boolean; scope:string; raw_document_id?:string; }
export interface Gate { status:GateStatus; reason:string; evidence_id:string|null; source_url:string|null; fetched_at:string|null; expires_at:string|null; }
export interface ProviderResult { data:any; raw:any; source_url:string; method:string; synthetic:boolean; }
export interface Provider { layer:Layer; id:string; paid:boolean; fixture:boolean; execute(input:Row):Promise<ProviderResult>; }
export interface AppConfig { business:Row; providers:{paid_enabled:boolean;selections:Record<Layer,string>}; sources:{subreddits:string[];sources:Row[]}; }
export interface State { version:number; revision:number; tables:Record<Table,Row[]>; controls:{sending_paused:boolean;pause_reason:string|null}; }
export interface Store { state:State; all(table:Table):Row[]; put(table:Table,row:Row):Row; save():Promise<void>; close():Promise<void>; }
