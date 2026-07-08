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

  // Billboard building facing the spawn, with a painted wall sign
  boxes.push(box(-14, 0, -20, -2, 8, -14, 0x6e7a86));

  return {
    boxes,
    spawn: { position: [0, CONFIG.drone.collisionRadius, 20], yaw: 0 },
    env: {},
    sign: {
      text: 'HOARDER SAM',
      center: [-8, 5, -13.95], // just proud of the building's south face
      size: [11, 2.75],
      rotationY: 0, // plane faces +z, toward the spawn
    },
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
// The Lake: two retaining ponds joined by a concrete spillway gap, with a
// parking lot, office building, and treeline. Water splashes armed quads.
// ---------------------------------------------------------------------------

const LAKE = {
  water: 0x1f4854, berm: 0x7aa05e, bermLow: 0x709657, path: 0x9a8a66,
  concrete: 0x9aa0a2, asphalt: 0x3d4043, line: 0xcfd3d6, pole: 0x2e3236,
  trunk: 0x5a4632, canopy: [0x3f6b35, 0x49793c, 0x35592c],
  reed: [0x6f7a3a, 0x8a7a4a],
  building: 0xb9b2a4, trim: 0x8f887a,
  cars: [0xb8bcc0, 0x2f3336, 0x8c1f1f, 0x1f3f6e, 0xd8d5cd, 0x4a4f45],
};

function makeTree(boxes, rand, x, z) {
  if (rand() < 0.2) { // low bush
    const b = 0.8 + rand() * 0.8;
    boxes.push(box(x - b, 0, z - b, x + b, 0.7 + b, z + b,
      LAKE.canopy[Math.floor(rand() * LAKE.canopy.length)]));
    return;
  }
  boxes.push(box(x - 0.25, 0, z - 0.25, x + 0.25, 2.2, z + 0.25, LAKE.trunk));
  const s = 1.4 + rand() * 1.3;
  const c = LAKE.canopy[Math.floor(rand() * LAKE.canopy.length)];
  const top = 2.2 + s * 1.5;
  boxes.push(box(x - s, 1.8, z - s, x + s, top, z + s, c));
  const s2 = s * 0.55;
  boxes.push(box(x - s2, top, z - s2, x + s2, top + s2 * 1.6, z + s2,
    LAKE.canopy[Math.floor(rand() * LAKE.canopy.length)]));
}

function generateLake() {
  const rand = mulberry32(777);
  const boxes = [];
  const deco = []; // rendered but not collided: reeds, paint lines, paths

  // Linear scale for the ponds and their berms: 2 -> 4x water area. The
  // spillway gap, berm height, cars, and trees stay physical sizes.
  const S = 2;
  const sc = (r) => r.map((v) => v * S);

  // Pond A: teardrop, wide east end narrowing west toward the spillway.
  // Pond B: long north-south pond below it. Overlapping rects fake the curves.
  const A_RECTS = [[30, -48, 72, -8], [10, -42, 40, -12], [-2, -34, 16, -16]].map(sc);
  const B_RECTS = [[-20, -6, 8, 52], [-24, 6, 12, 40], [-16, 50, 4, 58]].map(sc);
  // Water level sits 0.2 m above grade so the surface out-depths the ground
  // grid at long range (2 cm was inside depth-buffer error past ~100 m).
  const water = [...A_RECTS, ...B_RECTS].map(([x0, z0, x1, z1]) =>
    ({ min: [x0, z0], max: [x1, z1], level: 0.2 }));

  // Grass berms ringing both ponds (flat-topped embankments, land-able).
  // The two channel-adjacent segments are pre-adjusted so their scaled edges
  // meet the spillway walls exactly.
  const BERMS = [
    // pond A north edge, stepped along the teardrop
    [28, -53, 74, -48], [8, -47, 32, -42], [-4, -39, 12, -34],
    [72, -50, 77, -6],                     // east cap
    [28, -8, 74, -3], [7, -16, 32, -11],   // south edge, east of the channel
    [-8, -36, -2, -14],                    // west cap of the neck
    // pond B, north tip to south tip
    [-22, -11, 2, -6],                     // north tip, west of the channel
    [8, -6, 13, 8], [12, 6, 17, 40], [8, 38, 13, 54], [4, 52, 9, 60],
    [-18, 58, 6, 63],
    [-25, -6, -20, 8], [-29, 6, -24, 40], [-25, 38, -20, 52], [-21, 50, -16, 60],
  ].map(sc);
  for (const [x0, z0, x1, z1] of BERMS) {
    boxes.push(box(x0, 0, z0, x1, 2.5, z1, LAKE.berm));
    // wider low terrace fakes the embankment slope; keep its toe out of the
    // 6 m spillway gap (x 6..12) so the advertised gap stays flyable low
    const t = [x0 - 2.5, z0 - 2.5, x1 + 2.5, z1 + 2.5];
    if (t[1] < -10 && t[3] > -34) {
      if (t[0] < 12 && t[0] > 4 && t[2] > 12) t[0] = 14;
      else if (t[2] > 6 && t[2] < 14 && t[0] < 6) t[2] = 4;
    }
    boxes.push(box(t[0], 0, t[1], t[2], 1.1, t[3], LAKE.bermLow));
    // narrow mowed dirt track along the crest, centered on the berm
    if (x1 - x0 > 3 && z1 - z0 > 3) {
      const ix = Math.max((x1 - x0 - 2.5) / 2, 1.2);
      const iz = Math.max((z1 - z0 - 2.5) / 2, 1.2);
      deco.push(box(x0 + ix, 2.5, z0 + iz, x1 - ix, 2.56, z1 - iz, LAKE.path));
    }
  }

  // Cattail reeds along the shorelines (skip the spillway channel)
  const CHANNEL = [2, -34, 16, -10];
  for (const w of [...A_RECTS, ...B_RECTS]) {
    const [x0, z0, x1, z1] = w;
    const edges = [
      (t) => [x0 + t * (x1 - x0), z0], (t) => [x0 + t * (x1 - x0), z1],
      (t) => [x0, z0 + t * (z1 - z0)], (t) => [x1, z0 + t * (z1 - z0)],
    ];
    for (const edge of edges) {
      for (let t = 0.02; t < 1; t += 0.045) {
        if (rand() < 0.45) continue;
        const [ex, ez] = edge(t);
        const x = ex + (rand() * 2 - 1) * 1.5;
        const z = ez + (rand() * 2 - 1) * 1.5;
        if (x > CHANNEL[0] && x < CHANNEL[2] && z > CHANNEL[1] && z < CHANNEL[3]) continue;
        // skip interior seams between overlapping rects: no reed lines mid-pond
        const inOther = [...A_RECTS, ...B_RECTS].some((o) => o !== w &&
          x > o[0] + 1 && x < o[2] - 1 && z > o[1] + 1 && z < o[3] - 1);
        if (inOther) continue;
        const h = 0.9 + rand() * 0.8;
        deco.push(box(x - 0.08, 0, z - 0.08, x + 0.08, h, z + 0.08,
          LAKE.reed[Math.floor(rand() * 2)]));
      }
    }
  }

  // Spillway: concrete channel between pond A's neck and pond B's north tip.
  // Still a 6 m gap between 2.2 m walls with a low sill to hop.
  boxes.push(
    box(4, 0, -32, 6, 2.2, -12, LAKE.concrete),
    box(12, 0, -32, 14, 2.2, -12, LAKE.concrete),
    box(6, 0, -22.5, 12, 0.5, -21.5, LAKE.concrete),
    box(6, 0, -32, 12, 0.08, -12, LAKE.concrete)
  );
  boxes.push(box(-12, 0, 116, -4, 1.4, 117.5, LAKE.concrete)); // outfall headwall

  // Parking lot west of the ponds: asphalt, car rows, stall lines, tree islands
  boxes.push(box(-110, 0, -75, -55, 0.04, -25, LAKE.asphalt));
  for (const cx of [-103, -91, -79, -67]) {
    for (let cz = -70; cz <= -31; cz += 4.6) {
      deco.push(box(cx - 2.3, 0.05, cz - 2.36, cx + 2.3, 0.07, cz - 2.24, LAKE.line));
      if (rand() < 0.3) continue; // empty slot
      const color = LAKE.cars[Math.floor(rand() * LAKE.cars.length)];
      boxes.push(box(cx - 1, 0, cz - 2.2, cx + 1, 1.3, cz + 2.2, color));
      boxes.push(box(cx - 0.8, 1.3, cz - 1.1, cx + 0.8, 1.95, cz + 0.9, color));
    }
    makeTree(boxes, rand, cx + 6, -50 + rand() * 6);
  }
  for (const [px, pz] of [[-107, -72], [-58, -72], [-107, -28], [-58, -28]]) {
    boxes.push(box(px - 0.1, 0, pz - 0.1, px + 0.1, 6, pz + 0.1, LAKE.pole));
    boxes.push(box(px - 0.6, 5.7, pz - 0.15, px + 0.6, 6, pz + 0.15, LAKE.pole));
  }

  // Office building north of the lot
  boxes.push(
    box(-100, 0, -92, -70, 9, -78, LAKE.building),
    box(-100.3, 9, -92.3, -69.7, 9.7, -77.7, LAKE.trim),
    box(-88, 3, -78, -80, 3.4, -75, LAKE.trim)
  );

  // Forest ring; keep water, lot, building, and spawn clear
  const clearZones = [
    [-20, -110, 158, -8],    // pond A + berms + spillway corridor
    [-62, -26, 38, 130],     // pond B + berms
    [-115, -95, -50, -20],   // lot + building
  ];
  let placed = 0;
  while (placed < 120) {
    const x = (rand() * 2 - 1) * 170;
    const z = (rand() * 2 - 1) * 170;
    if (Math.hypot(x + 50, z + 45) < 10) continue;
    if (clearZones.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
    makeTree(boxes, rand, x, z);
    placed++;
  }

  return {
    boxes,
    deco,
    water,
    spawn: { position: [-50, CONFIG.drone.collisionRadius, -45], yaw: -Math.PI / 2 },
    env: {
      sky: 0x8fc9e8, fogNear: 100, fogFar: 400,
      ground: 0x5f8a52, grid: 0x517a47, size: 400,
      shadows: true, // this is the "have a GPU" map; classic stays flat-lit
    },
  };
}

// ---------------------------------------------------------------------------
// The Mountain: ridged-noise heightfield as terraced terrain columns - steep
// ridgelines, winding valleys and saddles to fly through, pines for scale.
// ---------------------------------------------------------------------------

const MOUNT = {
  forest: [0x567347, 0x5c7a4c, 0x516d43],
  rock: [0x757a73, 0x7a7f78, 0x6f746d],
  high: [0x8f958f, 0x969c96],
  snow: [0xe2e8ea, 0xd8dfe2],
  trunk: 0x4a3b2c,
  pine: [0x2f4d33, 0x35573a],
};

function generateMountain() {
  const rand = mulberry32(9001);
  const ox = rand() * 1000;
  const oz = rand() * 1000;

  const hash2 = (ix, iz) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };

  // Ridged fBm: valleys form along noise midlines, so they connect into
  // flyable canyon networks instead of isolated pits.
  const heightAt = (wx, wz) => {
    let amp = 1, freq = 1 / 140, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      const n = vnoise(wx * freq + ox, wz * freq + oz);
      const ridged = 1 - Math.abs(2 * n - 1);
      sum += ridged * ridged * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    let h = Math.pow(sum / norm, 2.0) * 85;
    // guaranteed flat launch bowl at spawn, ramping up to full terrain
    const d = Math.hypot(wx, wz);
    h *= d < 15 ? 0 : Math.min(1, (d - 15) / 30);
    return h;
  };

  const boxes = [];
  const CELL = 6, HALF = 240, STEP = 2;
  const pick = (arr, gx, gz) => arr[Math.floor(hash2(gx + 7, gz + 13) * arr.length)];
  for (let gx = -HALF; gx < HALF; gx += CELL) {
    for (let gz = -HALF; gz < HALF; gz += CELL) {
      const h = Math.round(heightAt(gx + CELL / 2, gz + CELL / 2) / STEP) * STEP;
      if (h < STEP) continue;
      const palette =
        h >= 56 ? MOUNT.snow : h >= 36 ? MOUNT.high : h >= 16 ? MOUNT.rock : MOUNT.forest;
      boxes.push(box(gx, 0, gz, gx + CELL, h, gz + CELL, pick(palette, gx, gz)));
    }
  }

  // Pines on the lower slopes, standing on their terrain column
  for (let i = 0; i < 400; i++) {
    const gx = (Math.floor(rand() * (2 * HALF / CELL)) - HALF / CELL) * CELL;
    const gz = (Math.floor(rand() * (2 * HALF / CELL)) - HALF / CELL) * CELL;
    const h = Math.round(heightAt(gx + CELL / 2, gz + CELL / 2) / STEP) * STEP;
    if (h < STEP || h > 30) continue;
    if (Math.hypot(gx, gz) < 30) continue;
    const cx = gx + CELL / 2 + (rand() * 2 - 1) * 1.5;
    const cz = gz + CELL / 2 + (rand() * 2 - 1) * 1.5;
    const s = 1.3 + rand() * 0.9;
    const pine = pick(MOUNT.pine, gx + 1, gz + 1);
    boxes.push(box(cx - 0.2, h, cz - 0.2, cx + 0.2, h + 1.6, cz + 0.2, MOUNT.trunk));
    boxes.push(box(cx - s, h + 1.2, cz - s, cx + s, h + 1.2 + s * 1.7, cz + s, pine));
    boxes.push(box(cx - s * 0.5, h + 1.2 + s * 1.7, cz - s * 0.5,
      cx + s * 0.5, h + 1.2 + s * 2.6, cz + s * 0.5, pine));
  }

  return {
    boxes,
    spawn: { position: [0, CONFIG.drone.collisionRadius, 0], yaw: 0 },
    env: {
      sky: 0x9cc4e0, fogNear: 120, fogFar: 520,
      ground: 0x64825a, grid: 0x57724e, size: 500,
      shadows: true,
    },
  };
}

// ---------------------------------------------------------------------------

export const MAPS = {
  classic: { name: 'Classic Field', generate: generateClassic },
  bando: { name: 'The Bando', generate: generateBando },
  lake: { name: 'The Lake', generate: generateLake },
  mountain: { name: 'The Mountain', generate: generateMountain },
};

export function generateLayout(mapId = 'classic') {
  const map = MAPS[mapId] ?? MAPS.classic;
  return map.generate();
}

// Sphere vs ground plane (y=0), water rects, and AABBs, accelerated by a
// uniform x/z grid so dense maps stay O(few) per query at 500 Hz. Returns the
// deepest contact; water contacts carry {water: true} so the drone can splash.
export function createCollisionWorld(layout) {
  const boxes = layout.boxes;
  const waterRects = layout.water || [];
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
      // >= so a water surface at ground level outranks the plain ground
      // contact, while any deeper solid contact (berm, wall) still wins.
      for (const w of waterRects) {
        if (p.x < w.min[0] || p.x > w.max[0] || p.z < w.min[1] || p.z > w.max[1]) continue;
        const depth = w.level + r - p.y;
        if (depth > 0 && (!best || depth >= best.depth)) {
          best = { normal: [0, 1, 0], depth, water: true };
        }
      }
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
    size: CONFIG.world.size, // play-area extent: sets grid size, ground margin
    ...layout.env,
  };

  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.Fog(env.sky, env.fogNear, env.fogFar);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x54654a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  const shadows = !!env.shadows;
  if (shadows) {
    // Lower sun (~30 deg) so shadows are long enough to read at distance,
    // and far enough back that the whole map sits inside the near/far planes.
    sun.position.set(240, 150, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = env.size / 2 + 20;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 700;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.8;
  }

  // Visual ground extends well past the play area so the horizon never shows
  // the plane's edge; collision ground (y=0) is infinite anyway.
  const groundSize = env.size * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ color: env.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);

  const grid = new THREE.GridHelper(env.size, Math.round(env.size / 3), env.grid, env.grid);
  grid.position.y = 0.02;
  scene.add(grid);

  // Water surfaces: slabs whose tops sit at the collision water level,
  // height-staggered a few mm so overlapping rects don't z-fight each other.
  // Phong specular gives a sun glint that flat Lambert can't.
  if (layout.water && layout.water.length) {
    const waterMat = new THREE.MeshPhongMaterial({
      color: LAKE.water, specular: 0x668899, shininess: 90,
    });
    const H = 0.3;
    layout.water.forEach((w, i) => {
      const sx = w.max[0] - w.min[0];
      const sz = w.max[1] - w.min[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), waterMat);
      mesh.position.set(
        w.min[0] + sx / 2,
        w.level - H / 2 + i * 0.003,
        w.min[1] + sz / 2
      );
      mesh.receiveShadow = shadows;
      scene.add(mesh);
    });
  }

  // Painted wall sign: text drawn to a canvas texture, no font assets needed.
  if (layout.sign) {
    const s = layout.sign;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    // Transparent background: only the lettering is drawn, so it reads as
    // paint on the wall and inherits the building's own shading around it.
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#15181c';
    ctx.font = 'bold 130px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.text, canvas.width / 2, canvas.height / 2 + 6);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(s.size[0], s.size[1]),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    );
    sign.position.fromArray(s.center);
    sign.rotation.y = s.rotationY;
    scene.add(sign);
  }

  // Colliders and decorations each render as one instanced draw call -
  // map density is essentially free.
  const addInstanced = (list) => {
    if (!list || !list.length) return;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      list.length
    );
    inst.frustumCulled = false;
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    list.forEach((b, i) => {
      scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      pos.set(b.min[0] + scale.x / 2, b.min[1] + scale.y / 2, b.min[2] + scale.z / 2);
      m.compose(pos, q, scale);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.setHex(b.color));
    });
    scene.add(inst);
  };
  addInstanced(layout.boxes);
  addInstanced(layout.deco);
}
