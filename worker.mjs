// No public send endpoint. Only the scheduled handler can read and send new
// notifications from the existing Firebase database. Credentials stay server-side.
const PAGE = 20, SEND_LIMIT = 12, OVERLAP_MS = 5 * 60_000, RETAIN_MS = 7 * 86400_000;
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let oauthCache;
export function timeKey(ms) {
  let out = '';
  for (let i = 0; i < 8; i++) { out = PUSH_CHARS[ms % 64] + out; ms = Math.floor(ms / 64); }
  return out + '------------';
}
export function recipients(n, devices) {
  if (!n || typeof n !== 'object') return [];
  return Object.entries(devices || {}).filter(([key, d]) => {
    if (!d || d.enabled !== true || d.clientVersion !== 25 || !d.token || !d.user || d.user === 'unknown') return false;
    if (n.targetDevice && (key !== n.targetDevice || !n.user)) return false;
    return n.user ? d.user === n.user : Array.isArray(n.roles) && n.roles.includes(d.role);
  }).map(([key, d]) => ({key, user: d.user}));
}
function safeError(error) { return String(error?.code || error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_:/ .-]/g, '').slice(0, 120); }
function fail(code) { const e = new Error(code); e.code = code; return e; }
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
const encode = value => b64url(new TextEncoder().encode(JSON.stringify(value)));
export async function accessToken(env, fetcher = fetch) {
  if (oauthCache?.project === env.PROJECT_ID && oauthCache.until > Date.now()) return oauthCache.token;
  let sa;
  try { sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT); } catch { throw fail('MISSING_SERVICE_ACCOUNT'); }
  if (sa.project_id !== env.PROJECT_ID || !sa.client_email || !sa.private_key) throw fail('SERVICE_ACCOUNT_PROJECT_MISMATCH');
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = encode({alg:'RS256', typ:'JWT'}) + '.' + encode({
    iss:sa.client_email, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600,
    scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.messaging'
  });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:unsigned+'.'+b64url(new Uint8Array(signature))}),
    signal:AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw fail('GOOGLE_AUTH_'+response.status);
  const data = await response.json();
  if (!data.access_token) throw fail('GOOGLE_AUTH_EMPTY');
  oauthCache = {project:env.PROJECT_ID, token:data.access_token, until:Date.now()+(Number(data.expires_in || 3600)-120)*1000};
  return oauthCache.token;
}
export function messageFor(env, eventId, n, token) {
  const url = new URL(env.APP_URL);
  if (url.protocol !== 'https:') throw fail('APP_URL_REQUIRES_HTTPS');
  if (n.ticketNo) url.searchParams.set('ticket', String(n.ticketNo).slice(0, 100));
  return {message:{token, data:{
    title:String(n.title || 'وحدة تقنية المعلومات').slice(0, 100),
    body:String(n.message || 'يوجد تحديث جديد في نظام الدعم الفني.').slice(0, 500),
    url:url.href, eventId, ticketNo:String(n.ticketNo || '').slice(0, 100),
    recipient:String(n._recipient || '')
  }, webpush:{headers:{TTL:'3600', Urgency:'high'}}}};
}
export function classifyFailure(status, data) {
  const codes = (data?.error?.details || []).map(d => d.errorCode).filter(Boolean);
  if (codes.includes('UNREGISTERED')) return {state:'expired', code:'UNREGISTERED'};
  if (status === 429 || status >= 500 || status === 401 || status === 403) return {state:'pending', code:'FCM_'+status};
  // INVALID_ARGUMENT can indicate an invalid payload, so do not delete the token.
  return {state:'failed', code:'FCM_'+(codes[0] || status)};
}
export function services(env, fetcher = fetch) {
  return {
    async read(path, query) {
      const token = await accessToken(env, fetcher);
      const url = new URL(path+'.json', env.DATABASE_URL+'/');
      for (const [k,v] of Object.entries(query || {})) url.searchParams.set(k, JSON.stringify(v));
      const res = await fetcher(url.href, {headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(15_000)});
      if (res.status === 401) oauthCache = null;
      if (!res.ok) throw fail('DATABASE_READ_'+res.status);
      return await res.json() || {};
    },
    async disable(key) {
      const token = await accessToken(env, fetcher);
      const url = new URL('it_push_devices/'+encodeURIComponent(key)+'.json', env.DATABASE_URL+'/');
      const res = await fetcher(url.href, {method:'PATCH', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({enabled:false,disabledReason:'UNREGISTERED'}), signal:AbortSignal.timeout(10_000)});
      if (!res.ok) throw fail('DATABASE_DISABLE_'+res.status);
    },
    async send(id, n, device) {
      const token = await accessToken(env, fetcher);
      const response = await fetcher('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(env.PROJECT_ID)+'/messages:send', {
        method:'POST', headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
        body:JSON.stringify(messageFor(env, id, {...n, _recipient:device.user}, device.token)), signal:AbortSignal.timeout(10_000)
      });
      if (response.ok) return {state:'sent', code:''};
      const body = await response.json().catch(()=>({}));
      if (response.status === 401) oauthCache = null;
      const result = classifyFailure(response.status, body);
      result.retryAfter = Math.min(3600, Math.max(60, Number(response.headers.get('Retry-After')) || 0));
      return result;
    }
  };
}
export async function run(env, api = services(env), now = Date.now()) {
  const db = env.STATE, lease = crypto.randomUUID();
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const lock = await stmt('UPDATE state SET lease_id=?, lease_until=?, last_run=? WHERE id=1 AND lease_until<?', lease, now+240_000, now, now).run();
  if (!lock.meta.changes) return {busy:true};
  let processingError = '';
  try {
    let s = await stmt('SELECT * FROM state WHERE id=1').first();
    // Do not hide a send-configuration error just because a later idle poll succeeds.
    processingError = /^(FCM_|NETWORK_RETRY|TOKEN_DISABLE_)/.test(s.last_error) ? s.last_error : '';
    if (!s.started_at) {
      // First start establishes a watermark: old notifications are never broadcast.
      const existing = await api.read('it_notifications', {orderBy:'$key', limitToLast:1});
      const cursor = Object.keys(existing).filter(k=>k.startsWith('-')).sort().at(-1) || timeKey(now);
      await stmt('UPDATE state SET cursor=?, started_at=? WHERE id=1', cursor, now).run();
      s = {...s, cursor, started_at:now};
    } else {
      const fresh = await api.read('it_notifications', {orderBy:'$key', startAt:s.cursor, limitToFirst:PAGE+1});
      // A small overlap catches recently delayed/offline writes without downloading
      // the entire history. IDs remain unique in D1, including read-status edits.
      const lower = timeKey(Math.max(s.started_at, now-OVERLAP_MS));
      const recent = lower < s.cursor ? await api.read('it_notifications', {orderBy:'$key', startAt:lower, endAt:s.cursor, limitToLast:PAGE}) : {};
      const rows = Object.entries({...recent,...fresh}).filter(([id,n])=> id.startsWith('-') && id >= timeKey(s.started_at) && n && typeof n === 'object');
      const cursor = Object.keys(fresh).filter(k=>k.startsWith('-') && k>s.cursor).sort().at(-1) || s.cursor;
      const inserts = rows.map(([id,n])=>stmt('INSERT OR IGNORE INTO events(id,payload,created_at) VALUES(?,?,?)', id, JSON.stringify({title:n.title,message:n.message,ticketNo:n.ticketNo,user:n.user,roles:n.roles,targetDevice:n.targetDevice}), now));
      inserts.push(stmt('UPDATE state SET cursor=? WHERE id=1', cursor));
      await db.batch(inserts);
    }
    const unexpanded = (await stmt('SELECT * FROM events WHERE expanded=0 ORDER BY created_at,id LIMIT 4').all()).results;
    const due = await stmt("SELECT event_id FROM deliveries WHERE status='pending' AND next_at<=? LIMIT 1", now).first();
    if (unexpanded.length || due) {
      const devices = await api.read('it_push_devices');
      for (const e of unexpanded) {
        const list = recipients(JSON.parse(e.payload), devices);
        await db.batch([
          stmt("INSERT OR IGNORE INTO deliveries(event_id,device_key,expected_user,next_at) SELECT ?,json_extract(value,'$.key'),json_extract(value,'$.user'),? FROM json_each(?)", e.id, now, JSON.stringify(list)),
          stmt('UPDATE events SET expanded=1 WHERE id=?',e.id)
        ]);
      }
      const jobs = (await stmt("SELECT d.*,e.payload FROM deliveries d JOIN events e ON e.id=d.event_id WHERE d.status='pending' AND d.next_at<=? ORDER BY d.next_at,d.event_id LIMIT ?", now, SEND_LIMIT).all()).results;
      let attempted = false, deliveryError = '';
      for (const job of jobs) {
        const device = devices[job.device_key], n = JSON.parse(job.payload);
        let result;
        if (!device || device.user !== job.expected_user || !recipients(n, {[job.device_key]:device}).length) result = {state:'skipped',code:'DEVICE_CHANGED_OR_DISABLED'};
        else {
          attempted = true;
          try { result = await api.send(job.event_id, n, device); }
          catch { result = {state:'pending',code:'NETWORK_RETRY'}; }
        }
        const attempts = job.attempts+1;
        if (result.state === 'pending' && attempts >= 8) result.state = 'failed';
        if (result.state === 'pending' || result.state === 'failed') deliveryError = result.code;
        if (result.state === 'expired') {
          try { await api.disable(job.device_key); } catch { deliveryError = 'TOKEN_DISABLE_FAILED'; }
          device.enabled = false;
        }
        const retry = Math.max(result.retryAfter || 60, Math.min(3600, 60 * 2 ** Math.min(attempts-1,6)));
        await stmt('UPDATE deliveries SET status=?,attempts=?,next_at=?,last_error=? WHERE event_id=? AND device_key=?', result.state,attempts,now+retry*1000,result.code || '',job.event_id,job.device_key).run();
      }
      if (attempted) processingError = deliveryError;
    }
    // Bounded retention. Pending jobs survive pruning; terminal rows expire in a week.
    await stmt("DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at<? AND expanded=1 AND NOT EXISTS(SELECT 1 FROM deliveries WHERE event_id=events.id AND status='pending') LIMIT 100)", now-RETAIN_MS).run();
    await stmt('UPDATE state SET last_ok=?,last_error=? WHERE id=1', now, processingError).run();
    return {ok:!processingError};
  } catch (e) {
    await stmt('UPDATE state SET last_error=? WHERE id=1',safeError(e)).run();
    throw e;
  } finally {
    await stmt('UPDATE state SET lease_until=0,lease_id=NULL WHERE id=1 AND lease_id=?',lease).run();
  }
}
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env).catch(e=>{ console.error('push_tick_failed',safeError(e)); throw fail(safeError(e)); }));
  },
  async fetch(request, env) {
    const appOrigin = new URL(env.APP_URL).origin;
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
    if (request.headers.get('Origin') === appOrigin) headers['Access-Control-Allow-Origin'] = appOrigin;
    if (new URL(request.url).pathname !== '/health' || request.method !== 'GET') return new Response('{"error":"not_found"}',{status:404,headers});
    try {
      const s = await env.STATE.prepare('SELECT last_run,last_ok,last_error,started_at FROM state WHERE id=1').first();
      const configured = !!env.GOOGLE_SERVICE_ACCOUNT && !!s;
      const ready = configured && !!s.last_ok && Date.now()-s.last_ok < 300_000 && !s.last_error;
      return new Response(JSON.stringify({service:'cte-push',version:25,configured,ready,lastRun:s?.last_run || null,lastSuccess:s?.last_ok || null,error:s?.last_error || '',intervalSeconds:60}),{headers});
    } catch { return new Response('{"service":"cte-push","ready":false,"error":"STATE_NOT_READY"}',{status:503,headers}); }
  }
};
