import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', { code: text('code').primaryKey(), created: integer('created').notNull() });
export const players = sqliteTable('players', {
  token: text('token').primaryKey(), id: text('id').notNull(), room: text('room').notNull(), name: text('name').notNull(),
  x: real('x').notNull(), y: real('y').notNull(), z: real('z').notNull(), yaw: real('yaw').notNull(), seen: integer('seen').notNull(),
}, t => [index('players_room_seen').on(t.room,t.seen)]);
export const edits = sqliteTable('edits', {
  id: integer('id').primaryKey({autoIncrement:true}), room: text('room').notNull(), x: integer('x').notNull(), y: integer('y').notNull(), z: integer('z').notNull(), type: integer('type').notNull(),
}, t => [index('edits_room_id').on(t.room,t.id)]);
