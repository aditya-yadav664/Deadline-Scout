import { createApp } from './app.js';
const app=createApp();
app.server.listen(app.port,app.host,()=>console.log(`Deadline Scout running at ${app.base}\nOpen /demo/registration for the fictional hackathon.\nData is persistent in DATA_DIR. Keep this process running for scheduled checks.`));
let ticking=false;
const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await app.engine.tick();}catch(e){console.error('Scheduler:',e.message);}finally{ticking=false;}},15000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);app.server.close(()=>{app.store.close();process.exit(0);});});
