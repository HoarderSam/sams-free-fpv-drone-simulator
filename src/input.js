import { CONFIG } from './config.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function applyDeadband(v, db) {
  if (Math.abs(v) < db) return 0;
  return (v - Math.sign(v) * db) / (1 - db);
}

// Merges gamepad (preferred, includes USB RC radios) and keyboard fallback.
// poll(dt) returns sticks plus edge-triggered arm/reset/cam events.
export class Input {
  constructor(cfg = CONFIG.input) {
    this.cfg = cfg;
    this.keys = new Set();
    this.kb = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
    this.prevButtons = [];
    this.prevKeys = { arm: false, reset: false, cam: false };
    this.gamepadId = null;

    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _gamepad() {
    if (!navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) {
      if (gp && gp.connected && gp.axes.length >= 4) return gp;
    }
    return null;
  }

  _axis(gp, idx, invert) {
    const v = gp.axes[idx] ?? 0;
    return invert ? -v : v;
  }

  poll(dt) {
    const gp = this._gamepad();
    const isStandard = gp ? gp.mapping === 'standard' : false;
    const g = isStandard ? this.cfg.gamepadStandard : this.cfg.gamepadRC;
    this.gamepadId = gp ? gp.id : null;
    this.mappingName = gp ? (isStandard ? 'pad' : 'RC/AETR') : null;
    this.rawAxes = gp ? Array.from(gp.axes) : null;

    let roll, pitch, yaw, throttle;

    if (gp) {
      const db = this.cfg.deadband;
      roll = applyDeadband(this._axis(gp, g.rollAxis, g.rollInvert), db);
      pitch = applyDeadband(this._axis(gp, g.pitchAxis, g.pitchInvert), db);
      yaw = applyDeadband(this._axis(gp, g.yawAxis, g.yawInvert), db);
      throttle = clamp((this._axis(gp, g.throttleAxis, g.throttleInvert) + 1) / 2, 0, 1);
    } else {
      const ramp = this.cfg.keyboardRampRate * dt;
      const defl = this.cfg.keyboardMaxDeflection; // stick axes only - throttle is absolute
      const target = (neg, pos) => (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
      this.kb.roll += clamp(target('ArrowLeft', 'ArrowRight') * defl - this.kb.roll, -ramp, ramp);
      this.kb.pitch += clamp(target('ArrowDown', 'ArrowUp') * defl - this.kb.pitch, -ramp, ramp);
      this.kb.yaw += clamp(target('KeyA', 'KeyD') * defl - this.kb.yaw, -ramp, ramp);
      this.kb.throttle = clamp(
        this.kb.throttle + target('KeyS', 'KeyW') * this.cfg.keyboardThrottleRate * dt,
        0, 1
      );
      ({ roll, pitch, yaw, throttle } = this.kb);
    }

    // Edge detection across keyboard + gamepad buttons
    const btn = (i) => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
    const now = {
      arm: this.keys.has('Enter') || btn(g.armButton),
      reset: this.keys.has('KeyR') || btn(g.resetButton),
      cam: this.keys.has('KeyC') || btn(g.camButton),
      map: this.keys.has('KeyM'),
    };
    const events = {
      armToggle: now.arm && !this.prevKeys.arm,
      reset: now.reset && !this.prevKeys.reset,
      camToggle: now.cam && !this.prevKeys.cam,
      mapNext: now.map && !this.prevKeys.map,
    };
    this.prevKeys = now;

    return { roll, pitch, yaw, throttle, ...events };
  }
}
