// WWII patrol mode controller: mission setup, sensors, TDC, weapons, camera, input, objectives, debrief.
import * as THREE from 'three';
import { G } from '../state.js';
import { W, VIS, flareMul } from './wstate.js';
import { heightAt, coastX } from '../world.js';
import { UBoat, DEPTH, TELEGRAPH, ELECTRIC_MAX, DIESEL_MAX } from './uboat.js';
import {
  Convoy, Merchant, Escort, EnemyBoat, Battery, Plane, StraightTorpedo, Shell, fireShell, yawTo, hdist,
} from './ships.js';
import { Mine, Decoy, Wreck, rand, clamp, angleWrap } from '../entities.js';
import { MISSIONS } from './missions.js';
import { HUD2 } from './hud2.js';

export { MISSIONS };
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _look = new THREE.Vector3();
const camLook = new THREE.Vector3();
const BEST_KEY = (id) => `deepstrike_ww2_${id}`;
export const getBest = (id) => Number(localStorage.getItem(BEST_KEY(id))) || 0;
const brgOf = (from, to) => Math.round(((((-Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI) % 360) + 360) % 360);
const fmtBrg = (b) => `${String(b).padStart(3, '0')}°`;
const ENTITY_LISTS = () => [G.enemies, G.torpedoes, G.charges, G.decoys, G.wrecks, W.shells, W.bombs, W.flares];

let hud2 = null;
let aimLine = null, interceptMark = null;
let sensT = 0, detectMsgT = -99, reportMsgT = -99;
let ui = null;

function init() {
  if (hud2) return;
  hud2 = new HUD2();
  W.flareLights = [];
  for (let i = 0; i < 2; i++) {
    const l = new THREE.PointLight(0xfff0d0, 0, 1600, 1);
    l.userData.busy = false;
    G.scene.add(l);
    W.flareLights.push(l);
  }
  const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
  aimLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x7ef0ff, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
  aimLine.frustumCulled = false;
  aimLine.visible = false;
  G.scene.add(aimLine);
  interceptMark = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffc23a, transparent: true, opacity: 0.9, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, map: null }));
  interceptMark.scale.setScalar(6);
  interceptMark.visible = false;
  G.scene.add(interceptMark);
  ui = {
    over: document.getElementById('gameover'),
    title: document.getElementById('goTitle'),
    sub: document.getElementById('goSub'),
    stats: document.getElementById('goStats'),
  };
}

// ======================================================================
// Visibility rules (shared with ship AI via W.canSee)
// ======================================================================
function canSee(obs, S) {
  const d = hdist(obs.pos, S.pos);
  const v = W.vis;
  const plane = obs.type === 'plane';
  let range = 0;
  if (S.surfaced) range = plane ? v.planeSurf : v.surf;
  else if (S.depth < 20 && S.scopeUp) range = (plane ? v.planeScope : v.scope) * (1 + Math.abs(S.speed) / 2.5);
  else if (plane && S.depth < 20 && Math.abs(S.speed) > 3 && W.envName === 'day') range = 140;
  if (!range) return false;
  range *= flareMul(S.pos);
  if (obs.type === 'merchant') range *= 0.6;
  if (S.surfaced && Math.abs(S.speed) > 7) range *= 1.15;
  return d < range;
}

// ======================================================================
// Mission setup
// ======================================================================
const MERCH_MIX = ['cargo', 'cargo', 'cargo', 'freighter', 'freighter', 'tanker', 'tanker'];

function setupConvoy(m) {
  const c = new Convoy(new THREE.Vector3(-2800, 0, rand(-300, 300)), Math.PI / 2, 4.5);
  W.convoys.push(c);
  const { merchants, cols, escorts } = m.convoy;
  const rows = Math.ceil(merchants / cols);
  const kinds = [];
  for (let i = 0; i < merchants; i++) kinds.push(MERCH_MIX[Math.floor(Math.random() * MERCH_MIX.length)]);
  kinds[0] = 'tanker';
  if (merchants >= 6) kinds[Math.floor(merchants / 2)] = 'liner';
  for (let i = 0; i < merchants; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const off = { x: (col - (cols - 1) / 2) * 240, z: (rows - 1) * 135 - row * 270 };
    const ship = new Merchant(kinds[i], c.station(off, new THREE.Vector3()), c.yaw, { convoy: c, offset: off });
    c.ships.push(ship);
    G.enemies.push(ship);
  }
  const slots = [{ x: 0, z: 760 }, { x: -720, z: 120 }, { x: 720, z: 120 }, { x: 0, z: -720 }];
  escorts.forEach((k, i) => {
    const e = new Escort(k, c.station(slots[i], new THREE.Vector3()), c.yaw, { convoy: c, offset: slots[i] });
    c.escorts.push(e);
    G.enemies.push(e);
  });
  // Player: ahead of the convoy and off its track
  const side = Math.random() < 0.5 ? 1 : -1;
  const right = new THREE.Vector3(c.forward.z, 0, -c.forward.x);
  const start = c.center.clone().addScaledVector(c.forward, 3000).addScaledVector(right, side * 2000);
  const aimAt = c.center.clone().addScaledVector(c.forward, 1500);
  W.intel = { pos: c.center.clone(), until: 150, label: 'CONVOY (RADIO REPORT)' };
  return { pos: start, yaw: yawTo(start, aimAt) };
}

