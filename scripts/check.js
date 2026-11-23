import { readdirSync,readFileSync,existsSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(join(dir,d.name)):join(dir,d.name));}
const files=['server','extension','test','scripts'].flatMap(d=>walk(join(root,d)));
for(const file of files.filter(f=>f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exit(1);}}
const manifest=JSON.parse(readFileSync(join(root,'extension','manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw new Error('Expected Manifest V3.');
for(const asset of [manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons)])if(!existsSync(join(root,'extension',asset)))throw new Error('Missing extension asset: '+asset);
console.log(`Checked ${files.filter(f=>f.endsWith('.js')).length} JavaScript files and all manifest entry assets.`);
