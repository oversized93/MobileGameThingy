import { ENTRANCES, KEEP_X, KEEP_Y, SIZE, neighbors4, type Tile } from './board';
import { KEEP, cardDef } from './cards';
import { adjacencyNotes, hasBonus, type TownRuntime } from './town';
import type { Behavior, OwnedUnit, RaidReport, TownState, WarbandRow } from './types';
import { Rng } from './rng';

export const TICK = 0.1; // seconds per sim tick
export const MAX_TICKS = 450; // 45s combat cap

export interface Squad {
  id: number;
  side: 'attacker' | 'defender';
  cardId: string;
  name: string;
  behavior: Behavior;
  x: number; // float tile coords
  y: number;
  hp: number;
  maxHp: number;
  count: number; // soldiers alive (visual)
  size: number;
  dmg: number;
  range: number;
  speed: number;
  healPerSec: number;
  cooldown: number;
  attackCooldown: number;
  targetSquad?: number;
  targetBuilding?: number;
  path: Array<[number, number]>;
  postX?: number;
  postY?: number;
  dead: boolean;
  isJarl?: boolean;
}

export interface CombatEvent {
  tick: number;
  kind: 'hit' | 'squadDeath' | 'buildingDestroyed' | 'keepHit' | 'trap' | 'rally' | 'end';
  x?: number;
  y?: number;
  squadId?: number;
  buildingUid?: number;
  amount?: number;
}

export interface CombatSim {
  defender: TownRuntime;
  attackerTown: TownState;
  squads: Squad[];
  tick: number;
  done: boolean;
  keepDestroyed: boolean;
  events: CombatEvent[]; // events emitted this tick (renderer consumes)
  rng: Rng;
  keepAttackCooldown: number;
  towerCooldowns: Map<number, number>;
  report?: RaidReport;
  isPvE: boolean;
}

let nextSquadId = 1;

function passCost(defTown: TownState, grid: Tile[][], x: number, y: number): number {
  const tile = grid[y]?.[x];
  if (!tile) return Infinity;
  const b = defTown.buildings.find((bb) => bb.x === x && bb.y === y && !bb.destroyed);
  if (b) {
    const def = cardDef(b.cardId);
    if (def.isTrap) return tile.kind === 'road' ? 1 : 2.5; // traps don't block
    // blocking building: expensive but passable (unit will bash through it)
    return 10 + b.hp / 60;
  }
  if (tile.kind === 'road') return 1;
  return 2.5; // off-road is slower/preferred less
}

// A* to the keep (or any goal), road-preferred, buildings passable-at-cost.
function findPath(
  defTown: TownState, grid: Tile[][],
  sx: number, sy: number, gx: number, gy: number,
): Array<[number, number]> {
  const open = new Map<string, number>();
  const g = new Map<string, number>();
  const from = new Map<string, string>();
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
  const sk = `${sx},${sy}`;
  open.set(sk, h(sx, sy));
  g.set(sk, 0);
  while (open.size) {
    let bestK = '';
    let bestF = Infinity;
    for (const [k, f] of open) if (f < bestF) { bestF = f; bestK = k; }
    open.delete(bestK);
    const [cx, cy] = bestK.split(',').map(Number);
    if (cx === gx && cy === gy) {
      const path: Array<[number, number]> = [];
      let cur = bestK;
      while (cur !== sk) {
        const [px, py] = cur.split(',').map(Number);
        path.unshift([px, py]);
        cur = from.get(cur)!;
      }
      return path;
    }
    for (const [nx, ny] of neighbors4(cx, cy)) {
      const cost = passCost(defTown, grid, nx, ny);
      if (!isFinite(cost)) continue;
      const nk = `${nx},${ny}`;
      const ng = g.get(bestK)! + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        from.set(nk, bestK);
        open.set(nk, ng + h(nx, ny));
      }
    }
  }
  return [];
}