function setupHarbor() {
  const lm = G.world.landmarks;
  const placed = [];
  const kinds = ['cargo', 'tanker', 'freighter', 'cargo', 'liner'];
  for (let i = 0; i < kinds.length; i++) {
    for (let t = 0; t < 200; t++) {
      const z = rand(-230, 230);
      const x = coastX(z) - rand(140, 420);
      if (heightAt(x, z) > -14) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 110)) continue;
      const ship = new Merchant(kinds[i], new THREE.Vector3(x, 0, z), rand(0, Math.PI * 2), { anchored: true });
      placed.push(ship.pos);
      G.enemies.push(ship);
      break;
    }
  }
  G.enemies.push(new Escort('corvette', new THREE.Vector3(800, 0, -400), 0, { patrol: [new THREE.Vector3(820, 0, -560), new THREE.Vector3(820, 0, 560)] }));
  G.enemies.push(new Escort('corvette', new THREE.Vector3(600, 0, 300), Math.PI, { patrol: [new THREE.Vector3(560, 0, 520), new THREE.Vector3(420, 0, 0), new THREE.Vector3(560, 0, -520)] }));
  G.enemies.push(new Escort('destroyer', new THREE.Vector3(-100, 0, 800), Math.PI, { patrol: [new THREE.Vector3(-200, 0, -900), new THREE.Vector3(200, 0, 0), new THREE.Vector3(-200, 0, 900)] }));
  // Minefield across the bay mouth with a gap in the middle
  for (const row of [0, 1]) {
    for (let z = -470; z <= 470; z += 34) {
      if (Math.abs(z) < 65) continue;
      const x = 1000 + row * 55 + (row ? 17 : 0);
      const zz = z + (row ? 17 : 0);
      const h = heightAt(x, zz);
      if (h > -12) continue;
      G.enemies.push(new Mine(new THREE.Vector3(x, Math.max(h + 6, rand(-20, -7)), zz)));
    }
  }
  if (lm.battery) G.enemies.push(new Battery(new THREE.Vector3(lm.battery.x, lm.battery.y + 0.5, lm.battery.z)));
  W.intel = { pos: new THREE.Vector3(1450, 0, 0), until: 9999, label: 'ANCHORAGE' };
  W.exitPoint = new THREE.Vector3(1050, 0, 0);
  return { pos: new THREE.Vector3(-1500, 0, rand(-200, 200)), yaw: Math.PI / 2 };
}

function spawnIndependent(nearPlayer = false) {
  const a = rand(0, Math.PI * 2);
  const R = W.radius + 150;
  const start = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
  const end = new THREE.Vector3(-Math.cos(a) * R + rand(-900, 900), 0, -Math.sin(a) * R + rand(-900, 900));
  if (nearPlayer) start.lerp(end, rand(0.25, 0.4));
  const yaw = yawTo(start, end);
  const c = new Convoy(start, yaw, rand(4.2, 5.4));
  W.convoys.push(c);
  const kind = MERCH_MIX[Math.floor(Math.random() * MERCH_MIX.length)];
  const ship = new Merchant(Math.random() < 0.1 ? 'liner' : kind, start.clone(), yaw, { convoy: c, offset: { x: 0, z: 0 } });
  c.ships.push(ship);
  G.enemies.push(ship);
  if (Math.random() < 0.3) {
    const off = { x: rand(-300, 300), z: 450 };
    const e = new Escort('corvette', c.station(off, new THREE.Vector3()), yaw, { convoy: c, offset: off });
    c.escorts.push(e);
    G.enemies.push(e);
  }
}

function setupPatrol() {
  spawnIndependent(true);
  spawnIndependent(true);
  const route = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand(-0.3, 0.3);
    route.push(new THREE.Vector3(Math.cos(a) * 1800, 0, Math.sin(a) * 1800));
  }
  const b = new EnemyBoat(route[0].clone(), 0, route);
  b.pos.y = -2.2;
  G.enemies.push(b);
  W.spawnT = rand(80, 130);
  return { pos: new THREE.Vector3(rand(-400, 400), 0, rand(-400, 400)), yaw: rand(0, Math.PI * 2) };
}

function spawnPlane() {
  const S = G.player;
  const a = rand(0, Math.PI * 2);
  const pos = new THREE.Vector3(W.center.x + Math.cos(a) * (W.radius + 1500), 170, W.center.z + Math.sin(a) * (W.radius + 1500));
  let center;
  const conv = W.convoys.find((c) => c.ships.some((s) => s.alive));
  if (W.mission.convoy && conv) center = conv.center.clone();
  else center = new THREE.Vector3(S.pos.x + rand(-900, 900), 0, S.pos.z + rand(-900, 900));
  G.enemies.push(new Plane(pos, center));
}

