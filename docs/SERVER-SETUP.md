# Hosting and handoff

This upgrade is deliberately **not deployed or gameplay-tested**. The old live game remains separate.

## Supported deployment target

Use your own Cloudflare account with Workers and SQLite Durable Objects enabled. The frontend and room server are one Worker; no separate database service or communication service is required. Account plan limits and usage billing still apply. This repository does not currently include a generic Node/VPS adapter.

1. Download the source ZIP, or clone the branch: `git clone --branch survival-foundation https://github.com/MaharshiOzaOG/BlockHaven.git`.
2. Install Node >=22.13 and pnpm 11.25.0 if missing. Run `pnpm install`.
3. Run `pnpm exec wrangler login` in your terminal and choose your account.
4. If needed, change the Worker `name` in `vite.config.ts` before building. Choose a new name to avoid replacing any unrelated Worker.
5. Run `pnpm build`.
6. Run `pnpm run deploy:cloudflare`. The script verifies the built room export and binding, then invokes Wrangler. It does not run gameplay tests.
7. Open the HTTPS address printed by Wrangler in Chrome/Edge/Firefox. Create a **new** survival room and share its invite link.

The built `dist/server/wrangler.json` includes:
- `main: index.js` and `assets.directory: ../client`;
- `ROOMS → GameRoom` Durable Object binding;
- `survival-v1` migration with `new_sqlite_classes: [GameRoom]`;
- `nodejs_compat` and the project's compatibility date.

Keep the migration tag stable on later deployments. Do not delete or rename the class or namespace if you want to preserve worlds.

## Local preparation

`pnpm dev` starts the local development server and emulates the room storage. For a production build locally, run `pnpm build`, then `pnpm start`. Local and online worlds are separate. A friend's device cannot reach your `localhost`; use the deployed HTTPS URL for internet play.

The game requires WebSocket upgrades on `/api/room/<code>`. A static host cannot run this backend. Additional reverse proxies must preserve these upgrades and the Origin header.

## Saved data

SQLite tables are created by the room constructor. No destructive D1 migration is run. Room metadata/player state is held in `state`; the latest change for each edited voxel is held in `blocks`. Do not delete `.wrangler/` if you want to keep local development worlds.

Inventories are restored by browser-local token, not by player name. Do not share tokens, export browser storage publicly, or put tokens in URLs. Only room codes are intended to be shared.

This is an invite-link prototype, not a private authenticated service: anyone with the room link can join. Large public launches would need room access controls, creation rate limits, quotas, monitoring and stronger movement authority.

## Validation performed by the coding agent

- TypeScript compilation.
- Production bundle compilation and inspection of the generated Worker binding/export.

No preview server, browser play session, multiplayer integration test, cloud deployment, load test or cross-network call was run. The source should be treated as awaiting your playtest, not as proven lag-free.

## Rollback

Deploy this under a **separate Worker name** from the original game. To roll back this new Worker after trying it, redeploy a known working source revision; do not delete the Durable Object namespace. The old Sites creative game and D1 saves are unaffected by this upgrade.
