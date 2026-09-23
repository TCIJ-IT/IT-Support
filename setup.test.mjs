import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
test('one-command setup provisions resources and writes only public web configuration',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'cte-setup-test-'));
  try{
    const backend=path.join(root,'cloudflare-push');
    await mkdir(path.join(backend,'node_modules/wrangler/bin'),{recursive:true});await mkdir(path.join(root,'web'));
    for(const name of ['setup.mjs','wrangler.json','schema.sql'])await writeFile(path.join(backend,name),await readFile(new URL('../'+name,import.meta.url)));
    const key=path.join(root,'local-test-key.json');
    await writeFile(key,JSON.stringify({type:'service_account',project_id:'test-mode-c1433',client_email:'fake@example.test',private_key:'test-private-secret'}));
    await writeFile(path.join(backend,'node_modules/wrangler/bin/wrangler.js'),`
      const fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync('calls.txt',JSON.stringify(args)+'\\n');
      if(args[0]==='d1'&&args[1]==='list')console.log(JSON.stringify(fs.existsSync('created')?[{name:'cte-push-state',uuid:'12345678-1234-1234-1234-123456789abc'}]:[]));
      if(args[0]==='d1'&&args[1]==='create'){if(args.includes('--json'))process.exit(2);fs.writeFileSync('created','yes');}
      if(args[0]==='deploy')console.log('https://cte-jeddah-push.example.workers.dev');
      if(args[0]==='secret'){let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{if(JSON.parse(input).private_key!=='test-private-secret')process.exit(3);});}
    `);
    const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(backend,'setup.mjs')],{cwd:backend,windowsHide:true});let output='',sent=false;child.stdout.on('data',d=>{output+=d;if(!sent&&output.includes('ثم Enter:')){sent=true;child.stdin.write(key+'\n');}});child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',code=>resolve({code,output}));});
    const first=await run();assert.equal(first.code,0,first.output);assert(!first.output.includes('test-private-secret'));
    const config=await readFile(path.join(root,'push-config.js'),'utf8');assert(config.includes('https://cte-jeddah-push.example.workers.dev'));assert(!config.includes('private'));
    assert.deepEqual(JSON.parse(await readFile(path.join(backend,'wrangler.json'),'utf8')).triggers.crons,['* * * * *']);
    assert.equal((await run()).code,0);
    const calls=(await readFile(path.join(backend,'calls.txt'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(c=>c[0]==='d1'&&c[1]==='create').length,1);
  }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert(path.basename(root).startsWith('cte-setup-test-'));await rm(root,{recursive:true,force:true});}
});
