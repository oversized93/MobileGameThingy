import { CARDS, DISTRICTS, KEEP } from './cards';
import { canPlace, popCap, popUsed, type TownRuntime } from './town';
import { applyCommand } from './town';
import type { Command, WarbandRow } from './types';
import { Rng } from './rng';
import type { MatchState } from './match';

// Bots use the exact same command API as the player — no cheating.
// Strategy: economy early, defense before combat, warband grows over rounds.

const ECON = ['market', 'farm', 'house', 'tavern'];
const DEFENSE = ['archer_tower', 'wall', 'gatehouse', 'barracks', 'spike_pit', 'temple'];
const UNITS = ['shieldbearer', 'spearman', 'hunter'];

function tryPlace(rt: TownRuntime, cardId: string, rng: Rng): boolean {
  const def = CARDS[cardId];
  if (!def) return false;
  const spots: Array<[number, number]> = [];
  for (let y = 0; y < rt.grid.length; y++) {
    for (let x = 0; x < rt.grid[y].length; x++) {
      if (canPlace(rt, cardId, x, y) === null) spots.push([x, y]);
    }
  }
  if (spots.length === 0) return false;
  // prefer spots near roads for towers/walls, anywhere for economy
  const pick = rng.pick(spots);
  const cmd: Command = { type: 'PlaceCard', playerId: rt.state.playerId, cardId, x: pick[0], y: pick[1] };
  return applyCommand(rt, cmd) === null;
}

export function botBuildTurn(match: MatchState, rt: TownRuntime): void {
  const town = rt.state;
  const rng = match.rng;
  const round = match.round;

  // choose expansion when offered
  if (match.expansionOffered && town.expansions.length === 0) {
    applyCommand(rt, {
      type: 'ChooseExpansion', playerId: town.playerId,
      expansionId: rng.pick(DISTRICTS).id,
    });
  }

  // upgrade keep mid-game
  if (round >= 4 && town.age === 1 && town.gold >= KEEP.upgradeCost + 4) {
    applyCommand(rt, { type: 'UpgradeKeep', playerId: town.playerId });
  }

  // round 1: guarantee a fighting force so early rounds have action
  if (round === 1 && !town.buildings.some((b) => b.cardId === 'barracks')) {
    tryPlace(rt, 'barracks', rng);
  }

  // spend gold: weighted priorities by round
  let safety = 20;
  while (town.gold >= 2 && safety-- > 0) {
    let pool: string[];
    if (round <= 2) pool = rng.chance(0.5) ? ECON : rng.chance(0.5) ? DEFENSE : UNITS;
    else if (round === 3) pool = rng.chance(0.6) ? DEFENSE : UNITS; // PvE round incoming
    else pool = rng.chance(0.4) ? DEFENSE : rng.chance(0.5) ? UNITS : ECON;

    // need pop first?
    if (popUsed(town) >= popCap(town) - 1) pool = ['house'];

    const affordable = pool.filter((id) => CARDS[id] && CARDS[id].cost <= town.gold && CARDS[id].age <= town.age);
    if (affordable.length === 0) break;
    if (!tryPlace(rt, rng.pick(affordable), rng)) break;
  }

  // warband assignment: keep ~40% defending, rest raiding (more raiders later)
  const raidShare = Math.min(0.7, 0.3 + round * 0.06);
  const rows: WarbandRow[] = ['FRONT', 'MID', 'BACK'];
  const combatUnits = town.units.filter((u) => u.cardId !== 'priest');
  combatUnits.forEach((u, i) => {
    const shouldRaid = i / Math.max(1, combatUnits.length) < raidShare;
    const target = shouldRaid ? rows[i % 3] : 'defense';
    if (u.assignment !== target) {
      applyCommand(rt, { type: 'MoveUnit', playerId: town.playerId, targetUid: u.uid, assignment: target });
    }
  });

  // doctrines
  applyCommand(rt, {
    type: 'SetRaidDoctrine', playerId: town.playerId,
    raidDoctrine: rng.pick(['Breach', 'Plunder', 'Decapitate'] as const),
  });
  applyCommand(rt, {
    type: 'SetDefenseDoctrine', playerId: town.playerId,
    defenseDoctrine: rng.chance(0.6) ? 'HoldWalls' : 'DefendKeep',
  });
}

export function runBotBuilds(match: MatchState): void {
  for (const rt of match.towns) {
    if (rt.state.isBot && !rt.state.eliminated) botBuildTurn(match, rt);
  }
}
