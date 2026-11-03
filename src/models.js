// Procedural low-poly models. All models face +Z (forward).
import * as THREE from 'three';
import { glowTexture } from './world.js';

const cache = {};
function geo(key, fn) {
  return cache[key] || (cache[key] = fn());
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...o });

export function glowSprite(color, size, opacity = 1) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

export function makeSub({ hull = 0x2b3540, accent = 0xffc23a, scale = 1, player = false } = {}) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  g.add(body);

  const hullMat = std(hull, { emissive: 0x000000 });
  const accMat = std(accent, { emissive: accent, emissiveIntensity: 0.7 });

  const h = new THREE.Mesh(geo('hull', () => new THREE.CapsuleGeometry(1.6, 9, 8, 20)), hullMat);
  h.rotation.x = Math.PI / 2;
  body.add(h);

  const sail = new THREE.Mesh(geo('sail', () => new THREE.BoxGeometry(0.9, 2.4, 3.4)), hullMat);
  sail.position.set(0, 2.3, 1.8);
  body.add(sail);
  const sailCap = new THREE.Mesh(geo('sailcap', () => new THREE.CylinderGeometry(0.45, 0.45, 3.4, 10)), hullMat);
  sailCap.rotation.x = Math.PI / 2;
  sailCap.position.set(0, 3.5, 1.8);
  body.add(sailCap);

  const sailPlanes = new THREE.Mesh(geo('splanes', () => new THREE.BoxGeometry(4.0, 0.14, 1.0)), hullMat);
  sailPlanes.position.set(0, 2.6, 2.4);
  body.add(sailPlanes);

  const scope = new THREE.Mesh(geo('scope', () => new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6)), hullMat);
  scope.position.set(0, 4.4, 2.6);
  body.add(scope);

  const finV = new THREE.Mesh(geo('finv', () => new THREE.BoxGeometry(0.16, 3.8, 1.6)), hullMat);
  finV.position.set(0, 0, -5.4);
  body.add(finV);
  const finH = new THREE.Mesh(geo('finh', () => new THREE.BoxGeometry(3.8, 0.16, 1.6)), hullMat);
  finH.position.set(0, 0, -5.4);
  body.add(finH);

  const stripe = new THREE.Mesh(geo('stripe', () => new THREE.TorusGeometry(1.63, 0.07, 6, 28)), accMat);
  stripe.position.z = 3.6;
  body.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.position.z = -3.2;
  body.add(stripe2);

  const prop = new THREE.Group();
  prop.position.z = -6.7;
  const blade = geo('blade', () => {
    const b = new THREE.BoxGeometry(0.12, 1.35, 0.45);
    b.translate(0, 0.68, 0);
    return b;
  });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(blade, hullMat);
    b.rotation.set(0, 0.5, (i * Math.PI * 2) / 5, 'ZYX');
    prop.add(b);
  }
  const hub = new THREE.Mesh(geo('hub', () => new THREE.ConeGeometry(0.35, 0.8, 10).rotateX(-Math.PI / 2)), hullMat);
  hub.position.z = -0.3;
  prop.add(hub);
  body.add(prop);

  const nav = glowSprite(accent, 1.6, 0.9);
  nav.position.set(0, 4.0, 1.0);
  body.add(nav);

  if (player) {
    const spot = new THREE.SpotLight(0xd8f4ff, 700, 170, 0.42, 0.55, 1.5);
    spot.position.set(0, 0.4, 6.6);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -6, 40);
    body.add(tgt);
    spot.target = tgt;
    body.add(spot);
    const lamp = glowSprite(0xdff8ff, 3.5, 0.9);
    lamp.position.set(0, 0.4, 6.5);
    body.add(lamp);
  }

  g.userData = { prop, hullMat, nav };
  return g;
}

