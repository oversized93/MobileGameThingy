import { SceneView } from './render/scene';
import { CARDS, DISTRICTS, KEEP, TRAIT_BREAKPOINTS, cardDef } from './sim/cards';
import {
  createMatch, startCombatPhase, finishCombatPhase, startBuildPhase,
  playerCommand, BUILD_SECONDS, PVE_ROUND, type MatchState, type CombatPlan,
} from './sim/match';
import { runBotBuilds } from './sim/bot';
import { stepCombat, resolveCombatHeadless, castRally, TICK, type CombatSim } from './sim/combat';
import {
  canPlace, goldIncome, popCap, popUsed, supplyProvided, supplyUsed, traitCounts,
} from './sim/town';
import type { RaidDoctrine, DefenseDoctrine, WarbandRow } from './sim/types';

const CARD_ICONS: Record<string, string> = {
  house: '🏠', farm: '🌾', market: '🛒', barracks: '⚔️', archer_tower: '🏹',
  blacksmith: '⚒️', wall: '🧱', gatehouse: '🚪', tavern: '🍺', temple: '⛪',
  spike_pit: '📌', shieldbearer: '🛡️', hunter: '🎯', spearman: '🔱', vet_captain: '🎖️',
};
const UNIT_ICONS: Record<string, string> = {
  footman: '⚔️', vet_footman: '🎖️', archer: '🏹', priest: '✨', shieldbearer: '🛡️',
  hunter: '🎯', spearman: '🔱',
};

// ---------- state ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const view = new SceneView(canvas);
let match: MatchState = createMatch(Math.floor(Math.random() * 1e9));
let plan: CombatPlan | undefined;
let combatAccum = 0;
let watchedFinished = false;
const PLAYER = 0;

function playerTown() { return match.towns[PLAYER]; }

view.buildTiles(playerTown().grid);

// ---------- HUD elements ----------
const $ = (id: string) => document.getElementById(id)!;
const topGold = $('stat-gold'), topRound = $('stat-round'), topPop = $('stat-pop');
const topSupply = $('stat-supply'), topAge = $('stat-age'), topTimer = $('stat-timer');
const buildbar = $('buildbar'), msgEl = $('message'), overlay = $('overlay');
const keepsEl = $('keeps'), traitsEl = $('traits'), tickerEl = $('raid-ticker');
const skipBtn = $('skip-btn') as HTMLButtonElement;
const keepBtn = $('keep-upgrade') as HTMLButtonElement;
const rallyBtn = $('rally-btn') as HTMLButtonElement;

let message = '';
let messageTimer = 0;
function say(text: string, secs = 3): void {
  message = text;
  messageTimer = secs;
}

// ---------- build bar ----------
function renderBuildBar(): void {
  const town = playerTown().state;
  buildbar.innerHTML = '';
  for (const cardId of town.deck) {
    const def = CARDS[cardId];
    const el = document.createElement('div');
    el.className = 'card';
    const locked = def.age > town.age;
    const unaffordable = town.gold < def.cost;
    if (locked) el.classList.add('locked');
    else if (unaffordable) el.classList.add('unaffordable');
    el.innerHTML = `
      <div class="c-cost">${def.cost}</div>
      <div class="c-icon">${CARD_ICONS[cardId] ?? '❔'}</div>
      <div class="c-name">${def.name}</div>
      <div class="c-desc">${def.desc}</div>
      <div class="c-traits">${def.traits.map((t) => `<span class="c-trait">${t}</span>`).join('')}</div>
      ${locked ? '<div class="c-lock">🔒 AGE II</div>' : ''}
    `;
    el.dataset.cardId = cardId;
    buildbar.appendChild(el);
  }
}

// ---------- drag & drop placement ----------
let dragging: string | null = null;
let ghost: HTMLElement | null = null;