// ======================================================================
// Callbacks
// ======================================================================
function installCallbacks() {
  W.canSee = canSee;
  W.interrupt = (reason) => {
    if (W.timeScale > 1) {
      W.timeScale = 1;
      G.hud.feed(`TIME COMPRESSION OFF${reason ? ` — ${reason}` : ''}`, 'gold');
    }
  };
  W.onDetected = (esc, src) => {
    W.dangerT = Math.max(W.dangerT, 30);
    W.lastDetected = W.clock;
    if (src === 'lost' || W.clock - detectMsgT < 8) return;
    detectMsgT = W.clock;
    const msg = src === 'visual' ? `SPOTTED BY ${esc.label}!` : src === 'asdic' ? 'ASDIC CONTACT — THEY HAVE US!' : `${esc.label} HEARD US ON HYDROPHONES`;
    G.hud.feed(msg, 'bad');
    W.interrupt('detected');
  };
  W.reportSub = (pos, src) => {
    for (const e of G.enemies) if (e.alive && e.type === 'escort' && hdist(e.pos, pos) < 4500) e.investigate(pos, 140);
    if (W.clock - reportMsgT > 25) {
      reportMsgT = W.clock;
      G.hud.feed(src === 'aircraft' ? 'AIRCRAFT IS CALLING IN THE ESCORTS' : 'ESCORTS ARE CLOSING IN', 'bad');
    }
  };
  W.onTorpedoSpotted = (ship, torp) => {
    if (ship.evadeT > 0) return;
    ship.evade(torp.yaw);
    if (ship.convoy) ship.convoy.alert();
    G.hud.feed(`${ship.label} SPOTTED THE TORPEDO TRACK — TURNING AWAY!`, 'bad');
    W.reportSub(G.player.pos, 'torpedo');
  };
  W.onShipHit = (ship, src, kind) => {
    if (ship.convoy) ship.convoy.alert();
    ship.alerted = true;
    if (src === 'player' && kind === 'torpedo') {
      G.hud.feed(`TORPEDO HIT — ${ship.label}!`, 'gold');
      G.hud.popup(ship.pos.clone().setY(10), 'HIT!', '#ffc23a');
      G.score += 200;
      W.interrupt('hit');
    }
    if (src === 'player') {
      for (const e of G.enemies) {
        if (e.alive && e.type === 'escort' && hdist(e.pos, ship.pos) < 4500) e.investigate(G.player.pos, kind === 'shell' ? 100 : 380);
      }
    }
  };
  W.onShipSunk = (ship, src, pos) => {
    if (W.lock === ship) W.lock = null;
    if (ship.convoy) ship.convoy.alert();
    if (src !== 'player') {
      G.hud.feed(`${ship.label} WENT DOWN (FRIENDLY FIRE)`, 'gold');
      return;
    }
    if (ship.type === 'battery') {
      G.hud.feed('COASTAL BATTERY DESTROYED', 'gold');
      G.score += 800;
      return;
    }
    W.tonnage += ship.grt;
    W.sunk.push({ label: ship.label, grt: ship.grt, type: ship.type });
    G.score += Math.round(ship.grt / 5);
    G.hud.feed(`SUNK: ${ship.label} — ${ship.grt.toLocaleString()} GRT`, 'gold');
    G.hud.banner('SHIP SUNK', `${ship.label} · ${ship.grt.toLocaleString()} GRT`, 3);
    G.hud.popup(pos.clone().setY(15), `+${ship.grt.toLocaleString()} GRT`, '#ffc23a');
    G.audio.groan(1);
    W.interrupt();
    checkObjective();
  };
  G.blast = (pos, radius, maxDmg, exclude, src) => {
    const S = G.player;
    if (src === 'enemy') { radius *= 1.3; maxDmg *= 0.62; } // WWII depth charges: lethal ~35 m, damaging further
    if (pos.y > -70 && pos.y < 0) {
      G.fx.splash(_v.set(pos.x, 0, pos.z), 1.8 * (1 - -pos.y / 70) + 0.4);
      G.audio.splash(0.4);
    }
    if (S.alive && S !== exclude) {
      const d = Math.max(0, pos.distanceTo(S.pos) - 3);
      if (d < 90 && src !== 'player') W.stats.dcNear++;
      if (d < radius) S.damage(maxDmg * (1 - d / radius), 'blast');
      else if (d < 70) { G.shake += 0.8 * (1 - d / 70); G.audio.creak(); }
    }
    for (const e of G.enemies) {
      if (!e.alive || e === exclude) continue;
      const d = e.blastDist ? e.blastDist(pos) : Math.max(0, pos.distanceTo(e.pos) - (e.radius || 2));
      if (d < radius) e.hit(maxDmg * 1.5 * (1 - d / radius), src, 'blast');
    }
  };
  G.onEnemyKilled = (e) => {
    if (e.type === 'mine') G.hud.feed('MINE DETONATED', 'bad');
  };
  G.onPlayerDeath = (cause) => {
    const S = G.player;
    G.state = 'dying';
    W.dyingT = 4.5;
    W.view = 'ext';
    G.fx.explosion(S.pos, 2.2);
    if (S.depth < 6) G.fx.surfaceExplosion(S.pos, 1.5);
    G.audio.explosion(1, true);
    G.audio.silenceLoops();
    G.shake += 3;
    G.wrecks.push(new Wreck(S.mesh, false));
    G.hud.banner(S.depth > DEPTH.crush ? 'HULL IMPLODED' : 'BOAT LOST', '', 4);
    W.deathCause = cause;
  };
}

function checkObjective() {
  if (W.objectiveDone) return;
  const o = W.mission.objective;
  const ships = W.sunk.filter((s) => s.type !== 'plane').length;
  if ((o.grt && W.tonnage >= o.grt) || (o.ships && ships >= o.ships)) {
    W.objectiveDone = true;
    G.audio.fanfare();
    G.hud.banner('OBJECTIVE ACHIEVED', W.mission.id === 'harbor' ? 'Escape the bay to complete the mission' : 'Evade, then end the patrol (Esc) — or keep hunting', 5);
  }
}

// ======================================================================
// Player sensors & TDC
// ======================================================================
function playerSensors() {
  const S = G.player;
  const look = S.surfaced || S.scopeUp;
  const hydroOK = S.depth > 6 && S.systems.hydrophones <= 0;
  const quiet = Math.abs(S.speed) <= 2.5 ? 1 : Math.max(0.35, 1 - (Math.abs(S.speed) - 2.5) * 0.15);
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const d = hdist(e.pos, S.pos);
    if (e.type === 'mine') {
      e.visual = hydroOK && d < 80;
      if (e.visual && !e.sighted) { e.sighted = true; G.hud.feed('MINE CABLE SCRAPING — MINEFIELD!', 'bad'); W.interrupt('mines'); }
      continue;
    }
    let vis = false, hyd = false;
    if (e.type === 'plane') {
      vis = W.vis.planes && ((S.surfaced && d < 3800) || (S.scopeUp && d < 2300));
    } else if (e.type === 'battery') {
      vis = look && d < W.vis.ship * 1.3;
    } else {
      let vr = W.vis.ship * Math.sqrt((e.L || 30) / 60) * flareMul(e.pos);
      if (W.envName === 'night' && e.fire > 0.1) vr *= 2.5;
      if (S.scopeUp && !S.surfaced) vr *= 0.85;
      if (e.type === 'boat' && e.depthNow > 5) vr = e.depthNow < 16 ? 70 : 0;
      vis = look && d < vr;
      if (hydroOK) {
        let src = e.type === 'escort' ? (Math.abs(e.speed) > 9 ? 3400 : 1900) : e.type === 'boat' ? 900 : 2700;
        if (Math.abs(e.speed) < 0.5) src *= 0.25;
        hyd = d < src * quiet * (S.depth > W.layerDepth ? 0.8 : 1);
      }
    }
    e.visual = vis;
    e.hydro = hyd;
    if (vis || hyd) {
      e.known = true;
      e.lastSeen = W.clock;
      if (vis) e.estPos.copy(e.pos);
      else if (!e.hydroFix || W.clock - e.hydroFix > 3) {
        e.hydroFix = W.clock;
        const err = d * 0.06;
        e.estPos.set(e.pos.x + rand(-err, err), 0, e.pos.z + rand(-err, err));
      }
      if (!e.sighted) {
        e.sighted = true;
        const b = fmtBrg(brgOf(S.pos, e.pos));
        if (e.type === 'plane') {
          G.hud.feed(`AIRCRAFT BEARING ${b}! — CRASH DIVE (C)!`, 'bad');
          G.audio.alarm();
          W.interrupt('aircraft');
          W.dangerT = Math.max(W.dangerT, 30);
        } else {
          G.hud.feed(`${vis ? 'SIGHTED' : 'HYDROPHONE CONTACT'}: ${e.label} BEARING ${b}`, vis ? 'kill' : 'good');
          W.interrupt('new contact');
        }
      }
    }
    // Firing solution quality
    if (e.type === 'merchant' || e.type === 'escort' || e.type === 'boat') {
      if (Math.abs(angleWrap(e.yaw - e.solYaw)) > 0.25 || Math.abs(e.speed - (e.solSpd || 0)) > 1.5) {
        e.sol *= 0.5;
        e.solYaw = e.yaw;
        e.solSpd = e.speed;
        e.errA = rand(-0.6, 0.6);
        e.errS = rand(-0.5, 0.5);
      }
      let rate;
      if (vis) {
        rate = W.view === 'scope' ? 0.08 : 0.05;
        if (W.view === 'scope' && Math.abs(angleWrap(yawTo(S.pos, e.pos) - W.aimYaw)) < 0.1) rate *= 2;
      } else if (hyd) rate = e.sol < 0.45 ? 0.02 : 0;
      else rate = -0.004;
      e.sol = clamp(e.sol + rate * 0.25, 0, 1);
    }
  }
}

