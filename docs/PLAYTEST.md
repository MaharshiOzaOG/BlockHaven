# Your survival playtest checklist

No checks below have been run by the coding agent. Start with two desktop browsers/devices on different internet connections, then add friends gradually.

## First connection and isolation
- Create a new world on the deployed HTTPS address. Join from a second device using its invite link.
- Confirm both players appear and move without excessive correction. Check FPS and latency in the HUD.
- Open a different room. Blocks, players, crops, damage and meteor events must not leak across rooms.
- Join from the original browser after leaving: inventory/tools should return. Another device should be a new identity.
- Open the same saved identity in a second tab: the first should stop with a clear message.

## Gathering, progression and building
- Leave the protected camp. Hold left mouse on grass, wood and leaves; compare break times.
- Stone should require a wooden pickaxe; iron/graphite a stone pickaxe; diamond an iron pickaxe; star crystal a diamond pickaxe.
- Release the button or look away during mining: it should stop without giving a block.
- Have both players mine the same block: only one should receive the drop.
- Craft tools from the inventory; confirm materials are deducted once and missing materials disable recipes.
- Select an owned block in the inventory, equip slot 9, and right click a face to place it.
- Confirm placement costs one block, respects reach, and cannot trap another player or build inside camp.
- Walk across chunk boundaries, including edited chunk edges. Look for holes, stale faces and collision problems.
- Try the view-distance options and pointer-lock fallback (drag to look, hold B to mine).

## Health, PvP and respawning
- PvP starts off. Weapons should not damage anyone until the host enables it.
- Craft a sword and blaster, plus ammunition. Confirm shot costs, cooldowns and range limits.
- Place a wall between players; shots should stop at terrain.
- Damage should appear in the victim's HUD and above their avatar.
- Reach zero health: movement/mining/crafting/attacking must stop, with a 3-second respawn delay.
- Respawn at camp with full health, retained inventory and 5 seconds of protection.
- Return-to-camp should not heal and should have a 60-second cooldown.
- Confirm falling from a sufficient height causes damage outside camp.

## Farming and healing
- Craft a hoe; till exposed grass/earth, plant seeds, and watch all growth stages from both devices.
- Crops should require open sky; attempts to build directly over planted crops should be rejected.
- Harvest after 90 seconds: receive 2 fruit and 2 seeds. Early harvesting should not consume/remove the crop.
- Have both players harvest the same crop: only one reward.
- Eat fruit while hurt: +25 HP, capped at 100, one fruit spent, 2-second cooldown.
- Full-health eating should not consume food.
- Leave the room empty while crops grow, then return and harvest.

## Shared danger mode
- Only the host should be able to switch danger mode and PvP.
- Leave camp and enable meteors. Compare the warning ring, falling rock and impact timing on both screens.
- Stand at different distances from the impact to check damage falloff, then shelter under solid terrain.
- Confirm camp stays safe and meteors do not destroy builds.
- Disable danger mode during a warning: the pending meteor should be cancelled for everyone.
- Disconnect/reconnect during a warning while another player stays online: the returning player should see the current meteor, not spawn a duplicate.
- Empty the room and return: pending old meteors should not instantly damage arriving players.

## Reliability and performance
- Interrupt one device's connection: actions should freeze; reconnect should restore the server snapshot without duplicate items or attacks.
- Leave the host offline for over a minute and claim host from the menu.
- Close all players, reopen the room, and verify saved blocks/tools/health/crops/settings.
- Menus do not pause the shared world. Confirm another player and meteors continue while a menu is open.
- Add up to 4 friends for the initial performance check. Record device, browser, FPS, latency and whether video/background applications were running.
- If movement stutters, compare network latency with FPS: reducing view distance helps rendering, not a slow network.
- The configured cap is 8 concurrent players; that is a guardrail, not a benchmarked performance guarantee.

Record any issue with room code, approximate time, browser, expected/actual behavior, and reproduction steps. Do not include session tokens.
