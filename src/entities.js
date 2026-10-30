// Game entities: player boat, enemy subs, destroyers, mines, torpedoes, depth charges, decoys, pickups, wrecks.
import * as THREE from 'three';
import { G } from './state.js';
import { heightAt, ARENA_R } from './world.js';
import * as M from './models.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;
export function angleWrap(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
const turnToward = (cur, target, step) => cur + clamp(angleWrap(target - cur), -step, step);
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Distance-attenuated volume relative to the player. */
export function volAt(pos, range = 800) {
  if (!G.player) return 1;
  const k = clamp(1 - pos.distanceTo(G.player.pos) / range, 0, 1);
  return k * k;
}

const _a = new THREE.Vector3();

function emitWake(pos, fwd, back, count, spread, size, upV = 0.8) {
  for (let i = 0; i < count; i++) {
    G.fx.bubbles.emit(
      pos.x - fwd.x * back + rand(-spread, spread),
      pos.y - fwd.y * back + rand(-spread, spread),
      pos.z - fwd.z * back + rand(-spread, spread),
      rand(-0.6, 0.6), rand(0, upV), rand(-0.6, 0.6),
      rand(1.2, 2.8), size * rand(0.6, 1.3),
    );
  }
}

// ============================================================ PLAYER
export class Player {
  constructor() {
    this.mesh = M.makeSub({ hull: 0x2e3a45, accent: 0xffc23a, player: true });
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.set(0, -60, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.yaw = 0;
    this.speed = 0;
    this.vy = 0;
    this.roll = 0;
    this.throttle = 0.35;
    this.hp = 100; this.maxHp = 100;
    this.torps = 12; this.maxTorps = 16; this.tubeCd = 0; this.tubeReload = 1.1; this.tubeSide = 1;
    this.decoys = 3; this.maxDecoys = 4; this.decoyRegen = 0; this.decoyRegenTime = 22; this.decoyCd = 0;
    this.pingCd = 0; this.pingReload = 9;
    this.boost = 100; this.boosting = false;
    this.noise = 0; this.noiseSpike = 0;
    this.alive = true;
    this.radius = 4;
    this.scrapeCd = 0;
    this.wakeAcc = 0;
    this.outside = false;
  }

  update(dt, k) {
    if (k.throttleUp) this.throttle = Math.min(1, this.throttle + dt * 0.6);
    if (k.throttleDown) this.throttle = Math.max(-0.3, this.throttle - dt * 0.6);

    this.boosting = k.boost && this.boost > 1;
    if (this.boosting) this.boost = Math.max(0, this.boost - 26 * dt);
    else this.boost = Math.min(100, this.boost + 11 * dt);

    const target = this.boosting ? 38 : this.throttle * 22;
    const acc = this.boosting ? 15 : 6;
    this.speed += clamp(target - this.speed, -acc * dt, acc * dt);

    const turnIn = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    const turnRate = 0.95 * (0.45 + 0.55 * Math.min(1, Math.abs(this.speed) / 12));
    this.yaw += turnIn * turnRate * dt;
    this.roll += (turnIn * 0.35 * Math.min(1, Math.abs(this.speed) / 15) - this.roll) * Math.min(1, dt * 3);

    const vIn = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    this.vy += clamp(vIn * 10 - this.vy, -14 * dt, 14 * dt);

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.pos.y += this.vy * dt;
    if (this.pos.y > -4) { this.pos.y = -4; if (this.vy > 0) this.vy = 0; }

    // Terrain: block against steep walls, slide over gentle slopes
    const dir = Math.sign(this.speed) || 1;
    const gBow = heightAt(this.pos.x + this.forward.x * 6 * dir, this.pos.z + this.forward.z * 6 * dir);
    const ground = heightAt(this.pos.x, this.pos.z);
    this.scrapeCd -= dt;
    if (gBow + 3 > this.pos.y + 2.5) {
      this.pos.x = px; this.pos.z = pz;
      if (Math.abs(this.speed) > 5 && this.scrapeCd <= 0) this.collide(4 + Math.abs(this.speed) * 0.6);
      this.speed *= -0.25;
    }
    const minY = Math.max(ground, gBow) + 3;
    if (this.pos.y < minY) {
      this.pos.y = minY;
      if (this.vy < -3 && this.scrapeCd <= 0) this.collide(3 + Math.abs(this.vy));
      if (this.vy < 0) this.vy = 0;
    }

    // Operations area boundary
    const r = Math.hypot(this.pos.x, this.pos.z);
    this.outside = r > ARENA_R + 20;
    if (r > ARENA_R + 70) {
      const s = (ARENA_R + 70) / r;
      this.pos.x *= s; this.pos.z *= s;
    }

    // Noise model: speed and boost are loud, launches/pings spike it
    this.noiseSpike = Math.max(0, this.noiseSpike - dt * 160);
    this.noise = 50 + Math.abs(this.speed) * 9 + (this.boosting ? 220 : 0) + this.noiseSpike;

    // Cooldowns
    this.tubeCd = Math.max(0, this.tubeCd - dt);
    this.decoyCd = Math.max(0, this.decoyCd - dt);
    this.pingCd = Math.max(0, this.pingCd - dt);
    if (this.decoys < this.maxDecoys) {
      this.decoyRegen += dt;
      if (this.decoyRegen >= this.decoyRegenTime) { this.decoyRegen = 0; this.decoys++; }
    } else this.decoyRegen = 0;

    // Visuals
    this.mesh.rotation.set(-clamp(this.vy * 0.045, -0.35, 0.35), this.yaw, -this.roll);
    this.mesh.userData.prop.rotation.z += this.speed * dt * 1.4;
    this.wakeAcc += Math.abs(this.speed) * dt * (this.boosting ? 2.2 : 0.9);
    if (this.wakeAcc >= 1) {
      const n = Math.floor(this.wakeAcc);
      this.wakeAcc -= n;
      emitWake(this.pos, this.forward, 7.2, n, 0.8, this.boosting ? 0.9 : 0.6);
    }
  }

  collide(dmg) {
    this.scrapeCd = 0.7;
    this.damage(dmg);
    G.shake += 0.5;
  }

  fire() {
    if (!this.alive || this.tubeCd > 0) return false;
    if (this.torps <= 0) {
      if (this.tubeCd <= 0) { G.audio.beep(220, 0.12, 0.08); this.tubeCd = 0.4; }
      return false;
    }
    this.torps--;
    this.tubeCd = this.tubeReload;
    this.tubeSide *= -1;
    const right = _a.set(-this.forward.z, 0, this.forward.x);
    const p = this.pos.clone().addScaledVector(this.forward, 7).addScaledVector(right, this.tubeSide * 1.1);
    p.y -= 0.6;
    const dir = this.forward.clone();
    dir.y = clamp(this.vy * 0.03, -0.3, 0.3);
    G.torpedoes.push(new Torpedo('player', p, dir, G.lockTarget, this));
    this.noiseSpike += 200;
    G.stats.fired++;
    G.shake += 0.15;
    G.audio.launch(1);
    return true;
  }

  dropDecoy() {
    if (!this.alive || this.decoys <= 0 || this.decoyCd > 0) return;
    this.decoys--;
    this.decoyCd = 1.2;
    const p = this.pos.clone().addScaledVector(this.forward, -8);
    const v = this.forward.clone().multiplyScalar(-6 + this.speed * 0.3);
    v.y = 1;
    G.decoys.push(new Decoy('player', p, v));
    G.audio.decoy();
    G.hud.feed('DECOY AWAY', 'gold');
  }

  ping() {
    if (!this.alive || this.pingCd > 0) return;
    this.pingCd = this.pingReload;
    G.pingReveal = 6;
    this.noiseSpike += 650;
    G.audio.ping(1);
    G.fx.pingWave(this.pos);
    for (const e of G.enemies) if (e.alive && e.alert && e.pos.distanceTo(this.pos) < 650) e.alert(this.pos);
    G.hud.feed('ACTIVE PING — POSITION REVEALED', 'bad');
  }

  damage(amount) {
    if (!this.alive || G.state !== 'playing') return;
    this.hp -= amount;
    G.waveDamage += amount;
    G.hud.damageFlash(amount);
    G.shake += amount * 0.035;
    G.audio.clang(Math.min(1, 0.3 + amount / 30));
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      G.onPlayerDeath();
    } else if (amount > 15) setTimeout(() => G.audio.creak(), 400);
  }
}

// ============================================================ TORPEDO
export class Torpedo {
  constructor(owner, pos, dir, target, shooter) {
    this.owner = owner;
    this.isPlayer = owner === 'player';
    this.shooter = shooter;
    this.mesh = M.makeTorpedo(this.isPlayer);
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.dir = dir.clone().normalize();
    this.target = target && target.alive ? target : null;
    this.speed = this.isPlayer ? 16 : 10;
    this.maxSpeed = this.isPlayer ? 50 : 28 + Math.min(6, G.wave * 0.5);
    this.turn = this.isPlayer ? 1.9 : 0.95;
    this.life = this.isPlayer ? 9 : 16;
    this.seekRange = this.isPlayer ? 170 : 240;
    this.dmg = this.isPlayer ? 100 : 30;
    this.age = 0;
    this.retarget = 0;
    this.alive = true;
    this.chasedPlayer = this.target === G.player;
    this.checkedDecoys = new Set();
  }

  candidates() {
    const out = [];
    if (this.isPlayer) {
      for (const e of G.enemies) if (e.alive) out.push(e);
    } else if (G.player.alive) out.push(G.player);
    for (const d of G.decoys) if (d.alive && d.owner !== this.owner) out.push(d);
    return out;
  }

  acquire() {
    let best = null, bestScore = Infinity;
    for (const c of this.candidates()) {
      _a.subVectors(c.pos, this.pos);
      const d = _a.length();
      if (d > this.seekRange || d < 0.01) continue;
      const cos = _a.dot(this.dir) / d;
      if (cos < 0.45) continue;
      let score = d * (2 - cos);
      if (c.isDecoy) score *= 0.45; // decoys are very loud
      if (c.type === 'mine') score *= 2.5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  update(dt) {
    this.age += dt;
    this.speed = Math.min(this.maxSpeed, this.speed + 32 * dt);
    if (this.target && !this.target.alive) this.target = null;

    this.retarget -= dt;
    if (this.retarget <= 0 && this.age > 0.35) {
      this.retarget = 0.3;
      if (this.isPlayer) {
        if (!this.target) this.target = this.acquire();
        else if (!this.target.isDecoy) {
          // Enemy decoys may seduce our fish
          for (const d of G.decoys) {
            if (!d.alive || d.owner === 'player' || this.checkedDecoys.has(d)) continue;
            if (d.pos.distanceTo(this.pos) < 110) {
              this.checkedDecoys.add(d);
              if (Math.random() < 0.5) { this.target = d; break; }
            }
          }
        }
      } else if (!(this.target && this.target.isDecoy)) {
        const b = this.acquire();
        if (b) this.target = b;
        else if (this.target === G.player && this.pos.distanceTo(G.player.pos) > this.seekRange * 1.5) this.target = null;
        if (this.target === G.player) this.chasedPlayer = true;
      }
    }

    if (this.target && this.age > 0.3) {
      _a.subVectors(this.target.pos, this.pos);
      const d = _a.length();
      if (d > 0.01) {
        _a.divideScalar(d);
        const ang = this.dir.angleTo(_a);
        if (ang > 1e-4) this.dir.lerp(_a, Math.min(1, (this.turn * dt) / ang)).normalize();
      }
    } else if (this.isPlayer) {
      this.dir.y *= Math.exp(-dt); // level out when running straight
      this.dir.normalize();
    }

    this.pos.addScaledVector(this.dir, this.speed * dt);
    if (this.pos.y > -1) {
      this.pos.y = -1;
      if (this.dir.y > 0) { this.dir.y = 0; this.dir.normalize(); }
    }
    _a.copy(this.pos).add(this.dir);
    this.mesh.lookAt(_a);
    emitWake(this.pos, this.dir, 2, 2, 0.15, 0.45, 0.3);

    if (this.pos.y < heightAt(this.pos.x, this.pos.z) + 0.8) return this.detonate(null);

    // Collisions
    for (const d of G.decoys) {
      if (d.alive && d.owner !== this.owner && d.pos.distanceTo(this.pos) < 3.5) {
        d.alive = false;
        return this.detonate(null);
      }
    }
    for (const e of G.enemies) {
      if (!e.alive || e === this.shooter) continue;
      if (!this.isPlayer && this.age < 1.5) continue;
      if (e.hitTest(this.pos, 1.0)) return this.detonate(e);
    }
    if (!this.isPlayer && G.player.alive && this.pos.distanceTo(G.player.pos) < G.player.radius + 1.2) {
      return this.detonate(G.player);
    }

    if (this.age > this.life) {
      this.alive = false;
      G.fx.fizzle(this.pos);
      if (this.chasedPlayer && G.player.alive) G.onEvaded(this);
    }
  }

  detonate(hit) {
    this.alive = false;
    G.fx.explosion(this.pos, this.isPlayer ? 1 : 0.85);
    G.audio.explosion(volAt(this.pos, 900));
    G.shake += 1.5 * volAt(this.pos, 250);
    if (hit === G.player) G.player.damage(this.dmg);
    else if (hit) {
      if (this.isPlayer) { G.stats.hits++; G.hud.hitMarker(); }
      hit.hit(this.dmg, this.owner);
    }
    G.blast(this.pos, 14, 22, hit, this.owner);
    if (!hit && this.chasedPlayer && G.player.alive) G.onEvaded(this);
  }
}

// ============================================================ ENEMY BASE
class Enemy {
  constructor() {
    this.isEnemy = true;
    this.alive = true;
    this.flash = 0;
    this.state = 'patrol';
  }
  hitTest(p, r) {
    return p.distanceTo(this.pos) < this.radius + r;
  }
  hit(dmg, src) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 0.25;
    if (this.hp <= 0) this.die(src);
    else if (this.alert && G.player.alive) this.alert(G.player.pos);
  }
  flashUpdate(dt) {
    if (this.flash > 0) {
      this.flash -= dt;
      const m = this.mesh.userData.hullMat;
      if (m) m.emissive.setRGB(Math.max(0, this.flash) * 6, Math.max(0, this.flash) * 1.5, 0);
    }
  }
  sinkAsWreck(big) {
    G.wrecks.push(new Wreck(this.mesh, big));
    this.mesh = null;
  }
}

// ============================================================ ENEMY SUBMARINE
export class EnemySub extends Enemy {
  constructor(pos, heavy = false) {
    super();
    this.type = 'sub';
    this.heavy = heavy;
    this.mesh = M.makeSub({ hull: heavy ? 0x3b2626 : 0x4c3d37, accent: 0xff3b2f, scale: heavy ? 1.35 : 1 });
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.hp = this.maxHp = heavy ? 200 : 100;
    this.radius = heavy ? 7.5 : 5.5;
    this.score = heavy ? 300 : 100;
    this.label = heavy ? 'HUNTER-KILLER' : 'SUB';
    this.yaw = rand(0, TAU);
    this.speed = 6;
    this.vy = 0;
    this.forward = new THREE.Vector3();
    this.wp = new THREE.Vector3();
    this.lastKnown = new THREE.Vector3();
    this.fireCd = rand(2, 5);
    this.decoys = heavy ? 2 : Math.random() < 0.4 ? 1 : 0;
    this.detectTimer = rand(0, 0.25);
    this.lostTimer = 0;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.sens = 1 + G.wave * 0.05;
    this.evadeT = 0;
    this.evadeSide = 1;
    this.wakeAcc = 0;
    this.pickWaypoint();
  }

  pickWaypoint() {
    const a = rand(0, TAU), r = rand(60, ARENA_R - 80);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const g = heightAt(x, z);
    this.wp.set(x, rand(Math.min(g + 30, -20), -20), z);
  }

  alert(p) {
    this.lastKnown.copy(p);
    this.lostTimer = 0;
    if (this.state !== 'attack') {
      this.state = 'attack';
      this.fireCd = Math.max(this.fireCd, rand(1.5, 3));
      G.onDetected(this);
    }
  }

  investigate(p) {
    if (this.state === 'attack') return;
    this.lastKnown.copy(p);
    this.state = 'search';
  }

  update(dt) {
    const P = G.player;
    const dist = this.pos.distanceTo(P.pos);

    this.detectTimer -= dt;
    if (this.detectTimer <= 0) {
      this.detectTimer = 0.25;
      if (P.alive && (dist < P.noise * this.sens || dist < 55)) this.alert(P.pos);
      else if (this.state === 'attack') this.lostTimer += 0.25;
      if (this.state === 'attack' && this.lostTimer > 5) this.state = 'search';
    }

    let threat = null;
    for (const t of G.torpedoes) {
      if (t.alive && t.isPlayer && t.target === this && t.pos.distanceTo(this.pos) < 170) { threat = t; break; }
    }

    let tYaw, tY, tSpeed;
    if (threat) {
      if (this.evadeT <= 0) {
        this.evadeT = 3;
        this.evadeSide = Math.random() < 0.5 ? 1 : -1;
        if (this.decoys > 0 && Math.random() < 0.65) {
          this.decoys--;
          const v = this.forward.clone().multiplyScalar(-5);
          G.decoys.push(new Decoy('enemy', this.pos.clone().addScaledVector(this.forward, -8), v));
          G.audio.decoy();
          G.hud.feed('ENEMY DECOY DETECTED', 'bad');
        }
      }
      tYaw = yawTo(threat.pos, this.pos) + this.evadeSide * 1.0;
      tSpeed = this.heavy ? 18 : 21;
      tY = this.pos.y + this.evadeSide * 20;
    } else if (this.state === 'attack') {
      const yawP = yawTo(this.pos, this.lastKnown);
      const standoff = this.heavy ? 170 : 210;
      if (dist > standoff + 80) tYaw = yawP;
      else if (dist < standoff - 70) tYaw = yawP + Math.PI * 0.75 * this.orbitDir;
      else tYaw = yawP + this.orbitDir * Math.PI * 0.42;
      tSpeed = dist > 300 ? 15 : 11;
      tY = this.lastKnown.y;
      this.fireCd -= dt;
      const angOff = Math.abs(angleWrap(yawP - this.yaw));
      if (this.fireCd <= 0 && dist < 430 && angOff < 1.3 && P.alive && this.lostTimer < 2) {
        this.fire();
        this.fireCd = rand(5, 8) * Math.max(0.45, 1 - G.wave * 0.06) * (this.heavy ? 0.75 : 1);
      }
      if (Math.random() < dt * 0.08) this.orbitDir *= -1;
    } else if (this.state === 'search') {
      tYaw = yawTo(this.pos, this.lastKnown);
      tSpeed = 12;
      tY = this.lastKnown.y;
      if (hdist(this.pos, this.lastKnown) < 30) { this.state = 'patrol'; this.pickWaypoint(); }
    } else {
      tYaw = yawTo(this.pos, this.wp);
      tSpeed = 7;
      tY = this.wp.y;
      if (hdist(this.pos, this.wp) < 25) this.pickWaypoint();
    }
    this.evadeT -= dt;
    this.move(dt, tYaw, tY, tSpeed);
    this.flashUpdate(dt);
  }

  move(dt, tYaw, tY, tSpeed) {
    this.yaw = turnToward(this.yaw, tYaw, (this.heavy ? 0.6 : 0.8) * dt);
    this.speed += clamp(tSpeed - this.speed, -5 * dt, 5 * dt);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ahead = heightAt(this.pos.x + this.forward.x * 40, this.pos.z + this.forward.z * 40);
    const here = heightAt(this.pos.x, this.pos.z);
    tY = clamp(tY, Math.max(ahead, here) + 18, -12);
    this.vy += clamp(clamp((tY - this.pos.y) * 0.5, -7, 7) - this.vy, -6 * dt, 6 * dt);
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.pos.y += this.vy * dt;
    const floor = heightAt(this.pos.x, this.pos.z) + 5;
    if (this.pos.y < floor) this.pos.y = floor;
    if (this.pos.y > -8) this.pos.y = -8;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_R) {
      this.pos.x *= ARENA_R / r;
      this.pos.z *= ARENA_R / r;
      if (this.state === 'patrol') this.pickWaypoint();
    }
    const turnRate = angleWrap(tYaw - this.yaw);
    this.mesh.rotation.set(-clamp(this.vy * 0.05, -0.35, 0.35), this.yaw, -clamp(turnRate, -0.4, 0.4) * 0.6);
    this.mesh.userData.prop.rotation.z += this.speed * dt * 1.4;
    this.wakeAcc += this.speed * dt * 0.7;
    if (this.wakeAcc >= 1) {
      const n = Math.floor(this.wakeAcc);
      this.wakeAcc -= n;
      emitWake(this.pos, this.forward, 7.5 * (this.heavy ? 1.35 : 1), n, 0.8, 0.6);
    }
  }

  fire() {
    const P = G.player;
    const bow = this.pos.clone().addScaledVector(this.forward, 8);
    const dir = _a.subVectors(P.pos, bow).normalize().clone();
    // aim roughly forward, the seeker will do the rest
    dir.lerp(this.forward, 0.4).normalize();
    G.torpedoes.push(new Torpedo('enemy', bow, dir, P, this));
    G.audio.launch(volAt(this.pos, 700) * 0.9);
    G.hud.feed(this.heavy ? 'HUNTER-KILLER LAUNCH!' : 'TORPEDO IN THE WATER!', 'bad');
  }

  die(src) {
    this.alive = false;
    G.fx.explosion(this.pos, this.heavy ? 1.8 : 1.4);
    G.audio.explosion(volAt(this.pos, 1000), true);
    G.shake += 2 * volAt(this.pos, 300);
    G.onEnemyKilled(this, src);
    this.sinkAsWreck(false);
  }
}

// ============================================================ DESTROYER
export class Destroyer extends Enemy {
  constructor(pos) {
    super();
    this.type = 'destroyer';
    this.mesh = M.makeDestroyer();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.set(pos.x, 0.3, pos.z);
    this.hp = this.maxHp = 200;
    this.radius = 6;
    this.score = 350;
    this.label = 'DESTROYER';
    this.yaw = rand(0, TAU);
    this.speed = 8;
    this.forward = new THREE.Vector3();
    this.wp = new THREE.Vector3();
    this.lastKnown = new THREE.Vector3();
    this.dropCd = rand(1, 3);
    this.torpCd = rand(6, 10);
    this.pingT = rand(1, 5);
    this.lostTimer = 0;
    this.sens = 1.1 + G.wave * 0.04;
    this.wakeAcc = 0;
    this.pickWaypoint();
  }

  pickWaypoint() {
    const a = rand(0, TAU), r = rand(80, ARENA_R - 60);
    this.wp.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  alert(p) {
    this.lastKnown.copy(p);
    this.lostTimer = 0;
    if (this.state !== 'attack') { this.state = 'attack'; G.onDetected(this); }
  }
  investigate(p) {
    if (this.state !== 'attack') { this.lastKnown.copy(p); this.state = 'search'; }
  }

  hitTest(p, r) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dx = p.x - this.pos.x, dy = p.y + 1.5, dz = p.z - this.pos.z;
    const t = clamp(dx * fx + dz * fz, -17, 19);
    const cx = dx - fx * t, cz = dz - fz * t;
    return Math.sqrt(cx * cx + cz * cz + dy * dy) < 4.5 + r;
  }

  update(dt) {
    const P = G.player;
    const dist = this.pos.distanceTo(P.pos);

    // Active sonar: periodic ping, detects anything within range
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = this.state === 'attack' ? 4 : 6;
      const v = volAt(this.pos, 900);
      if (v > 0.01) G.audio.enemyPing(v);
      if (dist < 500) G.fx.enemyPingWave(this.pos);
      if (P.alive && dist < 300 + G.wave * 10) this.alert(P.pos);
    }
    if (P.alive && dist < P.noise * this.sens) this.alert(P.pos);
    else if (this.state === 'attack') {
      this.lostTimer += dt;
      if (this.lostTimer > 9) this.state = 'search';
    }

    let target, tSpeed;
    if (this.state === 'attack') {
      // Predict where the sub is heading
      target = _a.copy(this.lastKnown);
      if (this.lostTimer < 1) target.addScaledVector(P.forward, P.speed * 2.5);
      tSpeed = 14;
      const hd = hdist(this.pos, P.pos);
      this.dropCd -= dt;
      if (hd < 40 && this.dropCd <= 0 && P.pos.y < -8 && this.lostTimer < 3) this.dropCharges();
      if (G.wave >= 4) {
        this.torpCd -= dt;
        if (this.torpCd <= 0 && dist < 380 && dist > 80) this.fireTorpedo();
      }
    } else if (this.state === 'search') {
      target = this.lastKnown;
      tSpeed = 11;
      if (hdist(this.pos, this.lastKnown) < 40) { this.state = 'patrol'; this.pickWaypoint(); }
    } else {
      target = this.wp;
      tSpeed = 8;
      if (hdist(this.pos, this.wp) < 40) this.pickWaypoint();
    }

    this.yaw = turnToward(this.yaw, yawTo(this.pos, target), 0.38 * dt);
    this.speed += clamp(tSpeed - this.speed, -3 * dt, 3 * dt);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(this.forward, this.speed * dt);
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_R) {
      this.pos.x *= ARENA_R / r;
      this.pos.z *= ARENA_R / r;
      if (this.state === 'patrol') this.pickWaypoint();
    }
    this.pos.y = 0.3 + Math.sin(G.time * 0.9 + this.yaw) * 0.25;
    this.mesh.rotation.set(Math.sin(G.time * 0.7) * 0.02, this.yaw, Math.sin(G.time * 0.6 + 1) * 0.04);
    this.mesh.userData.radar.rotation.y += dt * 2.5;
    for (const p of this.mesh.userData.props) p.rotation.y += this.speed * dt;

    this.wakeAcc += this.speed * dt * 1.2;
    if (this.wakeAcc >= 1) {
      const n = Math.floor(this.wakeAcc);
      this.wakeAcc -= n;
      const stern = _a.copy(this.pos).addScaledVector(this.forward, -16);
      stern.y = -3;
      emitWake(stern, this.forward, 0, n, 2, 0.9);
    }
    this.flashUpdate(dt);
  }

  dropCharges() {
    const P = G.player;
    this.dropCd = rand(3.5, 5) * Math.max(0.55, 1 - G.wave * 0.04);
    const n = G.wave >= 5 ? 4 : 3;
    const right = new THREE.Vector3(-this.forward.z, 0, this.forward.x);
    for (let i = 0; i < n; i++) {
      const p = this.pos.clone().addScaledVector(this.forward, -14 + rand(-3, 3)).addScaledVector(right, (i - (n - 1) / 2) * 7);
      p.y = -1;
      G.charges.push(new DepthCharge(p, P.pos.y + rand(-7, 7)));
    }
    G.audio.beep(330, 0.06 * volAt(this.pos, 400) + 0.02, 0.2);
    G.hud.feed('DEPTH CHARGES!', 'bad');
  }

  fireTorpedo() {
    const P = G.player;
    this.torpCd = rand(9, 14);
    const p = this.pos.clone();
    p.y = -4;
    const dir = _a.subVectors(P.pos, p).normalize().clone();
    G.torpedoes.push(new Torpedo('enemy', p, dir, P, this));
    G.audio.launch(volAt(this.pos, 700) * 0.8);
    G.hud.feed('ASW TORPEDO LAUNCHED!', 'bad');
  }

  die(src) {
    this.alive = false;
    G.fx.explosion(this.pos, 2.2);
    setTimeout(() => {
      if (G.state === 'playing') {
        G.fx.explosion(_a.copy(this.wreckPos).add(new THREE.Vector3(0, -2, -10)), 1.2);
        G.audio.explosion(volAt(this.wreckPos, 900) * 0.7);
      }
    }, 450);
    this.wreckPos = this.pos.clone();
    G.audio.explosion(volAt(this.pos, 1200), true);
    G.shake += 2.5 * volAt(this.pos, 300);
    G.onEnemyKilled(this, src);
    this.sinkAsWreck(true);
  }
}

