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
 const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const pickerFrames=()=>[...document.querySelectorAll('iframe[src]')].filter(frame=>{
  const url=new URL(frame.src,location.href);
  return url.origin==='https://docs.google.com'&&/^\/picker\/?$/.test(url.pathname)&&visible(frame)&&!frame.closest('[hidden],[aria-hidden=true]');
 });
 const waitFor=async (read,ms)=>{
  const end=Date.now()+ms;
  do{
   const value=read();
   if(value)return value;
   await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<end);
  return null;
 };
 const attach=(input,pdfs)=>{
  if(!input.multiple&&pdfs.length!==1)throw Error('This field accepts one file.');
  const accept=input.accept.toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
  if(accept.length&&!accept.some(value=>['.pdf','application/pdf','application/*','*/*'].includes(value)))throw Error('This field does not accept PDFs.');
  const win=input.ownerDocument.defaultView,transfer=new win.DataTransfer();
  for(const {bytes,name} of pdfs)transfer.items.add(new win.File([bytes],name,{type:'application/pdf'}));
  input.files=transfer.files;
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
  input.dispatchEvent(new win.Event('change',{bubbles:true}));
 };
 const confirmedPickers=globalThis.__deadlineScoutConfirmedPickers||=new WeakMap();
 async function attachThroughGooglePicker(scope,pdfs){
  const card=scope.closest('[role=listitem]');
  if(!card||!/^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+\/(?:viewform|formResponse)\/?$/.test(location.pathname))throw Error('The upload question could not be identified.');
  const selected=()=>[...card.querySelectorAll('[aria-label="Selected files"],[role=list][aria-labelledby]')].filter(list=>{
   if(list.getAttribute('aria-label')==='Selected files')return true;
   return list.getAttribute('aria-labelledby').split(/\s+/).some(id=>document.getElementById(id)?.textContent.trim()==='Selected files');
  }).flatMap(list=>[...list.querySelectorAll('li,[role=listitem]')].filter(visible));
  const exactName=(item,name)=>[item,...item.querySelectorAll('*')].some(node=>node.title===name||node.getAttribute('aria-label')===name||!node.children.length&&node.textContent.trim()===name);
  const matches=()=>{const items=selected();return card.isConnected&&items.length===pdfs.length&&pdfs.every((pdf,i)=>exactName(items[i],pdf.name));};
  const approval=JSON.stringify(pdfs.map(pdf=>[pdf.name,pdf.sha256]));
  if(confirmedPickers.get(card)===approval&&matches())return;
  if(pickerFrames().length)throw Error('Close the open Google picker and retry.');
  // Remove only attachments belonging to this question, after validating the reviewed bytes.
  const removeControl=item=>{
   const controls=[...item.querySelectorAll('button,[role=button]')].filter(button=>
    visible(button)&&!button.matches(':disabled,[aria-disabled=true]')&&
    ['aria-label','title','data-tooltip'].map(attr=>button.getAttribute(attr)||'').concat(button.textContent.trim()).some(label=>/^remove(?:\s|$)/i.test(label)));
   return controls.length===1?controls[0]:null;
  };
  const existing=selected();
  if(existing.some(item=>!removeControl(item)))throw Error('The existing attachment has no identifiable Remove button.');
  for(let count=existing.length;count>0;count--){
   const items=selected(),remove=items.length&&removeControl(items[0]);
   if(items.length!==count||!remove)throw Error('The attachment list changed during replacement.');
   remove.click();
   if(!await waitFor(()=>selected().length===count-1,5000))throw Error('Google Forms did not confirm removal of the old attachment.');
  }
  const buttons=[...card.querySelectorAll('button,[role=button]')].filter(button=>visible(button)&&!button.matches(':disabled,[aria-disabled=true]')&&[button.textContent.trim(),button.getAttribute('aria-label')].includes('Add file'));
  if(buttons.length!==1)throw Error('The Google picker button could not be identified.');
  buttons[0].click();
  const controls=await waitFor(()=>{
   const frames=pickerFrames();
   if(frames.length!==1)return null;
   const picker=frames[0].contentDocument;
   if(!picker||!/^\/picker\/?$/.test(new URL(picker.URL).pathname))return null;
   const browse=picker.getElementById('uploadButtonId');
   if(!browse||!visible(browse))return null;
   const inputs=picker.querySelectorAll('input[type=file]:not(:disabled)');
   return {browse,input:inputs.length===1?inputs[0]:null};
  },12000);
  if(!card.isConnected||!controls?.browse.isConnected)throw Error('The Google picker upload tab was unavailable.');
  const {browse,input}=controls,win=browse.ownerDocument.defaultView;
  const transfer=new win.DataTransfer();
  for(const pdf of pdfs)transfer.items.add(new win.File([pdf.bytes],pdf.name,{type:'application/pdf'}));
  const drag=type=>browse.dispatchEvent(new win.DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));
  // Google can clear an upload error when the picker returns to Browse.
  // Keep its explanation until the form acknowledges the file or the attempt times out.
  const pickerDoc=browse.ownerDocument;
  let pickerError='';
  const readError=node=>{
   if(node.nodeType!==1)return;
   for(const alert of [node,...node.querySelectorAll('[role=alert],[aria-live=assertive]')]){
    if(!alert.matches('[role=alert],[aria-live=assertive]'))continue;
    const message=alert.textContent.trim();
    if(message)pickerError=message.slice(0,200);
   }
  };
  const observer=new MutationObserver(records=>{
   for(const record of records){
    const target=record.target.parentElement?.closest('[role=alert],[aria-live=assertive]')||record.target;
    readError(target);
    for(const node of [...record.addedNodes,...record.removedNodes])readError(node);
   }
  });
  observer.observe(pickerDoc.body,{childList:true,subtree:true,characterData:true});
  try{
   drag('dragenter');
   if(!drag('dragover')){
    drag('drop');
   }else if(input?.isConnected&&!input.files.length){
    drag('dragleave');
    attach(input,pdfs);
   }else throw Error('The picker did not accept a file drop or expose an upload input.');
   if(!await waitFor(()=>!pickerFrames().length&&matches(),45000)){
    throw Error(pickerError?'Google’s upload message: '+pickerError:pickerFrames().length?'Google’s picker stayed open without confirming the PDF.':'The picker closed without the draft PDF appearing on the question.');
   }
  }finally{observer.disconnect();}
  confirmedPickers.set(card,approval);
 }
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
  const usePicker=googleQuestion&&scope&&inputs.length===0&&files.length>0;
  if(inputs.length!==1&&!usePicker){blocked=true;report.push(field.label+': this upload control needs manual attachment.');continue;}
  const input=inputs[0];
  try{
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
   if(input?.files?.length&&(!refs.length||await matchesApproved())){
    if(autoSubmit)await verifyReady();
    report.push(field.label+': kept the file already chosen on the site.');continue;
   }
   if(!files.length||files.length!==refs.length)throw Error('The approved PDF is unavailable.');
   const pdfs=[];
   for(const saved of files){
    const ref=step.files?.[field.key]?.find(f=>f.id===saved.id);
    if(!ref||ref.sha256!==saved.sha256||ref.name!==saved.name||ref.size!==saved.size)throw Error('File does not match the approved snapshot.');
    const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));
    if(bytes.length!==saved.size||bytes.length>2*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF.');
    if(await digest(bytes)!==saved.sha256)throw Error('PDF integrity check failed.');
    if(field.maxBytes&&bytes.length>field.maxBytes)throw Error('PDF exceeds this field’s size limit.');
    pdfs.push({bytes,name:saved.name,sha256:saved.sha256});
   }
   if(usePicker)await attachThroughGooglePicker(scope,pdfs);
   else{
    attach(input,pdfs);
    // Allow the site's change handler to replace or reject the selection before advancing.
    await new Promise(resolve=>setTimeout(resolve,150));
    await verifyReady();
   }
   report.push(field.label+': saved PDF attached.');
  }catch(error){blocked=true;report.push(field.label+': '+error.message+' Attach manually.');}
 }
 return {blocked,report};
}
