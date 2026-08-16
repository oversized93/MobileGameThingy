import type { CardDef, Trait } from './types';

// The vertical-slice card set: 11 structures + 3 unit cards + 1 attachment = the
// 15-card starter deck (deck size is tunable 12-16 per design). Age 2 cards sit
// visibly locked until the Keep is upgraded.

export const CARDS: Record<string, CardDef> = {
  house: {
    id: 'house', name: 'House', kind: 'structure', cost: 2, age: 1, traits: [],
    desc: '+3 population capacity', buildingHp: 120, popCap: 3, economy: true,
  },
  farm: {
    id: 'farm', name: 'Farm', kind: 'structure', cost: 3, age: 1, traits: [],
    desc: '+4 supply. Adjacent Farms: +2 each', buildingHp: 100, supply: 4, economy: true,
  },
  market: {
    id: 'market', name: 'Market', kind: 'structure', cost: 3, age: 1, traits: [],
    desc: '+3 gold each round', buildingHp: 120, goldPerRound: 3, economy: true,
  },
  barracks: {
    id: 'barracks', name: 'Barracks', kind: 'structure', cost: 4, age: 1, traits: ['WARRIOR'],
    desc: 'Maintains a squad of 4 Footmen', buildingHp: 200, popCost: 2,
  },
  archer_tower: {
    id: 'archer_tower', name: 'Archer Tower', kind: 'structure', cost: 4, age: 1, traits: ['RANGER'],
    desc: 'Shoots attackers. Adjacent Wall: +1 range', buildingHp: 180,
    attack: { dmg: 14, range: 3.2, cooldown: 0.9 }, popCost: 1,
  },
  blacksmith: {
    id: 'blacksmith', name: 'Blacksmith', kind: 'structure', cost: 4, age: 1, traits: ['CRAFTSMAN'],
    desc: 'Adjacent Barracks: Footmen +25% damage', buildingHp: 160, popCost: 1, economy: true,
  },
  wall: {
    id: 'wall', name: 'Wall', kind: 'structure', cost: 1, age: 1, traits: ['CRAFTSMAN'],
    desc: 'Blocks enemies until destroyed', buildingHp: 320, isWall: true,
  },
  gatehouse: {
    id: 'gatehouse', name: 'Gatehouse', kind: 'structure', cost: 3, age: 1, traits: ['WARRIOR'],
    desc: 'Road choke. Defenders here gain +1 armor', buildingHp: 400, isGate: true,
  },
  tavern: {
    id: 'tavern', name: 'Tavern', kind: 'structure', cost: 4, age: 1, traits: ['NORD'],
    desc: '+1 gold/round, +2 pop capacity', buildingHp: 140, goldPerRound: 1, popCap: 2, economy: true,
  },
  temple: {
    id: 'temple', name: 'Temple', kind: 'structure', cost: 5, age: 2, traits: ['DIVINE'],
    desc: 'Heals nearby defenders during combat', buildingHp: 180, healPerSec: 6, popCost: 1,
  },
  spike_pit: {
    id: 'spike_pit', name: 'Spike Pit', kind: 'structure', cost: 2, age: 2, traits: ['CRAFTSMAN'],
    desc: 'First enemy squad stepping here takes heavy damage', buildingHp: 60,
    isTrap: true, trapDmg: 90,
  },
  shieldbearer: {
    id: 'shieldbearer', name: 'Nord Shieldbearer', kind: 'unit', cost: 3, age: 1,
    traits: ['NORD', 'WARRIOR'], desc: 'Guard: tough frontline squad', popCost: 1,
    squadSize: 3, unitHp: 90, unitDmg: 9, unitRange: 1, unitSpeed: 1.1, behavior: 'Guard',
  },
  hunter: {
    id: 'hunter', name: 'Hunter', kind: 'unit', cost: 2, age: 1,
    traits: ['RANGER'], desc: 'Skirmisher: ranged, kites melee', popCost: 1,
    squadSize: 3, unitHp: 45, unitDmg: 11, unitRange: 2.6, unitSpeed: 1.4, behavior: 'Skirmisher',
  },
  spearman: {
    id: 'spearman', name: 'Spearman', kind: 'unit', cost: 2, age: 1,
    traits: ['WARRIOR'], desc: 'Guard: cheap steady infantry', popCost: 1,
    squadSize: 4, unitHp: 55, unitDmg: 7, unitRange: 1, unitSpeed: 1.2, behavior: 'Guard',
  },
  vet_captain: {
    id: 'vet_captain', name: 'Veteran Captain', kind: 'attachment', cost: 4, age: 2, traits: ['WARRIOR'],
    desc: 'Drop on Barracks: its Footmen become 6 veterans', attachTo: 'barracks',
  },
};