// ============================================================ MINE
export class Mine extends Enemy {
  constructor(pos) {
    super();
    this.type = 'mine';
    const g = heightAt(pos.x, pos.z);
    this.mesh = M.makeMine(pos.y - g);
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.baseY = pos.y;
    this.hp = 1;
    this.radius = 2.4;
    this.score = 25;
    this.label = 'MINE';
    this.armT = -1;
    this.phase = rand(0, TAU);
  }
  hit(dmg, src) {
    if (!this.alive) return;
    this.die(src);
  }
  update(dt) {
    this.pos.y = this.baseY + Math.sin(G.time * 0.8 + this.phase) * 0.6;
    const lamp = this.mesh.userData.lamp;
    const P = G.player;
    if (this.armT < 0) {
      lamp.material.opacity = Math.sin(G.time * 3 + this.phase) > 0.6 ? 1 : 0.15;
      if (P.alive && this.pos.distanceTo(P.pos) < 17) {
        this.armT = 0.75;
        G.audio.beep(1500, 0.2, 0.08);
        G.hud.feed('MINE PROXIMITY!', 'bad');
      }
    } else {
      this.armT -= dt;
      lamp.material.opacity = Math.sin(G.time * 40) > 0 ? 1 : 0.2;
      lamp.scale.setScalar(5);
      if (this.armT <= 0) this.die('self');
    }
  }
  die(src) {
    this.alive = false;
    G.fx.explosion(this.pos, 1.1);
    G.audio.explosion(volAt(this.pos, 800));
    G.shake += 1.5 * volAt(this.pos, 200);
    G.onEnemyKilled(this, src);
    G.blast(this.pos, 22, 45, this, src === 'player' ? 'player' : 'mine');
  }
}

