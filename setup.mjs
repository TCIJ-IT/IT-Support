// One-time guided setup. Never copies private credentials into the web folder.
import {readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const cli=path.join(dir,'node_modules/wrangler/bin/wrangler.js');
const rl=createInterface({input:stdin,output:stdout});
const input=async(q)=>(await rl.question(q)).trim();
function wrangler(args,{capture=false,secret,echo=false}={}) {
  return new Promise((resolve,reject)=>{
    rl.pause();
    const child=spawn(process.execPath,[cli,...args],{cwd:dir,windowsHide:true,shell:false,
      env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:[secret!==undefined?'pipe':'inherit',capture?'pipe':'inherit',capture?'pipe':'inherit']});
    let output='',errors='';
    if(capture){child.stdout.on('data',d=>{output+=d;if(echo)stdout.write(d);});child.stderr.on('data',d=>{errors+=d;if(echo)process.stderr.write(d);});}
    if(secret!==undefined)child.stdin.end(secret);
    child.on('error',e=>{rl.resume();reject(e);});child.on('close',code=>{
      rl.resume();
      if(code)reject(new Error('Cloudflare command failed: '+args.slice(0,2).join(' ')+' (exit '+code+'). '+(secret!==undefined?'Check the Cloudflare account and permissions.':errors.slice(-800))));
      else resolve(output);
    });
  });
}
function parseOutput(text) {
  const clean=text.replace(/\x1B\[[0-9;]*m/g,'').trim();
  for(let i=0;i<clean.length;i++)if(clean[i]==='['||clean[i]==='{'){
    try{return JSON.parse(clean.slice(i));}catch{}
  }
  throw new Error('Cannot parse Cloudflare response. Run npm run setup again.');
}
async function main() {
  await access(cli);
  console.log('\nإعداد إشعارات CTE — Firebase Spark + Cloudflare Free\nلا يتطلب هذا الإعداد Cloud Functions أو ترقية مدفوعة.\n');
  const config=JSON.parse(await readFile(path.join(dir,'wrangler.json'),'utf8'));
  // Validate the file before provisioning any resources. Its contents never reach stdout.
  let keyPath=await input('اسحب مسار ملف Service Account JSON هنا (من Firebase)، ثم Enter: ');
  keyPath=keyPath.replace(/^["']|["']$/g,'');
  let account;
  try {account=JSON.parse(await readFile(keyPath,'utf8'));}catch{throw new Error('تعذر قراءة ملف JSON. تأكد من المسار.');}
  if(account.type!=='service_account'||account.project_id!==config.vars.PROJECT_ID||!account.private_key||!account.client_email)throw new Error('الملف ليس Service Account صالحًا لمشروع test-mode-c1433.');
  console.log('سيُفتح تسجيل دخول Cloudflare. اختر حسابًا على Workers Free.');
  await wrangler(['login']);
  // List before create makes the command safe to re-run without duplicate databases.
  const listed=parseOutput(await wrangler(['d1','list','--json'],{capture:true}));
  const databases=Array.isArray(listed)?listed:listed.result||[];
  let db=databases.find(d=>d.name==='cte-push-state');
  if(!db){
    console.log('إنشاء قاعدة صغيرة لسجل الإشعارات ومنع التكرار…');
    await wrangler(['d1','create','cte-push-state','--update-config=false']);
    const after=parseOutput(await wrangler(['d1','list','--json'],{capture:true}));
    db=(Array.isArray(after)?after:after.result||[]).find(d=>d.name==='cte-push-state');
  }
  const databaseId=db?.uuid||db?.database_id||db?.id;
  if(!/^[0-9a-f-]{36}$/i.test(databaseId||''))throw new Error('لم يتم العثور على معرّف قاعدة Cloudflare.');
  config.d1_databases[0].database_id=databaseId;
  // Publish with cron paused until the credential is installed.
  config.triggers={crons:[]};
  await writeFile(path.join(dir,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
  await wrangler(['d1','execute','cte-push-state','--remote','--file','schema.sql','--yes']);
  const first=await wrangler(['deploy'],{capture:true,echo:true});
  await wrangler(['secret','put','GOOGLE_SERVICE_ACCOUNT'],{secret:JSON.stringify(account)});
  account=null;
  config.triggers={crons:['* * * * *']};
  await writeFile(path.join(dir,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
  const deployed=await wrangler(['deploy'],{capture:true,echo:true});
  const all=deployed+'\n'+first;
  let backend=all.match(/https:\/\/cte-jeddah-push\.[a-z0-9-]+\.workers\.dev/i)?.[0];
  if(!backend)backend=await input('الصق رابط Worker الظاهر أعلاه (https://...workers.dev): ');
  const endpoint=new URL(backend);
  if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.workers.dev'))throw new Error('رابط Worker غير صالح.');
  endpoint.pathname='/';endpoint.search='';endpoint.hash='';
  const webConfig={appUrl:config.vars.APP_URL,backendUrl:endpoint.origin};
  await writeFile(path.join(dir,'../push-config.js'),'// Public configuration only.\nwindow.CTE_PUSH_CONFIG = '+JSON.stringify(webConfig,null,2)+';\n');
  console.log('\nتم نشر الخدمة وتحديث push-config.js محليًا.\nالخطوة الأخيرة: ارفع محتويات الحزمة (index.html في الجذر) إلى مستودع GitHub Pages. لا ترفع ملف Service Account.\nفحص الخدمة: '+endpoint.origin+'/health\nانتظر حتى تظهر ready: true قبل اختبار الإشعارات. قد يستغرق انتشار الجدولة حتى 15 دقيقة لأول مرة.\n');
}
try{await main();}catch(e){console.error('\nلم يكتمل الإعداد: '+e.message);process.exitCode=1;}finally{rl.close();}
