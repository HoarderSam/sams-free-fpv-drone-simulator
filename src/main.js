import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Drone } from './drone.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { MAPS, generateLayout, createCollisionWorld, buildWorldScene } from './world.js';
import { buildDroneMesh, updateShadow } from './droneMesh.js';

const DT = CONFIG.physics.dt;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const mapParam = new URLSearchParams(location.search).get('map');
const mapId = MAPS[mapParam] ? mapParam : 'classic';

const scene = new THREE.Scene();
const layout = generateLayout(mapId);
const collisionWorld = createCollisionWorld(layout);
if (layout.env && layout.env.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}
buildWorldScene(scene, layout);

document.getElementById('hint').textContent =
  `map: ${MAPS[mapId].name} (M: next) | Enter/A: arm | R/B: reset | C: camera | ` +
  'keyboard: W/S throttle, A/D yaw, arrows pitch/roll';

const drone = new Drone();
drone.reset(layout.spawn);

const { group: droneMesh, shadow } = buildDroneMesh();
scene.add(droneMesh, shadow);
droneMesh.visible = false; // FPV camera sits inside the model; only show it in chase view

const fpvCamera = new THREE.PerspectiveCamera(
  CONFIG.camera.fovDeg, window.innerWidth / window.innerHeight, 0.05, 1000
);
const chaseCamera = new THREE.PerspectiveCamera(
  70, window.innerWidth / window.innerHeight, 0.05, 1000
);
const uptilt = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0), (CONFIG.camera.uptiltDeg * Math.PI) / 180
);
let useChase = false;

const input = new Input();
const hud = new HUD();
let armedTime = 0;

const chasePos = new THREE.Vector3();
const chaseTarget = new THREE.Vector3();
const fwd = new THREE.Vector3();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  for (const cam of [fpvCamera, chaseCamera]) {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  }
});

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;

  const cmd = input.poll(delta);

  if (cmd.reset) {
    drone.reset(layout.spawn);
    armedTime = 0;
  }
  if (cmd.armToggle) {
    if (drone.armed) {
      drone.disarm();
    } else if (drone.crashed) {
      hud.showFlash('reset first (R)');
    } else if (cmd.throttle > 0.1) {
      hud.showFlash('THROTTLE HIGH - lower it to arm');
    } else {
      drone.arm();
      armedTime = 0;
    }
  }
  if (cmd.camToggle) {
    useChase = !useChase;
    droneMesh.visible = useChase;
  }
  if (cmd.mapNext) {
    const ids = Object.keys(MAPS);
    const next = ids[(ids.indexOf(mapId) + 1) % ids.length];
    location.search = `?map=${next}`; // reload with the next map
    return;
  }

  acc += delta;
  while (acc >= DT) {
    drone.step(cmd, DT, collisionWorld);
    if (drone.armed) armedTime += DT;
    acc -= DT;
  }

  droneMesh.position.copy(drone.position);
  droneMesh.quaternion.copy(drone.quaternion);
  updateShadow(shadow, drone.position);

  let camera;
  if (useChase) {
    fwd.set(0, 0, -1).applyQuaternion(drone.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    chasePos.copy(drone.position)
      .addScaledVector(fwd, -CONFIG.camera.chaseDistance)
      .add(new THREE.Vector3(0, CONFIG.camera.chaseHeight, 0));
    chaseCamera.position.lerp(chasePos, 1 - Math.exp(-8 * delta));
    chaseTarget.copy(drone.position);
    chaseCamera.lookAt(chaseTarget);
    camera = chaseCamera;
  } else {
    fpvCamera.position.copy(drone.position);
    fpvCamera.quaternion.copy(drone.quaternion).multiply(uptilt);
    camera = fpvCamera;
  }

  hud.update(drone, cmd, input, armedTime);
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);

// Debug handle for console inspection; not used by the sim itself.
window.__sim = { renderer, scene, drone, layout };
