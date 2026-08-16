# Bastion — Medieval Town-Defense Auto-Battler

A mobile-first game that fuses city builder + tower defense + auto-battler into
one system: the town you build IS your economy, your army's origin, and the
battlefield enemies attack.

Full design document: [`SUPERPROMPT.md`](./SUPERPROMPT.md)

## Current state: playable vertical slice

You vs 3 bot jarls, 8 rounds. Build with a 15-card always-available deck
(gold-gated, Age II cards locked behind a Keep upgrade), assign units between
town defense and your FRONT/MID/BACK raiding warband, pick doctrines, then
watch the auto-battle. Round 3 is a PvE goblin raid; round 4 offers a district
expansion. Keep HP persists between rounds — lose it all and you're out.

## Run it

```bash
npm install
npm run dev        # dev server
npm run build      # production build to dist/
npm run headless   # full 4-bot match in the terminal (sim smoke test)
node scripts/singlefile.mjs   # bundle dist/ into one self-contained HTML
```

## Architecture

- `src/sim/` — pure deterministic simulation (seeded RNG, fixed 100ms ticks,
  command-queue API). No rendering imports. Runs headless.
- `src/render/` — Three.js low-poly diorama view of sim state.
- `src/ui/` — DOM overlay: build bar, warband panel, doctrines, HUD.
- `scripts/headless.ts` — full-match test; must always pass.

Bots issue the same commands as the player — no cheating. All combat resolves
from the seeded RNG stream so a match replays identically from its seed
(networking-ready for the future multiplayer version).