export function makeDestroyer() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const grey = std(0x5d666f, { emissive: 0x000000 });
  const dark = std(0x2a2f35);
  const red = std(0x7a2620, { emissive: 0x000000 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 30), red);
  lower.position.y = -1.6;
  g.add(lower);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.4, 30), grey);
  upper.position.y = 0.9;
  g.add(upper);

  const bowGeo = new THREE.ConeGeometry(4.3, 9, 4);
  bowGeo.rotateY(Math.PI / 4); // square cross-section aligned with hull
  bowGeo.rotateX(Math.PI / 2);
  const bow = new THREE.Mesh(bowGeo, grey);
  bow.scale.y = 0.82;
  bow.position.set(0, -0.35, 19.5);
  g.add(bow);

  const stern = new THREE.Mesh(new THREE.BoxGeometry(5.4, 4.4, 3), grey);
  stern.position.set(0, -0.3, -16);
  g.add(stern);

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.6, 6), grey);
  bridge.position.set(0, 3.9, 5);
  g.add(bridge);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.25, 3.4, 10), dark);
  funnel.position.set(0, 3.8, -3);
  g.add(funnel);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8, 6), dark);
  mast.position.set(0, 9.5, 4);
  g.add(mast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 0.3), dark);
  radar.position.set(0, 12.5, 4);
  g.add(radar);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.6), grey);
  turret.position.set(0, 2.7, 11);
  g.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 6), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 2.8, 13.5);
  g.add(barrel);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2.2), dark);
  rack.position.set(0, 2.6, -13);
  g.add(rack);

  const propL = new THREE.Mesh(geo('dprop', () => new THREE.CylinderGeometry(0.9, 0.9, 0.3, 8)), dark);
  propL.rotation.x = Math.PI / 2;
  propL.position.set(-1.6, -2.7, -15.5);
  g.add(propL);
  const propR = propL.clone();
  propR.position.x = 1.6;
  g.add(propR);

  const lightR = glowSprite(0xff3020, 2.5);
  lightR.position.set(-3.2, 2.5, 6);
  g.add(lightR);
  const lightG = glowSprite(0x30ff60, 2.5);
  lightG.position.set(3.2, 2.5, 6);
  g.add(lightG);

  g.userData = { radar, hullMat: red, hullMat2: grey, props: [propL, propR] };
  return g;
}

