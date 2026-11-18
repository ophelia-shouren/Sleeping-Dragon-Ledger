const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{webcrypto}=require('crypto');
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(fs.readdirSync(require('path').join(__dirname,'../migrations')).filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync(require('path').join(__dirname,'../migrations',n),'utf8')).join('\n'));
function stmt(sql,args=[]){return {sql,args,bind(...a){return stmt(sql,a)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}}}
const DB={prepare:sql=>stmt(sql),async batch(rows){sqlite.exec('BEGIN');try{const out=[];for(const r of rows)out.push(await r.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const context={crypto:webcrypto,TextEncoder,TextDecoder,Request,Response,URL,Headers,AbortSignal,Uint8Array,ArrayBuffer,btoa,atob,console,Date,Intl,setTimeout,clearTimeout,fetch:()=>{throw Error('No upstream calls in account tests')}};vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../worker.js'),'utf8').replace('export default {','globalThis.worker = {'),context);
const env={DB,CHAT_KEY_ENCRYPTION:'c'.repeat(64)},tasks={waitUntil(){}};
async function call(token,path,data){const req=new Request('https://example.workers.dev/ledger-api/'+path,{method:data?'POST':'GET',headers:{origin:'https://ophelia-shouren.github.io',Authorization:'Bearer '+token,'CF-Connecting-IP':'192.0.2.1',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const r=await context.worker.fetch(req,env,tasks);return {status:r.status,data:await r.json()};}
const seed='a'.repeat(64),other='b'.repeat(64),fresh='d'.repeat(64),password='correct horse 123',profile={name:'原用户',gender:'女',personality:'独立在线性格',description:'独立设定',avatar:'data:image/png;base64,YQ==',frame:{src:'https://example.com/frame.png',scale:1.2,x:3,y:4,ring:true}};
(async()=>{
 const uid=await context.ledgerIdentity(new Request('https://e.test',{headers:{authorization:'Bearer '+seed}}));
 sqlite.prepare('INSERT INTO profiles VALUES (?,?)').run(uid,'旧昵称');sqlite.prepare('INSERT INTO rooms VALUES (?,?,?,?,?)').run('existing-group','原群聊','group',uid,'old-invite');sqlite.prepare('INSERT INTO members VALUES (?,?)').run('existing-group',uid);sqlite.prepare('INSERT INTO messages (room,sender,body) VALUES (?,?,?)').run('existing-group',uid,'老聊天记录');
 await context.ensureAccountSchema(DB);sqlite.prepare('INSERT INTO ledger_user_codes VALUES (?,?)').run(uid,'ML-OLD1-OLD2-OLD3');
 assert.equal((await call(seed,'rooms')).status,401);assert.equal((await call(seed,'auth/status')).data.migration,true);
 let r=await call(seed,'auth/register',{username:'OldUser1',password,confirmPassword:'wrong',profile});assert.equal(r.status,400);
 r=await call(seed,'auth/register',{username:'OldUser1',password,confirmPassword:password,profile});assert.equal(r.status,200);assert(!JSON.stringify(r.data).includes('ML-'));
 assert.equal(sqlite.prepare('SELECT code FROM ledger_user_codes WHERE uid=?').get(uid).code,'ML-OLD1-OLD2-OLD3');assert.equal((await call(seed,'auth/status')).data.authenticated,false);
 r=await call(other,'auth/register',{username:'olduser1',password,confirmPassword:password,profile});assert.equal(r.status,409);
 r=await call(seed,'auth/register',{username:'Another1',password,confirmPassword:password,profile});assert.equal(r.status,409);
 assert.equal((await call(other,'auth/login',{username:'olduser1',password:'wrong pwd'})).status,401);
 r=await call(other,'auth/login',{username:'olduser1',password});assert.equal(r.status,200);const session=r.data.token;assert.notEqual(session,seed);
 assert.equal((await call(session,'me')).data.me.id,uid);assert.equal((await call(session,'rooms')).data[0].id,'existing-group');assert.equal((await call(session,'messages?room=existing-group')).data[0].body,'老聊天记录');
 assert.equal((await call(session,'online-profile')).data.profile.gender,'女');
 await call(session,'profile',{name:'外部修改',persona:'外部新设定',avatar:''});assert.equal((await call(session,'online-profile')).data.profile.name,'原用户');
 const updated={...profile,name:'在线新名字',personality:'在线修改'};assert.equal((await call(session,'online-profile',updated)).status,200);assert.match(sqlite.prepare('SELECT persona FROM ledger_people WHERE uid=?').get(uid).persona,/在线修改/);
 assert.equal(sqlite.prepare('SELECT name FROM profiles WHERE id=?').get(uid).name,'在线新名字');
 r=await call(fresh,'auth/register',{username:'NewUser2',password,confirmPassword:password,profile});assert.equal(r.status,200);const newuid=await context.ledgerIdentity(new Request('https://e.test',{headers:{authorization:'Bearer '+fresh}}));assert.notEqual(newuid,uid);assert(sqlite.prepare('SELECT code FROM ledger_user_codes WHERE uid=?').get(newuid));assert.equal((await call(fresh,'rooms')).status,401);
 assert.equal((await call(fresh,'auth/register',{username:'不能中文',password,confirmPassword:password,profile})).status,400);
 const account=sqlite.prepare('SELECT * FROM ledger_accounts WHERE uid=?').get(uid);assert.notEqual(account.password_hash,password);assert(!sqlite.prepare('SELECT * FROM ledger_sessions WHERE token_hash=?').get(session));
 const savedPreset=await call(session,'online-profile-presets',{action:'save',name:'校园',profile});assert.equal(savedPreset.status,200);const presetId=savedPreset.data.id;
 assert.equal((await call(session,'online-profile-presets')).data.presets[0].name,'校园');
 assert.equal((await call(session,'online-profile')).data.profile.name,'在线新名字');
 assert.equal((await call(session,'online-profile-presets',{action:'apply',id:presetId})).data.profile.name,'原用户');
 assert.equal((await call(session,'online-profile')).data.profile.frame.src,profile.frame.src);
 const newLogin=await call(fresh,'auth/login',{username:'NewUser2',password});assert.equal((await call(newLogin.data.token,'online-profile-presets',{action:'apply',id:presetId})).status,404);
 assert.equal((await call(session,'rooms')).data[0].id,'existing-group');
 await call(session,'online-profile-presets',{action:'delete',id:presetId});assert.equal((await call(session,'online-profile-presets')).data.presets.length,0);
 await call(session,'auth/logout',{});assert.equal((await call(session,'rooms')).status,401);
 console.log('PASS: legacy migration preserves UID/code/groups/messages; new account one-to-one identity; duplicate/case/mismatch rejection; cross-browser login; independent persona/avatar/frame; protected endpoints; hashed passwords/sessions; logout');
})().catch(e=>{console.error(e);process.exitCode=1});
