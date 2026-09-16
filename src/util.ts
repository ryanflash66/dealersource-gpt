import { createHash } from 'node:crypto';
export const DAY=86_400_000;
export function id(...parts:any[]):string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24); }
export function iso(date:Date|string):string { const d=new Date(date); if(!Number.isFinite(d.getTime()))throw new Error('Invalid date');return d.toISOString(); }
export function shift(date:string,days:number):string { return new Date(new Date(date).getTime()+days*DAY).toISOString(); }
export function canonical(text:string):string { return String(text).normalize('NFKC').toLowerCase().replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/[^a-z0-9]+/g,' ').trim(); }
export function cents(value:any):number|null { if(typeof value!=='number'&&typeof value!=='string')return null;const str=String(value);if(!/^\d+(\.\d{1,2})?$/.test(str))return null;const [a,b='']=str.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null; }
export function safeURL(value:string,allowFixture=false):URL { const url=new URL(value);if(allowFixture&&url.protocol==='fixture:')return url;if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsafe source URL');const host=url.hostname.replace(/^\[|\]$/g,'');if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(host)||host.endsWith('.local'))throw new Error('Private source destination denied');return url; }
export function email(value:any):boolean { return typeof value==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)&&!/[\r\n]/.test(value); }
export function escapeHTML(value:any):string { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export function jsonParse(text:string):any { try{return JSON.parse(text)}catch{throw new Error('Invalid JSON-compatible YAML or payload')} }
export function unique<T>(items:T[]):T[] { return [...new Set(items)]; }