// ============================================================ DEPTH CHARGE
export class DepthCharge {
  constructor(pos, targetDepth) {
    this.mesh = M.makeDepthCharge();
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.targetDepth = Math.min(targetDepth, -12);
    this.vy = -3;
    this.spin = new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3));
    this.alive = true;
    for (let i = 0; i < 12; i++) G.fx.bubbles.emit(pos.x, -1, pos.z, rand(-2, 2), rand(-4, -1), rand(-2, 2), rand(0.6, 1.4), rand(0.3, 0.9));
  }
  update(dt) {
    this.vy = Math.max(-13, this.vy - 9 * dt);
    this.pos.y += this.vy * dt;
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
    this.mesh.userData.glow.material.opacity = 0.4 + 0.4 * Math.sin(G.time * 20);
    if (Math.random() < 0.5) G.fx.bubbles.emit(this.pos.x, this.pos.y + 0.8, this.pos.z, 0, 0.5, 0, 1, 0.3);
    const P = G.player;
    if (this.pos.y <= this.targetDepth || (P.alive && this.pos.distanceTo(P.pos) < 7) || this.pos.y < heightAt(this.pos.x, this.pos.z) + 1) {
      this.explode();
    }
  }
  explode() {
    this.alive = false;
    G.fx.explosion(this.pos, 1.3);
    G.audio.explosion(volAt(this.pos, 900), true);
    G.shake += 2.2 * volAt(this.pos, 200);
    G.blast(this.pos, 26, 50, null, 'enemy');
  }
}

