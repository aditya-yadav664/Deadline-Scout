import {isExtension,settings} from './api.js';
if(isExtension){const s=await settings();location.replace(s.backendUrl+'/'+location.hash);}else{await import('./dashboard.js?v=1.8.1');}
