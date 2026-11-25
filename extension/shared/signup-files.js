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
export async function attachSignupPdfs({step,attachments}){
 const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const forms=[...document.forms].filter(f=>visible(f)&&f.querySelector('input,textarea,select')).sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length),root=forms[step.formIndex||0]||document;
 const report=[];let blocked=false;
 for(const field of step.fields.filter(f=>f.type==='file')){
  const files=attachments.filter(a=>a.key===field.key);if(!files.length)continue;
  const inputs=[...root.querySelectorAll('input[type=file]')].filter(visible).filter(el=>!el.disabled&&(field.id?el.id===field.id:field.name?el.name===field.name:(el.labels?.[0]?.innerText||'').trim()===field.label));
  if(inputs.length!==1){blocked=true;report.push(field.label+': upload field is missing or ambiguous.');continue;}
  const input=inputs[0];if(input.files?.length){report.push(field.label+': kept the file already chosen on the site.');continue;}
  try{
   if(!input.multiple&&files.length!==1)throw Error('This field accepts one file.');
   const transfer=new DataTransfer();
   for(const saved of files){
    const ref=step.files?.[field.key]?.find(f=>f.id===saved.id);
    if(!ref||ref.sha256!==saved.sha256||ref.name!==saved.name||ref.size!==saved.size)throw Error('File does not match the approved snapshot.');
    const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));
    if(bytes.length!==saved.size||bytes.length>2*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==saved.sha256)throw Error('PDF integrity check failed.');
    if(field.maxBytes&&bytes.length>field.maxBytes)throw Error('PDF exceeds this field’s size limit.');
    const accept=(input.accept||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(accept.length&&!accept.some(x=>['.pdf','application/pdf','application/*','*/*'].includes(x)))throw Error('This field does not accept PDFs.');
    transfer.items.add(new File([bytes],saved.name,{type:'application/pdf'}));
   }
   input.files=transfer.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   if(input.files.length!==files.length)throw Error('The site did not retain the attachment.');
   report.push(field.label+': saved PDF attached.');
  }catch(error){blocked=true;report.push(field.label+': '+error.message+' Attach manually.');}
 }
 return {blocked,report};
}
