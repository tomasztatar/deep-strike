// DEEP STRIKE — main loop, input, camera, waves, scoring.
import * as THREE from 'three';
import { G } from './state.js';
import { createWorld, heightAt, ARENA_R } from './world.js';
import { FX } from './fx.js';
import { SoundSystem } from './audio.js';
import { HUD } from './hud.js';
import { Player, EnemySub, Destroyer, Mine, Pickup, pickupKind, Wreck, rand, clamp, volAt, angleWrap } from './entities.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1d7a96, 0.0045);
scene.background = new THREE.Color(0x1d7a96);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2600);

G.scene = scene;
G.camera = camera;
G.world = createWorld(scene);
G.fx = new FX(scene);
G.audio = new SoundSystem();
G.hud = new HUD();
G.player = new Player();
G.camDist = 24;

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  G.fx.setScale((renderer.getPixelRatio() * innerHeight) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
}
addEventListener('resize', onResize);
onResize();

// ---------- input ----------
const keys = new Set();
let firing = false, rmb = false, orbitYaw = 0, orbitPitch = 0;
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

addEventListener('keydown', (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (G.state === 'playing') {
    if (e.code === 'Space') G.player.fire();
    if (e.code === 'KeyQ') G.player.dropDecoy();
    if (e.code === 'KeyE') G.player.ping();
    if (e.code === 'Tab') cycleLock();
    if (e.code === 'KeyX') G.player.throttle = 0;
    if (e.code === 'KeyP' || e.code === 'Escape') setPaused(true);
  } else if (G.state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) setPaused(false);
  if (e.code === 'KeyM') G.audio.setMuted(!G.audio.muted);
  if (e.code === 'Enter' && (G.state === 'menu' || G.state === 'over')) startGame();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => {
  keys.clear();
  firing = false;
  if (G.state === 'playing') setPaused(true);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) { firing = true; if (G.state === 'playing') G.player.fire(); }
  if (e.button === 2) rmb = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) rmb = false;
});
addEventListener('mousemove', (e) => {
  if (!rmb) return;
  orbitYaw -= e.movementX * 0.006;
  orbitPitch = clamp(orbitPitch + e.movementY * 0.004, -0.5, 1.0);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  G.camDist = clamp(G.camDist + Math.sign(e.deltaY) * 3, 12, 60);
}, { passive: false });

const input = {};
function readInput() {
  input.throttleUp = keys.has('KeyW');
  input.throttleDown = keys.has('KeyS');
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  input.up = keys.has('KeyR') || keys.has('ArrowUp');
  input.down = keys.has('KeyF') || keys.has('ArrowDown');
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

// ---------- UI ----------
const ui = {
  menu: document.getElementById('menu'),
  pause: document.getElementById('pause'),
  over: document.getElementById('gameover'),
  goStats: document.getElementById('goStats'),
  goSub: document.getElementById('goSub'),
  hiscore: document.getElementById('hiscore'),
};
const HI_KEY = 'deepstrike_hiscore';
const getHi = () => Number(localStorage.getItem(HI_KEY)) || 0;
ui.hiscore.textContent = getHi().toLocaleString();
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', () => setPaused(false));

function setPaused(p) {
  if (p && G.state === 'playing') {
    G.state = 'paused';
    ui.pause.classList.remove('hidden');
    G.audio.setEngine(0, false);
    if (G.audio.ctx) G.audio.ctx.suspend();
  } else if (!p && G.state === 'paused') {
    G.state = 'playing';
    ui.pause.classList.add('hidden');
    if (G.audio.ctx) G.audio.ctx.resume();
    last = performance.now();
  }
}

// ---------- game flow ----------
function clearEntities() {
  for (const list of [G.enemies, G.torpedoes, G.charges, G.decoys, G.pickups, G.wrecks]) {
    for (const o of list) if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
    list.length = 0;
  }
}

function startGame() {
  G.audio.init();
  clearEntities();
  if (G.player && G.player.mesh.parent) scene.remove(G.player.mesh);
  G.player = new Player();
  Object.assign(G, {
    score: 0, wave: 0, combo: 1, comboTimer: 0, shake: 0, lockTarget: null, hardLock: false, pingReveal: 0,
    waveCleared: false, intermission: 0, waveDamage: 0, incoming: [], alarmT: 0, lowHullT: 0, detectCueT: 0,
    stats: { fired: 0, hits: 0, kills: 0, evaded: 0 },
  });
  G.hud.clear();
  G.hud.show(true);
  ui.menu.classList.add('hidden');
  ui.over.classList.add('hidden');
  ui.pause.classList.add('hidden');
  G.state = 'playing';
  orbitYaw = 0; orbitPitch = 0;
  camera.position.set(0, -50, -30);
  camLook.copy(G.player.pos);
  startWave(1);
  canvas.focus();
}

function spawnPoint(minDist, yFn) {
  const P = G.player.pos;
  for (let tries = 0; tries < 40; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(150, ARENA_R - 60);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - P.x, z - P.z) < minDist) continue;
    const g = heightAt(x, z);
    return new THREE.Vector3(x, yFn(g), z);
  }
  return new THREE.Vector3(ARENA_R - 100, -40, 0);
}

