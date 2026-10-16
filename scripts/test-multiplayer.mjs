import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
const base=process.argv[2]||'http://127.0.0.1:5173';
async function call(body,status=200,origin){const r=await fetch(base+'/api/world',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data={message:raw}}assert.equal(r.status,status,JSON.stringify(data));return data}
const a=await call({action:'create',name:'Test Builder A'});
const b=await call({action:'join',name:'Test Builder B',room:a.room});
const c=await call({action:'create',name:'Isolated Builder'});
const sync=async(p,extra={})=>{await sleep(160);return call({action:'sync',token:p.token,since:0,x:p.x,y:p.y,z:p.z,yaw:0,...extra})};
try{
 const first=await sync(a);assert(first.players.some(p=>p.id===b.id),'Players see one another');assert(!JSON.stringify(first).includes(b.token),'Tokens stay private');
 const edit={x:24,y:8,z:24,type:7};const changed=await sync(a,{edits:[edit]});assert(changed.edits.some(e=>e.x===24&&e.y===8&&e.type===7));
 const second=await sync(b);assert(second.edits.some(e=>e.type===7),'Block change reaches second client');
 assert.equal((await sync(c)).edits.length,0,'Separate rooms are isolated');
 const cursor=second.edits.at(-1).id;assert.equal((await sync(b,{since:cursor})).edits.length,0,'Cursor avoids replay');
 await sync(b,{edits:[{...edit,type:0}]});assert.equal((await sync(a)).edits.at(-1).type,0,'Removal reaches first client');
 await call({action:'sync'},401);await call({action:'join',name:'Missing',room:'000000000000'},404);
 await sleep(160);await call({action:'sync',token:a.token,x:a.x,y:a.y,z:a.z,yaw:0,edits:[{x:1,y:0,z:1,type:0}]},400);
 await call({action:'create',name:'Cross origin'},403,'https://unrelated.example');
 await call({action:'leave',token:b.token});const rejoined=await call({action:'join',room:a.room,name:'Returning Builder'});
 const persisted=await sync(rejoined);assert.equal(persisted.edits.at(-1).type,0,'World survives leaving and rejoining');
 await call({action:'leave',token:rejoined.token});
 console.log('PASS: presence, shared placement/removal, room isolation, incremental sync, token privacy, invalid edits, missing rooms, origin checks, saved world rejoin.');
}finally{for(const p of [a,b,c])await call({action:'leave',token:p.token},p===b?401:200).catch(()=>{})}
