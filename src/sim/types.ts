// Core shared types for the simulation. The sim never imports from render/ or ui/.

export type Trait = 'NORD' | 'WARRIOR' | 'RANGER' | 'CRAFTSMAN' | 'DIVINE';

export type Behavior =
  | 'Guard' // engages nearest enemy
  | 'Raider' // beelines economy buildings
  | 'Siegebreaker' // attacks walls/gates first
  | 'Skirmisher' // ranged, kites, prefers ranged targets
  | 'Support'; // stays back, heals allies

export type CardKind = 'structure' | 'unit' | 'attachment';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  cost: number;
  age: 1 | 2;
  traits: Trait[];
  desc: string; // one passive line, max
  // structures
  buildingHp?: number;
  attack?: { dmg: number; range: number; cooldown: number }; // towers / keep
  goldPerRound?: number;
  supply?: number; // food provided
  popCap?: number; // population capacity provided
  popCost?: number; // population consumed
  isWall?: boolean;
  isGate?: boolean;
  isTrap?: boolean;
  trapDmg?: number;
  economy?: boolean; // Raider target
  // units (squads)
  squadSize?: number;
  unitHp?: number; // per soldier
  unitDmg?: number;
  unitRange?: number; // tiles; 1 = melee
  unitSpeed?: number; // tiles/sec
  behavior?: Behavior;
  healPerSec?: number;
  // attachment
  attachTo?: string; // card id it drops onto
}

export interface PlacedBuilding {
  uid: number;
  cardId: string;
  x: number;
  y: number;
  level: 1 | 2;
  hp: number;
  maxHp: number;
  destroyed: boolean; // during current combat only; repaired after
  trapArmed?: boolean;
}

export type WarbandRow = 'FRONT' | 'MID' | 'BACK';

export interface OwnedUnit {
  uid: number;
  cardId: string;
  level: 1 | 2;
  assignment: 'defense' | WarbandRow;
  // defense post: tile where the player dropped them (defense only)
  postX?: number;
  postY?: number;
  fromBuildingUid?: number; // squads maintained by a building (Barracks etc.)
}

export type RaidDoctrine = 'Breach' | 'Plunder' | 'Decapitate';
export type DefenseDoctrine = 'HoldWalls' | 'DefendKeep';

export interface TownState {
  playerId: number;
  name: string;
  isBot: boolean;
  eliminated: boolean;
  keepHp: number;
  keepMaxHp: number;
  age: 1 | 2;
  gold: number;
  buildings: PlacedBuilding[];
  units: OwnedUnit[];
  raidDoctrine: RaidDoctrine;
  defenseDoctrine: DefenseDoctrine;
  expansions: string[]; // district ids chosen
  rallyUsed: boolean; // Jarl active, per combat
  deck: string[]; // card ids purchasable
  nextUid: number;
}

export type Phase = 'build' | 'combat' | 'results' | 'gameover';

export interface Pairing {
  attackerId: number;
  defenderId: number;
}

export interface RaidReport {
  attackerId: number;
  defenderId: number;
  keepDamage: number;
  keepDestroyed: boolean;
  buildingsDestroyed: number;
  attackersLost: number;
  defendersLost: number;
  loot: number;
  ticks: number;
}

export interface Command {
  type:
    | 'PlaceCard'
    | 'SellBuilding'
    | 'MoveUnit' // change assignment (defense <-> warband row)
    | 'SetRaidDoctrine'
    | 'SetDefenseDoctrine'
    | 'UpgradeKeep'
    | 'ChooseExpansion';
  playerId: number;
  cardId?: string;
  x?: number;
  y?: number;
  targetUid?: number;
  assignment?: 'defense' | WarbandRow;
  raidDoctrine?: RaidDoctrine;
  defenseDoctrine?: DefenseDoctrine;
  expansionId?: string;
}
