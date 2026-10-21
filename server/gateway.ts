const json=(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
export async function gameGateway(req:Request,env:Cloudflare.Env):Promise<Response|null> {
  const url=new URL(req.url);
  if(url.pathname!=='/api/world'&&!url.pathname.startsWith('/api/room/'))return null;
  if(req.headers.get('Origin')!==url.origin)return json('Open the game on its own website.',403);
  if(!env.ROOMS)return json('Survival server is not configured. Deploy with the ROOMS Durable Object binding.',503);
  if(url.pathname.startsWith('/api/room/')) {
    const room=url.pathname.slice('/api/room/'.length);
    if(!/^[A-F0-9]{12}$/.test(room)||req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json('Invalid room connection.',400);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  }
  if(req.method!=='POST')return json('Use POST.',405);
  const reader=req.body?.getReader();let text='';
  if(!reader)return json('Request body required.',400);
  const decoder=new TextDecoder();let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return json('Request too large.',413);}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();
  let b;try{b=JSON.parse(text);}catch{return json('Invalid request.',400);}
  if(!b||!['create','join'].includes(b.action))return json('Choose create or join.',400);
  const room=b.action==='create'?crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase():String(b.room||'').toUpperCase();
  if(!/^[A-F0-9]{12}$/.test(room))return json('Enter a 12-character room code.',400);
  return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request('https://room/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.action,name:b.name,token:b.token,room})}));
}
