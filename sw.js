const CACHE_NAME='cte-it-support-v26-complete';
const PUSH_CACHE='cte-it-push-state-v1';
const APP_SHELL=['./','./index.html','./manifest.json','./push-client.js','./push-config.js','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./unit-brand.jpg','./college-building.jpg'];
const scopeURL=new URL(self.registration.scope);
const stateURL=new URL('__push_owner__',scopeURL).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cte-it-support-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==scopeURL.origin||!url.pathname.startsWith(scopeURL.pathname))return;
  event.respondWith(fetch(req).then(res=>{
    if(res.ok){const copy=res.clone();event.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(req,copy)));}
    return res;
  }).catch(async()=>await caches.match(req)||(req.mode==='navigate'?await caches.match('./index.html'):Response.error())));
});
function safeTarget(value) {
  try {const url=new URL(value||'./index.html',scopeURL);if(url.origin===scopeURL.origin&&url.pathname.startsWith(scopeURL.pathname))return url.href;}catch{}
  return new URL('index.html',scopeURL).href;
}
async function getOwner() {
  const cache=await caches.open(PUSH_CACHE),res=await cache.match(stateURL);
  return res?res.json():{enabled:false,user:''};
}
let pushQueue=Promise.resolve();
async function receivePush(payload) {
  const d=payload.data||payload,n=payload.notification||{};
  const owner=await getOwner();
  if(!owner.enabled||!d.recipient||d.recipient!==owner.user)return;
  const id=String(d.eventId||payload.fcmMessageId||payload.message_id||'');
  if(!id)return;
  const cache=await caches.open(PUSH_CACHE),key=new URL('__push_seen__/'+encodeURIComponent(id),scopeURL).href;
  const duplicate=!!await cache.match(key);
  await self.registration.showNotification(d.title||n.title||'وحدة تقنية المعلومات',{
    body:d.body||n.body||'يوجد تحديث جديد.',icon:new URL('icon-192.png',scopeURL).href,
    // Every push displays a notification as required on iOS. A retry replaces
    // the same card silently instead of creating another card or sounding twice.
    badge:new URL('icon-192.png',scopeURL).href,dir:'rtl',lang:'ar',tag:'cte-'+id,renotify:false,silent:duplicate,
    data:{url:safeTarget(d.url),eventId:id,recipient:d.recipient}
  });
  await cache.put(key,new Response(String(Date.now())));
  const keys=(await cache.keys()).filter(r=>r.url.includes('/__push_seen__/'));
  for(const old of keys.slice(0,Math.max(0,keys.length-256)))await cache.delete(old);
}
self.addEventListener('push',event=>{
  let payload;try{payload=event.data?.json()||{};}catch{return;}
  pushQueue=pushQueue.catch(()=>{}).then(()=>receivePush(payload));
  event.waitUntil(pushQueue);
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const owner=await getOwner();
    if(!owner.enabled||owner.user!==event.notification.data?.recipient)return;
    const target=safeTarget(event.notification.data?.url);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(c=>{const u=new URL(c.url);return u.origin===scopeURL.origin&&u.pathname.startsWith(scopeURL.pathname);});
    if(client){await client.navigate(target).catch(()=>{});return client.focus();}
    return self.clients.openWindow(target);
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type!=='CTE_PUSH_USER')return;
  const task=(async()=>{
    const cache=await caches.open(PUSH_CACHE);
    const enabled=event.data.enabled===true,user=enabled?String(event.data.user||''):'';
    await cache.put(stateURL,new Response(JSON.stringify({enabled:enabled&&!!user,user})));
    for(const notification of await self.registration.getNotifications()){
      if(!enabled||notification.data?.recipient!==user)notification.close();
    }
  })();
  event.waitUntil(task.then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));
});
