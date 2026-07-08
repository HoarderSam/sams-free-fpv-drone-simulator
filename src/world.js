import * as THREE from 'three';
import { CONFIG } from './config.js';

// Maps are plain data: generate() returns {boxes, spawn, env}. Collision and
// rendering are both built from that data, so a new map is just a generator.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const box = (x0, y0, z0, x1, y1, z1, color) => ({ min: [x0, y0, z0], max: [x1, y1, z1], color });

// ---------------------------------------------------------------------------
// Classic field: light map for low-end machines
// ---------------------------------------------------------------------------

const BUILDING_COLORS = [0x8a8f98, 0x7b8894, 0x9aa3ab, 0xb0b6bd, 0x6e7a86, 0x5d6b78];
const GATE_COLOR = 0xe8622d;

function generateClassic(cfg = CONFIG.world) {
  const rand = mulberry32(cfg.seed);
  const half = cfg.size / 2 - 20;
  const boxes = [];

  for (let i = 0; i < cfg.buildingCount; i++) {
    const w = 1.5 + rand() * 4;
    const d = 1.5 + rand() * 4;
    const h = 2 + rand() * 9;
    let x, z;
    do {
      x = (rand() * 2 - 1) * half;
      z = (rand() * 2 - 1) * half;
    } while (Math.hypot(x, z - 20) < cfg.spawnClearRadius + Math.max(w, d));
    boxes.push(box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2,
      BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]));
  }

  // Axis-aligned race gates on a rough circle; bars double as colliders.
  const W = 3, H = 2.5, B = 0.25;
  for (let i = 0; i < cfg.gateCount; i++) {
    const ang = (i / cfg.gateCount) * Math.PI * 2;
    const r = 30 + rand() * 25;
    const cx = Math.cos(ang) * r;
    const cz = Math.sin(ang) * r;
    const y0 = 0.8 + rand() * 2;
    const span = W / 2 + B;
    if (rand() < 0.5) {
      boxes.push(
        box(cx - span, y0 - B, cz - B / 2, cx + span, y0, cz + B / 2, GATE_COLOR),
        box(cx - span, y0 + H, cz - B / 2, cx + span, y0 + H + B, cz + B / 2, GATE_COLOR),
        box(cx - span, y0, cz - B / 2, cx - W / 2, y0 + H, cz + B / 2, GATE_COLOR),
        box(cx + W / 2, y0 - B, cz - B / 2, cx + span, y0 + H, cz + B / 2, GATE_COLOR)
      );
    } else {
      boxes.push(
        box(cx - B / 2, y0 - B, cz - span, cx + B / 2, y0, cz + span, GATE_COLOR),
        box(cx - B / 2, y0 + H, cz - span, cx + B / 2, y0 + H + B, cz + span, GATE_COLOR),
        box(cx - B / 2, y0, cz - span, cx + B / 2, y0 + H, cz - W / 2, GATE_COLOR),
        box(cx - B / 2, y0, cz + W / 2, cx + B / 2, y0 + H, cz + span, GATE_COLOR)
      );
    }
  }

  return {
    boxes,
    spawn: { position: [0, CONFIG.drone.collisionRadius, 20], yaw: 0 },
    env: {},
  };
}

// ---------------------------------------------------------------------------
// The Bando: dense freestyle map - a gutted concrete tower with dive holes,
// window bays, a solid core to orbit, and derelict shells around it.
// ---------------------------------------------------------------------------

const BANDO = {
  slabA: 0x9a958c, slabB: 0x8b867d, column: 0xa8a39a, wall: 0x7a756c,
  core: 0x6b665f, rust: 0x8a5a3a, rubble: 0x847f76,
};

