import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SIZE, KEEP_X, KEEP_Y, type Tile } from '../sim/board';
import { cardDef } from '../sim/cards';
import type { TownRuntime } from '../sim/town';
import type { CombatSim, Squad } from '../sim/combat';

// Renders ONE town (the player's) as a warm low-poly diorama.
// Buildings are primitive assemblies; squads are groups of little capsule soldiers.

const PALETTE = {
  ground: 0x4a5d3a,
  groundVar: 0x556842,
  road: 0x8a7a5c,
  plot: 0x5d6e48,
  plotLocked: 0x3d4a34,
  scenery: 0x44563a,
  keepStone: 0x9a938a,
  wood: 0x8a6a42,
  woodDark: 0x6b4f2e,
  roofRed: 0xa85c48,
  roofThatch: 0xc9a45c,
  stone: 0x8a8478,
  wall: 0xa39c8e,
  defender: 0x4a7ab5,
  attacker: 0xb54a4a,
  jarl: 0xe8b64c,
  hpGreen: 0x6ba34c,
  hpRed: 0x3a1f18,
};

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  raycaster = new THREE.Raycaster();
  groundTiles: THREE.Mesh[] = [];
  buildingMeshes = new Map<number, THREE.Group>();
  squadMeshes = new Map<number, THREE.Group>();
  keepMesh!: THREE.Group;
  highlight: THREE.Mesh;
  hpBars = new Map<string, { bg: THREE.Sprite; fill: THREE.Sprite }>();
  effects: Array<{ mesh: THREE.Object3D; life: number }> = [];
  tileGroup = new THREE.Group();
  private desiredAzimuth = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a3540);
    this.scene.fog = new THREE.Fog(0x2a3540, 34, 70);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(KEEP_X, 10, KEEP_Y - 9);

    // Mobile-first camera: one finger NEVER moves the camera (it's reserved for
    // drag-drop). Fixed polished angle; pinch/wheel zoom only; rotation happens
    // exclusively via the snap-rotate button (rotateStep).
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(KEEP_X, 0, KEEP_Y);
    this.controls.enableRotate = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 34;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // lights: warm sun + cool sky fill
    const sun = new THREE.DirectionalLight(0xffe8c0, 2.6);
    sun.position.set(6, 12, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.far = 30;
    sun.target.position.set(KEEP_X, 0, KEEP_Y);
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x3a4a2e, 0.9));

    // base ground plane (big, under everything)
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(KEEP_X, -0.05, KEEP_Y);
    base.receiveShadow = true;
    this.scene.add(base);
    this.scene.add(this.tileGroup);

    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshBasicMaterial({ color: 0xe8b64c, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.02;
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.desiredAzimuth = Math.atan2(
      this.camera.position.x - KEEP_X,
      this.camera.position.z - KEEP_Y,
    );

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Snap-rotate the view 45° (the only rotation control — mobile-safe).
  rotateStep(): void {
    this.desiredAzimuth += Math.PI / 4;
  }

  // Frame the full board: pick the closest distance (at an aspect-appropriate
  // tilt) where every board corner is on screen with margin for the HUD.
  frameBoard(): void {
    const t = this.controls.target;
    // steeper (more top-down) on tall/narrow screens so the square board fits
    const polar = this.camera.aspect < 0.8 ? 0.52 : 0.72; // radians from vertical
    const az = this.desiredAzimuth;
    const corners = [
      new THREE.Vector3(-0.6, 0, -0.6),
      new THREE.Vector3(SIZE - 0.4, 0, -0.6),
      new THREE.Vector3(-0.6, 0, SIZE - 0.4),
      new THREE.Vector3(SIZE - 0.4, 0, SIZE - 0.4),
    ];
    let dist = 8;
    for (; dist < 33; dist += 0.5) {
      this.camera.position.set(
        t.x + dist * Math.sin(polar) * Math.sin(az),
        t.y + dist * Math.cos(polar),
        t.z + dist * Math.sin(polar) * Math.cos(az),
      );
      this.camera.lookAt(t);
      this.camera.updateMatrixWorld(true);
      const fits = corners.every((c) => {
        const p = c.clone().project(this.camera);
        // asymmetric vertical margin: keep the near rows above the build bar
        return Math.abs(p.x) < 0.9 && p.y > -0.56 && p.y < 0.52;
      });
      if (fits) break;
    }
    this.controls.update();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameBoard();
  }

  buildTiles(grid: Tile[][]): void {
    this.tileGroup.clear();
    this.groundTiles = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const t = grid[y][x];
        let color = PALETTE.scenery;
        if (t.kind === 'road') color = PALETTE.road;
        else if (t.kind === 'plot') color = t.unlocked ? PALETTE.plot : PALETTE.plotLocked;
        else if (t.kind === 'keep') color = PALETTE.road;
        else color = ((x + y) % 2 === 0) ? PALETTE.scenery : PALETTE.groundVar;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.98, 0.08, 0.98),
          new THREE.MeshLambertMaterial({ color }),
        );
        mesh.position.set(x, 0, y);
        mesh.receiveShadow = true;
        mesh.userData = { tileX: x, tileY: y, kind: t.kind, unlocked: t.unlocked };
        this.tileGroup.add(mesh);
        this.groundTiles.push(mesh);
        // scenery trees
        if (t.kind === 'scenery' && ((x * 7 + y * 13) % 5 === 0)) {
          const tree = makeTree();
          tree.position.set(x + 0.18, 0, y - 0.14);
          this.tileGroup.add(tree);
        }
      }
    }
    // keep
    if (this.keepMesh) this.scene.remove(this.keepMesh);
    this.keepMesh = makeKeep();
    this.keepMesh.position.set(KEEP_X, 0, KEEP_Y);
    this.scene.add(this.keepMesh);
  }

  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.groundTiles, false);
    if (hits.length === 0) return null;
    const u = hits[0].object.userData;
    return { x: u.tileX, y: u.tileY };
  }

  showHighlight(x: number, y: number, ok: boolean): void {
    this.highlight.visible = true;
    this.highlight.position.set(x, 0.06, y);
    (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x7fae6a : 0xb85c5c);
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  syncTown(town: TownRuntime): void {
    // add/update building meshes
    const seen = new Set<number>();
    for (const b of town.state.buildings) {
      seen.add(b.uid);
      let g = this.buildingMeshes.get(b.uid);
      if (!g) {
        g = makeBuilding(b.cardId, b.level);
        this.buildingMeshes.set(b.uid, g);
        this.scene.add(g);
        // placement pop
        g.scale.setScalar(0.1);
      }
      g.position.set(b.x, 0, b.y);
      if (g.userData.level !== b.level) {
        this.scene.remove(g);
        const ng = makeBuilding(b.cardId, b.level);
        ng.position.set(b.x, 0, b.y);
        this.buildingMeshes.set(b.uid, ng);
        this.scene.add(ng);
        g = ng;
      }
      // destroyed = sunken + dark
      const targetY = b.destroyed ? -0.35 : 0;
      g.position.y += (targetY - g.position.y) * 0.2;
      if (g.scale.x < 1) g.scale.setScalar(Math.min(1, g.scale.x + 0.12));
    }
    for (const [uid, g] of this.buildingMeshes) {
      if (!seen.has(uid)) {
        this.scene.remove(g);
        this.buildingMeshes.delete(uid);
      }
    }
  }

  syncCombat(sim: CombatSim | undefined): void {
    const seen = new Set<number>();
    if (sim) {
      for (const sq of sim.squads) {
        if (sq.dead) continue;
        // hide staggered attackers that haven't entered yet
        if (sq.side === 'attacker' && sq.attackCooldown > 1.5) continue;
        seen.add(sq.id);
        let g = this.squadMeshes.get(sq.id);
        if (!g) {
          g = makeSquad(sq);
          this.squadMeshes.set(sq.id, g);
          this.scene.add(g);
        }
        g.position.set(sq.x, 0, sq.y);
        (g.userData.setCount as (n: number) => void)(sq.count);
        // hp bar
        this.updateHpBar(`sq${sq.id}`, sq.x, sq.y, 0.85, sq.hp / sq.maxHp, sq.side === 'attacker');
      }
      // combat events -> effects
      for (const ev of sim.events) {
        if (ev.kind === 'hit' && ev.x !== undefined) this.spawnHit(ev.x, ev.y!);
        if (ev.kind === 'buildingDestroyed' && ev.x !== undefined) this.spawnSmoke(ev.x, ev.y!);
        if (ev.kind === 'trap' && ev.x !== undefined) this.spawnHit(ev.x, ev.y!, 0xe8b64c);
        if (ev.kind === 'keepHit') this.spawnHit(KEEP_X, KEEP_Y, 0xe86a5c);
        if (ev.kind === 'rally') this.spawnRally();
      }
    }
    for (const [id, g] of this.squadMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.squadMeshes.delete(id);
        this.removeHpBar(`sq${id}`);
      }
    }
  }

  syncBuildingBars(town: TownRuntime, inCombat: boolean): void {
    for (const b of town.state.buildings) {
      const key = `b${b.uid}`;
      if (inCombat && !b.destroyed && b.hp < b.maxHp) {
        this.updateHpBar(key, b.x, b.y, 1.3, b.hp / b.maxHp, false);
      } else {
        this.removeHpBar(key);
      }
    }
    // keep bar always during combat
    const t = town.state;
    if (inCombat) {
      this.updateHpBar('keep', KEEP_X, KEEP_Y, 2.6, t.keepHp / t.keepMaxHp, false);
    } else {
      this.removeHpBar('keep');
    }
  }

  private updateHpBar(key: string, x: number, y: number, h: number, frac: number, enemy: boolean): void {
    let bar = this.hpBars.get(key);
    if (!bar) {
      const bgMat = new THREE.SpriteMaterial({ color: PALETTE.hpRed, depthTest: false });
      const fillMat = new THREE.SpriteMaterial({ color: enemy ? 0xb54a4a : PALETTE.hpGreen, depthTest: false });
      const bg = new THREE.Sprite(bgMat);
      const fill = new THREE.Sprite(fillMat);
      bg.renderOrder = 90;
      fill.renderOrder = 91;
      this.scene.add(bg, fill);
      bar = { bg, fill };
      this.hpBars.set(key, bar);
    }
    const f = Math.max(0, Math.min(1, frac));
    bar.bg.position.set(x, h, y);
    bar.bg.scale.set(0.62, 0.07, 1);
    bar.fill.position.set(x - (0.6 * (1 - f)) / 2, h, y);
    bar.fill.scale.set(0.6 * f, 0.05, 1);
  }

  private removeHpBar(key: string): void {
    const bar = this.hpBars.get(key);
    if (!bar) return;
    this.scene.remove(bar.bg, bar.fill);
    this.hpBars.delete(key);
  }

  spawnHit(x: number, y: number, color = 0xffffff): void {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    m.position.set(x + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.3, y + (Math.random() - 0.5) * 0.3);
    this.scene.add(m);
    this.effects.push({ mesh: m, life: 0.25 });
  }

  spawnSmoke(x: number, y: number): void {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x555049, transparent: true, opacity: 0.7 }),
      );
      m.position.set(x + (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.6, y + (Math.random() - 0.5) * 0.5);
      this.scene.add(m);
      this.effects.push({ mesh: m, life: 0.8 + Math.random() * 0.4 });
    }
  }

  spawnRally(): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.06, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xe8b64c, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(KEEP_X, 0.3, KEEP_Y);
    this.scene.add(ring);
    this.effects.push({ mesh: ring, life: 1.2 });
  }

  render(dt: number): void {
    // effects decay
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      e.mesh.position.y += dt * 0.8;
      if (e.mesh instanceof THREE.Mesh) {
        const mat = e.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, Math.min(1, e.life));
      }
      if (e.mesh.scale && (e.mesh as THREE.Mesh).geometry instanceof THREE.TorusGeometry) {
        e.mesh.scale.addScalar(dt * 4);
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.effects.splice(i, 1);
      }
    }
    // Ease toward the desired snap-rotation angle
    const target = this.controls.target;
    const off = this.camera.position.clone().sub(target);
    const curAz = Math.atan2(off.x, off.z);
    let delta = this.desiredAzimuth - curAz;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > 0.001) {
      const step = delta * Math.min(1, dt * 6);
      const cos = Math.cos(step);
      const sin = Math.sin(step);
      const nx = off.x * cos + off.z * sin;
      const nz = -off.x * sin + off.z * cos;
      this.camera.position.set(target.x + nx, this.camera.position.y, target.z + nz);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------- mesh factories (low-poly primitive assemblies) ----------

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5), lambert(PALETTE.woodDark)));
  trunk.position.y = 0.15;
  const fol = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), lambert(0x3d5a35)));
  fol.position.y = 0.55;
  g.add(trunk, fol);
  return g;
}