/** Intercept course for a straight-running torpedo from origin, using the TDC's (imperfect) estimate. */
export function solution(t, origin) {
  if (!t || !t.alive || t.type === 'plane') return null;
  const q = t.sol ?? 1;
  const estYaw = (t.yaw || 0) + (t.errA || 0) * (1 - q);
  const estSpd = Math.max(0, (t.speed || 0) * (1 + (t.errS || 0) * (1 - q)));
  const P = t.visual ? t.pos : t.estPos;
  const Vx = Math.sin(estYaw) * estSpd, Vz = Math.cos(estYaw) * estSpd;
  const Dx = P.x - origin.x, Dz = P.z - origin.z;
  const vt = 20;
  const a = Vx * Vx + Vz * Vz - vt * vt, b = 2 * (Dx * Vx + Dz * Vz), c = Dx * Dx + Dz * Dz;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
  const tt = Math.max(r1, r2);
  if (!(tt > 0)) return null;
  const point = new THREE.Vector3(P.x + Vx * tt, 0, P.z + Vz * tt);
  return { point, time: tt, yaw: Math.atan2(point.x - origin.x, point.z - origin.z), estYaw, estSpd };
}

function lockCandidates() {
  return G.enemies.filter((e) => e.alive && e.known && e.type !== 'mine' && W.clock - e.lastSeen < 15 && (e.type !== 'plane' || e.visual));
}

function cycleLock() {
  const S = G.player;
  const list = lockCandidates().sort((a, b) => Math.abs(angleWrap(yawTo(S.pos, a.estPos) - W.aimYaw)) - Math.abs(angleWrap(yawTo(S.pos, b.estPos) - W.aimYaw)));
  if (!list.length) { W.lock = null; G.hud.feed('NO CONTACTS TO TRACK', 'bad'); return; }
  const i = list.indexOf(W.lock);
  W.lock = i === -1 || W.lockTapT < W.clock - 2.5 ? list[0] : list[(i + 1) % list.length];
  W.lockTapT = W.clock;
  if (W.lock.errA === 0 && W.lock.errS === 0) { W.lock.errA = rand(-0.6, 0.6); W.lock.errS = rand(-0.5, 0.5); }
  G.audio.lockTone();
}

// ======================================================================
// Weapons
// ======================================================================
function fireTorpedoes(count) {
  const S = G.player;
  if (!S.alive) return;
  if (S.depth > 30) { G.hud.feed('TOO DEEP TO FIRE — 30 m MAX', 'bad'); return; }
  if (S.systems.tubes > 0) { G.hud.feed('TORPEDO TUBES DAMAGED', 'bad'); return; }
  let yaw = W.aimYaw;
  let sol = null;
  if (W.tdcAssist && W.lock) {
    sol = solution(W.lock, S.pos);
    if (sol) yaw = sol.yaw;
  }
  let rel = angleWrap(yaw - S.yaw);
  let section = 'bow';
  if (Math.abs(rel) > 1.75) {
    section = 'stern';
    if (Math.abs(angleWrap(rel - Math.PI)) > 1.4) { G.hud.feed('TARGET OUTSIDE GYRO LIMITS', 'bad'); return; }
  }
  const offsets = count === 1 ? [0] : [-0.045, 0, 0.045];
  let fired = 0;
  for (const off of offsets) {
    if (!S.takeTube(section)) break;
    const dirYaw = section === 'bow' ? S.yaw : S.yaw + Math.PI;
    const p = S.pos.clone().addScaledVector(S.forward, section === 'bow' ? 12 : -13);
    p.x += (fired - 1) * 0.8 * S.forward.z;
    p.z -= (fired - 1) * 0.8 * S.forward.x;
    p.y = Math.min(S.pos.y, -3.5);
    G.torpedoes.push(new StraightTorpedo('player', p, dirYaw, yaw + off));
    fired++;
  }
  if (!fired) {
    G.hud.feed(`NO ${section.toUpperCase()} TUBE LOADED${S.reserve ? ' — RELOADING' : ''}`, 'bad');
    G.audio.beep(220, 0.12, 0.08);
    return;
  }
  W.stats.fired += fired;
  S.noiseSpike += 180 * fired;
  G.shake += 0.25;
  G.audio.launch(1);
  const run = sol ? `RUN ${Math.round(sol.time)}s` : '';
  G.hud.feed(`${fired > 1 ? `SPREAD OF ${fired}` : 'TORPEDO'} LOS! ${section === 'stern' ? '(STERN) ' : ''}${run}`, 'gold');
  for (const e of G.enemies) {
    if (e.alive && e.type === 'escort' && Math.abs(e.speed) < 9 && hdist(e.pos, S.pos) < 1400 && Math.random() < 0.5) e.investigate(S.pos, 250);
  }
}

