// WWII entities: merchants, convoys, escorts (ASDIC, hydrophones, depth charges, guns, star shells),
// aircraft, enemy submarine, coastal battery, straight-running torpedoes, shells, bombs, sinking wrecks.
import * as THREE from 'three';
import { G } from '../state.js';
import { W, flareMul } from './wstate.js';
import { heightAt } from '../world.js';
import * as M from '../models.js';
import { rand, clamp, angleWrap, volAt, DepthCharge } from '../entities.js';

const TAU = Math.PI * 2;
export const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
export const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const turnToward = (cur, target, step) => cur + clamp(angleWrap(target - cur), -step, step);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Low-arc ballistic elevation for a projectile at speed v to hit a point d away and h higher. */
export function ballistic(d, h, v, g) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

/** Fire a gun shell from `from` toward `target` (+ velocity lead) with random dispersion. */
export function fireShell(owner, from, target, tvel, opts = {}) {
  const v = opts.speed || 210, g = 9.8;
  const aim = _w.copy(target);
  let tFlight = 0;
  for (let i = 0; i < 2; i++) {
    const d = hdist(from, aim);
    const th = ballistic(d, aim.y - from.y, v, g);
    tFlight = d / (v * Math.cos(th));
    if (tvel) aim.copy(target).addScaledVector(tvel, tFlight);
  }
  const disp = opts.disp ?? 0.02;
  const d = hdist(from, aim);
  aim.x += rand(-1, 1) * d * disp;
  aim.z += rand(-1, 1) * d * disp;
  const th = ballistic(hdist(from, aim), aim.y - from.y, v, g) + rand(-1, 1) * disp * 0.35;
  const yaw = yawTo(from, aim);
  const vel = new THREE.Vector3(Math.sin(yaw) * Math.cos(th), Math.sin(th), Math.cos(yaw) * Math.cos(th)).multiplyScalar(v);
  W.shells.push(new Shell(owner, from.clone(), vel, opts));
  return tFlight;
}

// ============================================================ SHIP BASE
export class Ship {
  constructor(mesh, spec) {
    this.mesh = mesh;
    G.scene.add(mesh);
    this.pos = mesh.position;
    this.L = spec.L; this.B = spec.B; this.draft = spec.draft; this.top = spec.top ?? spec.free + 8;
    this.hp = this.maxHp = spec.hp;
    this.grt = spec.grt;
    this.label = spec.label;
    this.type = spec.type;
    this.kind = spec.kind;
    this.maxSpeed = spec.maxSpeed;
    this.turnRate = spec.turnRate;
    this.accel = spec.accel ?? 0.25;
    this.isEnemy = true;
    this.alive = true;
    this.radius = spec.B * 0.6;
    this.yaw = 0; this.speed = 0; this.tYaw = 0; this.tSpeed = 0;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.vel = new THREE.Vector3();
    this.phase = rand(0, TAU);
    this.fire = 0; this.list = 0; this.flash = 0;
    this.wakeAcc = 0; this.smokeAcc = 0;
    // sensor/TDC bookkeeping (player's knowledge of this contact)
    this.known = false; this.visual = false; this.hydro = false; this.lastSeen = -999;
    this.estPos = new THREE.Vector3(); this.sol = 0; this.solYaw = 0; this.errA = 0; this.errS = 0;
    this.sighted = false;
    this.evadeT = 0; this.evadeYaw = 0;
  }

