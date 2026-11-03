// The player's WWII attack submarine: diesel/electric propulsion, battery, depth keeping,
// flooding & system damage, torpedo tubes with reloads, deck gun, decoys.
import * as THREE from 'three';
import { G } from '../state.js';
import { W } from './wstate.js';
import { heightAt } from '../world.js';
import * as M from '../models.js';
import { clamp, rand } from '../entities.js';

export const DEPTH = { surface: 2.2, periscope: 14, test: 180, crush: 230, max: 260 };
export const TELEGRAPH = [
  { name: 'ASTERN', v: -0.35 },
  { name: 'ALL STOP', v: 0 },
  { name: 'AHEAD SLOW', v: 0.25 },
  { name: 'AHEAD HALF', v: 0.5 },
  { name: 'AHEAD FULL', v: 0.78 },
  { name: 'FLANK', v: 1 },
];
export const DIESEL_MAX = 11; // ≈17.5 kn
export const ELECTRIC_MAX = 4.8; // ≈7.7 kn
export const KN = 1.6; // display factor speed→knots
const SYSTEM_NAMES = { periscope: 'PERISCOPE', hydrophones: 'HYDROPHONES', motors: 'E-MOTORS', diesel: 'DIESELS', tubes: 'TORPEDO TUBES' };

const _v = new THREE.Vector3();

export class UBoat {
  constructor(pos, yaw) {
    this.mesh = M.makeUBoat();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.yaw = yaw;
    this.forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.tele = 4;
    this.throttle = 0;
    this.orderedDepth = -pos.y;
    this.vz = 0; // vertical speed (m/s, + = deeper)
    this.crash = false;
    this.blowing = false;
    this.hp = 100; this.maxHp = 100;
    this.alive = true;
    this.radius = 5;
    this.battery = 100;
    this.air = 100;
    this.water = 0;
    this.leaks = [];
    this.systems = { periscope: 0, hydrophones: 0, motors: 0, diesel: 0, tubes: 0 };
    this.bow = [0, 1, 2, 3].map(() => ({ loaded: true, t: 0 }));
    this.stern = [{ loaded: true, t: 0 }];
    this.reserve = 9;
    this.reloadTime = 42;
    this.gunAmmo = 110; this.flakAmmo = 400; this.gunCd = 0;
    this.decoys = 3; this.decoyCd = 0;
    this.noise = 0; this.noiseSpike = 0;
    this.scopeUp = false;
    this.boosting = false;
    this.scrapeCd = 0;
    this.creakT = 0;
    this.wakeAcc = 0;
    this.outside = false;
    this.diesel = true;
  }

  get depth() { return -this.pos.y; }
  get surfaced() { return this.depth < 4; }
  get submerged() { return this.depth > 8; }

  get maxSpeed() {
    if (this.diesel) return DIESEL_MAX;
    if (this.battery <= 0) return 0.6;
    return ELECTRIC_MAX * (this.systems.motors > 0 ? 0.45 : 1);
  }

  orderDepth(d, crash = false) {
    this.orderedDepth = clamp(d, DEPTH.surface, DEPTH.max);
    this.crash = crash;
    this.blowing = false;
  }

  blow() {
    if (this.air < 99) { G.hud.feed('NO COMPRESSED AIR — SURFACE TO RECHARGE', 'bad'); return; }
    this.air = 0;
    this.blowing = true;
    this.crash = false;
    this.orderedDepth = DEPTH.surface;
    this.noiseSpike += 500;
    G.hud.feed('BLOW ALL BALLAST!', 'gold');
    G.audio.decoy();
  }

