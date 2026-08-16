# SUPER-PROMPT: "Bastion" — Medieval Town-Building Auto-Battler

> Feed this entire document to Claude Code as the build instruction. It describes the **full product** in detail, then instructs the agent to implement a **vertical slice first**. Everything in here was decided deliberately — do not re-litigate decisions, do not add systems that aren't here, and when in doubt, simplify.

---

## 0. Your Role and Mission

You are the lead engineer building a multiplayer medieval-fantasy game that fuses three genres into one system:

- **City builder**: you physically construct a town on a board.
- **Tower defense**: that town IS the defense map enemies attack.
- **Auto-battler**: rounds, synergies, and hands-off combat where your build fights for you.

These are not three glued-together systems. They are **one system viewed from three directions**: the town is simultaneously your economy, your army's origin, and your defensive board.

**The one-sentence pitch:** *"You aren't buying an army — you're building the civilization that produces your army."*

**The core interaction law (never violate this):** Every mechanic must be expressible as *"drop one thing onto another thing."* Upgrade a tower → drop upgrade onto tower. Recruit a soldier → drop soldier into town. Assign a commander → drop commander onto barracks. If a design requires "open panel → select tab → configure options," it is wrong — redesign it as a drag-and-drop.

---

## 1. Technology Decisions (already made — implement, don't debate)

- **Stack:** TypeScript, Three.js for the 3D scene, Vite for tooling. Plain web app, no framework required for the game itself (a thin UI layer in DOM/CSS overlaid on the canvas is fine and preferred over in-canvas UI).
- **Why browser:** fastest iteration loop for an AI coding agent, runs on any device for playtesting, and the target is mobile-first cross-platform (PC/tablet too) — a browser prototype ports forward cleanly (Capacitor/wrapper later; do NOT set that up now).
- **Simulation must be deterministic:** all combat and economy resolution runs from a seeded RNG in a pure simulation module with zero rendering dependencies. This is non-negotiable — it's what makes future networking (lockstep or server-authoritative replay) possible without a rewrite. Structure: `sim/` (pure logic, testable headless) and `render/` (Three.js view of sim state) and `ui/` (DOM overlay). The sim advances in fixed ticks (e.g. 10/sec); the renderer interpolates.
- **Data-driven content:** every card, trait, unit, and building lives in JSON/TS data files, not hardcoded in logic. Adding a card must never require touching combat code.
- **Multiplayer architecture-readiness, not multiplayer:** the vertical slice is local, single-player vs bots. But player actions must flow through a command queue (`PlaceCard`, `SellBuilding`, `BuyCard`, `SetDoctrine`, …) applied to sim state, so a network layer can later feed the same queue. No networking code in the slice.
- **Input:** mouse + touch from day one. Drag-and-drop is the primary verb; everything must work with one finger.
- **Orientation:** responsive — supports both landscape and portrait. Landscape is the design target; portrait must at minimum not break.

---

## 2. Match Overview (full product)

- **8 players** per match, each building their own town. **Match length target: 10–15 minutes.**
- **Explicit rounds:** `Build Phase → Combat Phase → Rewards → repeat`. Given the short match target: Build ≈ 45–60s, Combat ≈ 45s hard cap, Results ≈ 8s. Roughly 8–11 rounds per match.
- **Every combat round you attack AND defend simultaneously.** Pairings are generated each round (rotating, no repeat-matchup back-to-back where avoidable). Your warband raids one opponent's town while a different opponent's warband attacks yours. You **choose which battle to spectate** (a picture-in-picture thumbnail shows the other; you can swap anytime). Both resolve deterministically regardless of being watched.
- **No targeting other players by choice** — matchmaking assigns pairings to prevent dogpiling.
- **Player health = Keep HP.** Your central Keep has match-level HP. Attackers win a defensive battle outright by **destroying the defender's Keep** in-round. Keep damage **persists across rounds** (this is the elimination clock); ordinary town buildings visually break during combat but are **auto-repaired between rounds by visible builder crews** — mechanically an auto-reset, presented diegetically. At 0 Keep HP you are eliminated; last player standing wins, with placement (1st–8th) recorded for ranked.
  - If a combat timer expires without the Keep falling, the attacker deals partial Keep damage proportional to what they accomplished (structures destroyed, defenders killed, breach progress). Exact formula lives in one tunable function.
