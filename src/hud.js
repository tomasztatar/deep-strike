// DOM-based HUD: readouts, sonar display, target lock, contact markers, popups.
import * as THREE from 'three';
import { G } from './state.js';
import { heightAt } from './world.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

/** Is this enemy currently a sonar contact (visible on radar/markers)? */
export function isContact(e, d) {
  if (G.pingReveal > 0 || d < 170) return true;
  if (e.type === 'destroyer') return d < 650;
  if (e.type === 'sub') return d < 260 + e.speed * 12;
  if (e.type === 'mine') return d < 90;
  return false;
}

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'score', 'combo', 'wave', 'hostiles', 'status', 'heading', 'feed', 'banner', 'bannerTitle', 'bannerSub',
      'warning', 'warnDist', 'chargeWarn', 'edgeWarn', 'crosshair', 'lock', 'lockinfo', 'markers', 'popups', 'hullbar', 'hulltxt',
      'boostbar', 'noisebar', 'noisetxt', 'throtmark', 'speed', 'depth', 'keel', 'torps', 'tubebar', 'decoys', 'decoybar',
      'pingtxt', 'pingbar', 'radar', 'dmgflash', 'vignette']) this.el[id] = $(id);
    this.radar = this.el.radar.getContext('2d');
    this.flash = 0;
    this.bannerT = 0;
    this.hitT = 0;
    this.markerPool = [];
    this.pops = [];
    this.cache = {};
    this.sweep = 0;
  }

  set(id, text) {
    if (this.cache[id] !== text) { this.cache[id] = text; this.el[id].textContent = text; }
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  feed(text, cls = 'kill') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
    setTimeout(() => d.remove(), 3200);
  }

  banner(title, sub = '', dur = 3) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('show');
    this.bannerT = dur;
  }

  damageFlash(amount) { this.flash = Math.min(1, this.flash + 0.25 + amount / 40); }

  hitMarker() { this.hitT = 0.25; }

  popup(worldPos, text, color = '#fff') {
    const d = document.createElement('div');
    d.className = 'pop';
    d.textContent = text;
    d.style.color = color;
    this.el.popups.appendChild(d);
    this.pops.push({ d, pos: worldPos.clone(), t: 0 });
  }

  clear() {
    this.el.feed.replaceChildren();
    this.el.popups.replaceChildren();
    this.pops.length = 0;
    this.el.banner.classList.remove('show');
    this.flash = 0;
  }

  project(pos) {
    _p.copy(pos).project(G.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight };
  }

  update(dt) {
    const P = G.player;
    const el = this.el;

    this.set('score', G.score.toLocaleString());
    this.set('combo', G.combo > 1 && G.comboTimer > 0 ? `COMBO x${G.combo}` : '');
    this.set('wave', String(G.wave));
    const hostiles = G.enemies.filter((e) => e.alive && e.type !== 'mine');
    this.set('hostiles', String(hostiles.length));
    const hunting = hostiles.filter((e) => e.state === 'attack').length;
    this.set('status', hunting ? `DETECTED · ${hunting} HUNTING` : 'UNDETECTED');
    el.status.className = hunting ? 'bad' : 'ok';

    const hdg = Math.round(((((-P.yaw * 180) / Math.PI) % 360) + 360) % 360);
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8];
    this.set('heading', `${String(hdg).padStart(3, '0')}° ${card}`);

    const hp = P.hp / P.maxHp;
    el.hullbar.style.width = `${hp * 100}%`;
    el.hullbar.className = `fill ${hp < 0.3 ? 'red' : hp < 0.6 ? 'amber' : 'green'}`;
    this.set('hulltxt', `${Math.ceil(P.hp)}%`);
    el.boostbar.style.width = `${P.boost}%`;
    const n = Math.min(1, P.noise / 600);
    el.noisebar.style.width = `${n * 100}%`;
    el.noisebar.className = `fill ${n > 0.55 ? 'red' : n > 0.3 ? 'amber' : 'green'}`;
    this.set('noisetxt', n > 0.7 ? 'DEAFENING' : n > 0.45 ? 'LOUD' : n > 0.22 ? 'AUDIBLE' : 'SILENT');
    el.throtmark.style.left = `${((P.throttle + 0.3) / 1.3) * 100}%`;
    this.set('speed', `${Math.round(P.speed * 1.6)} kn`);
    this.set('depth', String(Math.round(-P.pos.y)));
    this.set('keel', String(Math.max(0, Math.round(P.pos.y - heightAt(P.pos.x, P.pos.z) - 3))));

    this.set('torps', String(P.torps));
    el.tubebar.style.width = `${(1 - P.tubeCd / P.tubeReload) * 100}%`;
    this.set('decoys', String(P.decoys));
    el.decoybar.style.width = `${P.decoys >= P.maxDecoys ? 100 : (P.decoyRegen / P.decoyRegenTime) * 100}%`;
    this.set('pingtxt', P.pingCd > 0 ? `${Math.ceil(P.pingCd)}s` : 'READY');
    el.pingbar.style.width = `${(1 - P.pingCd / P.pingReload) * 100}%`;

    // Warnings
    let nearest = Infinity;
    for (const t of G.incoming) nearest = Math.min(nearest, t.pos.distanceTo(P.pos));
    el.warning.style.display = G.incoming.length && P.alive ? 'block' : 'none';
    this.set('warnDist', Number.isFinite(nearest) ? `${Math.round(nearest)}m` : '');
    const chargeNear = G.charges.some((c) => Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) < 60);
    el.chargeWarn.style.display = chargeNear && P.alive ? 'block' : 'none';
    el.edgeWarn.style.display = P.outside && P.alive ? 'block' : 'none';

    // Banner / flashes
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) el.banner.classList.remove('show');
    }
    this.flash = Math.max(0, this.flash - dt * 1.6);
    el.dmgflash.style.opacity = String(Math.max(this.flash, hp < 0.3 && P.alive ? 0.25 + 0.2 * Math.sin(G.time * 6) : 0));
    this.hitT -= dt;
    el.crosshair.classList.toggle('hit', this.hitT > 0);

    // Lock bracket
    const L = G.lockTarget;
    const lp = L && L.alive ? this.project(L.pos) : null;
    if (lp) {
      el.lock.style.display = 'block';
      el.lock.style.left = `${lp.x}px`;
      el.lock.style.top = `${lp.y}px`;
      el.lock.classList.toggle('hard', G.hardLock);
      const d = Math.round(L.pos.distanceTo(P.pos));
      const dy = Math.round(L.pos.y - P.pos.y);
      this.set('lockinfo', `${L.label} ${d}m ${dy > 3 ? '▲' : dy < -3 ? '▼' : ''}${Math.abs(dy) > 3 ? Math.abs(dy) : ''}`);
    } else el.lock.style.display = 'none';

    // Contact markers
    let mi = 0;
    for (const e of G.enemies) {
      if (!e.alive || e === L) continue;
      const d = e.pos.distanceTo(P.pos);
      if (!isContact(e, d)) continue;
      const sp = this.project(e.pos);
      if (!sp || sp.x < 0 || sp.y < 0 || sp.x > innerWidth || sp.y > innerHeight) continue;
      let m = this.markerPool[mi];
      if (!m) {
        m = document.createElement('div');
        m.appendChild(document.createElement('span'));
        el.markers.appendChild(m);
        this.markerPool.push(m);
      }
      m.className = `mk ${e.type === 'mine' ? 'mine' : e.type === 'destroyer' ? 'ship' : ''}`;
      m.style.display = 'block';
      m.style.left = `${sp.x}px`;
      m.style.top = `${sp.y}px`;
      m.firstChild.textContent = `${Math.round(d)}m`;
      mi++;
    }
    for (; mi < this.markerPool.length; mi++) this.markerPool[mi].style.display = 'none';

    // Score popups
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      p.pos.y += dt * 4;
      const sp = this.project(p.pos);
      if (sp) {
        p.d.style.left = `${sp.x}px`;
        p.d.style.top = `${sp.y - p.t * 30}px`;
        p.d.style.display = 'block';
      } else p.d.style.display = 'none';
      p.d.style.opacity = String(Math.max(0, 1 - Math.max(0, p.t - 0.8) / 0.6));
      if (p.t > 1.4) { p.d.remove(); this.pops.splice(i, 1); }
    }

    this.drawRadar(dt);
  }

  drawRadar(dt) {
    const ctx = this.radar, W = this.el.radar.width, C = W / 2, R = C - 6, RANGE = 600, S = R / RANGE;
    const P = G.player;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'rgba(109,255,158,0.25)';
    ctx.lineWidth = 1;
    for (const r of [150, 300, 450]) {
      ctx.beginPath();
      ctx.arc(C, C, r * S, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(C, C - R); ctx.lineTo(C, C + R);
    ctx.moveTo(C - R, C); ctx.lineTo(C + R, C);
    ctx.stroke();

    // Operations boundary
    const toScreen = (x, z) => {
      const dx = x - P.pos.x, dz = z - P.pos.z;
      const f = dx * sy + dz * cy, r = -dx * cy + dz * sy;
      return [C + r * S, C - f * S];
    };
    ctx.strokeStyle = 'rgba(255,194,58,0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const [x, y] = toScreen(Math.cos(a) * 640, Math.sin(a) * 640);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Sweep
    this.sweep = (this.sweep + dt * 2.2) % (Math.PI * 2);
    const grd = ctx.createConicGradient ? ctx.createConicGradient(this.sweep - Math.PI / 2 - 0.6, C, C) : null;
    if (grd) {
      grd.addColorStop(0, 'rgba(109,255,158,0)');
      grd.addColorStop(0.095, 'rgba(109,255,158,0.22)');
      grd.addColorStop(0.1, 'rgba(109,255,158,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, W);
    }

    const dot = (x, z, color, size, shape = 'circle') => {
      const [px, py] = toScreen(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (shape === 'square') ctx.rect(px - size, py - size, size * 2, size * 2);
      else if (shape === 'diamond') { ctx.moveTo(px, py - size); ctx.lineTo(px + size, py); ctx.lineTo(px, py + size); ctx.lineTo(px - size, py); ctx.closePath(); }
      else ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const p of G.pickups) if (p.alive && p.pos.distanceTo(P.pos) < 400) dot(p.pos.x, p.pos.z, '#6dff9e', 3, 'square');
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(P.pos);
      if (!isContact(e, d)) continue;
      const pulse = 0.65 + 0.35 * Math.sin(G.time * 6);
      if (e.type === 'mine') dot(e.pos.x, e.pos.z, `rgba(255,194,58,${pulse})`, 2.5);
      else if (e.type === 'destroyer') dot(e.pos.x, e.pos.z, `rgba(255,154,106,${pulse})`, 5, 'square');
      else dot(e.pos.x, e.pos.z, `rgba(255,75,58,${pulse})`, e.heavy ? 5.5 : 4.5, 'diamond');
      if (e === G.lockTarget) {
        const [px, py] = toScreen(e.pos.x, e.pos.z);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(px - 7, py - 7, 14, 14);
      }
    }
    for (const t of G.torpedoes) {
      if (!t.alive || t.pos.distanceTo(P.pos) > 400) continue;
      dot(t.pos.x, t.pos.z, t.isPlayer ? '#7ef0ff' : (Math.sin(G.time * 20) > 0 ? '#ff2a1a' : '#ffffff'), t.isPlayer ? 2 : 3);
    }
    for (const c of G.charges) if (c.alive) dot(c.pos.x, c.pos.z, '#ffc23a', 2);
    for (const d of G.decoys) if (d.alive) dot(d.pos.x, d.pos.z, d.owner === 'player' ? '#ffd23a' : '#ff7a3a', 2.5);
    ctx.restore();

    // Own boat
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(C, C - 7); ctx.lineTo(C + 5, C + 6); ctx.lineTo(C, C + 3); ctx.lineTo(C - 5, C + 6);
    ctx.closePath();
    ctx.fill();
    // Noise circle (how far enemies can hear you)
    ctx.strokeStyle = 'rgba(255,194,58,0.5)';
    ctx.beginPath();
    ctx.arc(C, C, Math.min(R, P.noise * S), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(109,255,158,0.8)';
    ctx.font = '10px monospace';
    ctx.fillText('SONAR 600m', 8, W - 8);
    if (G.pingReveal > 0) { ctx.fillStyle = '#7ef0ff'; ctx.fillText('ACTIVE', W - 50, W - 8); }
  }
}
