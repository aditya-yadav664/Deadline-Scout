export function selectMilestone(current,kind,catalog){
  const matches=catalog.filter(m=>m.kind===kind);
  if(matches.length===1)return {...current,...structuredClone(matches[0]),kind,selected:current.selected,confirmed:false,variants:current.variants};
  return {...current,kind,date:'',time:null,zone:null,quote:'',raw:null,detected:null,confirmed:false,manual:matches.length===0,sourceChoice:null,reasons:[matches.length?'Several source dates match this milestone. Choose the evidence below.':'No date was found for this milestone. Enter it manually; no date is copied from another milestone.']};
}
