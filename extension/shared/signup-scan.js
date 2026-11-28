export function signupScanUrl(value){
  if(typeof value==='string'&&value.length<=4096){
    try{
      const url=new URL(value.trim());
      if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url;
    }catch{/* Show the same validation message for incomplete URLs. */}
  }
  throw Error('Enter a full HTTP or HTTPS application form link.');
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