- **Troops never permanently die** in PvP — casualties return next round. (Named PvE-captured units too.)
- **Some rounds are PvE:** scheduled monster rounds replace one PvP pairing wave for everyone simultaneously (same seed = fair): e.g. Round 3 Goblin Raid, mid-game Undead Night, late-game Dragon Round. Beating a monster round can award loot cards, and defeating certain monsters offers them as **recruitable cards** (e.g. `Captured Troll — Monster • Brute`).

### Ages

Matches progress through Ages that gate card tiers and escalate spectacle: **Age I Settlement → Age II Township → Age III Stronghold → Age IV Realm.**

- Age advancement is **player-paced, TFT-style**: you spend gold to upgrade your **Keep**, and the Keep's level IS your Age. Greedy players stay low-Age for economy; aggressive players race Ages for stronger units.
- **The Keep is the universal central anchor and objective**, occupies a fixed central footprint, is upgradeable, and — at Age II — the upgrade forks into a **Keep specialization that defines your tech path**: e.g. `Great Hall` (Nord/martial path), `Citadel` (Imperial/defense-economy path), `Arcane Spire` (Mage path). Specialization adds a small set of path-exclusive cards to your build bar (bonus slots on top of your 14-card deck) and gives one passive. Any build remains possible — specialization nudges, never locks.
- Late game must feel dramatically transformed: Round 1 is five cottages and a picket fence vs. 5 bandits; the final rounds are a walled stone town with trebuchets, battlemages, flying units, and 50+ troops per side. Protect this escalation.

---

## 3. The Board and Town Building

- **Square grid.** Start ≈ 16 buildable plots (4×4 core around the Keep footprint plus road edges); end ≈ 40–50 plots after expansions.
- **Terrain:** competitive-balanced **templates with cosmetic variation** — every player in a match gets an equivalent layout (same plot counts, same road structure), skinned differently (stream here, pines there). No gameplay-random terrain.
- **Entrances:** towns begin with **two road entrances (South Road + East Road)**. Enemies arrive via entrances. Attacks can come from different sides — the board is not oriented toward a single lane.
- **Expansion — District choice:** when your population/economy crosses thresholds (roughly twice per match), you choose **1 of 3 District Expansions**, each appending a chunk of plots with a tradeoff, e.g.:
  - `FARMLANDS` — +6 plots, farm-type buildings +20% output.
  - `HIGHLANDS` — +5 plots, towers built there +1 range (elevation).
  - `RIVERFRONT` — +7 plots, markets +1 gold/round, **adds a new bridge entrance** (more income, more perimeter to defend).
  - More entrances = better economy but harder defense. This is a core tension; preserve it.
- **Placement rules:** drop a card on a legal plot; illegal plots grey out while dragging. **Selling is allowed** (partial refund). **Moving a building costs gold** (small fee, build phase only). No free rearranging.
- **Buildings physically block movement**, and enemies can attack/destroy blocking buildings to carve a path. **No deliberate mazing as a strategy:** roads and gates determine the main approaches; pathfinding treats roads as strongly preferred (fast) but not mandatory — units will leave roads when it's clearly better, and will chew through blockers rather than pathing absurdly. Extreme maze layouts should be economically self-punishing, not hard-forbidden.
- **Defensive structures:** walls come as a `Palisade/Wall` card dropped onto a district — it automatically wraps that district's exposed edges. `Gatehouse` must sit on a road tile and auto-forms a choke. Players never draw wall segments tile-by-tile.
- **Traps are cards, permanent fixtures:** `Spike Pit`, `Oil Cauldron` (drops onto a Gatehouse), `Barricade`, `Rune Snare`, `Explosive Barrels`. They trigger during combat and re-arm next round (builder crews, again).
- **Range model:** simple radius range for ranged attackers; elevation (Highlands plots, tower height) grants +range. **No line-of-sight simulation.**

