// Shared state for the WWII patrol mode (kept separate to avoid circular imports).
export const VIS = {
  // ship: how far our lookouts / periscope see a 60 m ship
  // surf: how far escorts spot our surfaced boat; scope: a raised periscope (×(1+speed/2.5))
  // planeSurf / planeScope: aircraft spotting a surfaced boat / periscope
  day: { ship: 3200, surf: 2000, scope: 170, planeSurf: 3200, planeScope: 260, planes: true },
  dusk: { ship: 2200, surf: 1300, scope: 110, planeSurf: 2000, planeScope: 160, planes: true },
  night: { ship: 1150, surf: 430, scope: 45, planeSurf: 0, planeScope: 0, planes: false },
};

export const W = {
  active: false,
  mission: null,
  envName: 'day',
  vis: VIS.day,
  radius: 3200,
  center: { x: 0, z: 0 },
  clock: 0,
  timeScale: 1,
  dangerT: 0,
  view: 'ext',
  aimYaw: 0,
  lock: null,
  tdcAssist: true,
  sonarRange: 3000,
  flares: [],
  shells: [],
  bombs: [],
  convoys: [],
  tonnage: 0,
  sunk: [],
  stats: null,
  objectiveDone: false,
  layerDepth: 90,

  // installed by mode.js
  canSee: null,
  onShipHit: null,
  onShipSunk: null,
  onDetected: null,
  reportSub: null,
  onTorpedoSpotted: null,
  interrupt: null,
  alertConvoy: null,
};

/** Multiplier for visibility near an active star shell (night only). */
export function flareMul(pos) {
  if (W.envName !== 'night') return 1;
  for (const f of W.flares) {
    if (!f.alive) continue;
    const dx = f.pos.x - pos.x, dz = f.pos.z - pos.z;
    if (dx * dx + dz * dz < 1100 * 1100) return 4;
  }
  return 1;
}
