import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{run,recipients,timeKey,messageFor,classifyFailure,accessToken} from '../worker.mjs';

function database() {
  const raw=new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const prepare=sql=>{
    let values=[];
    const q={bind(...v){values=v;return q;},async run(){const r=raw.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return raw.prepare(sql).get(...values)||null;},async all(){return {results:raw.prepare(sql).all(...values)};}};
    return q;
  };
  return {prepare,async batch(stmts){raw.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());raw.exec('COMMIT');return out;}catch(e){raw.exec('ROLLBACK');throw e;}},raw};
}
const base=Date.parse('2026-09-23T00:00:00Z');
const envFor=()=>({STATE:database(),PROJECT_ID:'test-mode-c1433',APP_URL:'https://anasmonti80-png.github.io/CTE-Jeddah-IT-Support/',GOOGLE_SERVICE_ACCOUNT:'configured'});
const devices={a:{token:'token-a',user:'ali',role:'engineer',enabled:true,clientVersion:25},b:{token:'token-b',user:'admin',role:'admin',enabled:true,clientVersion:25},c:{token:'token-c',user:'ali',role:'engineer',enabled:false,clientVersion:25}};
function fake() {
  const api={events:{},devices:structuredClone(devices),sent:[],result:{state:'sent',code:''},failRead:false,reads:[],
    async read(path,q){api.reads.push(path);if(api.failRead)throw Error('DATABASE_READ_403');if(path==='it_push_devices')return api.devices;
      let rows=Object.entries(api.events).sort(([a],[b])=>a.localeCompare(b));
      if(q?.startAt)rows=rows.filter(([k])=>k>=q.startAt);if(q?.endAt)rows=rows.filter(([k])=>k<=q.endAt);
      if(q?.limitToFirst)rows=rows.slice(0,q.limitToFirst);if(q?.limitToLast)rows=rows.slice(-q.limitToLast);return Object.fromEntries(rows);},
    async send(id,n,d){api.sent.push({id,n,d:{...d}});return api.result;},async disable(k){api.devices[k].enabled=false;}};
  api.add=(offset,n={roles:['admin'],title:'new',message:'body'})=>{const id=timeKey(base+offset).slice(0,8)+'abcdefghijkl';api.events[id]=n;return id;};return api;
}
test('recipients fail closed and restrict personal tests',()=>{
  assert.deepEqual(recipients({},devices),[]);
  assert.deepEqual(recipients({roles:['admin']},devices),[{key:'b',user:'admin'}]);
  assert.deepEqual(recipients({user:'ali'},devices),[{key:'a',user:'ali'}]);
  assert.deepEqual(recipients({user:'ali',targetDevice:'b'},devices),[]);
  assert.deepEqual(recipients({roles:['admin'],targetDevice:'b'},devices),[]);
});
test('first startup skips history; future events send once despite read edits and repeat polls',async()=>{
  const env=envFor(),api=fake();api.add(-1000);await run(env,api,base);assert.equal(api.sent.length,0);
  const id=api.add(1000);await run(env,api,base+60000);assert.equal(api.sent.length,1);assert.equal(api.sent[0].id,id);
  api.events[id].readBy={admin:true};await run(env,api,base+120000);assert.equal(api.sent.length,1);
});
test('recent out-of-order writes are caught by overlap',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);api.add(2000);await run(env,api,base+60000);
  api.add(1000);await run(env,api,base+120000);assert.equal(api.sent.length,2);
});
test('more than a page drains without losses; at most 12 sends per invocation',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);
  api.devices=Object.fromEntries(Array.from({length:16},(_,i)=>['d'+i,{...devices.b,token:'t'+i}]));
  for(let i=1;i<=25;i++)api.add(i*1000);
  let last=0;for(let t=1;t<40;t++){await run(env,api,base+t*60000);assert(api.sent.length-last<=12);last=api.sent.length;}
  assert.equal(api.sent.length,25*16);
  assert.equal(new Set(api.sent.map(x=>x.id+':'+x.d.token)).size,400);
});
test('transient failures back off, retry and eventually succeed',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);api.add(1000);api.result={state:'pending',code:'FCM_503'};
  await run(env,api,base+60000);await run(env,api,base+90000);assert.equal(api.sent.length,1);
  api.result={state:'sent',code:''};await run(env,api,base+120000);assert.equal(api.sent.length,2);
  await run(env,api,base+180000);assert.equal(api.sent.length,2);
});
test('queued delivery is cancelled if device changes user or logs out',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);api.add(1000);api.result={state:'pending',code:'FCM_503'};
  await run(env,api,base+60000);api.devices.b.user='different';await run(env,api,base+120000);assert.equal(api.sent.length,1);
  assert.equal(env.STATE.raw.prepare('SELECT status FROM deliveries').get().status,'skipped');
});
test('expired tokens disabled; bad payloads do not destroy tokens',async()=>{
  assert.equal(classifyFailure(400,{error:{details:[{errorCode:'INVALID_ARGUMENT'}]}}).state,'failed');
  const env=envFor(),api=fake();await run(env,api,base);api.add(1000);api.result=classifyFailure(404,{error:{details:[{errorCode:'UNREGISTERED'}]}});
  await run(env,api,base+60000);assert.equal(api.devices.b.enabled,false);
});
test('database failure does not advance cursor and lease is released',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);const before=env.STATE.raw.prepare('SELECT cursor FROM state').get().cursor;
  api.failRead=true;await assert.rejects(run(env,api,base+60000));const s=env.STATE.raw.prepare('SELECT * FROM state').get();assert.equal(s.cursor,before);assert.equal(s.lease_until,0);
  api.failRead=false;api.add(1000);await run(env,api,base+120000);assert.equal(api.sent.length,1);
});
test('overlapping invocation cannot acquire active lease',async()=>{
  const env=envFor();env.STATE.raw.prepare('UPDATE state SET lease_until=?').run(base+20000);
  assert.deepEqual(await run(env,fake(),base),{busy:true});
});
test('idle poll does not download the device list',async()=>{
  const env=envFor(),api=fake();await run(env,api,base);await run(env,api,base+60000);assert(!api.reads.includes('it_push_devices'));
});
test('FCM uses data-only messages, stable IDs and trusted application URL',()=>{
  const message=messageFor(envFor(),'event-123',{title:'عربي',message:'نص',url:'https://evil.test',ticketNo:'IT-1',_recipient:'ali'},'token').message;
  assert(!message.notification);assert.equal(message.data.eventId,'event-123');assert.equal(message.data.recipient,'ali');
  assert.equal(message.data.url,'https://anasmonti80-png.github.io/CTE-Jeddah-IT-Support/?ticket=IT-1');
});
test('health reflects successful recent cron; API has no public send route',async()=>{
  const env=envFor(),request=new Request('https://backend.test/health',{headers:{Origin:'https://anasmonti80-png.github.io'}});
  assert.equal((await (await worker.fetch(request,env)).json()).ready,false);
  await run(env,fake(),Date.now());const response=await worker.fetch(request,env);assert.equal((await response.json()).ready,true);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://anasmonti80-png.github.io');
  assert.equal((await worker.fetch(new Request('https://backend.test/send',{method:'POST'}),env)).status,404);
});
test('service-account key is signed locally; only a JWT assertion goes to Google',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=await crypto.subtle.exportKey('pkcs8',pair.privateKey);
  const sa={project_id:'auth-test',client_email:'test@auth-test.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(der).toString('base64')+'\n-----END PRIVATE KEY-----'};
  let calls=0;
  const fetcher=async(url,opts)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');const assertion=opts.body.get('assertion');assert(!assertion.includes('PRIVATE KEY'));const [header,body,sig]=assertion.split('.');
    assert.equal(JSON.parse(Buffer.from(body,'base64url')).iss,sa.client_email);
    assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(sig,'base64url'),Buffer.from(header+'.'+body)));
    return Response.json({access_token:'test-access',expires_in:3600});};
  const env={PROJECT_ID:'auth-test',GOOGLE_SERVICE_ACCOUNT:JSON.stringify(sa)};
  assert.equal(await accessToken(env,fetcher),'test-access');assert.equal(await accessToken(env,fetcher),'test-access');assert.equal(calls,1);
});
