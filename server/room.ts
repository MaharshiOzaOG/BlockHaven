import { DurableObject } from 'cloudflare:workers';
import { BLOCKS, CROP_MS, MAX_PLAYERS, MAX_Y, RECIPES, SIZE, SLOTS, SPAWN, WORLD_VERSION, blockItem, collides, direction, generateWorld, hash, key, miningMs, raycast, sanctuary } from '../app/world';
import type { Crop, Edit, Equipment, Meteor, Pose, Vec } from '../app/world';
import type { ClientMessage, Command, Peer, RoomInfo, Self, ServerMessage } from '../app/protocol';

type Player = Self & {
  token: string; seen: number; moved: number; attacked: number; ate: number; used: number;
  block: number; fallTop: number; rescued: number;
};
type Mining = { target: Vec; type: number; start: number; end: number; item: Equipment };
type Saved = { version: number; room: RoomInfo; players: Player[]; crops: Crop[]; meteors: Meteor[] };
type Client = { ws: WebSocket; id?: string; last: number; count: number; window: number };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const finitePose = (p: Pose) => p && [p.x,p.y,p.z,p.yaw,p.pitch].every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(p.yaw) <= Math.PI + .1 && Math.abs(p.pitch) <= 1.55;
const eye = (p: Vec) => ({ x: p.x, y: p.y + 1.6, z: p.z });
const same = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y && a.z === b.z;
const peer = (p: Player): Peer => ({ id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,item:p.item,protectedUntil:p.protectedUntil });
const self = (p: Player): Self => ({ ...peer(p),inventory:p.inventory,pickTier:p.pickTier,tools:p.tools,deadAt:p.deadAt,cause:p.cause,seq:p.seq });