function startWave(n) {
  G.wave = n;
  G.waveCleared = false;
  G.waveDamage = 0;
  // clear leftover mines
  for (const e of G.enemies) if (e.type === 'mine' && e.alive) { e.alive = false; scene.remove(e.mesh); }

  const subs = Math.min(1 + Math.ceil(n * 0.8), 8);
  const heavy = n >= 3 ? Math.min(Math.floor((n - 1) / 2), subs) : 0;
  const destroyers = n >= 2 ? Math.min(Math.floor(n / 2), 4) : 0;
  const mines = n >= 2 ? Math.min(6 + n * 2, 26) : 0;

  for (let i = 0; i < subs; i++) {
    const p = spawnPoint(320, (g) => rand(Math.min(g + 30, -25), -25));
    G.enemies.push(new EnemySub(p, i < heavy));
  }
  for (let i = 0; i < destroyers; i++) G.enemies.push(new Destroyer(spawnPoint(300, () => 0)));
  for (let i = 0; i < mines; i++) {
    // mines cluster in fields
    const p = spawnPoint(120, (g) => rand(g + 15, Math.max(g + 16, -15)));
    G.enemies.push(new Mine(p));
  }
  const crates = 1 + Math.floor(n / 3);
  for (let i = 0; i < crates; i++) G.pickups.push(new Pickup(spawnPoint(80, (g) => rand(g + 20, Math.max(g + 21, -20))), pickupKind()));

  const parts = [`${subs} SUBMARINE${subs > 1 ? 'S' : ''}`];
  if (heavy) parts.push(`${heavy} HUNTER-KILLER${heavy > 1 ? 'S' : ''}`);
  if (destroyers) parts.push(`${destroyers} DESTROYER${destroyers > 1 ? 'S' : ''}`);
  if (mines) parts.push('MINEFIELD');
  G.hud.banner(`WAVE ${n}`, parts.join(' · '), 3.5);
  G.audio.ping(0.6, 980);
}

function hostileCount() {
  let c = 0;
  for (const e of G.enemies) if (e.alive && e.type !== 'mine') c++;
  return c;
}

function waveLogic(dt) {
  if (!G.waveCleared && hostileCount() === 0) {
    G.waveCleared = true;
    G.intermission = 7;
    const P = G.player;
    let bonus = 250 * G.wave;
    let sub = `BONUS +${bonus}`;
    if (G.waveDamage === 0) { bonus += 500; sub = `BONUS +${bonus} · UNTOUCHED!`; }
    G.score += bonus;
    P.hp = Math.min(P.maxHp, P.hp + 30);
    P.torps = Math.min(P.maxTorps, P.torps + 5);
    P.decoys = Math.max(P.decoys, P.maxDecoys);
    G.hud.banner('WAVE CLEARED', `${sub} · RESUPPLIED`, 4);
    G.audio.fanfare();
  }
  if (G.waveCleared) {
    G.intermission -= dt;
    if (G.intermission <= 0) startWave(G.wave + 1);
  }
}

