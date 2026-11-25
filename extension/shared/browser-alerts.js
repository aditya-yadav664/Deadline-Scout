// Acknowledge only after the browser has accepted the notification.
export async function deliverBrowserAlerts({load,notify,ack}){
  const alerts=await load();let shown=0;
  for(const alert of alerts){if(!alert.change&&!alert.notice)continue;await notify(alert);await ack(alert.id);shown++;}
  return shown;
}

export async function enableExtensionAlerts({browser,validateSession,signIn}){
  if(!await browser.permissions.request({permissions:['notifications']}))throw new Error('Notifications were not allowed. Enable them for Deadline Scout in Edge.');
  try{await validateSession();}catch(error){if(error.status!==401)throw error;await signIn();await validateSession();}
  if(await browser.notifications.getPermissionLevel()==='denied')throw new Error('Edge is blocking extension notifications. Allow them in extension settings.');
  await browser.alarms.create('surface-alerts',{periodInMinutes:1});
}
