// WWII mode HUD: boat status, depth gauge, tubes, TDC panel, contact markers, periscope overlay, sonar plot.
import * as THREE from 'three';
import { G } from '../state.js';
import { W } from './wstate.js';
import { coastX, ISLANDS, getProfile, heightAt } from '../world.js';
import { DEPTH, TELEGRAPH, KN } from './uboat.js';
import { solution } from './mode.js';
import { angleWrap } from '../entities.js';

const TEMPLATE = `
<div id="w-scope" class="hidden">
  <div class="mask"></div>
  <div class="ret"><i class="h"></i><i class="v"></i></div>
  <div id="w-scopetape"></div>
  <div id="w-scopeinfo"></div>
</div>
<div id="w-top" class="panel">
  <div class="lbl" id="w-mission"></div>
  <div id="w-tonnage">0 GRT</div>
  <div id="w-objective" class="lbl"></div>
  <div id="w-status" class="ok">UNDETECTED</div>
  <div class="lbl"><span id="w-clock">00:00</span> · TIME <b id="w-time">1x</b></div>
</div>
<div id="w-compass"><span id="w-heading">000°</span></div>
<div id="w-alerts" aria-live="assertive"></div>
<div id="w-markers"></div>
<div id="w-lead">◆<span>AIM</span></div>
<div id="w-boat" class="panel">
  <div class="row"><span class="lbl">ORDER</span><b id="w-tele">AHEAD FULL</b><span id="w-engine" class="tag2">DIESEL</span></div>
  <div class="row"><span class="lbl">SPEED</span><b id="w-speed">0 kn</b><span class="lbl">NOISE</span><div class="bar"><div id="w-noise" class="fill"></div></div></div>
  <div class="row"><span class="lbl">HULL</span><div class="bar"><div id="w-hull" class="fill green"></div></div><span id="w-hulltxt">100%</span></div>
  <div class="row"><span class="lbl">BATTERY</span><div class="bar"><div id="w-batt" class="fill"></div></div><span id="w-batttxt">100%</span></div>
  <div class="row"><span class="lbl">AIR</span><div class="bar"><div id="w-air" class="fill"></div></div><span id="w-airtxt">READY</span></div>
  <div class="row"><span class="lbl">FLOOD</span><div class="bar"><div id="w-water" class="fill red"></div></div><span id="w-watertxt">DRY</span></div>
  <div class="row readout"><span>DEPTH <b id="w-depth">2</b> m</span><span>ORDERED <b id="w-order">2</b> m</span><span>KEEL <b id="w-keel">0</b> m</span></div>
  <div id="w-damage"></div>
</div>
<div id="w-gauge" aria-hidden="true">
  <div class="mk" style="top:5.4%"><span>PERI</span></div>
  <div class="mk layer" style="top:34.6%"><span>LAYER</span></div>
  <div class="mk test" style="top:69.2%"><span>TEST</span></div>
  <div class="mk crush" style="top:88.5%"><span>CRUSH</span></div>
  <div id="w-gfloor"></div>
  <div id="w-gorder"></div>
  <div id="w-gnow"></div>
</div>
<div id="w-weapons" class="panel">
  <div class="wcol"><span class="lbl">BOW TUBES</span><div id="w-bow" class="tubes"></div></div>
  <div class="wcol"><span class="lbl">STERN</span><div id="w-stern" class="tubes"></div></div>
  <div class="wcol"><span class="lbl">RESERVE</span><b id="w-reserve">9</b></div>
  <div class="wcol"><span class="lbl">88mm / FLAK</span><b id="w-gun">0</b></div>
  <div class="wcol"><span class="lbl">DECOYS</span><b id="w-decoys">0</b></div>
</div>
<div id="w-tdc" class="panel">
  <div class="lbl">TARGET DATA COMPUTER · <span id="w-tdcmode">ASSIST</span></div>
  <div id="w-tgt">NO TARGET — Tab</div>
  <div class="grid">
    <span>RANGE</span><b id="w-rng">—</b><span>BEARING</span><b id="w-brg">—</b>
    <span>AOB</span><b id="w-aob">—</b><span>SPEED</span><b id="w-tspd">—</b>
    <span>GYRO</span><b id="w-gyro">—</b><span>RUN</span><b id="w-run">—</b>
  </div>
  <div class="row"><span class="lbl">SOLUTION</span><div class="bar"><div id="w-sol" class="fill amber"></div></div><span id="w-soltxt">0%</span></div>
</div>
<div id="w-hint"></div>
`;