  /** Box test in ship-local coordinates. */
  hitTest(p, r) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, dy = p.y - this.pos.y;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    return Math.abs(along) < this.L / 2 + r && Math.abs(lat) < this.B / 2 + r && dy < this.top + r && dy > -this.draft - r;
  }

  blastDist(p) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const t = clamp(dx * fx + dz * fz, -this.L / 2, this.L / 2);
    const cx = dx - fx * t, cz = dz - fz * t, cy = p.y - (this.pos.y - this.draft / 2);
    return Math.max(0, Math.sqrt(cx * cx + cz * cz + cy * cy) - this.B / 2);
  }

  get dmgFactor() { return 0.35 + 0.65 * clamp(this.hp / this.maxHp, 0, 1); }

  steer(dt) {
    const sp = Math.abs(this.speed);
    this.yaw = turnToward(this.yaw, this.tYaw, this.turnRate * dt * (0.25 + 0.75 * Math.min(1, sp / 3)));
    const ts = Math.min(this.tSpeed, this.maxSpeed * this.dmgFactor);
    this.speed += clamp(ts - this.speed, -this.accel * 1.5 * dt, this.accel * dt);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.vel.copy(this.forward).multiplyScalar(this.speed);
    // Avoid running aground (coastal)
    const ahead = heightAt(this.pos.x + this.forward.x * (this.L * 0.8 + 30), this.pos.z + this.forward.z * (this.L * 0.8 + 30));
    if (ahead > -this.draft - 2) this.tYaw = this.yaw + 0.8;
    this.pos.y = Math.sin(G.time * 0.8 + this.phase) * 0.25;
    const turn = angleWrap(this.tYaw - this.yaw);
    this.mesh.rotation.set(Math.sin(G.time * 0.6 + this.phase) * 0.012, this.yaw, this.list + Math.sin(G.time * 0.5 + this.phase) * 0.025 - clamp(turn, -0.5, 0.5) * 0.06 * Math.min(1, sp / 6));
  }

  hit(dmg, src, kind = 'blast') {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 0.3;
    if (kind === 'torpedo') this.holed = true;
    this.lastHitBy = src;
    if (kind !== 'shell' || Math.random() < 0.35) this.fire = Math.min(1, this.fire + dmg / (this.kind === 'tanker' ? 60 : 110));
    this.list = clamp(this.list + (dmg / this.maxHp) * rand(-0.15, 0.15), -0.3, 0.3);
    if (this.hp <= 0) this.sink(src);
    else if (W.onShipHit) W.onShipHit(this, src, kind);
  }

  sink(src) {
    this.alive = false;
    const p = this.pos.clone();
    G.wrecks.push(new SinkingShip(this));
    this.mesh = null;
    W.onShipSunk(this, src, p);
  }

  effects(dt) {
    if (this.holed && this.hp < this.maxHp * 0.5) {
      this.hp -= this.maxHp * 0.012 * dt;
      this.list = clamp(this.list + Math.sign(this.list || 1) * 0.002 * dt, -0.35, 0.35);
      if (this.hp <= 0) { this.sink(this.lastHitBy || 'player'); return; }
    }
    const ud = this.mesh.userData;
    if (this.flash > 0) {
      this.flash -= dt;
      const f = Math.max(0, this.flash) * 4;
      for (const m of ud.flashMats || []) m.emissive.setRGB(f, f * 0.3, 0);
    }
    const sp = Math.abs(this.speed);
    // Bow wave and wake foam
    this.wakeAcc += (sp * 1.2 + 0.2) * dt;
    while (this.wakeAcc >= 1) {
      this.wakeAcc -= 1;
      const hl = this.L / 2;
      const sx = this.pos.x - this.forward.x * hl, sz = this.pos.z - this.forward.z * hl;
      G.fx.foam.emit(sx + rand(-2, 2), 0.3, sz + rand(-2, 2), rand(-1, 1), 0, rand(-1, 1), rand(5, 10), rand(3, 6));
      if (sp > 2) {
        const bx = this.pos.x + this.forward.x * hl, bz = this.pos.z + this.forward.z * hl;
        const side = Math.random() < 0.5 ? -1 : 1;
        G.fx.foam.emit(bx, 0.3, bz, this.forward.z * side * rand(1, 3), 0, -this.forward.x * side * rand(1, 3), rand(2, 5), rand(2, 4));
      }
      G.fx.bubbles.emit(sx + rand(-1, 1), -this.draft, sz + rand(-1, 1), rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), rand(1, 2), rand(0.4, 1));
    }
    // Funnel smoke & fires
    this.smokeAcc += dt * (1.2 + this.fire * 10);
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      if (ud.funnelTop) {
        _v.copy(ud.funnelTop).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos);
        G.fx.smoke.emit(_v.x, _v.y, _v.z, rand(-0.5, 0.5) - this.forward.x * 1.5, rand(1.5, 3), rand(-0.5, 0.5) - this.forward.z * 1.5, rand(5, 9), rand(3, 5));
      }
      if (this.fire > 0.05) {
        const t = rand(-0.4, 0.4) * this.L;
        const x = this.pos.x + this.forward.x * t, z = this.pos.z + this.forward.z * t, y = this.pos.y + 5;
        G.fx.sparks.emit(x, y, z, rand(-1, 1), rand(3, 8), rand(-1, 1), rand(0.4, 1), rand(4, 9) * (0.6 + this.fire));
        G.fx.smoke.emit(x, y + 3, z, rand(-1, 1), rand(3, 6), rand(-1, 1), rand(6, 12), rand(6, 12) * (0.5 + this.fire));
      }
    }
    if (this.fire > 0) this.fire = Math.max(0, this.fire - dt * 0.004);
  }

  evade(fromYaw) {
    if (this.evadeT > 0) return;
    this.evadeT = 22;
    this.evadeYaw = fromYaw + (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.5;
  }
}

