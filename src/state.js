// Shared mutable game state. Every module imports this single object.
export const G = {
  scene: null,
  camera: null,
  world: null,
  fx: null,
  audio: null,
  hud: null,

  player: null,
  enemies: [], // EnemySub | Destroyer | Mine
  torpedoes: [],
  charges: [],
  decoys: [],
  pickups: [],
  wrecks: [],

  state: 'menu', // menu | playing | paused | dying | over
  time: 0,
  score: 0,
  wave: 0,
  combo: 1,
  comboTimer: 0,
  shake: 0,
  lockTarget: null,
  hardLock: false,
  pingReveal: 0,
  waveCleared: false,
  intermission: 0,
  waveDamage: 0,
  incoming: [], // enemy torpedoes homing on the player
  stats: { fired: 0, hits: 0, kills: 0, evaded: 0 },

  // callbacks installed by main.js
  blast: null,
  onEnemyKilled: null,
  onDetected: null,
  onEvaded: null,
  onPlayerDeath: null,
};