// Concrete-frame tower: slab floors with dive holes, columns, partial
// perimeter walls, roof parapet. Everything is AABBs.
function makeTower(boxes, rand, ox, oz, halfX, halfZ, floors) {
  const X0 = ox - halfX, X1 = ox + halfX, Z0 = oz - halfZ, Z1 = oz + halfZ;
  const FH = 4, SLAB = 0.35, TILE = 4, WALL_T = 0.25;
  const nx = Math.round((X1 - X0) / TILE);
  const nz = Math.round((Z1 - Z0) / TILE);

  for (let f = 1; f <= floors; f++) {
    const y = f * FH;
    // 3 dive holes per slab, each widened by one neighbor tile
    const holes = new Set();
    for (let h = 0; h < 3; h++) {
      const hx = Math.floor(rand() * nx);
      const hz = Math.floor(rand() * nz);
      holes.add(hz * nx + hx);
      holes.add(hz * nx + Math.min(nx - 1, hx + 1));
    }
    // emit each tile row as merged runs of solid tiles
    for (let tz = 0; tz < nz; tz++) {
      let run = null;
      for (let tx = 0; tx <= nx; tx++) {
        const solid = tx < nx && !holes.has(tz * nx + tx);
        if (solid) {
          if (run === null) run = tx;
        } else if (run !== null) {
          boxes.push(box(X0 + run * TILE, y - SLAB, Z0 + tz * TILE,
            X0 + tx * TILE, y, Z0 + (tz + 1) * TILE, f % 2 ? BANDO.slabA : BANDO.slabB));
          run = null;
        }
      }
    }

    // perimeter wall bays for this storey: full, spandrel (waist-high), or open
    const yB = y - FH, bays = [];
    for (let tx = 0; tx < nx; tx += 2) {
      bays.push([X0 + tx * TILE, Z0 - WALL_T, X0 + Math.min(nx, tx + 2) * TILE, Z0]);
      bays.push([X0 + tx * TILE, Z1, X0 + Math.min(nx, tx + 2) * TILE, Z1 + WALL_T]);
    }
    for (let tz = 0; tz < nz; tz += 2) {
      bays.push([X0 - WALL_T, Z0 + tz * TILE, X0, Z0 + Math.min(nz, tz + 2) * TILE]);
      bays.push([X1, Z0 + tz * TILE, X1 + WALL_T, Z0 + Math.min(nz, tz + 2) * TILE]);
    }
    for (const [bx0, bz0, bx1, bz1] of bays) {
      const roll = rand();
      const fullChance = f === 1 ? 0.18 : 0.30; // keep the ground floor open
      if (roll < fullChance) {
        boxes.push(box(bx0, yB, bz0, bx1, y - SLAB, bz1, BANDO.wall));
      } else if (roll < fullChance + 0.25) {
        boxes.push(box(bx0, yB, bz0, bx1, yB + 1.1, bz1, BANDO.wall));
      }
    }
  }

  // columns, run full height at every other tile line
  for (let tx = 0; tx <= nx; tx += 2) {
    for (let tz = 0; tz <= nz; tz += Math.max(2, nz)) {
      const cx = X0 + tx * TILE, cz = Z0 + tz * TILE;
      boxes.push(box(cx - 0.25, 0, cz - 0.25, cx + 0.25, floors * FH, cz + 0.25, BANDO.column));
    }
  }
  for (let tx = 0; tx <= nx; tx += 4) {
    const cx = X0 + tx * TILE, cz = (Z0 + Z1) / 2;
    boxes.push(box(cx - 0.25, 0, cz - 0.25, cx + 0.25, floors * FH, cz + 0.25, BANDO.column));
  }

  // roof parapet
  const yR = floors * FH;
  boxes.push(
    box(X0, yR, Z0 - WALL_T, X1, yR + 1, Z0, BANDO.wall),
    box(X0, yR, Z1, X1, yR + 1, Z1 + WALL_T, BANDO.wall),
    box(X0 - WALL_T, yR, Z0 - WALL_T, X0, yR + 1, Z1 + WALL_T, BANDO.wall),
    box(X1, yR, Z0 - WALL_T, X1 + WALL_T, yR + 1, Z1 + WALL_T, BANDO.wall)
  );

  return { X0, X1, Z0, Z1, height: yR };
}

// Small derelict shell: four walls (one with a doorway), optional roof slab.
function makeShell(boxes, rand, cx, cz) {
  const w = 3 + rand() * 4, d = 3 + rand() * 4, h = 3.5 + rand() * 3, t = 0.25;
  const x0 = cx - w, x1 = cx + w, z0 = cz - d, z1 = cz + d;
  const doorWall = Math.floor(rand() * 4);
  const walls = [
    [x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1],
    [x0, z0, x0 + t, z1], [x1 - t, z0, x1, z1],
  ];
  walls.forEach(([wx0, wz0, wx1, wz1], i) => {
    if (i === doorWall) {
      const alongX = wx1 - wx0 > wz1 - wz0;
      const mid = alongX ? (wx0 + wx1) / 2 : (wz0 + wz1) / 2;
      const g = 1.6; // doorway half-width
      if (alongX) {
        boxes.push(box(wx0, 0, wz0, mid - g, h, wz1, BANDO.wall));
        boxes.push(box(mid + g, 0, wz0, wx1, h, wz1, BANDO.wall));
        boxes.push(box(mid - g, 2.2, wz0, mid + g, h, wz1, BANDO.wall));
      } else {
        boxes.push(box(wx0, 0, wz0, wx1, h, mid - g, BANDO.wall));
        boxes.push(box(wx0, 0, mid + g, wx1, h, wz1, BANDO.wall));
        boxes.push(box(wx0, 2.2, mid - g, wx1, h, mid + g, BANDO.wall));
      }
    } else if (rand() < 0.85) {
      boxes.push(box(wx0, 0, wz0, wx1, h, wz1, BANDO.wall));
    }
  });
  if (rand() < 0.7) boxes.push(box(x0, h, z0, x1, h + 0.3, z1, rand() < 0.3 ? BANDO.rust : BANDO.slabB));
}

