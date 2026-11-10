/**
 * fx.js — particles and screen shake.
 *
 * One THREE.Points object with preallocated buffers holds every particle in
 * the game, so all the sparks, dust and trails together cost a single draw
 * call. Untextured points render as squares, which is exactly the pixel-art
 * particle look we want.
 */

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';

export function createFX(scene) {
  const max = CFG.MAX_PARTICLES;

  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const maxLife = new Float32Array(max);
  const gravity = new Float32Array(max);

  let live = 0;   // particles [0, live) are alive; the array is kept compact

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  geometry.setDrawRange(0, 0);

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
  );
  points.frustumCulled = false;
  scene.add(points);

  const tmpColor = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, hex, ttl, grav) {
    if (live >= max) return;
    const i = live++;
    const i3 = i * 3;
    positions[i3] = x; positions[i3 + 1] = y; positions[i3 + 2] = z;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    tmpColor.setHex(hex);
    colors[i3] = tmpColor.r; colors[i3 + 1] = tmpColor.g; colors[i3 + 2] = tmpColor.b;
    life[i] = ttl;
    maxLife[i] = ttl;
    gravity[i] = grav;
  }

  /** Radial burst — coins, shield breaks, landings, air jumps. */
  function burst(pos, hex, count, opts = {}) {
    const speed = opts.speed ?? 3.5;
    const ttl = opts.ttl ?? 0.5;
    const grav = opts.gravity ?? 9;
    const spread = opts.spread ?? 1;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = Math.random() * Math.PI;
      const sp = speed * (0.4 + Math.random() * 0.6);
      spawn(
        pos.x, pos.y, pos.z,
        Math.cos(a) * Math.sin(p) * sp * spread,
        Math.abs(Math.cos(p)) * sp,
        Math.sin(a) * Math.sin(p) * sp * spread,
        hex, ttl * (0.6 + Math.random() * 0.6), grav
      );
    }
  }

  let trailAcc = 0;
  /** Continuous board trail; rate is particles/second. */
  function trail(pos, hex, rate, dt) {
    trailAcc += rate * dt;
    while (trailAcc >= 1) {
      trailAcc -= 1;
      spawn(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.06,
        pos.z + 0.4 + Math.random() * 0.3,
        (Math.random() - 0.5) * 0.8,
        Math.random() * 1.2,
        6 + Math.random() * 3,
        hex, 0.42, 2
      );
    }
  }

  function update(dt) {
    for (let i = 0; i < live; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // Compact by swapping the last live particle into this slot.
        const last = --live;
        if (i !== last) {
          const a = i * 3;
          const b = last * 3;
          for (let k = 0; k < 3; k++) {
            positions[a + k] = positions[b + k];
            colors[a + k] = colors[b + k];
            vel[a + k] = vel[b + k];
          }
          life[i] = life[last];
          maxLife[i] = maxLife[last];
          gravity[i] = gravity[last];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1] -= gravity[i] * dt;
      positions[i3] += vel[i3] * dt;
      positions[i3 + 1] += vel[i3 + 1] * dt;
      positions[i3 + 2] += vel[i3 + 2] * dt;
    }

    geometry.setDrawRange(0, live);
    if (live > 0) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }

  /* ---------------- screen shake ---------------- */

  let shake = 0;
  function addShake(amount) {
    shake = Math.min(0.6, shake + amount);
  }
  function updateShake(dt) {
    shake = Math.max(0, shake - dt * 1.6);
    return shake;
  }

  function reset() {
    live = 0;
    trailAcc = 0;
    shake = 0;
    geometry.setDrawRange(0, 0);
  }

  return {
    burst, trail, update, reset, addShake, updateShake,
    get live() { return live; },
    get shake() { return shake; },
  };
}
