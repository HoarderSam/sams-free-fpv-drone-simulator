import * as THREE from 'three';
import { CONFIG } from './config.js';
import { FlightController, MOTORS } from './flightControl.js';

// Pure simulation state - no rendering. Position/velocity in world frame,
// angular velocity in body frame (rad/s). Quaternion maps body -> world.
export class Drone {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.fc = new FlightController(cfg);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.motorCmd = [0, 0, 0, 0];    // filtered command ~ rpm fraction
    this.motorThrust = [0, 0, 0, 0]; // N
    this.armed = false;
    this.crashed = false;
    this.splashed = false;
    this.inContact = false;

    this._qInv = new THREE.Quaternion();
    this._vBody = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._torque = new THREE.Vector3();
    this._Iw = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
    this._n = new THREE.Vector3();
  }

  reset(spawn = { position: [0, CONFIG.drone.collisionRadius, 0], yaw: 0 }) {
    this.position.fromArray(spawn.position);
    this.velocity.set(0, 0, 0);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw);
    this.omega.set(0, 0, 0);
    this.motorCmd.fill(0);
    this.motorThrust.fill(0);
    this.armed = false;
    this.crashed = false;
    this.splashed = false;
    this.fc.reset();
  }

  arm() {
    if (this.crashed) return false;
    this.fc.reset();
    this.armed = true;
    return true;
  }

  disarm() {
    this.armed = false;
  }

  step(sticks, dt, world) {
    const c = this.cfg.drone;
    const g = this.cfg.physics.gravity;

    const targets = this.armed ? this.fc.update(sticks, this.omega, dt) : [0, 0, 0, 0];

    // First-order motor lag on command, thrust ~ rpm^2
    for (let i = 0; i < 4; i++) {
      const tau = targets[i] > this.motorCmd[i] ? c.motorTauUp : c.motorTauDown;
      this.motorCmd[i] += (targets[i] - this.motorCmd[i]) * Math.min(dt / tau, 1);
      this.motorThrust[i] = c.maxThrustPerMotor * this.motorCmd[i] * this.motorCmd[i];
    }
    const totalThrust =
      this.motorThrust[0] + this.motorThrust[1] + this.motorThrust[2] + this.motorThrust[3];

    // Forces: thrust along body +y, gravity, anisotropic drag in body frame
    this._qInv.copy(this.quaternion).invert();
    this._vBody.copy(this.velocity).applyQuaternion(this._qInv);
    this._force.set(
      -(c.dragQuad[0] * Math.abs(this._vBody.x) + c.dragLin[0]) * this._vBody.x,
      -(c.dragQuad[1] * Math.abs(this._vBody.y) + c.dragLin[1]) * this._vBody.y + totalThrust,
      -(c.dragQuad[2] * Math.abs(this._vBody.z) + c.dragLin[2]) * this._vBody.z
    );
    this._force.applyQuaternion(this.quaternion);
    this._force.y -= c.mass * g;

    this.velocity.addScaledVector(this._force, dt / c.mass);
    this.position.addScaledVector(this.velocity, dt);

    // Torques from motor thrust offsets + yaw reaction, all in body frame
    this._torque.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const T = this.motorThrust[i];
      const m = MOTORS[i];
      this._torque.x += -m.pos[2] * T;
      this._torque.y += -m.spin * c.torqueCoeff * T;
      this._torque.z += m.pos[0] * T;
    }
    const w = this.omega;
    this._torque.x -= (c.angularDragLin + c.angularDragQuad * Math.abs(w.x)) * w.x;
    this._torque.y -= (c.angularDragLin + c.angularDragQuad * Math.abs(w.y)) * w.y;
    this._torque.z -= (c.angularDragLin + c.angularDragQuad * Math.abs(w.z)) * w.z;

    // Euler's equations with diagonal inertia: I*dw/dt = torque - w x (I*w)
    const [Ix, Iy, Iz] = c.inertia;
    this._Iw.set(Ix * w.x, Iy * w.y, Iz * w.z);
    this._torque.x -= w.y * this._Iw.z - w.z * this._Iw.y;
    this._torque.y -= w.z * this._Iw.x - w.x * this._Iw.z;
    this._torque.z -= w.x * this._Iw.y - w.y * this._Iw.x;

    w.x += (dt / Ix) * this._torque.x;
    w.y += (dt / Iy) * this._torque.y;
    w.z += (dt / Iz) * this._torque.z;

    // Integrate orientation from body rates
    const wMag = w.length();
    if (wMag > 1e-9) {
      this._n.copy(w).multiplyScalar(1 / wMag);
      this._dq.setFromAxisAngle(this._n, wMag * dt);
      this.quaternion.multiply(this._dq).normalize();
    }

    // Collision: drone as a sphere against world colliders
    this.inContact = false;
    const contact = world.collide(this.position, c.collisionRadius);
    if (contact) {
      this.inContact = true;
      this._n.fromArray(contact.normal);
      this.position.addScaledVector(this._n, contact.depth);

      if (contact.water) {
        // Props in water end the flight regardless of speed; no bounce,
        // heavy drag, and it settles floating at the surface.
        if (this.armed) {
          this.crashed = true;
          this.splashed = true;
          this.armed = false;
        }
        const vn = this.velocity.dot(this._n);
        if (vn < 0) this.velocity.addScaledVector(this._n, -vn);
        this.velocity.multiplyScalar(Math.exp(-3 * dt));
        this.omega.multiplyScalar(Math.exp(-10 * dt));
        return;
      }

      const vn = this.velocity.dot(this._n);
      if (vn < 0) {
        if (this.armed && -vn > c.crashSpeed) {
          this.crashed = true;
          this.armed = false;
        }
        const bounce = -vn > 0.5 ? 1 + c.restitution : 1;
        this.velocity.addScaledVector(this._n, -bounce * vn);
      }
      // Tangential friction + spin-down while touching
      const damp = Math.exp(-c.contactFriction * dt);
      const vnAfter = this.velocity.dot(this._n);
      this.velocity.addScaledVector(this._n, -vnAfter);
      this.velocity.multiplyScalar(damp);
      this.velocity.addScaledVector(this._n, vnAfter);
      this.omega.multiplyScalar(Math.exp(-c.contactAngularDamping * dt));
    }
  }
}
