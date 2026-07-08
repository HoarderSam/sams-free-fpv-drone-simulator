# Sam's Free FPV Drone Simulator

A browser FPV drone simulator: blocky graphics, realistic acro-mode flight physics.
No physics engine — the drone is a custom 6-DOF rigid body with a Betaflight-style
flight controller (rates curve → rate PID with I-term relax → mixer with airmode →
motor lag), integrated at 500 Hz decoupled from the render loop.

## Run

```
npm install
npm run dev          # dev server (vite), open the printed URL
npm run test:physics # headless physics sanity checks (hover, step response, signs)
```

## Maps

Pick with `?map=<id>` in the URL or cycle with **M** in-game:

- `classic` (default) — open field with scattered blocks and race gates; light
  enough for any machine.
- `bando` — freestyle playground: a five-story gutted concrete tower with dive
  holes in every slab, window bays, a solid core to orbit, a half-built
  neighbor, derelict shells, and rubble.
- `lake` — two retaining ponds joined by a concrete spillway gap (walls plus a
  low sill to thread), grass berms all around, a parking-lot slalom, an office
  building, and a treeline. Water is a hazard: touch it while armed and you're
  in the drink — reset to fly again. Disarmed quads float.

Maps are plain data (`src/world.js`): a generator returns boxes + spawn + sky
settings, and collision (uniform-grid accelerated) and rendering (single
instanced draw call) are built from that, so map density is essentially free.
To add a map, write one generator function and register it in `MAPS`.

## Controls

| Action | Keyboard | Gamepad (Xbox layout) |
|---|---|---|
| Arm / disarm | Enter | A |
| Reset to spawn | R | B |
| FPV / chase camera | C | Y |
| Next map | M | — |
| Throttle | W / S | left stick vertical |
| Yaw | A / D | left stick horizontal |
| Pitch / roll | arrow keys | right stick |

Arming requires throttle low (like a real flight controller). It flies acro
(rate) mode only — there is no self-leveling; that is the FPV standard.

**USB RC transmitters** (RadioMaster, Taranis, etc. in joystick mode) work via the
Gamepad API and are by far the best way to fly. The sim auto-selects a mapping
preset per device: known gamepads (`mapping: "standard"`) use the Xbox-style
preset, everything else uses the EdgeTX/OpenTX AETR preset (`input.gamepadRC`
in `src/config.js`). The HUD's bottom-left readout shows raw axes plus the
mapped roll/pitch/yaw/throttle — if your radio has reversed channels, flip the
matching `*Invert` flag. EdgeTX exposes channels 9-16 as buttons 0-7, so mix a
switch to ch9 to arm/disarm from the radio. Xbox-style throttle sticks spring
to center — pull fully down to arm.

## Tuning

Everything lives in `src/config.js`:

- `rates` — max/center rotation rates and expo, deg/s (Actual-rates-like curve)
- `pid` — rate-loop gains, I-term relax, D filter
- `drone` — mass, inertia, motor thrust/lag, drag, collision behavior
- `camera` — FPV uptilt and FOV
- `input.gamepad` — axis/button mapping

## Architecture

```
src/main.js          bootstrap, fixed-timestep loop (500 Hz physics / rAF render)
src/drone.js         6-DOF rigid body: forces, torques, quaternion integration, contacts
src/flightControl.js rates curve, rate PID, mixer + airmode, motor layout (sign conventions documented here)
src/world.js         seeded blocky world; layout + collision are renderer-free
src/input.js         Gamepad API + keyboard fallback, edge-triggered buttons
src/droneMesh.js     blocky quad mesh + blob shadow (depth cue)
src/hud.js           OSD-style overlay
test/physics-check.mjs  headless checks: hover equilibrium, per-axis step response
                        (magnitude, sign, overshoot), translation directions, crashes
```

Body frame: +x right, +y up, −z forward (three.js camera convention). All
stick→rate sign conventions are documented at the top of `src/flightControl.js`;
the mixer and the physical torque model are both derived from the same `MOTORS`
table, so they cannot disagree.

## Ideas for next steps

- Rotated gates + OBB collision, lap timing through gate planes
- Propwash / turbulence when descending into own wake
- Betaflight-style OSD elements, stick overlay widget
- Config UI for rates/PID instead of editing `config.js`
- Ghost replays (record state at 60 Hz, play back)
