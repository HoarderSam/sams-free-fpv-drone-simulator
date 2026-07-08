const GIMBAL_SIZE = 84;

export class HUD {
  constructor() {
    this.status = document.getElementById('status');
    this.flash = document.getElementById('flash');
    this.telemetry = document.getElementById('telemetry');
    this.throttleBar = document.getElementById('throttle-bar');
    this.inputDebug = document.getElementById('input-debug');
    this.stickLeft = document.getElementById('stick-left');
    this.stickRight = document.getElementById('stick-right');
    this.flashUntil = 0;
  }

  showFlash(msg, seconds = 2) {
    this.flash.textContent = msg;
    this.flashUntil = performance.now() + seconds * 1000;
  }

  update(drone, cmd, input, elapsed) {
    let state, color;
    if (drone.crashed) {
      state = drone.splashed ? 'IN THE DRINK - press R to reset' : 'CRASHED - press R to reset';
      color = '#ff5a4a';
    } else if (drone.armed) {
      state = `ARMED  ${elapsed.toFixed(1)}s`;
      color = '#9dff57';
    } else {
      state = 'DISARMED - Enter / A to arm (throttle low)';
      color = '#ffd24a';
    }
    this.status.textContent = state;
    this.status.style.color = color;

    if (performance.now() > this.flashUntil) this.flash.textContent = '';

    const speed = drone.velocity.length();
    this.telemetry.textContent =
      `${(speed * 3.6).toFixed(0).padStart(3)} km/h\n` +
      `${drone.position.y.toFixed(1).padStart(5)} m alt\n` +
      (input.gamepadId
        ? `${input.gamepadId.slice(0, 28)} [${input.mappingName}]`
        : 'no gamepad - keyboard mode');

    this.throttleBar.style.height = `${(cmd.throttle * 100).toFixed(0)}%`;

    // Mode 2 gimbal overlay: left = yaw/throttle, right = roll/pitch.
    // Screen y grows downward, so full throttle / pitch forward map to top.
    const px = (v) => Math.min(Math.max(v, 0), 1) * GIMBAL_SIZE;
    this.stickLeft.style.transform =
      `translate(${px(cmd.yaw * 0.5 + 0.5)}px, ${px(1 - cmd.throttle)}px)`;
    this.stickRight.style.transform =
      `translate(${px(cmd.roll * 0.5 + 0.5)}px, ${px(0.5 - cmd.pitch * 0.5)}px)`;

    const sgn = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    this.inputDebug.textContent = input.rawAxes
      ? 'axes ' + input.rawAxes.map((a) => a.toFixed(2)).join(' ') +
        `\nroll ${sgn(cmd.roll)}  pitch ${sgn(cmd.pitch)}  yaw ${sgn(cmd.yaw)}  thr ${cmd.throttle.toFixed(2)}`
      : '';
  }
}
