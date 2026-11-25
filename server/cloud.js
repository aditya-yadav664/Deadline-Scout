import {databaseOptions} from './cloud-database.js';
import http from 'node:http';
import pg from 'pg';
import {timingSafeEqual} from 'node:crypto';
import {createApp,isPublicFilePath} from './app.js';
import {CloudStore} from './cloud-store.js';
const pool=new pg.Pool({...(process.env.DATABASE_URL?databaseOptions(process.env.DATABASE_URL):{}),max:3,idleTimeoutMillis:60000});
const defaultEnv={...process.env,HOST:'0.0.0.0',DATA_DIR:'/tmp/deadline-scout',CLOUD_MODE:'true'};
function cronAuthorized(value,env){const expected='Bearer '+(env.CRON_SECRET||'');return !!env.CRON_SECRET&&Buffer.byteLength(value||'')===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));}
export function startCloud(options={}){
 const env=options.env||defaultEnv,dbPool=options.pool||pool;
 if(!env.DATABASE_URL||!env.TOKEN_ENCRYPTION_KEY||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)throw new Error('Cloud database and authentication environment configuration is incomplete.');
 const publicApp=createApp({env,store:new CloudStore(null,[])});
 const server=http.createServer(async(req,res)=>{
 const publicPath=new URL(req.url,env.APP_URL).pathname;
 if(req.method==='GET'&&(isPublicFilePath(publicPath)||['/api/config','/health'].includes(publicPath)))return publicApp.server.listeners('request')[0](req,res);
 let client;const originalEnd=res.end.bind(res),originalWrite=res.write,originalWriteHead=res.writeHead;let ended=false;const restore=()=>{res.write=originalWrite;res.writeHead=originalWriteHead;res.end=originalEnd;};
 const fail=async(error)=>{if(ended)return;ended=true;restore();await client?.query('ROLLBACK').catch(()=>{});console.error('Cloud request failed:',error.code||error.name);if(!res.headersSent){res.statusCode=503;res.setHeader('Content-Type','application/json');originalEnd(JSON.stringify({error:'Service temporarily unavailable. Retry shortly.'}));}else originalEnd();};
 try{
 client=await dbPool.connect();const path=req.url.split('?')[0];const readOnly=req.method==='GET'&&!path.startsWith('/api/captures/')&&!path.startsWith('/api/signup-captures/')&&path!=='/auth/callback'&&path!=='/api/cron';const store=await CloudStore.open(client,{readOnly,initialize:false});const app=createApp({env,store});
 // Buffer the small JSON/HTML responses until their database writes commit.
 const chunks=[];res.writeHead=function(status,reason,headers){this.statusCode=status;for(const [key,value] of Object.entries((typeof reason==='object'?reason:headers)||{}))this.setHeader(key,value);return this;};
 res.write=function(chunk,encoding,callback){chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));if(typeof encoding==='function')encoding();else callback?.();return true;};
 await new Promise((resolve,reject)=>{res.end=function(chunk,encoding,callback){if(ended)return this;ended=true;if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));(async()=>{try{await store.flush();await client.query('COMMIT');restore();originalEnd(Buffer.concat(chunks));if(typeof encoding==='function')encoding();else callback?.();resolve();}catch(error){ended=false;reject(error);}})();return this;};
 if(req.url.split('?')[0]==='/api/cron'){
   (async()=>{if(!cronAuthorized(req.headers.authorization,env)){res.statusCode=401;res.end(JSON.stringify({error:'Unauthorized'}));return;}await app.engine.tick();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));})().catch(reject);
 }else Promise.resolve(app.server.listeners('request')[0](req,res)).catch(reject);
 });
 }catch(error){await fail(error);}finally{client?.release();}
 });
 server.listen(Number(env.PORT||3000),'0.0.0.0',()=>console.log('Deadline Scout cloud server ready'));
 return server;
}