// ============================================================ CONVOY
export class Convoy {
  constructor(center, yaw, speed) {
    this.center = center.clone();
    this.baseYaw = yaw;
    this.yaw = yaw;
    this.speed = speed;
    this.forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.zigT = rand(40, 70);
    this.alerted = false;
    this.ships = [];
    this.escorts = [];
  }
  update(dt) {
    this.zigT -= dt;
    if (this.zigT <= 0) {
      this.zigT = this.alerted ? rand(35, 55) : rand(70, 110);
      this.yaw = this.baseYaw + [-0.35, 0, 0.35][Math.floor(Math.random() * 3)];
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.center.addScaledVector(this.forward, this.speed * dt);
  }
  station(offset, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // offset: x = lateral (right +), z = along (ahead +)
    return out.set(this.center.x + offset.z * s + offset.x * c, 0, this.center.z + offset.z * c - offset.x * s);
  }
  alert() {
    if (this.alerted) return;
    this.alerted = true;
    this.speed += 0.9;
    this.zigT = Math.min(this.zigT, 6);
    G.hud.feed('CONVOY IS ALERTED — ZIG-ZAGGING', 'bad');
  }
}

// ============================================================ MERCHANT
const MERCH = {
  freighter: { grt: 2800, hp: 95, maxSpeed: 5.6, turnRate: 0.05 },
  cargo: { grt: 5600, hp: 140, maxSpeed: 5.2, turnRate: 0.04 },
  tanker: { grt: 8600, hp: 165, maxSpeed: 4.9, turnRate: 0.035 },
  liner: { grt: 12500, hp: 230, maxSpeed: 6.2, turnRate: 0.035 },
};
export class Merchant extends Ship {
  constructor(kind, pos, yaw, opts = {}) {
    const mesh = M.makeMerchant(kind);
    const ud = mesh.userData;
    super(mesh, { ...MERCH[kind], L: ud.L, B: ud.B, draft: ud.draft, free: ud.free, top: ud.free + 9, label: ud.label, type: 'merchant', kind });
    this.pos.copy(pos);
    this.yaw = this.tYaw = yaw;
    this.convoy = opts.convoy || null;
    this.offset = opts.offset || null;
    this.anchored = !!opts.anchored;
    this.route = opts.route || null;
    this.routeI = 0;
    this.speed = this.anchored ? 0 : (this.convoy ? this.convoy.speed : this.maxSpeed * 0.8);
    this.armed = Math.random() < 0.35;
    this.gunCd = rand(4, 8);
    this.escaped = false;
    this.alerted = false;
  }
  update(dt) {
    const S = G.player;
    if (this.anchored) {
      this.tSpeed = 0;
    } else if (this.convoy) {
      const st = this.convoy.station(this.offset, _v);
      const lead = _w.copy(st).addScaledVector(this.convoy.forward, 60);
      this.tYaw = yawTo(this.pos, lead);
      const along = (st.x - this.pos.x) * this.convoy.forward.x + (st.z - this.pos.z) * this.convoy.forward.z;
      this.tSpeed = this.convoy.speed + clamp(along * 0.02, -1.5, 1.5);
    } else if (this.route) {
      const wp = this.route[this.routeI];
      this.tYaw = yawTo(this.pos, wp) + (this.alerted ? Math.sin(G.time * 0.04 + this.phase) * 0.5 : 0);
      this.tSpeed = this.alerted ? this.maxSpeed : this.maxSpeed * 0.8;
      if (hdist(this.pos, wp) < 120) {
        this.routeI++;
        if (this.routeI >= this.route.length) { this.escaped = true; this.alive = false; }
      }
    }
    if (this.evadeT > 0) {
      this.evadeT -= dt;
      this.tYaw = this.evadeYaw;
      this.tSpeed = this.maxSpeed;
    }
    // Armed merchants (DEMS gun) shoot at a surfaced boat they can see
    if (this.armed && S.alive && S.surfaced) {
      this.gunCd -= dt;
      if (this.gunCd <= 0) {
        this.gunCd = rand(5, 8);
        const d = hdist(this.pos, S.pos);
        if (d < 1400 && W.canSee(this, S)) {
          const from = _v.copy(this.pos).addScaledVector(this.forward, -this.L * 0.4);
          from.y = 6;
          fireShell('enemy', from, S.pos, S.vel, { disp: 0.045, dmg: 8 });
          G.fx.muzzle(from, this.forward);
          G.audio.gun(volAt(this.pos, 3000) * 0.8);
        }
      }
    }
    this.steer(dt);
    this.effects(dt);
  }
}

// ============================================================ ESCORT
const ESC = {
  destroyer: { grt: 1400, hp: 120, maxSpeed: 15, turnRate: 0.13, accel: 0.9, label: 'DESTROYER', dc: 40, gunCd: 2.6, gunDisp: 0.022, pattern: 6, hunt: 13 },
  corvette: { grt: 950, hp: 95, maxSpeed: 10.5, turnRate: 0.16, accel: 0.7, label: 'CORVETTE', dc: 60, gunCd: 4, gunDisp: 0.03, pattern: 8, hunt: 9.5 },
};
export class Escort extends Ship {
  constructor(kind, pos, yaw, opts = {}) {
    const mesh = kind === 'destroyer' ? M.makeWarDestroyer() : M.makeCorvette();
    const ud = mesh.userData;
    const spec = ESC[kind];
    super(mesh, { ...spec, L: ud.L, B: ud.B, draft: ud.draft, free: ud.free, top: ud.free + 10, type: 'escort', kind });
    this.spec = spec;
    this.pos.copy(pos);
    this.yaw = this.tYaw = yaw;
    this.speed = 7;
    this.convoy = opts.convoy || null;
    this.offset = opts.offset || null;
    this.patrol = opts.patrol || null;
    this.patrolI = 0;
    this.state = 'screen';
    this.contact = null; // {pos, vel, depth, t}
    this.invest = new THREE.Vector3();
    this.investT = 0;
    this.pingT = rand(0, 4);
    this.sensT = rand(0, 0.5);
    this.dcLeft = spec.dc;
    this.dropCd = 0;
    this.openT = 0;
    this.gunCd = rand(1, 3);
    this.starCd = rand(5, 15);
    this.ramCd = 0;
  }

