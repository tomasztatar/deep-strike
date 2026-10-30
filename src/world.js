// Ocean environment: terrain, water surface, god rays, marine snow, fog/lighting by depth.
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

export const ARENA_R = 640; // soft boundary of the operations area
const MOUNTS = [];
for (let i = 0; i < 11; i++) {
  const a = srand() * Math.PI * 2, r = 150 + srand() * 400;
  MOUNTS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: 60 + srand() * 110, r2: (40 + srand() * 55) ** 2 });
}

/** Seabed height (y, negative) at world x/z. Used for both rendering and collisions. */
export function heightAt(x, z) {
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

function surfaceTexture() {
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
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rayTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = Math.pow(1 - y / 255, 1.6); // bright at top
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

// ---------- world ----------
export function createWorld(scene) {
  const uniforms = { uTime: { value: 0 } };

  // Lights
  const hemi = new THREE.HemisphereLight(0x8fd8f0, 0x0a1a20, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xc8f0ff, 1.8);
  sun.position.set(80, 300, 40);
  scene.add(sun);

  // Terrain
  const SIZE = 1900, SEG = 190;
  const tgeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tgeo.rotateX(-Math.PI / 2);
  const pos = tgeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  tgeo.computeVertexNormals();
  const nrm = tgeo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xa59670), cMoss = new THREE.Color(0x4d7a55), cRock = new THREE.Color(0x46524f);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    tmp.copy(cSand).lerp(cMoss, vnoise(x * 0.02, z * 0.02) * 0.7);
    tmp.lerp(cRock, smoothstep(0.08, 0.3, slope));
    tmp.multiplyScalar(0.75 + 0.35 * smoothstep(-240, -60, y));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  tgeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // Animated caustics projected from above
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
totalEmissiveRadiance += vec3(0.35, 0.6, 0.65) * caustic(vWPos.xz * 0.018) * smoothstep(-280.0, -60.0, vWPos.y) * 0.55;`);
  };
  const terrain = new THREE.Mesh(tgeo, tmat);
  scene.add(terrain);

  // Rocks
  const ROCKS = 320;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x5c6766, roughness: 1, flatShading: true }),
    ROCKS,
  );
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  for (let i = 0; i < ROCKS; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 720;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 2 + Math.random() * 8;
    p3.set(x, heightAt(x, z) + s * 0.2, z);
    q.setFromEuler(e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    sc.set(s * (0.7 + Math.random() * 0.8), s * (0.5 + Math.random() * 0.6), s * (0.7 + Math.random() * 0.8));
    rocks.setMatrixAt(i, m4.compose(p3, q, sc));
  }
  scene.add(rocks);

  // Kelp forests (instanced, swaying in shader)
  const KELP = 1100;
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
  const kelp = new THREE.InstancedMesh(kgeo, kmat, KELP);
  let k = 0;
  while (k < KELP) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 650;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const n = 8 + Math.floor(Math.random() * 18);
    for (let j = 0; j < n && k < KELP; j++, k++) {
      const x = cx + (Math.random() - 0.5) * 40, z = cz + (Math.random() - 0.5) * 40;
      const hgt = 8 + Math.random() * 26;
      p3.set(x, heightAt(x, z) - 0.5, z);
      q.setFromEuler(e.set(0, Math.random() * 6.28, 0));
      sc.set(1 + Math.random(), hgt, 1 + Math.random());
      kelp.setMatrixAt(k, m4.compose(p3, q, sc));
    }
  }
  scene.add(kelp);

  // Water surface seen from below
  const surfTex = surfaceTexture();
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshBasicMaterial({ map: surfTex, color: 0xa8e8f5, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  );
  surface.rotation.x = Math.PI / 2;
  surface.position.y = 0;
  scene.add(surface);

  // Snell's window glow above the camera
  const snell = new THREE.Mesh(
    new THREE.CircleGeometry(140, 40),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x9fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  snell.rotation.x = Math.PI / 2;
  snell.position.y = -0.4;
  scene.add(snell);

  // God rays
  const rayTex = rayTexture();
  const rayGeo = new THREE.CylinderGeometry(4, 16, 200, 14, 1, true);
  const rays = [];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: rayTex, color: 0xaef0ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(rayGeo, mat);
    m.position.set((Math.random() - 0.5) * 300, -100, (Math.random() - 0.5) * 300);
    m.rotation.z = (Math.random() - 0.5) * 0.25;
    m.userData.phase = Math.random() * 10;
    m.userData.base = 0.05 + Math.random() * 0.09;
    scene.add(m);
    rays.push(m);
  }

  // Marine snow
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

  const shallow = new THREE.Color(0x1d7a96), deep = new THREE.Color(0x03141f), danger = new THREE.Color(0x3a0806);

  function update(dt, camera, time, dangerLevel = 0) {
    uniforms.uTime.value = time;
    const cp = camera.position;
    const depth = Math.max(0, -cp.y);
    const t = smoothstep(0, 230, depth);
    scene.fog.color.copy(shallow).lerp(deep, t).lerp(danger, dangerLevel * 0.35);
    scene.background.copy(scene.fog.color);
    scene.fog.density = 0.0042 + t * 0.0016;
    hemi.intensity = 1.6 - t * 1.05;
    sun.intensity = 1.8 - t * 1.35;

    surfTex.offset.x = time * 0.004;
    surfTex.offset.y = time * 0.0025;
    snell.position.x = cp.x; snell.position.z = cp.z;
    snell.material.opacity = 0.55 * (1 - smoothstep(30, 160, depth));

    const rayFade = 1 - smoothstep(40, 210, depth);
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

  return { update, terrain };
}
