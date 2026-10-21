# Blockhaven · Survival 02

A small-group browser survival sandbox: **80 × 80 terrain**, timed mining, tool progression, inventory/crafting, swords and blasters, health/death/respawn, fruit and crops, and synchronized meteor storms.

**Status:** source upgrade for user testing. TypeScript and production compilation are checked; gameplay, browser performance, cross-network multiplayer, and deployment have **not** been tested. This upgrade has not been deployed to the original Sites URL.

## Start locally

Use the versions in `package.json` (Node >=22.13, pnpm 11.25.0).

```sh
pnpm install
pnpm dev
```

Open the printed local URL. Local room storage is emulated by Wrangler under `.wrangler/`. No database creation or SQL migration command is needed for Survival 02.

To compile without starting the game:

```sh
pnpm exec tsc --noEmit
pnpm build
```

## Host under your own account

This version targets **Cloudflare Workers + SQLite Durable Objects**. It is not a static GitHub Pages site, and the generated Worker is not a generic Node/VPS server.

```sh
pnpm exec wrangler login
pnpm build
pnpm run deploy:cloudflare
```

Run those commands yourself when ready to publish. The generated config names the Worker `blockhaven-survival`, includes the `ROOMS` binding and the `survival-v1` SQLite class migration, and serves the compiled game and WebSocket server on the same origin. See [server setup](docs/SERVER-SETUP.md).

The existing `.openai/hosting.json` identifies the **original** Sites project. It is retained for provenance, not used to provision this new room backend. Do not publish this build through the old Sites deployment workflow without separately confirming support for the new Durable Object binding.

## Play

1. Create a survival world. Invite friends using the room link. Maximum 8 concurrent players; start testing with 2–4.
2. Walk outside the marked camp. Hold left click on timber to gather your first materials.
3. Press **E** and craft a wooden pickaxe. Mine stone → craft a stone pickaxe → mine iron/graphite → craft an iron pickaxe → mine diamond → craft a diamond pickaxe for rare star crystals.
4. Craft weapons, a hoe, or ammunition. Select supplies in the inventory to build.
5. The room host can separately enable **player combat** and **danger mode**. Both start off.

| Input | Action |
|---|---|
| WASD / arrows | Walk |
| Space / Shift | Jump / sprint |
| Mouse | Look |
| Hold left click | Mine with hands/pick/axe; attack with equipped weapon |
| Right click / G | Use food, till soil, plant, harvest, or place equipped block |
| 1–9 / wheel | Hands, pickaxe, axe, sword, blaster, hoe, seeds, fruit, building |
| E / Tab | Inventory and crafting |
| Escape | Open menu |
| R | Return to camp; 60-second cooldown, no healing |

If the browser blocks pointer capture: **drag left mouse to look; hold B to mine or attack**. Right click / G still uses the equipped item.

## Rules

- 100 HP. Fruit heals 25 HP, with a 2-second eating cooldown.
- Sword: 25 damage, 3-block reach, 650 ms cooldown. Blaster: 18 damage, 30-block reach, 400 ms cooldown, one round per shot. Terrain blocks attacks.
- PvP must be enabled by the host. Camp is protected from mining, building and damage.
- Death stops movement/actions. Respawn after 3 seconds at camp with full health and 5 seconds of protection. **Inventory and permanent tools are kept.**
- Tools do not wear out in this first survival release. Pickaxes require the previous tier.
- No creative flight or unlimited blocks. Mine or craft blocks before placing them.
- Leaves can drop fruit/seeds. New players receive 3 fruit and 4 seeds.
- Hoe exposed grass/earth, plant under open sky, wait 90 seconds, right click to harvest 2 fruit + 2 seeds. Up to 128 crops per room. Crops mature using saved timestamps, including while the room is empty.
- Danger mode announces a meteor every 10–15 seconds near an exposed player, followed by a 4-second visible warning. Impact damage decreases with distance (up to 45); terrain can shield players. Meteors **do not destroy builds**.
- The same server-issued meteor coordinates, radius and timestamps drive every player's animation. Health changes happen only on the server.
- Inventory stacks cap at 999. A room retains up to 64 saved player identities. Long-disconnected non-host identities may be evicted when that limit is reached.

## Persistence and connectivity

Block changes, crops, tools, inventories, health and room settings are stored by one Durable Object per room. Position checkpoints occur every 5 seconds; discrete gameplay mutations are saved immediately. Empty rooms stop simulation and cancel pending meteors.

A browser-local session token restores your inventory when you join the same room again. There are no accounts. Clearing browser storage loses that identity; using another device creates a new player. Opening the same identity in another tab disconnects the first tab. The token is sent in the first WebSocket message, never in the invite URL.

The client reconnects with a fresh world snapshot. Offline actions are paused and are never queued/replayed. A host can be replaced through the menu after being offline for a minute.

## Performance and limits

- 16 × 16 terrain chunks; only edited chunks and edge neighbors are rebuilt.
- At most two chunk meshes rebuilt per animation frame; adjustable 40/64/80-block view distance and capped pixel ratio.
- Real-time room updates at 10 Hz; interpolated remote avatars.
- Capped players, crops and transient effects. Crop growth is timestamp based; meteor blasts do not trigger terrain rebuilding.
- Room data is persistent, but movement uses client prediction plus server bounds, speed, swept-collision and reach checks. This is **friends-only prototype protection, not competitive anti-cheat**.
- Active room timers can incur Durable Object duration charges. No performance or cost figures have been measured.
- No audio/video/text communication in this release.

## Existing creative worlds

The original 48 × 48 game used D1 and a different terrain version. Survival 02 uses a separate Worker and room store. **Old room codes and builds are not automatically imported**, and old D1 data is not deleted or changed. Keep the original deployment available for those worlds. A data migration would be a separate change.

See [your manual testing checklist](docs/PLAYTEST.md) before inviting a larger group. The old `scripts/test-multiplayer.mjs` targets the retired creative HTTP protocol and must not be used to validate this release.

## Source map

- `app/world.ts`: deterministic terrain, block hardness, recipes, shared collision/ray traversal
- `app/engine.ts`: chunk meshes, movement, tools, players, crop/meteor visuals
- `app/game-ui.tsx`: lobby, HUD, inventory, crafting, room settings and death screen
- `app/connection.ts`, `app/protocol.ts`: WebSocket reconnect and shared message types
- `server/room.ts`: authoritative room simulation and SQLite persistence
- `server/gateway.ts`, `build/sites-worker.ts`: same-origin routing and room connections
- `vite.config.ts`: Worker name, Durable Object binding and migration