// ============================================================ DECOY
export class Decoy {
  constructor(owner, pos, vel) {
    this.owner = owner;
    this.isDecoy = true;
    this.mesh = M.makeDecoy(owner === 'player');
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.vel = vel.clone();
    this.life = 10;
    this.alive = true;
  }
  update(dt) {
    this.life -= dt;
    this.vel.multiplyScalar(Math.exp(-dt * 0.8));
    this.vel.y -= 0.4 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const g = heightAt(this.pos.x, this.pos.z) + 1;
    if (this.pos.y < g) this.pos.y = g;
    if (this.pos.y > -2) this.pos.y = -2;
    this.mesh.rotation.y += dt * 8;
    this.mesh.userData.glow.material.opacity = 0.5 + 0.5 * Math.sin(G.time * 18);
    for (let i = 0; i < 3; i++) G.fx.bubbles.emit(this.pos.x, this.pos.y, this.pos.z, rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5), rand(1, 2), rand(0.2, 0.6));
    if (this.life <= 0) this.alive = false;
  }
}

// ============================================================ PICKUP
const PICKUP_TEXT = { repair: '+30 HULL', ammo: '+4 TORPEDOES', decoy: '+2 DECOYS' };
export class Pickup {
  constructor(pos, kind) {
    this.kind = kind;
    this.mesh = M.makeCrate(kind);
    G.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.baseY = pos.y;
    this.life = 50;
    this.alive = true;
    this.phase = rand(0, TAU);
  }
  update(dt) {
    this.life -= dt;
    this.pos.y = this.baseY + Math.sin(G.time * 1.5 + this.phase) * 1.2;
    this.mesh.rotation.y += dt * 1.2;
    this.mesh.rotation.x += dt * 0.5;
    if (this.life < 8) this.mesh.visible = Math.sin(G.time * 12) > -0.3;
    const P = G.player;
    if (P.alive && this.pos.distanceTo(P.pos) < 8) {
      this.alive = false;
      if (this.kind === 'repair') P.hp = Math.min(P.maxHp, P.hp + 30);
      if (this.kind === 'ammo') P.torps = Math.min(P.maxTorps, P.torps + 4);
      if (this.kind === 'decoy') P.decoys = Math.min(P.maxDecoys + 2, P.decoys + 2);
      P.boost = 100;
      G.audio.pickup();
      G.hud.feed(PICKUP_TEXT[this.kind], 'good');
      G.hud.popup(this.pos, PICKUP_TEXT[this.kind], '#6dff9e');
      G.score += 50;
    }
    if (this.life <= 0) this.alive = false;
  }
}