// ---------- callbacks used by entities ----------
G.blast = (pos, radius, maxDmg, exclude, src) => {
  const P = G.player;
  if (P.alive && P !== exclude) {
    const d = pos.distanceTo(P.pos);
    if (d < radius) P.damage(maxDmg * (1 - d / radius));
  }
  for (const e of G.enemies) {
    if (!e.alive || e === exclude) continue;
    const d = Math.max(0, pos.distanceTo(e.pos) - e.radius);
    if (d < radius) e.hit(maxDmg * 2 * (1 - d / radius), src);
  }
};

G.onEnemyKilled = (e, src) => {
  if (src === 'self') return; // mine detonated on its own
  G.combo = G.comboTimer > 0 ? Math.min(G.combo + 1, 8) : 1;
  G.comboTimer = 7;
  let pts = e.score * G.combo;
  let label = `${e.label} DESTROYED`;
  if (src === 'enemy' || src === 'mine') {
    pts += 150;
    label = `${e.label} — FRIENDLY FIRE!`;
  }
  G.score += pts;
  G.stats.kills++;
  G.hud.feed(`+${pts}  ${label}${G.combo > 1 ? `  x${G.combo}` : ''}`, G.combo > 1 ? 'gold' : 'kill');
  G.hud.popup(e.pos, `+${pts}`, G.combo > 1 ? '#ffc23a' : '#ffffff');
  if (G.lockTarget === e) { G.lockTarget = null; G.hardLock = false; }
  if (e.type !== 'mine') {
    if (Math.random() < 0.45) {
      const p = e.pos.clone();
      p.y = Math.min(p.y - 5, -15);
      p.y = Math.max(p.y, heightAt(p.x, p.z) + 10);
      G.pickups.push(new Pickup(p, pickupKind()));
    }
    // Others hear the explosion and come to investigate
    for (const o of G.enemies) if (o.alive && o.investigate && o.pos.distanceTo(e.pos) < 450) o.investigate(e.pos);
  }
};

G.onDetected = (e) => {
  if (G.time - (G.detectCueT || 0) > 2.5) {
    G.detectCueT = G.time;
    G.audio.enemyPing(0.5 + 0.5 * volAt(e.pos, 700));
    G.hud.feed(`${e.label} HAS DETECTED YOU`, 'bad');
  }
};

G.onEvaded = (t) => {
  if (t.evadedCounted) return;
  t.evadedCounted = true;
  G.stats.evaded++;
  G.score += 40;
  G.hud.feed('+40  TORPEDO EVADED', 'good');
};

G.onPlayerDeath = () => {
  const P = G.player;
  G.state = 'dying';
  G.dyingT = 3.2;
  G.fx.explosion(P.pos, 2.5);
  G.audio.explosion(1, true);
  G.audio.setEngine(0, false);
  G.shake += 3;
  G.wrecks.push(new Wreck(P.mesh, false));
  G.hud.banner('HULL BREACHED', '', 3);
};

