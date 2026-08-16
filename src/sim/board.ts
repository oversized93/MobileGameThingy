// The town board: a 9x9 tile grid shared by every town (competitive-balance
// template). Roads run from the South and East edges to the central Keep.
// ~16 buildable plots at start; district expansions append more.

export const SIZE = 9;
export const KEEP_X = 4;
export const KEEP_Y = 4;

export type TileKind = 'road' | 'plot' | 'scenery' | 'keep';

export interface Tile {
  x: number;
  y: number;
  kind: TileKind;
  district: 'core' | 'farmlands' | 'highlands';
  unlocked: boolean;
}

// y increases northward; south edge is y=0, east edge is x=SIZE-1.
export function roadTiles(): Set<string> {
  const road = new Set<string>();
  for (let y = 0; y < KEEP_Y; y++) road.add(`${KEEP_X},${y}`); // south road
  for (let x = SIZE - 1; x > KEEP_X; x--) road.add(`${x},${KEEP_Y}`); // east road
  return road;
}

const CORE_PLOTS: Array<[number, number]> = [
  // ring around the keep, skipping road tiles
  [3, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5], [5, 5],
  // second ring, south/east biased (near the action)
  [2, 3], [6, 3], [2, 4], [2, 5], [6, 5], [3, 2], [5, 2], [2, 2], [6, 2],
];

const FARMLANDS_PLOTS: Array<[number, number]> = [
  [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [3, 7],
];
const HIGHLANDS_PLOTS: Array<[number, number]> = [
  [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
];

export function makeBoard(): Tile[][] {
  const road = roadTiles();
  const grid: Tile[][] = [];
  const plotSet = new Map<string, 'core' | 'farmlands' | 'highlands'>();
  for (const [x, y] of CORE_PLOTS) plotSet.set(`${x},${y}`, 'core');
  for (const [x, y] of FARMLANDS_PLOTS) plotSet.set(`${x},${y}`, 'farmlands');
  for (const [x, y] of HIGHLANDS_PLOTS) plotSet.set(`${x},${y}`, 'highlands');

  for (let y = 0; y < SIZE; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < SIZE; x++) {
      const key = `${x},${y}`;
      let kind: TileKind = 'scenery';
      let district: Tile['district'] = 'core';
      if (x === KEEP_X && y === KEEP_Y) kind = 'keep';
      else if (road.has(key)) kind = 'road';
      else if (plotSet.has(key)) {
        kind = 'plot';
        district = plotSet.get(key)!;
      }
      row.push({ x, y, kind, district, unlocked: district === 'core' });
    }
    grid.push(row);
  }
  return grid;
}

export function unlockDistrict(grid: Tile[][], district: 'farmlands' | 'highlands'): void {
  for (const row of grid) {
    for (const t of row) {
      if (t.district === district) t.unlocked = true;
    }
  }
}

// Enemy entry points (tile coords just inside the map on each road).
export const ENTRANCES: Array<{ x: number; y: number }> = [
  { x: KEEP_X, y: 0 }, // south road
  { x: SIZE - 1, y: KEEP_Y }, // east road
];

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

export function neighbors4(x: number, y: number): Array<[number, number]> {
  return ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Array<[number, number]>).filter(
    ([nx, ny]) => inBounds(nx, ny),
  );
}
