import {isLegacyGoogleCapture,sameSignupForm} from './google-forms.js';

export function collectSignupPage(collection,step){
 if(!step.fields?.length&&step.warnings?.length)throw Error(step.warnings[0]);
 if(!step.fields?.length)throw Error('No answer fields on this page. The final Submit/review page does not need capture.');
 const steps=collection?.steps?.filter(previous=>!isLegacyGoogleCapture(previous)||isLegacyGoogleCapture(step)||!sameSignupForm(previous.url,step.url))||[];
 if(steps.length&&!sameSignupForm(steps[0].url,step.url))throw Error('Finish or discard the current collection before capturing another site or Google Form.');
 const identity=s=>JSON.stringify([s.url,s.formIndex||0,s.stepToken||'',s.fields.map(f=>f.key).sort()]);
 const index=steps.findIndex(s=>identity(s)===identity(step));if(index>=0)steps[index]=step;else{if(steps.length>=12)throw Error('Maximum 12 captured pages.');steps.push(step);}
 return {steps,updatedAt:Date.now()};
}