  update(dt, k) {
    // --- propulsion ---
    this.diesel = this.depth < 3.2 && this.systems.diesel <= 0;
    const tv = TELEGRAPH[this.tele].v;
    const target = tv * this.maxSpeed * (tv < 0 ? 0.6 : 1);
    const acc = this.diesel ? 0.55 : 0.4;
    this.speed += clamp(target - this.speed, -0.8 * dt, acc * dt);
    this.throttle = tv;

    if (this.diesel) this.battery = Math.min(100, this.battery + 0.32 * dt);
    else {
      const f = Math.abs(this.speed) / ELECTRIC_MAX;
      this.battery = Math.max(0, this.battery - (0.01 + 0.3 * f * f) * dt);
    }
    if (this.surfaced) this.air = Math.min(100, this.air + 1.6 * dt);

    // --- steering ---
    const turnIn = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    const rate = 0.045 + 0.021 * Math.abs(this.speed);
    this.yaw += turnIn * rate * dt * (this.speed < -0.2 ? -1 : 1);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // --- depth keeping ---
    if (k.up) this.orderDepth(this.orderedDepth - 9 * dt);
    if (k.down) this.orderDepth(this.orderedDepth + 9 * dt);
    const err = this.orderedDepth - this.depth;
    const rateMax = this.blowing ? 7 : this.crash ? 5.5 : 1.4 + Math.abs(this.speed) * 0.3;
    let wantVz = clamp(err * 0.35, -rateMax, rateMax);
    const heavy = Math.max(0, this.water - 25) * 0.035; // flooding drags the boat down
    if (!this.blowing) wantVz += heavy;
    this.vz += clamp(wantVz - this.vz, -2.2 * dt, 2.2 * dt);
    let depth = this.depth + this.vz * dt;
    if (this.blowing && depth < DEPTH.surface + 0.5) this.blowing = false;
    if (this.crash && Math.abs(err) < 3) this.crash = false;
    depth = Math.max(DEPTH.surface, depth);
    if (depth <= DEPTH.surface + 0.01 && this.vz < 0) this.vz = 0;
    this.pos.y = -depth;
    if (this.surfaced) this.pos.y += Math.sin(G.time * 0.9) * 0.25;

    // --- movement & terrain ---
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.forward, this.speed * dt);
    const dir = Math.sign(this.speed) || 1;
    const gBow = heightAt(this.pos.x + this.forward.x * 13 * dir, this.pos.z + this.forward.z * 13 * dir);
    this.scrapeCd -= dt;
    if (gBow > this.pos.y - 3.2) {
      this.pos.x = px; this.pos.z = pz;
      if (Math.abs(this.speed) > 1.5 && this.scrapeCd <= 0) {
        this.scrapeCd = 1.2;
        this.damage(3 + Math.abs(this.speed) * 1.5, 'ground');
        G.hud.feed(gBow > -1 ? 'RUN AGROUND!' : 'HULL SCRAPING BOTTOM!', 'bad');
      }
      this.speed *= -0.2;
    }
    const ground = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 3.5) {
      this.pos.y = ground + 3.5;
      if (this.vz > 1.5 && this.scrapeCd <= 0) { this.scrapeCd = 1; this.damage(2 + this.vz * 2, 'ground'); }
      this.vz = Math.min(this.vz, 0);
      if (this.orderedDepth > -this.pos.y) this.orderedDepth = -this.pos.y;
    }
    const cx = this.pos.x - W.center.x, cz = this.pos.z - W.center.z;
    const r = Math.hypot(cx, cz);
    this.outside = r > W.radius;
    if (r > W.radius + 150) {
      const s = (W.radius + 150) / r;
      this.pos.x = W.center.x + cx * s;
      this.pos.z = W.center.z + cz * s;
    }
    this.vel.copy(this.forward).multiplyScalar(this.speed);

    // --- pressure hull ---
    const dNow = this.depth;
    if (dNow > DEPTH.test) {
      const over = (dNow - DEPTH.test) / (DEPTH.crush - DEPTH.test);
      this.creakT -= dt;
      if (this.creakT <= 0) { G.audio.creak(); this.creakT = rand(1.5, 3) / (1 + over * 2); }
      this.hpLoss(dt * (dNow > DEPTH.crush ? 18 : over * 1.2));
    }

    // --- flooding & repairs ---
    for (let i = this.leaks.length - 1; i >= 0; i--) {
      this.leaks[i] -= dt;
      if (this.leaks[i] <= 0) { this.leaks.splice(i, 1); G.hud.feed('LEAK SEALED', 'good'); }
    }
    this.pumping = this.water > 0 && this.leaks.length === 0;
    this.water = clamp(this.water + this.leaks.length * 1.3 * dt * (1 + dNow / 150) - (this.pumping ? 0.9 * dt : 0), 0, 100);
    if (this.water >= 100) this.hpLoss(dt * 4);
    for (const s of Object.keys(this.systems)) {
      if (this.systems[s] > 0) {
        this.systems[s] -= dt;
        if (this.systems[s] <= 0) { this.systems[s] = 0; G.hud.feed(`${SYSTEM_NAMES[s]} REPAIRED`, 'good'); }
      }
    }

    // --- reloads ---
    if (this.systems.tubes <= 0) {
      for (const bank of [this.bow, this.stern]) {
        const tube = bank.find((t) => !t.loaded);
        if (tube && this.reserve > 0) {
          tube.t += dt;
          if (tube.t >= this.reloadTime) {
            tube.loaded = true; tube.t = 0; this.reserve--;
            G.hud.feed(`${bank === this.bow ? 'BOW' : 'STERN'} TUBE RELOADED`, 'good');
          }
        }
      }
    }
    this.gunCd = Math.max(0, this.gunCd - dt);
    this.decoyCd = Math.max(0, this.decoyCd - dt);

    // --- noise signature ---
    this.noiseSpike = Math.max(0, this.noiseSpike - dt * 120);
    const sp = Math.abs(this.speed);
    this.noise = this.diesel ? 700 + sp * 25 : 25 + sp * 34 + (this.pumping ? 45 : 0) + (this.crash || this.blowing ? 160 : 0) + Math.abs(this.vz) * 6;
    this.noise += this.noiseSpike;

    this.visuals(dt);
  }

  visuals(dt) {
    const ud = this.mesh.userData;
    this.mesh.rotation.set(clamp(this.vz * 0.04, -0.3, 0.3), this.yaw, Math.sin(G.time * 0.7) * (this.surfaced ? 0.03 : 0.005));
    ud.prop.rotation.z += this.speed * dt * 2;
    // periscope mast
    const tipY = 2.0;
    const len = tipY - (this.pos.y + 7.2);
    const showMast = this.scopeUp && len > 0.3 && len < 12;
    ud.mast.visible = showMast;
    ud.head.visible = showMast;
    if (showMast) {
      ud.mast.scale.y = len;
      ud.head.position.set(0, 7.2 + len, 4.2);
      if (Math.abs(this.speed) > 0.8 && Math.random() < Math.abs(this.speed) * dt * 3) {
        _v.set(0, 0, 4.2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos);
        G.fx.foam.emit(_v.x, 0.3, _v.z, rand(-0.5, 0.5), 0, rand(-0.5, 0.5), rand(2, 4), rand(1, 2.5));
      }
    }
    // wake
    this.wakeAcc += Math.abs(this.speed) * dt * 1.6;
    while (this.wakeAcc >= 1) {
      this.wakeAcc -= 1;
      const sx = this.pos.x - this.forward.x * 13, sz = this.pos.z - this.forward.z * 13;
      if (this.surfaced) {
        G.fx.foam.emit(sx + rand(-1.5, 1.5), 0.3, sz + rand(-1.5, 1.5), rand(-1, 1), 0, rand(-1, 1), rand(4, 8), rand(2, 4));
        const bx = this.pos.x + this.forward.x * 12, bz = this.pos.z + this.forward.z * 12;
        G.fx.foam.emit(bx, 0.3, bz, -this.forward.z * rand(1, 3), 0, this.forward.x * rand(1, 3), rand(2, 4), rand(1.5, 3));
      } else {
        G.fx.bubbles.emit(sx + rand(-1, 1), this.pos.y + rand(-1, 1), sz + rand(-1, 1), rand(-0.5, 0.5), rand(0, 0.6), rand(-0.5, 0.5), rand(1.2, 2.5), rand(0.5, 1));
      }
    }
  }

  hpLoss(x) {
    if (!this.alive) return;
    this.hp -= x;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; G.onPlayerDeath(); }
  }

  damage(amount, cause = 'blast') {
    if (!this.alive || G.state !== 'playing') return;
    this.hp -= amount;
    G.hud.damageFlash(amount);
    G.shake += amount * 0.04;
    G.audio.clang(Math.min(1, 0.3 + amount / 30));
    if (W.interrupt) W.interrupt();
    W.dangerT = Math.max(W.dangerT, 25);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      G.onPlayerDeath(cause);
      return;
    }
    if (cause !== 'shell' && amount >= 10 && Math.random() < amount / 35) {
      this.leaks.push(rand(18, 40));
      G.hud.feed(this.leaks.length > 1 ? 'MULTIPLE LEAKS — FLOODING!' : 'FLOODING! DAMAGE CONTROL!', 'bad');
    }
    if (amount >= 14 && Math.random() < 0.4) {
      const keys = Object.keys(this.systems);
      const s = keys[Math.floor(Math.random() * keys.length)];
      this.systems[s] = Math.max(this.systems[s], rand(30, 70));
      G.hud.feed(`${SYSTEM_NAMES[s]} DAMAGED`, 'bad');
    }
    if (amount > 15) setTimeout(() => G.audio.creak(), 400);
  }

  /** Take a loaded tube from 'bow' or 'stern'. Returns true if one was available. */
  takeTube(section) {
    const bank = section === 'bow' ? this.bow : this.stern;
    const t = bank.find((x) => x.loaded);
    if (!t) return false;
    t.loaded = false;
    t.t = 0;
    return true;
  }

  loadedTubes(section) {
    return (section === 'bow' ? this.bow : this.stern).filter((t) => t.loaded).length;
  }
}
