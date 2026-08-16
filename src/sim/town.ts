import { CARDS, KEEP, STARTER_DECK, TRAIT_BREAKPOINTS, cardDef } from './cards';
import { makeBoard, unlockDistrict, type Tile } from './board';
import type { Command, OwnedUnit, PlacedBuilding, TownState, Trait } from './types';

export interface TownRuntime {
  state: TownState;
  grid: Tile[][];
}

const BOT_NAMES = ['Ragnar', 'Elswyn', 'Torvald'];

export function createTown(playerId: number, isBot: boolean): TownRuntime {
  const state: TownState = {
    playerId,
    name: isBot ? BOT_NAMES[(playerId - 1) % BOT_NAMES.length] : 'You',
    isBot,
    eliminated: false,
    keepHp: KEEP.maxHp + KEEP.jarlHpBonus,
    keepMaxHp: KEEP.maxHp + KEEP.jarlHpBonus,
    age: 1,
    gold: 10,
    buildings: [],
    units: [],
    raidDoctrine: 'Breach',
    defenseDoctrine: 'HoldWalls',
    expansions: [],
    rallyUsed: false,
    deck: STARTER_DECK.slice(),
    nextUid: 1,
  };
  return { state, grid: makeBoard() };
}

export function traitCounts(town: TownState): Map<Trait, number> {
  const counts = new Map<Trait, number>();
  const bump = (t: Trait) => counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const b of town.buildings) for (const t of cardDef(b.cardId).traits) bump(t);
  for (const u of town.units) {
    if (u.fromBuildingUid) continue; // generated squads don't add traits
    for (const t of cardDef(u.cardId).traits) bump(t);
  }
  return counts;
}

export function activeBonuses(town: TownState) {
  const counts = traitCounts(town);
  return TRAIT_BREAKPOINTS.filter((bp) => (counts.get(bp.trait) ?? 0) >= bp.count);
}

export function hasBonus(town: TownState, trait: Trait, count: number): boolean {
  return (traitCounts(town).get(trait) ?? 0) >= count;
}

export function buildingAt(town: TownState, x: number, y: number): PlacedBuilding | undefined {
  return town.buildings.find((b) => b.x === x && b.y === y);
}

function adjacentBuildings(town: TownState, b: PlacedBuilding): PlacedBuilding[] {
  return town.buildings.filter(
    (o) => o !== b && Math.abs(o.x - b.x) + Math.abs(o.y - b.y) === 1,
  );
}

export function adjacencyNotes(town: TownState, b: PlacedBuilding): string[] {
  const notes: string[] = [];
  const adj = adjacentBuildings(town, b);
  if (b.cardId === 'farm' && adj.some((o) => o.cardId === 'farm')) notes.push('+2 supply (adjacent Farm)');
  if (b.cardId === 'archer_tower' && adj.some((o) => o.cardId === 'wall')) notes.push('+1 range (adjacent Wall)');
  if (b.cardId === 'barracks' && adj.some((o) => o.cardId === 'blacksmith')) notes.push('Footmen +25% dmg (Blacksmith)');
  if (b.cardId === 'barracks' && adj.some((o) => o.cardId === 'temple')) notes.push('Defenders healed (Temple)');
  return notes;
}

export function popCap(town: TownState): number {
  let cap = 4; // keep provides a base
  for (const b of town.buildings) cap += cardDef(b.cardId).popCap ?? 0;
  return cap;
}

export function popUsed(town: TownState): number {
  let used = 0;
  for (const b of town.buildings) used += cardDef(b.cardId).popCost ?? 0;
  for (const u of town.units) {
    if (u.fromBuildingUid) continue;
    used += cardDef(u.cardId).popCost ?? 0;
  }
  return used;
}

export function supplyProvided(town: TownState): number {
  let s = 6; // keep granary base
  const farmBonus = town.expansions.includes('farmlands') ? 1.2 : 1;
  for (const b of town.buildings) {
    const def = cardDef(b.cardId);
    if (!def.supply) continue;
    let v = def.supply * b.level;
    if (b.cardId === 'farm') {
      const adjFarm = adjacentBuildings(town, b).some((o) => o.cardId === 'farm');
      if (adjFarm) v += 2;
      v *= farmBonus;
    }
    s += v;
  }
  return Math.round(s);
}

export function supplyUsed(town: TownState): number {
  let used = 0;
  for (const u of town.units) used += cardDef(u.cardId).squadSize ?? 1;
  return used;
}

export function goldIncome(town: TownState): number {
  let g = 8; // baseline stipend
  for (const b of town.buildings) g += (cardDef(b.cardId).goldPerRound ?? 0) * b.level;
  return g;
}

export function canPlace(rt: TownRuntime, cardId: string, x: number, y: number): string | null {
  const town = rt.state;
  const def = CARDS[cardId];
  if (!def) return 'Unknown card';
  if (!town.deck.includes(cardId)) return 'Not in your deck';
  if (def.age > town.age) return `Requires Age ${def.age} (upgrade your Keep)`;
  if (town.gold < def.cost) return 'Not enough gold';

  if (def.kind === 'attachment') {
    const target = buildingAt(town, x, y);
    if (!target || target.cardId !== def.attachTo) return `Drop onto a ${CARDS[def.attachTo!].name}`;
    return null;
  }

  if (def.kind === 'unit') {
    if (popUsed(town) + (def.popCost ?? 0) > popCap(town)) return 'Not enough population (build Houses)';
    return null; // units drop anywhere in town; the tile becomes their post
  }

  // structure
  const tile = rt.grid[y]?.[x];
  if (!tile) return 'Out of bounds';
  if (tile.kind === 'road' && !def.isGate && !def.isTrap) return 'Only Gatehouses and traps go on roads';
  if (tile.kind !== 'plot' && tile.kind !== 'road') return 'Cannot build there';
  if (tile.kind === 'plot' && !tile.unlocked) return 'District not unlocked yet';
  if (def.isGate && tile.kind !== 'road') return 'Gatehouse must be placed on a road';
  if (buildingAt(town, x, y)) return 'Tile occupied';
  if (def.popCost && popUsed(town) + def.popCost > popCap(town)) return 'Not enough population (build Houses)';
  return null;
}

