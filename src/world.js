import * as THREE from 'three';
import { CONFIG } from './config.js';

// Layout and collision are plain data so the headless physics test can
// exercise them without a renderer. buildWorldScene() adds the meshes.

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

const BUILDING_COLORS = [0x8a8f98, 0x7b8894, 0x9aa3ab, 0xb0b6bd, 0x6e7a86, 0x5d6b78];
const GATE_COLOR = 0xe8622d;

export function generateLayout(cfg = CONFIG.world) {
  const rand = mulberry32(cfg.seed);
  const half = cfg.size / 2 - 20;
  const boxes = []; // {min:[x,y,z], max:[x,y,z], color}

  for (let i = 0; i < cfg.buildingCount; i++) {
    const w = 1.5 + rand() * 4;
    const d = 1.5 + rand() * 4;
    const h = 2 + rand() * 9;
    let x, z;
    do {
      x = (rand() * 2 - 1) * half;
      z = (rand() * 2 - 1) * half;
    } while (Math.hypot(x, z - 20) < cfg.spawnClearRadius + Math.max(w, d));
    boxes.push({
      min: [x - w / 2, 0, z - d / 2],
      max: [x + w / 2, h, z + d / 2],
      color: BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)],
    });
  }

  // Axis-aligned gates on a rough circle around the field center. Each gate is
  // four bars; bars double as colliders. Opening: 3 wide x 2.5 tall.
  const gates = [];
  const W = 3, H = 2.5, B = 0.25; // opening + bar thickness
  for (let i = 0; i < cfg.gateCount; i++) {
    const ang = (i / cfg.gateCount) * Math.PI * 2;
    const r = 30 + rand() * 25;
    const cx = Math.cos(ang) * r;
    const cz = Math.sin(ang) * r;
    const y0 = 0.8 + rand() * 2;
    const alongX = rand() < 0.5; // gate plane faces ±z if true
    const bars = [];
    const span = W / 2 + B;
    if (alongX) {
      bars.push(
        { min: [cx - span, y0 - B, cz - B / 2], max: [cx + span, y0, cz + B / 2] },
        { min: [cx - span, y0 + H, cz - B / 2], max: [cx + span, y0 + H + B, cz + B / 2] },
        { min: [cx - span, y0, cz - B / 2], max: [cx - W / 2, y0 + H, cz + B / 2] },
        { min: [cx + W / 2, y0 - B, cz - B / 2], max: [cx + span, y0 + H, cz + B / 2] }
      );
    } else {
      bars.push(
        { min: [cx - B / 2, y0 - B, cz - span], max: [cx + B / 2, y0, cz + span] },
        { min: [cx - B / 2, y0 + H, cz - span], max: [cx + B / 2, y0 + H + B, cz + span] },
        { min: [cx - B / 2, y0, cz - span], max: [cx + B / 2, y0 + H, cz - W / 2] },
        { min: [cx - B / 2, y0, cz + W / 2], max: [cx + B / 2, y0 + H, cz + span] }
      );
    }
    for (const b of bars) boxes.push({ ...b, color: GATE_COLOR });
    gates.push({ center: [cx, y0 + H / 2, cz], alongX });
  }

  return {
    boxes,
    gates,
    spawn: { position: [0, CONFIG.drone.collisionRadius, 20], yaw: 0 },
  };
}

// Sphere vs ground plane (y=0) and AABBs. Returns deepest contact or null.
export function createCollisionWorld(layout) {
  const boxes = layout.boxes;
  return {
    collide(p, r) {
      let best = null;

      if (p.y < r) {
        best = { normal: [0, 1, 0], depth: r - p.y };
      }

      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const cx = Math.min(Math.max(p.x, b.min[0]), b.max[0]);
        const cy = Math.min(Math.max(p.y, b.min[1]), b.max[1]);
        const cz = Math.min(Math.max(p.z, b.min[2]), b.max[2]);
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
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
      return best;
    },
  };
}

export function buildWorldScene(scene, layout) {
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x87b5d9, 60, 260);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x54654a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  // Visual ground extends well past the play area so the horizon never shows
  // the plane's edge; collision ground (y=0) is infinite anyway.
  const groundSize = CONFIG.world.size * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ color: 0x6a8f5a })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(groundSize, 100, 0x4c5c44, 0x55684c);
  grid.position.y = 0.02;
  scene.add(grid);

  for (const b of layout.boxes) {
    const sx = b.max[0] - b.min[0];
    const sy = b.max[1] - b.min[1];
    const sz = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshLambertMaterial({ color: b.color })
    );
    mesh.position.set(b.min[0] + sx / 2, b.min[1] + sy / 2, b.min[2] + sz / 2);
    scene.add(mesh);
  }
}
