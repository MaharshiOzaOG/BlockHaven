export const SIZE = 48;
export const BLOCKS = [
  {name:'Grass',color:'#80ab59'}, {name:'Earth',color:'#9d7454'}, {name:'Stone',color:'#9ca8ad'},
  {name:'Timber',color:'#b28855'}, {name:'Leaves',color:'#507f50'}, {name:'Sand',color:'#e2cb8e'},
  {name:'Brick',color:'#bd7861'}, {name:'Slate',color:'#596b7a'},
];
export const key = (x:number,y:number,z:number) => `${x},${y},${z}`;
export function height(x:number,z:number) {
  return Math.max(2,Math.floor(4 + Math.sin(x*.17)*1.8 + Math.cos(z*.19)*1.5 + Math.sin((x+z)*.12)));
}
export function generateWorld() {
  const map = new Map<string,number>();
  for(let x=0;x<SIZE;x++) for(let z=0;z<SIZE;z++) {
    const h=height(x,z);
    for(let y=0;y<=h;y++) map.set(key(x,y,z), y===h?(h<=3?6:1):y>h-3?2:3);
  }
  for(const [x,z] of [[8,9],[14,29],[30,8],[35,25],[9,38],[39,38],[25,35],[20,11]]) {
    const h=height(x,z);
    for(let y=h+1;y<h+5;y++) map.set(key(x,y,z),4);
    for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++) for(let dy=3;dy<=5;dy++)
      if(Math.abs(dx)+Math.abs(dz)<4 && !(dy===5 && Math.abs(dx)+Math.abs(dz)>2)) map.set(key(x+dx,h+dy,z+dz),5);
  }
  return map;
}
