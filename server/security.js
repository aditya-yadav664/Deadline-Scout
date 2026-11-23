import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const randomToken=()=>randomBytes(32).toString('base64url');
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function vault(dataDir, envKey) {
  mkdirSync(dataDir,{recursive:true});const path=join(dataDir,'.encryption-key');
  if(!envKey && !existsSync(path)) writeFileSync(path,randomBytes(32).toString('base64'),{mode:0o600});
  const key=Buffer.from(envKey||readFileSync(path,'utf8').trim(),'base64');
  if(key.length!==32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
  return {
    seal(value) {const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return [iv,c.getAuthTag(),data].map(b=>b.toString('base64')).join('.');},
    open(value) {const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64'));const d=createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(data),d.final()]).toString());}
  };
}
export function safeUrl(value) {
  let u;try{u=new URL(value);}catch{throw new Error('Enter a full HTTP or HTTPS URL.');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error('Only HTTP(S) URLs without credentials are allowed.');
  u.hash='';return u;
}
export function publicAddress(ip) {
  if(ip.includes(':')) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:/i.test(ip) && !/^2002:/i.test(ip);
  const parts=ip.split('.');if(parts.length!==4||parts.some(x=>!/^\d+$/.test(x)||+x>255)) return false;
  const [a,b,c]=parts.map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===100&&b>=64&&b<=127||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
