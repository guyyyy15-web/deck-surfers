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
import { cloudTexture } from './textures.js';

/** Quality ladder, applied one way when the frame rate can't hold. */
const QUALITY = [
  { dpr: CFG.MAX_DPR, shadow: CFG.SHADOW_MAP, soft: true, skyDetail: 1 },
  { dpr: 1.5, shadow: 1024, soft: true, skyDetail: 1 },
  { dpr: 1, shadow: 512, soft: false, skyDetail: 0 },
  { dpr: 0.75, shadow: 0, soft: false, skyDetail: 0 },
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
      sunColor: { value: new THREE.Color(PAL.sun) },
      // Everything below is per-phase, lerped alongside the two colours.
      starAmount: { value: 0 },
      cloudAmount: { value: 0.5 },
      sunHeight: { value: 0.06 },
      time: { value: 0 },
      cloudMap: { value: cloudTexture() },
      detail: { value: 1 },
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
      uniform vec3 sunColor;
      uniform float starAmount;
      uniform float cloudAmount;
      uniform float sunHeight;
      uniform float time;
      uniform sampler2D cloudMap;
      uniform float detail;      // 1 on the top quality steps, 0 lower down
      varying vec3 vWorld;

      // Hash without a sin(). The sky covers the whole screen, so this runs
      // millions of times a frame — the usual fract(sin(dot(...))) idiom cost
      // about a third of the frame rate on a software rasteriser.
      float hash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }

      void main() {
        vec3 dir = normalize(vWorld);
        // Biased so the hot band hugs the horizon instead of washing over
        // the whole upper sky.
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.3));

        // --- stars: only up high, and only when the phase asks for them ---
        if (starAmount * detail > 0.001) {
          vec2 cell = floor(dir.xz * 90.0 / max(dir.y + 0.35, 0.25));
          float s = hash(cell);
          float star = smoothstep(0.9955, 1.0, s);
          // Twinkle, offset per star so they don't pulse in unison.
          float tw = 0.65 + 0.35 * sin(time * 2.2 + s * 63.0);
          col += vec3(star * tw * starAmount * smoothstep(0.02, 0.5, dir.y));
        }

        // --- a sun/moon sitting just above the horizon, behind the city ---
        vec3 sunDir = normalize(vec3(0.36, sunHeight, -1.0));
        float d = distance(dir, sunDir);
        col += sunColor * smoothstep(0.16, 0.0, d) * 0.9;          // disc
        col += sunColor * smoothstep(0.75, 0.0, d) * 0.16;         // bloom

        // --- soft banded cloud, drifting ---
        // A dome projection, one texture fetch and a mask. Baked rather than
        // evaluated as noise here mostly for art control — it is easier to
        // draw a good cloud in a canvas than to talk two octaves of value
        // noise into looking like one. The divisor is clamped so the horizon
        // cannot blow the UVs up into a shimmering mess.
        float cloudMask = smoothstep(0.62, 0.10, dir.y)
                        * smoothstep(0.0, 0.10, dir.y) * cloudAmount * detail;
        vec2 cuv = dir.xz / max(dir.y, 0.09) * 0.055 + vec2(time * 0.004, 0.0);
        float n = texture2D(cloudMap, cuv).r;
        col = mix(col, mix(col, topColor * 0.6 + horizonColor * 0.75, 0.75),
                  smoothstep(0.16, 0.60, n) * cloudMask);

        gl_FragColor = vec4(col, 1.0);
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
  // Drawn *after* the opaque scene, not before it. The sky shader is the most
  // expensive one in the game and it covers the whole screen, so letting the
  // depth buffer reject the pixels the city already fills is worth far more
  // than the sorting it costs. depthWrite stays off so it never occludes.
  sky.renderOrder = 1000;
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

  // Held rather than discarded: phases dim it, so the night actually reads as
  // night on the ground and not just in the sky.
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a4b93, 1.6);
  scene.add(hemi);

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
  const U = sky.material.uniforms;
  const mkSide = () => ({
    top: new THREE.Color(PAL.skyTop),
    horizon: new THREE.Color(PAL.skyHorizon),
    sun: new THREE.Color(PAL.sun),
    stars: 0, clouds: 0.5, sunHeight: 0.06, ambient: 1.6,
  });
  const phaseFrom = mkSide();
  const phaseTo = mkSide();
  let phaseT = 1;

  /** `instant` snaps — used when a run starts, so it never opens mid-fade. */
  function setPhase(phase, instant) {
    phaseFrom.top.copy(U.topColor.value);
    phaseFrom.horizon.copy(U.horizonColor.value);
    phaseFrom.sun.copy(U.sunColor.value);
    phaseFrom.stars = U.starAmount.value;
    phaseFrom.clouds = U.cloudAmount.value;
    phaseFrom.sunHeight = U.sunHeight.value;
    phaseFrom.ambient = hemi.intensity;

    phaseTo.top.set(phase.skyTop);
    phaseTo.horizon.set(phase.skyHorizon);
    phaseTo.sun.set(phase.sun);
    phaseTo.stars = phase.stars;
    phaseTo.clouds = phase.clouds;
    phaseTo.sunHeight = phase.sunHeight;
    phaseTo.ambient = phase.ambient;

    phaseT = instant ? 1 : 0;
    if (instant) applyPhase(1);
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  function applyPhase(t) {
    U.topColor.value.lerpColors(phaseFrom.top, phaseTo.top, t);
    U.horizonColor.value.lerpColors(phaseFrom.horizon, phaseTo.horizon, t);
    U.sunColor.value.lerpColors(phaseFrom.sun, phaseTo.sun, t);
    U.starAmount.value = lerp(phaseFrom.stars, phaseTo.stars, t);
    U.cloudAmount.value = lerp(phaseFrom.clouds, phaseTo.clouds, t);
    U.sunHeight.value = lerp(phaseFrom.sunHeight, phaseTo.sunHeight, t);

    // Ambient follows the sky, so NIGHT RUN is genuinely darker down on the
    // street rather than only overhead — and the emissive coins and lit
    // windows get something to stand out against.
    hemi.intensity = lerp(phaseFrom.ambient, phaseTo.ambient, t);
    sun.intensity = hemi.intensity * 1.25;

    // Fog tracks the horizon band, which is what keeps the street dissolving
    // into the sky instead of ending at a hard line.
    scene.fog.color.copy(U.horizonColor.value);
  }

  function updatePhase(dt) {
    // Stars twinkle and cloud drifts even when no transition is running.
    U.time.value += dt;
    if (phaseT >= 1) return;
    phaseT = Math.min(1, phaseT + dt / CFG.PHASE_FADE);
    applyPhase(phaseT);
  }

  function applyQuality() {
    const q = QUALITY[qualityStep];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    // The sky is the one full-screen shader in the game, so it takes part in
    // the same one-way degradation as resolution and shadows: on the lower
    // steps it drops to the plain gradient and sun, losing stars and cloud.
    sky.material.uniforms.detail.value = q.skyDetail;
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
