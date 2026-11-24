if(process.env.VERCEL||process.env.CLOUD_MODE==='true'){const {startCloud}=await import('./cloud.js');startCloud();}else{await import('./local.js');}