function startDrag(cardId: string, x: number, y: number): void {
  const town = playerTown().state;
  const def = CARDS[cardId];
  if (match.phase !== 'build') return;
  if (def.age > town.age) { say(`${def.name} unlocks at Age II — upgrade your Keep`); return; }
  if (town.gold < def.cost) { say('Not enough gold'); return; }
  dragging = cardId;
  view.controls.enabled = false; // no zoom while a card is in flight
  ghost = document.createElement('div');
  ghost.id = 'drag-ghost';
  ghost.textContent = CARD_ICONS[cardId] ?? '❔';
  document.body.appendChild(ghost);
  moveGhost(x, y);
}

function moveGhost(x: number, y: number): void {
  if (!ghost || !dragging) return;
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  const tile = view.pickTile(x, y);
  if (tile) {
    const err = canPlace(playerTown(), dragging, tile.x, tile.y);
    view.showHighlight(tile.x, tile.y, err === null);
  } else {
    view.hideHighlight();
  }
}

function endDrag(x: number, y: number): void {
  if (!dragging) return;
  const cardId = dragging;
  dragging = null;
  view.controls.enabled = true;
  ghost?.remove();
  ghost = null;
  view.hideHighlight();
  const tile = view.pickTile(x, y);
  if (!tile) return;
  const err = playerCommand(match, { type: 'PlaceCard', playerId: PLAYER, cardId, x: tile.x, y: tile.y });
  if (err) {
    say(err);
    return;
  }
  view.buildTiles(playerTown().grid);
  view.syncTown(playerTown());
  renderBuildBar();
  renderWarband();
  renderTraits();
}

