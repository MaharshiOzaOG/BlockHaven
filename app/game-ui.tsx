'use client';
import { useEffect, useRef, useState } from 'react';
import { BLOCKS, MAX_PLAYERS, PICK_NAMES, RECIPES, SIZE, SLOTS, SPAWN, blockItem, itemName, sanctuary } from './world';
import type { Meteor } from './world';
import type { createGame, Stats } from './engine';
import type { Command, Peer, RoomInfo, Self, Session } from './protocol';
import { connectRoom } from './connection';

export default function Home(){
  const host=useRef<HTMLDivElement>(null),game=useRef<ReturnType<typeof createGame>|null>(null),connection=useRef<ReturnType<typeof connectRoom>|null>(null);
  const selfRef=useRef<Self|null>(null),lastUi=useRef(0),lastHp=useRef(100);
  const [ready,setReady]=useState(false),[session,setSession]=useState<Session|null>(null),[name,setName]=useState(''),[code,setCode]=useState(''),[mode,setMode]=useState<'create'|'join'>('create');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false),[dragMode,setDragMode]=useState(false),[loaded,setLoaded]=useState(false),[online,setOnline]=useState(false),[status,setStatus]=useState('Connecting…');
  const [selected,setSelected]=useState(0),[block,setBlock]=useState(2),[players,setPlayers]=useState<Peer[]>([]),[me,setMe]=useState<Self|null>(null),[room,setRoom]=useState<RoomInfo|null>(null);
  const [panel,setPanel]=useState<'menu'|'bag'>('menu'),[copied,setCopied]=useState(false),[notice,setNotice]=useState(''),[meteors,setMeteors]=useState<Meteor[]>([]),[serverNow,setServerNow]=useState(Date.now()),[ping,setPing]=useState(0),[hurt,setHurt]=useState(0),[distance,setDistance]=useState(64);
  const [stats,setStats]=useState<Stats>({...SPAWN,target:'',progress:0,fps:0});
  const noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function toast(text:string){setNotice(text);clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),4500);}
  function command(c:Command){
    if(c.action!=='move'&&c.action!=='cancelMine'&&game.current)connection.current?.send({action:'move',pose:game.current.position()});
    const ok=connection.current?.send(c)||false;
    if(!ok&&c.action!=='cancelMine'&&c.action!=='move')toast('Connection unavailable. Actions resume after reconnecting.');
    return ok;
  }
  useEffect(()=>{
    setName(localStorage.getItem('blockhaven-name')||'');
    const q=new URLSearchParams(location.search).get('room');if(q){setCode(q.toUpperCase());setMode('join');}
    let cancelled=false;
    import('./engine').then(({createGame})=>{
      if(cancelled||!host.current)return;
      try{
        game.current=createGame(host.current,{command,lock:setLocked,dragMode:setDragMode,stats:setStats,select:setSelected,inventory:()=>setPanel('bag')});
        setReady(true);
      }catch{setError('3D graphics could not start. Use a desktop browser with hardware acceleration enabled.');}
    });
    return()=>{cancelled=true;connection.current?.close();connection.current=null;game.current?.destroy();game.current=null;clearTimeout(noticeTimer.current);};
  },[]);
  useEffect(()=>{
    if(!session||!game.current)return;
    setLoaded(false);
    const client=connectRoom(session,{
      status:(connected,text)=>{setOnline(connected);setStatus(text);game.current?.setOnline(connected);},
      message:m=>{
        const g=game.current;if(!g)return;
        if(m.kind==='welcome'){
          g.apply(m.edits,true);g.updateCrops(m.crops);g.updateMeteors(m.meteors);g.setClock(m.now-Date.now());g.start(m.self);g.setOnline(true);
          selfRef.current=m.self;lastHp.current=m.self.hp;setMe(m.self);setRoom(m.room);setMeteors(m.meteors);setServerNow(m.now);setLoaded(true);setError('');
          const slot=Math.max(0,SLOTS.findIndex(s=>s.item===m.self.item));setSelected(slot);g.select(slot);
        }else if(m.kind==='state'){
          g.updatePeers(m.players);g.updateSelf(m.self);selfRef.current=m.self;
          if(m.self.hp<lastHp.current)setHurt(Date.now());lastHp.current=m.self.hp;
          if(Date.now()-lastUi.current>180||m.self.hp===0){lastUi.current=Date.now();setMe(m.self);setPlayers(m.players);setRoom(m.room);setServerNow(m.now);}
        }else if(m.kind==='edits')g.apply(m.edits);
        else if(m.kind==='crops')g.updateCrops(m.crops);
        else if(m.kind==='meteors'){g.updateMeteors(m.meteors);setMeteors(m.meteors);}
        else if(m.kind==='mining')g.mining(m);
        else if(m.kind==='miningStopped')g.mining(null);
        else if(m.kind==='teleport')g.teleport(m.pose);
        else if(m.kind==='effect')g.effect(m);
        else if(m.kind==='notice')toast(m.text);
        else if(m.kind==='pong'){const rtt=Date.now()-m.at;setPing(rtt);g.setClock(m.now+rtt/2-Date.now());}
      },
    });
    connection.current=client;
    const movement=setInterval(()=>{if(game.current&&selfRef.current?.hp)client.send({action:'move',pose:game.current.position()});},100);
    return()=>{clearInterval(movement);client.close();if(connection.current===client)connection.current=null;};
  },[session]);
  async function enter(){
    if(busy)return;setBusy(true);setError('');
    const roomCode=code.replace(/\s/g,'').toUpperCase();
    try{
      let resume:string|undefined;
      if(mode==='join')try{resume=JSON.parse(localStorage.getItem('blockhaven-v2-'+roomCode)||'null')?.token;}catch{}
      const r=await fetch('/api/world',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:mode,name,room:roomCode,token:resume}),signal:AbortSignal.timeout(15000)});
      const data=await r.json() as Session & {error?:string};if(!r.ok)throw new Error(data.error||'Could not open the world.');
      const s=data as Session;localStorage.setItem('blockhaven-name',name.trim());localStorage.setItem('blockhaven-v2-'+s.room,JSON.stringify(s));
      const url=new URL(location.href);url.searchParams.set('room',s.room);history.replaceState({},'',url);setSession(s);
    }catch(e){setError(e instanceof Error?e.message:'Could not open the world.');}finally{setBusy(false);}
  }
  async function invite(){
    try{await navigator.clipboard.writeText(location.href);setCopied(true);setTimeout(()=>setCopied(false),2500);}
    catch{toast('Copy the page address to invite your friends.');}
  }
  function leave(){connection.current?.close();location.href=location.pathname;}
  function chooseBlock(type:number){setBlock(type);game.current?.setBlock(type);}
  const dead=!!me&&me.hp<=0,hostPlayer=!!me&&room?.host===me.id;
  const equipped=SLOTS[selected],inCamp=sanctuary(stats.x,stats.z);
  const respawnSeconds=me?Math.max(0,Math.ceil((me.deadAt+3000-serverNow)/1000)):0;
  const nearMeteor=meteors.some(m=>Math.hypot(m.x-stats.x,m.z-stats.z)<10);
  return <main className={'app '+(session?'playing':'lobby')}>
    <div ref={host} className="viewport" aria-label="Blockhaven 3D survival world"/><div className="vignette"/>
    <header className="topbar"><a className="brand" href="/"><span className="brandcube">◈</span>blockhaven<span className="alpha">SURVIVAL 02</span></a>
      <div className="topright"><span className="badge"><i/>{session?status:'An adventure with your friends'}</span>{session&&<button className="invite" onClick={invite}>{copied?'Copied ✓':'Invite a friend ↗'}</button>}</div>
    </header>
    {!session?<><section className="welcome">
      <div className="eyebrow"><span/> BUILD. GROW. SURVIVE.</div><h1>A bigger world.<br/>A shared <em>adventure.</em></h1>
      <p className="intro">Gather your first timber. Craft your next tool.<br/>Plant a garden—or brave the falling stars.</p>
      <div className="entrycard"><div className="tabs" role="tablist" aria-label="World options">
        <button role="tab" aria-selected={mode==='create'} className={mode==='create'?'active':''} onClick={()=>setMode('create')}>New world ＋</button>
        <button role="tab" aria-selected={mode==='join'} className={mode==='join'?'active':''} onClick={()=>setMode('join')}>Join / return ↗</button>
      </div><form onSubmit={e=>{e.preventDefault();enter();}}>
        <label htmlFor="name">YOUR NAME</label><input id="name" autoComplete="nickname" maxLength={20} value={name} onChange={e=>setName(e.target.value)} required placeholder="What should we call you?"/>
        {mode==='join'&&<><label htmlFor="room">ROOM CODE</label><input id="room" className="codeinput" maxLength={12} value={code} onChange={e=>setCode(e.target.value.toUpperCase())} required placeholder="12-character room code"/></>}
        <button className="primary" disabled={busy||!ready||!name.trim()}>{busy?'Opening world…':!ready?'Preparing terrain…':mode==='create'?'Create survival world':'Join this world'}<span>→</span></button>
        {error&&<p className="error" role="alert">{error}</p>}<p className="cardfoot">Up to {MAX_PLAYERS} friends · saved worlds · no account needed</p>
      </form></div><div className="features"><span>⛏ Tools & progression</span><span>🌱 Grow & harvest</span><span>☄ Shared meteor storms</span></div>
    </section><div className="scene-caption"><span className="caption-line"/><div><span>THE MEADOW FRONTIER</span><strong>Make camp. Make something yours.</strong><small>{SIZE} × {SIZE} blocks · explore above and below</small></div></div>
    <footer className="lobbyfooter"><span>MADE FOR ADVENTURE.</span><span>Desktop keyboard + mouse <b>·</b> Small-group multiplayer</span><span>ONE WORLD. YOUR FRIENDS. ↗</span></footer></>:<>
      <aside className="worldinfo"><div className="eyebrow">THE MEADOW FRONTIER</div><strong>Room {session.room}</strong>
        <div className="coords">X {Math.floor(stats.x)} / Y {Math.floor(stats.y)} / Z {Math.floor(stats.z)}</div>
        <div className="modechip">{inCamp?'◈ Safe camp':'↟ Exploring'}<span>{room?.danger?'DANGER ON':'SURVIVAL'}</span></div>
        <div className="healthlabel"><strong>♥ {me?.hp??100} / 100</strong><span>{dead?'Defeated':(me?.protectedUntil||0)>serverNow?'Spawn shield':room?.pvp?'PvP enabled':'PvP off'}</span></div>
        <progress className="healthbar" aria-label="Health" max={100} value={me?.hp??100}/>
        <button className="bagbutton" onClick={()=>{game.current?.release();setPanel('bag');}}>Inventory & crafting <kbd>E</kbd></button>
      </aside>
      <aside className="players"><span className="eyebrow">SURVIVING TOGETHER · {players.length+1}</span><div><i className="playerdot"/>{me?.name||name}<small>you {hostPlayer?'· host':''}</small></div>
        {players.map(p=><div key={p.id}><i className="playerdot other"/>{p.name}<small>{p.hp>0?p.hp+' ♥':'respawning'}</small></div>)}
        {!players.length&&<p>Share the invite link.<br/>Friends join the same world.</p>}
        <div className="perf">{stats.fps} FPS · {ping} ms <span>View {distance}</span></div>
      </aside>
      {locked&&!dead&&<><div className="crosshair">{equipped.item==='gun'?'⊕':'+'}</div>{stats.target&&<div className="target-label">{stats.target}</div>}{stats.progress>0&&<progress className="miningbar" aria-label="Mining progress" max={1} value={stats.progress}/>}</>}
      {nearMeteor&&!dead&&<div className="meteor-warning" role="alert">☄ Meteor incoming — move away from the orange ring!</div>}
      {hurt>0&&<div key={hurt} className="hurt-flash"/>}
      {dead?<div className="pausewrap"><section className="pausecard deathcard"><span className="eyebrow">EVERY ADVENTURE HAS A SECOND CHANCE</span><h2>Back to camp.</h2><p>You were defeated by {me?.cause||'the wilderness'}. Your inventory and tools are kept.</p><button className="primary" disabled={!online||respawnSeconds>0} onClick={()=>command({action:'respawn'})}>{respawnSeconds?'Respawn in '+respawnSeconds+'s':'Respawn at camp'}<span>↻</span></button><button className="textbutton" onClick={leave}>Leave world</button></section></div>:
      !locked&&<div className="pausewrap"><section className={'pausecard '+(panel==='bag'?'workshop':'')}>
        <div className="paneltabs"><button className={panel==='menu'?'active':''} onClick={()=>setPanel('menu')}>World & controls</button><button className={panel==='bag'?'active':''} onClick={()=>setPanel('bag')}>Inventory & crafting</button></div>
        {!loaded?<><h2>Opening the frontier…</h2><p>{status}</p></>:panel==='menu'?<>
          <span className="eyebrow">GATHER A LITTLE. BUILD A LOT.</span><h2>Your adventure continues.</h2><p>Start by mining timber with your hands. Press E to craft a wooden pickaxe, then work toward stone, iron, and diamond tools.</p>
          <div className="room-settings"><label><input type="checkbox" checked={room?.danger||false} disabled={!hostPlayer||!online} onChange={e=>command({action:'settings',danger:e.target.checked,pvp:room?.pvp||false})}/>Danger mode <small>Synchronized meteors</small></label><label><input type="checkbox" checked={room?.pvp||false} disabled={!hostPlayer||!online} onChange={e=>command({action:'settings',danger:room?.danger||false,pvp:e.target.checked})}/>Player combat <small>Swords & blasters</small></label></div>
          <small className="settings-note">{hostPlayer?'You are the host. Rules apply to everyone.':'Only the host changes room rules.'}</small>
          {!hostPlayer&&<button className="textbutton" onClick={()=>command({action:'claimHost'})} disabled={!online}>Claim host after they have been offline for 1 minute</button>}
          <div className="controlsgrid"><span><kbd>WASD</kbd> Move</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>HOLD LEFT</kbd> Mine / attack</span><span><kbd>RIGHT / G</kbd> Use / place / harvest</span><span><kbd>1–9</kbd> Equip item</span><span><kbd>E / TAB</kbd> Inventory</span><span><kbd>SHIFT</kbd> Sprint</span><span><kbd>R</kbd> Return to camp</span></div>
          <label className="view-setting">VIEW DISTANCE<select value={distance} onChange={e=>{const v=Number(e.target.value);setDistance(v);game.current?.setDistance(v);}}><option value={40}>40 · faster</option><option value={64}>64 · balanced</option><option value={80}>80 · full island</option></select></label>
        </>:<>
          <div className="workshop-heading"><h2>Make your next move.</h2><span>{PICK_NAMES[me?.pickTier||0]}</span></div>
          <div className="workshop-columns"><div><h3>Your supplies</h3><p className="smallcopy">Select a block to build. Right click to place it.</p><div className="inventory-grid">
            {BLOCKS.map((b,i)=><button key={b.name} aria-label={'Build with '+b.name} disabled={!((me?.inventory[blockItem(i+1)]||0)>0)} className={block===i+1?'chosen':''} onClick={()=>chooseBlock(i+1)}><span className="blockicon" style={{'--block':b.color} as React.CSSProperties}/><strong>{b.name}</strong><small>{me?.inventory[blockItem(i+1)]||0}</small></button>)}
          </div><div className="supplies"><span>🍎 Fruit {me?.inventory.fruit||0}</span><span>🌱 Seeds {me?.inventory.seed||0}</span><span>⌖ Ammo {me?.inventory.ammo||0}</span></div>
          <p className="smallcopy">Food heals 25 HP. Hoe grass or earth, plant seeds, then harvest after 90 seconds. Right click ripe crops with any item.</p></div>
          <div><h3>Crafting bench</h3><div className="recipes">{RECIPES.map(r=>{
            const owned=!!((r.tier&&(me?.pickTier||0)>=r.tier)||(r.tool&&me?.tools.includes(r.tool)));
            const can=online&&!owned&&(me?.pickTier||0)>=(r.requires||0)&&Object.entries(r.cost).every(([id,n])=>(me?.inventory[id]||0)>=n);
            return <button key={r.id} disabled={!can} onClick={()=>command({action:'craft',recipe:r.id})}><span><strong>{r.name}</strong><small>{Object.entries(r.cost).map(([id,n])=>n+' '+itemName(id)).join(' + ')}{r.requires?' · needs '+PICK_NAMES[r.requires]:''}</small></span><b>{owned?'✓':'＋'}</b></button>;
          })}</div></div></div>
        </>}
        <button className="primary" disabled={!loaded||!online} onClick={()=>game.current?.lock()}>{loaded?'Enter / resume world':'Loading…'}<span>→</span></button>
        <div className="pauseactions"><button onClick={invite}>{copied?'Copied!':'Copy invite link ↗'}</button><button onClick={leave}>Leave world</button></div>
        <small className="pausehint">{dragMode?'Mouse capture unavailable: drag to look; hold B to mine or attack.':'Esc opens the menu. The shared world keeps moving; camp is safe.'}</small>
      </section></div>}
      {!dead&&<div className="hotbarwrap"><div className="selectedname">{equipped.item==='pick'?PICK_NAMES[me?.pickTier||0]:equipped.item==='block'?BLOCKS[block-1].name:equipped.label}<span>{equipped.item==='gun'?(me?.inventory.ammo||0)+' ROUNDS':equipped.item==='fruit'?(me?.inventory.fruit||0)+' · +25 HP':equipped.item==='seed'?(me?.inventory.seed||0)+' SEEDS':equipped.item==='block'?(me?.inventory[blockItem(block)]||0)+' BLOCKS':'SURVIVAL'}</span></div>
        <div className="hotbar">{SLOTS.map((s,i)=><button key={s.item} aria-label={'Equip '+s.label} aria-pressed={selected===i} className={selected===i?'selected':''} onClick={()=>game.current?.select(i)}><span className="slotnumber">{i+1}</span><span className="toolicon">{s.icon}</span></button>)}</div>
        <div className="gamehint">{dragMode?'Drag to look · Hold B':'Hold left click'} <b>mine / attack</b><span>·</span> Right click <b>use</b><span>·</span> E <b>craft</b></div>
      </div>}
      {!online&&<div className="networktoast" role="status">{status} Actions are paused.</div>}
      {notice&&<div className="actiontoast" role="status">{notice}</div>}
    </>}
    <div className="mobile-note">Best explored on a computer.<br/><small>Bring a keyboard and mouse for this adventure.</small></div>
  </main>;
}
