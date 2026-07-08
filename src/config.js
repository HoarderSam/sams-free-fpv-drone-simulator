// All tunables in one place. Units: SI (m, kg, s, N, rad) unless a name says otherwise.
// Pilot-axis arrays are ordered [roll, pitch, yaw].
export const CONFIG = {
  physics: {
    dt: 1 / 500,
    gravity: 9.81,
  },

  drone: {
    // Roughly a 5" freestyle quad
    mass: 0.65,
    inertia: [0.0025, 0.0045, 0.0025], // diagonal [Ixx, Iyy, Izz], body frame
    armX: 0.078,
    armZ: 0.078,
    maxThrustPerMotor: 10, // N -> TWR ~ 6
    motorTauUp: 0.02,      // s, spool-up time constant
    motorTauDown: 0.04,    // s, spool-down is slower (no active braking modeled)
    torqueCoeff: 0.012,    // yaw reaction torque per N of prop thrust (m)
    // Aerodynamic drag in body frame: F_i = -(quad_i*|v_i| + lin_i) * v_i
    dragQuad: [0.03, 0.06, 0.026], // top of the frame (y) is draggiest
    dragLin: [0.05, 0.08, 0.05],
    angularDragLin: 0.0005,
    angularDragQuad: 0.00002,
    collisionRadius: 0.14,
    idleThrottle: 0.05,
    crashSpeed: 5,       // m/s impact along contact normal that counts as a crash
    restitution: 0.35,
    contactFriction: 4,  // exponential tangential damping rate while in contact
    contactAngularDamping: 8,
  },

  // Approximates Betaflight "Actual" rates: linear centerRate near mid-stick,
  // blending to maxRate at full deflection. Degrees/second.
  rates: {
    maxRate: [670, 670, 500],
    centerRate: [200, 200, 180],
    expoPow: [3, 3, 3], // higher = softer center, steeper ends
  },

  // Rate-mode (acro) PID + feedforward. Output is normalized mixer units
  // in [-1, 1]. FF drives the transient from stick motion so P can stay
  // moderate and D can damp hard without slowing the response.
  pid: {
    kp: [0.028, 0.030, 0.140],
    ki: [0.08, 0.09, 0.20],
    kd: [0.0013, 0.0014, 0.0015],
    kff: [0.0009, 0.0009, 0.0060], // mixer units per rad/s^2 of setpoint change
    iLimit: 0.10,
    dCutoffHz: 90,
    ffCutoffHz: 25,
    // I-term relax (Betaflight-style): suppress integration while the
    // setpoint is moving fast, so stick steps don't wind up the integrator.
    itermRelaxCutoffHz: 15,
    itermRelaxThresholdDeg: 40,
  },

  camera: {
    uptiltDeg: 20,
    fovDeg: 100, // vertical FOV; FPV cams are wide
    chaseDistance: 3.5,
    chaseHeight: 1.2,
  },

  input: {
    deadband: 0.02,
    keyboardRampRate: 8,    // how fast held keys reach full deflection (1/s)
    keyboardThrottleRate: 0.9, // throttle change per second on W/S
    keyboardMaxDeflection: 0.4, // full rates on a binary key would be unflyable
    // Two presets, picked automatically per device: browsers report
    // mapping === 'standard' for known gamepads (Xbox etc.); RC radios in
    // USB joystick mode report an empty mapping string.
    gamepadStandard: {
      // Xbox-style pad, Mode 2
      rollAxis: 2,  rollInvert: false,
      pitchAxis: 3, pitchInvert: true, // pad Y axes report up as -1
      yawAxis: 0,   yawInvert: false,
      throttleAxis: 1, throttleInvert: true, // raw -1..1 mapped to 0..1
      armButton: 0,   // A
      resetButton: 1, // B
      camButton: 3,   // Y
    },
    gamepadRC: {
      // EdgeTX/OpenTX (RadioMaster, etc.) default channel order is AETR:
      // 0=aileron(roll), 1=elevator(pitch), 2=throttle, 3=rudder(yaw).
      // EdgeTX outputs stick up/right as +1, so nothing needs inverting and
      // throttle-low reads -1, which maps to 0.
      rollAxis: 0,  rollInvert: false,
      pitchAxis: 1, pitchInvert: false,
      yawAxis: 3,   yawInvert: false,
      throttleAxis: 2, throttleInvert: false,
      // EdgeTX joystick mode exposes channels 9-16 as buttons 0-7: assign
      // radio switches to ch9/ch10/ch12 to get arm/reset/camera on switches.
      armButton: 0,
      resetButton: 1,
      camButton: 3,
    },
  },

  world: {
    seed: 1337,
    size: 300,
    buildingCount: 45,
    gateCount: 6,
    spawnClearRadius: 12,
  },
};