function fireGun() {
  const S = G.player;
  if (!S.alive || S.gunCd > 0) return;
  if (!S.surfaced) {
    if (!W.gunMsgT || W.clock - W.gunMsgT > 3) { W.gunMsgT = W.clock; G.hud.feed('GUNS CAN ONLY BE MANNED ON THE SURFACE', 'bad'); }
    S.gunCd = 0.5;
    return;
  }
  // Flak: the locked or nearest visible aircraft
  let plane = W.lock && W.lock.type === 'plane' && W.lock.visual ? W.lock : null;
  if (!plane && !(W.lock && W.lock.type !== 'plane')) {
    let best = 1800;
    for (const e of G.enemies) if (e.alive && e.type === 'plane' && e.visual && e.state !== 'down') { const d = e.pos.distanceTo(S.pos); if (d < best) { best = d; plane = e; } }
  }
  if (plane && S.flakAmmo > 0) {
    const from = S.pos.clone().add(new THREE.Vector3(0, 7.5, 0));
    const d = plane.pos.distanceTo(from);
    const aim = plane.pos.clone().addScaledVector(plane.vel, d / 420);
    const dir = aim.sub(from).normalize();
    dir.x += rand(-0.02, 0.02); dir.y += rand(-0.02, 0.02); dir.z += rand(-0.02, 0.02);
    W.shells.push(new Shell('player', from, dir.normalize().multiplyScalar(420), { flak: true, dmg: 12 }));
    S.flakAmmo--;
    S.gunCd = 0.2;
    G.audio.flak(0.8);
    G.fx.sparks.emit(from.x, from.y, from.z, 0, 0, 0, 0.08, 2.5);
    return;
  }
  if (S.gunAmmo <= 0) { G.hud.feed('DECK GUN OUT OF AMMUNITION', 'bad'); S.gunCd = 2; return; }
  const from = S.pos.clone().addScaledVector(S.forward, 12);
  from.y = 4.6;
  const tgt = W.lock && W.lock.type !== 'plane' && W.lock.visual ? W.lock : null;
  if (tgt) fireShell('player', from, _v.copy(tgt.pos).setY(4), tgt.vel, { disp: 0.008 + (1 - (tgt.sol ?? 1)) * 0.012, dmg: 15, speed: 230 });
  else fireShell('player', from, _v.set(S.pos.x + Math.sin(W.aimYaw) * 1200, 0, S.pos.z + Math.cos(W.aimYaw) * 1200), null, { disp: 0.01, dmg: 15, speed: 230 });
  S.gunAmmo--;
  S.gunCd = 2.4;
  S.noiseSpike += 250;
  G.shake += 0.35;
  G.audio.gun(1);
  G.fx.muzzle(from, S.forward);
  if (Math.random() < (W.envName === 'night' ? 0.35 : 0.2)) W.reportSub(S.pos, 'gunfire');
}

function dropDecoy() {
  const S = G.player;
  if (S.depth < 8) { G.hud.feed('DECOYS ONLY WORK SUBMERGED', 'bad'); return; }
  if (S.decoys <= 0 || S.decoyCd > 0) return;
  S.decoys--;
  S.decoyCd = 3;
  const d = new Decoy('player', S.pos.clone().addScaledVector(S.forward, -14), S.forward.clone().multiplyScalar(-2));
  d.life = 45;
  G.decoys.push(d);
  G.audio.decoy();
  G.hud.feed('DECOY RELEASED — ASDIC MAY TRACK IT INSTEAD', 'gold');
}

// ======================================================================
// Camera
// ======================================================================
function updateCamera(dt) {
  const S = G.player, cam = G.camera, k = G.keys;
  if (W.view === 'scope' && !S.surfaced && (S.depth > DEPTH.periscope + 2.5 || S.systems.periscope > 0 || !S.alive)) {
    W.view = 'ext';
    G.hud.feed(S.systems.periscope > 0 ? 'PERISCOPE DAMAGED' : 'PERISCOPE DOWN — TOO DEEP', 'bad');
  }
  let fov;
  if (W.view === 'scope') {
    const bridge = S.surfaced;
    const rk = W.zoom ? 0.22 : 0.7;
    if (k.has('ArrowLeft')) W.scopeRel += rk * dt;
    if (k.has('ArrowRight')) W.scopeRel -= rk * dt;
    if (k.has('ArrowUp')) W.scopePitch = clamp(W.scopePitch + rk * 0.5 * dt, -0.08, 0.7);
    if (k.has('ArrowDown')) W.scopePitch = clamp(W.scopePitch - rk * 0.5 * dt, -0.08, 0.7);
    cam.position.set(S.pos.x + S.forward.x * 4.2, bridge ? S.pos.y + 9.4 : 1.25 + Math.sin(G.time * 1.4) * 0.22, S.pos.z + S.forward.z * 4.2);
    const yaw = S.yaw + W.scopeRel, p = W.scopePitch;
    _look.set(cam.position.x + Math.sin(yaw) * Math.cos(p) * 100, cam.position.y + Math.sin(p) * 100, cam.position.z + Math.cos(yaw) * Math.cos(p) * 100);
    cam.lookAt(_look);
    fov = W.zoom ? (bridge ? 9 : 11) : 42;
    S.scopeUp = !bridge;
  } else {
    S.scopeUp = false;
    if (k.has('ArrowLeft')) W.cam.yaw -= 1.2 * dt;
    if (k.has('ArrowRight')) W.cam.yaw += 1.2 * dt;
    const D = W.cam.dist;
    const yaw = S.yaw + Math.PI + W.cam.yaw, pitch = W.cam.pitch;
    _d.set(S.pos.x + Math.sin(yaw) * Math.cos(pitch) * D, S.pos.y + Math.sin(pitch) * D + 4, S.pos.z + Math.cos(yaw) * Math.cos(pitch) * D);
    cam.position.lerp(_d, 1 - Math.exp(-dt * (G.state === 'dying' ? 1 : 4)));
    const g = heightAt(cam.position.x, cam.position.z);
    cam.position.y = Math.max(cam.position.y, g + 3);
    if (Math.abs(cam.position.y) < 0.8) cam.position.y = cam.position.y >= 0 ? 0.8 : -0.8;
    _look.copy(S.pos).addScaledVector(S.forward, 15);
    _look.y += 3;
    camLook.lerp(_look, 1 - Math.exp(-dt * 6));
    cam.lookAt(camLook);
    fov = 60;
  }
  G.shake = Math.min(G.shake, 3) * Math.exp(-dt * 4);
  if (G.shake > 0.01) {
    const s = W.view === 'scope' ? G.shake * 0.15 : G.shake;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s * (W.view === 'scope' ? 0.3 : 1);
    cam.position.z += (Math.random() - 0.5) * s;
  }
  if (Math.abs(cam.fov - fov) > 0.05) {
    cam.fov += (fov - cam.fov) * Math.min(1, dt * (W.view === 'scope' ? 14 : 4));
    cam.updateProjectionMatrix();
  }
  G.fx.setScale((G.renderer.getPixelRatio() * innerHeight) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
  cam.getWorldDirection(_d);
  W.aimYaw = Math.atan2(_d.x, _d.z);
}

function updateAimAids() {
  const S = G.player;
  let yaw = W.aimYaw, sol = null;
  if (W.tdcAssist && W.lock) { sol = solution(W.lock, S.pos); if (sol) yaw = sol.yaw; }
  W.sol = sol;
  const show = S.alive && S.depth <= 30 && W.view === 'ext' && G.state === 'playing';
  aimLine.visible = show;
  if (show) {
    const p = aimLine.geometry.attributes.position;
    const rel = angleWrap(yaw - S.yaw);
    const stern = Math.abs(rel) > 1.75;
    const ox = S.pos.x + S.forward.x * (stern ? -13 : 12), oz = S.pos.z + S.forward.z * (stern ? -13 : 12);
    p.setXYZ(0, ox, 0.4, oz);
    p.setXYZ(1, ox + Math.sin(yaw) * 900, 0.4, oz + Math.cos(yaw) * 900);
    p.needsUpdate = true;
  }
  interceptMark.visible = !!sol && S.alive;
  if (sol) {
    interceptMark.position.set(sol.point.x, 3, sol.point.z);
    interceptMark.scale.setScalar(W.view === 'scope' ? Math.max(4, sol.point.distanceTo(G.camera.position) * 0.012) : 8);
  }
}

// ======================================================================
// Main step
// ======================================================================
function readInput() {
  const k = G.keys;
  return {
    left: k.has('KeyA'),
    right: k.has('KeyD'),
    up: k.has('KeyR'),
    down: k.has('KeyF'),
  };
}

function prune(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (!o.alive) {
      if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
      list.splice(i, 1);
    }
  }
}

