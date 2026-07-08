// Headless sanity checks for the flight dynamics. Run: npm run test:physics
// Verifies hover equilibrium, rate-controller step response on each axis,
// translation directions in the world frame, and ground collision settling.
import { CONFIG } from '../src/config.js';
import { Drone } from '../src/drone.js';
import { createCollisionWorld, generateLayout } from '../src/world.js';

const DT = CONFIG.physics.dt;
const AIR = { collide: () => null };
const GROUND = createCollisionWorld({ boxes: [] });

const neutral = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
// Motor cmd = throttle at hover (zero sticks), thrust = Tmax*cmd^2 per motor.
const HOVER = Math.sqrt(
  (CONFIG.drone.mass * CONFIG.physics.gravity) / (4 * CONFIG.drone.maxThrustPerMotor)
);

function run(drone, sticks, seconds, world = AIR, each = null) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    drone.step({ ...neutral, throttle: HOVER, ...sticks }, DT, world);
    if (each) each(i * DT);
  }
}

function hoveringDrone(altitude = 20) {
  const d = new Drone();
  d.reset({ position: [0, altitude, 0], yaw: 0 });
  d.arm();
  // Pre-spool to hover thrust: acro has no altitude hold, so a spool-up sink
  // would otherwise persist for seconds (drag is the only vertical damping).
  d.motorCmd.fill(HOVER);
  d.motorThrust.fill(CONFIG.drone.maxThrustPerMotor * HOVER * HOVER);
  run(d, {}, 0.5);
  return d;
}

