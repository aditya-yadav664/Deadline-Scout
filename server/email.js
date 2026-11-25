import {renderChangeEmail,renderBasicEmail} from './email-template.js';
export function emailGreeting(profile={}){const name=profile.displayName||profile.googleName;return name?'Hi '+name+',':'Hi there,';}
export function changeEmail(track,change,profile={}) {
  return {html:renderChangeEmail(track,change,emailGreeting(profile)),subject:`Deadline changed: ${track.title} · ${change.label}`,text:[emailGreeting(profile),track.title,change.label,`Before: ${change.before.date}${change.before.time?' '+change.before.time+' '+change.before.zone:''}`,`After: ${change.after.date}${change.after.time?' '+change.after.time+' '+change.after.zone:''}`,change.impact,`Evidence: “${change.after.quote}”`,`Source: ${change.after.sourceUrl}`,`Event page: ${track.url}`].join('\n\n')};
}
export function createEmailAdapter(env,fetcher=fetch) {
  const live=env.EMAIL_PROVIDER==='brevo';
  return {mode:live?'brevo':'demo',async send({to,subject,text,html,id}) {
    if(!live) return {status:'demo',messageId:`demo-${id}`,label:'DEMO ONLY · no email sent'};
    if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL) throw new Error('Brevo requires BREVO_API_KEY and BREVO_SENDER_EMAIL.');
    let response;try {response=await fetcher('https://api.brevo.com/v3/smtp/email',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'Deadline Scout',email:env.BREVO_SENDER_EMAIL},to:[{email:to}],subject,textContent:text,htmlContent:html||renderBasicEmail(subject,text),headers:{IdempotencyKey:id}})});}catch(e){e.transient=true;throw e;}
    const body=await response.json().catch(()=>({}));
    if(!response.ok) { if(body.code==='duplicate_parameter') return {status:'accepted',label:'Brevo already accepted this delivery'};const e=new Error(`Brevo HTTP ${response.status}: ${body.message||'send failed'}`);e.transient=response.status===429||response.status>=500;throw e; }
    return {status:'accepted',messageId:body.messageId,label:'Accepted by Brevo · inbox delivery not verified'};
  }};
}