function logic(dt) {
  const S = G.player;
  W.clock += dt;
  W.dangerT = Math.max(0, W.dangerT - dt);
  if (G.state === 'playing') {
    S.update(dt, readInput());
    if (G.keys.has('KeyG')) fireGun();
  }
  sensT -= dt;
  if (sensT <= 0) { sensT = 0.25; playerSensors(); }
  for (const c of W.convoys) c.update(dt);
  for (const list of ENTITY_LISTS()) for (let i = 0; i < list.length; i++) if (list[i].alive) list[i].update(dt);

  // Collisions with surface ships (pass underneath if deep enough)
  if (S.alive) {
    for (const e of G.enemies) {
      if (!e.alive || (e.type !== 'merchant' && e.type !== 'escort' && e.type !== 'boat')) continue;
      if (S.depth > (e.draft || 4) + 6 && e.type !== 'boat') continue;
      if (!e.hitTest(S.pos, 3)) continue;
      if (W.clock - (e.lastRam || -9) < 3) continue;
      e.lastRam = W.clock;
      const ram = e.type === 'escort' && Math.abs(e.speed) > 5;
      S.damage(ram ? 55 : 6, 'ram');
      e.hit(ram ? 15 : 5, 'player', 'shell');
      G.hud.feed(ram ? 'RAMMED BY THE ESCORT!' : 'COLLISION!', 'bad');
      S.pos.addScaledVector(_v.set(e.forward.z, 0, -e.forward.x), Math.sign((S.pos.x - e.pos.x) * e.forward.z - (S.pos.z - e.pos.z) * e.forward.x) * 6);
    }
  }
  // Convoy ships leaving the area escape
  for (const e of G.enemies) {
    if (e.alive && e.type === 'merchant' && e.convoy && hdist(e.pos, W.center) > W.radius + 450) {
      e.alive = false;
      W.escaped++;
      if (W.mission.convoy) G.hud.feed(`${e.label} ESCAPED`, 'bad');
    }
  }
  for (const list of ENTITY_LISTS()) prune(list);
  if (W.lock && !W.lock.alive) W.lock = null;

  // Danger blocks time compression
  const threat = G.charges.length > 0 || G.torpedoes.some((t) => !t.isPlayer) || W.shells.some((s) => s.owner !== 'player')
    || G.enemies.some((e) => e.type === 'plane' && e.alive && (e.state === 'attack' || e.state === 'pass'));
  if (threat) W.dangerT = Math.max(W.dangerT, 6);
  if (W.dangerT > 0 && W.timeScale > 1) W.interrupt('enemy action');

  // Spawners
  const m = W.mission;
  if (m.air && W.vis.planes && G.state === 'playing') {
    W.airT -= dt;
    if (W.airT <= 0) {
      W.airT = rand(m.air.period[0], m.air.period[1]);
      if (G.enemies.filter((e) => e.type === 'plane' && e.alive).length < 2) spawnPlane();
    }
  }
  if (m.id === 'patrol') {
    W.spawnT -= dt;
    if (W.spawnT <= 0) {
      W.spawnT = rand(90, 150);
      if (G.enemies.filter((e) => e.alive && e.type === 'merchant').length < 4) spawnIndependent(false);
    }
  }
  if (W.intel && W.clock > W.intel.until) W.intel = null;
  if (W.intel && m.convoy && W.convoys[0]) W.intel.pos.copy(W.convoys[0].center);

  // End conditions
  if (G.state === 'playing') {
    if (m.convoy && !G.enemies.some((e) => e.alive && e.type === 'merchant')) {
      W.endT = (W.endT ?? 6) - dt;
      if (W.endT <= 0) endMission(W.objectiveDone ? 'success' : 'escaped');
    }
    if (m.id === 'harbor' && W.objectiveDone && hdist(S.pos, W.exitPoint) > 1900) endMission('success');
  } else if (G.state === 'dying') {
    W.dyingT -= dt;
    if (W.dyingT <= 0) endMission('lost');
  }
}