  setContact(p, depth, src, err = 0) {
    const S = G.player;
    if (!this.contact) this.contact = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), depth: 0, t: 0 };
    const c = this.contact;
    c.pos.set(p.x + rand(-err, err), 0, p.z + rand(-err, err));
    c.vel.copy(S.vel).multiplyScalar(rand(0.6, 1.1));
    c.depth = depth;
    c.t = W.clock;
    c.src = src;
    if (this.state === 'screen' || this.state === 'investigate') this.state = 'hunt';
    if (this.convoy) this.convoy.alert();
    W.onDetected(this, src);
  }

  investigate(p, err = 150) {
    if (this.state === 'hunt' || this.state === 'gun' || this.state === 'open') return;
    this.invest.set(p.x + rand(-err, err), 0, p.z + rand(-err, err));
    this.state = 'investigate';
    this.investT = 70;
  }

  update(dt) {
    const S = G.player;
    const d = hdist(this.pos, S.pos);
    const layer = S.depth > W.layerDepth ? 0.5 : 1;

    // ---- sensors ----
    this.sensT -= dt;
    if (this.sensT <= 0 && S.alive) {
      this.sensT = 0.5;
      const seen = W.canSee(this, S);
      if (seen) {
        this.setContact(S.pos, S.depth, 'visual', 10);
        if (S.surfaced && this.state !== 'gun') this.state = 'gun';
      } else if (this.state === 'gun') {
        this.setContact(S.pos, S.depth + rand(5, 20), 'lost', 40); // saw it dive
        this.state = 'hunt';
      }
      // Hydrophones are deaf above ~9 m/s own speed
      if (!seen && Math.abs(this.speed) < 9) {
        const hr = S.surfaced ? 350 + Math.abs(S.speed) * 30 : S.noise * 3.2 * layer;
        if (d < hr && Math.random() < 0.5) {
          if (S.submerged) this.setContact(S.pos, S.depth + rand(-25, 25), 'hydro', d * 0.12);
          else this.investigate(S.pos, d * 0.15);
        }
      }
    }
    // ASDIC: forward ±80°, loses contact inside ~90 m, halved below the layer
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = this.state === 'hunt' ? 2.5 : 4.5;
      if (S.alive && S.depth > 6) {
        const rel = Math.abs(angleWrap(yawTo(this.pos, S.pos) - this.yaw));
        const range = (this.speed > 12 ? 700 : 1150) * layer;
        let contact = d < range && d > 90 && rel < 1.4 && Math.random() < 0.8;
        let at = S.pos;
        const decoy = G.decoys.find((x) => x.alive && x.owner === 'player' && hdist(x.pos, S.pos) < 450);
        if (decoy && hdist(this.pos, decoy.pos) < range && Math.random() < 0.6) { contact = true; at = decoy.pos; }
        if (d < 2400) G.audio.asdic(Math.pow(1 - d / 2400, 1.4), contact && at === S.pos);
        if (contact) {
          const err = 10 + S.depth * 0.12 + (layer < 1 ? 30 : 0);
          this.setContact(at, (at === S.pos ? S.depth : rand(20, 80)) + rand(-err, err), 'asdic', d * 0.03);
        }
      }
    }

    // ---- behaviour ----
    const c = this.contact;
    const age = c ? W.clock - c.t : 999;
    if ((this.state === 'hunt' || this.state === 'open') && age > 45) {
      this.investigate(c.pos, 60);
      this.state = 'investigate';
    }
    this.dropCd -= dt;
    if (this.state === 'screen') {
      if (this.convoy) {
        const st = this.convoy.station(this.offset, _v);
        st.addScaledVector(this.convoy.forward, 150);
        st.x += Math.sin(W.clock * 0.05 + this.phase) * 120;
        this.tYaw = yawTo(this.pos, st);
        this.tSpeed = clamp(this.convoy.speed + hdist(this.pos, st) * 0.01, 4, 11);
      } else if (this.patrol) {
        const wp = this.patrol[this.patrolI];
        this.tYaw = yawTo(this.pos, wp);
        this.tSpeed = 6;
        if (hdist(this.pos, wp) < 80) this.patrolI = (this.patrolI + 1) % this.patrol.length;
      }
    } else if (this.state === 'investigate') {
      this.investT -= dt;
      const di = hdist(this.pos, this.invest);
      this.tYaw = di > 150 ? yawTo(this.pos, this.invest) : this.yaw + 0.25;
      this.tSpeed = di > 400 ? 12 : 6; // slow to listen
      if (this.investT <= 0) this.state = 'screen';
    } else if (this.state === 'hunt') {
      const eta = hdist(this.pos, c.pos) / Math.max(5, this.speed);
      const pred = _v.copy(c.pos).addScaledVector(c.vel, Math.min(eta + age, 60));
      const rx = pred.x - this.pos.x, rz = pred.z - this.pos.z;
      const along = rx * this.forward.x + rz * this.forward.z, lat = Math.abs(rx * this.forward.z - rz * this.forward.x);
      // Run straight over the target, release as the stern passes it
      if (along > -this.L * 0.2) this.tYaw = yawTo(this.pos, pred);
      this.tSpeed = this.spec.hunt;
      if (along < -this.L * 0.45 && along > -this.L * 1.6 && lat < 40 && this.dropCd <= 0 && S.depth > 6) this.dropPattern(c.depth);
      else if (along < -this.L * 1.6) this.tYaw = yawTo(this.pos, pred);
    } else if (this.state === 'open') {
      this.openT -= dt;
      this.tSpeed = this.spec.hunt;
      if (this.openT <= 0) this.state = 'hunt';
    } else if (this.state === 'gun') {
      this.tYaw = yawTo(this.pos, _v.copy(S.pos).addScaledVector(S.vel, d / Math.max(8, this.speed)));
      this.tSpeed = this.maxSpeed;
    }

    // ---- guns at a surfaced boat ----
    this.gunCd -= dt;
    if (this.gunCd <= 0 && S.alive && S.surfaced && d < 2600 && (this.state === 'gun' || W.canSee(this, S))) {
      this.gunCd = this.spec.gunCd * rand(0.85, 1.2);
      const from = _v.copy(this.pos).addScaledVector(this.forward, this.L * 0.35);
      from.y = 6;
      fireShell('enemy', from, S.pos, S.vel, { disp: this.spec.gunDisp * (0.7 + d / 2600), dmg: 11 });
      G.fx.muzzle(from, this.forward);
      G.audio.gun(volAt(this.pos, 3500));
    }
    // ---- star shells at night ----
    this.starCd -= dt;
    if (W.envName === 'night' && c && age < 20 && this.starCd <= 0 && hdist(this.pos, c.pos) < 1800) {
      this.starCd = rand(22, 32);
      W.flares.push(new StarShell(c.pos));
      G.audio.gun(volAt(this.pos, 3500) * 0.6);
    }

    this.steer(dt);
    this.mesh.userData.radar.rotation.y += dt * 2;
    for (const p of this.mesh.userData.props) p.rotation.y += this.speed * dt;
    this.effects(dt);
  }

  dropPattern(depthEst) {
    if (this.dcLeft <= 0) { this.state = 'open'; this.openT = 10; return; }
    const n = Math.min(this.spec.pattern, this.dcLeft);
    this.dcLeft -= n;
    const right = _w.set(this.forward.z, 0, -this.forward.x);
    for (let i = 0; i < n; i++) {
      const lat = i < 2 ? (i === 0 ? -22 : 22) : rand(-8, 8);
      const along = -this.L / 2 - (i < 2 ? 0 : (i - 2) * 9);
      const p = this.pos.clone().addScaledVector(this.forward, along).addScaledVector(right, lat);
      p.y = -1;
      const layered = i % 2 === 0 ? -10 : 10;
      G.charges.push(new DepthCharge(p, -clamp(depthEst + layered + rand(-6, 6), 15, 250)));
    }
    this.dropCd = 14;
    this.state = 'open';
    this.openT = rand(14, 20);
    G.audio.beep(330, 0.03 + 0.05 * volAt(this.pos, 600), 0.2);
    if (hdist(this.pos, G.player.pos) < 600) G.hud.feed('DEPTH CHARGES IN THE WATER!', 'bad');
    W.stats.dcDropped += n;
  }
}

