import * as THREE from 'three';
import { BLOCKS, CHUNK, CROP_MS, MAX_Y, SIZE, SLOTS, SPAWN, collides, generateWorld, key, raycast, miningMs } from './world';
import type { Crop, Edit, Equipment, Meteor, Pose, Vec } from './world';
import type { Command, Peer, Self, ServerMessage } from './protocol';
export type Stats={x:number;y:number;z:number;target:string;progress:number;fps:number};
type Hooks={command:(c:Command)=>boolean;lock:(v:boolean)=>void;dragMode:(v:boolean)=>void;stats:(s:Stats)=>void;select:(n:number)=>void;inventory:()=>void};
type Mining={target:Vec;start:number;end:number};
export function createGame(host:HTMLElement,hooks:Hooks) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(host.clientWidth,host.clientHeight);
  renderer.setClearColor('#bed8da');renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.Fog('#bed8da',38,78);
  const camera=new THREE.PerspectiveCamera(70,host.clientWidth/host.clientHeight,.05,180);camera.rotation.order='YXZ';scene.add(camera);
  scene.add(new THREE.HemisphereLight('#fff8df','#68787a',2.1));
  const sun=new THREE.DirectionalLight('#fff0c7',2.5);sun.position.set(-25,65,35);scene.add(sun);
  let world=generateWorld(),active=false,online=false,alive=true,locked=false,dragMode=false,dragging=false;
  let disposed=false,frame=0,last=performance.now(),statsAt=0,yaw=-.7,pitch=-.12,vy=0,grounded=false,selected=0;
  let held=false,lastAttack=0,requested='',mine:Mining|null=null,self:Self|null=null,clockOffset=0,viewDistance=64,block=2;
  const body=new THREE.Vector3(SPAWN.x,SPAWN.y,SPAWN.z),keys=new Set<string>();
  let target:ReturnType<typeof raycast>=null,frames=0,fps=0,fpsAt=last;
  const chunks=new Map<string,THREE.Mesh>(),dirty=new Set<string>();
  const dirs=[{n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],shade:.82},{n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],shade:.7},{n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],shade:1},{n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],shade:.55},{n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],shade:.9},{n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],shade:.78}];
  const canvas=document.createElement('canvas');canvas.width=BLOCKS.length*16;canvas.height=16;
  const tc=canvas.getContext('2d')!;
  BLOCKS.forEach((b,i)=>{
    tc.fillStyle=i>=8&&i<=11?'#7e8790':b.color;tc.fillRect(i*16,0,16,16);
    for(let p=0;p<95;p++){tc.fillStyle=p%3?'rgba(255,255,255,.08)':'rgba(0,0,0,.09)';tc.fillRect(i*16+(p*7+p*p)%16,(p*11+Math.floor(p/4))%16,2,2);}
    if(i>=8&&i<=11){tc.fillStyle=b.color;for(let p=0;p<7;p++)tc.fillRect(i*16+(p*7)%13,(p*5)%13,3,3);}
    if(i===3||i===12){tc.fillStyle='#614532';for(let x=2;x<16;x+=4)tc.fillRect(i*16+x,0,1,16);}
  });
  const texture=new THREE.CanvasTexture(canvas);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshLambertMaterial({map:texture,vertexColors:true});
  const chunkKey=(x:number,z:number)=>Math.floor(x/CHUNK)+','+Math.floor(z/CHUNK);
  function dirtyAll(){for(let x=0;x<SIZE;x+=CHUNK)for(let z=0;z<SIZE;z+=CHUNK)dirty.add(chunkKey(x,z));}
  dirtyAll();
  function meshChunk(k:string){
    const [cx,cz]=k.split(',').map(Number),pos:number[]=[],norm:number[]=[],uv:number[]=[],colors:number[]=[];
    for(let x=cx*CHUNK;x<Math.min(SIZE,(cx+1)*CHUNK);x++)for(let z=cz*CHUNK;z<Math.min(SIZE,(cz+1)*CHUNK);z++)for(let y=0;y<=MAX_Y;y++){
      const type=world.get(key(x,y,z));if(!type)continue;
      for(const d of dirs){if(world.has(key(x+d.n[0],y+d.n[1],z+d.n[2])))continue;
        const tile=type===1&&d.n[1]===-1?1:type-1,uvs=[[.03,.03],[.97,.03],[.97,.97],[.03,.97]];
        for(const j of [0,1,2,0,2,3]){pos.push(x+d.v[j][0],y+d.v[j][1],z+d.v[j][2]);norm.push(...d.n);uv.push((tile+uvs[j][0])/BLOCKS.length,uvs[j][1]);colors.push(d.shade,d.shade,d.shade);}
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeBoundingSphere();
    let mesh=chunks.get(k);
    if(mesh){mesh.geometry.dispose();mesh.geometry=geo;}else{mesh=new THREE.Mesh(geo,material);chunks.set(k,mesh);scene.add(mesh);}
    dirty.delete(k);
  }
  function chunkDistance(k:string){const [x,z]=k.split(',').map(Number);return Math.hypot(x*CHUNK+CHUNK/2-camera.position.x,z*CHUNK+CHUNK/2-camera.position.z);}
  function processChunks(){
    // At most two changed chunks per frame; edits never rebuild the entire map.
    const queued=[...dirty].filter(k=>chunkDistance(k)<viewDistance+CHUNK).sort((a,b)=>chunkDistance(a)-chunkDistance(b));
    for(const k of queued.slice(0,2))meshChunk(k);
    for(const [k,m] of chunks)m.visible=chunkDistance(k)<viewDistance+CHUNK;
  }
  const ocean=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshLambertMaterial({color:'#77afb3'}));ocean.rotation.x=-Math.PI/2;ocean.position.set(40,.25,40);scene.add(ocean);
  const cloudMat=new THREE.MeshLambertMaterial({color:'#fffbef'}),cloudGeo=new THREE.BoxGeometry(1,1,1);
  for(let i=0;i<10;i++){const cloud=new THREE.Group();for(let j=0;j<3;j++){const m=new THREE.Mesh(cloudGeo,cloudMat);m.scale.set(5+j%2*2,1.2,3);m.position.set(j*3,0,j%2);cloud.add(m);}cloud.position.set((i*23)%110-15,35+(i%3)*3,(i*37)%110-15);scene.add(cloud);}
  const camp=new THREE.Mesh(new THREE.RingGeometry(3.8,4,40),new THREE.MeshBasicMaterial({color:'#c6edb4',side:THREE.DoubleSide,transparent:true,opacity:.6}));camp.rotation.x=-Math.PI/2;camp.position.set(SPAWN.x,SPAWN.y-.01,SPAWN.z);scene.add(camp);
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008,1.008,1.008)),new THREE.LineBasicMaterial({color:'#fff6d7'}));outline.visible=false;scene.add(outline);
  const tool=new THREE.Group();tool.position.set(.36,-.32,-.65);tool.rotation.set(-.15,-.2,-.2);camera.add(tool);
  function disposeObject(g:THREE.Object3D){
    g.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments||o instanceof THREE.Line||o instanceof THREE.Sprite){if('geometry' in o)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){if('map' in m&&m.map instanceof THREE.Texture)m.map.dispose();m.dispose();}}});g.removeFromParent();
  }
  function box(g:THREE.Group,size:number[],position:number[],color:string){const m=new THREE.Mesh(new THREE.BoxGeometry(...size as [number,number,number]),new THREE.MeshLambertMaterial({color}));m.position.set(...position as [number,number,number]);g.add(m);return m;}
  function updateTool(){
    for(const c of [...tool.children])disposeObject(c);
    const item=SLOTS[selected].item;
    const metal=['#c39763','#c39763','#b8c1c4','#d9dce0','#69dcd5'][self?.pickTier||0];
    if(item==='pick'||item==='axe'||item==='hoe'){
      box(tool,[.06,.42,.06],[0,0,0],'#9b6f42');box(tool,item==='axe'?[.19,.16,.04]:[.3,.065,.08],[.03,.2,0],item==='pick'?metal:'#a5b6bf');
    }else if(item==='sword'){box(tool,[.055,.48,.035],[0,.15,0],'#d0e2e2');box(tool,[.22,.05,.08],[0,-.08,0],'#c4a15f');box(tool,[.07,.16,.07],[0,-.17,0],'#70503c');
    }else if(item==='gun'){box(tool,[.12,.15,.4],[0,.04,-.1],'#4f626d');box(tool,[.08,.18,.1],[0,-.1,.02],'#916e4b');box(tool,[.05,.05,.15],[0,.04,-.36],'#c8d3d0');
    }else if(item==='fruit'){box(tool,[.2,.2,.2],[0,0,0],'#c76947');box(tool,[.09,.035,.05],[.05,.12,0],'#709256');
    }else if(item==='seed'){box(tool,[.15,.18,.1],[0,0,0],'#91b955');
    }else if(item==='block'){box(tool,[.24,.24,.24],[0,0,0],BLOCKS[block-1].color);
    }else box(tool,[.16,.25,.16],[0,-.1,0],'#ebc29c');
  }
  updateTool();
  const peers=new Map<string,{group:THREE.Group;target:THREE.Vector3;yaw:number;health:THREE.Mesh;bar:THREE.Group;item:Equipment;weapon:THREE.Group}>();
  function peerMesh(p:Peer){
    const g=new THREE.Group(),shirt=new THREE.Color().setHSL((p.id.charCodeAt(0)*.17)%1,.4,.52).getStyle();
    box(g,[.52,.65,.3],[0,1.02,0],shirt);box(g,[.43,.43,.43],[0,1.57,0],'#edc8a0');
    box(g,[.2,.64,.25],[-.15,.33,0],'#485d65');box(g,[.2,.64,.25],[.15,.33,0],'#485d65');
    box(g,[.18,.65,.23],[-.37,1.02,0],shirt);box(g,[.18,.65,.23],[.37,1.02,0],shirt);
    const label=document.createElement('canvas');label.width=256;label.height=64;const ctx=label.getContext('2d')!;
    ctx.fillStyle='rgba(27,47,45,.85)';ctx.roundRect(0,0,256,64,16);ctx.fill();ctx.fillStyle='#fff9e9';ctx.font='bold 25px sans-serif';ctx.textAlign='center';ctx.fillText(p.name,128,41);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(label)}));sprite.position.y=2.16;sprite.scale.set(1.8,.45,1);g.add(sprite);
    const bar=new THREE.Group();bar.position.y=2.5;
    box(bar,[1.05,.11,.025],[0,0,0],'#344538');const health=box(bar,[1,.075,.03],[0,0,.02],'#85ba6a');g.add(bar);
    const weapon=new THREE.Group();weapon.position.set(.4,.9,-.15);g.add(weapon);
    g.position.set(p.x,p.y,p.z);scene.add(g);
    return {group:g,target:new THREE.Vector3(p.x,p.y,p.z),yaw:p.yaw,health,bar,item:'hand' as Equipment,weapon};
  }
  function updatePeers(list:Peer[]){
    for(const p of list){let item=peers.get(p.id);if(!item){item=peerMesh(p);peers.set(p.id,item);}
      item.target.set(p.x,p.y,p.z);item.yaw=p.yaw;item.group.visible=p.hp>0;item.health.scale.x=Math.max(.001,p.hp/100);item.health.position.x=-(1-p.hp/100)/2;
      if(item.item!==p.item){for(const c of [...item.weapon.children])disposeObject(c);item.item=p.item;if(p.item==='sword')box(item.weapon,[.06,.6,.04],[0,.1,0],'#c8d9da');else if(p.item==='gun')box(item.weapon,[.14,.14,.45],[0,0,-.15],'#536675');}
    }
    for(const [id,p] of peers)if(!list.some(v=>v.id===id)){disposeObject(p.group);peers.delete(id);}
  }
  const cropMeshes=new Map<string,{group:THREE.Group;crop:Crop;stage:number}>();
  function updateCrops(list:Crop[]){
    const keep=new Set(list.map(c=>key(c.x,c.y,c.z)));
    for(const [k,c] of cropMeshes)if(!keep.has(k)){disposeObject(c.group);cropMeshes.delete(k);}
    for(const c of list){const k=key(c.x,c.y,c.z);if(!cropMeshes.has(k)){const group=new THREE.Group();group.position.set(c.x+.5,c.y+1,c.z+.5);scene.add(group);cropMeshes.set(k,{group,crop:c,stage:-1});}else cropMeshes.get(k)!.crop=c;}
  }
  function growCrops(now:number){
    for(const c of cropMeshes.values()){
      const stage=Math.min(3,Math.max(0,Math.floor((now-c.crop.planted)/CROP_MS*3)));
      if(stage===c.stage)continue;c.stage=stage;for(const o of [...c.group.children])disposeObject(o);
      for(const x of [-.2,.2])for(const z of [-.2,.2]){const h=.15+stage*.18;box(c.group,[.055,h,.055],[x,h/2,z],stage===3?'#cfb05d':'#729844');box(c.group,[.17,.04,.12],[x,h*.65,z],'#8cb753');if(stage===3)box(c.group,[.13,.13,.13],[x,h,z],'#dc8655');}
    }
  }
  const meteorMeshes=new Map<string,{meteor:Meteor;group:THREE.Group;rock:THREE.Mesh;ring:THREE.Mesh}>();
  function updateMeteors(list:Meteor[]){
    const keep=new Set(list.map(m=>m.id));
    for(const [id,m] of meteorMeshes)if(!keep.has(id)){disposeObject(m.group);meteorMeshes.delete(id);}
    for(const m of list)if(!meteorMeshes.has(m.id)){
      const group=new THREE.Group();const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(.65,0),new THREE.MeshBasicMaterial({color:'#f69849'}));group.add(rock);
      const ring=new THREE.Mesh(new THREE.RingGeometry(m.radius-.13,m.radius,40),new THREE.MeshBasicMaterial({color:'#f58046',side:THREE.DoubleSide,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.position.set(m.x,m.y+.03,m.z);group.add(ring);scene.add(group);
      meteorMeshes.set(m.id,{meteor:m,group,rock,ring});
    }
  }
  const effects:{object:THREE.Object3D;until:number;impact:boolean}[]=[];
  function effect(e:Extract<ServerMessage,{kind:'effect'}>){
    if(e.effect==='swing'){if(self?.id===e.id)lastAttack=performance.now();return;}
    let object:THREE.Object3D;
    if(e.effect==='shot'){
      const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.from.x,e.from.y,e.from.z),new THREE.Vector3(e.to.x,e.to.y,e.to.z)]);
      object=new THREE.Line(geo,new THREE.LineBasicMaterial({color:'#fff0a3',transparent:true,opacity:.9}));
    }else{const m=new THREE.Mesh(new THREE.SphereGeometry(.8,8,6),new THREE.MeshBasicMaterial({color:'#f8af63',wireframe:true,transparent:true,opacity:.7}));m.position.set(e.to.x,e.to.y+.2,e.to.z);object=m;}
    scene.add(object);effects.push({object,until:performance.now()+(e.effect==='shot'?110:550),impact:e.effect==='impact'});
    if(effects.length>24)disposeObject(effects.shift()!.object);
  }
  function apply(edits:Edit[],reset=false){
    if(reset){world=generateWorld();dirtyAll();}
    for(const e of edits){
      const k=key(e.x,e.y,e.z);if((world.get(k)||0)===e.type)continue;
      if(e.type)world.set(k,e.type);else world.delete(k);
      for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])if(e.x+dx>=0&&e.x+dx<SIZE&&e.z+dz>=0&&e.z+dz<SIZE)dirty.add(chunkKey(e.x+dx,e.z+dz));
    }
  }
  function cancelMine(){if(requested||mine)hooks.command({action:'cancelMine'});requested='';mine=null;held=false;}
  function release(){
    keys.clear();cancelMine();dragging=false;
    if(document.pointerLockElement===renderer.domElement)document.exitPointerLock();
    locked=false;hooks.lock(false);
  }
  function teleport(p:Pose){body.set(p.x,p.y,p.z);vy=0;grounded=false;}
  function updateSelf(p:Self){
    const changed=!self||self.pickTier!==p.pickTier;self=p;alive=p.hp>0;
    if(changed)updateTool();if(!alive&&locked)release();
  }
  function select(n:number){cancelMine();selected=n;hooks.select(n);updateTool();hooks.command({action:'equip',item:SLOTS[n].item,block});}
  function aim(){
    const d=new THREE.Vector3();camera.getWorldDirection(d);target=raycast(world,camera.position,d,6);
    outline.visible=active&&alive&&!!target;if(target)outline.position.set(target.x+.5,target.y+.5,target.z+.5);
  }
  function act(){
    if(!online||!alive||!locked)return;
    const item=SLOTS[selected].item;
    if(item==='sword'||item==='gun'){
      if(performance.now()-lastAttack>(item==='gun'?420:680)){lastAttack=performance.now();hooks.command({action:'attack'});}
    }else if(['hand','pick','axe'].includes(item)&&target){
      const k=key(target.x,target.y,target.z);
      if(requested!==k){if(requested)hooks.command({action:'cancelMine'});requested=k;mine=null;hooks.command({action:'mine',target:{x:target.x,y:target.y,z:target.z}});}
    }
  }
  function onMouse(e:MouseEvent){if(locked&&(!dragMode||dragging)&&alive&&online){yaw-=e.movementX*.0022;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.0022,-1.53,1.53);yaw=THREE.MathUtils.euclideanModulo(yaw+Math.PI,Math.PI*2)-Math.PI;}}
  function onLock(){locked=document.pointerLockElement===renderer.domElement;keys.clear();if(!locked)cancelMine();hooks.lock(locked);}
  function onKey(e:KeyboardEvent){
    if(!active||!locked)return;
    if(e.code==='Escape'){release();return;}
    if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    if(e.code==='Tab'||e.code==='KeyE'){release();hooks.inventory();return;}
    keys.add(e.code);if(e.repeat)return;
    if(/^Digit[1-9]$/.test(e.code))select(Number(e.code.slice(-1))-1);
    if(e.code==='KeyB')held=true;
    if(e.code==='KeyR')hooks.command({action:'rescue'});
    if(e.code==='KeyG')hooks.command({action:'use'});
  }
  function onUp(e:KeyboardEvent){keys.delete(e.code);if(e.code==='KeyB')cancelMine();}
  function down(e:MouseEvent){
    if(!active||!locked||!online||!alive)return;e.preventDefault();
    if(e.button===0){if(dragMode)dragging=true;else{held=true;act();}}
    if(e.button===2){cancelMine();hooks.command({action:'use'});}
  }
  function mouseUp(e:MouseEvent){if(e.button===0){dragging=false;if(!keys.has('KeyB'))cancelMine();}}
  function blur(){release();}
  function context(e:Event){e.preventDefault();}
  function wheel(e:WheelEvent){if(!locked)return;e.preventDefault();select((selected+(e.deltaY>0?1:8))%9);}
  function visibility(){if(document.hidden)release();}
  const resize=()=>{camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);};
  const observer=new ResizeObserver(resize);observer.observe(host);
  document.addEventListener('pointerlockchange',onLock);document.addEventListener('mousemove',onMouse);document.addEventListener('mouseup',mouseUp);document.addEventListener('keydown',onKey);document.addEventListener('keyup',onUp);document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);
  renderer.domElement.addEventListener('mousedown',down);renderer.domElement.addEventListener('contextmenu',context);renderer.domElement.addEventListener('wheel',wheel,{passive:false});
  let cropsAt=0;
  function tick(now:number){
    if(disposed)return;const dt=Math.min((now-last)/1000,.05);last=now;
    if(active){
      if(alive&&online){
        const f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),s=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
        const speed=keys.has('ShiftLeft')?7.5:4.8,norm=Math.max(1,Math.hypot(f,s));
        const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)/norm*speed,dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)/norm*speed;
        if(grounded&&keys.has('Space')){vy=8.3;grounded=false;}
        for(let step=0;step<5;step++){
          const delta=dt/5,oldX=body.x;body.x+=dx*delta;if(collides(world,body))body.x=oldX;
          const oldZ=body.z;body.z+=dz*delta;if(collides(world,body))body.z=oldZ;
          vy=Math.max(-30,vy-23*delta);const oldY=body.y;body.y+=vy*delta;
          if(collides(world,body)){if(vy<0)grounded=true;body.y=oldY;vy=0;}else grounded=false;
        }
      }
      camera.position.copy(body);camera.position.y+=1.6;camera.rotation.set(pitch,yaw,0);camera.updateMatrixWorld();aim();
      if(held&&locked&&online&&alive){
        if(requested&&(!target||key(target.x,target.y,target.z)!==requested)){hooks.command({action:'cancelMine'});requested='';mine=null;}
        act();
      }
    }else{const t=now*.000022;camera.position.set(40+Math.cos(t)*37,29,40+Math.sin(t)*37);camera.lookAt(40,8,40);}
    tool.visible=active&&alive&&locked;tool.rotation.z=-.2+Math.sin(Math.min(1,(now-lastAttack)/250)*Math.PI)*-.5;
    const serverNow=Date.now()+clockOffset;
    for(const p of peers.values()){p.group.position.lerp(p.target,1-Math.exp(-dt*13));p.group.rotation.y=p.yaw;p.bar.rotation.y=camera.rotation.y-p.yaw;}
    for(const {meteor:m,rock,ring} of meteorMeshes.values()){
      const t=THREE.MathUtils.clamp((serverNow-m.start)/(m.impact-m.start),0,1);
      rock.position.set(m.x+(1-t)*10,m.y+(1-t)*32,m.z+(1-t)*7);rock.rotation.x+=dt*2;rock.rotation.z+=dt;
      (ring.material as THREE.MeshBasicMaterial).opacity=.35+Math.sin(now*.012)*.25;
    }
    if(now-cropsAt>1000){growCrops(serverNow);cropsAt=now;}
    for(let i=effects.length-1;i>=0;i--){const e=effects[i];if(now>e.until){disposeObject(e.object);effects.splice(i,1);}else if(e.impact)e.object.scale.addScalar(dt*6);}
    processChunks();
    frames++;if(now-fpsAt>1000){fps=Math.round(frames*1000/(now-fpsAt));frames=0;fpsAt=now;}
    if(active&&now-statsAt>100){
      statsAt=now;let label=target?BLOCKS[target.type-1].name:'';
      if(target&&cropMeshes.has(key(target.x,target.y,target.z))){const c=cropMeshes.get(key(target.x,target.y,target.z))!.crop;label=serverNow-c.planted>=CROP_MS?'Ripe crop · right click to harvest':'Crop · '+Math.ceil((CROP_MS-serverNow+c.planted)/1000)+'s to harvest';}
      else if(target&&['hand','pick','axe'].includes(SLOTS[selected].item)&&!Number.isFinite(miningMs(target.type,SLOTS[selected].item,self?.pickTier||0)))label+=' · better pickaxe needed';
      hooks.stats({x:body.x,y:body.y,z:body.z,target:label,progress:mine?THREE.MathUtils.clamp((serverNow-mine.start)/(mine.end-mine.start),0,1):0,fps});
    }
    renderer.render(scene,camera);frame=requestAnimationFrame(tick);
  }
  frame=requestAnimationFrame(tick);
  return {
    apply,updatePeers,updateCrops,updateMeteors,effect,updateSelf,teleport,release,select,
    setBlock:(type:number)=>{block=type;select(8);},
    setClock:(offset:number)=>{clockOffset=offset;},
    setOnline:(v:boolean)=>{online=v;if(!v){keys.clear();held=false;mine=null;requested='';}},
    setDistance:(distance:number)=>{viewDistance=distance;(scene.fog as THREE.Fog).near=distance*.6;(scene.fog as THREE.Fog).far=distance+14;},
    mining:(value:Mining|null)=>{mine=value;if(!value)requested='';},
    position:():Pose=>({x:body.x,y:body.y,z:body.z,yaw,pitch}),
    start:(p:Self)=>{active=true;updateSelf(p);teleport(p);yaw=p.yaw;pitch=p.pitch;},
    lock:async()=>{if(!alive||!online)return;try{dragMode=false;await renderer.domElement.requestPointerLock();hooks.dragMode(false);}catch{dragMode=true;locked=true;keys.clear();hooks.dragMode(true);hooks.lock(true);}},
    destroy:()=>{
      disposed=true;cancelAnimationFrame(frame);release();observer.disconnect();
      document.removeEventListener('pointerlockchange',onLock);document.removeEventListener('mousemove',onMouse);document.removeEventListener('mouseup',mouseUp);document.removeEventListener('keydown',onKey);document.removeEventListener('keyup',onUp);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);
      renderer.domElement.removeEventListener('mousedown',down);renderer.domElement.removeEventListener('contextmenu',context);renderer.domElement.removeEventListener('wheel',wheel);
      // Shared terrain/cloud materials are disposed once, not once per chunk.
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
      scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Sprite){if('geometry' in o)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if('map' in m&&m.map instanceof THREE.Texture)textures.add(m.map);}}});
      for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();renderer.dispose();renderer.domElement.remove();
    },
  };
}