function updateAudio() {
  const S = G.player;
  const A = G.audio;
  if (!S.alive || G.state !== 'playing') { A.silenceLoops(); return; }
  const max = S.diesel ? DIESEL_MAX : ELECTRIC_MAX;
  A.setEngine(0, false);
  A.setDrive(S.diesel ? 'diesel' : 'electric', Math.min(1, Math.abs(S.speed) / max) * (W.view === 'scope' && S.surfaced ? 0.6 : 1));
  let best = null, bd = 2200, pd = 3000;
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const d = e.pos.distanceTo(S.pos);
    if (e.type === 'plane') pd = Math.min(pd, d);
    else if ((e.type === 'merchant' || e.type === 'escort') && Math.abs(e.speed) > 0.5 && d < bd) { bd = d; best = e; }
  }
  if (best && S.depth > 6 && S.systems.hydrophones <= 0) A.setScrews(Math.pow(1 - bd / 2200, 1.5), 1.5 + Math.abs(best.speed) * 0.7);
  else A.setScrews(0, 1);
  A.setPlane(pd < 3000 ? Math.pow(1 - pd / 3000, 2) * (S.depth > 10 ? 0.25 : 1) : 0);
}

// ======================================================================
// Debrief
// ======================================================================
function endMission(outcome) {
  if (G.state === 'over') return;
  const m = W.mission;
  if (outcome === 'ended') outcome = W.objectiveDone ? 'success' : 'ended';
  G.state = 'over';
  G.audio.silenceLoops();
  G.hud.show(false);
  hud2.show(false);
  aimLine.visible = false;
  interceptMark.visible = false;
  const prev = getBest(m.id);
  const isNew = W.tonnage > prev && outcome !== 'lost';
  if (isNew) localStorage.setItem(BEST_KEY(m.id), String(W.tonnage));
  const titles = { success: 'MISSION ACCOMPLISHED', ended: 'PATROL ENDED', escaped: 'CONVOY ESCAPED', lost: 'BOAT LOST' };
  ui.title.textContent = titles[outcome];
  ui.title.classList.toggle('red', outcome === 'lost' || outcome === 'escaped');
  const target = m.objective.grt ? `${m.objective.grt.toLocaleString()} GRT` : `${m.objective.ships} ships`;
  ui.sub.textContent = outcome === 'lost'
    ? (W.deathCause === 'ram' ? 'Rammed and sunk with all hands.' : G.player.depth > DEPTH.crush ? 'The hull collapsed below crush depth.' : 'Lost with all hands.')
    : `${m.name} — objective ${W.objectiveDone ? 'achieved' : 'not achieved'} (${target}).`;
  const ratio = m.objective.grt ? W.tonnage / m.objective.grt : W.sunk.length / m.objective.ships;
  const stars = outcome === 'lost' ? Math.min(1, Math.floor(ratio * 2)) : ratio >= 1.5 ? 3 : ratio >= 1 ? 2 : ratio >= 0.4 ? 1 : 0;
  const mins = Math.floor(W.clock / 60), secs = Math.floor(W.clock % 60);
  const rows = [
    ['TONNAGE SUNK', `${W.tonnage.toLocaleString()} GRT`],
    ['SHIPS SUNK', W.sunk.length],
    ['TORPEDOES FIRED / HITS', `${W.stats.fired} / ${W.stats.hits}`],
    ['DUDS', W.stats.duds],
    ['GUN HITS', W.stats.gunHits],
    ['AIRCRAFT SHOT DOWN', W.stats.planes],
    ['DEPTH CHARGES ENDURED', W.stats.dcNear],
    ['TIME ON STATION', `${mins}:${String(secs).padStart(2, '0')}`],
    ['RATING', '★'.repeat(stars) + '☆'.repeat(3 - stars)],
    ['BEST TONNAGE', `${Math.max(prev, outcome === 'lost' ? 0 : W.tonnage).toLocaleString()} GRT`],
  ];
  ui.stats.replaceChildren();
  for (const [k, v] of rows) {
    const a = document.createElement('div');
    a.textContent = k;
    const b = document.createElement('div');
    b.className = 'v';
    b.textContent = String(v);
    ui.stats.append(a, b);
  }
  if (W.sunk.length) {
    const list = document.createElement('div');
    list.className = 'sunklist';
    list.textContent = W.sunk.map((s) => `${s.label} (${s.grt.toLocaleString()})`).join(' · ');
    ui.stats.append(list);
  }
  if (isNew) {
    const n = document.createElement('div');
    n.className = 'new';
    n.textContent = '★ NEW BEST TONNAGE ★';
    ui.stats.append(n);
  }
  document.getElementById('restartBtn').firstChild.textContent = 'RETRY MISSION ';
  ui.over.classList.remove('hidden');
}

