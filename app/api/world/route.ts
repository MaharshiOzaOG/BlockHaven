import { env } from 'cloudflare:workers';
import { height, SIZE } from '../../world';
export const dynamic = 'force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request) {
  try {
    const origin=req.headers.get('origin');
    if(origin && origin!==new URL(req.url).origin) return json({error:'Please use the game’s own page.'},403);
    const raw=await req.text();
    if(raw.length>12000) return json({error:'Request too large.'},413);
    let b; try {b=JSON.parse(raw)} catch {return json({error:'Invalid request.'},400)}
    if(!b || typeof b!=='object') return json({error:'Invalid request.'},400);
    const db=env.DB!;
    const now=Date.now();
    if(b.action==='create' || b.action==='join') {
      const name=typeof b.name==='string'?b.name.trim().slice(0,20):'';
      if(!name) return json({error:'Choose a player name.'},400);
      let room=String(b.room||'').toUpperCase();
      if(b.action==='create') {
        room=crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
        await db.prepare('INSERT INTO rooms(code,created) VALUES (?,?)').bind(room,now).run();
      } else {
        if(!/^[A-F0-9]{12}$/.test(room)) return json({error:'Enter a 12-character room code.'},400);
        if(!await db.prepare('SELECT code FROM rooms WHERE code=?').bind(room).first()) return json({error:'That room does not exist. Check the code or create a world.'},404);
      }
      const count=await db.prepare('SELECT COUNT(*) AS n FROM players WHERE room=? AND seen>?').bind(room,now-15000).first<{n:number}>();
      if((count?.n||0)>=8) return json({error:'This room has eight players. Try again when a space opens.'},409);
      const token=crypto.randomUUID(),id=crypto.randomUUID();
      const x=23.5,z=23.5,y=height(23,23)+1.01;
      await db.prepare('INSERT INTO players(token,id,room,name,x,y,z,yaw,seen) VALUES (?,?,?,?,?,?,?,?,?)').bind(token,id,room,name,x,y,z,0,now).run();
      return json({token,id,room,x,y,z});
    }
    if(typeof b.token!=='string') return json({error:'Join a world first.'},401);
    const player=await db.prepare('SELECT * FROM players WHERE token=?').bind(b.token).first<{room:string;id:string;seen:number}>();
    if(!player) return json({error:'Session ended. Please rejoin.'},401);
    if(b.action==='leave') {
      await db.prepare('DELETE FROM players WHERE token=?').bind(b.token).run(); return json({ok:true});
    }
    if(b.action!=='sync') return json({error:'Unknown action.'},400);
    if(now-player.seen<100) return json({error:'Please slow down.'},429);
    const {x,y,z,yaw}=b;
    if(![x,y,z,yaw].every(v=>typeof v==='number' && Number.isFinite(v)) || x<0 || z<0 || x>SIZE || z>SIZE || y<0 || y>40 || Math.abs(yaw)>10000)
      return json({error:'Invalid player position.'},400);
    const changes=Array.isArray(b.edits)?b.edits:[];
    if(changes.length>12) return json({error:'Too many block changes.'},400);
    for(const e of changes) {
      if(!e || ![e.x,e.y,e.z,e.type].every(Number.isInteger) || e.x<0 || e.x>=SIZE || e.z<0 || e.z>=SIZE || e.y<1 || e.y>27 || e.type<0 || e.type>8 || Math.hypot(e.x+.5-x,e.y+.5-(y+1.6),e.z+.5-z)>9)
        return json({error:'That block is outside building reach.'},400);
    }
    await db.batch([
      db.prepare('UPDATE players SET x=?,y=?,z=?,yaw=?,seen=? WHERE token=?').bind(x,y,z,yaw,now,b.token),
      ...changes.map((e:{x:number;y:number;z:number;type:number})=>db.prepare('INSERT INTO edits(room,x,y,z,type) VALUES (?,?,?,?,?)').bind(player.room,e.x,e.y,e.z,e.type)),
    ]);
    const since=Number.isSafeInteger(b.since)&&b.since>=0?b.since:0;
    const result=await db.prepare('SELECT id,x,y,z,type FROM edits WHERE room=? AND id>? ORDER BY id LIMIT 2000').bind(player.room,since).all();
    const peers=await db.prepare('SELECT id,name,x,y,z,yaw FROM players WHERE room=? AND seen>? AND id<>? ORDER BY seen DESC LIMIT 8').bind(player.room,now-15000,player.id).all();
    return json({edits:result.results,players:peers.results,more:result.results.length===2000});
  } catch(e) {console.error('World request failed',e); return json({error:'The world server could not respond. Please retry.'},503)}
}
