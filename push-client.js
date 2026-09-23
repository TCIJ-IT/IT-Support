/* V25: one permission gesture per installation; saved cloud settings; silent refresh. */
let v19Messaging = null, v19SwRegistration = null, v19VapidKey = '';
const v25Push = {busy:false, enabled:false, user:'', error:'', backend:null, lastCheck:0, lastSync:0, generation:0};
let v25PushQueue = Promise.resolve();
const v25Store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v) { try { localStorage.setItem(k,v); } catch {} },
  remove(k) { try { localStorage.removeItem(k); } catch {} }
};
function v25Esc(v) { return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function v25Timeout(p, ms = 12000) {
  let timer;
  return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('انتهت مهلة الاتصال؛ تحقق من الإنترنت ثم أعد المحاولة.')),ms)})]).finally(()=>clearTimeout(timer));
}
async function v19HashText(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('').slice(0,40);
}
function v19PushSupport() {
  return {https:window.isSecureContext, notification:'Notification' in window,
    serviceWorker:'serviceWorker' in navigator, push:'PushManager' in window,
    installed:matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    ios:/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints>1)};
}
function v25ValidVapid(value) {
  try { const bytes = atob(value.replace(/-/g,'+').replace(/_/g,'/')); return bytes.length===65 && bytes.charCodeAt(0)===4; } catch { return false; }
}
async function v19LoadVapid() {
  try {
    const snap = await v25Timeout(db.ref('it_settings/fcm_vapid_public_key').once('value'));
    const remote = String(snap.val() || '').trim();
    v19VapidKey = remote || v25Store.get('cte_fcm_vapid_public_key') || '';
    if (remote) v25Store.set('cte_fcm_vapid_public_key',remote);
  } catch { v19VapidKey = v25Store.get('cte_fcm_vapid_public_key') || ''; }
  return v19VapidKey;
}
async function v19SetVapidKey() {
  if (activeUser?.role !== 'admin') return;
  const value = prompt('Public VAPID Key — يُحفظ مرة واحدة لجميع المستخدمين. لا تضع المفتاح الخاص هنا.',await v19LoadVapid());
  if (value === null) return;
  const key = value.trim();
  if (!v25ValidVapid(key)) { alert('هذه ليست صيغة Public VAPID Key الصحيحة. انسخ المفتاح العام من Web Push certificates في Firebase.'); return; }
  try {
    await v25Timeout(db.ref('it_settings/fcm_vapid_public_key').set(key));
    v25Store.set('cte_fcm_vapid_public_key',key); v19VapidKey = key;
    alert('تم حفظ المفتاح للجميع. لا تحتاج إدخاله عند كل دخول.');
    await v25RestorePush();
  } catch { alert('تعذر حفظ المفتاح في Firebase. لم يتم تأكيد حفظه للجميع؛ تحقق من الاتصال وصلاحيات الحساب.'); }
  v19RenderPushCard();
}
async function v25WorkerState(enabled, user) {
  const registration = v19SwRegistration || await v25Timeout(navigator.serviceWorker.ready);
  if (!registration.active) throw new Error('خدمة الإشعارات لم تجهز بعد. أعد فتح التطبيق.');
  const channel = new MessageChannel();
  const ack = new Promise((resolve,reject)=>{channel.port1.onmessage=e=>e.data?.ok ? resolve() : reject(new Error('تعذر حفظ حالة الإشعارات على الجهاز.'));});
  registration.active.postMessage({type:'CTE_PUSH_USER', enabled, user},[channel.port2]);
  try { await v25Timeout(ack,5000); } finally { channel.port1.close(); }
}
function v25Serialize(operation) {
  const next = v25PushQueue.catch(()=>{}).then(operation);
  v25PushQueue = next.catch(()=>{});
  return next;
}
async function v25Register(generation) {
  const user = activeUser && {user:activeUser.user, role:activeUser.role};
  if (!user || generation!==v25Push.generation) return;
  const vapid = await v19LoadVapid();
  if (!v25ValidVapid(vapid)) throw new Error('ينقص إعداد المفتاح العام. يضيفه المدير مرة واحدة من إعداد Web Push.');
  v19SwRegistration = await v25Timeout(navigator.serviceWorker.ready);
  if (!firebase.messaging) throw new Error('تعذر تحميل خدمة الإشعارات. تحقق من اتصال الإنترنت.');
  v19Messaging = v19Messaging || firebase.messaging();
  const token = await v25Timeout(v19Messaging.getToken({vapidKey:vapid,serviceWorkerRegistration:v19SwRegistration}),25000);
  if (!token) throw new Error('لم يُصدر الجهاز رمز استقبال. أعد المحاولة.');
  if (generation!==v25Push.generation || activeUser?.user!==user.user) return;
  const key = await v19HashText(token), oldKey = v25Store.get('cte_push_device_key');
  await v25WorkerState(true,user.user);
  const support = v19PushSupport();
  const updates = {};
  updates['it_push_devices/'+key] = {token,user:user.user,role:user.role,
    platform:support.ios?'iOS':/android/i.test(navigator.userAgent)?'Android':'Desktop',
    installed:support.installed,lastSeen:new Date().toISOString(),enabled:true,clientVersion:25};
  if (oldKey && oldKey!==key) updates['it_push_devices/'+oldKey+'/enabled'] = false;
  try { await v25Timeout(db.ref().update(updates)); }
  catch (e) { await v25WorkerState(false,'').catch(()=>{}); throw e; }
  v25Store.set('cte_push_device_key',key);
  v25Store.set('cte_push_user',user.user);
  v25Store.set('cte_browser_notifications','1');
  if (generation!==v25Push.generation) return;
  Object.assign(v25Push,{enabled:true,user:user.user,lastSync:Date.now(),error:''});
}
async function v25RestorePush() {
  const s=v19PushSupport();
  if (!activeUser || !s.https || !s.notification || !s.serviceWorker || !s.push || (s.ios&&!s.installed)) { v19RenderPushCard(); return; }
  if (Notification.permission!=='granted' || v25Store.get('cte_push_optout:'+activeUser.user)==='1') { v19RenderPushCard(); return; }
  if (v25Push.busy) return;
  const generation=v25Push.generation;
  v25Push.busy=true; v19RenderPushCard();
  try { await v25Serialize(()=>v25Register(generation)); }
  catch(e) { v25Push.enabled=false; v25Push.error=e.message || 'تعذر تأكيد تسجيل الجهاز. أعد المحاولة.'; }
  finally { v25Push.busy=false; v19RenderPushCard(); }
}
async function v19EnableBackgroundPush() {
  if (!activeUser) { alert('سجّل الدخول أولًا لربط الإشعارات بحسابك.'); return; }
  if (v25Push.busy) return;
  const s=v19PushSupport();
  if (!s.https || !s.notification || !s.serviceWorker || !s.push) { alert('استخدم رابط HTTPS على متصفح يدعم إشعارات الويب.'); return; }
  if (s.ios&&!s.installed) { alert('على الآيفون أو الآيباد: من Safari اختر مشاركة ← إضافة إلى الشاشة الرئيسية، ثم افتح التطبيق من أيقونته وفعّل الإشعارات. يتطلب iOS/iPadOS 16.4 أو أحدث.'); return; }
  // Keep the permission request directly in the click gesture for Safari/iOS.
  if (Notification.permission==='default') await Notification.requestPermission();
  if (Notification.permission!=='granted') { alert('الإشعارات محظورة. اسمح بها من إعدادات التطبيق أو المتصفح؛ لا يمكن إعادة إظهار نافذة السماح تلقائيًا.'); v19RenderPushCard(); return; }
  v25Store.remove('cte_push_optout:'+activeUser.user);
  await v25RestorePush();
}
enableBrowserNotifications = v19EnableBackgroundPush;
// The push service worker owns OS notifications. Old realtime listeners retain
// in-app badges/toasts but cannot create a second operating-system notification.
browserNotify = function() {};
async function v25DisablePush() {
  const key=v25Store.get('cte_push_device_key');
  v25Push.generation++;
  v25Push.enabled=false;
  const user=activeUser?.user || v25Store.get('cte_push_user');
  if(user) v25Store.set('cte_push_optout:'+user,'1');
  await v25Serialize(async()=>{
    await v25WorkerState(false,'').catch(()=>{});
    if(key) await v25Timeout(db.ref('it_push_devices/'+key+'/enabled').set(false));
  }).catch(()=>{v25Push.error='تم الإيقاف على الجهاز؛ تعذر تحديث الخادم حاليًا.';});
  v19RenderPushCard();
}
async function v25BackendStatus() {
  if (Date.now()-v25Push.lastCheck<60000) return;
  v25Push.lastCheck=Date.now();
  const url=String(window.CTE_PUSH_CONFIG?.backendUrl || '').replace(/\/$/,'');
  if (!url) {v25Push.backend={ready:false,missing:true}; v19RenderPushCard(); return;}
  try {
    if(new URL(url).protocol!=='https:') throw new Error('HTTPS required');
    const response=await fetch(url+'/health',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(!response.ok || data.service!=='cte-push') throw new Error('invalid health');
    v25Push.backend=data;
  } catch {v25Push.backend={ready:false,unreachable:true};}
  v19RenderPushCard();
}
async function v25TestPush() {
  if (!activeUser || !v25Push.enabled) return;
  const key=v25Store.get('cte_push_device_key');
  try {
    await v25Timeout(db.ref('it_notifications').push({id:Date.now(),user:activeUser.user,targetDevice:key,
      title:'اختبار إشعارات الخلفية',message:'وصل الإشعار من خدمة الإرسال. إعداد هذا الجهاز مكتمل.',ticketNo:'',at:new Date().toISOString(),readBy:{}}));
    alert('تم إنشاء اختبار لهذا الجهاز فقط. اخرج إلى الشاشة الرئيسية وانتظر دقيقة أو دقيقتين.');
  } catch {alert('تعذر إنشاء الاختبار. تحقق من اتصال Firebase.');}
}
function v19RenderPushCard() {
  const host=document.getElementById('v19PushCard'); if(!host)return;
  const s=v19PushSupport(), permission=s.notification?Notification.permission:'unsupported';
  const enabled=v25Push.enabled && v25Push.user===activeUser?.user && permission==='granted';
  const backend=v25Push.backend;
  const serverText=!backend?'جارٍ التحقق':backend.missing?'لم تُنشر خدمة الإرسال بعد':backend.ready?'✅ تعمل تلقائيًا كل دقيقة':backend.unreachable?'تعذر الاتصال بالخدمة':backend.error?'تحتاج مراجعة إعدادات الخدمة':'بانتظار أول تشغيل تلقائي';
  host.innerHTML=`<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
    <div><strong>🔔 إشعارات الخلفية</strong><div class="small text-muted">فعّلها مرة واحدة على كل جهاز. يتم تجديد الربط تلقائيًا عند الدخول.</div></div>
    <div class="d-flex flex-wrap gap-2">${activeUser?.role==='admin'?'<button class="btn btn-sm btn-outline-secondary" onclick="v19SetVapidKey()">إعداد Web Push</button>':''}
    <button class="btn btn-sm ${enabled?'btn-success':'btn-primary'}" onclick="v19EnableBackgroundPush()" ${enabled||v25Push.busy?'disabled':''}>${v25Push.busy?'جارٍ التحقق…':enabled?'✓ الإشعارات مفعّلة':'تفعيل الإشعارات'}</button>
    ${enabled?'<button class="btn btn-sm btn-outline-secondary" onclick="v25TestPush()">اختبار على هذا الجهاز</button><button class="btn btn-sm btn-outline-danger" onclick="v25DisablePush()">إيقاف على هذا الجهاز</button>':''}</div></div>
    <div class="v19-push-grid"><div class="v19-push-state">هذا الجهاز<b>${enabled?'✅ مسجّل لحسابك':v25Push.busy?'جارٍ التحقق':'غير مفعّل'}</b></div>
    <div class="v19-push-state">إذن الإشعارات<b>${permission==='granted'?'✅ مسموح':permission==='denied'?'محظور من إعدادات الجهاز':permission==='unsupported'?'غير مدعوم':'يحتاج موافقتك مرة واحدة'}</b></div>
    <div class="v19-push-state">خدمة الإرسال<b>${v25Esc(serverText)}</b></div>
    <div class="v19-push-state">التثبيت<b>${s.installed?'✅ تطبيق مثبت':s.ios?'أضفه إلى الشاشة الرئيسية':'يمكن تثبيته من قائمة المتصفح'}</b></div></div>
    ${v25Push.error?'<div class="alert alert-warning mt-2 mb-0">'+v25Esc(v25Push.error)+'</div>':''}
    <div class="small text-muted mt-2">إغلاق التطبيق لا يوقف الإشعارات. تسجيل الخروج أو اختيار الإيقاف يعطّلها لهذا الحساب على هذا الجهاز.</div>`;
}
function v19InstallPushCard() {
  const card=document.querySelector('#notifications .card'), body=card?.querySelector('.card-body');
  if(body&&!document.getElementById('v19PushCard')) {const host=document.createElement('div');host.id='v19PushCard';body.before(host);}
  v19RenderPushCard();
  v25BackendStatus();
}
const v25LoginBase=loginSuccess;
loginSuccess=function(user) {
  v25Push.generation++;v25Push.enabled=false;v25Push.error='';
  v25LoginBase(user);v19InstallPushCard();
  // Immediately clear the previous account's local push access before rebinding.
  v25Serialize(()=>v25WorkerState(false,'').catch(()=>{})).then(()=>v25RestorePush());
};
const v25LogoutBase=logout;
logout=function() {
  v25Push.generation++;v25Push.enabled=false;
  const key=v25Store.get('cte_push_device_key');
  v25LogoutBase();
  v25Serialize(async()=>{
    await v25WorkerState(false,'').catch(()=>{});
    if(key) await v25Timeout(db.ref('it_push_devices/'+key+'/enabled').set(false));
    v25Store.remove('cte_push_user');
  }).catch(()=>{});
};
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  v25BackendStatus();
  if(activeUser && Date.now()-v25Push.lastSync>6*3600000) v25RestorePush();
});
window.addEventListener('online',()=>{v25Push.lastCheck=0;v25BackendStatus();v25RestorePush();});
setTimeout(()=>{v19InstallPushCard();if(activeUser)v25RestorePush();},500);