export function makeTorpedo(isPlayer) {
  const g = new THREE.Group();
  const mat = std(isPlayer ? 0xa7b2bb : 0x3c3c3c);
  const body = new THREE.Mesh(geo('torp', () => new THREE.CapsuleGeometry(0.32, 2.4, 4, 10)), mat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const fin = new THREE.Mesh(geo('tfin', () => new THREE.BoxGeometry(1.0, 0.06, 0.4)), mat);
  fin.position.z = -1.4;
  g.add(fin);
  const fin2 = fin.clone();
  fin2.rotation.z = Math.PI / 2;
  g.add(fin2);
  const glow = glowSprite(isPlayer ? 0x5ff6ff : 0xff4030, isPlayer ? 3.2 : 4.0);
  glow.position.z = -1.7;
  g.add(glow);
  return g;
}

/** Merge geometries (each with its own transform) into one non-indexed geometry. */
function mergeGeos(parts) {
  const pos = [], nrm = [];
  for (const [geo, matrix] of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

const mineMat = std(0x2b2e2e, { metalness: 0.6, roughness: 0.4 });
export function makeMine(tether) {
  const g = new THREE.Group();
  const body = geo('mineMerged', () => {
    const parts = [[new THREE.SphereGeometry(1.4, 14, 10), new THREE.Matrix4()]];
    const spike = new THREE.ConeGeometry(0.18, 0.8, 6);
    const up = new THREE.Vector3(0, 1, 0);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const q = new THREE.Quaternion().setFromUnitVectors(up, d);
      parts.push([spike, new THREE.Matrix4().compose(d.clone().multiplyScalar(1.55), q, new THREE.Vector3(1, 1, 1))]);
    }
    return mergeGeos(parts);
  });
  g.add(new THREE.Mesh(body, mineMat));
  const chain = new THREE.Mesh(
    geo('chain', () => new THREE.CylinderGeometry(0.06, 0.06, 1, 4).translate(0, -0.5, 0)),
    mineMat,
  );
  chain.scale.y = Math.max(1, tether);
  chain.position.y = -1.4;
  g.add(chain);
  const lamp = glowSprite(0xff2a1a, 3.2);
  lamp.position.y = 1.7;
  g.add(lamp);
  g.userData = { lamp };
  return g;
}

export function makeDepthCharge() {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(geo('dc', () => new THREE.CylinderGeometry(0.65, 0.65, 1.4, 12)), std(0x39413a));
  g.add(barrel);
  const band = new THREE.Mesh(geo('dcband', () => new THREE.CylinderGeometry(0.68, 0.68, 0.2, 12)), std(0xc9a227, { emissive: 0x4a3a00 }));
  g.add(band);
  const glow = glowSprite(0xffb040, 2.5, 0.7);
  g.add(glow);
  g.userData = { glow };
  return g;
}

export function makeDecoy(isPlayer) {
  const g = new THREE.Group();
  const col = isPlayer ? 0xffd23a : 0xff7a3a;
  g.add(new THREE.Mesh(geo('decoy', () => new THREE.CylinderGeometry(0.3, 0.3, 1.4, 8)), std(col, { emissive: col, emissiveIntensity: 0.4 })));
  const glow = glowSprite(col, 5);
  g.add(glow);
  g.userData = { glow };
  return g;
}

export const PICKUP_COLORS = { repair: 0x3dff7a, ammo: 0x40d0ff, decoy: 0xffd23a };
export function makeCrate(kind) {
  const col = PICKUP_COLORS[kind];
  const g = new THREE.Group();
  const boxGeo = geo('crate', () => new THREE.BoxGeometry(2.4, 2.4, 2.4));
  g.add(new THREE.Mesh(boxGeo, std(0x2f3a40, { emissive: col, emissiveIntensity: 0.25 })));
  const edges = new THREE.LineSegments(
    geo('crateEdges', () => new THREE.EdgesGeometry(boxGeo)),
    new THREE.LineBasicMaterial({ color: col }),
  );
  edges.scale.setScalar(1.02);
  g.add(edges);
  const glow = glowSprite(col, 9, 0.7);
  g.add(glow);
  return g;
}

// ======================================================================
// WWII models
// ======================================================================

/** Ship hull from a top-view outline, extruded between y0 and y1. Bow faces +Z. */
export function shipHull(L, B, y0, y1, bowFrac = 0.22) {
  const s = new THREE.Shape();
  const hb = B / 2, hl = L / 2, bl = L * bowFrac;
  s.moveTo(-hb * 0.75, -hl);
  s.quadraticCurveTo(0, -hl - B * 0.12, hb * 0.75, -hl);
  s.quadraticCurveTo(hb, -hl + B * 0.3, hb, -hl + B * 0.6);
  s.lineTo(hb, hl - bl);
  s.quadraticCurveTo(hb * 0.8, hl - bl * 0.3, 0, hl);
  s.quadraticCurveTo(-hb * 0.8, hl - bl * 0.3, -hb, hl - bl);
  s.lineTo(-hb, -hl + B * 0.6);
  s.quadraticCurveTo(-hb, -hl + B * 0.3, -hb * 0.75, -hl);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(Math.PI / 2); // shape y → +z, extrusion → −y
  g.translate(0, y1, 0);
  return g;
}

function box(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, mat, r0, r1, h, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const MERCHANT_SPECS = {
  freighter: { L: 44, B: 7, free: 4, draft: 5, label: 'FREIGHTER' },
  cargo: { L: 58, B: 8.5, free: 5, draft: 6.5, label: 'CARGO SHIP' },
  tanker: { L: 68, B: 9.5, free: 3.5, draft: 7, label: 'TANKER' },
  liner: { L: 82, B: 10.5, free: 7, draft: 7.5, label: 'TROOPSHIP' },
};

export function makeMerchant(kind) {
  const sp = MERCHANT_SPECS[kind];
  const { L, B, free, draft } = sp;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const lowerMat = std(pick([0x6a2a22, 0x5a2620, 0x3a3030]), { roughness: 0.9, metalness: 0.1 });
  const hullMat = std(pick([0x2e3236, 0x3b3530, 0x46494d, 0x2f3b3f, 0x4a4238]), { roughness: 0.85, metalness: 0.2 });
  const cream = std(pick([0xcfc6b0, 0xb8b2a2, 0x9a9488]), { roughness: 0.8 });
  const dark = std(0x26292b, { roughness: 0.9 });
  const funnelMat = std(pick([0x1d1d1d, 0x8a3b22, 0xa88a2a, 0x2a3a5a]), { roughness: 0.8 });
  const hatch = std(0x4a3a2a, { roughness: 1 });
  g.add(new THREE.Mesh(shipHull(L, B, -draft, 0), lowerMat));
  g.add(new THREE.Mesh(shipHull(L, B, 0, free), hullMat));
  const deckY = free;
  let funnelTop;
  if (kind === 'tanker') {
    box(g, cream, B * 0.6, 4, 7, 0, deckY + 2, L * 0.12);
    box(g, cream, B * 0.4, 2, 4, 0, deckY + 5, L * 0.12);
    box(g, cream, B * 0.8, 5, 12, 0, deckY + 2.5, -L * 0.36);
    const f = cyl(g, funnelMat, 1.2, 1.4, 5, 0, deckY + 7, -L * 0.38);
    funnelTop = new THREE.Vector3(0, f.position.y + 2.5, f.position.z);
    box(g, dark, 1.2, 0.8, L * 0.8, 0, deckY + 1.4, 0);
    cyl(g, dark, 0.15, 0.2, 12, 0, deckY + 6, L * 0.3, 6);
  } else if (kind === 'liner') {
    box(g, cream, B * 0.85, 5, L * 0.55, 0, deckY + 2.5, -L * 0.02);
    box(g, cream, B * 0.7, 3, L * 0.35, 0, deckY + 6.5, L * 0.02);
    box(g, cream, B * 0.5, 2.2, 6, 0, deckY + 9, L * 0.15);
    const f1 = cyl(g, funnelMat, 1.6, 1.8, 7, 0, deckY + 11, L * 0.02);
    cyl(g, funnelMat, 1.6, 1.8, 7, 0, deckY + 11, -L * 0.14);
    funnelTop = new THREE.Vector3(0, f1.position.y + 3.5, f1.position.z);
    for (let i = 0; i < 6; i++) {
      for (const sx of [-1, 1]) box(g, std(0xdddddd), 0.9, 0.7, 3.2, sx * B * 0.44, deckY + 5.6, -L * 0.2 + i * 4.5);
    }
    cyl(g, dark, 0.15, 0.2, 16, 0, deckY + 8, L * 0.36, 6);
    cyl(g, dark, 0.15, 0.2, 14, 0, deckY + 7, -L * 0.36, 6);
  } else {
    box(g, cream, B * 0.75, 4.5, 7, 0, deckY + 2.25, -L * 0.02);
    box(g, cream, B * 0.5, 2.2, 4, 0, deckY + 5.6, L * 0.0);
    const f = cyl(g, funnelMat, 1.2, 1.4, 5.5, 0, deckY + 6, -L * 0.13);
    funnelTop = new THREE.Vector3(0, f.position.y + 2.75, f.position.z);
    for (const zf of [0.3, 0.17, -0.27, -0.38]) box(g, hatch, B * 0.5, 1.2, L * 0.08, 0, deckY + 0.6, L * zf);
    for (const zf of [0.24, -0.32]) {
      cyl(g, dark, 0.18, 0.25, 15, 0, deckY + 7.5, L * zf, 6);
      const boom = cyl(g, dark, 0.1, 0.1, 9, 0, deckY + 4, L * zf + (zf > 0 ? 3 : -3), 5);
      boom.rotation.x = zf > 0 ? 0.9 : -0.9;
    }
    if (Math.random() < 0.5) box(g, std(0x55603f), B * 0.45, 1.6, 4, 0, deckY + 2, L * 0.38); // deck cargo
  }
  g.userData = { flashMats: [hullMat, lowerMat], funnelTop, ...sp };
  return g;
}

export function makeCorvette() {
  const L = 40, B = 6.6, free = 3.4, draft = 3.6;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const grey = std(0x6c767c, { roughness: 0.8 });
  const lower = std(0x5a2a25, { roughness: 0.9 });
  const dark = std(0x2a2f35);
  g.add(new THREE.Mesh(shipHull(L, B, -draft, 0, 0.28), lower));
  g.add(new THREE.Mesh(shipHull(L, B, 0, free, 0.28), grey));
  box(g, grey, B * 0.9, 2, 14, 0, free + 1, 9); // forecastle
  box(g, grey, 3.6, 3.4, 4, 0, free + 3.7, 6);
  box(g, dark, 3.8, 0.6, 4.2, 0, free + 5.6, 6);
  const f = cyl(g, grey, 1.1, 1.3, 4.5, 0, free + 3, -2);
  cyl(g, dark, 0.15, 0.2, 11, 0, free + 7, 3.5, 6);
  const radar = box(g, dark, 2.2, 0.25, 0.25, 0, free + 12, 3.5);
  box(g, dark, 1.6, 1, 2, 0, free + 2.6, 15); // bow gun
  const barrel = cyl(g, dark, 0.12, 0.12, 3, 0, free + 2.8, 16.8, 6);
  barrel.rotation.x = Math.PI / 2;
  box(g, dark, 3.4, 1, 2, 0, free + 0.5, -17); // DC racks
  g.userData = { radar, props: [], flashMats: [grey, lower], funnelTop: new THREE.Vector3(0, free + 5.3, -2), L, B, draft, free };
  void f;
  return g;
}

export function makeWarDestroyer() {
  const outer = new THREE.Group();
  outer.rotation.order = 'YXZ';
  const d = makeDestroyer();
  d.rotation.set(0, 0, 0);
  d.scale.setScalar(1.25);
  d.position.y = 0.6;
  d.traverse((o) => { if (o.isSprite) o.visible = false; });
  outer.add(d);
  outer.userData = {
    radar: d.userData.radar, props: d.userData.props, flashMats: [d.userData.hullMat, d.userData.hullMat2],
    funnelTop: new THREE.Vector3(0, 7.5, -3.8), L: 48, B: 7.6, draft: 4, free: 4,
  };
  return outer;
}

export function makePlane() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = std(0x5d6656, { roughness: 0.7 });
  const belly = std(0xa8b0b0, { roughness: 0.7 });
  const dark = std(0x222222);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.6, 19, 10), body);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), belly);
  nose.position.z = 9.5;
  g.add(nose);
  box(g, body, 32, 0.35, 3.8, 0, 0.7, 1.5);
  box(g, body, 10, 0.25, 2, 0, 0.3, -8.6);
  box(g, body, 0.25, 3.6, 2.4, 0, 1.9, -8.6);
  const props = [];
  for (const sx of [-6.5, 6.5]) {
    const n = cyl(g, belly, 0.8, 0.8, 4.4, sx, 0.4, 3.2, 8);
    n.rotation.x = Math.PI / 2;
    const p = new THREE.Group();
    p.position.set(sx, 0.4, 5.6);
    for (let i = 0; i < 3; i++) {
      const b = box(p, dark, 0.25, 3.2, 0.1, 0, 0, 0);
      b.geometry.translate(0, 1.6, 0);
      b.rotation.z = (i * Math.PI * 2) / 3;
    }
    g.add(p);
    props.push(p);
  }
  g.userData = { props, flashMats: [body] };
  return g;
}

