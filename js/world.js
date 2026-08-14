/**
 * world.js — renderer, scene, camera, lights, sky and the scrolling road.
 *
 * The game renders at full device resolution with antialiasing and real
 * soft shadows. The blocky look comes entirely from the geometry being made
 * of boxes — nothing is downsampled. When a device can't keep up,
 * `setQualityStep()` walks resolution and shadow quality down, one way only.
 */

import * as THREE from '../vendor/three.module.min.js';
import { CFG, PAL } from './config.js';
import { buildGroundSlab, makeMesh } from './voxel.js';

/** Quality ladder, applied one way when the frame rate can't hold. */
const QUALITY = [
  { dpr: CFG.MAX_DPR, shadow: CFG.SHADOW_MAP, soft: true },
  { dpr: 1.5, shadow: 1024, soft: true },
  { dpr: 1, shadow: 512, soft: false },
  { dpr: 0.75, shadow: 0, soft: false },
];

/** Vertical gradient sky, drawn on the inside of a big sphere. */
function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PAL.skyTop) },
      horizonColor: { value: new THREE.Color(PAL.skyHorizon) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorld;
      void main() {
        // Biased so the hot band hugs the horizon instead of washing over
        // the whole upper sky.
        float h = clamp(normalize(vWorld).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.3)), 1.0);
        // A raw ShaderMaterial gets none of three's automatic output
        // conversion, so without this the colours land linear on an sRGB
        // framebuffer and read far darker and redder than the palette says.
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
  sky.scale.setScalar(CFG.DRAW_DISTANCE * 0.85);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.toneMapping = THREE.NoToneMapping;  // keeps the flat colour blocking
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Fog matches the horizon band, so the street dissolves into the sky
  // rather than stopping at a hard line.
  scene.fog = new THREE.Fog(PAL.skyHorizon, CFG.FOG_NEAR, CFG.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(CFG.FOV, 1, 0.1, CFG.DRAW_DISTANCE);
  camera.position.set(...CFG.CAMERA_POS);
  camera.lookAt(...CFG.CAMERA_LOOK);

  const sky = makeSky();
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4b93, 1.6));

  const sun = new THREE.DirectionalLight(0xfff0cf, 2.0);
  sun.position.set(14, 24, 10);
  sun.castShadow = true;
  // A tight orthographic frustum around the visible stretch of street.
  // Any larger and the shadow map's resolution is spent on empty asphalt.
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -15;
  shadowCam.right = 15;
  shadowCam.top = 22;
  shadowCam.bottom = -22;
  shadowCam.near = 1;
  shadowCam.far = 95;
  sun.shadow.mapSize.set(CFG.SHADOW_MAP, CFG.SHADOW_MAP);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // --- scrolling road, built from recycled slabs ---
  const slabs = [];
  for (let i = 0; i < CFG.GROUND_SLABS; i++) {
    const slab = buildGroundSlab(i % 2 === 1);
    slab.userData.worldZ = (i - 1) * CFG.SLAB_LEN;
    scene.add(slab);
    slabs.push(slab);
  }

  // --- personal-best ghost marker ---
  // A gate across the street at the furthest the player has ever reached.
  // It scrolls in with everything else, so the target is a place you can see
  // coming rather than a number in the corner.
  const bestMarker = new THREE.Group();
  const bestBar = makeMesh(9.6, 0.28, 0.28, PAL.multi);
  bestBar.position.y = 3.2;
  bestMarker.add(bestBar);
  for (const side of [-1, 1]) {
    const post = makeMesh(0.22, 3.2, 0.22, PAL.multi);
    post.position.set(side * 4.7, 1.6, 0);
    bestMarker.add(post);
  }
  for (const child of bestMarker.children) {
    child.material = child.material.clone();
    child.material.transparent = true;
    child.material.opacity = 0.55;
    child.material.depthWrite = false;
  }
  bestMarker.visible = false;
  scene.add(bestMarker);
  let bestMarkerZ = 0;

  let qualityStep = 0;
  let cssW = 1;
  let cssH = 1;

  /* ---------------- phases ---------------- */

  // Sky and fog lerp from the colours they currently hold toward the new
  // phase's, so a transition never snaps.
  const phaseFrom = { top: new THREE.Color(PAL.skyTop), horizon: new THREE.Color(PAL.skyHorizon) };
  const phaseTo = { top: new THREE.Color(PAL.skyTop), horizon: new THREE.Color(PAL.skyHorizon) };
  let phaseT = 1;

  /** `instant` snaps — used when a run starts, so it never opens mid-fade. */
  function setPhase(phase, instant) {
    phaseFrom.top.copy(sky.material.uniforms.topColor.value);
    phaseFrom.horizon.copy(sky.material.uniforms.horizonColor.value);
    phaseTo.top.set(phase.skyTop);
    phaseTo.horizon.set(phase.skyHorizon);
    phaseT = instant ? 1 : 0;
    if (instant) applyPhase(1);
  }

  function applyPhase(t) {
    sky.material.uniforms.topColor.value.lerpColors(phaseFrom.top, phaseTo.top, t);
    sky.material.uniforms.horizonColor.value.lerpColors(phaseFrom.horizon, phaseTo.horizon, t);
    // Fog tracks the horizon band, which is what keeps the street dissolving
    // into the sky instead of ending at a hard line.
    scene.fog.color.copy(sky.material.uniforms.horizonColor.value);
  }

  function updatePhase(dt) {
    if (phaseT >= 1) return;
    phaseT = Math.min(1, phaseT + dt / CFG.PHASE_FADE);
    applyPhase(phaseT);
  }

  function applyQuality() {
    const q = QUALITY[qualityStep];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    if (q.shadow === 0) {
      renderer.shadowMap.enabled = false;
    } else {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
      if (sun.shadow.mapSize.x !== q.shadow) {
        sun.shadow.mapSize.set(q.shadow, q.shadow);
        // Dispose so the map is rebuilt at the new size.
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
    }
    renderer.shadowMap.needsUpdate = true;
  }

  function resize() {
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    applyQuality();
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  /** One-way quality degradation if the frame rate can't hold up. */
  function setQualityStep(n) {
    const next = Math.min(QUALITY.length - 1, Math.max(qualityStep, n));
    if (next !== qualityStep) {
      qualityStep = next;
      resize();
    }
  }

  const camTarget = new THREE.Vector3(...CFG.CAMERA_LOOK);

  /** Keep the shadow frustum and sky centred on the action. */
  function follow(x) {
    sun.target.position.set(x, 0, -14);
    sun.target.updateMatrixWorld();
    sun.position.set(x + 15, 26, 4);
    sky.position.set(camera.position.x, 0, camera.position.z);
  }

  function updateCamera(player, dt, shake = 0) {
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
    follow(player.x);
  }

  /** Slow orbit used on the menu and while an upgrade choice is on screen. */
  function orbitCamera(t) {
    camera.position.x = Math.sin(t * 0.35) * 2.2;
    camera.position.y = CFG.CAMERA_POS[1] + Math.sin(t * 0.5) * 0.35;
    camTarget.set(0, 1.1, -6);
    camera.lookAt(camTarget);
    camera.rotation.z = 0;
    follow(camera.position.x);
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

    if (bestMarker.visible) {
      const z = -(bestMarkerZ - travelled);
      bestMarker.position.z = z;
      // Hide it once it is behind the player — passing your best should feel
      // like a threshold crossed, not a thing trailing you.
      if (z > CFG.DESPAWN_Z) bestMarker.visible = false;
    }
  }

  /** Place the ghost gate. A distance of 0 (no record yet) hides it. */
  function setBestMarker(distance) {
    bestMarkerZ = distance;
    bestMarker.visible = distance > 0;
    bestMarker.position.z = -distance;
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
    renderer, scene, camera, sun,
    resize, render, updateCamera, orbitCamera, updateGround, resetGround, setQualityStep,
    setPhase, updatePhase, setBestMarker,
    get qualityStep() { return qualityStep; },
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
      pixelRatio: renderer.getPixelRatio(),
      shadows: renderer.shadowMap.enabled,
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
      cssSize: [cssW, cssH],
    }),
  };
}
