import { createApp } from './app.js';
import {existsSync} from 'node:fs';
const cloudConfigured=(!!process.env.DATABASE_URL||existsSync(new URL('../.vercel/project.json',import.meta.url)))&&process.env.ALLOW_LOCAL_MONITOR!=='true';
const app=createApp(cloudConfigured?{env:{...process.env,EMAIL_PROVIDER:'demo'}}:{});
app.server.listen(app.port,app.host,()=>console.log(`Deadline Scout running at ${app.base}\nOpen /demo/registration for the fictional hackathon.\nData is persistent in DATA_DIR. Keep this process running for scheduled checks.`));
let ticking=false;
const timer=cloudConfigured?null:setInterval(async()=>{if(ticking)return;ticking=true;try{await app.engine.tick();}catch(e){console.error('Scheduler:',e.message);}finally{ticking=false;}},15000);
if(cloudConfigured)console.log('Cloud monitoring is configured. Local background checks and live email delivery are disabled to avoid duplicate alerts.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);app.server.close(()=>{app.store.close();process.exit(0);});});
