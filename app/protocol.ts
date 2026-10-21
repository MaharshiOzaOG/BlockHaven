import type { Crop, Edit, Equipment, Inventory, Meteor, Pose, Vec } from './world';
export type Session = { room: string; id: string; token: string };
export type Peer = Pose & { id: string; name: string; hp: number; item: Equipment; protectedUntil: number };
export type Self = Peer & { inventory: Inventory; pickTier: number; tools: string[]; deadAt: number; cause: string; seq: number };
export type RoomInfo = { host: string; danger: boolean; pvp: boolean; nextMeteor: number };
export type Command =
  | { action: 'move'; pose: Pose }
  | { action: 'equip'; item: Equipment; block: number }
  | { action: 'mine'; target: Vec }
  | { action: 'cancelMine' | 'use' | 'attack' | 'respawn' | 'rescue' | 'claimHost' }
  | { action: 'craft'; recipe: string }
  | { action: 'settings'; danger: boolean; pvp: boolean };
export type ClientMessage = { kind: 'auth'; token: string } | { kind: 'command'; seq: number; command: Command } | { kind: 'ping'; at: number };
export type ServerMessage =
  | { kind: 'welcome'; version: number; self: Self; edits: Edit[]; crops: Crop[]; meteors: Meteor[]; room: RoomInfo; now: number }
  | { kind: 'state'; self: Self; players: Peer[]; room: RoomInfo; now: number }
  | { kind: 'edits'; edits: Edit[] }
  | { kind: 'crops'; crops: Crop[] }
  | { kind: 'meteors'; meteors: Meteor[]; now: number }
  | { kind: 'mining'; target: Vec; start: number; end: number }
  | { kind: 'miningStopped' }
  | { kind: 'teleport'; pose: Pose }
  | { kind: 'effect'; effect: 'shot' | 'swing' | 'impact'; from: Vec; to: Vec; id: string }
  | { kind: 'notice'; text: string }
  | { kind: 'pong'; at: number; now: number };