function squadFromUnit(
  u: OwnedUnit, side: 'attacker' | 'defender', town: TownState,
  x: number, y: number,
): Squad {
  const def = cardDef(u.cardId);
  const levelMult = u.level >= 2 ? 1.5 : 1;
  let size = def.squadSize ?? 1;
  let hpPer = (def.unitHp ?? 50) * levelMult;
  let dmg = (def.unitDmg ?? 5) * levelMult;
  let range = def.unitRange ?? 1;
  const melee = range <= 1.01;

  // trait bonuses
  if (melee && hasBonus(town, 'WARRIOR', 2)) dmg *= 1.1;
  if (melee && hasBonus(town, 'WARRIOR', 4)) hpPer *= 1.15;
  if (!melee && hasBonus(town, 'RANGER', 2)) dmg *= 1.1;
  if (hasBonus(town, 'NORD', 2)) hpPer *= 1.1;
  if (!melee && hasBonus(town, 'RANGER', 2)) range += 0; // range bonus reserved for towers

  // blacksmith adjacency: footmen from a barracks next to a blacksmith
  if (u.fromBuildingUid) {
    const src = town.buildings.find((b) => b.uid === u.fromBuildingUid);
    if (src && adjacencyNotes(town, src).some((n) => n.includes('dmg'))) dmg *= 1.25;
  }

  return {
    id: nextSquadId++,
    side,
    cardId: u.cardId,
    name: def.name,
    behavior: def.behavior ?? 'Guard',
    x, y,
    hp: hpPer * size,
    maxHp: hpPer * size,
    count: size,
    size,
    dmg: dmg * size, // squad dps pooled
    range,
    speed: def.unitSpeed ?? 1.2,
    healPerSec: (def.healPerSec ?? 0) * size,
    cooldown: 1,
    attackCooldown: 0,
    path: [],
    postX: u.postX,
    postY: u.postY,
    dead: false,
    isJarl: u.cardId === 'jarl',
  };
}

const ROW_DELAY: Record<WarbandRow, number> = { FRONT: 0, MID: 12, BACK: 24 };

export function createCombat(
  defender: TownRuntime,
  attackerTown: TownState,
  attackerUnits: OwnedUnit[],
  rng: Rng,
  isPvE = false,
): CombatSim {
  const sim: CombatSim = {
    defender, attackerTown, squads: [], tick: 0, done: false,
    keepDestroyed: false, events: [], rng,
    keepAttackCooldown: 0, towerCooldowns: new Map(), isPvE,
  };
  const defTown = defender.state;

  // Defenders: everyone assigned 'defense', posted where they were dropped.
  for (const u of defTown.units) {
    if (u.assignment !== 'defense') continue;
    let px = u.postX ?? KEEP_X;
    let py = u.postY ?? KEEP_Y;
    if (defTown.defenseDoctrine === 'DefendKeep') {
      px = KEEP_X + (px > KEEP_X ? 1 : px < KEEP_X ? -1 : 0);
      py = KEEP_Y + (py > KEEP_Y ? 1 : py < KEEP_Y ? -1 : 0);
    } else if (defTown.defenseDoctrine === 'HoldWalls') {
      // shade posts toward the nearest entrance
      const ent = ENTRANCES.reduce((a, b) =>
        Math.hypot(a.x - px, a.y - py) < Math.hypot(b.x - px, b.y - py) ? a : b);
      px = Math.round(px + Math.sign(ent.x - px));
      py = Math.round(py + Math.sign(ent.y - py));
    }
    sim.squads.push(squadFromUnit(u, 'defender', defTown, px + 0.0, py + 0.0));
  }
  // The Jarl always defends his own town.
  const jarlUnit: OwnedUnit = {
    uid: -1, cardId: 'jarl', level: defTown.age, assignment: 'defense',
    postX: KEEP_X, postY: KEEP_Y - 1,
  };
  sim.squads.push(squadFromUnit(jarlUnit, 'defender', defTown, KEEP_X, KEEP_Y - 1));

  // Attackers: enter via entrances, staggered by warband row.
  attackerUnits.forEach((u, i) => {
    const ent = ENTRANCES[i % ENTRANCES.length];
    const sq = squadFromUnit(u, 'attacker', attackerTown, ent.x, ent.y);
    const row: WarbandRow = u.assignment === 'defense' ? 'FRONT' : u.assignment;
    sq.attackCooldown = ROW_DELAY[row] * TICK * 10; // delayed entry
    sim.squads.push(sq);
  });
  return sim;
}

