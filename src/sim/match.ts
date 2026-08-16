import { Rng } from './rng';
import { createTown, collectIncome, repairTown, applyCommand, type TownRuntime } from './town';
import { createCombat, resolveCombatHeadless, type CombatSim } from './combat';
import { GENERATED_UNITS } from './cards';
import type { Command, OwnedUnit, Pairing, Phase, RaidReport } from './types';

export const BUILD_SECONDS = 60;
export const RESULTS_SECONDS = 7;
export const MAX_ROUNDS = 8;
export const PVE_ROUND = 3;
export const EXPANSION_ROUND = 4;

export interface MatchState {
  rng: Rng;
  towns: TownRuntime[]; // index = playerId
  round: number;
  phase: Phase;
  phaseTimer: number; // seconds remaining in build/results
  pairings: Pairing[];
  activeCombat?: CombatSim; // the one the player watches (their defense)
  reports: RaidReport[]; // last combat phase's reports
  winnerId?: number;
  expansionOffered: boolean;
  log: string[];
}

export function createMatch(seed: number): MatchState {
  const rng = new Rng(seed);
  const towns = [createTown(0, false), createTown(1, true), createTown(2, true), createTown(3, true)];
  return {
    rng, towns, round: 1, phase: 'build', phaseTimer: BUILD_SECONDS,
    pairings: [], reports: [], expansionOffered: false,
    log: ['Round 1 — build your town. Raiders arrive when the timer ends.'],
  };
}

export function alive(match: MatchState): TownRuntime[] {
  return match.towns.filter((t) => !t.state.eliminated);
}

export function playerCommand(match: MatchState, cmd: Command): string | null {
  const town = match.towns[cmd.playerId];
  if (!town || town.state.eliminated) return 'Town eliminated';
  if (match.phase !== 'build') return 'Not in build phase';
  return applyCommand(town, cmd);
}

// Derangement-ish pairing: everyone attacks someone who isn't themselves;
// avoids attacking the same target as last round when possible.
export function makePairings(match: MatchState): Pairing[] {
  const ids = alive(match).map((t) => t.state.playerId);
  if (ids.length < 2) return [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const targets = match.rng.shuffle(ids);
    if (ids.every((id, i) => targets[i] !== id)) {
      return ids.map((id, i) => ({ attackerId: id, defenderId: targets[i] }));
    }
  }
  // fallback: rotate by one
  return ids.map((id, i) => ({ attackerId: id, defenderId: ids[(i + 1) % ids.length] }));
}

function warbandOf(town: TownRuntime): OwnedUnit[] {
  return town.state.units.filter((u) => u.assignment !== 'defense');
}

function pveWave(match: MatchState): OwnedUnit[] {
  // Round 3 Goblin Raid: scales slightly with round for reuse.
  const wave: OwnedUnit[] = [];
  const n = 3 + match.round;
  for (let i = 0; i < n; i++) {
    wave.push({
      uid: 9000 + i,
      cardId: match.rng.chance(0.3) ? 'wolfpack' : 'goblin',
      level: 1,
      assignment: (['FRONT', 'MID', 'BACK'] as const)[i % 3],
    });
  }
  return wave;
}

export interface CombatPlan {
  // combats resolved this phase; `watched` is the player's defense (stepped live
  // by the renderer), everything else resolves headless immediately.
  watched?: CombatSim;
  background: CombatSim[];
}

export function startCombatPhase(match: MatchState): CombatPlan {
  const isPvE = match.round === PVE_ROUND;
  const plan: CombatPlan = { background: [] };
  const keepBefore = new Map<number, number>();
  for (const t of match.towns) keepBefore.set(t.state.playerId, t.state.keepHp);

  if (isPvE) {
    match.log.push(`Round ${match.round}: GOBLIN RAID! Every town is under attack.`);
    for (const town of alive(match)) {
      const goblinTown = createTown(99, true).state;
      goblinTown.name = 'Goblin Warband';
      goblinTown.raidDoctrine = 'Plunder';
      const sim = createCombat(town, goblinTown, pveWave(match), match.rng, true);
      if (town.state.isBot) plan.background.push(sim);
      else plan.watched = sim;
    }
    match.pairings = [];
  } else {
    match.pairings = makePairings(match);
    for (const p of match.pairings) {
      const attacker = match.towns[p.attackerId];
      const defender = match.towns[p.defenderId];
      const sim = createCombat(defender, attacker.state, warbandOf(attacker), match.rng, false);
      if (!defender.state.isBot) plan.watched = sim;
      else plan.background.push(sim);
    }
  }
  match.phase = 'combat';
  match.activeCombat = plan.watched;
  return plan;
}

export function finishCombatPhase(match: MatchState, plan: CombatPlan): void {
  const reports: RaidReport[] = [];
  const keepBefore = new Map<number, number>();
  // keepBefore was mutated during combat; reconstruct damage from reports' towns
  for (const sim of plan.background) reports.push(resolveCombatHeadless(sim));
  if (plan.watched) {
    if (!plan.watched.done) resolveCombatHeadless(plan.watched);
    reports.push(plan.watched.report!);
  }
  match.reports = reports;

  // loot + log
  for (const r of reports) {
    if (r.attackerId < match.towns.length) {
      const atk = match.towns[r.attackerId];
      atk.state.gold += r.loot;
    }
    const def = match.towns[r.defenderId];
    if (def && def.state.keepHp <= 0 && !def.state.eliminated) {
      def.state.eliminated = true;
      match.log.push(`${def.state.name} has fallen! Their keep lies in ruins.`);
    }
  }

  // repair everything except keep damage
  for (const t of match.towns) repairTown(t.state);

  // win check
  const stillAlive = alive(match);
  if (stillAlive.length <= 1 || match.round >= MAX_ROUNDS) {
    const winner = stillAlive.length === 1
      ? stillAlive[0]
      : stillAlive.reduce((a, b) => (a.state.keepHp >= b.state.keepHp ? a : b));
    match.winnerId = winner.state.playerId;
    match.phase = 'gameover';
    match.log.push(`${winner.state.name} ${winner.state.isBot ? 'wins' : 'win'} the match!`);
    return;
  }
  match.phase = 'results';
  match.phaseTimer = RESULTS_SECONDS;
}

export function startBuildPhase(match: MatchState): void {
  match.round++;
  match.phase = 'build';
  match.phaseTimer = BUILD_SECONDS;
  match.activeCombat = undefined;
  for (const t of alive(match)) collectIncome(t.state);
  if (match.round === EXPANSION_ROUND) match.expansionOffered = true;
  match.log.push(`Round ${match.round} — build phase.`);
}