// ======================================================================
// Public API
// ======================================================================
export const WW2 = {
  W,
  get active() { return W.active; },

  start(id, opts = {}) {
    init();
    this.clear();
    const m = MISSIONS.find((x) => x.id === id) || MISSIONS[0];
    Object.assign(W, {
      active: true, mission: m, envName: m.env, vis: VIS[m.env], radius: m.radius, center: m.center || { x: 0, z: 0 },
      clock: 0, timeScale: 1, dangerT: 0, view: 'ext', lock: null, lockTapT: -9, tonnage: 0, sunk: [], escaped: 0,
      objectiveDone: false, endT: null, dyingT: 0, intel: null, exitPoint: null, sol: null, zoom: false,
      scopeRel: 0, scopePitch: 0, cam: { yaw: 0, pitch: 0.22, dist: 75 }, sonarRange: 3000, deathCause: null,
      airT: m.air ? m.air.first : 0, spawnT: 0,
      stats: { fired: 0, hits: 0, duds: 0, gunHits: 0, planes: 0, dcDropped: 0, dcNear: 0, evaded: 0 },
    });
    if (opts.tdcAssist !== undefined) W.tdcAssist = opts.tdcAssist;
    G.world.setProfile(m.profile, m.env);
    G.camera.far = 9000;
    G.camera.updateProjectionMatrix();
    installCallbacks();
    let start;
    if (m.convoy) start = setupConvoy(m);
    else if (m.id === 'harbor') start = setupHarbor();
    else start = setupPatrol();
    const S = new UBoat(new THREE.Vector3(start.pos.x, -DEPTH.surface, start.pos.z), start.yaw);
    G.player = S;
    G.mode = 'ww2';
    G.state = 'playing';
    G.score = 0;
    G.shake = 0;
    sensT = 0; detectMsgT = -99; reportMsgT = -99;
    document.body.classList.add('ww2');
    G.hud.clear();
    G.hud.show(true);
    hud2.show(true);
    G.hud.banner(m.name, m.when, 4);
    setTimeout(() => {
      if (!W.active || G.state !== 'playing') return;
      if (m.convoy) G.hud.feed('RADIO: CONVOY REPORTED — SEE SONAR PLOT', 'good');
      if (m.id === 'harbor') G.hud.feed('INTEL: GAP IN THE MINEFIELD AT THE CENTRE OF THE CHANNEL', 'good');
      G.hud.feed('T: TIME COMPRESSION · V: BRIDGE / PERISCOPE', 'kill');
    }, 1500);
    G.camera.position.set(S.pos.x - S.forward.x * 80, 25, S.pos.z - S.forward.z * 80);
    camLook.copy(S.pos);
    G.audio.init();
  },

  /** Remove every WWII entity (keeps the mode's static helpers). */
  clear() {
    for (const list of ENTITY_LISTS()) {
      for (const o of list) {
        if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
        if (o.light) { o.light.intensity = 0; o.light.userData.busy = false; }
      }
      list.length = 0;
    }
    W.convoys.length = 0;
    if (G.player && G.player.mesh && G.player.mesh.parent) G.scene.remove(G.player.mesh);
    if (aimLine) { aimLine.visible = false; interceptMark.visible = false; }
  },

  teardown() {
    if (!W.active) return;
    this.clear();
    W.active = false;
    if (hud2) hud2.show(false);
    document.body.classList.remove('ww2');
    G.audio.silenceLoops();
    G.world.setProfile('arcade');
    G.camera.far = 2600;
    G.camera.fov = 65;
    G.camera.updateProjectionMatrix();
  },

  endPatrol() { endMission('ended'); },

  step(dt) {
    const steps = G.state === 'playing' ? W.timeScale : 1;
    for (let i = 0; i < steps; i++) {
      if (i > 0) G.time += dt;
      logic(dt);
      if (G.state === 'over') return;
    }
    const S = G.player;
    G.fx.update(dt * steps, G.time, G.scene.fog.density);
    updateCamera(dt);
    G.world.update(dt * steps, G.camera, G.time, S.alive ? clamp((40 - S.hp) / 40, 0, 1) : 0);
    updateAimAids();
    updateAudio();
    G.hud.updateCommon(dt);
    hud2.update(dt);
  },

  keydown(e) {
    const S = G.player;
    if (!S.alive) return;
    switch (e.code) {
      case 'KeyW': S.tele = Math.min(TELEGRAPH.length - 1, S.tele + 1); G.hud.feed(TELEGRAPH[S.tele].name, 'kill'); break;
      case 'KeyS': S.tele = Math.max(0, S.tele - 1); G.hud.feed(TELEGRAPH[S.tele].name, 'kill'); break;
      case 'KeyX': S.tele = 1; G.hud.feed('ALL STOP', 'kill'); break;
      case 'Digit1': S.orderDepth(DEPTH.surface); G.hud.feed('SURFACE!', 'kill'); break;
      case 'Digit2': S.orderDepth(DEPTH.periscope); G.hud.feed('PERISCOPE DEPTH', 'kill'); break;
      case 'Digit3': S.orderDepth(50); G.hud.feed('MAKE DEPTH 50 METRES', 'kill'); break;
      case 'Digit4': S.orderDepth(140); G.hud.feed('TAKE HER DEEP — 140 METRES', 'kill'); break;
      case 'KeyC':
        S.orderDepth(Math.max(70, S.orderedDepth), true);
        if (S.tele < 4) S.tele = 4;
        G.audio.klaxon();
        G.hud.feed('ALAAARM! CRASH DIVE!', 'bad');
        if (W.view === 'scope' && S.surfaced) W.view = 'ext';
        break;
      case 'KeyB': S.blow(); break;
      case 'KeyV':
        if (W.view === 'scope') W.view = 'ext';
        else if (S.surfaced || (S.depth <= DEPTH.periscope + 2.5 && S.systems.periscope <= 0)) {
          W.view = 'scope';
          W.scopeRel = angleWrap(W.aimYaw - S.yaw);
          W.scopePitch = 0;
        } else G.hud.feed(S.systems.periscope > 0 ? 'PERISCOPE DAMAGED' : 'TOO DEEP — GO TO PERISCOPE DEPTH (2)', 'bad');
        break;
      case 'KeyL': W.cam.yaw = 0; W.cam.pitch = 0.22; W.scopeRel = 0; break;
      case 'Tab': cycleLock(); break;
      case 'Space': fireTorpedoes(1); break;
      case 'KeyE': fireTorpedoes(3); break;
      case 'KeyQ': dropDecoy(); break;
      case 'KeyK': W.tdcAssist = !W.tdcAssist; G.hud.feed(`TDC ASSIST ${W.tdcAssist ? 'ON' : 'OFF'}`, 'kill'); break;
      case 'KeyZ': W.sonarRange = W.sonarRange === 1500 ? 3000 : W.sonarRange === 3000 ? 6000 : 1500; break;
      case 'KeyT': {
        const next = W.timeScale >= 8 ? 1 : W.timeScale * 2;
        if (next > 1 && W.dangerT > 0) { G.hud.feed('ENEMY NEARBY — CANNOT COMPRESS TIME', 'bad'); break; }
        W.timeScale = next;
        G.hud.feed(`TIME COMPRESSION ${next}x`, 'kill');
        break;
      }
      default: break;
    }
  },

  mouseDown(button) { if (button === 0 && G.state === 'playing') fireTorpedoes(1); },

  mouseDrag(dx, dy) {
    if (W.view === 'scope') {
      const k = W.zoom ? 0.0009 : 0.003;
      W.scopeRel -= dx * k;
      W.scopePitch = clamp(W.scopePitch - dy * k * 0.6, -0.08, 0.7);
    } else {
      W.cam.yaw -= dx * 0.006;
      W.cam.pitch = clamp(W.cam.pitch + dy * 0.004, -0.6, 1.2);
    }
  },

  wheel(dy) {
    if (W.view === 'scope') W.zoom = dy < 0;
    else W.cam.dist = clamp(W.cam.dist + Math.sign(dy) * 8, 30, 220);
  },
};
