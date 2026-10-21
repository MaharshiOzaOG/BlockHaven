// Shared deterministic terrain, progression, and voxel physics.
export const WORLD_VERSION = 2;
export const SIZE = 80;
export const MAX_Y = 31;
export const CHUNK = 16;
export const CROP_MS = 90_000;
export const MAX_PLAYERS = 8;
export const BLOCKS = [
  { name: 'Grass', color: '#80ab59', seconds: .45, tier: 0, tool: 'hand' },
  { name: 'Earth', color: '#9d7454', seconds: .7, tier: 0, tool: 'hand' },
  { name: 'Stone', color: '#9ca8ad', seconds: 3, tier: 1, tool: 'pick' },
  { name: 'Timber', color: '#b28855', seconds: 2.4, tier: 0, tool: 'axe' },
  { name: 'Leaves', color: '#507f50', seconds: .35, tier: 0, tool: 'hand' },
  { name: 'Sand', color: '#e2cb8e', seconds: .55, tier: 0, tool: 'hand' },
  { name: 'Brick', color: '#bd7861', seconds: 3, tier: 1, tool: 'pick' },
  { name: 'Slate', color: '#596b7a', seconds: 4, tier: 1, tool: 'pick' },
  { name: 'Iron', color: '#b19483', seconds: 5, tier: 2, tool: 'pick' },
  { name: 'Diamond', color: '#60d5cf', seconds: 8, tier: 3, tool: 'pick' },
  { name: 'Graphite', color: '#424958', seconds: 5.5, tier: 2, tool: 'pick' },
  { name: 'Star crystal', color: '#ad8ee5', seconds: 11, tier: 4, tool: 'pick' },
  { name: 'Farmland', color: '#755238', seconds: .7, tier: 0, tool: 'hand' },
] as const;
export type Vec = { x: number; y: number; z: number };
export type Pose = Vec & { yaw: number; pitch: number };
export type Edit = Vec & { type: number };
export type Crop = Vec & { planted: number };
export type Meteor = Vec & { id: string; start: number; impact: number; radius: number };
export type Inventory = Record<string, number>;
export type Equipment = 'hand' | 'pick' | 'axe' | 'sword' | 'gun' | 'hoe' | 'seed' | 'fruit' | 'block';
export const SLOTS: { item: Equipment; label: string; icon: string }[] = [
  { item: 'hand', label: 'Hands', icon: '✋' }, { item: 'pick', label: 'Pickaxe', icon: '⛏' },
  { item: 'axe', label: 'Axe', icon: '🪓' }, { item: 'sword', label: 'Sword', icon: '⚔' },
  { item: 'gun', label: 'Blaster', icon: '⌖' }, { item: 'hoe', label: 'Hoe', icon: '⚒' },
  { item: 'seed', label: 'Seeds', icon: '🌱' }, { item: 'fruit', label: 'Fruit', icon: '🍎' },
  { item: 'block', label: 'Build', icon: '▧' },
];
export const PICK_NAMES = ['No pickaxe', 'Wooden pickaxe', 'Stone pickaxe', 'Iron pickaxe', 'Diamond pickaxe'];
export type Recipe = { id: string; name: string; cost: Inventory; gives?: Inventory; tier?: number; tool?: string; requires?: number };
export const RECIPES: Recipe[] = [
  { id: 'woodPick', name: 'Wooden pickaxe', cost: { b4: 3 }, tier: 1 },
  { id: 'stonePick', name: 'Stone pickaxe', cost: { b4: 2, b3: 6 }, tier: 2, requires: 1 },
  { id: 'ironPick', name: 'Iron pickaxe', cost: { b4: 2, b9: 5 }, tier: 3, requires: 2 },
  { id: 'diamondPick', name: 'Diamond pickaxe', cost: { b9: 3, b10: 3 }, tier: 4, requires: 3 },
  { id: 'axe', name: 'Axe · faster woodcutting', cost: { b4: 3, b3: 3 }, tool: 'axe' },
  { id: 'hoe', name: 'Hoe · prepare farmland', cost: { b4: 2, b3: 2 }, tool: 'hoe' },
  { id: 'sword', name: 'Sword · 25 damage', cost: { b4: 2, b9: 3 }, tool: 'sword' },
  { id: 'gun', name: 'Blaster · 18 damage', cost: { b4: 4, b9: 8, b11: 4 }, tool: 'gun' },
  { id: 'ammo', name: '12 blaster rounds', cost: { b3: 2, b11: 1 }, gives: { ammo: 12 } },
  { id: 'brick', name: '4 brick blocks', cost: { b3: 2, b2: 2 }, gives: { b7: 4 } },
  { id: 'seeds', name: '2 seeds from fruit', cost: { fruit: 1 }, gives: { seed: 2 } },
];
export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const blockItem = (type: number) => `b${type}`;
export function itemName(id: string) {
  return id.startsWith('b') ? BLOCKS[Number(id.slice(1)) - 1]?.name ?? id : ({ fruit: 'Fruit', seed: 'Seeds', ammo: 'Ammo' }[id] ?? id);
}
export function hash(x: number, y: number, z: number) {
  let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + 23, 668265263) ^ Math.imul(z + 41, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function height(x: number, z: number) {
  return Math.max(6, Math.floor(9 + Math.sin(x * .17) * 1.8 + Math.cos(z * .19) * 1.5 + Math.sin((x + z) * .12)));
}
export const SPAWN = { x: 40.5, y: height(40, 40) + 1.02, z: 40.5 };
export const sanctuary = (x: number, z: number) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4;
export function generateWorld() {
  const map = new Map<string, number>();
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) {
    const h = height(x, z);
    for (let y = 0; y <= h; y++) {
      let type = y === h ? (h <= 6 ? 6 : 1) : y > h - 3 ? 2 : 3;
      if (y > 0 && y <= h - 3) {
        const r = hash(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2));
        type = y < 4 && r < .018 ? 10 : y < 3 && r > .993 ? 12 : r < .12 ? 9 : r < .19 ? 11 : r > .92 ? 8 : 3;
      }
      map.set(key(x, y, z), type);
    }
  }
  for (let x = 5; x < SIZE - 4; x += 7) for (let z = 5; z < SIZE - 4; z += 7) {
    if (hash(x, 19, z) < .28 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8) continue;
    const h = height(x, z);
    for (let y = h + 1; y < h + 5; y++) map.set(key(x, y, z), 4);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++)
      if (Math.abs(dx) + Math.abs(dz) < 4 && !(dy === 5 && Math.abs(dx) + Math.abs(dz) > 2) && (dx || dz || dy >= 4))
        map.set(key(x + dx, h + dy, z + dz), 5);
  }
  return map;
}
export function miningMs(type: number, item: Equipment, tier: number) {
  const b = BLOCKS[type - 1];
  if (!b || (b.tier > 0 && (item !== 'pick' || tier < b.tier))) return Infinity;
  const speed = item === 'pick' && b.tool === 'pick' ? [1, 1, 1.6, 2.3, 3.2][tier] : item === 'axe' && b.tool === 'axe' ? 3 : 1;
  return b.seconds * 1000 / speed;
}
export function direction(p: Pose): Vec {
  return { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: -Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
}
// Exact voxel traversal is shared so mining and weapon occlusion agree.
export function raycast(world: Map<string, number>, origin: Vec, dir: Vec, range: number) {
  const cell = [Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z)];
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  const step = d.map(v => v >= 0 ? 1 : -1), delta = d.map(v => v === 0 ? Infinity : Math.abs(1 / v));
  const t = d.map((v, i) => v === 0 ? Infinity : (cell[i] + (v > 0 ? 1 : 0) - o[i]) / v);
  let distance = 0, normal = [0, 0, 0];
  while (distance <= range) {
    const type = world.get(key(cell[0], cell[1], cell[2]));
    if (type) return { x: cell[0], y: cell[1], z: cell[2], nx: normal[0], ny: normal[1], nz: normal[2], type, distance };
    const axis = t[0] < t[1] ? (t[0] < t[2] ? 0 : 2) : (t[1] < t[2] ? 1 : 2);
    distance = t[axis]; t[axis] += delta[axis]; cell[axis] += step[axis];
    normal = [0, 0, 0]; normal[axis] = -step[axis];
  }
  return null;
}
export function collides(world: Map<string, number>, p: Vec) {
  if (p.x < .3 || p.z < .3 || p.x > SIZE - .3 || p.z > SIZE - .3 || p.y < 1 || p.y > MAX_Y + 2) return true;
  for (let x = Math.floor(p.x - .28); x <= Math.floor(p.x + .28); x++)
    for (let y = Math.floor(p.y + .01); y <= Math.floor(p.y + 1.69); y++)
      for (let z = Math.floor(p.z - .28); z <= Math.floor(p.z + .28); z++) if (world.has(key(x, y, z))) return true;
  return false;
}
