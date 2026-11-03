// Ocean environment: terrain profiles, water surface (above & below), sky, god rays, marine snow, lighting.
import * as THREE from 'three';

// ---------- deterministic noise ----------
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let seed = 20261030;
const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export const ARENA_R = 640; // soft boundary of the arcade operations area
const MOUNTS = [];
for (let i = 0; i < 11; i++) {
  const a = srand() * Math.PI * 2, r = 150 + srand() * 400;
  MOUNTS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: 60 + srand() * 110, r2: (40 + srand() * 55) ** 2 });
}

function arcadeHeight(x, z) {
  const n = fbm(x * 0.0035 + 7.3, z * 0.0035 - 2.1);
  const rn = vnoise(x * 0.009 + 50, z * 0.009 + 11);
  const ridge = 1 - Math.abs(rn * 2 - 1);
  let h = -235 + n * 115 + ridge * ridge * 28;
  for (let i = 0; i < MOUNTS.length; i++) {
    const m = MOUNTS[i];
    const dx = x - m.x, dz = z - m.z;
    const q = (dx * dx + dz * dz) / m.r2;
    if (q < 9) h += m.h * Math.exp(-q);
  }
  const r = Math.sqrt(x * x + z * z);
  if (r > 560) h += smoothstep(560, 840, r) * 300;
  return Math.min(h, -12);
}

// Open Atlantic: far deeper than any submarine's crush depth.
function oceanHeight(x, z) {
  return -540 + fbm(x * 0.0012 + 3, z * 0.0012 - 5) * 120;
}

// Coastline running north-south with a harbour bay at z≈0; land lies east (x > coastX).
export function coastX(z) {
  return 1100 + 200 * Math.sin(z * 0.0011 + 0.6) + (fbm(5.1, z * 0.004) - 0.5) * 220 + 640 * Math.exp(-((z / 330) ** 2));
}
export const ISLANDS = [
  { x: -350, z: 1100, h: 190, r2: 170 ** 2 },
  { x: 150, z: -1350, h: 175, r2: 150 ** 2 },
];
function coastalHeight(x, z) {
  const d = x - coastX(z);
  let h;
  if (d > 0) h = 1.5 + Math.min(d * 0.09, 28) + fbm(x * 0.004, z * 0.004) * 55 * smoothstep(0, 400, d);
  else h = Math.max(-185, 1.5 + d * 0.085 - 7.5 * smoothstep(0, -60, d)) + (fbm(x * 0.006 + 9, z * 0.006) - 0.5) * 12;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const q = (dx * dx + dz * dz) / isl.r2;
    if (q < 9) h += isl.h * Math.exp(-q);
  }
  return h;
}

let profile = 'arcade';
/** Seabed (or land) height at world x/z for the active terrain profile. */
export function heightAt(x, z) {
  if (profile === 'ocean') return oceanHeight(x, z);
  if (profile === 'coastal') return coastalHeight(x, z);
  return arcadeHeight(x, z);
}
export const getProfile = () => profile;

// ---------- procedural textures ----------
let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