/** Player's WWII attack submarine (Type VII-like): deck gun, flak, periscope mast. */
export function makeUBoat() {
  const g = makeSub({ hull: 0x5b656d, accent: 0x7f8a92, scale: 1.8 });
  g.userData.nav.visible = false;
  const grey = std(0x4a535a);
  const dark = std(0x24292d);
  // deck casing
  box(g, grey, 2.6, 0.5, 18, 0, 2.95, 0);
  // 88 mm deck gun
  cyl(g, dark, 0.35, 0.45, 0.8, 0, 3.6, 9.5, 8);
  box(g, dark, 1.2, 0.9, 1.6, 0, 4.3, 9.5);
  const barrel = cyl(g, dark, 0.12, 0.14, 4.4, 0, 4.4, 11.6, 6);
  barrel.rotation.x = Math.PI / 2;
  // flak on the "wintergarden"
  box(g, grey, 2.2, 0.3, 2.4, 0, 6.6, 0.4);
  const flak = cyl(g, dark, 0.06, 0.06, 1.8, 0, 7.3, 1.1, 5);
  flak.rotation.x = Math.PI / 2 - 0.5;
  // periscope mast (scaled at runtime)
  const mastGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6);
  mastGeo.translate(0, 0.5, 0);
  const mast = new THREE.Mesh(mastGeo, dark);
  mast.position.set(0, 7.2, 4.2);
  mast.visible = false;
  g.add(mast);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.5), dark);
  head.visible = false;
  g.add(head);
  Object.assign(g.userData, { mast, head });
  return g;
}