buildbar.addEventListener('pointerdown', (e) => {
  const card = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
  if (!card?.dataset.cardId) return;
  e.preventDefault();
  startDrag(card.dataset.cardId, e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e) => {
  if (dragging) {
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  }
});
window.addEventListener('pointerup', (e) => {
  if (dragging) endDrag(e.clientX, e.clientY);
});
// camera zoom pauses while a card drag is in flight (rotation is button-only)
$('rotate-btn').addEventListener('click', () => view.rotateStep());

// collapsible army panel: starts hidden on portrait/narrow screens
const sidepanel = $('sidepanel');
const panelToggle = $('panel-toggle');
function setPanel(open: boolean): void {
  sidepanel.classList.toggle('collapsed', !open);
  panelToggle.classList.toggle('open', open);
}
panelToggle.addEventListener('click', () => setPanel(sidepanel.classList.contains('collapsed')));
setPanel(!(window.innerHeight > window.innerWidth || window.innerWidth < 700));

// ---------- warband panel ----------
function renderWarband(): void {
  const town = playerTown().state;
  const zones: Record<string, HTMLElement> = {
    defense: $('wb-defense'), FRONT: $('wb-FRONT'), MID: $('wb-MID'), BACK: $('wb-BACK'),
  };
  for (const z of Object.values(zones)) {
    for (const chip of Array.from(z.querySelectorAll('.unit-chip'))) chip.remove();
  }
  const cycle: Array<'defense' | WarbandRow> = ['defense', 'FRONT', 'MID', 'BACK'];
  for (const u of town.units) {
    if (u.cardId === 'priest') continue; // priests always defend near their temple
    const chip = document.createElement('div');
    chip.className = 'unit-chip' + (u.level >= 2 ? ' lvl2' : '');
    chip.textContent = `${UNIT_ICONS[u.cardId] ?? '👤'} ${cardDef(u.cardId).name}`;
    chip.addEventListener('click', () => {
      if (match.phase !== 'build') return;
      const next = cycle[(cycle.indexOf(u.assignment) + 1) % cycle.length];
      playerCommand(match, { type: 'MoveUnit', playerId: PLAYER, targetUid: u.uid, assignment: next });
      renderWarband();
    });
    zones[u.assignment].appendChild(chip);
  }
}

// ---------- doctrines ----------
function renderDoctrines(): void {
  const town = playerTown().state;
  const raid: RaidDoctrine[] = ['Breach', 'Plunder', 'Decapitate'];
  const dfn: DefenseDoctrine[] = ['HoldWalls', 'DefendKeep'];
  const raidEl = $('raid-doctrine');
  raidEl.innerHTML = '';
  for (const d of raid) {
    const b = document.createElement('button');
    b.className = 'doc-btn' + (town.raidDoctrine === d ? ' on' : '');
    b.textContent = d;
    b.addEventListener('click', () => {
      playerCommand(match, { type: 'SetRaidDoctrine', playerId: PLAYER, raidDoctrine: d });
      renderDoctrines();
    });
    raidEl.appendChild(b);
  }
  const dfnEl = $('defense-doctrine');
  dfnEl.innerHTML = '';
  for (const d of dfn) {
    const b = document.createElement('button');
    b.className = 'doc-btn' + (town.defenseDoctrine === d ? ' on' : '');
    b.textContent = d === 'HoldWalls' ? 'Hold Walls' : 'Defend Keep';
    b.addEventListener('click', () => {
      playerCommand(match, { type: 'SetDefenseDoctrine', playerId: PLAYER, defenseDoctrine: d });
      renderDoctrines();
    });
    dfnEl.appendChild(b);
  }
}

// ---------- traits panel ----------
function renderTraits(): void {
  const counts = traitCounts(playerTown().state);
  traitsEl.innerHTML = '';
  const seen = new Set<string>();
  for (const bp of TRAIT_BREAKPOINTS) {
    if (seen.has(bp.trait)) continue;
    seen.add(bp.trait);
    const c = counts.get(bp.trait) ?? 0;
    if (c === 0) continue;
    const bps = TRAIT_BREAKPOINTS.filter((b) => b.trait === bp.trait);
    const nextBp = bps.find((b) => c < b.count);
    const active = bps.filter((b) => c >= b.count).length > 0;
    const row = document.createElement('div');
    row.className = 'trait-row' + (active ? ' active' : '');
    row.textContent = `${bp.trait} ${c}${nextBp ? `/${nextBp.count}` : ' ✓'}`;
    row.title = bps.map((b) => `${b.count}: ${b.desc}`).join('\n');
    traitsEl.appendChild(row);
  }
}

// ---------- keep chips ----------
function renderKeeps(): void {
  keepsEl.innerHTML = '';
  for (const t of match.towns) {
    const s = t.state;
    const chip = document.createElement('div');
    chip.className = 'keepchip' + (s.eliminated ? ' dead' : '') + (s.playerId === PLAYER ? ' you' : '');
    const frac = Math.max(0, s.keepHp / s.keepMaxHp);
    chip.innerHTML = `
      <div class="kc-name">${s.playerId === PLAYER ? '👑 ' : ''}${s.name}</div>
      <div class="kc-bar"><div class="kc-fill" style="width:${frac * 100}%; background:${frac > 0.5 ? '#7fae6a' : frac > 0.25 ? '#e8b64c' : '#e86a5c'}"></div></div>
    `;
    keepsEl.appendChild(chip);
  }
}

// ---------- overlay panels ----------
function showOverlay(html: string): void {
  overlay.innerHTML = `<div class="panel">${html}</div>`;
  overlay.classList.remove('hidden');
}
function hideOverlay(): void {
  overlay.classList.add('hidden');
}

function showExpansionChoice(): void {
  const choices = DISTRICTS.map((d) =>
    `<button class="choice" data-district="${d.id}"><b>${d.name}</b><br>${d.desc}</button>`,
  ).join('');
  showOverlay(`<h2>Your town grows!</h2><p>Choose a district to expand into:</p>${choices}`);
  overlay.querySelectorAll('.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.district!;
      playerCommand(match, { type: 'ChooseExpansion', playerId: PLAYER, expansionId: id });
      match.expansionOffered = false;
      view.buildTiles(playerTown().grid);
      view.syncTown(playerTown());
      hideOverlay();
    });
  });
}