/** Pick a supply type weighted toward what the player needs. */
export function pickupKind() {
  const P = G.player;
  const w = {
    repair: 1 + (P.hp < 60 ? 2 : 0) + (P.hp < 30 ? 2 : 0),
    ammo: 1 + (P.torps < 6 ? 2 : 0) + (P.torps < 3 ? 2 : 0),
    decoy: 0.6 + (P.decoys === 0 ? 1 : 0),
  };
  let r = Math.random() * (w.repair + w.ammo + w.decoy);
  for (const k of Object.keys(w)) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'ammo';
}

// ============================================================ WRECK
export class Wreck {
  constructor(mesh, big) {
    this.mesh = mesh;
    this.big = big;
    this.alive = true;
    this.t = 0;
    this.vy = -0.5;
    this.spinX = rand(-0.25, 0.25);
    this.spinZ = rand(-0.5, 0.5);
    this.grounded = false;
  }
  update(dt) {
    this.t += dt;
    const p = this.mesh.position;
    if (!this.grounded) {
      this.vy = Math.max(this.big ? -4 : -6, this.vy - 1.5 * dt);
      p.y += this.vy * dt;
      this.mesh.rotation.x += this.spinX * dt;
      this.mesh.rotation.z += this.spinZ * dt;
      const n = this.big ? 4 : 2;
      for (let i = 0; i < n; i++) G.fx.bubbles.emit(p.x + rand(-4, 4), p.y + rand(-1, 2), p.z + rand(-4, 4), rand(-1, 1), rand(1, 4), rand(-1, 1), rand(1.5, 3), rand(0.3, 1.2));
      if (Math.random() < dt * 0.8) G.fx.sparks.emit(p.x, p.y, p.z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 0.5, 4);
      if (p.y < heightAt(p.x, p.z) + 2) { this.grounded = true; G.fx.fizzle(p); }
    }
    if (this.t > 16) this.alive = false;
  }
}