// ============================================================ ENEMY SUBMARINE
export class EnemyBoat extends Ship {
  constructor(pos, yaw, route) {
    const mesh = M.makeEnemyBoat();
    super(mesh, { grt: 770, hp: 75, maxSpeed: 8, turnRate: 0.14, L: 24, B: 5.8, draft: 3.5, free: 3, top: 8, label: 'SUBMARINE', type: 'boat', kind: 'boat' });
    this.pos.copy(pos);
    this.yaw = this.tYaw = yaw;
    this.route = route;
    this.routeI = 0;
    this.speed = 6;
    this.depthNow = 2.2;
    this.state = 'transit';
    this.sensT = 0;
    this.torpCd = rand(10, 20);
    this.quietT = 0;
  }
  hitTest(p, r) {
    const dy = p.y - this.pos.y;
    if (dy < -3.5 - r || dy > 8 + r) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    return Math.abs(along) < 12 + r && Math.abs(lat) < 2.9 + r;
  }
  blastDist(p) { return Math.max(0, p.distanceTo(this.pos) - 4); }
  update(dt) {
    const S = G.player;
    const d = hdist(this.pos, S.pos);
    this.sensT -= dt;
    if (this.sensT <= 0 && S.alive) {
      this.sensT = 1;
      const seen = (S.surfaced && d < W.vis.surf * 0.8 * flareMul(S.pos)) || d < S.noise * 1.8;
      if (seen) { this.state = 'stalk'; this.quietT = 0; }
      else if (this.state === 'stalk') { this.quietT += 1; if (this.quietT > 150) this.state = 'transit'; }
    }
    let targetDepth = 2.2;
    if (this.state === 'transit') {
      const wp = this.route[this.routeI];
      this.tYaw = yawTo(this.pos, wp);
      this.tSpeed = 6;
      if (hdist(this.pos, wp) < 150) this.routeI = (this.routeI + 1) % this.route.length;
    } else {
      targetDepth = 14; // stalks at periscope depth
      this.tYaw = yawTo(this.pos, S.pos) + 0.5;
      this.tSpeed = 3;
      this.torpCd -= dt;
      const rel = Math.abs(angleWrap(yawTo(this.pos, S.pos) - this.yaw));
      if (this.torpCd <= 0 && S.alive && S.depth < 22 && d < 1300 && d > 150 && rel < 0.8) {
        this.torpCd = rand(50, 70);
        const t = (d / 18);
        const aim = _v.copy(S.pos).addScaledVector(S.vel, t);
        const yaw = yawTo(this.pos, aim);
        for (const off of [-0.03, 0.03]) {
          G.torpedoes.push(new StraightTorpedo('enemy', this.pos.clone().addScaledVector(this.forward, 13), this.yaw, yaw + off));
        }
        G.audio.launch(volAt(this.pos, 1500));
        G.hud.feed('TORPEDOES IN THE WATER — ENEMY SUBMARINE!', 'bad');
        W.interrupt('Enemy torpedoes!');
        W.dangerT = 40;
      }
    }
    this.depthNow += clamp(targetDepth - this.depthNow, -2 * dt, 2 * dt);
    this.steer(dt);
    this.pos.y = -this.depthNow + (this.depthNow < 3 ? Math.sin(G.time + this.phase) * 0.2 : 0);
    this.mesh.userData.prop.rotation.z += this.speed * dt * 2;
    if (this.flash > 0) {
      this.flash -= dt;
      this.mesh.userData.hullMat.emissive.setRGB(Math.max(0, this.flash) * 4, 0, 0);
    }
    if (this.depthNow < 3) {
      this.wakeAcc += this.speed * dt;
      while (this.wakeAcc >= 1) {
        this.wakeAcc -= 1;
        G.fx.foam.emit(this.pos.x - this.forward.x * 13, 0.3, this.pos.z - this.forward.z * 13, rand(-1, 1), 0, rand(-1, 1), rand(4, 7), rand(2, 4));
      }
    }
  }
}

// ============================================================ COASTAL BATTERY
export class Battery {
  constructor(pos) {
    this.mesh = M.makeBattery();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.type = 'battery'; this.kind = 'battery'; this.label = 'COASTAL BATTERY';
    this.hp = this.maxHp = 70; this.grt = 0; this.alive = true; this.isEnemy = true;
    this.radius = 8; this.speed = 0; this.yaw = 0; this.L = 14;
    this.vel = new THREE.Vector3();
    this.gunCd = 4;
    this.known = false; this.visual = false; this.hydro = false; this.lastSeen = -999;
    this.estPos = this.pos.clone(); this.sol = 1; this.solYaw = 0; this.errA = 0; this.errS = 0; this.sighted = false;
  }
  hitTest(p, r) { return p.distanceTo(this.pos) < 9 + r; }
  blastDist(p) { return Math.max(0, p.distanceTo(this.pos) - 8); }
  hit(dmg, src) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.alive = false;
      G.fx.surfaceExplosion(this.pos, 1.6);
      G.audio.explosion(volAt(this.pos, 3000), true);
      W.onShipSunk(this, src, this.pos.clone());
    }
  }
  update(dt) {
    const S = G.player;
    this.gunCd -= dt;
    const yaw = yawTo(this.pos, S.pos);
    this.mesh.rotation.y = yaw + Math.PI;
    if (this.gunCd <= 0 && S.alive && S.surfaced) {
      const d = hdist(this.pos, S.pos);
      if (d < 3200 && d < W.vis.surf * 1.3) {
        this.gunCd = rand(5, 7);
        const from = this.pos.clone();
        from.y += 5;
        fireShell('enemy', from, S.pos, S.vel, { disp: 0.018, dmg: 16, speed: 260 });
        G.fx.muzzle(from, _v.set(Math.sin(yaw), 0.2, Math.cos(yaw)));
        G.audio.gun(volAt(this.pos, 4000));
        if (!this.warned) { this.warned = true; G.hud.feed('COASTAL BATTERY OPENING FIRE!', 'bad'); }
      }
    }
  }
}