let failures = 0;
function check(name, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${tag}  ${name}${detail ? `  (${detail})` : ''}`);
}

// --- 1. Hover equilibrium ---------------------------------------------------
{
  const d = hoveringDrone();
  const y0 = d.position.y;
  run(d, {}, 3);
  check('hover: vertical speed ~ 0', Math.abs(d.velocity.y) < 0.02,
    `vy=${d.velocity.y.toFixed(4)} m/s`);
  check('hover: altitude holds', Math.abs(d.position.y - y0) < 0.1,
    `drift=${(d.position.y - y0).toFixed(3)} m`);
  check('hover: no rotation', d.omega.length() < 0.02,
    `|w|=${d.omega.length().toFixed(4)} rad/s`);
}

// --- 2. Rate step response per axis ----------------------------------------
// Full stick should reach ~maxRate with the correct sign. Body-frame signs:
// roll right -> -wz, pitch forward -> -wx, yaw right -> -wy.
const RATE_CASES = [
  { name: 'roll right', sticks: { roll: 1 }, axis: 'z', sign: -1, max: CONFIG.rates.maxRate[0] },
  { name: 'pitch fwd', sticks: { pitch: 1 }, axis: 'x', sign: -1, max: CONFIG.rates.maxRate[1] },
  { name: 'yaw right', sticks: { yaw: 1 }, axis: 'y', sign: -1, max: CONFIG.rates.maxRate[2] },
];
for (const tc of RATE_CASES) {
  const d = hoveringDrone();
  let peak = 0;
  let t63 = null;
  const target = (tc.max * Math.PI) / 180;
  run(d, tc.sticks, 0.4, AIR, (t) => {
    const w = d.omega[tc.axis] * tc.sign;
    if (w > peak) peak = w;
    if (t63 === null && w >= 0.63 * target) t63 = t;
  });
  const achievedDeg = (peak * 180) / Math.PI;
  check(`step ${tc.name}: correct sign + >=85% of max rate`,
    achievedDeg >= 0.85 * tc.max,
    `peak=${achievedDeg.toFixed(0)} deg/s of ${tc.max}, t63=${t63 === null ? '>400' : (t63 * 1000).toFixed(0)} ms`);
  check(`step ${tc.name}: overshoot <= 12%`, achievedDeg <= 1.12 * tc.max);
  check(`step ${tc.name}: responds within 150 ms`, t63 !== null && t63 < 0.15);
}

// --- 2b. Stick-release bounceback ("locked in" feel) ------------------------
// Hold full rate, release to center: the rate should return to zero without
// swinging through and rotating the other way (that reversal reads as jello).
for (const tc of RATE_CASES) {
  const d = hoveringDrone();
  run(d, tc.sticks, 0.4);
  let reverse = 0;
  let settled = null;
  run(d, {}, 0.35, AIR, (t) => {
    const w = (d.omega[tc.axis] * tc.sign * 180) / Math.PI; // deg/s, + = held direction
    if (-w > reverse) reverse = -w;
    if (settled === null && Math.abs(w) < 30) settled = t;
    else if (settled !== null && Math.abs(w) > 30) settled = null; // left the band: not settled
  });
  check(`release ${tc.name}: bounceback < 10% of max rate`,
    reverse < 0.10 * tc.max, `reverse peak=${reverse.toFixed(0)} deg/s of ${tc.max} held`);
  check(`release ${tc.name}: settles within 250 ms`,
    settled !== null && settled < 0.25,
    `settle=${settled === null ? 'never' : (settled * 1000).toFixed(0) + ' ms'}`);
}

// --- 3. Translation directions ----------------------------------------------
// Small pitch forward pulse -> forward is -z. Roll right pulse -> +x.
{
  const d = hoveringDrone();
  run(d, { pitch: 0.25 }, 0.25);
  run(d, {}, 0.6);
  check('pitch fwd -> moves forward (-z)', d.velocity.z < -0.5,
    `vz=${d.velocity.z.toFixed(2)} m/s`);
}
{
  const d = hoveringDrone();
  run(d, { roll: 0.25 }, 0.25);
  run(d, {}, 0.6);
  check('roll right -> moves right (+x)', d.velocity.x > 0.5,
    `vx=${d.velocity.x.toFixed(2)} m/s`);
}
{
  const d = hoveringDrone();
  run(d, { yaw: 0.4 }, 0.8);
  // forward vector = q * (0,0,-1); its x component from quaternion terms:
  const q = d.quaternion;
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  check('yaw right -> nose swings east (+x)', fx > 0.3, `fwd.x=${fx.toFixed(2)}`);
}

// --- 4. Ground contact --------------------------------------------------------
{
  const d = new Drone();
  d.reset({ position: [0, 2, 0], yaw: 0 });
  run(d, { throttle: 0 }, 3, GROUND);
  check('disarmed drop: settles on ground',
    Math.abs(d.position.y - CONFIG.drone.collisionRadius) < 0.02 && Math.abs(d.velocity.y) < 0.05,
    `y=${d.position.y.toFixed(3)} m, vy=${d.velocity.y.toFixed(3)}`);
}
{
  const d = hoveringDrone(6);
  d.disarm();
  d.arm();
  // Fall armed with idle motors from 6 m -> impact well above crashSpeed
  run(d, { throttle: 0 }, 2.5, GROUND);
  check('hard armed impact -> crash + disarm', d.crashed && !d.armed);
}

// --- 5. Collision grid vs brute force on the dense map ----------------------
{
  const layout = generateLayout('bando');
  const world = createCollisionWorld(layout);

  const brute = (p, r) => {
    let best = p.y < r ? { depth: r - p.y } : null;
    for (const b of layout.boxes) {
      const nx = Math.min(Math.max(p.x, b.min[0]), b.max[0]);
      const ny = Math.min(Math.max(p.y, b.min[1]), b.max[1]);
      const nz = Math.min(Math.max(p.z, b.min[2]), b.max[2]);
      const d2 = (p.x - nx) ** 2 + (p.y - ny) ** 2 + (p.z - nz) ** 2;
      if (d2 >= r * r) continue;
      const depth = d2 > 1e-12 ? r - Math.sqrt(d2) : r;
      if (!best || depth > best.depth) best = { depth };
    }
    return best;
  };

  let lcg = 12345;
  const rnd = () => ((lcg = (lcg * 1664525 + 1013904223) >>> 0) / 4294967296);
  let mismatches = 0;
  let contacts = 0;
  for (let i = 0; i < 5000; i++) {
    const p = { x: (rnd() * 2 - 1) * 60, y: rnd() * 25, z: (rnd() * 2 - 1) * 60 };
    const a = world.collide(p, CONFIG.drone.collisionRadius);
    const b = brute(p, CONFIG.drone.collisionRadius);
    if (!!a !== !!b || (a && Math.abs(a.depth - b.depth) > 1e-9)) mismatches++;
    if (b) contacts++;
  }
  check('bando: grid collision matches brute force', mismatches === 0,
    `${contacts} contact samples of 5000, ${mismatches} mismatches`);

  const classicCount = generateLayout('classic').boxes.length;
  check('bando: meaningfully denser than classic', layout.boxes.length > 2 * classicCount,
    `${layout.boxes.length} boxes vs ${classicCount}`);
}

console.log(failures === 0 ? '\nAll physics checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
