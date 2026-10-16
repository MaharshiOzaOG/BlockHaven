import * as THREE from 'three';
import {BLOCKS, SIZE, generateWorld, key, height} from './world';
export type Edit={id?:number;x:number;y:number;z:number;type:number};
export type Peer={id:string;name:string;x:number;y:number;z:number;yaw:number};
export function createGame(host:HTMLElement, hooks:{edit:(e:Edit)=>boolean;lock:(v:boolean)=>void;dragMode:(v:boolean)=>void;stats:(s:{x:number;y:number;z:number;flying:boolean;target:string})=>void;error:(s:string)=>void;select:(n:number)=>void}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(host.clientWidth,host.clientHeight);
  renderer.setClearColor('#bed8da');renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.Fog('#bed8da',42,120);
  const camera=new THREE.PerspectiveCamera(70,host.clientWidth/host.clientHeight,.05,240);
  camera.rotation.order='YXZ';
  scene.add(new THREE.HemisphereLight('#fff8df','#68787a',2.1));
  const sun=new THREE.DirectionalLight('#fff0c7',2.5);sun.position.set(-25,65,35);scene.add(sun);
  const world=generateWorld();const body=new THREE.Vector3(23.5,height(23,23)+1.01,23.5);
  const keys=new Set<string>();let active=false,locked=false,flying=false,grounded=false,yaw=0,pitch=0,vy=0,selected=1,dead=false,frame=0,last=performance.now(),statsTime=0;
  let target:{x:number;y:number;z:number;nx:number;ny:number;nz:number}|null=null;
  const texCanvas=document.createElement('canvas');texCanvas.width=128;texCanvas.height=16;
  const tc=texCanvas.getContext('2d')!;
  BLOCKS.forEach((b,i)=>{tc.fillStyle=b.color;tc.fillRect(i*16,0,16,16);for(let p=0;p<95;p++){let x=(p*7+p*p)%16,y=(p*11+Math.floor(p/4))%16;tc.fillStyle=p%3?'rgba(255,255,255,.07)':'rgba(0,0,0,.08)';tc.fillRect(i*16+x,y,2,2)}if(i===3){tc.fillStyle='#775634';for(let x=2;x<16;x+=5)tc.fillRect(i*16+x,0,1,16)}if(i===6){tc.fillStyle='#dbb8a0';tc.fillRect(i*16,7,16,1);tc.fillRect(i*16,15,16,1);tc.fillRect(i*16+7,0,1,7);tc.fillRect(i*16+3,8,1,7)}});
  const texture=new THREE.CanvasTexture(texCanvas);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshLambertMaterial({map:texture,vertexColors:true});
  let terrain=new THREE.Mesh(new THREE.BufferGeometry(),material);scene.add(terrain);
  const dirs=[{n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],shade:.82},{n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],shade:.7},{n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],shade:1},{n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],shade:.55},{n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],shade:.9},{n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],shade:.78}];
  function rebuild(){const pos:number[]=[],norm:number[]=[],uv:number[]=[],colors:number[]=[];
    for(const [k,type] of world){const [x,y,z]=k.split(',').map(Number);for(const d of dirs){if(world.has(key(x+d.n[0],y+d.n[1],z+d.n[2])))continue;const tile=type===1 && d.n[1]===-1?1:type-1;const uvs=[[.03,.03],[.97,.03],[.97,.97],[.03,.97]];
      for(const j of [0,1,2,0,2,3]){pos.push(x+d.v[j][0],y+d.v[j][1],z+d.v[j][2]);norm.push(...d.n);uv.push((tile+uvs[j][0])/8,uvs[j][1]);colors.push(d.shade,d.shade,d.shade)}}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeBoundingSphere();terrain.geometry.dispose();terrain.geometry=geo;
  }rebuild();
  const ocean=new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.MeshLambertMaterial({color:'#77afb3',transparent:true,opacity:.84}));ocean.rotation.x=-Math.PI/2;ocean.position.set(24,.25,24);scene.add(ocean);
  const cloudMat=new THREE.MeshLambertMaterial({color:'#fffbef'});
  const cloudGeo=new THREE.BoxGeometry(1,1,1);
  for(let i=0;i<13;i++){const cloud=new THREE.Group();for(let j=0;j<4;j++){const m=new THREE.Mesh(cloudGeo,cloudMat);m.scale.set(4+j%2*2,1.1+j%2*.5,3);m.position.set(j*3,j%2*.3,j%2);cloud.add(m)}cloud.position.set((i*23)%130-35,24+(i%3)*4,(i*37)%140-45);scene.add(cloud)}
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008,1.008,1.008)),new THREE.LineBasicMaterial({color:'#fff6d7',depthTest:true}));outline.visible=false;scene.add(outline);
  const peers=new Map<string,{group:THREE.Group;target:THREE.Vector3;yaw:number}>();
  function peerMesh(p:Peer){const g=new THREE.Group();const c=new THREE.Color().setHSL((p.id.charCodeAt(0)*.17)%1,.4,.52);const shirt=new THREE.MeshLambertMaterial({color:c});const skin=new THREE.MeshLambertMaterial({color:'#edc8a0'});const trousers=new THREE.MeshLambertMaterial({color:'#485d65'});for(const [sx,sy,sz,x,y,z,mat] of [[.52,.65,.3,0,1.02,0,shirt],[.43,.43,.43,0,1.57,0,skin],[.2,.64,.25,-.15,.33,0,trousers],[.2,.64,.25,.15,.33,0,trousers],[.18,.65,.23,-.37,1.02,0,shirt],[.18,.65,.23,.37,1.02,0,shirt]] as [number,number,number,number,number,number,THREE.Material][]){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);g.add(m)}
    const label=document.createElement('canvas');label.width=256;label.height=64;const ctx=label.getContext('2d')!;ctx.fillStyle='rgba(27,47,45,.85)';ctx.roundRect(0,0,256,64,16);ctx.fill();ctx.fillStyle='#fff9e9';ctx.font='bold 25px sans-serif';ctx.textAlign='center';ctx.fillText(p.name,128,41);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(label),depthTest:false}));sprite.position.y=2.1;sprite.scale.set(1.8,.45,1);g.add(sprite);g.position.set(p.x,p.y,p.z);scene.add(g);return g;
  }
  function disposeGroup(g:THREE.Group){g.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){if(o instanceof THREE.Mesh)o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if('map' in m && m.map instanceof THREE.Texture)m.map.dispose();m.dispose()}}});scene.remove(g)}
  function updatePeers(list:Peer[]){for(const p of list){let item=peers.get(p.id);if(!item){item={group:peerMesh(p),target:new THREE.Vector3(),yaw:p.yaw};peers.set(p.id,item)}item.target.set(p.x,p.y,p.z);item.yaw=p.yaw}for(const [id,p] of peers)if(!list.some(v=>v.id===id)){disposeGroup(p.group);peers.delete(id)}}
  function solid(x:number,y:number,z:number){return world.has(key(Math.floor(x),Math.floor(y),Math.floor(z)))}
  function collision(p:THREE.Vector3){if(p.x<.3||p.z<.3||p.x>SIZE-.3||p.z>SIZE-.3||p.y<1)return true;
    for(let x=Math.floor(p.x-.28);x<=Math.floor(p.x+.28);x++)for(let y=Math.floor(p.y+.01);y<=Math.floor(p.y+1.69);y++)for(let z=Math.floor(p.z-.28);z<=Math.floor(p.z+.28);z++)if(world.has(key(x,y,z)))return true;return false;
  }
  function respawn(){body.set(23.5,30,23.5);for(let y=27;y>=0;y--)if(solid(23.5,y,23.5)){body.y=y+1.02;break}vy=0}
  const direction=new THREE.Vector3();const v=new THREE.Vector3();
  function aim(){camera.getWorldDirection(direction);let prev=[Math.floor(camera.position.x),Math.floor(camera.position.y),Math.floor(camera.position.z)];target=null;
    for(let t=0;t<7;t+=.035){v.copy(camera.position).addScaledVector(direction,t);const q=[Math.floor(v.x),Math.floor(v.y),Math.floor(v.z)];if(solid(v.x,v.y,v.z)){target={x:q[0],y:q[1],z:q[2],nx:prev[0]-q[0],ny:prev[1]-q[1],nz:prev[2]-q[2]};break}prev=q}
    outline.visible=!!target;if(target)outline.position.set(target.x+.5,target.y+.5,target.z+.5);
  }
  function apply(edits:Edit[]){let changed=false;for(const e of edits){const k=key(e.x,e.y,e.z);if((world.get(k)||0)===e.type)continue;if(e.type)world.set(k,e.type);else world.delete(k);changed=true}if(changed){rebuild();if(active&&collision(body))respawn()}}
  function edit(place:boolean){if(!target)return;const {x,y,z,nx,ny,nz}=target;const e={x:x+(place?nx:0),y:y+(place?ny:0),z:z+(place?nz:0),type:place?selected:0};if(e.y<1||e.y>27||e.x<0||e.z<0||e.x>=SIZE||e.z>=SIZE)return;
    if(place && e.x+1>body.x-.28&&e.x<body.x+.28&&e.y+1>body.y&&e.y<body.y+1.7&&e.z+1>body.z-.28&&e.z<body.z+.28)return;
    if(hooks.edit(e))apply([e]);
  }
  let dragMode=false,dragging=false,dragDistance=0;
  function onMouse(e:MouseEvent){if(locked&&(!dragMode||dragging)){dragDistance+=Math.abs(e.movementX)+Math.abs(e.movementY);yaw-=e.movementX*.0022;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.0022,-1.53,1.53);yaw=THREE.MathUtils.euclideanModulo(yaw+Math.PI,Math.PI*2)-Math.PI}}
  function onLock(){locked=document.pointerLockElement===renderer.domElement;keys.clear();hooks.lock(locked)}
  function onKey(e:KeyboardEvent){if(!active||!locked)return;if(e.code==='Escape'&&dragMode){locked=false;dragging=false;keys.clear();hooks.lock(false);return}if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyF'){flying=!flying;vy=0}if(e.code==='KeyR')respawn();if(/^Digit[1-8]$/.test(e.code)){selected=Number(e.code.slice(-1));hooks.select(selected)}}
  function onUp(e:KeyboardEvent){keys.delete(e.code)}function blur(){keys.clear()}
  function down(e:MouseEvent){if(!active||!locked)return;e.preventDefault();if(dragMode&&e.button===0){dragging=true;dragDistance=0;return}if(e.button===0||e.button===2)edit(e.button===2)}
  function mouseUp(e:MouseEvent){if(dragMode&&dragging&&e.button===0){dragging=false;if(dragDistance<5)edit(false)}}
  function context(e:Event){e.preventDefault()}function wheel(e:WheelEvent){if(!locked)return;e.preventDefault();selected=((selected-1+(e.deltaY>0?1:7))%8)+1;hooks.select(selected)}
  const resize=()=>{camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight)};
  const observer=new ResizeObserver(resize);observer.observe(host);
  document.addEventListener('pointerlockchange',onLock);document.addEventListener('mousemove',onMouse);document.addEventListener('mouseup',mouseUp);document.addEventListener('keydown',onKey);document.addEventListener('keyup',onUp);window.addEventListener('blur',blur);renderer.domElement.addEventListener('mousedown',down);renderer.domElement.addEventListener('contextmenu',context);renderer.domElement.addEventListener('wheel',wheel,{passive:false});
  function tick(now:number){if(dead)return;const dt=Math.min((now-last)/1000,.05);last=now;
    if(active){if(locked){const f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),s=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);const speed=(keys.has('ShiftLeft')?8:4.8)*(flying?1.5:1);const norm=Math.max(1,Math.hypot(f,s));const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)/norm*speed,dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)/norm*speed;
      if(!flying&&grounded&&keys.has('Space')){vy=8.3;grounded=false}
      for(let step=0;step<5;step++){const delta=dt/5;const oldX=body.x;body.x+=dx*delta;if(collision(body))body.x=oldX;const oldZ=body.z;body.z+=dz*delta;if(collision(body))body.z=oldZ;
        if(flying)vy=((keys.has('Space')?1:0)-(keys.has('ControlLeft')||keys.has('KeyQ')?1:0))*6;else vy-=23*delta;
        const oldY=body.y;body.y=Math.min(35,body.y+vy*delta);if(collision(body)){if(vy<0)grounded=true;body.y=oldY;vy=0}else grounded=false;
      }
    }camera.position.copy(body);camera.position.y+=1.6;camera.rotation.set(pitch,yaw,0);camera.updateMatrixWorld();aim();
    }else{const t=now*.000025;camera.position.set(24+Math.cos(t)*48,32,24+Math.sin(t)*48);camera.lookAt(24,4,24)}
    for(const p of peers.values()){p.group.position.lerp(p.target,1-Math.exp(-dt*10));p.group.rotation.y=p.yaw}
    if(active&&now-statsTime>180){statsTime=now;hooks.stats({x:body.x,y:body.y,z:body.z,flying,target:target?BLOCKS[(world.get(key(target.x,target.y,target.z))||1)-1].name:''})}
    renderer.render(scene,camera);frame=requestAnimationFrame(tick);
  }frame=requestAnimationFrame(tick);
  return {apply,updatePeers,position:()=>({x:body.x,y:body.y,z:body.z,yaw}),select:(n:number)=>{selected=n},start:()=>{active=true;respawn();yaw=-.7;pitch=-.12},lock:async()=>{try{await renderer.domElement.requestPointerLock();dragMode=false;hooks.dragMode(false)}catch{dragMode=true;locked=true;keys.clear();hooks.dragMode(true);hooks.lock(true)}},destroy:()=>{dead=true;cancelAnimationFrame(frame);if(locked)document.exitPointerLock();observer.disconnect();document.removeEventListener('pointerlockchange',onLock);document.removeEventListener('mousemove',onMouse);document.removeEventListener('mouseup',mouseUp);document.removeEventListener('keydown',onKey);document.removeEventListener('keyup',onUp);window.removeEventListener('blur',blur);renderer.domElement.removeEventListener('mousedown',down);renderer.domElement.removeEventListener('contextmenu',context);renderer.domElement.removeEventListener('wheel',wheel);for(const p of peers.values())disposeGroup(p.group);scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();const m=Array.isArray(o.material)?o.material:[o.material];m.forEach(v=>v.dispose())}});texture.dispose();renderer.dispose();renderer.domElement.remove()}};
}