function gameOver() {
  G.state = 'over';
  G.hud.show(false);
  const prev = getHi();
  const isNew = G.score > prev;
  if (isNew) localStorage.setItem(HI_KEY, String(G.score));
  ui.hiscore.textContent = Math.max(prev, G.score).toLocaleString();
  const acc = G.stats.fired ? Math.round((G.stats.hits / G.stats.fired) * 100) : 0;
  ui.goSub.textContent = `Lost with all hands during wave ${G.wave}.`;
  const rows = [
    ['SCORE', G.score.toLocaleString()],
    ['WAVE REACHED', G.wave],
    ['KILLS', G.stats.kills],
    ['TORPEDOES FIRED', G.stats.fired],
    ['ACCURACY', `${acc}%`],
    ['TORPEDOES EVADED', G.stats.evaded],
    ['HIGH SCORE', Math.max(prev, G.score).toLocaleString()],
  ];
  ui.goStats.replaceChildren();
  for (const [k, v] of rows) {
    const a = document.createElement('div');
    a.textContent = k;
    const b = document.createElement('div');
    b.className = 'v';
    b.textContent = String(v);
    ui.goStats.append(a, b);
  }
  if (isNew) {
    const n = document.createElement('div');
    n.className = 'new';
    n.textContent = '★ NEW HIGH SCORE ★';
    ui.goStats.append(n);
  }
  ui.over.classList.remove('hidden');
}

// ---------- targeting ----------
function lockCandidates(maxCos) {
  const P = G.player;
  const out = [];
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
    const d = e.pos.distanceTo(P.pos);
    if (d > 480) continue;
    const hd = Math.hypot(dx, dz) || 1;
    const cos = (dx * P.forward.x + dz * P.forward.z) / hd;
    if (cos < maxCos) continue;
    out.push({ e, d, cos });
  }
  return out;
}

function updateLock() {
  const P = G.player;
  const L = G.lockTarget;
  if (L && (!L.alive || L.pos.distanceTo(P.pos) > 600)) { G.lockTarget = null; G.hardLock = false; }
  if (G.hardLock) return;
  let best = null, bs = Infinity;
  for (const c of lockCandidates(0.8)) {
    const s = c.d * (1.6 - c.cos) * (c.e.type === 'mine' ? 3 : 1);
    if (s < bs) { bs = s; best = c.e; }
  }
  if (best && best !== G.lockTarget) G.audio.lockTone();
  G.lockTarget = best;
}

function cycleLock() {
  const list = lockCandidates(-1).sort((a, b) => a.d - b.d).map((c) => c.e).filter((e) => e.type !== 'mine' || e.pos.distanceTo(G.player.pos) < 200);
  if (!list.length) { G.hardLock = false; return; }
  const i = list.indexOf(G.lockTarget);
  G.lockTarget = list[(i + 1) % list.length];
  G.hardLock = true;
  G.audio.lockTone();
}

// ---------- camera ----------
const camLook = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

function updateCamera(dt) {
  const P = G.player;
  if (G.state === 'menu') {
    const a = G.time * 0.12;
    camera.position.set(P.pos.x + Math.sin(a) * 30, P.pos.y + 6 + Math.sin(G.time * 0.3) * 3, P.pos.z + Math.cos(a) * 30);
    camera.lookAt(P.pos);
    return;
  }
  if (!rmb) {
    orbitYaw *= Math.exp(-dt * 2.5);
    orbitPitch *= Math.exp(-dt * 2.5);
  }
  const D = G.camDist;
  const yaw = P.yaw + Math.PI + orbitYaw;
  const pitch = 0.2 + orbitPitch;
  _desired.set(
    P.pos.x + Math.sin(yaw) * Math.cos(pitch) * D,
    P.pos.y + Math.sin(pitch) * D + 2.5,
    P.pos.z + Math.cos(yaw) * Math.cos(pitch) * D,
  );
  const k = 1 - Math.exp(-dt * (G.state === 'dying' ? 1 : 4));
  camera.position.lerp(_desired, k);
  const g = heightAt(camera.position.x, camera.position.z);
  camera.position.y = clamp(camera.position.y, g + 3, -1.5);

  _look.copy(P.pos).addScaledVector(P.forward, 12);
  _look.y += 2;
  camLook.lerp(_look, 1 - Math.exp(-dt * 6));
  camera.lookAt(camLook);

  G.shake = Math.min(G.shake, 3) * Math.exp(-dt * 4);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake;
    camera.position.y += (Math.random() - 0.5) * G.shake;
    camera.position.z += (Math.random() - 0.5) * G.shake;
  }
  const targetFov = 65 + (P.boosting ? 8 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
}