function surfaceCanvas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#6f9fb0';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 22;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, 'rgba(230,255,255,0.55)');
      grd.addColorStop(1, 'rgba(230,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

function rayTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = Math.pow(1 - y / 255, 1.6);
    for (let x = 0; x < 64; x++) {
      const u = 0.5 + 0.5 * Math.sin((x / 64) * Math.PI * 6);
      const a = v * (0.35 + 0.65 * u);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.floor(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// ---------- lighting environments ----------
const ENVS = {
  arcade: {
    sky: false, light: 1, shallow: 0x1d7a96, deep: 0x03141f,
    hemiSky: 0x8fd8f0, hemiGround: 0x0a1a20, hemi: 1.6, sunColor: 0xc8f0ff, sun: 1.8, sunDir: [80, 300, 40],
    fogAbove: 0x9fb8c8, fogAboveDensity: 0.0006, skyTop: 0x3d6f9e, skyHorizon: 0xa9c3d3, sea: 0x1d4f62, stars: false, rays: 1,
  },
  day: {
    sky: true, light: 1, shallow: 0x1d6f8a, deep: 0x021019,
    hemiSky: 0xcfe6ff, hemiGround: 0x2a4a5a, hemi: 1.5, sunColor: 0xfff3dd, sun: 2.4, sunDir: [600, 900, 300],
    fogAbove: 0xa4bccb, fogAboveDensity: 0.00052, skyTop: 0x3c6c9c, skyHorizon: 0xb3c9d6, sea: 0x1c4a5e, stars: false, rays: 1,
  },
  dusk: {
    sky: true, light: 0.55, shallow: 0x174a62, deep: 0x020a12,
    hemiSky: 0xd8a080, hemiGround: 0x202a3a, hemi: 0.9, sunColor: 0xffa060, sun: 1.6, sunDir: [-900, 160, 300],
    fogAbove: 0x7a6e78, fogAboveDensity: 0.0008, skyTop: 0x27355e, skyHorizon: 0xd88a5c, sea: 0x2a5064, stars: false, rays: 0.4,
  },
  night: {
    sky: true, light: 0.22, shallow: 0x062430, deep: 0x01060a,
    hemiSky: 0x5a6f9a, hemiGround: 0x0a0f18, hemi: 0.55, sunColor: 0xa8b8ff, sun: 0.7, sunDir: [-300, 600, -700],
    fogAbove: 0x0f1a2a, fogAboveDensity: 0.0015, skyTop: 0x02050c, skyHorizon: 0x17253a, sea: 0x08141e, stars: true, rays: 0,
  },
};

// ---------- world ----------
export function createWorld(scene) {
  const uniforms = { uTime: { value: 0 } };
  let env = ENVS.arcade;

  const hemi = new THREE.HemisphereLight(0x8fd8f0, 0x0a1a20, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xc8f0ff, 1.8);
  sun.position.set(80, 300, 40);
  scene.add(sun);

  // ---- terrain material (vertex colours + animated caustics below water) ----
  const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  tmat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uTime;
float caustic(vec2 uv) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float t = uTime * 0.45 * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.35, 0.6, 0.65) * caustic(vWPos.xz * 0.018) * smoothstep(-280.0, -60.0, vWPos.y) * (1.0 - smoothstep(-3.0, 0.0, vWPos.y)) * 0.55 * uCaustic;`)
      .replace('uniform float uTime;', 'uniform float uTime;\nuniform float uCaustic;');
    shader.uniforms.uCaustic = uniforms.uCaustic;
  };
  uniforms.uCaustic = { value: 1 };

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c6766, roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const kgeo = new THREE.CylinderGeometry(0.12, 0.45, 1, 5, 6);
  kgeo.translate(0, 0.5, 0);
  const kmat = new THREE.MeshStandardMaterial({ color: 0x3b7d40, roughness: 0.8, emissive: 0x0b2a10 });
  kmat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
#else
float ph = 0.0;
#endif
float bend = position.y * position.y;
transformed.x += sin(uTime * 1.1 + ph) * 2.2 * bend;
transformed.z += cos(uTime * 0.8 + ph * 1.3) * 1.6 * bend;`);
  };

  let terrainGroup = null;
  const landmarks = {};
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();

  function buildTerrain() {
    if (terrainGroup) {
      scene.remove(terrainGroup);
      terrainGroup.traverse((o) => { if (o.geometry && o.geometry !== rockGeo && o.geometry !== kgeo) o.geometry.dispose(); });
    }
    terrainGroup = new THREE.Group();
    for (const k of Object.keys(landmarks)) delete landmarks[k];
    const cfg = { arcade: [1900, 190], ocean: [9000, 110], coastal: [7600, 220] }[profile];
    const [SIZE, SEG] = cfg;
    const tgeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    tgeo.rotateX(-Math.PI / 2);
    const pos = tgeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    tgeo.computeVertexNormals();
    const nrm = tgeo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xa59670), cMoss = new THREE.Color(0x4d7a55), cRock = new THREE.Color(0x46524f);
    const cBeach = new THREE.Color(0xc9b98a), cGrass = new THREE.Color(0x4c6a38), cCliff = new THREE.Color(0x6e6c66);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const slope = 1 - nrm.getY(i);
      if (y > 0.5) {
        tmp.copy(cBeach).lerp(cGrass, smoothstep(2.5, 6, y) * (0.7 + 0.3 * vnoise(x * 0.03, z * 0.03)));
        tmp.lerp(cCliff, smoothstep(0.12, 0.35, slope));
      } else {
        tmp.copy(cSand).lerp(cMoss, vnoise(x * 0.02, z * 0.02) * 0.7);
        tmp.lerp(cRock, smoothstep(0.08, 0.3, slope));
        tmp.multiplyScalar(0.75 + 0.35 * smoothstep(-240, -60, y));
      }
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    tgeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGroup.add(new THREE.Mesh(tgeo, tmat));

    // Rocks & kelp: only where the seabed is visible
    const placeRandom = profile === 'arcade'
      ? () => { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 720; return [Math.cos(a) * r, Math.sin(a) * r]; }
      : () => [-600 + Math.random() * 2600, -1700 + Math.random() * 3400];
    const okDepth = (h, lo, hi) => profile === 'arcade' || (h > lo && h < hi);
    if (profile !== 'ocean') {
      const ROCKS = profile === 'arcade' ? 320 : 420;
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
      let n = 0;
      for (let t = 0; t < ROCKS * 30 && n < ROCKS; t++) {
        const [x, z] = placeRandom();
        const h = heightAt(x, z);
        if (!okDepth(h, -110, -4)) continue;
        const s = profile === 'arcade' ? 2 + Math.random() * 8 : 2 + Math.random() * 6;
        p3.set(x, h + s * 0.2, z);
        q.setFromEuler(e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
        sc.set(s * (0.7 + Math.random() * 0.8), s * (0.5 + Math.random() * 0.6), s * (0.7 + Math.random() * 0.8));
        rocks.setMatrixAt(n++, m4.compose(p3, q, sc));
      }
      rocks.count = n;
      terrainGroup.add(rocks);

      const KELP = 1100;
      const kelp = new THREE.InstancedMesh(kgeo, kmat, KELP);
      let k = 0;
      for (let t = 0; t < 4000 && k < KELP; t++) {
        const [cx, cz] = placeRandom();
        if (!okDepth(heightAt(cx, cz), -70, -10)) continue;
        const cnt = 8 + Math.floor(Math.random() * 18);
        for (let j = 0; j < cnt && k < KELP; j++) {
          const x = cx + (Math.random() - 0.5) * 40, z = cz + (Math.random() - 0.5) * 40;
          const h = heightAt(x, z);
          if (!okDepth(h, -75, -8)) continue;
          const hgt = Math.min(8 + Math.random() * 26, -h - 3);
          p3.set(x, h - 0.5, z);
          q.setFromEuler(e.set(0, Math.random() * 6.28, 0));
          sc.set(1 + Math.random(), hgt, 1 + Math.random());
          kelp.setMatrixAt(k++, m4.compose(p3, q, sc));
        }
      }
      kelp.count = k;
      terrainGroup.add(kelp);
    }
    if (profile === 'coastal') buildCoastDeco();
    scene.add(terrainGroup);
  }

  // Lighthouse, harbour town, pier.
  function buildCoastDeco() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0x9a3328, roughness: 0.8 });
    const wall = new THREE.MeshStandardMaterial({ color: 0xbcae96, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x7a3a2a, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });

    const lz = 600, lx = coastX(lz) + 45, ly = heightAt(lx, lz);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 26, 12), white);
    tower.position.set(lx, ly + 13, lz);
    terrainGroup.add(tower);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.15, 4, 12), red);
    band.position.set(lx, ly + 15, lz);
    terrainGroup.add(band);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0b0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    lamp.scale.setScalar(40);
    lamp.position.set(lx, ly + 28, lz);
    terrainGroup.add(lamp);
    landmarks.lighthouse = { x: lx, y: ly + 28, z: lz, lamp };

    const bx = coastX(-560) + 70, bz = -560;
    landmarks.battery = { x: bx, y: heightAt(bx, bz), z: bz };

    for (let i = 0; i < 26; i++) {
      const z = -260 + Math.random() * 520;
      const x = coastX(z) + 25 + Math.random() * 160;
      const y = heightAt(x, z);
      const w = 6 + Math.random() * 8, h = 4 + Math.random() * 7, d = 6 + Math.random() * 8;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
      b.position.set(x, y + h / 2 - 0.5, z);
      b.rotation.y = Math.random() * 0.3;
      terrainGroup.add(b);
      const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 3.5, 4), roof);
      r.position.set(x, y + h + 1.2, z);
      r.rotation.y = Math.PI / 4 + b.rotation.y;
      terrainGroup.add(r);
    }
    const px = coastX(0);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(160, 2, 8), wood);
    pier.position.set(px - 70, 1.2, 0);
    terrainGroup.add(pier);
    landmarks.harbor = { x: px - 250, z: 0 };
  }

  // ---- water surface: underside (seen from below) and top (seen from above) ----
  const sc1 = surfaceCanvas();
  const surfTex = new THREE.CanvasTexture(sc1);
  surfTex.wrapS = surfTex.wrapT = THREE.RepeatWrapping;
  surfTex.repeat.set(190, 190);
  surfTex.colorSpace = THREE.SRGBColorSpace;
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(16000, 16000),
    new THREE.MeshBasicMaterial({ map: surfTex, color: 0xa8e8f5, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  surface.rotation.x = Math.PI / 2; // normal faces down → visible from below only
  scene.add(surface);

  const bumpTex = new THREE.CanvasTexture(sc1);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(700, 700);
  const seaMat = new THREE.MeshPhongMaterial({ color: 0x1c4a5e, specular: 0x6a8a9a, shininess: 60, bumpMap: bumpTex, bumpScale: 3 });
  const seaTop = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), seaMat);
  seaTop.rotation.x = -Math.PI / 2;
  seaTop.position.y = 0.02;
  scene.add(seaTop);

  const snell = new THREE.Mesh(
    new THREE.CircleGeometry(140, 40),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x9fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  snell.rotation.x = Math.PI / 2;
  snell.position.y = -0.4;
  scene.add(snell);

  // ---- sky dome, sun/moon, stars ----
  const skyU = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){ float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(smoothstep(0.0, 0.6, h), 0.8)), 1.0); }',
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2cc, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunSprite.scale.setScalar(900);
  sunSprite.renderOrder = -9;
  scene.add(sunSprite);
  const starPos = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const u = Math.random() * 0.95 + 0.05, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    starPos[i * 3] = Math.cos(a) * s * 5500; starPos[i * 3 + 1] = u * 5500; starPos[i * 3 + 2] = Math.sin(a) * s * 5500;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  scene.add(stars);

  // ---- god rays ----
  const rayTex = rayTexture();
  const rayGeo = new THREE.CylinderGeometry(4, 16, 200, 14, 1, true);
  const rays = [];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: rayTex, color: 0xaef0ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(rayGeo, mat);
    m.position.set((Math.random() - 0.5) * 300, -100, (Math.random() - 0.5) * 300);
    m.rotation.z = (Math.random() - 0.5) * 0.25;
    m.userData.phase = Math.random() * 10;
    m.userData.base = 0.05 + Math.random() * 0.09;
    scene.add(m);
    rays.push(m);
  }

  // ---- marine snow ----
  const SNOW = 3000, B = 170;
  const snowPos = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW * 3; i++) snowPos[i] = (Math.random() - 0.5) * B;
  const snowGeo = new THREE.BufferGeometry();
  const snowAttr = new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage);
  snowGeo.setAttribute('position', snowAttr);
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    color: 0xd6eef5, size: 0.45, map: glowTexture(), transparent: true, opacity: 0.6, depthWrite: false,
  }));
  snow.frustumCulled = false;
  scene.add(snow);

  const shallow = new THREE.Color(), deep = new THREE.Color(), danger = new THREE.Color(0x3a0806);
  const fogAbove = new THREE.Color();

  function setEnv(name) {
    env = ENVS[name] || ENVS.arcade;
    shallow.set(env.shallow);
    deep.set(env.deep);
    fogAbove.set(env.fogAbove);
    hemi.color.set(env.hemiSky);
    hemi.groundColor.set(env.hemiGround);
    sun.color.set(env.sunColor);
    sun.position.set(...env.sunDir);
    skyU.top.value.set(env.skyTop);
    skyU.horizon.value.set(env.skyHorizon);
    seaMat.color.set(env.sea);
    sunSprite.material.color.set(env.stars ? 0xdfe6ff : env.sunColor);
    sunSprite.scale.setScalar(env.stars ? 380 : 900);
    stars.visible = env.stars;
    uniforms.uCaustic.value = env.light;
    if (landmarks.lighthouse) landmarks.lighthouse.lamp.visible = env.light < 0.7;
  }

  function setProfile(name, envName) {
    profile = name;
    buildTerrain();
    setEnv(envName || (name === 'arcade' ? 'arcade' : 'day'));
  }

  function update(dt, camera, time, dangerLevel = 0) {
    uniforms.uTime.value = time;
    const cp = camera.position;
    const above = cp.y > 0.05;
    sky.visible = above && env.sky;
    sky.position.copy(cp);
    stars.position.copy(cp);
    const sd = sun.position.clone().normalize().multiplyScalar(5200);
    sunSprite.position.copy(cp).add(sd);
    sunSprite.visible = above && env.sky;
    stars.visible = above && env.stars;

    if (above) {
      scene.fog.color.copy(fogAbove);
      scene.fog.density = env.fogAboveDensity;
      scene.background.copy(fogAbove);
      hemi.intensity = env.hemi;
      sun.intensity = env.sun;
      snow.visible = false;
      snell.material.opacity = 0;
      for (const r of rays) r.material.opacity = 0;
    } else {
      const depth = Math.max(0, -cp.y);
      const t = smoothstep(0, 230, depth);
      scene.fog.color.copy(shallow).lerp(deep, t).lerp(danger, dangerLevel * 0.35);
      scene.background.copy(scene.fog.color);
      scene.fog.density = 0.0042 + t * 0.0016;
      hemi.intensity = (1.6 - t * 1.05) * env.light;
      sun.intensity = (1.8 - t * 1.35) * env.light;
      snow.visible = true;
      snell.position.x = cp.x; snell.position.z = cp.z;
      snell.material.opacity = 0.55 * (1 - smoothstep(30, 160, depth)) * env.light;
      const rayFade = (1 - smoothstep(40, 210, depth)) * env.rays;
      for (const r of rays) {
        const dx = r.position.x - cp.x, dz = r.position.z - cp.z;
        if (dx * dx + dz * dz > 190 * 190) {
          const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 150;
          r.position.x = cp.x + Math.cos(a) * d;
          r.position.z = cp.z + Math.sin(a) * d;
        }
        r.position.x += Math.sin(time * 0.1 + r.userData.phase) * dt * 0.8;
        r.material.opacity = r.userData.base * rayFade * (0.6 + 0.4 * Math.sin(time * 0.5 + r.userData.phase));
      }
      const half = B / 2;
      for (let i = 0; i < SNOW; i++) {
        const ix = i * 3;
        snowPos[ix + 1] -= dt * 0.35;
        for (let c = 0; c < 3; c++) {
          const cc = c === 0 ? cp.x : c === 1 ? cp.y : cp.z;
          let v = snowPos[ix + c];
          if (v - cc > half) v -= B; else if (v - cc < -half) v += B;
          snowPos[ix + c] = v;
        }
      }
      snowAttr.needsUpdate = true;
    }
    surfTex.offset.x = time * 0.004;
    surfTex.offset.y = time * 0.0025;
    bumpTex.offset.x = time * 0.01;
    bumpTex.offset.y = time * 0.006;
    if (landmarks.lighthouse && landmarks.lighthouse.lamp.visible) {
      landmarks.lighthouse.lamp.material.opacity = 0.5 + 0.5 * Math.max(0, Math.sin(time * 1.6));
    }
  }

  setProfile('arcade');
  return { update, setProfile, setEnv, landmarks, get env() { return env; } };
}