---

## 4. The Card System (the entire interface)

Cards are the ONLY way anything enters the game. Four kinds, one interaction (drag from build bar → drop on target):

1. **Structures** — dropped on empty plots: `Blacksmith`, `Archer Tower`, `Farmstead`, `Barracks`, `Market`, `Tavern`, `Temple`, `Mage Tower`, `Wall`, `Gatehouse`, `Hunting Lodge`, `Granary`…
2. **Units/Residents** — dropped into the town (they take up NO plot; they're people): `Nord Shieldbearer`, `Hunter`, `Spearman`, `Battlemage`, `Village Priest`, `Orc Mercenary`… Special residents can be dropped **onto matching buildings** to transform them (see Attachments).
3. **Improvements** — dropped onto existing structures/units: `Stone Reinforcement` → wall, `Fire Enchantment` → Archer Tower, `Masterwork Steel` → Blacksmith, `Veteran Captain` → Barracks.
4. **Spells/Events** — small category, mostly build-phase effects: `Harvest Festival` (+food burst), `Royal Decree` (+gold), `War Horns` (this round's raid +damage). Keep this category deliberately small — the game is mostly **permanent physical additions**, not spell-slinging.

**Attachments are a signature interaction:** dropping a card onto another card should feel amazing — the building visually transforms (`Blacksmith` + `Master Blacksmith` → `Masterwork Forge` with new mesh/glow), stats change, and the tooltip shows the fused identity.

**Upgrading by duplicates:** buy a second copy of a card you've already placed and drop it **onto** the existing one → it levels up (Level 1→2→3) instead of standing alone. Place-wide vs. stack-tall is a real decision every time (two Level-1 Archer Towers covering two roads, or one Level-2 covering one). Level-ups improve numbers and visuals, never add new rules text.

**Build menu — Clash Royale model (no random shop):**
- **Pre-match deckbuilding is the strategic identity:** players construct a deck of **14 cards** from their unlocked collection (tune 12–16 in playtests). The size limit is load-bearing — painful cuts at deck-build time are where build identity comes from. Matches stay fair: deckbuilding chooses *which* cards you have access to, never stat boosts.
- **In-match, your entire deck is always visible and always buyable**, gold-gated, in a compact build bar. No shop rolls, no reroll, no freeze, no hand. You may buy multiple copies of any card (each purchase costs full price; costs may escalate per copy for powerful cards — one tunable curve).
- Cards are **Age-gated**: higher-tier cards in your deck sit visibly locked (greyed with their Age badge) until your Keep reaches that Age. Seeing your locked late-game bombs is the carrot for Keep investment.
- **Where adaptation comes from (since it's not shop RNG):** the 8-player field. Your build may crush one opponent and get trounced by another — rotating pairings force you to rebalance gold spending (defense vs. warband vs. economy vs. Age race) round by round against who you're actually facing. Scouting (Section 7) is the skill that feeds this. The RNG budget lives in combat rolls, PvE rounds, district offerings, and raid loot — never in access to your own deck.

**Rarity:** Common / Rare / Epic / Legendary. Rarity = **unusualness of effect**, not raw power (`Legendary Dragon Roost` does a wild thing; it is not simply "+50% tower").

**Card readability:** each card shows at most **a few stats and one passive line**. If a card needs a paragraph, redesign the card. Health bars are shown **on everything** during combat (thin, unobtrusive, scaling with zoom).

---

## 5. Traits and Synergies

Two synergy layers, both simple:

1. **Global traits (fewer than TFT — cap at ~8 total):** every card carries up to 2 tags: `NORD`, `IMPERIAL`, `ARCANE`, `DIVINE`, `WARRIOR`, `RANGER`, `CRAFTSMAN`, `MERCHANT`. Breakpoints at 2/4/6 grant town-wide bonuses (e.g. **Nord 4:** melee units +10% damage and frost resistance). A persistent side-panel shows live counts: `NORD ●●●○ 3/4`. Buildings count toward traits too (`Mead Hall — Nord • Culture` can complete Nord 4) — buying a *building* to finish a *combat synergy* is a core dopamine moment; make the UI celebrate it.
2. **Adjacency (one important system among several, not the whole game):** specific neighbor pairs grant bonuses, shown as a glowing link when placed: `Blacksmith + Barracks` → recruits gain +1 armor; `Farm + Windmill` → +50% food; `Watchtower + Wall` → +1 range; `Temple + Graveyard` → fallen defenders 15% chance to revive per combat. Keep the pair list small (~10 pairs) and legible.

**Leaders:** before the match each player picks a **Leader** (hero) that gently nudges a build but locks nothing: `The Jarl` (defense), `Merchant Prince` (economy), `Archmage` (magic), `The Warlord` (raiding), `The Necromancer` (dead things). Leaders do **all three hero jobs**: a passive bonus, a physical presence that fights (defends your town; marches with raids if doctrine says so), and **one active ability** — the ONLY button you may press during combat (e.g. Jarl: `Rally` heals+shields near the Keep; Archmage: `Fireball` at a tapped location). One cast per combat, big cooldown feel, huge VFX.

---

## 6. Economy

Three resources, no more:

- **Gold** — the only spendable currency. Income each round = base stipend + economic buildings (Market, Mine, Trade Route) + **raid loot** (your warband's performance last round). **No interest mechanic.** Win/loss streaks may grant tiny bonuses; keep gold swings modest.
- **Population** — capacity, provided by Houses; buildings and units consume it. Citizens themselves are **mostly aesthetic + capacity**: lots of visible tiny villagers wander, work, flee during raids (this sells the fantasy) but you never manage individuals.
- **Supply (food)** — soft cap on army size, produced by Farms/Granaries/Hunting Lodges. Army over supply → units fight at a penalty (`Hungry: -15%`). Supply is a number in the top bar, not a logistics sim.

No wood/stone/iron inventories. Materials exist as **traits/flavor** (`Mine` counts as `Iron source`; `Blacksmith adjacent to Iron source` gets a bonus).

---

## 7. Combat Resolution

**Philosophy:** the player's hands come off the screen. `3…2…1…` and your machine either works or it doesn't. The ONE exception: the Leader's single active ability.

### Defense (automatic)
Defenders auto-deploy from what you built and where: archers garrison the towers/walls you placed them near, infantry hold gates, priests heal near temples, mages fire from arcane buildings, civilians flee to shelters (pure theater). **Where you dropped a unit in town is their default post.** Pre-combat you may set one **defensive doctrine**: `Hold Walls` / `Defend Keep` / `Protect Economy` / `Counterattack`.

### Offense (assembled, then automatic)
- **Military units are explicitly assigned:** during build phase, drag each unit between the **town (Defense)** and the **Warband board (Attack)**. The warband board is a simple **FRONT / MID / BACK** slot grid. Offense uses this formation only — home building positions don't affect raids.
- Generic troops come **from buildings** (`Barracks` maintains a squad of 4 Footmen, upgraded 6 — armies grow by building/upgrading, **no recruitment queues ever**); unique residents come from **unit cards**. Both kinds occupy warband slots identically.
- Units render as **visible small squads** (a Barracks squad = 4 actual little footmen marching together sharing a pooled health bar), not single chess pieces.
- Pre-raid you set one **raid doctrine**: `Breach` (walls/gates) / `Plunder` (economy buildings, +loot) / `Decapitate` (rush the Keep) / `Slaughter` (enemy troops).

### Battle AI — explicit and telegraphed
Every unit has ONE visible behavior word on its card, and it always does that: `Guard` = engages nearest enemy; `Raider` = beelines economy buildings; `Siegebreaker` = attacks walls/gates first; `Skirmisher` = kites, prefers ranged targets; `Beast` = charges the biggest cluster; `Flying` = ignores walls/blockers entirely (answered by towers and `Ballista`); `Siege` = long-range building damage (rams/catapults — both exist: siege units come from unit cards AND from buildings like `Siege Workshop` that maintain one engine like a Barracks maintains footmen). Players must be able to predict a fight by reading behavior words — no hidden AI cleverness.

**RNG level 4–5/10:** damage rolls within ±15%, crit chances, revive procs — spice, never swings that invalidate a build. All rolls from the seeded stream.

**Scouting must be earned — and it is THE adaptation mechanism:** with no shop RNG, out-adapting the field is the core skill, and information is its fuel. By default you see only your next attacker's name/leader/Age. Cards/buildings unlock more: `Watchtower` reveals their trait counts; `Spy` (unit) lets you view their full town for one build phase; `Raven Roost` reveals their doctrine. Information is a build lane, not a freebie — a player who invests in scouting is buying the ability to counter-build.

---

## 8. Presentation

- **Camera:** rotatable 3D town — orbit (drag on empty space / two-finger), zoom, one polished default angle it eases back toward. The town should look like a **premium miniature fantasy diorama**: stylized-but-detailed, warm, readable. Inspiration: Skyrim/Oblivion's grounded material world (weathered stone, timber framing, pines) **filtered through our own identity** — grounded silhouettes, painterly textures, nothing WoW-oversized. Fantasy level ≈ Skyrim (5–6/10): magic and monsters are real but the world reads plausibly medieval.
- **Auto-beautification (essential):** decorative clutter (wells, carts, laundry lines, chickens, market stalls) auto-generates around placed buildings — decoration never occupies gameplay plots. Adjacent same-type buildings **visually merge** (3 houses → a rowhouse street; wall pieces connect; farms merge into shared fields): mechanically separate cards, visually one living town. Buildings **auto-evolve their look with Ages** (the cottage you placed in Age I is a timber-framed two-story by Age III, no input needed). This transformation is the game's biggest emotional payoff — the player should end a match staring at a town they're proud of.
- **Destruction & repair:** combat damage is visible (crumbling walls, burning roofs — moderate violence: real hits and deaths, no gore). Between rounds, **builder crews with scaffolding visibly repair everything** (mechanically an instant reset; theatrically a living town healing). Keep damage persists visually as cracks/banners until actually gone.
- **Day/night & weather:** aesthetic day cycle across a match (rounds drift morning → dusk; PvE Undead Night is literally night). Weather is visual flavor with only rare explicit card interactions (e.g. a card that says "Rain: …"). No hidden weather math.
- **Audio (post-slice):** low-fantasy ambient strings and cozy town sounds in build phase; Nordic drums/horns swell in combat; distinct legible stingers for synergy-completed, breach, Keep-under-attack, victory. Elder-Scrolls-inspired, not cloned.
- **Tone:** serious world, lighthearted people — villagers grumble, a merchant cheers when you place a market. Light lore only (one flavor line per card), mechanics-first.

---

## 9. Modes, Meta, Monetization (design now, build later)

- **Competitive ranked from day one:** 8-player FFA, placement points, visible rank. Casual uses identical rules.
- **Bots are first-class:** bots build towns using the exact same card/command system as humans (no cheating, no scripted towns) — they fill lobbies and power the prototype. Write bot logic against the same command queue a UI would emit.
- **Meta progression:** unlock **cards, leaders, cosmetics — never stat upgrades**. Collection feeds pre-match deckbuilding (14 slots, so unlocks widen *options*, not power). Matches are always stat-fair.
- **Monetization:** battle pass + cosmetics (town skins, leader skins, building styles, victory banners). Nothing pay-to-win, no card power levels for money.
- **No single-player campaign** planned — multiplayer focus. **Duos later:** don't build it, but don't preclude it (team ID on players; damage/pairing logic reads team ID).

---

## 10. VERTICAL SLICE — build exactly this first

A single-player playable match: **1 human town vs 3 bot towns**, real pairings each round (you fight one bot; the other two bots fight each other in background sim), 8 rounds max, win/elimination by Keep HP.

In scope:
1. Board: fixed template, 4×4 core + Keep + South/East road entrances; ONE district expansion event offering 2 choices.
2. Rounds: Build (60s, skippable) → Combat (45s cap) → Results. Ages I–II only; Keep upgrade purchasable once (Age II, generic — no specialization forks yet).
3. **12 structure cards:** Keep(pre-placed), House, Farm, Barracks, Archer Tower, Blacksmith, Market, Wall, Gatehouse, Tavern, Temple, Spike Pit(trap).
4. **8 unit types:** Footman(from Barracks), Archer, Nord Shieldbearer, Hunter, Spearman, Priest, Raider Wolfpack(PvE), Goblin(PvE).
5. Build bar: a fixed 14-card starter deck (all slice cards, no deckbuilding UI yet), everything always visible and gold-gated, Age-II cards shown locked until the Keep upgrade; gold economy (stipend + Market + raid loot); Supply as army cap; population from Houses.
6. Traits: NORD / WARRIOR / RANGER / CRAFTSMAN with 2/4 breakpoints; 4 adjacency pairs (Blacksmith+Barracks, Farm+Windmill→(use Farm+Farm merge bonus instead if simpler), Watchtower+Wall, Temple+Graveyard→cut if Graveyard out of scope — minimum 3 pairs).
7. Duplicate-merge leveling (buy a second copy, drop it on the first — 2 levels); ONE attachment card (`Veteran Captain` → Barracks) to prove the signature interaction.
8. Warband FRONT/MID/BACK board; drag units between town and warband; one raid doctrine picker (Breach/Plunder/Decapitate); one defense doctrine picker (Hold Walls/Defend Keep).
9. Deterministic auto-combat with behavior words (Guard/Raider/Siegebreaker/Skirmisher), simple road-preferred pathfinding, building blocking/destruction, squad rendering with pooled HP bars, timer-expiry partial Keep damage.
10. One PvE round (Round 3 Goblin Raid) hitting all towns.
11. One Leader (`The Jarl`): passive (+Keep HP), fights in defense, one active (`Rally`, tap to cast during combat) — the only in-combat input.
12. Three.js diorama rendering with **cohesive low-poly primitive placeholder art** (boxes/cylinders with good palette, shadows, and scale language — gameplay correctness over beauty, but keep it charming), rotatable/zoomable camera, drag-and-drop working with mouse AND touch, health bars on everything, trait counter panel, gold/supply/pop top bar, Keep HP for all 4 players.
13. Bots that spend gold from their own build bars, place sensibly (economy early, defense before combat), assign warbands, and pick doctrines — same command API as the player.

Explicitly OUT of the slice: networking, accounts, deckbuilding/collection/meta, ranked, monetization, audio, Ages III–IV, Keep specializations, flying/siege units, spells/events, scouting cards, weather, day/night, visual merging, auto-evolving building meshes, second expansions, moving-buildings-for-gold (sell only), leaders beyond the Jarl, portrait layout polish (don't break, don't polish).

**Development order:** (1) sim core: board/state/commands/tick loop + headless tests → (2) economy & build bar → (3) combat resolution headless (log-verified battles) → (4) Three.js render of sim → (5) drag-drop UI → (6) bots → (7) full match loop + PvE round → (8) juice pass (placement thunk, synergy flash, combat readability). Keep a running `pnpm test` suite over the sim at every step; the sim must simulate a full 4-player match headless in milliseconds.

**Definition of done:** a stranger on a phone browser can finish a full match unaided, understand why they won or lost, and want to play again. The core loop to validate: *check gold and the field → make 2–4 meaningful drops from your deck → watch your machine fight → adapt.* The addictive beat is **"short planning, a few meaningful drops, watch it play out"** — if build phases feel like frantic APM or like empty waiting, tune phase length, income, and card costs until they feel like a satisfying breath. That feel is the product. Everything else serves it.

**Playtest watchpoint (the one risk of the no-shop model):** if every match's first three rounds look identical across skilled players (converged opening build orders), that's the signal to add friction — steeper per-copy cost curves, stronger district/terrain differentiation, or earlier PvE variance. Do NOT reintroduce shop RNG as the first fix; the fix is making the field's threats diverge earlier.
