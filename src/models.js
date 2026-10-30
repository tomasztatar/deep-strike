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

export function makeMine(tether) {
  const g = new THREE.Group();
  const mat = std(0x2b2e2e, { metalness: 0.6, roughness: 0.4 });
  g.add(new THREE.Mesh(geo('mine', () => new THREE.SphereGeometry(1.4, 16, 12)), mat));
  const spike = geo('spike', () => new THREE.ConeGeometry(0.18, 0.8, 6));
  const up = new THREE.Vector3(0, 1, 0);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const s = new THREE.Mesh(spike, mat);
    s.position.copy(d).multiplyScalar(1.55);
    s.quaternion.setFromUnitVectors(up, d);
    g.add(s);
  }
  const chain = new THREE.Mesh(
    geo('chain', () => new THREE.CylinderGeometry(0.06, 0.06, 1, 4).translate(0, -0.5, 0)),
    std(0x444444),
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
