# Blockhaven

An original multiplayer voxel-building game for desktop browsers. Explore a small island, break and place blocks, fly, and build with friends in shared rooms.

**Play:** https://blockhaven-play-mahar.frostyash17.chatgpt.site

## Features

- First-person movement, jumping, collision and creative flight
- Eight unlimited building materials and procedural terrain/textures
- Shared room codes and invite links
- Visible player avatars and persistent block changes
- Drag-to-look fallback when embedded browsers disallow mouse capture

This is a first playable creative sandbox. It does not include survival, crafting, enemies, or an infinite world. Multiplayer uses short HTTP polling and is designed for small groups.

## Controls

| Input | Action |
|---|---|
| WASD / arrow keys | Move |
| Mouse | Look |
| Left / right click | Break / place a block |
| 1–8 / mouse wheel | Select material |
| Space | Jump / fly upward |
| F | Toggle flight |
| Q / left Ctrl | Fly downward |
| Left Shift | Move faster |
| R | Return to spawn |
| Escape | Open menu |

## Local development

Requirements: Node.js 22.13 or newer, pnpm 11.25.0.

```sh
pnpm install
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_keen_living_tribunal.sql
pnpm dev
```

Run the SQL migration once per new local database. Open the local URL printed by the development server. Local and hosted databases are separate.

```sh
pnpm exec tsc --noEmit
node scripts/test-multiplayer.mjs http://127.0.0.1:5173
```

The multiplayer integration test creates test rooms and verifies presence, shared edits, room isolation, incremental synchronization, input validation, and saved-world rejoining.

## Architecture

- `app/engine.ts`: Three.js rendering, voxel meshing, movement and interaction
- `app/world.ts`: procedural world and block definitions
- `app/game-ui.tsx`: lobby, controls and synchronization client
- `app/api/world/route.ts`: room and multiplayer API
- `db/schema.ts` and `drizzle/`: Cloudflare D1 schema and migrations
- `build/` and `scripts/`: Vinext / Sites build infrastructure

The deployed version uses Cloudflare Workers and D1 through Sites. `.openai/hosting.json` identifies the existing Site; it is not a credential. Hosting under your own Cloudflare account requires your own Worker and D1 deployment configuration. GitHub stores the source; it does not automatically host the multiplayer server.

Dependencies, generated builds, live world data, session credentials and temporary publishing files are excluded from this repository. Existing dependency license notices are retained. See [starter development notes](docs/STARTER-DEVELOPMENT.md) for the underlying build tooling.