function craftsmanHpMult(town: TownState): number {
  return hasBonus(town, 'CRAFTSMAN', 2) ? 1.2 : 1;
}

export function applyCommand(rt: TownRuntime, cmd: Command): string | null {
  const town = rt.state;
  switch (cmd.type) {
    case 'PlaceCard': {
      const { cardId, x, y } = cmd;
      if (cardId === undefined || x === undefined || y === undefined) return 'Bad command';
      const err = canPlace(rt, cardId, x, y);
      if (err) return err;
      const def = CARDS[cardId];
      town.gold -= def.cost;

      if (def.kind === 'attachment') {
        const target = buildingAt(town, x, y)!;
        // vet_captain: barracks squad becomes veterans
        target.level = 2;
        for (const u of town.units) {
          if (u.fromBuildingUid === target.uid) u.cardId = 'vet_footman';
        }
        return null;
      }

      if (def.kind === 'unit') {
        // merge-level: dropping on an identical level-1 unit's post upgrades it
        const existing = town.units.find(
          (u) => u.cardId === cardId && u.level === 1 && u.postX === x && u.postY === y && !u.fromBuildingUid,
        );
        if (existing) {
          existing.level = 2;
          return null;
        }
        town.units.push({
          uid: town.nextUid++, cardId, level: 1, assignment: 'defense', postX: x, postY: y,
        });
        return null;
      }

      // structure: dropping a duplicate onto an existing level-1 building merges it
      const dup = town.buildings.find((b) => b.cardId === cardId && b.x === x && b.y === y);
      if (dup && dup.level === 1) {
        dup.level = 2;
        dup.maxHp = Math.round(dup.maxHp * 1.6);
        dup.hp = dup.maxHp;
        return null;
      }
      const hp = Math.round((def.buildingHp ?? 100) * craftsmanHpMult(town));
      const built: PlacedBuilding = {
        uid: town.nextUid++, cardId, x, y, level: 1, hp, maxHp: hp,
        destroyed: false, trapArmed: def.isTrap ? true : undefined,
      };
      town.buildings.push(built);
      if (cardId === 'barracks') {
        town.units.push({
          uid: town.nextUid++, cardId: 'footman', level: 1, assignment: 'defense',
          postX: x, postY: y, fromBuildingUid: built.uid,
        });
      }
      if (cardId === 'archer_tower') {
        town.units.push({
          uid: town.nextUid++, cardId: 'archer', level: 1, assignment: 'defense',
          postX: x, postY: y, fromBuildingUid: built.uid,
        });
      }
      if (cardId === 'temple') {
        town.units.push({
          uid: town.nextUid++, cardId: 'priest', level: 1, assignment: 'defense',
          postX: x, postY: y, fromBuildingUid: built.uid,
        });
      }
      return null;
    }
    case 'SellBuilding': {
      const idx = town.buildings.findIndex((b) => b.uid === cmd.targetUid);
      if (idx < 0) return 'No such building';
      const b = town.buildings[idx];
      town.gold += Math.floor(CARDS[b.cardId].cost / 2);
      town.units = town.units.filter((u) => u.fromBuildingUid !== b.uid);
      town.buildings.splice(idx, 1);
      return null;
    }
    case 'MoveUnit': {
      const u = town.units.find((x) => x.uid === cmd.targetUid);
      if (!u) return 'No such unit';
      if (!cmd.assignment) return 'Bad command';
      u.assignment = cmd.assignment;
      return null;
    }
    case 'SetRaidDoctrine':
      if (cmd.raidDoctrine) town.raidDoctrine = cmd.raidDoctrine;
      return null;
    case 'SetDefenseDoctrine':
      if (cmd.defenseDoctrine) town.defenseDoctrine = cmd.defenseDoctrine;
      return null;
    case 'UpgradeKeep': {
      if (town.age >= 2) return 'Already Age II';
      if (town.gold < KEEP.upgradeCost) return 'Not enough gold';
      town.gold -= KEEP.upgradeCost;
      town.age = 2;
      town.keepMaxHp += KEEP.upgradeHpBonus;
      town.keepHp += KEEP.upgradeHpBonus;
      return null;
    }
    case 'ChooseExpansion': {
      if (!cmd.expansionId) return 'Bad command';
      if (town.expansions.includes(cmd.expansionId)) return 'Already chosen';
      town.expansions.push(cmd.expansionId);
      unlockDistrict(rt.grid, cmd.expansionId as 'farmlands' | 'highlands');
      return null;
    }
    default:
      return 'Unknown command';
  }
}

export function collectIncome(town: TownState): void {
  town.gold += goldIncome(town);
}

// Between rounds: builder crews visually repair; mechanically an instant reset
// of everything except match-level Keep HP.
export function repairTown(town: TownState): void {
  for (const b of town.buildings) {
    b.destroyed = false;
    b.hp = b.maxHp;
    if (b.trapArmed !== undefined) b.trapArmed = true;
  }
  town.rallyUsed = false;
}
