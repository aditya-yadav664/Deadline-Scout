export function signupScanUrl(value){
  if(typeof value==='string'&&value.length<=4096){
    try{
      const url=new URL(value.trim());
      if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url;
    }catch{/* Show the same validation message for incomplete URLs. */}
  }
  throw Error('Enter a full HTTP or HTTPS event or application link.');
}

// Runs inside the event tab. A discovery action can open a link or reveal a form.
export function findSignupEntry({url,clickKey}){
  if(location.href!==url)return [];
  const visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility==='visible'&&
    !node.closest('[hidden],[inert],[aria-hidden="true"],[disabled],[aria-disabled="true"]');
  const selectors='a[href],button[type=button],button:not([type]),input[type=button],[role=button]';
  const options=new Map();
  for(const [index,node] of [...document.querySelectorAll(selectors)].entries()){
    if(!visible(node))continue;
    const label=(node.getAttribute('aria-label')||node.innerText||node.value||node.title||'').trim()
      .replace(/\s+/g,' ').replace(/[→›»]+$/,'').trim().slice(0,140);
    if(!label||/\b(?:login|log in|sign in|pay|payment|checkout|donate|newsletter|subscribe|volunteer|sponsor|submit|cancel)\b/i.test(label))continue;
    const action=/^(?:register(?:\s+(?:now|here|for .+))?|(?:start|open|begin)\s+(?:your\s+)?(?:registration|application)|apply(?:\s+(?:now|here|for .+))?|sign up(?:\s+(?:now|here|for .+))?|(?:registration|application)\s+form|(?:event|attendee|participant)\s+registration)$/i.test(label);
    const link=node.closest('a[href]');
    let destination;
    if(link){
      try{destination=new URL(link.href);}catch{continue;}
      if(!['http:','https:'].includes(destination.protocol)||destination.username||destination.password||
        destination.href===url||link.hasAttribute('download'))continue;
      if(!action&&!/(?:^|\/)(?:register|registration|apply|application-form|signup|sign-up)\/?$/i.test(destination.pathname)&&
        !/(?:^|\.)forms\.gle$/.test(destination.hostname)&&
        !(destination.origin==='https://docs.google.com'&&destination.pathname.endsWith('/viewform')))continue;
    }else if(!action||node.closest('form')||node.type==='submit')continue;
    const key=destination?.href||('button:'+index+':'+label);
    if(clickKey===key&&!destination){node.click();return [{key}];}
    if(!options.has(key)||action)options.set(key,{
      key,label,url:destination?.href||null,explicit:action
    });
  }
  return [...options.values()].slice(0,12);
}

// Runs in the form tab. Only clear intermediate navigation controls are eligible.
export function formScanNavigation({url,formIndex=0,googleForms=false,advance=false}){
  if(location.href!==url)return 'changed';
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible'&&!el.closest('[hidden],[inert],[aria-hidden="true"]');
  const visibleForms=[...document.forms].filter(visible);
  const forms=visibleForms.filter(form=>form.querySelector('input,textarea,select'));
  const root=googleForms?[...document.forms].find(form=>visible(form)&&/\/formResponse$/.test(new URL(form.action).pathname)):
    forms.sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length)[formIndex]||
      (visibleForms.length===1?visibleForms[0]:null);
  if(!root)return 'manual';
  const text=el=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ');
  const inputs=[...root.querySelectorAll('input,textarea,select')].filter(visible);
  if(inputs.some(el=>el.type==='password'||el.autocomplete==='one-time-code'))return 'sign-in';
  if([...document.querySelectorAll('iframe[src*="captcha"],[data-sitekey]')].some(visible))return 'captcha';
  const controls=[...root.querySelectorAll('button,input[type=submit],input[type=button],[role=button]')].filter(visible);
  const next=controls.filter(el=>{
    const roleButton=googleForms&&el.matches('[role=button]:not(button):not(input)');
    const intermediate=el.matches('button[type=button],input[type=button]')||roleButton;
    const label=text(el).replace(/\s*[→›]\s*$/,'');
    return intermediate&&/^next(?: (?:page|step|section))?$/i.test(label)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true';
  });
  const final=controls.some(el=>/^(?:submit(?:\s.*)?|register(?: now)?|sign up|send application)$/i.test(text(el)));
  if(final)return 'review';
  if(next.length!==1)return 'manual';
  if(inputs.some(el=>el.type==='checkbox'&&/\b(?:consent|waiver|agree|terms)\b/i.test([...el.labels||[]].map(text).join(' '))))return 'manual';
  if(inputs.some(el=>el.willValidate&&!el.validity.valid)||
    [...root.querySelectorAll('[aria-invalid="true"]')].some(visible))return 'blocked';
  if(advance)next[0].click();
  return 'next';
}
