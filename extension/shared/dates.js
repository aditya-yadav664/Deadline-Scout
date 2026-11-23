// User preference: timed values without a source timezone default to India.
export const DEFAULT_TIMEZONE='Asia/Kolkata';
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const monthWords = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const pattern = `\\b(?:\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|${monthWords}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${monthWords}(?:,?\\s+\\d{4})?)\\b`;
const pad = n => String(n).padStart(2, '0');
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
}
export function findDates(text, referenceYear = new Date().getFullYear()) {
  return [...text.matchAll(new RegExp(pattern, 'gi'))].map(match => {
    let year, month, day, reasons = [];
    const raw = match[0];
    if (/^\d{4}-/.test(raw)) [year,month,day] = raw.slice(0,10).split('-').map(Number);
    else if (/^\d+[/.]/.test(raw)) {
      const [a,b,c] = raw.split(/[/.]/).map(Number); year=c;
      if (a > 12) { day=a; month=b; }
      else if (b > 12) { month=a; day=b; }
      else { day=a; month=b; if (a !== b) reasons.push('Ambiguous numeric date: confirm day/month order.'); }
    } else {
      const word = raw.match(/[a-z]+/i)[0]; month=months.indexOf(word.slice(0,3).toLowerCase())+1;
      const nums=raw.match(/\d+/g).map(Number); day=nums[0]; year=nums[1];
      if (!year) { year=referenceYear; reasons.push(`Year missing: confirm ${referenceYear}.`); }
    }
    const date=`${year}-${pad(month)}-${pad(day)}`;
    if (!validDate(date)) reasons.push('Invalid calendar date.');
    const tail=text.slice(match.index + raw.length);
    const clock=tail.match(/^\s*(?:at|by|,|[·•@])?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(UTC(?:[+-]\d{2}:?\d{2})?|GMT|[A-Z]{2,5}|[A-Za-z_]+\/[A-Za-z_]+)?\b/i);
    let time=null, zone=null;
    const isoClock=raw.match(/T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if(isoClock){
      time=isoClock[1];zone=isoClock[2]?isoClock[2].toUpperCase()==='Z'?'UTC':'UTC'+isoClock[2]:null;
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))reasons.push('Invalid clock time.');
      if(!zone)zone=DEFAULT_TIMEZONE;
      else if(!validZone(zone))reasons.push('Invalid timezone offset.');
    } else if(clock && (clock[2] || clock[3])) {
      let h=Number(clock[1]); const m=Number(clock[2]||0);
      if(clock[3]) h=h%12 + (/pm/i.test(clock[3])?12:0);
      time=`${pad(h)}:${pad(m)}`; zone=clock[4]||null;
      if(h>23 || m>59) reasons.push('Invalid clock time.');
      if(zone==='GMT') zone='UTC';
      if(zone?.toUpperCase()==='IST')zone=DEFAULT_TIMEZONE;
      if(!zone)zone=DEFAULT_TIMEZONE;
      else if(!validZone(zone)) reasons.push(`Ambiguous timezone ${zone}: choose an IANA timezone or UTC offset.`);
    }
    return {date,time,zone,raw,index:match.index,reasons};
  });
}
export function validZone(zone) {
  if(/^UTC(?:[+-](?:0\d|1[0-4]):?[0-5]\d)?$/.test(zone||'')) return true;
  if(!zone?.includes('/')) return false;
  try { new Intl.DateTimeFormat('en',{timeZone:zone}); return true; } catch { return false; }
}
export function findTimes(text){
  const times=[];
  for(const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b(?:\s+(UTC(?:[+-]\d{2}:?\d{2})?|GMT|IST|[A-Za-z_]+\/[A-Za-z_]+))?/gi)){
    if(!m[2]&&!m[3])continue;
    let hour=+m[1];if(m[3])hour=hour%12+(/pm/i.test(m[3])?12:0);
    const minute=+(m[2]||0);if(hour>23||minute>59)continue;
    let zone=m[4]||null;if(zone?.toUpperCase()==='IST')zone=DEFAULT_TIMEZONE;if(zone?.toUpperCase()==='GMT')zone='UTC';
    times.push({time:`${pad(hour)}:${pad(minute)}`,zone,index:m.index,raw:m[0]});
  }
  return times;
}
export function validateMilestone(m) {
  if(!validDate(m.date)) throw new Error('Choose a valid date.');
  if(m.time&&(!m.zone||m.zone.toUpperCase()==='IST'))m.zone=DEFAULT_TIMEZONE;
  if(m.time && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) || !validZone(m.zone))) throw new Error('Timed deadlines need a valid time and explicit IANA timezone or UTC offset.');
  return m;
}
export function instant(m) {
  validateMilestone(m);
  if(!m.time) return null;
  if(m.zone.startsWith('UTC')) return new Date(`${m.date}T${m.time}:00${m.zone==='UTC'?'Z':m.zone.slice(3).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')}`).toISOString();
  const target=Date.parse(`${m.date}T${m.time}:00Z`);
  let candidate=target;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:m.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(fmt.formatToParts(candidate).map(p=>[p.type,p.value]));
    const wall=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    const delta=target-wall; candidate+=delta; if(!delta) break;
  }
  const p=Object.fromEntries(fmt.formatToParts(candidate).map(p=>[p.type,p.value]));
  if(`${p.year}-${p.month}-${p.day}`!==m.date || `${p.hour}:${p.minute}`!==m.time) throw new Error('This local time does not exist due to daylight saving. Choose another time.');
  // A repeated wall-clock hour has two instants; require an explicit offset.
  for(const shift of [-3600000,3600000, -1800000,1800000]) {
    if(fmt.format(candidate+shift)===fmt.format(candidate)) throw new Error('Repeated daylight-saving hour: use an explicit UTC offset.');
  }
  return new Date(candidate).toISOString();
}
export const scheduleKey = m => `${m.date}|${m.time||''}|${m.time?m.zone||'':''}`;
export function pretty(m) { return `${m.date}${m.time?` at ${m.time} ${m.zone||'(timezone unknown)'}`:' · date only'}`; }
export function impact(plan, next) {
  if(!plan) return 'No planned action date set.';
  const days=Math.round((Date.parse(plan+'T12:00:00Z')-Date.parse(next.date+'T12:00:00Z'))/86400000);
  return days>0?`Your planned signup on ${plan} is ${days} day${days===1?'':'s'} after the new deadline.`:days===0?'Your planned action is on the deadline date. Check any cutoff time.':`Your planned action is ${-days} day${days===-1?'':'s'} before the deadline.`;
}