/** One single writer per room. Clients submit intentions, never damage or inventory. */
export class GameRoom extends DurableObject<Cloudflare.Env> {
  private world = generateWorld();
  private edits = new Map<string, Edit>();
  private players = new Map<string, Player>();
  private crops = new Map<string, Crop>();
  private meteors: Meteor[] = [];
  private mining = new Map<string, Mining>();
  private clients = new Set<Client>();
  private room: RoomInfo = { host:'',danger:false,pvp:false,nextMeteor:0 };
  private initialized = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastSave = 0;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS blocks (key TEXT PRIMARY KEY, x INTEGER, y INTEGER, z INTEGER, type INTEGER)');
    const row = [...ctx.storage.sql.exec<{value:string}>('SELECT value FROM state WHERE id=1')][0];
    if (row) {
      const s: Saved = JSON.parse(row.value);
      if (s.version !== WORLD_VERSION) throw new Error('Unsupported saved world version. Export before upgrading.');
      this.initialized = true; this.room = s.room; this.meteors = s.meteors;
      for (const p of s.players) this.players.set(p.id, p);
      for (const c of s.crops) this.crops.set(key(c.x,c.y,c.z),c);
      for (const e of ctx.storage.sql.exec<Edit & Record<string, SqlStorageValue>>('SELECT x,y,z,type FROM blocks')) {
        this.edits.set(key(e.x,e.y,e.z),e);
        if(e.type) this.world.set(key(e.x,e.y,e.z),e.type); else this.world.delete(key(e.x,e.y,e.z));
      }
    }
  }
  private save() {
    const state: Saved = { version:WORLD_VERSION,room:this.room,players:[...this.players.values()],crops:[...this.crops.values()],meteors:this.meteors };
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO state(id,value) VALUES(1,?)', JSON.stringify(state));
    this.lastSave = Date.now();
  }
  private send(c: Client, data: ServerMessage) {
    try { c.ws.send(JSON.stringify(data)); } catch { this.disconnect(c); }
  }
  private broadcast(data: ServerMessage) { for (const c of this.clients) if(c.id) this.send(c,data); }
  private tell(id: string, data: ServerMessage) { for(const c of this.clients) if(c.id===id) this.send(c,data); }
  private notice(p: Player, text: string) { this.tell(p.id,{kind:'notice',text}); }
  private stopMining(id: string) {
    if(this.mining.delete(id)) this.tell(id,{kind:'miningStopped'});
  }
  private active(id: string) { return [...this.clients].some(c=>c.id===id); }
  private disconnect(c: Client) {
    if(!this.clients.delete(c)) return;
    if(c.id) { this.stopMining(c.id); const p=this.players.get(c.id); if(p) p.seen=Date.now(); }
    if(!this.clients.size && this.timer) {
      clearInterval(this.timer); this.timer=undefined;
      // Empty rooms have no attacks or pending meteor damage on next arrival.
      this.meteors=[]; this.room.nextMeteor=0;
    }
    this.save();
  }
  private welcome(c: Client, p: Player) {
    this.send(c,{kind:'welcome',version:WORLD_VERSION,self:self(p),edits:[...this.edits.values()],crops:[...this.crops.values()],meteors:this.meteors,room:this.room,now:Date.now()});
  }
  async fetch(req: Request) {
    if(req.headers.get('Upgrade')?.toLowerCase()==='websocket') {
      if(!this.initialized) return response({error:'World not found. Create a new survival world.'},404);
      if(this.clients.size>=MAX_PLAYERS+4) return response({error:'Room is busy.'},429);
      if(!this.clients.size){this.meteors=[];this.room.nextMeteor=0;}
      const pair=new WebSocketPair(), client=pair[0], server=pair[1];
      server.accept();
      const c: Client={ws:server,last:Date.now(),count:0,window:Date.now()};
      this.clients.add(c);
      server.addEventListener('message',e=>this.message(c,e.data));
      server.addEventListener('close',()=>this.disconnect(c));
      server.addEventListener('error',()=>this.disconnect(c));
      if(!this.timer) this.timer=setInterval(()=>this.tick(),100);
      return new Response(null,{status:101,webSocket:client});
    }
    if(req.method!=='POST') return response({error:'Use POST.'},405);
    let b: {action?:string;name?:string;token?:string;room?:string};
    try { b=await req.json(); } catch { return response({error:'Invalid request.'},400); }
    if(!b || !['create','join'].includes(b.action||'')) return response({error:'Unknown action.'},400);
    if(!this.initialized && b.action!=='create') return response({error:'No survival world with this code. Older creative worlds stay on the original server.'},404);
    if(this.initialized && b.action==='create') return response({error:'World already exists.'},409);
    const name=typeof b.name==='string'?b.name.trim().replace(/[\x00-\x1f]/g,'').slice(0,20):'';
    if(!name) return response({error:'Choose a name.'},400);
    const now=Date.now();
    const existing=typeof b.token==='string'?[...this.players.values()].find(p=>p.token===b.token):undefined;
    const occupied=[...this.players.values()].filter(p=>this.active(p.id)||now-p.seen<15000);
    if(!existing && occupied.length>=MAX_PLAYERS) return response({error:'This room is full (8 friends).'},409);
    if(existing) {
      if(!this.active(existing.id) && occupied.filter(p=>p.id!==existing.id).length>=MAX_PLAYERS) return response({error:'This room is full.'},409);
      existing.name=name; existing.seen=now; this.save();
      return response({room:b.room,id:existing.id,token:existing.token});
    }
    // Keep at most 64 saved identities per room; only evict long-disconnected guests.
    if(this.players.size>=64) {
      const old=[...this.players.values()].filter(p=>!this.active(p.id)&&now-p.seen>86400000&&p.id!==this.room.host).sort((a,b)=>a.seen-b.seen)[0];
      if(!old) return response({error:'Saved player limit reached. Rejoin using the original browser or create another room.'},409);
      this.players.delete(old.id);
    }
    const p: Player={...SPAWN,id:crypto.randomUUID(),token:crypto.randomUUID(),name,yaw:0,pitch:0,hp:100,inventory:{fruit:3,seed:4},pickTier:0,tools:[],deadAt:0,cause:'',seq:0,item:'hand',protectedUntil:now+5000,seen:now,moved:now,attacked:0,ate:0,used:0,block:2,fallTop:SPAWN.y,rescued:0};
    this.players.set(p.id,p);
    if(!this.initialized){this.initialized=true;this.room.host=p.id;}
    this.save(); return response({room:b.room,id:p.id,token:p.token});
  }
  private message(c: Client, raw: string | ArrayBuffer) {
    const now=Date.now();
    if(typeof raw!=='string'||raw.length>2048){c.ws.close(1009,'Message too large');this.disconnect(c);return;}
    if(now-c.window>=1000){c.window=now;c.count=0;}
    if(++c.count>40){c.ws.close(1008,'Too many messages');this.disconnect(c);return;}
    let b: ClientMessage;
    try { b=JSON.parse(raw); } catch { return; }
    if(!b||typeof b!=='object') return;
    c.last=now;
    if(b.kind==='auth' && !c.id) {
      const p=[...this.players.values()].find(p=>p.token===b.token);
      if(!p){c.ws.close(1008,'Rejoin the world');this.disconnect(c);return;}
      if([...this.clients].filter(v=>v.id&&v.id!==p.id).length>=MAX_PLAYERS){c.ws.close(1008,'Room full');this.disconnect(c);return;}
      for(const old of this.clients) if(old!==c&&old.id===p.id){old.ws.close(4001,'Opened in another tab');this.disconnect(old);}
      c.id=p.id; p.moved=now; p.seen=now;
      if(collides(this.world,p)) Object.assign(p,SPAWN);
      this.welcome(c,p);
      return;
    }
    if(!c.id) return;
    const p=this.players.get(c.id)!;
    p.seen=now;
    if(b.kind==='ping'){if(Number.isFinite(b.at))this.send(c,{kind:'pong',at:b.at,now});return;}
    if(b.kind!=='command'||!Number.isSafeInteger(b.seq)||b.seq<=p.seq||!b.command||typeof b.command.action!=='string') return;
    p.seq=b.seq;
    // Every command is processed synchronously, without await: no interleaved damage/crafting.
    try { this.command(p,b.command,now); }
    catch { this.notice(p,'That action could not be completed.'); }
    if(b.command.action!=='move'&&b.command.action!=='cancelMine') this.save();
  }
  private command(p: Player, b: Command, now: number) {
    if(b.action==='respawn') {
      if(p.hp>0||now-p.deadAt<3000)return;
      Object.assign(p,SPAWN,{hp:100,deadAt:0,cause:'',protectedUntil:now+5000,fallTop:SPAWN.y,moved:now});
      this.tell(p.id,{kind:'teleport',pose:p}); return;
    }
    if(b.action==='claimHost') {
      const host=this.players.get(this.room.host);
      if(this.active(this.room.host)||(host&&now-host.seen<60000)){this.notice(p,'Host must be offline for one minute.');return;}
      this.room.host=p.id; this.notice(p,'You are now the host.');return;
    }
    if(b.action==='settings') {
      if(p.id!==this.room.host||typeof b.danger!=='boolean'||typeof b.pvp!=='boolean')return;
      if(b.danger!==this.room.danger){this.room.nextMeteor=b.danger?now+10000:0;this.meteors=[];this.broadcast({kind:'meteors',meteors:[],now});}
      this.room.danger=b.danger;this.room.pvp=b.pvp;
      this.broadcast({kind:'notice',text:'Host changed the rules: meteors '+(b.danger?'on':'off')+', PvP '+(b.pvp?'on':'off')+'.'});return;
    }
    if(b.action==='cancelMine'){this.stopMining(p.id);return;}
    if(p.hp<=0)return;
    if(b.action==='move'){this.move(p,b.pose,now);return;}
    if(b.action==='equip') {
      if(!SLOTS.some(s=>s.item===b.item)||!Number.isInteger(b.block)||b.block<1||b.block>BLOCKS.length)return;
      p.item=b.item;p.block=b.block;this.stopMining(p.id);return;
    }
    if(b.action==='rescue') {
      if(now-p.rescued<60000){this.notice(p,'Return to camp has a 60-second cooldown.');return;}
      p.rescued=now;this.stopMining(p.id);Object.assign(p,SPAWN,{fallTop:SPAWN.y,moved:now});
      this.tell(p.id,{kind:'teleport',pose:p});return;
    }
    if(b.action==='craft') {
      const r=RECIPES.find(r=>r.id===b.recipe);if(!r)return;
      if((r.tier&&p.pickTier>=r.tier)||(r.tool&&p.tools.includes(r.tool))){this.notice(p,'You already have this tool.');return;}
      if((r.requires||0)>p.pickTier){this.notice(p,'Craft the previous pickaxe first.');return;}
      if(Object.entries(r.cost).some(([k,v])=>(p.inventory[k]||0)<v)){this.notice(p,'Gather the listed materials first.');return;}
      for(const [k,v] of Object.entries(r.cost))p.inventory[k]-=v;
      for(const [k,v] of Object.entries(r.gives||{}))this.give(p,k,v);
      if(r.tier)p.pickTier=r.tier;if(r.tool)p.tools.push(r.tool);
      this.stopMining(p.id);this.notice(p,'Crafted '+r.name+'.');return;
    }
    if(b.action==='attack'){this.attack(p,now);return;}
    if(b.action==='mine') {
      if(!b.target||![b.target.x,b.target.y,b.target.z].every(Number.isInteger))return;
      const hit=this.aim(p);
      if(!hit||!same(hit,b.target)||!this.editable(hit)){this.notice(p,'Out of reach, bedrock, or protected camp.');return;}
      if(!['hand','pick','axe'].includes(p.item)){this.notice(p,'Use hands, a pickaxe, or an axe to mine.');return;}
      if(p.item==='axe'&&!p.tools.includes('axe')){this.notice(p,'Craft an axe first.');return;}
      const duration=miningMs(hit.type,p.item,p.pickTier);
      if(!Number.isFinite(duration)){this.notice(p,'This material needs a better pickaxe.');return;}
      const m=this.mining.get(p.id);
      if(m&&same(m.target,hit))return;
      this.mining.set(p.id,{target:{x:hit.x,y:hit.y,z:hit.z},type:hit.type,start:now,end:now+duration,item:p.item});
      this.tell(p.id,{kind:'mining',target:hit,start:now,end:now+duration});return;
    }
    if(b.action==='use') {
      if(now-p.used<250)return;p.used=now;this.stopMining(p.id);
      if(p.item==='fruit') {
        if(now-p.ate<2000){this.notice(p,'Wait two seconds between bites.');return;}
        if(p.hp>=100){this.notice(p,'Health is already full.');return;}
        if(!(p.inventory.fruit>0)){this.notice(p,'Find fruit in leaves or harvest crops.');return;}
        p.inventory.fruit--;p.hp=Math.min(100,p.hp+25);p.ate=now;return;
      }
      const hit=this.aim(p);if(!hit)return;
      const k=key(hit.x,hit.y,hit.z), crop=this.crops.get(k);
      if(crop) {
        if(now-crop.planted<CROP_MS){this.notice(p,'Crop is still growing.');return;}
        this.crops.delete(k);this.give(p,'fruit',2);this.give(p,'seed',2);this.publishCrops();return;
      }
      if(!this.editable(hit)){this.notice(p,'The camp is protected.');return;}
      if(p.item==='hoe') {
        if(!p.tools.includes('hoe')){this.notice(p,'Craft a hoe first.');return;}
        if(![1,2].includes(hit.type)||hit.ny!==1||this.world.has(key(hit.x,hit.y+1,hit.z))){this.notice(p,'Till the exposed top of grass or earth.');return;}
        this.change([{x:hit.x,y:hit.y,z:hit.z,type:13}]);return;
      }
      if(p.item==='seed') {
        if(hit.type!==13||hit.ny!==1){this.notice(p,'Use a hoe on soil before planting.');return;}
        if(!(p.inventory.seed>0)){this.notice(p,'No seeds. Craft seeds from fruit.');return;}
        if(this.crops.size>=128){this.notice(p,'This small world supports 128 crops.');return;}
        // Crops require an open column; no per-frame growth simulation is needed.
        for(let y=hit.y+1;y<=MAX_Y;y++)if(this.world.has(key(hit.x,y,hit.z))){this.notice(p,'Crops need open sky.');return;}
        p.inventory.seed--;this.crops.set(k,{x:hit.x,y:hit.y,z:hit.z,planted:now});this.publishCrops();return;
      }
      if(p.item==='block') {
        const e={x:hit.x+hit.nx,y:hit.y+hit.ny,z:hit.z+hit.nz,type:p.block};
        if(!this.editable(e)||this.world.has(key(e.x,e.y,e.z)))return;
        if([...this.crops.values()].some(c=>c.x===e.x&&c.z===e.z&&e.y>c.y)){this.notice(p,'Keep planted crops open to the sky.');return;}
        if([...this.players.values()].some(q=>this.active(q.id)&&q.hp>0&&e.x+1>q.x-.3&&e.x<q.x+.3&&e.y+1>q.y&&e.y<q.y+1.7&&e.z+1>q.z-.3&&e.z<q.z+.3)){this.notice(p,'A player is standing there.');return;}
        if(!(p.inventory[blockItem(e.type)]>0)){this.notice(p,'Mine or craft this block first.');return;}
        p.inventory[blockItem(e.type)]--;this.change([e]);
      }
    }
  }
  private give(p: Player,id: string,n: number){p.inventory[id]=Math.min(999,(p.inventory[id]||0)+n);}
  private aim(p: Player){return raycast(this.world,eye(p),direction(p),6);}
  private editable(p: Vec){return p.x>=0&&p.x<SIZE&&p.z>=0&&p.z<SIZE&&p.y>=1&&p.y<=MAX_Y&&!sanctuary(p.x+.5,p.z+.5);}
  private publishCrops(){this.broadcast({kind:'crops',crops:[...this.crops.values()]});}
  private change(edits: Edit[]) {
    let cropChanged=false;
    this.ctx.storage.transactionSync(()=>{
      for(const e of edits) {
        const k=key(e.x,e.y,e.z);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO blocks(key,x,y,z,type) VALUES(?,?,?,?,?)',k,e.x,e.y,e.z,e.type);
        this.edits.set(k,e);if(e.type)this.world.set(k,e.type);else this.world.delete(k);
        if(e.type!==13&&this.crops.delete(k))cropChanged=true;
      }
    });
    this.broadcast({kind:'edits',edits});if(cropChanged)this.publishCrops();
  }
  private move(p: Player,v: Pose,now: number) {
    if(!finitePose(v))return;
    const dt=Math.min(.6,Math.max(.03,(now-p.moved)/1000));
    const distance=Math.hypot(v.x-p.x,v.z-p.z),dy=v.y-p.y;
    let valid=distance<=8.5*dt+.18&&dy<=9*dt+.18&&dy>=-35*dt-.3&&!collides(this.world,v);
    // Sweep through the path so low message rates cannot tunnel through a wall.
    if(valid) {
      const steps=Math.ceil(Math.max(distance,Math.abs(dy))/.18);
      for(let i=1;i<steps;i++) {
        const t=i/steps;
        if(collides(this.world,{x:p.x+(v.x-p.x)*t,y:p.y+dy*t,z:p.z+(v.z-p.z)*t})){valid=false;break;}
      }
    }
    p.moved=now;
    p.yaw=v.yaw;p.pitch=v.pitch;
    if(!valid){this.tell(p.id,{kind:'teleport',pose:p});return;}
    Object.assign(p,v);
    p.fallTop=Math.max(p.fallTop,p.y);
    if(collides(this.world,{...p,y:p.y-.12})) {
      const fall=p.fallTop-p.y;if(fall>4.5)this.damage(p,Math.floor((fall-4)*7),'a fall',now);
      p.fallTop=p.y;
    }
  }
  private damage(p: Player,amount: number,cause: string,now: number) {
    if(p.hp<=0||p.protectedUntil>now||sanctuary(p.x,p.z))return;
    p.hp=Math.max(0,p.hp-amount);
    if(p.hp===0){p.deadAt=now;p.cause=cause;this.stopMining(p.id);}
  }
  private attack(p: Player,now: number) {
    if(!['sword','gun'].includes(p.item))return;
    if(!p.tools.includes(p.item)){this.notice(p,'Craft this weapon first.');return;}
    const gun=p.item==='gun';
    if(now-p.attacked<(gun?400:650))return;
    if(!this.room.pvp){this.notice(p,'PvP is off. The host can enable it in the menu.');return;}
    if(sanctuary(p.x,p.z)||p.protectedUntil>now){this.notice(p,'Leave the camp and spawn protection before fighting.');return;}
    if(gun&&!(p.inventory.ammo>0)){this.notice(p,'Craft more ammunition.');return;}
    p.attacked=now;if(gun)p.inventory.ammo--;
    const origin=eye(p),d=direction(p),range=gun?30:3;
    const wall=raycast(this.world,origin,d,range);let nearest=wall?.distance??range,hit:Player|undefined;
    // Ray vs player AABB, limited by the first solid voxel. No hits through terrain.
    for(const q of this.players.values()) {
      if(q.id===p.id||q.hp<=0||!this.active(q.id))continue;
      let near=0,far=range;
      for(const axis of ['x','y','z'] as const) {
        const lo=q[axis]-(axis==='y'?0:.32),hi=q[axis]+(axis==='y'?1.75:.32);
        if(Math.abs(d[axis])<1e-8){if(origin[axis]<lo||origin[axis]>hi){far=-1;break;}continue;}
        const a=(lo-origin[axis])/d[axis],b=(hi-origin[axis])/d[axis];
        near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
      }
      if(far>=near&&near<nearest){nearest=near;hit=q;}
    }
    if(hit)this.damage(hit,gun?18:25,p.name+(gun?'’s blaster':'’s sword'),now);
    this.broadcast({kind:'effect',effect:gun?'shot':'swing',id:p.id,from:origin,to:{x:origin.x+d.x*nearest,y:origin.y+d.y*nearest,z:origin.z+d.z*nearest}});
  }
  private tick() {
    const now=Date.now();
    for(const c of this.clients) if(now-c.last>(c.id?15000:5000)){c.ws.close(1000,'Connection timed out');this.disconnect(c);}
    const active=[...this.players.values()].filter(p=>this.active(p.id));
    let changed=false;
    for(const [id,m] of this.mining) {
      const p=this.players.get(id)!;const hit=this.aim(p);
      if(!this.active(id)||p.hp<=0||!hit||!same(hit,m.target)||hit.type!==m.type||p.item!==m.item){this.stopMining(id);continue;}
      if(now>=m.end) {
        this.change([{...m.target,type:0}]);this.give(p,blockItem(m.type===13?2:m.type),1);
        if(m.type===5){if(hash(m.target.x,m.target.y,m.target.z)<.35)this.give(p,'fruit',1);if(hash(m.target.z,m.target.y+7,m.target.x)<.2)this.give(p,'seed',1);}
        this.stopMining(id);changed=true;
      }
    }
    if(this.room.danger&&active.some(p=>p.hp>0)) {
      if(!this.room.nextMeteor)this.room.nextMeteor=now+10000;
      if(now>=this.room.nextMeteor) {
        const targets=active.filter(p=>p.hp>0&&!sanctuary(p.x,p.z));
        if(targets.length) {
          const p=targets[Math.floor(Math.random()*targets.length)];
          const x=Math.max(2,Math.min(SIZE-3,p.x+(Math.random()-.5)*12));
          const z=Math.max(2,Math.min(SIZE-3,p.z+(Math.random()-.5)*12));
          if(!sanctuary(x,z)) {
            let y=0;for(let h=MAX_Y;h>=0;h--)if(this.world.has(key(Math.floor(x),h,Math.floor(z)))){y=h+1;break;}
            this.meteors.push({id:crypto.randomUUID(),x,y,z,start:now,impact:now+4000,radius:4});
            this.broadcast({kind:'meteors',meteors:this.meteors,now});
          }
        }
        this.room.nextMeteor=now+10000+Math.floor(Math.random()*5000);changed=true;
      }
    }
    for(const m of this.meteors.filter(m=>now>=m.impact)) {
      for(const p of active) {
        const dist=Math.hypot(p.x-m.x,p.y+.85-m.y,p.z-m.z);
        // Terrain shields players; impact never edits terrain, keeping event cost bounded.
        if(dist<m.radius) {
          const start={x:m.x,y:m.y+.1,z:m.z},end={x:p.x,y:p.y+.85,z:p.z};
          const length=Math.hypot(end.x-start.x,end.y-start.y,end.z-start.z);
          const dir={x:(end.x-start.x)/(length||1),y:(end.y-start.y)/(length||1),z:(end.z-start.z)/(length||1)};
          if(!raycast(this.world,start,dir,Math.max(0,length-.3)))this.damage(p,Math.ceil(45*(1-dist/m.radius)),'a meteor',now);
        }
      }
      this.broadcast({kind:'effect',effect:'impact',id:m.id,from:m,to:m});changed=true;
    }
    if(this.meteors.some(m=>now>=m.impact)){this.meteors=this.meteors.filter(m=>now<m.impact);this.broadcast({kind:'meteors',meteors:this.meteors,now});}
    if(changed||now-this.lastSave>5000)this.save();
    const peers=active.map(peer);
    for(const c of this.clients) if(c.id) {
      const p=this.players.get(c.id)!;
      this.send(c,{kind:'state',self:self(p),players:peers.filter(q=>q.id!==p.id),room:this.room,now});
    }
  }
}
