/**
 * world.js — renderer, scene, camera, lights, fog and the scrolling road.
 *
 * The pixel-art look comes from one decision made here: render into a very
 * small backbuffer (≈288px tall) and let CSS upscale it with
 * `image-rendering: pixelated`. That gives hard nearest-neighbour pixels and
 * is a large performance *win* rather than a cost, which is what makes the
 * game comfortable on phones.
 */

import * as THREE from '../vendor/three.module.min.js';
import { CFG, PAL } from './config.js';
import { buildGroundSlab } from './voxel.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,        // antialiasing would fight the pixel aesthetic
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(1); // hard 1 — we deliberately undersample
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.sky, CFG.FOG_NEAR, CFG.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(CFG.FOV, 1, 0.1, CFG.DRAW_DISTANCE);
  camera.position.set(...CFG.CAMERA_POS);
  camera.lookAt(...CFG.CAMERA_LOOK);

  // Bright enough that flat-shaded boxes come back close to their palette
  // colour; three's physically-based light units need more than the old
  // 0.5-1.0 range to fully light a surface.
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4b93, 2.1));
  const sun = new THREE.DirectionalLight(0xfff0cf, 1.7);
  sun.position.set(6, 12, 5);
  scene.add(sun);

  // --- scrolling road, built from recycled slabs ---
  const slabs = [];
  for (let i = 0; i < CFG.GROUND_SLABS; i++) {
    const slab = buildGroundSlab(i % 2 === 1);
    slab.userData.worldZ = (i - 1) * CFG.SLAB_LEN;
    scene.add(slab);
    slabs.push(slab);
  }

  let qualityStep = 0;
  let cssW = 1;
  let cssH = 1;

  function resize() {
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);

    const targetH = Math.max(
      CFG.MIN_RENDER_HEIGHT,
      CFG.RENDER_HEIGHT - qualityStep * 48
    );
    // Never render *larger* than the display; on a small phone that means the
    // buffer shrinks with the viewport instead of upscaling a blurry mess.
    const scale = Math.min(1, targetH / cssH);
    renderer.setSize(Math.round(cssW * scale), Math.round(cssH * scale), false);

    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  /** One-way quality degradation if the frame rate can't hold up. */
  function setQualityStep(n) {
    const next = Math.min(3, Math.max(qualityStep, n));
    if (next !== qualityStep) {
      qualityStep = next;
      resize();
    }
  }

  const camTarget = new THREE.Vector3(...CFG.CAMERA_LOOK);

  function updateCamera(player, dt, shake = 0) {
    // Frame-rate independent damping toward the player's lane.
    const k = 1 - Math.exp(-6 * dt);
    const wantX = player.x * CFG.CAMERA_LANE_SWAY;
    const wantY = CFG.CAMERA_POS[1] + player.y * 0.22;
    camera.position.x += (wantX - camera.position.x) * k;
    camera.position.y += (wantY - camera.position.y) * k;

    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }

    camTarget.set(player.x * 0.5, CFG.CAMERA_LOOK[1] + player.y * 0.3, CFG.CAMERA_LOOK[2]);
    camera.lookAt(camTarget);
    camera.rotation.z = -player.leanZ * 0.07;
  }

  /** Slow orbit used while an upgrade choice is on screen. */
  function orbitCamera(t) {
    camera.position.x = Math.sin(t * 0.35) * 2.2;
    camera.position.y = CFG.CAMERA_POS[1] + Math.sin(t * 0.5) * 0.35;
    camTarget.set(0, 1.1, -6);
    camera.lookAt(camTarget);
  }

  function updateGround(travelled) {
    const span = CFG.GROUND_SLABS * CFG.SLAB_LEN;
    for (const slab of slabs) {
      let z = -(slab.userData.worldZ - travelled);
      if (z > CFG.SLAB_LEN / 2 + CFG.DESPAWN_Z) {
        slab.userData.worldZ += span;
        z -= span;
      }
      slab.position.z = z;
    }
  }

  function resetGround() {
    for (let i = 0; i < slabs.length; i++) {
      slabs[i].userData.worldZ = (i - 1) * CFG.SLAB_LEN;
      slabs[i].position.z = -slabs[i].userData.worldZ;
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  resize();

  return {
    renderer, scene, camera,
    resize, render, updateCamera, orbitCamera, updateGround, resetGround, setQualityStep,
    get qualityStep() { return qualityStep; },
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
    }),
  };
}