function makeKeep(): THREE.Group {
  const g = new THREE.Group();
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.85), lambert(PALETTE.keepStone)));
  base.position.y = 0.35;
  const tower = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 8), lambert(PALETTE.stone)));
  tower.position.set(0, 0.9, 0);
  const roof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 8), lambert(PALETTE.roofRed)));
  roof.position.y = 1.5;
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), lambert(PALETTE.woodDark));
  flagPole.position.y = 1.85;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshBasicMaterial({ color: 0xe8b64c, side: THREE.DoubleSide }));
  flag.position.set(0.12, 1.9, 0);
  g.add(base, tower, roof, flagPole, flag);
  return g;
}

function makeBuilding(cardId: string, level: number): THREE.Group {
  const g = new THREE.Group();
  g.userData.level = level;
  const s = level >= 2 ? 1.15 : 1;
  const add = (m: THREE.Mesh) => g.add(shadowed(m));

  switch (cardId) {
    case 'house': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.35 * s, 0.5 * s), lambert(PALETTE.wood));
      body.position.y = 0.175 * s;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.42 * s, 0.3 * s, 4), lambert(PALETTE.roofRed));
      roof.position.y = 0.5 * s;
      roof.rotation.y = Math.PI / 4;
      add(body); add(roof);
      break;
    }
    case 'farm': {
      const field = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.8), lambert(0x9a8a4c));
      field.position.y = 0.05;
      const rows = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.09, 0.1), lambert(0xb5a35c));
      rows.position.set(0, 0.06, -0.2);
      const rows2 = rows.clone();
      rows2.position.z = 0.1;
      const hut = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), lambert(PALETTE.woodDark));
      hut.position.set(0.25, 0.12, 0.28);
      add(field); add(rows); add(rows2 as THREE.Mesh); add(hut);
      break;
    }
    case 'market': {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.4), lambert(PALETTE.wood));
      stall.position.y = 0.12;
      const awning = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.5), lambert(0xc9583f));
      awning.position.y = 0.35;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4), lambert(PALETTE.woodDark));
      post.position.set(0.25, 0.18, 0.2);
      const post2 = post.clone(); post2.position.x = -0.25;
      add(stall); add(awning); add(post); add(post2 as THREE.Mesh);
      break;
    }
    case 'barracks': {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.4 * s, 0.55 * s), lambert(PALETTE.woodDark));
      hall.position.y = 0.2 * s;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(0.78 * s, 0.12, 0.62 * s), lambert(0x6b6258));
      roof.position.y = 0.46 * s;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.25), new THREE.MeshBasicMaterial({ color: 0xb54a4a, side: THREE.DoubleSide }));
      banner.position.set(0, 0.4, 0.29 * s);
      add(hall); add(roof); g.add(banner);
      break;
    }
    case 'archer_tower': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.24 * s, 0.9 * s, 6), lambert(PALETTE.stone));
      tower.position.y = 0.45 * s;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.22 * s, 0.18, 6), lambert(PALETTE.wall));
      top.position.y = 0.95 * s;
      add(tower); add(top);
      break;
    }
    case 'blacksmith': {
      const shop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.5), lambert(0x5c4a3a));
      shop.position.y = 0.18;
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), lambert(PALETTE.stone));
      chimney.position.set(0.18, 0.4, -0.12);
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), lambert(0x3a3a3f));
      anvil.position.set(-0.2, 0.06, 0.3);
      add(shop); add(chimney); add(anvil);
      break;
    }
    case 'wall': {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.55 * s, 0.34), lambert(PALETTE.wall));
      wall.position.y = 0.28 * s;
      const cren = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.1, 0.38), lambert(PALETTE.stone));
      cren.position.y = 0.58 * s;
      add(wall); add(cren);
      break;
    }
    case 'gatehouse': {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.7 * s, 0.4), lambert(PALETTE.wall));
      l.position.set(-0.32, 0.35 * s, 0);
      const r = l.clone(); r.position.x = 0.32;
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.4), lambert(PALETTE.stone));
      arch.position.y = 0.72 * s;
      add(l); add(r as THREE.Mesh); add(arch);
      break;
    }
    case 'tavern': {
      const inn = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 0.42 * s, 0.55 * s), lambert(PALETTE.wood));
      inn.position.y = 0.21 * s;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 0.32 * s, 4), lambert(PALETTE.roofThatch));
      roof.position.y = 0.58 * s;
      roof.rotation.y = Math.PI / 4;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.02), lambert(0xe8b64c));
      sign.position.set(0.34, 0.35, 0.2);
      add(inn); add(roof); add(sign);
      break;
    }
    case 'temple': {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.65), lambert(0xd8d2c4));
      hall.position.y = 0.25;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), lambert(0xb5ae9e));
      spire.position.y = 0.75;
      add(hall); add(spire);
      break;
    }
    case 'spike_pit': {
      const pit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.7), lambert(0x2e2a22));
      pit.position.y = 0.03;
      add(pit);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 4), lambert(0x8a8478));
        spike.position.set((Math.random() - 0.5) * 0.5, 0.12, (Math.random() - 0.5) * 0.5);
        add(spike);
      }
      break;
    }
    default: {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), lambert(PALETTE.wood));
      box.position.y = 0.2;
      add(box);
    }
  }
  return g;
}

function makeSquad(sq: Squad): THREE.Group {
  const g = new THREE.Group();
  const color = sq.isJarl ? PALETTE.jarl : sq.side === 'attacker' ? PALETTE.attacker : PALETTE.defender;
  const soldiers: THREE.Mesh[] = [];
  const scale = sq.isJarl ? 1.5 : 1;
  for (let i = 0; i < sq.size; i++) {
    const body = shadowed(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.06 * scale, 0.14 * scale, 2, 6),
      lambert(color),
    ));
    const angle = (i / Math.max(1, sq.size)) * Math.PI * 2;
    const r = sq.size > 1 ? 0.16 : 0;
    body.position.set(Math.cos(angle) * r, 0.16 * scale, Math.sin(angle) * r);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 6, 6), lambert(0xd8b89a));
    head.position.set(body.position.x, 0.32 * scale, body.position.z);
    g.add(body, head);
    body.userData.head = head;
    soldiers.push(body);
  }
  g.userData.setCount = (n: number) => {
    soldiers.forEach((b, i) => {
      b.visible = i < n;
      (b.userData.head as THREE.Mesh).visible = i < n;
    });
  };
  return g;
}