// Units that exist but are not deck cards (generated or PvE).
export const GENERATED_UNITS: Record<string, CardDef> = {
  footman: {
    id: 'footman', name: 'Footman', kind: 'unit', cost: 0, age: 1, traits: ['WARRIOR'],
    desc: 'Guard', squadSize: 4, unitHp: 60, unitDmg: 8, unitRange: 1, unitSpeed: 1.2, behavior: 'Guard',
  },
  vet_footman: {
    id: 'vet_footman', name: 'Veteran Footman', kind: 'unit', cost: 0, age: 2, traits: ['WARRIOR'],
    desc: 'Guard', squadSize: 6, unitHp: 75, unitDmg: 10, unitRange: 1, unitSpeed: 1.2, behavior: 'Guard',
  },
  archer: {
    id: 'archer', name: 'Archer', kind: 'unit', cost: 0, age: 1, traits: ['RANGER'],
    desc: 'Skirmisher', squadSize: 2, unitHp: 40, unitDmg: 10, unitRange: 2.8, unitSpeed: 1.3, behavior: 'Skirmisher',
  },
  priest: {
    id: 'priest', name: 'Priest', kind: 'unit', cost: 0, age: 2, traits: ['DIVINE'],
    desc: 'Support: heals', squadSize: 1, unitHp: 50, unitDmg: 0, unitRange: 2, unitSpeed: 1.1,
    behavior: 'Support', healPerSec: 8,
  },
  jarl: {
    id: 'jarl', name: 'The Jarl', kind: 'unit', cost: 0, age: 1, traits: ['NORD', 'WARRIOR'],
    desc: 'Your leader. Fights in defense.', squadSize: 1, unitHp: 320, unitDmg: 20,
    unitRange: 1, unitSpeed: 1.1, behavior: 'Guard',
  },
  goblin: {
    id: 'goblin', name: 'Goblin', kind: 'unit', cost: 0, age: 1, traits: [],
    desc: 'Raider: hits your economy', squadSize: 4, unitHp: 35, unitDmg: 7, unitRange: 1,
    unitSpeed: 1.5, behavior: 'Raider',
  },
  wolfpack: {
    id: 'wolfpack', name: 'Raider Wolfpack', kind: 'unit', cost: 0, age: 1, traits: [],
    desc: 'Guard: fast and vicious', squadSize: 3, unitHp: 55, unitDmg: 10, unitRange: 1,
    unitSpeed: 1.8, behavior: 'Guard',
  },
};

export function cardDef(id: string): CardDef {
  const c = CARDS[id] ?? GENERATED_UNITS[id];
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

export const STARTER_DECK: string[] = [
  'house', 'farm', 'market', 'barracks', 'archer_tower', 'blacksmith', 'wall',
  'gatehouse', 'tavern', 'temple', 'spike_pit', 'shieldbearer', 'hunter',
  'spearman', 'vet_captain',
];

// Trait breakpoints -> town-wide bonuses (kept deliberately small and legible).
export interface TraitBonus {
  trait: Trait;
  count: number;
  desc: string;
}
export const TRAIT_BREAKPOINTS: TraitBonus[] = [
  { trait: 'WARRIOR', count: 2, desc: 'Melee units +10% damage' },
  { trait: 'WARRIOR', count: 4, desc: 'Melee units +15% max HP' },
  { trait: 'RANGER', count: 2, desc: 'Ranged units and towers +10% damage' },
  { trait: 'NORD', count: 2, desc: 'All your units +10% max HP' },
  { trait: 'CRAFTSMAN', count: 2, desc: 'Buildings +20% max HP' },
];

// Keep baseline. Match-level HP; damage persists between rounds.
export const KEEP = {
  maxHp: 900,
  attack: { dmg: 10, range: 2.6, cooldown: 1.2 },
  upgradeCost: 12,
  upgradeHpBonus: 300,
  jarlHpBonus: 150, // Jarl leader passive
};

export const DISTRICTS = [
  { id: 'farmlands', name: 'Farmlands', desc: '+6 plots. Farms +20% supply.' },
  { id: 'highlands', name: 'Highlands', desc: '+5 plots. Towers there +1 range.' },
];