// ============================================================ AIRCRAFT
export class Plane {
  constructor(pos, center) {
    this.mesh = M.makePlane();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.center = center.clone();
    this.type = 'plane'; this.kind = 'plane'; this.label = 'AIRCRAFT';
    this.isEnemy = true; this.alive = true; this.hp = 55; this.maxHp = 55; this.grt = 0; this.radius = 9; this.L = 20;
    this.yaw = yawTo(pos, center);
    this.speed = 52;
    this.alt = 170;
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.state = 'patrol';
    this.bombs = 4;
    this.dropI = 0; this.dropT = 0;
    this.fuel = rand(220, 300);
    this.sensT = 0;
    this.target = new THREE.Vector3();
    this.passT = 0;
    this.reported = -99;
    this.roll = 0;
    this.known = false; this.visual = false; this.hydro = false; this.lastSeen = -999;
    this.estPos = new THREE.Vector3(); this.sol = 1; this.solYaw = 0; this.errA = 0; this.errS = 0; this.sighted = false;
  }
  hitTest(p, r) { return p.distanceTo(this.pos) < this.radius + r; }
  blastDist(p) { return p.distanceTo(this.pos); }
  hit(dmg, src) {
    if (!this.alive || this.state === 'down') return;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.state = 'down';
      G.fx.explosion(this.pos, 0.8);
      G.hud.feed('AIRCRAFT HIT — GOING DOWN!', 'gold');
      W.stats.planes++;
      G.score += 300;
    }
  }
  update(dt) {
    const S = G.player;
    this.fuel -= dt;
    let tYaw = this.yaw, tAlt = this.alt;
    if (this.state === 'down') {
      this.pos.y -= 30 * dt;
      this.yaw += 0.6 * dt;
      G.fx.smoke.emit(this.pos.x, this.pos.y, this.pos.z, 0, 1, 0, rand(3, 6), rand(4, 8));
      G.fx.sparks.emit(this.pos.x, this.pos.y, this.pos.z, rand(-2, 2), rand(0, 3), rand(-2, 2), 0.5, 5);
      if (this.pos.y < 1) {
        this.alive = false;
        G.fx.surfaceExplosion(_v.set(this.pos.x, 0.5, this.pos.z), 1);
        G.audio.explosion(volAt(this.pos, 3000));
      }
    } else {
      this.sensT -= dt;
      if (this.sensT <= 0 && S.alive) {
        this.sensT = 0.5;
        if (W.canSee(this, S)) {
          this.target.copy(S.pos);
          if (this.bombs > 0 && this.state !== 'attack' && this.state !== 'pass') {
            this.state = 'attack';
            G.hud.feed('AIRCRAFT ATTACKING!', 'bad');
          }
          if (W.clock - this.reported > 30) { this.reported = W.clock; W.reportSub(S.pos, 'aircraft'); }
        }
      }
      if (this.state === 'patrol') {
        const dc = hdist(this.pos, this.center);
        tYaw = yawTo(this.pos, this.center) + (dc > 1300 ? 0.3 : Math.PI / 2);
        tAlt = 170;
        if (this.fuel < 0) this.state = 'leave';
      } else if (this.state === 'attack') {
        // Lead the boat slightly; the drop window is wide because the aircraft can't turn tightly
        const S2 = G.player;
        if (S2.alive && S2.depth < 25) this.target.lerp(_v.copy(S2.pos).addScaledVector(S2.vel, 3), Math.min(1, dt * 0.5));
        const dh = hdist(this.pos, this.target);
        tYaw = yawTo(this.pos, this.target);
        tAlt = dh < 1600 ? 45 : 150;
        // strafing pass on a surfaced boat
        if (S.surfaced && dh < 700 && dh > 120 && Math.abs(angleWrap(tYaw - this.yaw)) < 0.15 && Math.random() < dt * 4) {
          const sx = S.pos.x + rand(-20, 20), sz = S.pos.z + rand(-20, 20);
          G.fx.spray.emit(sx, 0.5, sz, 0, rand(4, 8), 0, 0.6, 1.5);
          if (Math.random() < 0.3) S.damage(2, 'shell');
        }
        if (dh < 85 && Math.abs(angleWrap(tYaw - this.yaw)) < 0.5 && this.bombs > 0) {
          this.state = 'pass';
          this.passT = 14;
          this.dropI = Math.min(4, this.bombs);
          this.dropT = 0;
        }
      } else if (this.state === 'pass') {
        tAlt = 120;
        this.passT -= dt;
        if (this.dropI > 0) {
          this.dropT -= dt;
          if (this.dropT <= 0) {
            this.dropT = 0.4;
            this.dropI--;
            this.bombs--;
            W.bombs.push(new AirBomb(this.pos.clone(), this.vel.clone().multiplyScalar(0.7)));
          }
        }
        if (this.passT <= 0) this.state = this.bombs > 0 ? 'attack' : 'patrol';
        if (this.state === 'patrol') { this.center.copy(this.target); this.fuel = Math.min(this.fuel, 60); }
      } else if (this.state === 'leave') {
        tYaw = yawTo(W.center, this.pos);
        tAlt = 220;
        if (hdist(this.pos, W.center) > W.radius + 2500) this.alive = false;
      }
      const prev = this.yaw;
      this.yaw = turnToward(this.yaw, tYaw, 0.32 * dt);
      const turn = angleWrap(this.yaw - prev) / Math.max(dt, 1e-3);
      this.roll += (clamp(-turn * 2.2, -0.8, 0.8) - this.roll) * Math.min(1, dt * 2);
      this.pos.y += clamp(tAlt - this.pos.y, -18 * dt, 12 * dt);
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.vel.copy(this.forward).multiplyScalar(this.speed);
    this.mesh.rotation.set(this.state === 'down' ? 0.4 : 0, this.yaw, this.roll);
    for (const p of this.mesh.userData.props) p.rotation.z += dt * 40;
  }
}

