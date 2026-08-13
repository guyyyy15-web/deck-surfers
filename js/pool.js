/**
 * pool.js — generic object pool.
 *
 * Meshes are added to the scene once, on first acquire, and thereafter only
 * toggled via `.visible`. Nothing is disposed during a session, so repeated
 * runs allocate nothing and renderer.info.memory stays flat.
 */

export function createPool(factory, { onAcquire, onRelease } = {}) {
  const free = [];
  let created = 0;
  let live = 0;

  return {
    acquire() {
      let obj = free.pop();
      if (!obj) {
        obj = factory();
        created++;
      }
      live++;
      if (onAcquire) onAcquire(obj);
      return obj;
    },

    release(obj) {
      if (onRelease) onRelease(obj);
      free.push(obj);
      live--;
    },

    /** Number of objects ever constructed — should plateau once warm. */
    get created() {
      return created;
    },
    get live() {
      return live;
    },

    /** Preallocate so the first seconds of a run never hitch. */
    warm(n) {
      const tmp = [];
      for (let i = 0; i < n; i++) tmp.push(this.acquire());
      for (const o of tmp) this.release(o);
    },
  };
}
