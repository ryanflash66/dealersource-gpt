import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../src/config.ts';
import { build } from './build.ts';
export function serve(directory:string,port=3000):http.Server {
 const types:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url??'/', 'http://localhost');const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);const file=path.resolve(directory,name);if(!file.startsWith(path.resolve(directory)+path.sep))throw new Error('Invalid path');const content=await readFile(file);res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.end(content);}catch{res.statusCode=404;res.end('Not found');}});
 server.listen(port,'127.0.0.1');return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const directory=await build();const port=Number(process.env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');serve(directory,port);console.log(`DealerSource dashboard: http://127.0.0.1:${port} (fixture mode unless deployed Supabase public configuration is supplied)`);}
