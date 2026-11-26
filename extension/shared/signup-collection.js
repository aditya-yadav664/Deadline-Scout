export function collectSignupPage(collection,step){
 if(!step.fields?.length&&step.warnings?.length)throw Error(step.warnings[0]);
 if(!step.fields?.length)throw Error('No answer fields on this page. The final Submit/review page does not need capture.');
 const steps=collection?.steps?[...collection.steps]:[];
 if(steps.length&&new URL(steps[0].url).origin!==new URL(step.url).origin)throw Error('Finish or discard the current collection before capturing another site.');
 const identity=s=>JSON.stringify([s.url,s.formIndex||0,s.stepToken||'',s.fields.map(f=>f.key).sort()]);
 const index=steps.findIndex(s=>identity(s)===identity(step));if(index>=0)steps[index]=step;else{if(steps.length>=12)throw Error('Maximum 12 captured pages.');steps.push(step);}
 return {steps,updatedAt:Date.now()};
}
