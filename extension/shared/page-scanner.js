import {extract,readHtml} from './extract.js';
// This function is injected into the selected web tab. It has no dependencies
// on the popup, so Edge can serialize and execute it in an isolated world.
export function captureVisiblePage(){
  const text=document.body?.innerText||'';
  return {title:document.title,url:location.href,text:text.slice(0,240000),selected:window.getSelection()?.toString()||'',schemas:[...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,12).map(n=>n.textContent.slice(0,30000)),links:[...document.querySelectorAll('a[href]')].filter(a=>a.origin===location.origin&&/faq|rules|updates|schedule|dates/i.test(a.textContent+' '+a.pathname)).slice(0,10).map(a=>({url:a.href,label:a.innerText||a.textContent}))};
}
export function milestonesFromCapture(page){
  const selected=page.selected?.trim();
  const selectedDates=selected?extract(selected,page.url):[];
  const textDates=selectedDates.length?selectedDates:extract(page.text,page.url);
  const structured=selectedDates.length?[]:readHtml((page.schemas||[]).map(s=>`<script type="application/ld+json">${s}</script>`).join(''),page.url).milestones;
  return [...new Map([...textDates,...structured].map(m=>[`${m.kind}|${m.date}|${m.time||''}|${m.zone||''}|${m.quote}`,m])).values()].slice(0,30);
}
export async function scanActivePage(browserApi){
  const [tab]=await browserApi.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('No active tab found. Open a registration page and click the toolbar icon there.');
  if(tab.url&&!/^https?:\/\//i.test(tab.url))throw new Error('Open a normal website first. Browser settings, extension pages and local files cannot be scanned.');
  let result;
  try{[result]=await browserApi.scripting.executeScript({target:{tabId:tab.id},func:captureVisiblePage});}
  catch(error){const e=new Error('Page access is not available. Allow access to this site, or reopen the toolbar popup on the registration page.');e.code='PAGE_ACCESS';e.origin=tab.url?new URL(tab.url).origin:null;throw e;}
  const page=result?.result;
  if(!page||!/^https?:\/\//i.test(page.url))throw new Error('This page could not be read. Reload the page and try again.');
  return {title:page.title,url:page.url,links:page.links||[],milestones:milestonesFromCapture(page),capturedAt:new Date().toISOString()};
}
