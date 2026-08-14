/**
 * pose.js — damped pose blending for the skater.
 *
 * The old animation code assigned joint rotations straight onto the meshes
 * every frame (`legL.rotation.x = -0.75`), which meant every state change
 * snapped instantly. Nothing in it could ever feel like motion, because
 * nothing ever moved *between* two states — it only ever teleported.
 *
 * This module fixes that with one idea:
 *
 *     value = damp(current → target) + additive
 *
 * `target` is whichever named pose the current state asks for. Every channel
 * eases toward it at its own rate, so switching pose is a transition rather
 * than a cut. `additive` is layered on afterwards — the ride bob, the carve
 * lean, the landing squash — so those keep animating at full amplitude
 * instead of being flattened by the damping underneath them.
 *
 * Damping is `1 - exp(-rate * dt)`, the same frame-rate independent form the
 * lane movement in player.js already uses: halving the frame rate must not
 * halve how fast a limb swings.
 */

/**
 * @param channels  name → { obj, key }, where `obj` is any object with
 *                  numeric properties (a THREE.Euler, a Vector3, …) and `key`
 *                  is the property to drive. Flat names like 'legL.knee.x'
 *                  are just labels; the nesting is in the channel map.
 * @param rest      the pose a channel falls back to when the active pose
 *                  does not mention it. Without this, a channel set by one
 *                  state would stay stuck at that value in every state after.
 */
export function createPoseMachine(channels, rest = {}) {
  const names = Object.keys(channels);
  const current = {};
  const additive = {};

  for (const n of names) {
    current[n] = rest[n] || 0;
    additive[n] = 0;
  }

  /** Ease every channel toward `pose`, falling back to `rest`. */
  function blend(pose, dt, rate = 12) {
    const k = 1 - Math.exp(-rate * dt);
    for (const n of names) {
      const target = pose[n] !== undefined ? pose[n] : (rest[n] || 0);
      current[n] += (target - current[n]) * k;
    }
  }

  /** Snap straight to a pose — used on reset, so a run never opens mid-blend. */
  function snap(pose) {
    for (const n of names) {
      current[n] = pose[n] !== undefined ? pose[n] : (rest[n] || 0);
      additive[n] = 0;
    }
  }

  /** Queue an offset for this frame only. Cleared by commit(). */
  function add(name, value) {
    if (additive[name] !== undefined) additive[name] += value;
  }

  /** Write blended + additive out to the actual objects. */
  function commit() {
    for (const n of names) {
      const ch = channels[n];
      ch.obj[ch.key] = current[n] + additive[n];
      additive[n] = 0;
    }
  }

  return {
    blend, snap, add, commit,
    /** Read a blended channel — handy for tests and for driving FX. */
    get: (name) => current[name],
  };
}
