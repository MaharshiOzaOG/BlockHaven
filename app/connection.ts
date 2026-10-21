import { WORLD_VERSION } from './world';
import type { Command, ServerMessage, Session } from './protocol';
export function connectRoom(session:Session,hooks:{message:(m:ServerMessage)=>void;status:(online:boolean,text:string)=>void}) {
  let socket:WebSocket|undefined,stopped=false,ready=false,seq=0,retries=0,lastReceived=Date.now(),generation=0;
  let retry:ReturnType<typeof setTimeout>|undefined;
  function open(){
    if(stopped)return;
    const gen=++generation;
    const url=new URL('/api/room/'+session.room,location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    socket=new WebSocket(url);const current=socket;
    hooks.status(false,retries?'Reconnecting…':'Connecting…');
    const timeout=setTimeout(()=>{if(!ready&&gen===generation)current.close();},10000);
    current.onopen=()=>current.send(JSON.stringify({kind:'auth',token:session.token}));
    current.onmessage=e=>{
      if(gen!==generation||stopped)return;
      let m:ServerMessage;try{m=JSON.parse(e.data);}catch{return;}
      lastReceived=Date.now();
      if(m.kind==='welcome'){
        if(m.version!==WORLD_VERSION){stopped=true;hooks.status(false,'Version changed. Reload this page.');current.close();return;}
        seq=Math.max(seq,m.self.seq);ready=true;retries=0;clearTimeout(timeout);hooks.status(true,'Online · real-time');
      }
      if(m.kind==='state')seq=Math.max(seq,m.self.seq);
      hooks.message(m);
    };
    current.onerror=()=>current.close();
    current.onclose=e=>{
      clearTimeout(timeout);
      if(gen!==generation||stopped)return;
      ready=false;
      if(e.code===4001||e.code===1008){stopped=true;hooks.status(false,e.code===4001?'This player opened in another tab.':'Session unavailable. Leave and rejoin.');return;}
      hooks.status(false,'Reconnecting…');
      retry=setTimeout(open,Math.min(10000,600*2**Math.min(retries++,4)));
    };
  }
  const heartbeat=setInterval(()=>{
    if(stopped)return;
    if(ready&&socket?.readyState===WebSocket.OPEN){
      if(Date.now()-lastReceived>8000){socket.close();return;}
      socket.send(JSON.stringify({kind:'ping',at:Date.now()}));
    }
  },2000);
  open();
  return {
    send(command:Command){
      if(!ready||socket?.readyState!==WebSocket.OPEN)return false;
      // Do not replay offline crafting, firing, or mining on reconnection.
      if(socket.bufferedAmount>64000){socket.close();return false;}
      socket.send(JSON.stringify({kind:'command',seq:++seq,command}));return true;
    },
    close(){stopped=true;ready=false;clearInterval(heartbeat);clearTimeout(retry);socket?.close(1000,'Leaving world');},
  };
}