export class AirBomb {
  constructor(pos, vel) {
    this.mesh = M.makeBomb();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.vel = vel;
    this.alive = true;
  }
  update(dt) {
    this.vel.y -= 9.8 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.lookAt(_v.copy(this.pos).add(this.vel));
    if (this.pos.y <= 0) {
      this.alive = false;
      G.fx.splash(this.pos, 0.8);
      G.audio.splash(volAt(this.pos, 1500));
      const p = this.pos.clone();
      p.y = -1;
      G.charges.push(new DepthCharge(p, -rand(11, 17)));
    }
  }
}

// ============================================================ STAR SHELL
export class StarShell {
  constructor(over) {
    this.pos = new THREE.Vector3(over.x + rand(-150, 150), 260, over.z + rand(-150, 150));
    this.sprite = M.glowSprite(0xfff4d0, 70);
    this.sprite.material.fog = false;
    this.sprite.position.copy(this.pos);
    G.scene.add(this.sprite);
    this.light = W.flareLights.find((l) => !l.userData.busy) || null;
    if (this.light) { this.light.userData.busy = true; this.light.intensity = 0; }
    this.life = 40;
    this.alive = true;
    this.mesh = this.sprite;
  }
  update(dt) {
    this.life -= dt;
    this.pos.y = Math.max(20, this.pos.y - 5 * dt);
    this.sprite.position.copy(this.pos);
    const k = clamp(this.life / 40, 0, 1);
    this.sprite.material.opacity = Math.min(1, this.life / 3);
    if (this.light) {
      this.light.position.copy(this.pos);
      this.light.intensity = 450 * Math.min(1, this.life / 4) * (0.5 + 0.5 * k);
    }
    if (this.life <= 0) {
      this.alive = false;
      if (this.light) { this.light.intensity = 0; this.light.userData.busy = false; }
    }
  }
}

// ============================================================ STRAIGHT-RUNNING TORPEDO
export class StraightTorpedo {
  constructor(owner, pos, yaw, gyroYaw, opts = {}) {
    this.owner = owner;
    this.isPlayer = owner === 'player';
    this.mesh = M.makeTorpedo(this.isPlayer);
    this.mesh.scale.setScalar(1.6);
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.yaw = yaw;
    this.gyro = gyroYaw;
    this.speed = this.isPlayer ? 20 : 18;
    this.range = 1900;
    this.run = 0;
    this.depthY = -3.5;
    this.alive = true;
    this.dud = Math.random() < (opts.dud ?? (this.isPlayer ? 0.06 : 0.1));
    this.armDist = 45;
    this.spotT = 1;
    this.dir = new THREE.Vector3();
    this.target = opts.target || null;
  }
  update(dt) {
    if (this.run > 6) this.yaw = turnToward(this.yaw, this.gyro, 0.9 * dt);
    this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.pos.y += clamp(this.depthY - this.pos.y, -3 * dt, 3 * dt);
    this.run += this.speed * dt;
    this.mesh.rotation.set(0, this.yaw, 0);
    if (Math.random() < 0.7) G.fx.bubbles.emit(this.pos.x - this.dir.x * 3, this.pos.y, this.pos.z - this.dir.z * 3, rand(-0.3, 0.3), rand(1, 2.5), rand(-0.3, 0.3), rand(1.5, 3), rand(0.3, 0.6));

    if (this.pos.y < heightAt(this.pos.x, this.pos.z) + 0.8) {
      this.alive = false;
      G.fx.explosion(this.pos, 0.8);
      G.audio.explosion(volAt(this.pos, 2500) * 0.7);
      return;
    }
    if (this.isPlayer) {
      for (const e of G.enemies) {
        if (!e.alive || e.type === 'plane' || e.type === 'mine' || e.type === 'battery') continue;
        if (e.hitTest(this.pos, 0.6)) return this.impact(e);
      }
      // Lookouts may spot the bubble track (mostly by day)
      this.spotT -= dt;
      if (this.spotT <= 0) {
        this.spotT = 1.2;
        const chance = W.envName === 'night' ? 0.02 : W.envName === 'dusk' ? 0.06 : 0.12;
        for (const e of G.enemies) {
          if (!e.alive || (e.type !== 'merchant' && e.type !== 'escort')) continue;
          const d = hdist(e.pos, this.pos);
          if (d < 450 && d > 60 && Math.random() < chance) W.onTorpedoSpotted(e, this);
        }
      }
    } else {
      const S = G.player;
      if (S.alive && S.depth < 9) {
        const dx = this.pos.x - S.pos.x, dz = this.pos.z - S.pos.z;
        const along = dx * S.forward.x + dz * S.forward.z, lat = dx * S.forward.z - dz * S.forward.x;
        if (Math.abs(along) < 13 && Math.abs(lat) < 3.5) return this.impact(S);
      }
    }
    if (this.run > this.range) {
      this.alive = false;
      if (this.isPlayer) G.hud.feed('TORPEDO RAN OUT — MISS', 'bad');
      else W.stats.evaded++;
    }
  }
  impact(target) {
    this.alive = false;
    if (this.isPlayer) W.stats.hits++;
    if (this.run < this.armDist) {
      G.audio.clang(volAt(this.pos, 1500));
      if (this.isPlayer) G.hud.feed('HIT — BUT THE TORPEDO HADN\'T ARMED YET!', 'bad');
      if (target.hit) target.hit(4, this.owner, 'shell');
      return;
    }
    if (this.dud) {
      G.audio.clang(volAt(this.pos, 1500));
      if (this.isPlayer) { G.hud.feed('DUD! TORPEDO FAILED TO DETONATE', 'bad'); W.stats.duds++; }
      if (target.hit) target.hit(3, this.owner, 'shell');
      return;
    }
    G.fx.surfaceExplosion(_v.set(this.pos.x, -1, this.pos.z), 1.6);
    G.audio.explosion(volAt(this.pos, 4000), true);
    G.shake += 1.2 * volAt(this.pos, 400);
    if (target === G.player) target.damage(rand(40, 55), 'torpedo');
    else target.hit(rand(95, 135), this.owner, 'torpedo');
  }
}