export function makeEnemyBoat() {
  const g = makeSub({ hull: 0x3a4248, accent: 0x6a737a, scale: 1.8 });
  g.userData.nav.visible = false;
  const dark = std(0x24292d);
  cyl(g, dark, 0.35, 0.45, 0.8, 0, 3.6, 9.5, 8);
  const barrel = cyl(g, dark, 0.12, 0.14, 4.4, 0, 4.4, 11.6, 6);
  barrel.rotation.x = Math.PI / 2;
  g.userData.flashMats = [g.userData.hullMat];
  return g;
}

export function makeBattery() {
  const g = new THREE.Group();
  const concrete = std(0x8a8a82, { roughness: 1 });
  const dark = std(0x2a2e2a);
  box(g, concrete, 14, 3, 10, 0, 1.5, 0);
  cyl(g, dark, 2.2, 2.6, 1.6, 0, 3.6, 0, 12);
  const barrel = cyl(g, dark, 0.3, 0.35, 10, 0, 4.4, -4.5, 8);
  barrel.rotation.x = Math.PI / 2 - 0.15;
  g.userData = { barrel, flashMats: [concrete] };
  return g;
}

export function makeShellTracer(color = 0xffc070, size = 2.2) {
  return glowSprite(color, size);
}

export function makeBomb() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8), std(0x3a3f3a));
  m.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
