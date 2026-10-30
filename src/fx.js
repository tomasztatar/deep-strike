// Visual effects: pooled bubble/spark particles, explosions, sonar ping waves.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
uniform float uFogDensity;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.1);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  vAlpha = aAlpha * (1.0 - fog);
  gl_PointSize = aSize * uScale / dist;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG_BUBBLE = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float rim = smoothstep(0.5, 0.4, d) * (0.2 + 0.8 * smoothstep(0.15, 0.45, d));
  float hl = smoothstep(0.16, 0.0, length(c - vec2(-0.14, -0.14)));
  gl_FragColor = vec4(uColor + hl, (rim + hl * 0.8) * vAlpha);
}`;

const FRAG_GLOW = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 2.0) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

export class Particles {
  constructor(scene, { max = 3000, color = 0xd8f4ff, additive = false, buoyancy = 5, drag = 1.2, wobble = 1 } = {}) {
    this.max = max; this.buoyancy = buoyancy; this.drag = drag; this.additive = additive; this.wobble = wobble;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 }, uFogDensity: { value: 0.005 } },
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_GLOW : FRAG_BUBBLE,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size;
  }

  update(dt, time) {
    const f = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; }
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const j = i * 3;
      this.vel[j] *= f;
      this.vel[j + 2] *= f;
      this.vel[j + 1] = this.vel[j + 1] * f + this.buoyancy * dt;
      const w = this.wobble * Math.sin(time * 7 + i) * dt;
      this.pos[j] += this.vel[j] * dt + w;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt + w;
      if (this.pos[j + 1] > -0.3) { this.pos[j + 1] = -0.3; this.life[i] = Math.min(this.life[i], 0.1); }
      if (this.additive) {
        this.alpha[i] = k;
        this.size[i] = this.size0[i] * (0.5 + (1 - k) * 0.9);
      } else {
        this.alpha[i] = Math.min(1, k * 3) * 0.85;
        this.size[i] = this.size0[i] * (1 + (1 - k) * 0.4);
      }
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.bubbles = new Particles(scene, { max: 4500 });
    this.sparks = new Particles(scene, { max: 1500, color: 0xffa040, additive: true, buoyancy: 1.5, drag: 2.8, wobble: 0 });
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffa860, 0, 220, 1.4);
      scene.add(light);
      this.lights.push({ light, t: 1, dur: 1, power: 0 });
    }
    this.li = 0;
    this.sphere = new THREE.SphereGeometry(1, 24, 16);
    this.items = [];
  }

  setScale(s) {
    this.bubbles.mat.uniforms.uScale.value = s;
    this.sparks.mat.uniforms.uScale.value = s;
  }

  _shell(pos, color, opacity, from, to, dur, wireframe = false) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, wireframe,
    });
    const m = new THREE.Mesh(this.sphere, mat);
    m.position.copy(pos);
    m.scale.setScalar(from);
    this.scene.add(m);
    this.items.push({ m, t: 0, dur, from, to, opacity });
  }

  explosion(pos, scale = 1) {
    this._shell(pos, 0xffe2a8, 1.0, 0.5, 9 * scale, 0.55);
    this._shell(pos, 0xffffff, 0.5, 0.3, 4 * scale, 0.25);
    this._shell(pos, 0x9fe8ff, 0.35, 2, 34 * scale, 0.9);
    const nb = Math.floor(140 * scale), ns = Math.floor(70 * scale);
    for (let i = 0; i < nb; i++) {
      const v = randDir(), s = (4 + Math.random() * 20) * scale;
      this.bubbles.emit(pos.x + v.x, pos.y + v.y, pos.z + v.z, v.x * s, v.y * s + 3, v.z * s, 1.5 + Math.random() * 3, 0.4 + Math.random() * 1.6 * scale);
    }
    for (let i = 0; i < ns; i++) {
      const v = randDir(), s = (6 + Math.random() * 30) * scale;
      this.sparks.emit(pos.x, pos.y, pos.z, v.x * s, v.y * s, v.z * s, 0.3 + Math.random() * 0.7, (3 + Math.random() * 5) * scale);
    }
    const L = this.lights[this.li];
    this.li = (this.li + 1) % this.lights.length;
    L.light.position.copy(pos);
    L.t = 0; L.dur = 0.9 * Math.sqrt(scale); L.power = 9000 * scale;
  }

  fizzle(pos) {
    for (let i = 0; i < 25; i++) {
      const v = randDir();
      this.bubbles.emit(pos.x, pos.y, pos.z, v.x * 4, v.y * 4 + 2, v.z * 4, 1 + Math.random() * 2, 0.3 + Math.random() * 0.6);
    }
  }

  pingWave(pos) {
    this._shell(pos, 0x7ef0ff, 0.16, 5, 650, 2.4, true);
    this._shell(pos, 0x7ef0ff, 0.25, 2, 120, 0.8);
  }

  enemyPingWave(pos) {
    this._shell(pos, 0xff6a4a, 0.1, 5, 320, 2.0, true);
  }

  update(dt, time, fogDensity) {
    this.bubbles.mat.uniforms.uFogDensity.value = fogDensity;
    this.sparks.mat.uniforms.uFogDensity.value = fogDensity * 0.6;
    this.bubbles.update(dt, time);
    this.sparks.update(dt, time);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      const e = 1 - Math.pow(1 - k, 3);
      it.m.scale.setScalar(it.from + (it.to - it.from) * e);
      it.m.material.opacity = it.opacity * (1 - k);
      if (k >= 1) {
        this.scene.remove(it.m);
        it.m.material.dispose();
        this.items.splice(i, 1);
      }
    }
    for (const L of this.lights) {
      if (L.t >= L.dur) { L.light.intensity = 0; continue; }
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      L.light.intensity = L.power * (1 - k) * (1 - k);
    }
  }
}

const _rd = new THREE.Vector3();
function randDir() {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return _rd.set(Math.cos(a) * s, u, Math.sin(a) * s);
}
