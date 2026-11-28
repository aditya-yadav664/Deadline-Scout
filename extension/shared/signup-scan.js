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
export function formScanNavigation({url,formIndex=0,googleForms=false,advance=false,describe=false}){
  if(location.href!==url)return 'changed';
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible'&&!el.closest('[hidden],[inert],[aria-hidden="true"]');
  const visibleForms=[...document.forms].filter(visible);
  const fields=form=>[...form.elements].filter(el=>el.matches('input,textarea,select'));
  const forms=visibleForms.filter(form=>fields(form).length);
  const root=googleForms?[...document.forms].find(form=>visible(form)&&/\/formResponse$/.test(new URL(form.action).pathname)):
    forms.sort((a,b)=>fields(b).length-fields(a).length)[formIndex]||
      (visibleForms.length===1?visibleForms[0]:null);
  const text=el=>(el.getAttribute('aria-label')||el.innerText||el.value||el.title||'').trim().replace(/\s+/g,' ');
  const scope=root||document;
  const wizard=root?.closest('[data-wizard],[data-multistep-form],[role=dialog],[role=form]');
  const inputs=(root?fields(root):[...scope.querySelectorAll('input,textarea,select')]).filter(visible);
  if(inputs.some(el=>el.type==='password'||el.autocomplete==='one-time-code'))return 'sign-in';
  if([...document.querySelectorAll('iframe[src*="captcha"],[data-sitekey]')].some(visible))return 'captcha';
  const selector='button,input[type=submit],input[type=button],[role=button],a[href]';
  const linkedControls=root?[...document.querySelectorAll('[aria-controls]')].filter(el=>el.matches(selector)&&
    el.getAttribute('aria-controls').split(/\s+/).some(id=>{
      const panel=document.getElementById(id);
      return panel&&(root.contains(panel)||panel.contains(root));
    })):[];
  const controls=[...new Set([
    ...scope.querySelectorAll(selector),...Array.from(root?.elements||[]).filter(el=>el.matches(selector)),
    ...(wizard?.querySelectorAll(selector)||[]),...linkedControls
  ])].filter(el=>visible(el)&&!el.closest('[aria-disabled="true"],:disabled'));
  const nearby=root&&forms.length===1?[...root.parentElement.querySelectorAll(selector)].filter(el=>
    !controls.includes(el)&&!el.closest('header,nav,form,[role=navigation]')&&visible(el)&&
    !el.closest('[aria-disabled="true"],:disabled')):[];
  const label=el=>text(el).replace(/\s*[→›»]\s*$/,'');
  const final=controls.some(el=>/^(?:submit(?:\s.*)?|register(?: now)?|sign up|send application|finish registration)$/i.test(label(el)));
  function score(el,scoped){
    const roleButton=(root||el.closest('[role=form],[data-wizard],[data-multistep-form]'))&&
      el.matches('[role=button]:not(button):not(input):not(a)');
    const link=el.matches('a[href]')?new URL(el.href):null;
    const sameSiteLink=link&&link.origin===location.origin&&!link.username&&!link.password&&
      !el.hasAttribute('download')&&(!el.target||el.target==='_self')&&
      !/%|\b(?:pay|checkout|submit|confirm|complete|delete|cancel|logout)\b/i.test(link.pathname+link.search);
    const intermediate=el.matches('button[type=button],input[type=button]')||roleButton||sameSiteLink;
    const caption=label(el);
    if(!intermediate||/\b(?:pay|payment|checkout|purchase|submit|confirm|cancel|finish|register|delete|accept|agree|send|place order)\b/i.test(caption))return 0;
    const semantics=['data-action','data-direction','data-navigation','data-step-action']
      .some(name=>/^(?:next|next[-_ ](?:page|step|section)|forward)$/i.test(el.getAttribute(name)||''));
    if(semantics||sameSiteLink&&el.relList.contains('next'))return scoped?4:2;
    const namedNext=/^(?:next|continue|proceed)(?:(?:\s+to\s+|\s*[:–—-]\s*)\S.{0,80}|\s+[\w &-]{1,60})?$/i.test(caption);
    const namedReview=/^review(?: (?:my |your )?(?:answers|details|application|registration))?$/i.test(caption);
    if(namedNext||namedReview)return scoped?3:1;
    return 0;
  }
  const ranked=[...controls.map(el=>({el,rank:score(el,true)})),...nearby.map(el=>({el,rank:score(el,false)}))]
    .filter(item=>item.rank).sort((a,b)=>b.rank-a.rank);
  if(describe){
    const descriptions=[...controls,...nearby].flatMap(el=>{
      const caption=label(el);
      return caption?[caption.slice(0,75)+(el.type==='submit'?' (submit control)':'')]:[];
    });
    return [...new Set(descriptions)].slice(0,6);
  }
  if(!ranked.length||ranked[0].rank===ranked[1]?.rank)return !ranked.length&&final?'review':'manual';
  if(inputs.some(el=>el.type==='checkbox'&&/\b(?:consent|waiver|agree|terms)\b/i.test([...el.labels||[]].map(text).join(' '))))return 'manual';
  if(inputs.some(el=>el.willValidate&&!el.validity.valid)||
    [...scope.querySelectorAll('[aria-invalid="true"]')].some(visible))return 'blocked';
  if(advance)ranked[0].el.click();
  return 'next';
}