// ============================================================ SHELLS
export class Shell {
  constructor(owner, pos, vel, opts = {}) {
    this.owner = owner;
    this.pos = pos;
    this.vel = vel;
    this.flak = !!opts.flak;
    this.g = this.flak ? 0 : 9.8;
    this.dmg = opts.dmg ?? 16;
    this.life = this.flak ? 2.6 : 14;
    this.alive = true;
    this.mesh = M.makeShellTracer(owner === 'player' ? 0xffd890 : 0xff8a50, this.flak ? 1.6 : 2.6);
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
  }
  update(dt) {
    this.vel.y -= this.g * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    this.life -= dt;
    const S = G.player;
    if (this.flak) {
      for (const e of G.enemies) {
        if (e.alive && e.type === 'plane' && e.pos.distanceTo(this.pos) < 14) {
          this.alive = false;
          G.fx.sparks.emit(this.pos.x, this.pos.y, this.pos.z, 0, 0, 0, 0.3, 8);
          G.fx.smoke.emit(this.pos.x, this.pos.y, this.pos.z, 0, 0, 0, 2, 4);
          e.hit(this.dmg, 'player');
          return;
        }
      }
      if (this.life <= 0) {
        this.alive = false;
        G.fx.smoke.emit(this.pos.x, this.pos.y, this.pos.z, 0, 0, 0, 2.5, 4);
      }
      return;
    }
    if (this.owner === 'player') {
      for (const e of G.enemies) {
        if (!e.alive || e.type === 'plane' || e.type === 'mine') continue;
        if (e.hitTest(this.pos, 1)) {
          this.alive = false;
          G.fx.explosion(this.pos, 0.45);
          G.fx.smoke.emit(this.pos.x, this.pos.y + 2, this.pos.z, 0, 3, 0, 4, 6);
          G.audio.explosion(volAt(this.pos, 3000) * 0.5);
          e.hit(this.dmg * rand(0.8, 1.3), 'player', 'shell');
          W.stats.gunHits++;
          return;
        }
      }
    } else if (S.alive && S.depth < 6 && this.pos.distanceTo(S.pos) < 6) {
      this.alive = false;
      G.fx.explosion(this.pos, 0.5);
      G.audio.explosion(0.7);
      S.damage(this.dmg * rand(0.8, 1.2), 'shell');
      return;
    }
    const ground = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= Math.max(0, ground)) {
      this.alive = false;
      if (ground > 0) G.fx.explosion(this.pos, 0.5);
      else G.fx.splash(this.pos, 0.55);
      G.audio.splash(volAt(this.pos, 1500) * 0.8);
      if (this.owner !== 'player' && S.alive && S.depth < 6 && hdist(this.pos, S.pos) < 14) S.damage(2.5, 'shell');
    }
    if (this.life <= 0) this.alive = false;
  }
}

// ============================================================ SINKING SHIP
export class SinkingShip {
  constructor(ship) {
    this.mesh = ship.mesh;
    this.L = ship.L || 30;
    this.big = this.L > 50;
    this.t = 0;
    this.alive = true;
    this.mode = Math.random();
    this.targetPitch = this.mode < 0.4 ? 0.45 : this.mode < 0.8 ? -0.45 : 0;
    this.targetRoll = this.mode >= 0.8 ? (Math.random() < 0.5 ? 1.3 : -1.3) : rand(-0.3, 0.3);
    this.fire = Math.max(ship.fire, ship.kind === 'tanker' ? 1 : 0.5);
    this.groanT = rand(2, 5);
    this.isSub = ship.type === 'boat';
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 30);
    const p = this.mesh.position;
    const r = this.mesh.rotation;
    r.x += (this.targetPitch * k - r.x) * dt * 0.3;
    r.z += (this.targetRoll * k - r.z) * dt * 0.3;
    p.y -= (0.12 + 2.2 * k * k) * dt * (this.isSub ? 2 : 1);
    if (p.y > -6 && this.fire > 0 && Math.random() < dt * 14) {
      const t = rand(-0.4, 0.4) * this.L;
      const x = p.x + Math.sin(r.y) * t, z = p.z + Math.cos(r.y) * t;
      G.fx.sparks.emit(x, Math.max(1, p.y + 5), z, rand(-1, 1), rand(4, 9), rand(-1, 1), rand(0.4, 1), rand(5, 10));
      G.fx.smoke.emit(x, Math.max(2, p.y + 8), z, rand(-1, 1), rand(4, 7), rand(-1, 1), rand(8, 14), rand(8, 14));
    }
    if (Math.random() < dt * 6) G.fx.bubbles.emit(p.x + rand(-this.L / 3, this.L / 3), Math.min(-1, p.y), p.z + rand(-6, 6), 0, rand(2, 4), 0, rand(1, 2), rand(0.5, 1.5));
    if (p.y > -2 && Math.random() < dt * 3) G.fx.foam.emit(p.x + rand(-this.L / 2, this.L / 2), 0.3, p.z + rand(-8, 8), rand(-2, 2), 0, rand(-2, 2), rand(5, 9), rand(4, 8));
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = rand(4, 8);
      G.audio.groan(volAt(p, 2500));
      if (Math.random() < 0.4 && p.y > -10) {
        G.fx.explosion(_v.set(p.x + rand(-10, 10), p.y + 2, p.z + rand(-10, 10)), 0.6);
        G.audio.explosion(volAt(p, 3000) * 0.5);
      }
    }
    const floor = heightAt(p.x, p.z) + 4;
    if (p.y < floor) p.y = floor;
    if (this.t > 75 || p.y < -90) this.alive = false;
  }
}
