'use client';
import {useEffect,useRef,useState} from 'react';
import {BLOCKS} from './world';
import type {createGame,Edit,Peer} from './engine';
type Session={token:string;id:string;room:string;x:number;y:number;z:number};
type SyncData={edits:(Edit & {id:number})[];players:Peer[];more:boolean};
async function request<T=SyncData>(body:unknown){const r=await fetch('/api/world',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});const data=await r.json() as T & {error?:string};if(!r.ok)throw new Error(data.error||'Could not connect. Please try again.');return data}
export default function Home(){
 const host=useRef<HTMLDivElement>(null),game=useRef<ReturnType<typeof createGame>|null>(null),sessionRef=useRef<Session|null>(null),queue=useRef<Edit[]>([]),since=useRef(0),connected=useRef(false),started=useRef(false);
 const [dragMode,setDragMode]=useState(false),[ready,setReady]=useState(false),[session,setSession]=useState<Session|null>(null),[name,setName]=useState(''),[room,setRoom]=useState(''),[mode,setMode]=useState<'create'|'join'>('create'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false),[selected,setSelected]=useState(1),[players,setPlayers]=useState<Peer[]>([]),[status,setStatus]=useState('Connecting'),[loaded,setLoaded]=useState(false),[copied,setCopied]=useState(false),[stats,setStats]=useState({x:24,y:5,z:24,flying:false,target:''});
 useEffect(()=>{setName(localStorage.getItem('blockhaven-name')||'');const r=new URLSearchParams(location.search).get('room');if(r){setRoom(r.toUpperCase());setMode('join')}
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  import('./engine').then(({createGame})=>{if(cancelled||!host.current)return;try{game.current=createGame(host.current,{edit:e=>{if(!connected.current||queue.current.length>=10){setError('Waiting for the world server. Try again in a moment.');return false}queue.current.push(e);return true},lock:setLocked,dragMode:setDragMode,stats:setStats,error:setError,select:setSelected});setReady(true)}catch{setError('This browser could not start 3D graphics. Try Chrome or Edge with hardware acceleration enabled.')}});
  async function sync(){const s=sessionRef.current;let delay=400;
   if(s&&game.current){const sent=queue.current.splice(0,12);try{const data=await request({action:'sync',token:s.token,since:since.current,...game.current.position(),edits:sent});if(cancelled||sessionRef.current!==s)return;
     game.current.apply(data.edits);if(data.edits.length)since.current=data.edits[data.edits.length-1].id;
     game.current.apply(queue.current);game.current.updatePeers(data.players);setPlayers(data.players);
     connected.current=true;setStatus('Online · saved');if(!data.more&&!started.current){started.current=true;game.current.start();setLoaded(true)}
     delay=data.more?150:400;
    }catch(e){if(cancelled||sessionRef.current!==s)return;queue.current.unshift(...sent);connected.current=false;setStatus('Reconnecting…');setError(e instanceof Error?e.message:'Connection lost. Retrying…');delay=2000}
   }if(!cancelled)timer=setTimeout(sync,delay);
  }timer=setTimeout(sync,500);
  return()=>{cancelled=true;clearTimeout(timer);game.current?.destroy()};
 },[]);
 async function enter(){setError('');setBusy(true);try{const s=await request<Session>({action:mode,name,room:room.replace(/\s/g,'')});localStorage.setItem('blockhaven-name',name.trim());sessionRef.current=s;setSession(s);const url=new URL(location.href);url.searchParams.set('room',s.room);history.replaceState({},'',url);since.current=0;queue.current=[];setStatus('Loading world…')}catch(e){setError(e instanceof Error?e.message:'Unable to join.')}finally{setBusy(false)}}
 async function invite(){if(!session)return;const link=new URL(location.href);link.searchParams.set('room',session.room);try{await navigator.clipboard.writeText(link.href);setCopied(true);setTimeout(()=>setCopied(false),2400)}catch{setError('Copy the address from your browser to invite a friend.')}}
 function leave(){if(sessionRef.current){request({action:'leave',token:sessionRef.current.token}).catch(()=>{});sessionRef.current=null}location.href=location.pathname}
 function choose(n:number){setSelected(n);game.current?.select(n)}
 return <main className={'app '+(session?'playing':'lobby')}>
  <div ref={host} className="viewport" aria-label="Interactive 3D block world"/><div className="vignette"/>
  <header className="topbar"><a className="brand" href="/"><span className="brandcube">◈</span>blockhaven<span className="alpha">PLAYGROUND 01</span></a><div className="topright"><span className="badge"><i/>{session?status:'A little world, together'}</span>{session&&<button className="invite" onClick={invite}>{copied?'Link copied ✓':'Invite a friend ↗'}</button>}</div></header>
  {!session?<>
   <section className="welcome"><div className="eyebrow"><span/> BUILD SOMETHING GOOD</div><h1>Small blocks.<br/>Endless <em>possibility.</em></h1><p className="intro">A quiet island. A blank canvas. Your next great idea.<br/>Make a little space in the world—with a friend.</p>
    <div className="entrycard"><div className="tabs" role="tablist" aria-label="World options"><button role="tab" aria-selected={mode==='create'} className={mode==='create'?'active':''} onClick={()=>{setMode('create');setError('')}}>New world <span>＋</span></button><button role="tab" aria-selected={mode==='join'} className={mode==='join'?'active':''} onClick={()=>{setMode('join');setError('')}}>Join a friend <span>↗</span></button></div>
     <form onSubmit={e=>{e.preventDefault();enter()}}><label htmlFor="name">YOUR NAME</label><input id="name" autoComplete="nickname" placeholder="What should we call you?" maxLength={20} value={name} onChange={e=>setName(e.target.value)} required/>
      {mode==='join'&&<><label htmlFor="room">ROOM CODE</label><input id="room" className="codeinput" placeholder="12-character room code" maxLength={12} value={room} onChange={e=>setRoom(e.target.value.toUpperCase())} required/></>}
      <button className="primary" disabled={busy||!ready||!name.trim()} type="submit">{busy?'Opening your world…':!ready?'Preparing the island…':mode==='create'?'Create your world':'Join this world'}<span>→</span></button>
      {error&&<p role="alert" className="error">{error}</p>}<p className="cardfoot">◇ Free to explore. No account needed.</p>
     </form></div><div className="features"><span>▧ Original block world</span><span>◉ Online multiplayer</span><span>∞ Creative mode</span></div>
   </section>
   <div className="scene-caption"><span className="caption-line"/><div><span>YOUR NEXT ADVENTURE</span><strong>The Meadow Islands</strong><small>48 × 48 blocks of possibility</small></div></div>
   <footer className="lobbyfooter"><span>MADE FOR MAKING.</span><span>Desktop keyboard + mouse <b>·</b> World changes saved online</span><span>SCROLL LESS. BUILD MORE. ↗</span></footer>
  </>:<>
   <aside className="worldinfo"><div className="eyebrow">THE MEADOW ISLANDS</div><strong>Room {session.room}</strong><div className="coords">X {Math.floor(stats.x)} <span>/</span> Y {Math.floor(stats.y)} <span>/</span> Z {Math.floor(stats.z)}</div><div className="modechip">{stats.flying?'↟ Flying':'↟ Walking'} <span>CREATIVE</span></div></aside>
   <aside className="players"><span className="eyebrow">BUILDING TOGETHER · {players.length+1}</span><div><i className="playerdot"/>{name.trim()} <small>you</small></div>{players.map(p=><div key={p.id}><i className="playerdot other"/>{p.name}</div>)}{!players.length&&<p>A little better with company.<br/>Send a friend your room link.</p>}</aside>
   {locked&&<><div className="crosshair">+</div>{stats.target&&<div className="target-label">{stats.target}</div>}</>}
   {!locked&&<div className="pausewrap"><section className="pausecard"><span className="eyebrow">YOUR WORLD IS WAITING</span><h2>{loaded?'Make yourself at home.':'Opening the island…'}</h2><p>{loaded?'Break a block. Place an idea. See what happens.':'Restoring saved blocks and connecting your room.'}</p><button className="primary" disabled={!loaded} onClick={()=>{setError('');game.current?.lock()}}>{loaded?'Enter / resume world':'Loading…'}<span>→</span></button><div className="controlsgrid"><span><kbd>W A S D</kbd> Move</span><span><kbd>SPACE</kbd> Jump / fly up</span><span><kbd>MOUSE</kbd> Look around</span><span><kbd>F</kbd> Toggle flight</span><span><kbd>LEFT CLICK</kbd> Break block</span><span><kbd>Q</kbd> Fly down</span><span><kbd>RIGHT CLICK</kbd> Place block</span><span><kbd>1–8</kbd> Choose block</span><span><kbd>SHIFT</kbd> Move faster</span><span><kbd>R</kbd> Return to spawn</span></div><div className="pauseactions"><button onClick={invite}>{copied?'Copied!':'Copy invite link ↗'}</button><button onClick={leave}>Leave world</button></div>{error&&<p className="error" role="alert">{error}</p>}<small className="pausehint">ESC releases the mouse. Your world stays saved.</small></section></div>}
   <div className="hotbarwrap"><div className="selectedname">{BLOCKS[selected-1].name}<span> UNLIMITED</span></div><div className="hotbar">{BLOCKS.map((b,i)=><button key={b.name} onClick={()=>choose(i+1)} aria-label={`Select ${b.name}`} aria-pressed={selected===i+1} className={selected===i+1?'selected':''}><span className="slotnumber">{i+1}</span><span className="blockicon" style={{'--block':b.color} as React.CSSProperties}/></button>)}</div><div className="gamehint">{dragMode?'Drag left mouse to look · Click':'Left click'} <b>break</b><span>·</span> Right click <b>place</b><span>·</span> F <b>fly</b><span>·</span> Esc <b>menu</b></div></div>
   {locked&&status.startsWith('Reconnect')&&<div className="networktoast" role="status">Connection interrupted. Building paused while reconnecting.</div>}
  </>}
  <div className="mobile-note">Best explored on a computer.<br/><small>Bring a keyboard and mouse to build in Blockhaven.</small></div>
 </main>
}
