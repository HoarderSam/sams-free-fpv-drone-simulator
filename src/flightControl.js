import { CONFIG } from './config.js';

// Body frame follows three.js camera convention: +x right, +y up, -z forward (nose).
// Angular velocity is right-handed about those axes, which makes the stick mapping:
//   pitch stick forward (nose down)  -> negative rate about +x
//   yaw stick right (nose right)     -> negative rate about +y
//   roll stick right (right side dn) -> negative rate about +z
//
// Motor spin +1 = counter-clockwise about +y viewed from above; reaction torque on
// the frame is -spin * torqueCoeff * thrust. Diagonal pairs share spin direction.
const AX = CONFIG.drone.armX;
const AZ = CONFIG.drone.armZ;
export const MOTORS = [
  { name: 'FR', pos: [ AX, 0, -AZ], spin: +1 },
  { name: 'FL', pos: [-AX, 0, -AZ], spin: -1 },
  { name: 'RR', pos: [ AX, 0,  AZ], spin: -1 },
  { name: 'RL', pos: [-AX, 0,  AZ], spin: +1 },
];

// Mixer coefficients derived from geometry so they are consistent by construction
// with the torque computation in drone.js (which also derives from MOTORS).
for (const m of MOTORS) {
  m.mix = {
    x: -m.pos[2] / AZ, // +x torque (nose up) comes from the front motors
    y: -m.spin,        // yaw reaction
    z: m.pos[0] / AX,  // +z torque (roll left) comes from the right motors
  };
}

// Maps body axis index (x,y,z) to pilot-axis index (roll,pitch,yaw) used in config arrays.
const BODY_TO_PILOT = [1, 2, 0];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export class FlightController {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.iterm = [0, 0, 0];
    this.prevGyro = [0, 0, 0];
    this.dFilt = [0, 0, 0];
    this.spLpf = [0, 0, 0];
    this.prevSetpoint = [0, 0, 0];
    this.ffFilt = [0, 0, 0];
    this.saturated = false;
  }

  // Odd curve with rate(±1) = maxRate, slope centerRate at center. Deg/s -> rad/s.
  rateCurve(x, pilotAxis) {
    const { maxRate, centerRate, expoPow } = this.cfg.rates;
    const c = centerRate[pilotAxis];
    const m = maxRate[pilotAxis];
    const deg = c * x + (m - c) * x * Math.pow(Math.abs(x), expoPow[pilotAxis] - 1);
    return (deg * Math.PI) / 180;
  }

  // sticks: {roll, pitch, yaw in [-1,1], throttle in [0,1]}
  // gyro: body angular velocity {x,y,z} rad/s
  // Returns 4 motor commands in [0,1], MOTORS order.
  update(sticks, gyro, dt) {
    const { pid, drone } = this.cfg;
    const setpoint = [
      -this.rateCurve(sticks.pitch, 1),
      -this.rateCurve(sticks.yaw, 2),
      -this.rateCurve(sticks.roll, 0),
    ];
    const g = [gyro.x, gyro.y, gyro.z];
    const dAlpha = clamp(dt * 2 * Math.PI * pid.dCutoffHz, 0, 1);
    const ffAlpha = clamp(dt * 2 * Math.PI * pid.ffCutoffHz, 0, 1);
    const relaxAlpha = clamp(dt * 2 * Math.PI * pid.itermRelaxCutoffHz, 0, 1);
    const relaxThresh = (pid.itermRelaxThresholdDeg * Math.PI) / 180;

    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const pa = BODY_TO_PILOT[i];
      const err = setpoint[i] - g[i];

      this.spLpf[i] += (setpoint[i] - this.spLpf[i]) * relaxAlpha;
      const relax = Math.max(0, 1 - Math.abs(setpoint[i] - this.spLpf[i]) / relaxThresh);
      if (!this.saturated) {
        this.iterm[i] = clamp(
          this.iterm[i] + err * pid.ki[pa] * relax * dt,
          -pid.iLimit, pid.iLimit
        );
      }

      const dRaw = -(g[i] - this.prevGyro[i]) / dt; // D on gyro, not on error
      this.dFilt[i] += (dRaw - this.dFilt[i]) * dAlpha;
      this.prevGyro[i] = g[i];

      // Feedforward on setpoint derivative: commands the rotation before an
      // error develops, which is what keeps stops crisp instead of springy.
      const ffRaw = (setpoint[i] - this.prevSetpoint[i]) / dt;
      this.ffFilt[i] += (ffRaw - this.ffFilt[i]) * ffAlpha;
      this.prevSetpoint[i] = setpoint[i];

      out[i] = clamp(
        pid.kp[pa] * err + this.iterm[i] + pid.kd[pa] * this.dFilt[i] + pid.kff[pa] * this.ffFilt[i],
        -1, 1
      );
    }

    // Mix, then keep full differential authority at any throttle (airmode):
    // scale the differential into a unit range, then slide the throttle base so
    // no motor leaves [idle, 1].
    const d = MOTORS.map((m) => out[0] * m.mix.x + out[1] * m.mix.y + out[2] * m.mix.z);
    let lo = Math.min(...d);
    let hi = Math.max(...d);
    const range = hi - lo;
    if (range > 1) {
      for (let i = 0; i < 4; i++) d[i] /= range;
      lo /= range;
      hi /= range;
    }
    this.saturated = range > 0.98;

    const base = Math.max(Math.min(sticks.throttle, 1 - hi), drone.idleThrottle - lo);
    return d.map((v) => clamp(base + v, 0, 1));
  }
}
