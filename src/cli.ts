import path from 'node:path';
import { runPipeline,STAGES } from './pipeline.ts';
import { ROOT } from './config.ts';
export function parseArgs(args:string[]){const opts:any={};const used=new Set();for(let i=0;i<args.length;i++){
 const a=args[i];if(used.has(a))throw new Error('Duplicate option '+a);used.add(a);
 if(a==='--offline')opts.offline=true;else if(a==='--quiet')opts.quiet=true;else if(a==='--resume-mail')opts.resumeMail=true;
 else if(['--day','--data-dir','--config-dir','--stage'].includes(a)){const value=args[++i];if(!value||value.startsWith('--'))throw new Error('Missing option value');opts[{'--day':'day','--data-dir':'dataDir','--config-dir':'configDir','--stage':'stage'}[a]!]=value;}
 else if(a==='--help')opts.help=true;else throw new Error('Unknown option '+a);
 }if(opts.stage&&!STAGES.includes(opts.stage))throw new Error('Unknown pipeline stage');return opts;}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(ROOT,'src','cli.ts')){
 try{const o=parseArgs(process.argv.slice(2));if(o.help)console.log('npm run pipeline -- --offline [--day YYYY-MM-DD] [--data-dir PATH] [--stage discover|resolve|enrich|verify|score|report] [--quiet] [--resume-mail]');
 else{const r=await runPipeline(o);console.log(JSON.stringify({run_id:r.id,complete:r.complete,outbound:r.counts.outbound,inbound:r.counts.inbound,viable:r.shortlist.length,errors:r.errors.length,provider_calls:r.provider_calls.length,model_requests:r.model_requests}));if(!r.complete)process.exitCode=1;}}
 catch(e:any){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
}