const _p = new THREE.Vector3();
// Compass convention: bearing = −yaw (yaw grows when turning to port)
const deg = (yaw) => ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
const brg = (from, to) => deg(Math.atan2(to.x - from.x, to.z - from.z));
const side = (rel) => (rel >= 0 ? 'PORT' : 'STBD');
const fmtB = (b) => `${String(Math.round(b) % 360).padStart(3, '0')}°`;
const fmtR = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);

export class HUD2 {
  constructor() {
    this.root = document.getElementById('ww2hud');
    this.root.innerHTML = TEMPLATE;
    this.el = {};
    for (const n of this.root.querySelectorAll('[id]')) this.el[n.id.replace('w-', '')] = n;
    this.cache = {};
    this.pool = [];
    this.radar = document.getElementById('radar');
    this.ctx = this.radar.getContext('2d');
    this.sweep = 0;
    this.tubes = { bow: [], stern: [] };
    for (const [bank, n] of [['bow', 4], ['stern', 1]]) {
      for (let i = 0; i < n; i++) {
        const t = document.createElement('div');
        t.className = 'tube';
        const f = document.createElement('i');
        t.appendChild(f);
        this.el[bank].appendChild(t);
        this.tubes[bank].push({ t, f });
      }
    }
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  set(id, text) {
    if (this.cache[id] !== text) { this.cache[id] = text; this.el[id].textContent = text; }
  }

  project(pos) {
    _p.copy(pos).project(G.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight };
  }

  update(dt) {
    const S = G.player, el = this.el, m = W.mission;
    // --- top panel ---
    this.set('mission', `${m.name} · ${m.when}`);
    this.set('tonnage', `${W.tonnage.toLocaleString()} GRT`);
    const o = m.objective;
    this.set('objective', W.objectiveDone ? 'OBJECTIVE ACHIEVED ✓' : o.grt ? `OBJECTIVE: ${o.grt.toLocaleString()} GRT` : `OBJECTIVE: SINK ${o.ships} SHIPS (${W.sunk.length}/${o.ships})`);
    let hunting = 0, firing = 0, searching = 0, planes = 0;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (e.type === 'escort') {
        if (e.state === 'gun') firing++;
        else if ((e.state === 'hunt' || e.state === 'open') && e.contact && W.clock - e.contact.t < 20) hunting++;
        else if (e.state === 'investigate') searching++;
      } else if (e.type === 'plane' && (e.state === 'attack' || e.state === 'pass')) planes++;
    }
    const status = firing ? 'UNDER FIRE!' : planes ? 'AIR ATTACK!' : hunting ? `HUNTED · ${hunting} ESCORT${hunting > 1 ? 'S' : ''}` : searching ? 'ESCORTS SEARCHING' : 'UNDETECTED';
    this.set('status', status);
    el.status.className = firing || planes || hunting ? 'bad' : searching ? 'warn' : 'ok';
    const mins = Math.floor(W.clock / 60), secs = Math.floor(W.clock % 60);
    this.set('clock', `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    this.set('time', `${W.timeScale}x`);
    el.time.className = W.timeScale > 1 ? 'amber' : '';

    const hdg = deg(S.yaw);
    this.set('heading', `HDG ${fmtB(hdg)}`);

    // --- boat panel ---
    this.set('tele', TELEGRAPH[S.tele].name);
    this.set('engine', S.diesel ? 'DIESEL' : S.battery <= 0 ? 'BATTERY FLAT' : Math.abs(S.speed) < 2.6 ? 'E-MOTOR · SILENT' : 'E-MOTOR');
    el.engine.className = `tag2 ${S.diesel ? 'loud' : S.battery <= 0 ? 'loud' : ''}`;
    this.set('speed', `${(Math.abs(S.speed) * KN).toFixed(1)} kn`);
    const n = Math.min(1, S.noise / 800);
    el.noise.style.width = `${Math.max(3, n * 100)}%`;
    el.noise.className = `fill ${S.noise > 400 ? 'red' : S.noise > 150 ? 'amber' : 'green'}`;
    const hp = S.hp / S.maxHp;
    el.hull.style.width = `${hp * 100}%`;
    el.hull.className = `fill ${hp < 0.3 ? 'red' : hp < 0.6 ? 'amber' : 'green'}`;
    this.set('hulltxt', `${Math.ceil(S.hp)}%`);
    el.batt.style.width = `${S.battery}%`;
    el.batt.className = `fill ${S.battery < 15 ? 'red' : S.battery < 35 ? 'amber' : ''}`;
    this.set('batttxt', `${Math.floor(S.battery)}%${S.diesel && S.battery < 100 ? ' ↑' : ''}`);
    el.air.style.width = `${S.air}%`;
    this.set('airtxt', S.air >= 99 ? 'READY (B)' : `${Math.floor(S.air)}%`);
    el.water.style.width = `${S.water}%`;
    this.set('watertxt', S.leaks.length ? `${S.leaks.length} LEAK${S.leaks.length > 1 ? 'S' : ''}` : S.water > 0.5 ? 'PUMPING' : 'DRY');
    this.set('depth', String(Math.round(S.depth)));
    this.set('order', String(Math.round(S.orderedDepth)));
    const keel = Math.max(0, Math.round(S.pos.y - heightAt(S.pos.x, S.pos.z) - 3));
    this.set('keel', keel > 400 ? '—' : String(keel));
    const dmg = Object.entries(S.systems).filter(([, t]) => t > 0).map(([k, t]) => `${k.toUpperCase()} DAMAGED ${Math.ceil(t)}s`);
    this.set('damage', dmg.join(' · '));

    // depth gauge (0..260 m)
    const g = (d) => `${Math.min(100, (d / DEPTH.max) * 100)}%`;
    el.gnow.style.top = g(S.depth);
    el.gorder.style.top = g(S.orderedDepth);
    const floor = -heightAt(S.pos.x, S.pos.z);
    el.gfloor.style.top = g(floor);
    el.gfloor.style.display = floor < DEPTH.max ? 'block' : 'none';

    // --- weapons ---
    for (const bank of ['bow', 'stern']) {
      S[bank].forEach((tb, i) => {
        const ui = this.tubes[bank][i];
        ui.t.className = `tube ${tb.loaded ? 'loaded' : ''}`;
        ui.f.style.height = tb.loaded ? '100%' : `${(tb.t / S.reloadTime) * 100}%`;
      });
    }
    this.set('reserve', String(S.reserve));
    this.set('gun', `${S.gunAmmo} / ${S.flakAmmo}`);
    this.set('decoys', String(S.decoys));

    // --- TDC ---
    this.set('tdcmode', W.tdcAssist ? 'ASSIST (K)' : 'MANUAL (K)');
    const L = W.lock;
    if (L && L.alive) {
      const p = L.visual ? L.pos : L.estPos;
      const d = Math.hypot(p.x - S.pos.x, p.z - S.pos.z);
      const b = brg(S.pos, p);
      this.set('tgt', `${L.label}${L.grt ? ` · ${L.grt.toLocaleString()} GRT` : ''}${L.visual ? '' : L.hydro ? ' · SOUND ONLY' : ' · LOST'}`);
      this.set('rng', fmtR(d));
      const rel = angleWrap(Math.atan2(p.x - S.pos.x, p.z - S.pos.z) - S.yaw);
      this.set('brg', `${fmtB(b)} (${Math.abs(Math.round((rel * 180) / Math.PI))}° ${side(rel)})`);
      const sol = L.type !== 'plane' && L.type !== 'battery' ? solution(L, S.pos) : null;
      if (sol) {
        const aob = angleWrap(Math.atan2(S.pos.x - p.x, S.pos.z - p.z) - sol.estYaw);
        this.set('aob', `${Math.abs(Math.round((aob * 180) / Math.PI))}° ${side(aob)}`);
        this.set('tspd', `${(sol.estSpd * KN).toFixed(1)} kn`);
        const gyro = angleWrap(sol.yaw - S.yaw);
        const g2 = Math.abs(gyro) > 1.75 ? angleWrap(gyro - Math.PI) : gyro;
        this.set('gyro', `${Math.round((g2 * 180) / Math.PI)}°${Math.abs(gyro) > 1.75 ? ' AFT' : ''}`);
        this.set('run', `${Math.round(sol.time)} s${sol.time * 20 > 1900 ? ' (OUT OF RANGE)' : ''}`);
      } else {
        for (const k of ['aob', 'tspd', 'gyro', 'run']) this.set(k, '—');
      }
      const q = L.sol ?? 1;
      el.sol.style.width = `${q * 100}%`;
      el.sol.className = `fill ${q > 0.75 ? 'green' : q > 0.4 ? 'amber' : 'red'}`;
      this.set('soltxt', `${Math.round(q * 100)}%`);
    } else {
      this.set('tgt', 'NO TARGET — Tab to track');
      for (const k of ['rng', 'brg', 'aob', 'tspd', 'gyro', 'run']) this.set(k, '—');
      el.sol.style.width = '0%';
      this.set('soltxt', '—');
    }

    // --- alerts ---
    const alerts = [];
    const enemyTorp = G.torpedoes.find((t) => t.alive && !t.isPlayer && t.pos.distanceTo(S.pos) < 1500);
    if (enemyTorp) alerts.push(['⚠ TORPEDO IN THE WATER ⚠', 'bad']);
    if (G.charges.some((c) => Math.hypot(c.pos.x - S.pos.x, c.pos.z - S.pos.z) < 250)) alerts.push(['▼ DEPTH CHARGES ▼', 'amber']);
    if (planes && S.depth < 25) alerts.push(['✈ AIRCRAFT ATTACKING — DIVE! ✈', 'bad']);
    if (firing) alerts.push(['UNDER FIRE — DIVE (C)', 'bad']);
    if (S.depth > DEPTH.test) alerts.push([S.depth > DEPTH.crush ? 'CRUSH DEPTH!' : 'BELOW TEST DEPTH — HULL STRESS', 'bad']);
    if (S.leaks.length || S.water > 30) alerts.push([`FLOODING ${Math.round(S.water)}%${S.water > 25 ? ' — BOAT GETTING HEAVY' : ''}`, 'bad']);
    if (S.battery < 15 && !S.diesel) alerts.push(['BATTERY LOW — SURFACE TO RECHARGE', 'amber']);
    if (S.outside) alerts.push(['LEAVING PATROL AREA', 'amber']);
    const txt = alerts.slice(0, 3).map((a) => a[0]).join('\n');
    if (this.cache.alerts !== txt) {
      this.cache.alerts = txt;
      el.alerts.replaceChildren(...alerts.slice(0, 3).map(([t, c]) => { const d = document.createElement('div'); d.className = c; d.textContent = t; return d; }));
    }

    // --- periscope overlay ---
    const scope = W.view === 'scope';
    el.scope.classList.toggle('hidden', !scope);
    if (scope) {
      el.scope.classList.toggle('bino', S.surfaced);
      const ab = deg(W.aimYaw);
      const rel = angleWrap(W.aimYaw - S.yaw);
      this.set('scopetape', `${fmtB(ab)}  ·  REL ${Math.abs(Math.round((rel * 180) / Math.PI))}° ${side(rel)}`);
      this.set('scopeinfo', `${S.surfaced ? 'BRIDGE · BINOCULARS' : 'ATTACK PERISCOPE'} · ${W.zoom ? '6x' : '1.5x'} (wheel) · ←/→ train`);
    }

    // --- markers ---
    let mi = 0;
    for (const e of G.enemies) {
      if (!e.alive || e.type === 'mine') continue;
      const current = e.visual || e.hydro;
      if (!current) continue;
      const pos = e.visual ? e.pos : e.estPos;
      _p.set(pos.x, e.type === 'plane' ? pos.y : (e.top || 6) + 4, pos.z);
      const sp = this.project(_p);
      if (!sp || sp.x < -20 || sp.y < -20 || sp.x > innerWidth + 20 || sp.y > innerHeight + 20) continue;
      let mk = this.pool[mi];
      if (!mk) {
        mk = document.createElement('div');
        mk.appendChild(document.createElement('span'));
        el.markers.appendChild(mk);
        this.pool.push(mk);
      }
      const d = Math.hypot(pos.x - S.pos.x, pos.z - S.pos.z);
      mk.className = `wmk ${e.type} ${e.visual ? '' : 'sound'} ${e === L ? 'lock' : ''}`;
      mk.style.display = 'block';
      mk.style.left = `${sp.x}px`;
      mk.style.top = `${sp.y}px`;
      const nearAim = Math.abs(angleWrap(Math.atan2(pos.x - S.pos.x, pos.z - S.pos.z) - W.aimYaw)) < (W.view === 'scope' ? (W.zoom ? 0.05 : 0.16) : 0.06);
      mk.firstChild.textContent = e === L || nearAim || e.type === 'plane' ? `${e.visual ? e.label : '? ' + (e.type === 'escort' ? 'FAST SCREWS' : 'SCREWS')} ${fmtR(d)}` : '';
      mi++;
    }
    for (; mi < this.pool.length; mi++) this.pool[mi].style.display = 'none';
    const sol = W.sol;
    const lp = sol ? this.project(_p.set(sol.point.x, 3, sol.point.z)) : null;
    el.lead.style.display = lp ? 'block' : 'none';
    if (lp) { el.lead.style.left = `${lp.x}px`; el.lead.style.top = `${lp.y}px`; }

    // --- hint ---
    let hint;
    if (S.surfaced) hint = 'W/S telegraph · A/D rudder · V bridge view · C crash dive · 2 periscope depth · G deck gun / flak · T time ×';
    else if (S.depth <= DEPTH.periscope + 3) hint = 'V periscope (raise briefly!) · Tab track target · Space fire · E spread of 3 · 3/4 go deep · 1 surface';
    else hint = 'Slow (AHEAD SLOW) = silent · below 90 m the thermal layer hides you · Q decoy · B emergency blow · 2 periscope depth';
    this.set('hint', hint);

    this.drawSonar(dt);
  }

  drawSonar(dt) {
    const ctx = this.ctx, Wd = this.radar.width, C = Wd / 2, R = C - 6, RANGE = W.sonarRange, K = R / RANGE;
    const S = G.player;
    const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    const toS = (x, z) => {
      const dx = x - S.pos.x, dz = z - S.pos.z;
      const f = dx * sy + dz * cy, r = -dx * cy + dz * sy;
      return [C + r * K, C - f * K];
    };
    ctx.clearRect(0, 0, Wd, Wd);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,18,14,0.35)';
    ctx.fillRect(0, 0, Wd, Wd);

    // land
    if (getProfile() === 'coastal') {
      ctx.fillStyle = 'rgba(160,140,90,0.45)';
      ctx.beginPath();
      let first = true;
      for (let z = -4000; z <= 4000; z += 80) {
        const [x, y] = toS(coastX(z), z);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      let [x, y] = toS(9000, 4000); ctx.lineTo(x, y);
      [x, y] = toS(9000, -4000); ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      for (const isl of ISLANDS) {
        const [ix, iy] = toS(isl.x, isl.z);
        ctx.beginPath();
        ctx.arc(ix, iy, Math.sqrt(isl.r2) * 0.9 * K, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = 'rgba(109,255,158,0.22)';
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.arc(C, C, R * f, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(C, C - R); ctx.lineTo(C, C + R); ctx.moveTo(C - R, C); ctx.lineTo(C + R, C);
    ctx.stroke();

    // patrol area boundary
    ctx.strokeStyle = 'rgba(255,194,58,0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const [x, y] = toS(W.center.x + Math.cos(a) * W.radius, W.center.z + Math.sin(a) * W.radius);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // aim bearing & solution track
    const [ax, ay] = toS(S.pos.x + Math.sin(W.aimYaw) * RANGE * 1.2, S.pos.z + Math.cos(W.aimYaw) * RANGE * 1.2);
    ctx.strokeStyle = 'rgba(126,240,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    if (W.sol) {
      const [x, y] = toS(W.sol.point.x, W.sol.point.z);
      ctx.strokeStyle = 'rgba(255,194,58,0.8)';
      ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
    ctx.setLineDash([]);

    if (W.intel) {
      const [x, y] = toS(W.intel.pos.x, W.intel.pos.z);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '9px monospace';
      ctx.fillText(W.intel.label, x + 16, y + 3);
    }

    for (const f of W.flares) if (f.alive) {
      const [x, y] = toS(f.pos.x, f.pos.z);
      ctx.fillStyle = 'rgba(255,240,180,0.25)';
      ctx.beginPath(); ctx.arc(x, y, 1100 * K, 0, Math.PI * 2); ctx.fill();
    }

    // contacts
    const pulse = 0.65 + 0.35 * Math.sin(G.time * 6);
    for (const e of G.enemies) {
      if (!e.alive) continue;
      if (e.type === 'mine') {
        if (e.visual) { const [x, y] = toS(e.pos.x, e.pos.z); ctx.fillStyle = '#ffc23a'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
        continue;
      }
      if (!e.known) continue;
      const age = W.clock - e.lastSeen;
      if (age > 120) continue;
      const cur = e.visual || e.hydro;
      const p = e.visual ? e.pos : e.estPos;
      const [x, y] = toS(p.x, p.z);
      const a = cur ? 1 : 0.35;
      const col = e.type === 'escort' ? `rgba(255,90,70,${a})` : e.type === 'plane' ? `rgba(255,230,90,${a})` : e.type === 'boat' ? `rgba(220,120,255,${a})` : e.type === 'battery' ? `rgba(255,170,60,${a})` : `rgba(230,240,240,${a})`;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      if (!e.visual && e.hydro) {
        // sound-only: fuzzy blob + faint bearing line
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, 5 * pulse + 2, 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'plane') {
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
      } else if (e.type === 'escort') {
        // triangle pointing along the escort's heading
        const u = 7 / K, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
        const [tx, ty] = toS(p.x + fx * u, p.z + fz * u);
        const [lx, ly] = toS(p.x - fx * u * 0.6 + fz * u * 0.6, p.z - fz * u * 0.6 - fx * u * 0.6);
        const [rx, ry] = toS(p.x - fx * u * 0.6 - fz * u * 0.6, p.z - fz * u * 0.6 + fx * u * 0.6);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.lineTo(rx, ry); ctx.closePath(); ctx.fill();
      } else {
        const s = Math.max(2.5, Math.min(6, (e.L || 40) / 14));
        ctx.fillRect(x - s, y - s, s * 2, s * 2);
      }
      if (e.visual && e.speed > 0.3 && e.type !== 'plane') {
        const [hx, hy] = toS(p.x + Math.sin(e.yaw) * e.speed * 3 / K, p.z + Math.cos(e.yaw) * e.speed * 3 / K);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
      }
      if (e === W.lock) { ctx.strokeStyle = '#fff'; ctx.strokeRect(x - 8, y - 8, 16, 16); }
    }
    for (const t of G.torpedoes) {
      if (!t.alive) continue;
      if (!t.isPlayer && !(S.depth > 6 && t.pos.distanceTo(S.pos) < 1500)) continue;
      const [x, y] = toS(t.pos.x, t.pos.z);
      ctx.fillStyle = t.isPlayer ? '#7ef0ff' : (Math.sin(G.time * 20) > 0 ? '#ff2a1a' : '#fff');
      ctx.beginPath(); ctx.arc(x, y, t.isPlayer ? 1.8 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of G.charges) {
      const [x, y] = toS(c.pos.x, c.pos.z);
      ctx.fillStyle = '#ffc23a';
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    }
    for (const d of G.decoys) if (d.alive) {
      const [x, y] = toS(d.pos.x, d.pos.z);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(C, C - 7); ctx.lineTo(C + 5, C + 6); ctx.lineTo(C, C + 3); ctx.lineTo(C - 5, C + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(109,255,158,0.85)';
    ctx.font = '10px monospace';
    ctx.fillText(`PLOT ${RANGE / 1000}km (Z)`, 8, Wd - 8);
    ctx.fillText(S.depth > 6 ? (S.systems.hydrophones > 0 ? 'HYDRO DAMAGED' : 'HYDROPHONES') : 'LOOKOUTS', Wd - 86, Wd - 8);
  }
}
