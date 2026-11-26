// Only explicitly selected, approved file bytes enter this function. No disk access.
export function approvedSessionFiles(draft,payload=[]){
 if(!Array.isArray(payload)||payload.length>20)throw Error('Too many PDF attachments.');
 let total=0;const seen=new Set();
 return payload.map(file=>{
  const field=draft.steps[file.stepIndex]?.fields.find(f=>f.type==='file'&&f.key===file.key),ref=field&&draft.steps[file.stepIndex].files?.[file.key]?.find(f=>f.id===file.id);
  const identity=file.stepIndex+':'+file.key+':'+file.id;
  if(seen.has(identity)||!ref||file.name!==ref.name||file.sha256!==ref.sha256||file.size!==ref.size||file.type!=='application/pdf'||!Number.isInteger(file.size)||file.size<1||file.size>2*1024*1024||typeof file.data!=='string'||file.data.length!==4*Math.ceil(file.size/3))throw Error('PDF does not match the reviewed draft.');
  seen.add(identity);total+=file.size;if(total>4*1024*1024)throw Error('PDF session limit is 4 MB.');
  return {stepIndex:file.stepIndex,key:file.key,id:file.id,name:file.name,sha256:file.sha256,size:file.size,type:file.type,data:file.data};
 });
}
export async function attachSignupPdfs({step,attachments,autoSubmit=false}){
 const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const forms=[...document.forms].filter(f=>visible(f)&&f.querySelector('input,textarea,select')).sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length),root=forms[step.formIndex||0]||document;
 const report=[];let blocked=false;
 for(const field of step.fields.filter(f=>f.type==='file')){
  const files=attachments.filter(a=>a.key===field.key);
  const refs=step.files?.[field.key]||[];
  if(!files.length&&!refs.length&&!field.required)continue;
  const googleQuestion=field.manualUpload && location.origin==='https://docs.google.com' && field.key.startsWith('google-forms:');
  const id=field.key.slice('google-forms:'.length);
  const cards=googleQuestion?[...root.querySelectorAll('[data-params]')].filter(node=>
   visible(node)&&node.getAttribute('data-params')?.startsWith('%.@.['+id+',')
  ):[];
  const scope=googleQuestion?cards.length===1?cards[0]:null:root;
  const inputs=[...(scope?.querySelectorAll('input[type=file]')||[])].filter(el=>
   !el.matches(':disabled')&&(googleQuestion||(
    (visible(el)||[...el.labels||[]].some(visible))&&
    (field.id?el.id===field.id:field.name?el.name===field.name:[...el.labels||[]].map(label=>label.innerText).join(' ').trim()===field.label)
   ))
  );
  if(inputs.length!==1){blocked=true;report.push(field.label+': this upload control needs manual attachment.');continue;}
  const input=inputs[0];
  try{
   const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const matchesApproved=async()=>{
    if(!refs.length)return !!input.files?.length;
    if(input.files?.length!==refs.length)return false;
    for(const [i,file] of [...input.files].entries()){
     const ref=refs[i];
     if(file.name!==ref.name||file.size!==ref.size||!ref.sha256||await digest(await file.arrayBuffer())!==ref.sha256)return false;
    }
    return true;
   };
   const verifyReady=async()=>{
    const busy=()=>scope.querySelector('[aria-busy=true]')||scope.getAttribute?.('aria-busy')==='true';
    const until=Date.now()+5000;
    while(busy()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));
    if(busy())throw Error('The site is still processing the file.');
    if(!input.isConnected||input.getAttribute('aria-invalid')==='true'||!await matchesApproved())throw Error('The site did not retain the approved attachment.');
   };
   if(input.files?.length){
    if(autoSubmit)await verifyReady();
    report.push(field.label+': kept the file already chosen on the site.');continue;
   }
   if(!files.length||files.length!==refs.length)throw Error('The approved PDF is unavailable.');
   if(!input.multiple&&files.length!==1)throw Error('This field accepts one file.');
   const transfer=new DataTransfer();
   for(const saved of files){
    const ref=step.files?.[field.key]?.find(f=>f.id===saved.id);
    if(!ref||ref.sha256!==saved.sha256||ref.name!==saved.name||ref.size!==saved.size)throw Error('File does not match the approved snapshot.');
    const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));
    if(bytes.length!==saved.size||bytes.length>2*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF.');
    if(await digest(bytes)!==saved.sha256)throw Error('PDF integrity check failed.');
    if(field.maxBytes&&bytes.length>field.maxBytes)throw Error('PDF exceeds this field’s size limit.');
    const accept=(input.accept||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(accept.length&&!accept.some(x=>['.pdf','application/pdf','application/*','*/*'].includes(x)))throw Error('This field does not accept PDFs.');
    transfer.items.add(new File([bytes],saved.name,{type:'application/pdf'}));
   }
   input.files=transfer.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   // Allow the site's change handler to replace or reject the selection before advancing.
   await new Promise(resolve=>setTimeout(resolve,150));
   await verifyReady();
   report.push(field.label+': saved PDF attached.');
  }catch(error){blocked=true;report.push(field.label+': '+error.message+' Attach manually.');}
 }
 return {blocked,report};
}