function showResults(): void {
  const myReports = match.reports.filter(
    (r) => r.attackerId === PLAYER || r.defenderId === PLAYER,
  );
  let html = `<h2>Round ${match.round} Results</h2>`;
  for (const r of myReports) {
    if (r.attackerId === PLAYER) {
      html += `<p class="report">⚔️ <b>Your raid:</b> destroyed ${r.buildingsDestroyed} buildings, ` +
        `lost ${r.attackersLost} squads${r.keepDestroyed ? ', <b>BREACHED THE KEEP!</b>' : ''} ` +
        `— looted <b>${r.loot}g</b></p>`;
    } else {
      const name = r.attackerId < match.towns.length ? match.towns[r.attackerId].state.name : 'Goblins';
      html += `<p class="report">🏰 <b>Defense vs ${name}:</b> ${r.buildingsDestroyed} buildings damaged, ` +
        `slew ${r.attackersLost} enemy squads${r.keepDestroyed ? ' — <b>your keep was breached!</b>' : ''}</p>`;
    }
  }
  html += `<button id="continue-btn">Continue ▶</button>`;
  showOverlay(html);
  $('continue-btn').addEventListener('click', () => {
    hideOverlay();
    nextRound();
  });
}

function showGameOver(): void {
  const winner = match.towns[match.winnerId!];
  const won = match.winnerId === PLAYER;
  const placement = match.towns.filter((t) => !t.state.eliminated || t.state.playerId === PLAYER).length;
  showOverlay(`
    <h2>${won ? '👑 VICTORY!' : '☠️ Defeat'}</h2>
    <p>${won ? 'Your town stands triumphant. The realm sings of your bastion!' :
      `${winner.state.name} wins the match. Your keep ${playerTown().state.eliminated ? 'lies in ruins' : 'survived, but theirs stood taller'}.`}</p>
    <button id="restart-btn">Play Again ⟳</button>
  `);
  $('restart-btn').addEventListener('click', () => {
    match = createMatch(Math.floor(Math.random() * 1e9));
    plan = undefined;
    watchedFinished = false;
    view.buildTiles(playerTown().grid);
    view.syncTown(playerTown());
    view.syncCombat(undefined);
    hideOverlay();
    refreshAll();
    say('Round 1 — build your town!', 4);
  });
}

// ---------- phase flow ----------
function startCombat(): void {
  if (match.expansionOffered) {
    // auto-pick farmlands if the player ignored the expansion choice
    playerCommand(match, { type: 'ChooseExpansion', playerId: PLAYER, expansionId: 'farmlands' });
    match.expansionOffered = false;
    view.buildTiles(playerTown().grid);
  }
  runBotBuilds(match);
  plan = startCombatPhase(match);
  combatAccum = 0;
  watchedFinished = false;
  skipBtn.classList.add('hidden');
  keepBtn.classList.add('hidden');
  const isPvE = match.round === PVE_ROUND;
  say(isPvE ? '🗡 GOBLIN RAID — defend your town!' : 'Raiders approach — defend your town!', 3);
  if (!playerTown().state.rallyUsed) {
    rallyBtn.classList.remove('hidden');
    rallyBtn.disabled = false;
  }
}

function endCombat(): void {
  if (!plan) return;
  finishCombatPhase(match, plan);
  plan = undefined;
  rallyBtn.classList.add('hidden');
  view.syncCombat(undefined);
  view.syncTown(playerTown());
  renderKeeps();
  if (match.phase === 'gameover') {
    showGameOver();
  } else {
    showResults();
  }
}

function nextRound(): void {
  startBuildPhase(match);
  view.syncTown(playerTown());
  refreshAll();
  if (match.expansionOffered) showExpansionChoice();
  const town = playerTown().state;
  say(`Round ${match.round} — ${match.round === PVE_ROUND ? '⚠️ scouts report goblins nearby!' : 'build and prepare!'}`, 4);
}

function refreshAll(): void {
  renderBuildBar();
  renderWarband();
  renderDoctrines();
  renderTraits();
  renderKeeps();
}

skipBtn.addEventListener('click', () => {
  if (match.phase === 'build') {
    match.phaseTimer = 0;
  }
});

