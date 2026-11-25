// Clipboard contents remain in memory and are passed only after URL validation.
export function copiedLinkReviewUrl(value,backendUrl){
  const text=String(value??'').trim();
  if(!text)throw new Error('Copy a registration link first.');
  let url;try{url=new URL(text);}catch{throw new Error('The copied text is not a valid HTTP(S) link. Copy the full registration URL.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Copy a public HTTP(S) registration link without embedded account credentials.');
  return backendUrl+'/#inspect='+encodeURIComponent(url.href);
}
