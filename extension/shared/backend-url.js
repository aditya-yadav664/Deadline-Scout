// Public connection configuration. Secrets belong only in the backend .env.
export const LOCAL_BACKEND='http://localhost:4317';
export function backendOrigin(value,fallback=LOCAL_BACKEND){
  try{
    const u=new URL(value);
    if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)return fallback;
    if(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))return u.origin;
  }catch{}
  return fallback;
}

export const HOSTED_BACKEND='https://deadline-scout.vercel.app';