keepBtn.addEventListener('click', () => {
  const err = playerCommand(match, { type: 'UpgradeKeep', playerId: PLAYER });
  if (err) { say(err); return; }
  say('🏰 AGE II — new cards unlocked!', 4);
  renderBuildBar();
  renderKeeps();
});

rallyBtn.addEventListener('click', () => {
  if (plan?.watched && !plan.watched.done) {
    if (castRally(plan.watched)) {
      rallyBtn.disabled = true;
      say('⚡ RALLY! Your defenders surge with vigor!');
    }
  }
});

// ---------- raid ticker (background battle feed) ----------
let tickerLines: string[] = [];
function pushTicker(line: string): void {
  tickerLines.push(line);
  if (tickerLines.length > 4) tickerLines.shift();
  tickerEl.innerHTML = tickerLines.map((l) => `<div>${l}</div>`).join('');
}

// ---------- main loop ----------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (match.phase === 'build') {
    match.phaseTimer -= dt;
    topTimer.textContent = `⏳ ${Math.max(0, Math.ceil(match.phaseTimer))}s`;
    topTimer.classList.toggle('urgent', match.phaseTimer < 10);
    skipBtn.classList.remove('hidden');
    const town = playerTown().state;
    keepBtn.classList.toggle('hidden', town.age >= 2);
    (keepBtn as HTMLButtonElement).disabled = town.gold < KEEP.upgradeCost;
    if (match.phaseTimer <= 0 && overlay.classList.contains('hidden')) {
      startCombat();
    }
  } else if (match.phase === 'combat' && plan) {
    topTimer.textContent = '⚔️';
    // step the watched combat in real time (sim tick = 0.1s)
    combatAccum += dt;
    const watched = plan.watched;
    if (watched) {
      while (combatAccum >= TICK && !watched.done) {
        combatAccum -= TICK;
        stepCombat(watched);
        // feed ticker occasionally from the player's raid (background)
      }
      view.syncCombat(watched);
      view.syncBuildingBars(playerTown(), true);
      if (watched.done && !watchedFinished) {
        watchedFinished = true;
        // resolve background raids, then show results after a beat
        setTimeout(() => endCombat(), 900);
      }
    } else {
      // player eliminated or no defense this round: resolve all instantly
      endCombat();
    }
  }

  // message fade
  if (messageTimer > 0) {
    messageTimer -= dt;
    msgEl.textContent = message;
    if (messageTimer <= 0) msgEl.textContent = '';
  }

  // top bar
  const town = playerTown().state;
  topGold.textContent = `${town.gold}g (+${goldIncome(town)})`;
  topRound.textContent = `Round ${match.round}${match.round === PVE_ROUND && match.phase === 'build' ? ' ⚠️' : ''}`;
  topPop.textContent = `👥 ${popUsed(town)}/${popCap(town)}`;
  topSupply.textContent = `🍞 ${supplyUsed(town)}/${supplyProvided(town)}`;
  topAge.textContent = town.age === 1 ? 'Age I' : 'Age II';

  // every frame so placement pop-in and repair animations always play out
  view.syncTown(playerTown());
  view.render(dt);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
view.syncTown(playerTown());
refreshAll();
say('Welcome, Jarl! Drag cards onto the board to build. Raiders come when the timer ends.', 6);
requestAnimationFrame(frame);

// Debug/test hook (harmless in production; drives the same command path as the UI).
(window as unknown as Record<string, unknown>).__bastion = {
  match: () => match,
  place: (cardId: string, x: number, y: number) => {
    const err = playerCommand(match, { type: 'PlaceCard', playerId: PLAYER, cardId, x, y });
    if (!err) {
      view.buildTiles(playerTown().grid);
      view.syncTown(playerTown());
      refreshAll();
    }
    return err;
  },
  skip: () => { if (match.phase === 'build') match.phaseTimer = 0; },
  ff: () => {
    // fast-forward the watched combat (test/debug)
    if (plan?.watched && !plan.watched.done) resolveCombatHeadless(plan.watched);
  },
  phase: () => match.phase,
  round: () => match.round,
  winner: () => match.winnerId,
};
