import {readFileSync} from 'node:fs';
export function databaseOptions(value){
 const url=new URL(value);if(!url.hostname.endsWith('.supabase.com')&&!url.hostname.endsWith('.supabase.co'))throw new Error('Expected Supabase database hostname');
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
 return {connectionString:url.href,ssl:{ca:readFileSync(new URL('./certs/supabase-ca.crt',import.meta.url),'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:15000};
}