function generateBando() {
  const rand = mulberry32(4242);
  const boxes = [];

  // main tower + a half-built neighbor
  makeTower(boxes, rand, 0, 0, 16, 10, 5);
  makeTower(boxes, rand, -42, -18, 10, 8, 2);

  // solid service core through the main tower, poking above the roof
  boxes.push(box(6, 0, -3, 11, 22, 3, BANDO.core));

  // derelict shells scattered around
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + rand() * 0.5;
    const r = 30 + rand() * 22;
    const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
    if (Math.hypot(cx, cz - 42) < 10) continue; // keep the spawn clear
    if (cx > -55 && cx < -28 && cz > -30 && cz < -6) continue; // neighbor tower
    makeShell(boxes, rand, cx, cz);
  }

  // rubble field
  for (let i = 0; i < 60; i++) {
    const s = 0.4 + rand() * 2.1;
    const x = (rand() * 2 - 1) * 60;
    const z = (rand() * 2 - 1) * 60;
    if (Math.hypot(x, z - 42) < 8) continue;
    const h = 0.3 + rand() * s;
    boxes.push(box(x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2,
      rand() < 0.12 ? BANDO.rust : BANDO.rubble));
  }

  return {
    boxes,
    spawn: { position: [0, CONFIG.drone.collisionRadius, 42], yaw: 0 },
    env: { sky: 0x9db4c0, fogNear: 50, fogFar: 220, ground: 0x7d8471, grid: 0x6b7261 },
  };
}

// ---------------------------------------------------------------------------

export const MAPS = {
  classic: { name: 'Classic Field', generate: generateClassic },
  bando: { name: 'The Bando', generate: generateBando },
};

export function generateLayout(mapId = 'classic') {
  const map = MAPS[mapId] ?? MAPS.classic;
  return map.generate();
}

// Sphere vs ground plane (y=0) and AABBs, accelerated by a uniform x/z grid
// so dense maps stay O(few) per query at 500 Hz. Returns deepest contact.
export function createCollisionWorld(layout) {
  const boxes = layout.boxes;
  const CELL = 8;
  const cells = new Map();
  const key = (cx, cz) => cx * 100000 + cz;

  boxes.forEach((b, i) => {
    for (let cx = Math.floor(b.min[0] / CELL); cx <= Math.floor(b.max[0] / CELL); cx++) {
      for (let cz = Math.floor(b.min[2] / CELL); cz <= Math.floor(b.max[2] / CELL); cz++) {
        const k = key(cx, cz);
        let bucket = cells.get(k);
        if (!bucket) cells.set(k, (bucket = []));
        bucket.push(i);
      }
    }
  });

  const visited = new Int32Array(boxes.length).fill(-1);
  let queryId = 0;

  return {
    collide(p, r) {
      let best = p.y < r ? { normal: [0, 1, 0], depth: r - p.y } : null;
      queryId++;
      const cx0 = Math.floor((p.x - r) / CELL), cx1 = Math.floor((p.x + r) / CELL);
      const cz0 = Math.floor((p.z - r) / CELL), cz1 = Math.floor((p.z + r) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = cells.get(key(cx, cz));
          if (!bucket) continue;
          for (const i of bucket) {
            if (visited[i] === queryId) continue;
            visited[i] = queryId;
            const b = boxes[i];
            const nx = Math.min(Math.max(p.x, b.min[0]), b.max[0]);
            const ny = Math.min(Math.max(p.y, b.min[1]), b.max[1]);
            const nz = Math.min(Math.max(p.z, b.min[2]), b.max[2]);
            const dx = p.x - nx, dy = p.y - ny, dz = p.z - nz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq >= r * r) continue;
            let normal, depth;
            if (distSq > 1e-12) {
              const dist = Math.sqrt(distSq);
              normal = [dx / dist, dy / dist, dz / dist];
              depth = r - dist;
            } else {
              normal = [0, 1, 0]; // center inside the box: push up as a fallback
              depth = r;
            }
            if (!best || depth > best.depth) best = { normal, depth };
          }
        }
      }
      return best;
    },
  };
}

export function buildWorldScene(scene, layout) {
  const env = {
    sky: 0x87b5d9, fogNear: 60, fogFar: 260,
    ground: 0x6a8f5a, grid: 0x4c5c44,
    ...layout.env,
  };

  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.Fog(env.sky, env.fogNear, env.fogFar);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x54654a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  // Visual ground extends well past the play area so the horizon never shows
  // the plane's edge; collision ground (y=0) is infinite anyway.
  const groundSize = CONFIG.world.size * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ color: env.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(CONFIG.world.size, 100, env.grid, env.grid);
  grid.position.y = 0.02;
  scene.add(grid);

  // All boxes in a single instanced draw call - map density is essentially free.
  const inst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    layout.boxes.length
  );
  inst.frustumCulled = false;
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  layout.boxes.forEach((b, i) => {
    scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    pos.set(b.min[0] + scale.x / 2, b.min[1] + scale.y / 2, b.min[2] + scale.z / 2);
    m.compose(pos, q, scale);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.setHex(b.color));
  });
  scene.add(inst);
}
