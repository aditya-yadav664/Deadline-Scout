// Shared validation and rule-based suggestions. No profile values go to a model.
export function formSignature(step){return JSON.stringify({url:step.url,terms:step.terms,fields:step.fields.map(({key,label,type,required,options,accept,multiple,maxLength,pattern,min,max,maxBytes})=>({key,label,type,required,options,accept,multiple,maxLength,pattern,min,max,maxBytes}))});}
export function suggestField(field,profile,links=[]){
 const text=(field.label+' '+(field.name||'')).toLowerCase();
 if(field.type==='file')return {value:'',source:'Chosen file'};
 const linkKind=/github.*(?:repo|repository)|(?:repo|repository).*github|project repository/.test(text)?'repository':/github/.test(text)?'github':/video|youtube|vimeo/.test(text)?'video':/deck|presentation/.test(text)?'deck':/portfolio|website/.test(text)?'portfolio':null;
 if(linkKind){const choices=links.filter(l=>l.kind===linkKind);return {value:choices.length===1?choices[0].url:'',source:choices.length===1?'Saved link':'Enter manually',choices};}
 const key=/email|e-mail/.test(text)?'email':/phone|mobile|telephone/.test(text)?'phone':/college|university|affiliation|institution/.test(text)?'college':/full.?name|participant name|your name|^name$/.test(text)?'name':null;
 return {value:key?profile[key]||'':'',source:key&&profile[key]?'Profile':'Enter manually'};
}
export function validateAnswer(field,value){
 const v=String(value||'');if(field.required&&!v.trim())return 'Required';if(!v)return '';
 if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return 'Enter a valid email';
 if(field.type==='url'||/url|link|github|portfolio|video|deck/i.test(field.label)){
  let u;try{u=new URL(v);}catch{return 'Enter a full HTTPS URL';}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return 'Use an HTTP(S) URL without credentials';
  const host=(field.help||'').match(/(?:only|must (?:use|be)|hosted on)\s+(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/i)?.[1];if(host&&u.hostname!==host&&!u.hostname.endsWith('.'+host))return 'Must use '+host;
 }
 if(field.options?.length&&!field.options.some(o=>o.value===v))return 'Choose a listed option';
 if(field.maxLength>0&&v.length>field.maxLength)return 'Too long';
 // Complex website regex patterns are retained for manual review, never executed on the server.
 if(field.pattern){const simple=/^\[([a-z0-9-]+)\]\{(\d{1,3})(?:,(\d{1,3}))?\}$/i.exec(field.pattern);if(simple&&v.length<=1000&&!new RegExp('^(?:'+field.pattern+')$','u').test(v))return 'Does not match the published format';}
 return '';
}
export function validateFiles(field,files=[]){
 if(field.required&&!files.length)return 'Choose a file';if(!field.multiple&&files.length>1)return 'Only one file allowed';
 for(const f of files){if(!f.name||!Number.isFinite(f.size)||f.size<0)return 'Invalid file';if(field.maxBytes&&f.size>field.maxBytes)return 'File exceeds published maximum size';
  const accept=(field.accept||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(accept.length&&!accept.some(a=>a.startsWith('.')?f.name.toLowerCase().endsWith(a):a.endsWith('/*')?(f.type||'').startsWith(a.slice(0,-1)):f.type===a))return 'File type is not accepted';
 }return '';
}

// Both functions below are serialized into an isolated active-tab world.
export function captureSignupForm(formIndex=0,includeInactive=false){
 const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const forms=[...document.forms].filter(f=>visible(f)&&f.querySelector('input,textarea,select'));const root=forms.sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length)[formIndex]||document;
 const controls=[...root.querySelectorAll('input,textarea,select')].filter(el=>includeInactive||visible(el)),fields=[],seen=new Set(),warnings=[];if(forms.length>1)warnings.push('Multiple forms found. Review the selected form before saving.');
 for(const el of controls){
  const type=el.tagName==='TEXTAREA'?'textarea':el.tagName==='SELECT'?'select':el.type;
  if(['hidden','submit','button','reset'].includes(type))continue;
  if(['password','checkbox'].includes(type)){warnings.push('Complete '+(el.labels?.[0]?.innerText||type)+' manually; passwords and consent are never restored.');continue;}
  if(!['text','email','tel','url','textarea','select','radio','file','number','date'].includes(type)){warnings.push('Unfamiliar control: '+type);continue;}
  const name=el.name||'',id=el.id||'',key=type==='radio'&&name?'radio:'+name:id?'id:'+id:name?'name:'+name:'label:'+(el.labels?.[0]?.innerText||el.getAttribute('aria-label')||el.placeholder||'')+':'+type;
  if(seen.has(key)){if(type!=='radio')warnings.push('Ambiguous control '+key+' requires manual choice on site.');continue;}seen.add(key);
  const group=type==='radio'?controls.filter(c=>c.type==='radio'&&c.name===name):[el];
  const label=(type==='radio'?el.closest('fieldset')?.querySelector('legend')?.innerText:null)||[...el.labels||[]].map(l=>l.innerText).join(' ')||el.getAttribute('aria-label')||el.placeholder||name||id||'Unlabelled field';
  const help=[...(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean)].map(id=>document.getElementById(id)?.innerText||'').join(' ');
  const size=el.getAttribute('data-max-bytes')||help.match(/(?:max(?:imum)?(?: file)? size:?|up to)\s*(\d+(?:\.\d+)?)\s*(KB|MB|bytes)/i)?.slice(1);
  fields.push({key,id,name,label:label.trim().slice(0,300),help:help.slice(0,1500),type,required:group.some(c=>c.required),options:type==='select'?[...el.options].map(o=>({value:o.value,label:o.label})):type==='radio'?group.map(c=>({value:c.value,label:c.labels?.[0]?.innerText||c.value})):[],accept:el.accept||'',multiple:!!el.multiple,maxLength:el.maxLength>0?el.maxLength:null,pattern:el.pattern||'',min:el.min||'',max:el.max||'',maxBytes:Array.isArray(size)?Number(size[0])*({KB:1024,MB:1048576,BYTES:1}[size[1].toUpperCase()]||1):Number(size)||null});
 }
 for(const frame of document.querySelectorAll('iframe'))if(visible(frame))warnings.push('Embedded form: open it directly and capture it separately if you have access.');
 const terms=[...root.querySelectorAll('label,a')].filter(visible).filter(n=>/terms|consent|privacy|agree/i.test(n.innerText)).map(n=>(n.innerText+' '+(n.href||'')).trim()).join('\n').slice(0,8000);
 const active=[...root.querySelectorAll('[role=tabpanel], [aria-labelledby], [id]')].filter(visible).find(el=>el.getAttribute('role')==='tabpanel'||/step.*panel|panel.*step/i.test(el.id));
 const selected=[...document.querySelectorAll('[role=tab][aria-selected=true], [aria-current=step]')].find(visible);
 const stepToken=active?.id||selected?.id||selected?.textContent?.trim()||'';
 return {formIndex,stepToken,formChoices:forms.map((f,i)=>({index:i,label:(f.getAttribute('aria-label')||f.id||'Form '+(i+1))+' · '+f.querySelectorAll('input,textarea,select').length+' controls'})),url:location.href,title:document.title,fields:fields.slice(0,100),terms,warnings,capturedAt:new Date().toISOString()};
}
export function restoreSignupAnswers({step,answers}){
 const forms=[...document.forms].filter(f=>!!f.getClientRects().length&&f.querySelector('input,textarea,select')).sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length),root=forms[step.formIndex||0]||document;
 const controls=[...root.querySelectorAll('input,textarea,select')].filter(el=>!!el.getClientRects().length),report=[];
 for(const field of step.fields){
  if(field.type==='file'){report.push(field.label+': checking saved attachment; files not saved as PDFs need manual attachment.');continue;}
  let matches=controls.filter(el=>field.id?el.id===field.id:field.name?el.name===field.name:(el.labels?.[0]?.innerText||el.getAttribute('aria-label')||el.placeholder||'').trim()===field.label);
  matches=matches.filter(el=>(el.tagName==='TEXTAREA'?'textarea':el.tagName==='SELECT'?'select':el.type)===field.type&&!el.disabled&&!el.readOnly);
  if(field.type==='radio')matches=matches.filter(el=>el.value===String(answers[field.key]||''));
  if(matches.length!==1){report.push(field.label+': ambiguous or missing; fill manually.');continue;}
  const el=matches[0],value=String(answers[field.key]||'');if(field.type==='radio')el.checked=true;
  else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);}
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));report.push(field.label+': restored.');
 }return report;
}