// ---------- main loop ----------
function prune(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (!o.alive) {
      if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
      list.splice(i, 1);
    }
  }
}

function step(dt) {
  const P = G.player;
  const active = G.state === 'playing' || G.state === 'dying';
  if (active) {
    if (G.state === 'playing') {
      readInput();
      P.update(dt, input);
      if (firing || keys.has('Space')) P.fire();
      updateLock();
    }
    for (const list of [G.enemies, G.torpedoes, G.charges, G.decoys, G.pickups, G.wrecks]) {
      for (let i = 0; i < list.length; i++) if (list[i].alive) list[i].update(dt);
    }

    // Ramming / hull contact
    if (P.alive) {
      for (const e of G.enemies) {
        if (!e.alive || e.type === 'mine') continue;
        if (!e.hitTest(P.pos, P.radius)) continue;
        const away = P.pos.clone().sub(e.pos);
        if (e.type === 'destroyer') away.set(0, -1, 0);
        away.normalize();
        P.pos.addScaledVector(away, 2);
        if (G.time - (e.lastRam || -9) > 1) {
          e.lastRam = G.time;
          G.shake += 0.8;
          P.damage(8);
          e.hit(25, 'player');
          G.hud.feed('COLLISION!', 'bad');
        }
      }
    }

    for (const list of [G.enemies, G.torpedoes, G.charges, G.decoys, G.pickups, G.wrecks]) prune(list);

    G.incoming = G.torpedoes.filter((t) => t.alive && !t.isPlayer && t.target === P && t.pos.distanceTo(P.pos) < 350);
    G.alarmT = (G.alarmT || 0) - dt;
    if (G.incoming.length && G.alarmT <= 0 && P.alive) {
      let d = Infinity;
      for (const t of G.incoming) d = Math.min(d, t.pos.distanceTo(P.pos));
      G.audio.alarm();
      G.alarmT = clamp(d / 320, 0.22, 0.9);
    }
    G.lowHullT = (G.lowHullT || 0) - dt;
    if (P.alive && P.hp < 30 && G.lowHullT <= 0) { G.audio.beep(440, 0.1, 0.25); G.lowHullT = 1.4; }

    if (G.comboTimer > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.combo = 1; }
    G.pingReveal = Math.max(0, G.pingReveal - dt);

    if (G.state === 'playing') waveLogic(dt);
    if (G.state === 'dying') {
      G.dyingT -= dt;
      if (G.dyingT <= 0) gameOver();
    }
    G.audio.setEngine(P.alive ? Math.min(1, Math.abs(P.speed) / 38) : 0, P.boosting && P.alive);
  } else if (G.state === 'menu') {
    P.mesh.userData.prop.rotation.z += dt * 4;
    P.mesh.rotation.z = Math.sin(G.time * 0.5) * 0.05;
    if (Math.random() < 0.5) G.fx.bubbles.emit(P.pos.x, P.pos.y, P.pos.z - 7, rand(-0.5, 0.5), rand(0, 1), rand(-1, -0.5), 2.5, rand(0.3, 0.7));
  }

  G.fx.update(dt, G.time, scene.fog.density);
  const danger = P.alive && G.state !== 'menu' ? clamp((40 - P.hp) / 40, 0, 1) : 0;
  G.world.update(dt, camera, G.time, danger);
  updateCamera(dt);
  if (active) G.hud.update(dt);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (G.state !== 'paused' && G.state !== 'over') {
    G.time += dt;
    step(dt);
  } else if (G.state === 'over') {
    // keep the ocean alive behind the game-over screen
    G.time += dt;
    G.fx.update(dt, G.time, scene.fog.density);
    for (const w of G.wrecks) if (w.alive) w.update(dt);
    G.world.update(dt, camera, G.time, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Debug/testing hook (harmless in production)
window.__DEEPSTRIKE__ = { G, startGame, angleWrap };
