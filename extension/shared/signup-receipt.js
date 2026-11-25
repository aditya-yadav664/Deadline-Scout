// Observe organizer confirmation; never infer success from clicking Submit alone.
export function inspectSignupReceipt(){
 const visible=el=>!!el.getClientRects().length;
 if([...document.querySelectorAll('button[type=submit],input[type=submit]')].some(visible))return null;
 const headings=[...document.querySelectorAll('h1,h2,[role=status],.success')].filter(visible).map(el=>el.innerText).join(' ');
 if(!/registration\s+(?:confirmed|successful|complete)|successfully\s+(?:registered|submitted)|application\s+(?:submitted|received)|thank you for registering/i.test(headings))return null;
 const text=document.body.innerText.slice(0,16000),url=new URL(location.href);
 const receiptId=text.match(/(?:registration|confirmation|receipt|application)\s*(?:id|number|code|#)\s*[:#]?\s*([A-Za-z0-9_-]{4,200})/i)?.[1]||(/confirmation|receipt|success/i.test(url.pathname)?url.searchParams.get('id'):null);
 if(!receiptId)return null;
 return {receiptId,url:url.href,message:headings.slice(0,1000)};
}
