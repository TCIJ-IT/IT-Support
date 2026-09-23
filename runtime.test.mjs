import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('actual Workers runtime and D1 execute the queue and health endpoint',async()=>{
  const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
  const mock=`let mockCalls=0; const mockAPI={
    async read(path,query){if(path==='it_push_devices')return {d:{user:'ali',role:'engineer',enabled:true,clientVersion:25,token:'test-token'}};
    if(!query.startAt)return {};return {[timeKey(Date.now()+1000)]:{user:'ali',title:'test',message:'body'}};},
    async send(){mockCalls++;return {state:'sent',code:''}},async disable(){}};\n`;
  const script=mock+source.replace('async fetch(request, env) {',`async fetch(request, env) {
    if(new URL(request.url).pathname==='/__local_test_tick'){await run(env,mockAPI);return Response.json({sent:mockCalls});}`);
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-01',d1Databases:['STATE'],bindings:{APP_URL:'https://example.com/app/',PROJECT_ID:'test-mode-c1433',GOOGLE_SERVICE_ACCOUNT:'mock-only'}}));
  try{
    const db=await mf.getD1Database('STATE');
    const sql=readFileSync(new URL('../schema.sql',import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch(sql.map(s=>db.prepare(s)));
    assert.equal((await(await mf.dispatchFetch('https://local.test/health')).json()).ready,false);
    assert.equal((await(await mf.dispatchFetch('https://local.test/__local_test_tick')).json()).sent,0);
    assert.equal((await(await mf.dispatchFetch('https://local.test/__local_test_tick')).json()).sent,1);
    assert.equal((await(await mf.dispatchFetch('https://local.test/health')).json()).ready,true);
  }finally{await mf.dispose();}
});
