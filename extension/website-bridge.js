// Public extension identity only. Authentication stays in trusted extension storage.
function announceScout(){window.postMessage({type:'deadline-scout-extension-ready',extensionId:chrome.runtime.id},location.origin);}
window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.type==='deadline-scout-find-extension')announceScout();});
announceScout();
