import * as THREE from 'three';
import { MOTORS } from './flightControl.js';

// Blocky quad: body, canopy (front marker), X arms, motor pucks, blob shadow.
export function buildDroneMesh() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b2f33 });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0xd94f2a });
  const motorMat = new THREE.MeshLambertMaterial({ color: 0x15181b });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.16), bodyMat);
  group.add(body);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.07), canopyMat);
  canopy.position.set(0, 0.035, -0.035);
  group.add(canopy);

  for (const m of MOTORS) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.115), bodyMat);
    arm.position.set(m.pos[0] / 2, 0, m.pos[2] / 2);
    arm.rotation.y = Math.atan2(-m.pos[0], -m.pos[2]);
    group.add(arm);

    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.028), motorMat);
    motor.position.set(m.pos[0], 0.014, m.pos[2]);
    group.add(motor);
  }

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;

  return { group, shadow };
}

// Ground blob shadow: fades and grows with altitude - cheap depth cue.
export function updateShadow(shadow, dronePos) {
  const alt = Math.max(dronePos.y, 0);
  shadow.position.set(dronePos.x, 0.03, dronePos.z);
  const s = 1 + alt * 0.12;
  shadow.scale.set(s, s, 1);
  shadow.material.opacity = Math.max(0.05, 0.35 - alt * 0.012);
}
