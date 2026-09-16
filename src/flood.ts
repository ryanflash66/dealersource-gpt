import { pointInRing } from './providers/index.ts';
import type { Row } from './types.ts';
export function polygonArea(ring:number[][]):number {let a=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];a+=p[0]*q[1]-q[0]*p[1];}return Math.abs(a)/2;}
function signed(ring:number[][]):number {let a=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];a+=p[0]*q[1]-q[0]*p[1];}return a/2;}
function clip(subject:number[][],clipper:number[][]):number[][] {
 let out=subject.slice();const orientation=signed(clipper)>=0?1:-1;
 for(let k=0;k<clipper.length-1;k++){
  const a=clipper[k],b=clipper[k+1],previous=out;out=[];if(!previous.length)break;
  const inside=(p:number[])=>orientation*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))>=-1e-12;
  const intersect=(p:number[],q:number[])=>{const ax=b[0]-a[0],ay=b[1]-a[1],dx=q[0]-p[0],dy=q[1]-p[1];const den=ax*dy-ay*dx;if(Math.abs(den)<1e-15)return q;const t=(ay*(p[0]-a[0])-ax*(p[1]-a[1]))/den;return [p[0]+t*dx,p[1]+t*dy];};
  for(let i=0;i<previous.length;i++){const p=previous[i],q=previous[(i+1)%previous.length];if(inside(p)&&inside(q))out.push(q);else if(inside(p)&&!inside(q))out.push(intersect(p,q));else if(!inside(p)&&inside(q))out.push(intersect(p,q),q);}
 }
 return out;
}
function convex(ring:number[][]):boolean {let sign=0;for(let i=0;i<ring.length-2;i++){const a=ring[i],b=ring[i+1],c=ring[i+2];const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-12)continue;const s=Math.sign(cross);if(sign&&sign!==s)return false;sign=s;}return !!sign;}
export function measureFlood(parcel:Row,features:Row[],highZones:string[]):Row {
 const ring=parcel?.geometry?.coordinates?.[0];if(parcel?.geometry?.type!=='Polygon'||parcel.geometry.coordinates.length!==1||!ring||!convex(ring))return {coverage_complete:false,geometry_checked:false,reason:'Use the supplied PostGIS flood function for non-convex/multipart geometries'};
 // A local planar transform preserves area ratios for this small parcel, not survey-grade acreage.
 const latitude=ring.reduce((s:number,p:number[])=>s+p[1],0)/ring.length;
 const project=(r:number[][])=>r.map(p=>[p[0]*Math.cos(latitude*Math.PI/180),p[1]]);
 const projected=project(ring),area=polygonArea(projected);if(!area)return {coverage_complete:false,geometry_checked:false};
 let covered=0,high=0;const centroid=parcel.centroid;let zone:string|null=null;
 for(const f of features){const rings=f.geometry?.rings;if(!rings||rings.length!==1||!convex(rings[0]))return {coverage_complete:false,geometry_checked:false,reason:'Unsupported overlay geometry requires PostGIS'};
  const overlap=polygonArea(clip(project(rings[0]),projected));covered+=overlap;const name=String(f.attributes?.FLD_ZONE??'').toUpperCase();if(highZones.includes(name))high+=overlap;
  if(pointInRing(centroid,rings[0])){const shaded=name==='X'&&String(f.attributes?.ZONE_SUBTY??'').toUpperCase().includes('0.2');if(!zone||highZones.includes(name))zone=shaded?'X_SHADED':name;}
 }
 return {centroid_zone:zone,high_risk_fraction:Math.min(1,high/area),coverage_complete:covered/area>=.999&&covered/area<=1.001&&!!zone,geometry_checked:true};
}