function nearest<T>(items: T[], pos: { x: number; y: number }, getXY: (t: T) => [number, number]): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const it of items) {
    const [x, y] = getXY(it);
    const d = Math.hypot(x - pos.x, y - pos.y);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function pickAttackerGoal(sim: CombatSim, sq: Squad): void {
  const defTown = sim.defender.state;
  const alive = defTown.buildings.filter((b) => !b.destroyed && !cardDef(b.cardId).isTrap);
  const doctrine = sim.attackerTown.raidDoctrine;

  // behavior first, doctrine as tiebreak
  if (sq.behavior === 'Raider' || doctrine === 'Plunder') {
    const econ = alive.filter((b) => cardDef(b.cardId).economy);
    const t = nearest(econ, sq, (b) => [b.x, b.y]);
    if (t) { sq.targetBuilding = t.uid; return; }
  }
  if (sq.behavior === 'Siegebreaker' || doctrine === 'Breach') {
    const fort = alive.filter((b) => cardDef(b.cardId).isWall || cardDef(b.cardId).isGate);
    const t = nearest(fort, sq, (b) => [b.x, b.y]);
    if (t) { sq.targetBuilding = t.uid; return; }
  }
  // Decapitate / default: the Keep
  sq.targetBuilding = undefined; // undefined building target = the Keep
}

function moveAlongPath(sim: CombatSim, sq: Squad, gx: number, gy: number): void {
  const defTown = sim.defender.state;
  if (sq.path.length === 0 || sim.tick % 20 === 0) {
    sq.path = findPath(defTown, sim.defender.grid, Math.round(sq.x), Math.round(sq.y), gx, gy);
  }
  if (sq.path.length === 0) return;
  const [nx, ny] = sq.path[0];
  // blocked by a live building? bash it
  const blocker = defTown.buildings.find((b) => b.x === nx && b.y === ny && !b.destroyed && !cardDef(b.cardId).isTrap);
  if (blocker && sq.side === 'attacker') {
    attackBuilding(sim, sq, blocker.uid);
    return;
  }
  const d = Math.hypot(nx - sq.x, ny - sq.y);
  const step = sq.speed * TICK;
  if (d <= step) {
    sq.x = nx; sq.y = ny;
    sq.path.shift();
    // trap trigger
    if (sq.side === 'attacker') {
      const trap = defTown.buildings.find(
        (b) => b.x === nx && b.y === ny && !b.destroyed && cardDef(b.cardId).isTrap && b.trapArmed,
      );
      if (trap) {
        trap.trapArmed = false;
        const dmg = (cardDef(trap.cardId).trapDmg ?? 50) * trap.level;
        damageSquad(sim, sq, dmg);
        sim.events.push({ tick: sim.tick, kind: 'trap', x: nx, y: ny, squadId: sq.id, amount: dmg });
      }
    }
  } else {
    sq.x += ((nx - sq.x) / d) * step;
    sq.y += ((ny - sq.y) / d) * step;
  }
}

function damageSquad(sim: CombatSim, sq: Squad, dmg: number): void {
  const roll = sim.rng.range(0.85, 1.15); // RNG 4-5/10: ±15%
  sq.hp -= dmg * roll;
  const perSoldier = sq.maxHp / sq.size;
  sq.count = Math.max(0, Math.ceil(sq.hp / perSoldier));
  if (sq.hp <= 0 && !sq.dead) {
    sq.dead = true;
    sim.events.push({ tick: sim.tick, kind: 'squadDeath', squadId: sq.id, x: sq.x, y: sq.y });
  }
}

function attackBuilding(sim: CombatSim, sq: Squad, uid: number): void {
  if (sq.attackCooldown > 0) return;
  const b = sim.defender.state.buildings.find((x) => x.uid === uid);
  if (!b || b.destroyed) { sq.targetBuilding = undefined; return; }
  sq.attackCooldown = sq.cooldown;
  const roll = sim.rng.range(0.85, 1.15);
  b.hp -= sq.dmg * roll;
  sim.events.push({ tick: sim.tick, kind: 'hit', x: b.x, y: b.y, squadId: sq.id });
  if (b.hp <= 0) {
    b.destroyed = true;
    sim.events.push({ tick: sim.tick, kind: 'buildingDestroyed', buildingUid: b.uid, x: b.x, y: b.y });
  }
}

function attackKeep(sim: CombatSim, sq: Squad): void {
  if (sq.attackCooldown > 0) return;
  sq.attackCooldown = sq.cooldown;
  const town = sim.defender.state;
  const roll = sim.rng.range(0.85, 1.15);
  const dmg = sq.dmg * roll;
  town.keepHp -= dmg;
  sim.events.push({ tick: sim.tick, kind: 'keepHit', x: KEEP_X, y: KEEP_Y, amount: dmg });
  if (town.keepHp <= 0) {
    town.keepHp = 0;
    sim.keepDestroyed = true;
  }
}

export function castRally(sim: CombatSim): boolean {
  const town = sim.defender.state;
  if (town.rallyUsed) return false;
  town.rallyUsed = true;
  for (const sq of sim.squads) {
    if (sq.side === 'defender' && !sq.dead) {
      sq.hp = Math.min(sq.maxHp, sq.hp + sq.maxHp * 0.35);
      const perSoldier = sq.maxHp / sq.size;
      sq.count = Math.max(sq.count, Math.ceil(sq.hp / perSoldier));
    }
  }
  sim.events.push({ tick: sim.tick, kind: 'rally', x: KEEP_X, y: KEEP_Y });
  return true;
}

export function stepCombat(sim: CombatSim): void {
  if (sim.done) return;
  sim.events = [];
  sim.tick++;
  const defTown = sim.defender.state;
  const attackers = sim.squads.filter((s) => s.side === 'attacker' && !s.dead);
  const defenders = sim.squads.filter((s) => s.side === 'defender' && !s.dead);

  // End conditions
  if (sim.keepDestroyed || attackers.length === 0 || sim.tick >= MAX_TICKS) {
    finish(sim, attackers, defenders);
    return;
  }

  for (const sq of sim.squads) {
    if (sq.dead) continue;
    if (sq.attackCooldown > 0) sq.attackCooldown -= TICK;

    if (sq.side === 'attacker') {
      // choose goal
      if (sim.tick % 15 === 1) pickAttackerGoal(sim, sq);

      // engage nearby defenders (Guard always; others if adjacent)
      const foe = nearest(defenders, sq, (d) => [d.x, d.y]);
      const foeDist = foe ? Math.hypot(foe.x - sq.x, foe.y - sq.y) : Infinity;
      const wantsFight = sq.behavior === 'Guard' || foeDist < 1.2;
      if (foe && wantsFight && foeDist <= sq.range + 0.15) {
        if (sq.attackCooldown <= 0) {
          sq.attackCooldown = sq.cooldown;
          damageSquad(sim, foe, sq.dmg);
          sim.events.push({ tick: sim.tick, kind: 'hit', x: foe.x, y: foe.y, squadId: sq.id });
        }
        continue;
      }
      if (foe && wantsFight && foeDist <= 2.2) {
        // close the gap directly
        const d = foeDist;
        sq.x += ((foe.x - sq.x) / d) * sq.speed * TICK;
        sq.y += ((foe.y - sq.y) / d) * sq.speed * TICK;
        continue;
      }

      // building target or keep
      if (sq.targetBuilding !== undefined) {
        const b = defTown.buildings.find((x) => x.uid === sq.targetBuilding && !x.destroyed);
        if (!b) { sq.targetBuilding = undefined; continue; }
        const dist = Math.hypot(b.x - sq.x, b.y - sq.y);
        if (dist <= Math.max(sq.range, 1) + 0.15) attackBuilding(sim, sq, b.uid);
        else moveAlongPath(sim, sq, b.x, b.y);
      } else {
        const dist = Math.hypot(KEEP_X - sq.x, KEEP_Y - sq.y);
        if (dist <= Math.max(sq.range, 1) + 0.35) attackKeep(sim, sq);
        else moveAlongPath(sim, sq, KEEP_X, KEEP_Y);
      }
    } else {
      // defender
      if (sq.behavior === 'Support') {
        const hurt = defenders.filter((d) => d.hp < d.maxHp && d.id !== sq.id);
        const t = nearest(hurt, sq, (d) => [d.x, d.y]);
        if (t) {
          const dist = Math.hypot(t.x - sq.x, t.y - sq.y);
          if (dist <= sq.range) {
            t.hp = Math.min(t.maxHp, t.hp + sq.healPerSec * TICK);
          } else {
            const d = dist;
            sq.x += ((t.x - sq.x) / d) * sq.speed * TICK;
            sq.y += ((t.y - sq.y) / d) * sq.speed * TICK;
          }
        }
        continue;
      }
      const foe = nearest(attackers, sq, (a) => [a.x, a.y]);
      if (!foe) continue;
      const dist = Math.hypot(foe.x - sq.x, foe.y - sq.y);
      // leash: defenders chase within a radius of their post, doctrine-dependent
      const leash = defTown.defenseDoctrine === 'DefendKeep' ? 2.5 : 4.5;
      const postDist = Math.hypot((sq.postX ?? KEEP_X) - foe.x, (sq.postY ?? KEEP_Y) - foe.y);
      if (dist <= sq.range + 0.15) {
        if (sq.attackCooldown <= 0) {
          sq.attackCooldown = sq.cooldown;
          damageSquad(sim, foe, sq.dmg);
          sim.events.push({ tick: sim.tick, kind: 'hit', x: foe.x, y: foe.y, squadId: sq.id });
        }
        // skirmishers kite melee foes
        if (sq.behavior === 'Skirmisher' && dist < 1.4) {
          sq.x += Math.sign(sq.x - foe.x) * sq.speed * TICK * 0.8;
          sq.y += Math.sign(sq.y - foe.y) * sq.speed * TICK * 0.8;
        }
      } else if (postDist <= leash) {
        const d = dist;
        sq.x += ((foe.x - sq.x) / d) * sq.speed * TICK;
        sq.y += ((foe.y - sq.y) / d) * sq.speed * TICK;
      }
      sq.x = Math.max(0, Math.min(SIZE - 1, sq.x));
      sq.y = Math.max(0, Math.min(SIZE - 1, sq.y));
    }
  }

  // Towers + keep + temples fire
  for (const b of defTown.buildings) {
    if (b.destroyed) continue;
    const def = cardDef(b.cardId);
    if (def.attack) {
      let cd = sim.towerCooldowns.get(b.uid) ?? 0;
      cd -= TICK;
      let range = def.attack.range + (b.level >= 2 ? 0.5 : 0);
      if (b.cardId === 'archer_tower') {
        if (adjacencyNotes(defTown, b).some((n) => n.includes('range'))) range += 1;
        const tile = sim.defender.grid[b.y]?.[b.x];
        if (tile && tile.district === 'highlands' && defTown.expansions.includes('highlands')) range += 1;
      }
      if (cd <= 0) {
        const inRange = attackers.filter((a) => Math.hypot(a.x - b.x, a.y - b.y) <= range);
        const t = nearest(inRange, { x: b.x, y: b.y }, (a) => [a.x, a.y]);
        if (t) {
          let dmg = def.attack.dmg * b.level;
          if (hasBonus(defTown, 'RANGER', 2)) dmg *= 1.1;
          damageSquad(sim, t, dmg);
          sim.events.push({ tick: sim.tick, kind: 'hit', x: t.x, y: t.y, buildingUid: b.uid });
          cd = def.attack.cooldown;
        }
      }
      sim.towerCooldowns.set(b.uid, cd);
    }
    if (def.healPerSec) {
      for (const d of defenders) {
        if (Math.hypot(d.x - b.x, d.y - b.y) <= 2.2 && d.hp < d.maxHp) {
          d.hp = Math.min(d.maxHp, d.hp + def.healPerSec * TICK);
        }
      }
    }
  }
  // Keep fires at nearby attackers
  sim.keepAttackCooldown -= TICK;
  if (sim.keepAttackCooldown <= 0) {
    const inRange = attackers.filter((a) => Math.hypot(a.x - KEEP_X, a.y - KEEP_Y) <= KEEP.attack.range);
    const t = nearest(inRange, { x: KEEP_X, y: KEEP_Y }, (a) => [a.x, a.y]);
    if (t) {
      damageSquad(sim, t, KEEP.attack.dmg * defTown.age);
      sim.events.push({ tick: sim.tick, kind: 'hit', x: t.x, y: t.y });
      sim.keepAttackCooldown = KEEP.attack.cooldown;
    }
  }
}

function finish(sim: CombatSim, attackers: Squad[], defenders: Squad[]): void {
  sim.done = true;
  const defTown = sim.defender.state;
  const totalAtk = sim.squads.filter((s) => s.side === 'attacker').length;
  const destroyed = defTown.buildings.filter((b) => b.destroyed).length;

  // Timer-expiry partial keep damage, proportional to what attackers accomplished.
  if (!sim.keepDestroyed && sim.tick >= MAX_TICKS && attackers.length > 0) {
    const partial = destroyed * 12 + attackers.length * 8;
    defTown.keepHp = Math.max(1, defTown.keepHp - partial); // partial damage never eliminates
  }

  const loot = sim.isPvE || totalAtk === 0
    ? 0
    : Math.min(12, 2 + destroyed * 2 + (sim.keepDestroyed ? 5 : 0) +
        (sim.attackerTown.raidDoctrine === 'Plunder' ? destroyed : 0));

  sim.report = {
    attackerId: sim.attackerTown.playerId,
    defenderId: defTown.playerId,
    keepDamage: 0, // filled by match from before/after HP
    keepDestroyed: sim.keepDestroyed,
    buildingsDestroyed: destroyed,
    attackersLost: totalAtk - attackers.length,
    defendersLost: sim.squads.filter((s) => s.side === 'defender' && s.dead).length,
    loot,
    ticks: sim.tick,
  };
  sim.events.push({ tick: sim.tick, kind: 'end' });
}

// Run a combat to completion instantly (background raids, headless tests).
export function resolveCombatHeadless(sim: CombatSim): RaidReport {
  while (!sim.done) stepCombat(sim);
  return sim.report!;
}
