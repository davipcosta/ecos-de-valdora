// Ecos de Valdora — main.js (Agente E)
// Bootstrap, loop, câmera 3ª pessoa, lock-on, quest, NPCs, baús, itens, Lume, flauta, zonas, HUD.
// Código defensivo: cada chamada a outro módulo é protegida para que
// a peculiaridade de um módulo não derrube o jogo inteiro.

import * as THREE from 'three';
import * as models from './models.js';
import * as worldMod from './world.js';
import * as playerMod from './player.js';
import * as enemiesMod from './enemies.js';
import * as inputMod from './input.js';
import * as audioMod from './audio.js';
import * as uiMod from './ui.js';

const { World } = worldMod;
const { Player } = playerMod;
const { EnemyManager } = enemiesMod;
const { Input } = inputMod;
const { AudioSys } = audioMod;
const { UI } = uiMod;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const _warned = new Set();
function warnOnce(tag, err) {
  if (_warned.has(tag)) return;
  _warned.add(tag);
  console.warn(`[main] ${tag}:`, err);
}
/** Chama obj[name](...args) com segurança. */
function call(obj, name, tag, ...args) {
  try {
    const fn = obj && obj[name];
    if (typeof fn === 'function') return fn.apply(obj, args);
  } catch (e) { warnOnce(`${tag}.${name}`, e); }
  return undefined;
}

// Canções (fallback se audio.js não exportar SONGS)
const SONG_DEFS = Object.assign({
  aurora:    { name: 'Canção da Aurora',    notes: [0, 2, 4, 2, 0], desc: 'Alterna entre dia e noite.' },
  santuario: { name: 'Canção do Santuário', notes: [1, 3, 1, 4, 3], desc: 'Desperta portas antigas.' },
}, audioMod.SONGS || {});
const notesStr = (k) => (SONG_DEFS[k]?.notes || []).map((n) => n + 1).join(' · ');

const STAGES = ['start', 'mira', 'temple', 'inside', 'gate', 'boss', 'victory'];
const stageIdx = (s) => STAGES.indexOf(s);

const ZONE_SUB = {
  village: 'Onde o vento faz a sesta',
  field: 'Terras abertas de Valdora',
  forest: 'As árvores cochicham segredos',
  lake: 'Um céu inteiro dentro d’água',
  temple: 'Ecos da Raiz antiga',
  temple_out: 'O limiar da Raiz antiga',
};
const NPC_NAMES = { orvo: 'Orvo', mira: 'Mira', tila: 'Tila', brom: 'Brom' };
const BOSS_NAME = 'Guardião Musgoso';

// ---------------------------------------------------------------------------
// Renderer / cena / câmera
// ---------------------------------------------------------------------------
let canvas = document.getElementById('game');
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.prepend(canvas);
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 20, 50);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Barras de letterbox (cutscenes / lock-on). Inseridas logo após o canvas → abaixo do HUD.
const letterbox = ['top', 'bottom'].map((side) => {
  const d = document.createElement('div');
  Object.assign(d.style, {
    position: 'fixed', left: '0', right: '0', [side]: '0', height: '0',
    background: 'rgba(0,0,0,0.92)', pointerEvents: 'none', transition: 'height .35s ease',
  });
  canvas.insertAdjacentElement('afterend', d);
  return d;
});
let letterboxOn = false;
function setLetterbox(on) {
  if (on === letterboxOn) return;
  letterboxOn = on;
  for (const d of letterbox) d.style.height = on ? '6.5vh' : '0';
}

function showFatal(err) {
  console.error(err);
  const ld = document.getElementById('loading');
  if (ld) {
    ld.style.opacity = '1';
    const sub = ld.querySelector('.ld-sub') || ld;
    sub.textContent = 'Erro ao carregar: ' + (err && err.message ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Módulos
// ---------------------------------------------------------------------------
let ui, input, audio, world, player, enemies;
try {
  ui = UI ? new UI() : null;
} catch (e) { warnOnce('UI ctor', e); ui = null; }
try {
  input = new Input(canvas);
} catch (e) { showFatal(e); throw e; }
try {
  audio = AudioSys ? new AudioSys() : null;
} catch (e) { warnOnce('AudioSys ctor', e); audio = null; }
let worldObjects = [];
try {
  world = new World(scene, models);
  // tudo que existe na cena neste instante pertence ao mundo (antes de herói/inimigos/NPCs)
  worldObjects = scene.children.slice();
  player = new Player(scene, world, models, audio);
  enemies = new EnemyManager(scene, world, models, audio);
} catch (e) { showFatal(e); throw e; }

if (!scene.background) scene.background = new THREE.Color(0x8cc8f0);

const U = (name, ...a) => call(ui, name, 'ui', ...a);
const A = (name, ...a) => call(audio, name, 'audio', ...a);
const sfx = (n) => A('sfx', n);

function safeHeight(x, z) {
  try {
    const h = world.getHeight(x, z);
    return Number.isFinite(h) ? h : 0;
  } catch (e) { warnOnce('world.getHeight', e); return 0; }
}
// ---------------------------------------------------------------------------
// Colisão da câmera
// Grade 2D (XZ) com os triângulos das malhas estáticas do mundo, montada uma vez.
// Porta do templo e portão do chefe (que se movem) são testados à parte com Raycaster.
// Terreno é tratado pelo heightfield (world.getHeight), mais barato que 80k triângulos.
// ---------------------------------------------------------------------------
const camCol = (() => {
  const CELL = 4;
  const cells = new Map();
  let tri = null;            // Float32Array, 9 floats por triângulo
  let stamp = null, stampId = 0, triCount = 0, buildMs = 0;
  const dynamic = [];        // { obj, center: Vector3, radius }
  const ray = new THREE.Raycaster();
  const hits = [];
  const ckey = (cx, cz) => (cx + 1000) * 4096 + (cz + 1000);
  const inTempleAt = (x, z) => {
    try {
      if (typeof world.isInTemple === 'function') return !!world.isInTemple(x, z, 1.5);
      const id = world.getZone(x, z)?.id;
      return id === 'temple' || id === 'boss';
    } catch { return false; }
  };
  function okMaterial(m) {
    if (!m) return false;
    if (Array.isArray(m)) return m.some(okMaterial);
    if (m.transparent || m.opacity < 1 || m.depthWrite === false || m.alphaTest > 0 || m.wireframe) return false;
    if (m.isMeshBasicMaterial || m.isShaderMaterial || m.isRawShaderMaterial || m.isPointsMaterial) return false;
    if (m.side === THREE.BackSide) return false;
    return true;
  }
  function build() {
    const t0 = performance.now();
    const exclude = new Set();
    const addEx = (o) => { if (o && o.isObject3D) o.traverse((c) => exclude.add(c)); };
    for (const c of world.cuttables || []) addEx(c?.mesh);
    addEx(world.terrain);
    for (const c of world._clouds || []) addEx(c);
    // objetos móveis (porta/portão): identificados pela referência interna ou pela posição
    const movers = [world._doorObj, world._gateObj].filter((o) => o && o.isObject3D);
    const moverPos = [world.templeDoor?.position, world.bossGate?.position].filter(Boolean);
    const box = new THREE.Box3(), sph = new THREE.Sphere();
    for (const o of worldObjects) {
      if (!o || o.isLight || movers.includes(o)) continue;
      if (o.matrixAutoUpdate !== false && !o.isMesh && moverPos.length) {
        try {
          box.setFromObject(o);
          if (!box.isEmpty()) {
            const c = box.getCenter(new V3());
            if (moverPos.some((p) => Math.hypot(c.x - p.x, c.z - p.z) < 2.5)) movers.push(o);
          }
        } catch { /* ignora */ }
      }
    }
    for (const o of movers) {
      addEx(o);
      try {
        box.setFromObject(o); box.getBoundingSphere(sph);
        dynamic.push({ obj: o, center: sph.center.clone(), radius: sph.radius + 1 });
      } catch { /* ignora */ }
    }
    let data = new Float32Array(1 << 20), n = 0;
    const push9 = (a) => {
      if (n + 9 > data.length) { const d2 = new Float32Array(data.length * 2); d2.set(data); data = d2; }
      for (let i = 0; i < 9; i++) data[n++] = a[i];
    };
    const v = new V3(), T = new Array(9);
    for (const root of worldObjects) {
      if (!root || exclude.has(root)) continue;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || exclude.has(o)) return;
        if (/water|sky|cloud|star|sun|moon/i.test(o.name || '')) return;
        const g = o.geometry;
        const pos = g?.attributes?.position;
        if (!pos || !okMaterial(o.material)) return;
        let vis = true;
        for (let p = o; p; p = p.parent) if (p.visible === false) { vis = false; break; }
        if (!vis) return;
        // descarta objetos muito altos (nuvens/sol) pelo raio/altura
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (g.boundingSphere && g.boundingSphere.radius > 260) return;
        const idx = g.index;
        const cnt = idx ? idx.count : pos.count;
        const mw = o.matrixWorld;
        for (let i = 0; i + 2 < cnt; i += 3) {
          let minY = Infinity, cx = 0, cz = 0;
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(i + k) : i + k;
            v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
            T[k * 3] = v.x; T[k * 3 + 1] = v.y; T[k * 3 + 2] = v.z;
            if (v.y < minY) minY = v.y;
            cx += v.x; cz += v.z;
          }
          cx /= 3; cz /= 3;
          // ao ar livre, ignora o que está todo acima de ~2.8 m do chão (copas, telhados, nuvens):
          // evita que a câmera "pule" para perto do herói ao passar sob árvores
          if (minY > safeHeight(cx, cz) + 2.8 && !inTempleAt(cx, cz)) continue;
          push9(T);
        }
      });
    }
    tri = data;
    triCount = n / 9;
    stamp = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t++) {
      const b = t * 9;
      const x0 = Math.min(tri[b], tri[b + 3], tri[b + 6]), x1 = Math.max(tri[b], tri[b + 3], tri[b + 6]);
      const z0 = Math.min(tri[b + 2], tri[b + 5], tri[b + 8]), z1 = Math.max(tri[b + 2], tri[b + 5], tri[b + 8]);
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const k = ckey(cx, cz);
          let l = cells.get(k);
          if (!l) { l = []; cells.set(k, l); }
          l.push(t);
        }
      }
    }
    buildMs = performance.now() - t0;
    if (DEBUG) console.log(`[main] camCol: ${triCount} triângulos, ${cells.size} células, ${dynamic.length} móveis, ${buildMs.toFixed(0)} ms`);
  }

  /** Distância até o primeiro triângulo estático ao longo de o + d*t (d unitário), t em (0, maxT]. */
  function castStatic(o, d, maxT) {
    if (!triCount) return maxT;
    let best = maxT;
    const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT;
    const cx0 = Math.floor(Math.min(o.x, ex) / CELL), cx1 = Math.floor(Math.max(o.x, ex) / CELL);
    const cz0 = Math.floor(Math.min(o.z, ez) / CELL), cz1 = Math.floor(Math.max(o.z, ez) / CELL);
    if (++stampId >= 0xffffffff) { stamp.fill(0); stampId = 1; }
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const l = cells.get(ckey(cx, cz));
        if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const t = l[i];
          if (stamp[t] === stampId) continue;
          stamp[t] = stampId;
          const b = t * 9;
          const ax = tri[b], ay = tri[b + 1], az = tri[b + 2];
          const e1x = tri[b + 3] - ax, e1y = tri[b + 4] - ay, e1z = tri[b + 5] - az;
          const e2x = tri[b + 6] - ax, e2y = tri[b + 7] - ay, e2z = tri[b + 8] - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det;
          const sx = ox - ax, sy = oy - ay, sz = oz - az;
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const w = (dx * qx + dy * qy + dz * qz) * inv;
          if (w < 0 || u + w > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-3 && tt < best) best = tt;
        }
      }
    }
    return best;
  }
  function castDynamic(o, d, maxT) {
    let best = maxT;
    for (const m of dynamic) {
      const obj = m.obj;
      let vis = true;
      for (let p = obj; p; p = p.parent) if (p.visible === false) { vis = false; break; }
      if (!vis) continue;
      const cx = m.center.x - o.x, cz = m.center.z - o.z;
      if (Math.hypot(cx, cz) > m.radius + maxT + 10) continue; // (porta afunda 9 m: folga)
      ray.set(o, d);
      ray.near = 0; ray.far = best;
      hits.length = 0;
      try { ray.intersectObject(obj, true, hits); } catch { continue; }
      for (const h of hits) {
        if (h.distance < best && h.object?.visible !== false && okMaterial(h.object.material)) { best = h.distance; break; }
      }
    }
    return best;
  }
  /** Primeiro ponto em que o segmento passa por baixo do terreno. */
  function castTerrain(o, d, maxT) {
    const stepL = 0.5;
    for (let s = stepL; s <= maxT; s += stepL) {
      const x = o.x + d.x * s, z = o.z + d.z * s, y = o.y + d.y * s;
      if (y < safeHeight(x, z) + 0.15) return Math.max(0, s - stepL);
    }
    return maxT;
  }
  function cast(o, d, maxT) {
    let t = castStatic(o, d, maxT);
    t = castDynamic(o, d, t);
    return castTerrain(o, d, t);
  }
  return {
    build() { try { build(); } catch (e) { warnOnce('camCol.build', e); triCount = 0; } },
    get ready() { return triCount > 0; },
    get triCount() { return triCount; },
    get buildMs() { return buildMs; },
    get movers() { return dynamic.length; },
    cast,
  };
})();

const playerYaw = () => (Number.isFinite(player?.yaw) ? player.yaw : (player?.root?.rotation.y || 0));
const playerAlive = () => (player?.hp ?? 1) > 0 && player?.state !== 'dead';
const spawns = world.spawns || {};

// ---------------------------------------------------------------------------
// Estado do jogo
// ---------------------------------------------------------------------------
const state = {
  stage: 'start',
  gems: 0,
  keys: 0,
  songs: new Set(),
  flags: {},
  miraCleared: false,
  bossSpawned: false,
  bossDefeated: false,
  boss: null,
};

let mode = 'loading';       // 'loading' | 'title' | 'play' | 'gameover' | 'victory'
let paused = false;
let pausedAt = 0;
let busy = false;           // diálogo / cutscene em andamento
let overlayCount = 0;       // itemGet / songLearned abertos
let gameTime = 0;
let lockTarget = null;
let dying = false;
let wasLocked = false;
let lastNight = null;
let curZoneId = null;
let curZone = null;
let curMusic = undefined;
const visitedZones = new Set();
const zoneLeftAt = {};
let pendingLumeAlert = false;

// Timers em tempo de jogo (param quando pausado)
const waits = [];
function wait(sec) { return new Promise((r) => waits.push({ t: sec, r })); }
function tickWaits(dt) {
  for (let i = waits.length - 1; i >= 0; i--) {
    const w = waits[i];
    w.t -= dt;
    if (w.t <= 0) { waits.splice(i, 1); w.r(); }
  }
}

// Vigias de promessas da UI (evita soft-lock caso alguma nunca resolva)
const watchers = [];
function guardUi(promise, isOpen, maxSec) {
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    Promise.resolve(promise).then(finish, finish);
    watchers.push({ isOpen, maxSec, t: 0, closedT: 0, isDone: () => done, finish });
  });
}
function tickWatchers(dt) {
  for (let i = watchers.length - 1; i >= 0; i--) {
    const w = watchers[i];
    if (w.isDone()) { watchers.splice(i, 1); continue; }
    w.t += dt;
    if (w.t > w.maxSec) { w.finish(); continue; }
    if (w.isOpen) {
      let open = true;
      try { open = !!w.isOpen(); } catch { open = true; }
      w.closedT = open ? 0 : w.closedT + dt;
      if (w.closedT > 1.5) w.finish();
    }
  }
}

function dialogOpen() {
  if (!ui || typeof ui.isDialogOpen !== 'function') return true;
  try { return !!ui.isDialogOpen(); } catch { return true; }
}
function say(speaker, pages) {
  pages = (pages || []).filter(Boolean);
  if (!pages.length) return Promise.resolve();
  sfx('talk');
  const p = U('showDialog', speaker, pages);
  if (!p) return Promise.resolve();
  return guardUi(p, ui && typeof ui.isDialogOpen === 'function' ? () => ui.isDialogOpen() : null, 600);
}
async function itemGet(title, desc) {
  sfx('itemGet');
  overlayCount++;
  try { await guardUi(U('showItemGet', title, desc), null, 90); } finally { overlayCount--; }
}
async function learnSong(key) {
  const d = SONG_DEFS[key];
  if (!d) return;
  state.songs.add(key);
  A('playMelody', d.notes);
  overlayCount++;
  try { await guardUi(U('showSongLearned', d.name, d.notes), null, 90); } finally { overlayCount--; }
}

let prompt = undefined;
function setPrompt(text) {
  text = text || null;
  if (text === prompt) return;
  prompt = text;
  U('showPrompt', text);
}

/** Executa uma sequência (diálogo/cutscene) com o herói travado. */
async function runSequence(fn) {
  if (busy) return;
  busy = true;
  setPrompt(null);
  call(player, 'freeze', 'player', true);
  try { await fn(); } catch (e) { console.error('[main] sequência falhou:', e); }
  finally {
    busy = false;
    cam.override = null;
    call(player, 'freeze', 'player', false);
  }
}

function setStage(s) {
  if (stageIdx(s) <= stageIdx(state.stage)) return;
  state.stage = s;
  pendingLumeAlert = true;
}

function addGems(n) {
  state.gems = clamp(state.gems + n, 0, 999);
}
function addHeartContainer() {
  player.maxHearts = (player.maxHearts || 3) + 1;
  call(player, 'heal', 'player', player.maxHearts * 2);
  if ((player.hp || 0) < player.maxHearts * 2) player.hp = player.maxHearts * 2;
}
function fullHeal() {
  call(player, 'heal', 'player', (player.maxHearts || 3) * 2);
  if ((player.hp || 0) < (player.maxHearts || 3) * 2) player.hp = (player.maxHearts || 3) * 2;
}

// ---------------------------------------------------------------------------
// Partículas simples (folhas, faíscas)
// ---------------------------------------------------------------------------
const PART_GEO = {
  leaf: new THREE.BoxGeometry(0.16, 0.03, 0.22),
  spark: new THREE.OctahedronGeometry(0.08),
};
const PART_MAT = {
  leaf: new THREE.MeshLambertMaterial({ color: 0x5cbf3a, flatShading: true }),
  leaf2: new THREE.MeshLambertMaterial({ color: 0x9ad94a, flatShading: true }),
  spark: new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
  pot: new THREE.MeshLambertMaterial({ color: 0xb06a3a, flatShading: true }),
};
const particles = [];
function burst(pos, count, kind = 'leaf') {
  for (let i = 0; i < count && particles.length < 180; i++) {
    const geo = kind === 'spark' ? PART_GEO.spark : PART_GEO.leaf;
    const mat = kind === 'spark' ? PART_MAT.spark : kind === 'pot' ? PART_MAT.pot : (Math.random() < 0.5 ? PART_MAT.leaf : PART_MAT.leaf2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x + rand(-0.3, 0.3), pos.y + rand(0.2, 0.6), pos.z + rand(-0.3, 0.3));
    m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(m);
    const life = kind === 'spark' ? rand(0.4, 0.7) : rand(0.8, 1.4);
    particles.push({
      m, life, max: life, kind,
      v: new V3(rand(-2.2, 2.2), rand(kind === 'spark' ? 1.5 : 2.5, kind === 'spark' ? 3.5 : 5), rand(-2.2, 2.2)),
      s: new V3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); continue; }
    const g = p.kind === 'leaf' ? 5 : 9;
    p.v.y -= g * dt;
    if (p.kind === 'leaf') { p.v.x *= 0.97; p.v.z *= 0.97; if (p.v.y < -1.2) p.v.y = -1.2; }
    p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += p.s.x * dt; p.m.rotation.y += p.s.y * dt; p.m.rotation.z += p.s.z * dt;
    const k = clamp(p.life / p.max * 1.5, 0, 1);
    p.m.scale.setScalar(k);
  }
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------
const pickups = [];
function makePickupMesh(type) {
  try {
    const m = models.createPickup(type);
    if (m) return m;
  } catch (e) { warnOnce('models.createPickup', e); }
  const colors = { heart: 0xff4d5e, gem_green: 0x3fe07a, gem_blue: 0x4f8bff, gem_red: 0xff3b3b, key: 0xf0c75e, heart_container: 0xff7799 };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.OctahedronGeometry(type === 'heart_container' ? 0.4 : 0.25), new THREE.MeshLambertMaterial({ color: colors[type] || 0xffffff, flatShading: true })));
  return g;
}
function spawnPickup(type, pos, opts = {}) {
  const root = makePickupMesh(type);
  root.traverse?.((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(root);
  const p = new V3(pos.x, pos.y ?? safeHeight(pos.x, pos.z), pos.z);
  const pk = {
    type, root, pos: p,
    vel: opts.pop ? new V3(rand(-1.6, 1.6), rand(4, 5.5), rand(-1.6, 1.6)) : new V3(),
    grounded: !opts.pop,
    age: 0,
    life: opts.persistent ? Infinity : (opts.life ?? 22),
    persistent: !!opts.persistent,
    victory: !!opts.victory,
    phase: Math.random() * TAU,
    light: null,
  };
  if (opts.glow) {
    try {
      pk.light = new THREE.PointLight(0xff8fb0, 2.5, 8, 2);
      pk.light.position.set(0, 0.6, 0);
      root.add(pk.light);
    } catch { /* ignora */ }
  }
  pickups.push(pk);
  return pk;
}
function removePickup(pk) {
  const i = pickups.indexOf(pk);
  if (i >= 0) pickups.splice(i, 1);
  scene.remove(pk.root);
}
function rollLoot(pos, table) {
  const r = Math.random();
  let acc = 0;
  for (const [type, chance] of table) {
    acc += chance;
    if (r < acc) { spawnPickup(type, pos, { pop: true }); return; }
  }
}
function updatePickups(dt) {
  const pp = player.position;
  const canCollect = mode === 'play' && playerAlive();
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.age += dt;
    if (pk.age > pk.life) { removePickup(pk); continue; }
    if (!pk.grounded) {
      pk.vel.y -= 18 * dt;
      pk.pos.addScaledVector(pk.vel, dt);
      try { world.resolveCollision?.(pk.pos, 0.2); } catch { /* ignora */ }
      const g = safeHeight(pk.pos.x, pk.pos.z);
      if (pk.pos.y <= g) {
        pk.pos.y = g;
        if (pk.vel.y < -3) { pk.vel.y *= -0.35; pk.vel.x *= 0.6; pk.vel.z *= 0.6; }
        else pk.grounded = true;
      }
    } else {
      pk.pos.y = safeHeight(pk.pos.x, pk.pos.z);
    }
    const dx = pp.x - pk.pos.x, dz = pp.z - pk.pos.z;
    const d = Math.hypot(dx, dz);
    const dy = Math.abs(pp.y - pk.pos.y);
    if (canCollect && pk.age > 0.35 && d < 2.6 && dy < 2.5 && !pk.victory) {
      const sp = Math.min(d, (6 + (2.6 - d) * 6) * dt);
      if (d > 1e-4) { pk.pos.x += (dx / d) * sp; pk.pos.z += (dz / d) * sp; }
    }
    pk.root.position.set(pk.pos.x, pk.pos.y + 0.45 + Math.sin(pk.age * 3 + pk.phase) * 0.12, pk.pos.z);
    pk.root.rotation.y += dt * 2.4;
    const left = pk.life - pk.age;
    pk.root.visible = left > 4 || Math.floor(pk.age * 10) % 2 === 0;
    if (canCollect && pk.age > 0.35 && d < 0.95 && dy < 2.2 && !busy) {
      collectPickup(pk);
    }
  }
}
function collectPickup(pk) {
  removePickup(pk);
  const at = pk.root.position;
  burst(at, 6, 'spark');
  switch (pk.type) {
    case 'gem_green': addGems(1); sfx('pickupGem'); break;
    case 'gem_blue': addGems(5); sfx('pickupGem'); break;
    case 'gem_red': addGems(20); sfx('pickupGem'); break;
    case 'heart': call(player, 'heal', 'player', 2); sfx('pickupHeart'); break;
    case 'key':
      state.keys++; sfx('itemGet');
      U('toast', 'Você pegou uma Chave Pequena!');
      if (stageIdx(state.stage) >= stageIdx('inside')) setStage('gate');
      break;
    case 'heart_container':
      if (pk.victory) victorySequence();
      else runSequence(async () => { addHeartContainer(); await itemGet('Contêiner de Coração', 'Seu vigor aumentou! Você ganhou mais um coração.'); });
      break;
    default: sfx('pickupGem');
  }
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------
const npcs = [];
const CULL_OUT = 92, CULL_IN = 86; // m: personagens/baús além disso não são desenhados
function spawnNPCs() {
  for (const s of spawns.npcs || []) {
    let m;
    try { m = models.createNPC(s.kind); } catch (e) { warnOnce('models.createNPC', e); continue; }
    if (!m || !m.root) continue;
    const pos = (s.position || new V3()).clone();
    pos.y = safeHeight(pos.x, pos.z);
    m.root.position.copy(pos);
    m.root.rotation.y = s.yaw || 0;
    // respeita as flags de sombra do modelo (detalhes do rosto não projetam sombra: menos draw calls)
    m.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(m.root);
    const pivots = m.pivots || {};
    const base = {};
    for (const k of Object.keys(pivots)) if (pivots[k]?.rotation) base[k] = pivots[k].rotation.clone();
    try { world.addBoxCollider?.(pos.x - 0.4, pos.x + 0.4, pos.z - 0.4, pos.z + 0.4); } catch { /* ignora */ }
    npcs.push({
      id: s.id, kind: s.kind, name: s.name || NPC_NAMES[s.id] || 'Aldeão',
      root: m.root, pivots, base, pos, homeYaw: s.yaw || 0,
      phase: Math.random() * 10, headYaw: 0, talking: false, talks: 0, hide: 0,
    });
  }
}
const npcById = (id) => npcs.find((n) => n.id === id);

function miraHiding() {
  return !state.miraCleared;
}
function updateNPCs(dt) {
  const pp = player.position;
  for (const n of npcs) {
    const t = gameTime + n.phase;
    const dx = pp.x - n.pos.x, dz = pp.z - n.pos.z;
    const dist = Math.hypot(dx, dz);
    // culling por distância (névoa esconde; cada NPC custa ~50 draw calls)
    const far = n.culled ? dist > CULL_IN : dist > CULL_OUT;
    if (far !== !!n.culled) { n.culled = far; n.root.visible = !far; }
    if (far) continue;
    const toPlayer = Math.atan2(dx, dz);
    const r = n.root.rotation;
    if (n.talking) r.y = lerpAngle(r.y, toPlayer, damp(6, dt));
    else if (dist < 4) r.y = lerpAngle(r.y, toPlayer, damp(1.2, dt));
    else r.y = lerpAngle(r.y, n.homeYaw, damp(0.8, dt));
    const rel = wrapAngle(toPlayer - r.y);
    const wantHead = (dist < 8 && Math.abs(rel) < 2.2) ? clamp(rel, -1.0, 1.0) : Math.sin(t * 0.35) * 0.35;
    n.headYaw = lerp(n.headYaw, wantHead, damp(4, dt));
    const P = n.pivots, B = n.base;
    if (P.head && B.head) { P.head.rotation.y = B.head.y + n.headYaw; P.head.rotation.x = B.head.x + Math.sin(t * 1.1) * 0.04; }
    if (P.torso && B.torso) P.torso.rotation.x = B.torso.x + Math.sin(t * 2.0) * 0.03;
    if (P.armL && B.armL) P.armL.rotation.z = B.armL.z + 0.05 + Math.sin(t * 2.0) * 0.03;
    if (P.armR && B.armR) {
      P.armR.rotation.z = B.armR.z - 0.05 - Math.sin(t * 2.0) * 0.03;
      P.armR.rotation.x = B.armR.x + (n.talking ? -0.4 - Math.sin(t * 5) * 0.3 : 0);
    }
    // Mira escondida: agachada e tremendo
    const hide = n.id === 'mira' && miraHiding() && !n.talking ? 1 : 0;
    n.hide = lerp(n.hide, hide, damp(3, dt));
    n.root.scale.y = 1 - 0.2 * n.hide;
    r.z = n.hide * Math.sin(t * 40) * 0.025;
  }
}

// ---------------------------------------------------------------------------
// Baús
// ---------------------------------------------------------------------------
const chests = [];
function spawnChests() {
  for (const s of spawns.chests || []) {
    let m;
    try { m = models.createChest(); } catch (e) { warnOnce('models.createChest', e); continue; }
    if (!m || !m.root) continue;
    const pos = (s.position || new V3()).clone();
    pos.y = safeHeight(pos.x, pos.z);
    m.root.position.copy(pos);
    m.root.rotation.y = s.yaw || 0;
    m.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(m.root);
    try { world.addBoxCollider?.(pos.x - 0.55, pos.x + 0.55, pos.z - 0.55, pos.z + 0.55); } catch { /* ignora */ }
    chests.push({ id: s.id, contents: s.contents, root: m.root, lid: m.lid || null, pos, opened: false, open: 0 });
  }
}
function updateChests(dt) {
  const pp = player.position;
  for (const c of chests) {
    const d = hdist(c.pos, pp);
    const far = c.culled ? d > CULL_IN : d > CULL_OUT;
    if (far !== !!c.culled) { c.culled = far; c.root.visible = !far; }
    if (c.opened && c.open < 1) {
      c.open = Math.min(1, c.open + dt * 1.6);
      const e = 1 - Math.pow(1 - c.open, 3);
      if (c.lid) c.lid.rotation.x = -1.9 * e;
    }
  }
}
const CHEST_ITEMS = {
  key: ['Chave Pequena', 'Abre uma porta trancada deste lugar. Só funciona aqui — chaves de templo são ciumentas.'],
  gem_red: ['Gema Vermelha', 'Vale 20 gemas! Brilha como se soubesse disso.'],
  gem_blue: ['Gema Azul', 'Vale 5 gemas.'],
  gem_green: ['Gema Verde', 'Vale 1 gema. Todo império começa assim.'],
  heart_container: ['Contêiner de Coração', 'Seu vigor aumentou! Você ganhou mais um coração.'],
  heart: ['Coração', 'Recupera um pouco de vida.'],
};
function openChest(c) {
  runSequence(async () => {
    c.opened = true;
    const pp = player.position;
    const yaw = Math.atan2(c.pos.x - pp.x, c.pos.z - pp.z);
    player.yaw = yaw;
    if (player.root) player.root.rotation.y = yaw;
    sfx('chest');
    await wait(0.6);
    // item sobe de dentro do baú
    const show = makePickupMesh(c.contents || 'gem_green');
    show.position.set(c.pos.x, c.pos.y + 0.4, c.pos.z);
    scene.add(show);
    const fx = { t: 0, m: show, y0: c.pos.y + 0.4 };
    risingFx.push(fx);
    await wait(0.8);
    switch (c.contents) {
      case 'key':
        state.keys++;
        if (stageIdx(state.stage) >= stageIdx('inside') || curZoneId === 'temple') { state.stage = stageIdx(state.stage) < stageIdx('inside') ? 'inside' : state.stage; setStage('gate'); }
        break;
      case 'gem_red': addGems(20); break;
      case 'gem_blue': addGems(5); break;
      case 'gem_green': addGems(1); break;
      case 'heart': call(player, 'heal', 'player', 2); break;
      case 'heart_container': addHeartContainer(); break;
      default: addGems(20);
    }
    const [title, desc] = CHEST_ITEMS[c.contents] || CHEST_ITEMS.gem_red;
    await itemGet(title, desc);
    scene.remove(show);
    const i = risingFx.indexOf(fx);
    if (i >= 0) risingFx.splice(i, 1);
  });
}
const risingFx = [];
function updateRisingFx(dt) {
  for (const f of risingFx) {
    f.t += dt;
    f.m.position.y = f.y0 + Math.min(1, f.t * 1.4) * 1.3;
    f.m.rotation.y += dt * 3;
  }
}

// ---------------------------------------------------------------------------
// Cortáveis (grama / vasos)
// ---------------------------------------------------------------------------
const cutState = new Map(); // cuttable -> cutAt
function updateCuttables() {
  const list = world.cuttables;
  if (!Array.isArray(list) || !list.length) return;
  let atk = null;
  try { atk = player.getAttack?.(); } catch (e) { warnOnce('player.getAttack', e); }
  if (!atk || !atk.center) return;
  const c = atk.center, r = (atk.radius || 1.2) + 0.45;
  for (const ct of list) {
    if (!ct || ct.alive === false || !ct.position) continue;
    const dx = ct.position.x - c.x, dz = ct.position.z - c.z;
    if (dx * dx + dz * dz > r * r) continue;
    if (Math.abs((ct.position.y || 0) - c.y) > 2.2) continue;
    ct.alive = false;
    if (ct.mesh) ct.mesh.visible = false;
    cutState.set(ct, gameTime);
    const isPot = /pot|vaso/i.test(String(ct.type || ct.kind || ct.mesh?.name || ''));
    burst(ct.position, isPot ? 8 : 7, isPot ? 'pot' : 'leaf');
    sfx('grassCut');
    rollLoot(ct.position, [['gem_green', 0.30], ['heart', 0.08], ['gem_blue', 0.03]]);
  }
}
let regrowTimer = 0;
function regrowCuttables(dt) {
  regrowTimer -= dt;
  if (regrowTimer > 0) return;
  regrowTimer = 3;
  const pp = player.position;
  for (const [ct, at] of cutState) {
    if (gameTime - at > 120 && hdist(ct.position, pp) > 30) {
      ct.alive = true;
      if (ct.mesh) ct.mesh.visible = true;
      cutState.delete(ct);
    }
  }
}

// ---------------------------------------------------------------------------
// Inimigos (spawn, respawn, guardas da Mira, chefe)
// ---------------------------------------------------------------------------
const enemyRecords = [];
const isDead = (e) => !e || e.alive === false;
function miraPos() {
  const n = npcById('mira');
  if (n) return n.pos;
  const s = (spawns.npcs || []).find((x) => x.id === 'mira');
  return s ? s.position : new V3(-140, 0, -130);
}
function spawnEnemyFrom(s) {
  try {
    return enemies.spawn(s.type, s.position.clone(), { night: !!s.night });
  } catch (e) { warnOnce('enemies.spawn', e); return null; }
}
function spawnAllEnemies() {
  enemyRecords.length = 0;
  const mp = miraPos();
  let guards = 0;
  for (const s of spawns.enemies || []) {
    if (!s || !s.position) continue;
    const guard = !s.night && hdist(s.position, mp) < 20;
    if (guard && state.miraCleared) continue;
    let zid = 'field';
    try { zid = world.getZone(s.position.x, s.position.z)?.id || 'field'; } catch { /* ignora */ }
    const e = spawnEnemyFrom(s);
    if (guard) guards++;
    enemyRecords.push({ spawn: s, enemy: e, guard, deadAt: -1, respawnable: !guard && zid !== 'temple' && zid !== 'boss' });
  }
  if (guards === 0) state.miraCleared = true;
  lastNight = null; // força setNight
}
let enemyCheckTimer = 0;
function checkEnemyRecords(dt) {
  enemyCheckTimer -= dt;
  if (enemyCheckTimer > 0) return;
  enemyCheckTimer = 0.5;
  // clareira da Mira
  if (!state.miraCleared) {
    const guards = enemyRecords.filter((r) => r.guard);
    if (guards.every((r) => isDead(r.enemy))) {
      state.miraCleared = true;
      if (hdist(player.position, miraPos()) < 45) {
        U('toast', 'A clareira de Mira está segura!');
        sfx('secret');
      }
      pendingLumeAlert = true;
    }
  }
  // respawn de inimigos do campo após alguns minutos, longe do herói
  const pp = player.position;
  for (const r of enemyRecords) {
    if (!r.respawnable) continue;
    if (!isDead(r.enemy)) continue;
    if (r.deadAt < 0) { r.deadAt = gameTime; continue; }
    if (gameTime - r.deadAt > 150 && hdist(r.spawn.position, pp) > 55) {
      r.enemy = spawnEnemyFrom(r.spawn);
      r.deadAt = -1;
      call(enemies, 'setNight', 'enemies', !!call(world, 'isNight', 'world'));
    }
  }
}
function onKill(enemy) {
  try {
    if (!enemy) return;
    if (enemy.isBoss || enemy === state.boss) { onBossDefeated(); return; }
    if (enemy === lockTarget) setLock(null);
    const pos = enemy.position || enemy.root?.position;
    if (!pos) return;
    const lowHp = (player.hp || 0) <= 2;
    rollLoot(pos, [['heart', lowHp ? 0.35 : 0.15], ['gem_green', 0.35], ['gem_blue', 0.10], ['gem_red', 0.015]]);
  } catch (e) { warnOnce('onKill', e); }
}

function startBoss() {
  if (state.bossSpawned || state.bossDefeated) return;
  state.bossSpawned = true;
  const bp = (spawns.boss || new V3(0, 12, -245)).clone();
  bp.y = safeHeight(bp.x, bp.z);
  try { state.boss = enemies.spawnBoss(bp); } catch (e) { warnOnce('enemies.spawnBoss', e); state.boss = null; }
  setStage('boss');
  curMusic = 'boss';
  A('setMusic', 'boss');
  U('showBossBar', BOSS_NAME, 1);
  runSequence(async () => {
    const pp = player.position;
    const dir = new V3(pp.x - bp.x, 0, pp.z - bp.z);
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
    dir.normalize();
    cam.override = {
      pos: new V3(pp.x + dir.x * 5 + dir.z * 3, pp.y + 3.5, pp.z + dir.z * 5 - dir.x * 3),
      look: new V3(bp.x, bp.y + 3.5, bp.z),
    };
    await wait(0.5);
    sfx('bossRoar');
    U('showBanner', BOSS_NAME, 'Sentinela da Raiz Antiga');
    await wait(2.4);
  });
}
async function onBossDefeated() {
  if (state.bossDefeated) return;
  state.bossDefeated = true;
  setLock(null);
  U('showBossBar', null, null);
  curMusic = 'temple';
  A('setMusic', 'temple');
  U('toast', 'O Guardião Musgoso desmoronou!');
  await wait(3.0); // o golem desmorona/explode ~2.6 s após o golpe final
  const bp = (spawns.boss || new V3(0, 12, -245)).clone();
  bp.y = safeHeight(bp.x, bp.z);
  sfx('secret');
  burst(new V3(bp.x, bp.y + 0.5, bp.z), 14, 'spark');
  spawnPickup('heart_container', bp, { persistent: true, victory: true, glow: true });
  pendingLumeAlert = true;
}
function victorySequence() {
  runSequence(async () => {
    addHeartContainer();
    await itemGet('Contêiner de Coração', 'O coração do santuário agora bate com o seu. Mais um coração!');
    await say('Lume', [
      'Você conseguiu!! O vento... sente? Está soprando do norte outra vez!',
      'O Guardião só estava protegendo a Raiz — e cochilou por uns trezentos anos. Acontece com os melhores.',
      'Valdora vai cantar sobre isso. Provavelmente desafinado, mas vai.',
    ]);
  }).then(() => {
    state.stage = 'victory';
    mode = 'victory';
    call(player, 'freeze', 'player', true);
    setLock(null);
    setPrompt(null);
    call(input, 'exitLock', 'input');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignora */ }
    sfx('victory');
    curMusic = 'village';
    A('setMusic', 'village');
    U('showVictory');
  });
}

// ---------------------------------------------------------------------------
// Lume (companheira)
// ---------------------------------------------------------------------------
const lume = { root: null, light: null, base: 1, pos: new V3(), wants: false, t: 0, init: false };
function spawnLume() {
  try {
    const w = models.createWisp();
    lume.root = w?.root || null;
    lume.light = w?.light || null;
  } catch (e) { warnOnce('models.createWisp', e); }
  if (!lume.root) {
    lume.root = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ color: 0xcff6ff }));
    lume.light = new THREE.PointLight(0x9fe9ff, 1.2, 6, 2);
    lume.root.add(lume.light);
  }
  lume.base = lume.light?.intensity || 1;
  scene.add(lume.root);
}
function updateLume(dt) {
  if (!lume.root) return;
  lume.t += dt;
  const t = lume.t;
  const pp = player.position;
  const target = _lumeT;
  if (lockTarget && !isDead(lockTarget) && lockTarget.position) {
    const h = (lockTarget.height || 1.5) + 0.7;
    target.set(lockTarget.position.x + Math.cos(t * 3) * 0.5, lockTarget.position.y + h + Math.sin(t * 5) * 0.1, lockTarget.position.z + Math.sin(t * 3) * 0.5);
  } else {
    const y = playerYaw();
    const fx = Math.sin(y), fz = Math.cos(y);
    const rx = -fz, rz = fx;
    const hop = lume.wants ? Math.abs(Math.sin(t * 6)) * 0.35 : 0;
    target.set(
      pp.x + rx * 0.6 - fx * 0.25 + Math.sin(t * 1.7) * 0.15,
      pp.y + 1.95 + Math.sin(t * 2.3) * 0.12 + hop,
      pp.z + rz * 0.6 - fz * 0.25 + Math.cos(t * 1.3) * 0.15,
    );
  }
  if (!lume.init) { lume.pos.copy(target); lume.init = true; }
  lume.pos.lerp(target, damp(lockTarget ? 5 : 4, dt));
  lume.root.position.copy(lume.pos);
  // com a câmera encostada (paredes/corredores) a Lume tamparia a visão: some quando muito perto
  const cd = camera.position.distanceTo(lume.pos);
  const ls = clamp((cd - 1.1) / 1.6, 0, 1);
  lume.root.visible = ls > 0.05 && cd < CULL_OUT;
  lume.root.scale.setScalar(Math.max(0.05, ls));
  if (lume.light) {
    const pulse = lume.wants ? 0.5 + 0.5 * Math.sin(t * 8) : 0.15 * Math.sin(t * 3);
    lume.light.intensity = lume.base * (1 + pulse * 0.6);
  }
}
const _lumeT = new V3();

function lumeHintPages() {
  const s = state.stage;
  const night = !!call(world, 'isNight', 'world');
  let pages;
  switch (s) {
    case 'start':
      pages = [
        'Ei! Ei! Acordou? Que bom! Eu sou a Lume, sua luz particular. Literalmente.',
        'O ancião Orvo está procurando você. Ele fica aqui mesmo na Vila Brisa, perto do poço. Chegue pertinho e aperte E para conversar.',
        'Lembrete rápido: WASD anda, Shift corre, J (ou clique) ataca, K defende, Espaço rola e Q trava a mira num inimigo. Eu cuido do brilho.',
      ];
      break;
    case 'mira':
      pages = state.miraCleared ? [
        'A clareira está segura! Vá falar com a Mira antes que ela resolva se esconder de novo.',
      ] : [
        'A Mira mora no Bosque Sussurrante, a noroeste da vila. É aquele ponto amarelo distante no minimapa.',
        'Ouvi dizer que goblins e umas plantas mal-humoradas cercaram a clareira dela. Prepare a espada!',
        'Dica de luz experiente: aperte Q para travar a mira e circular o inimigo. Rolar (Espaço) também é uma ótima forma de não levar pancada.',
      ];
      break;
    case 'temple':
      pages = [
        'O Santuário da Raiz fica no alto da colina, ao norte da vila. Não tem como errar: é a porta de pedra gigante com cara de que não quer abrir.',
        `Chegue pertinho dela, aperte F e toque a Canção do Santuário: ${notesStr('santuario')}.`,
      ];
      break;
    case 'inside':
      pages = state.keys > 0 ? [
        'Você tem uma Chave Pequena! O portão trancado fica mais ao fundo, ao norte do salão de entrada.',
      ] : [
        'Que lugar úmido... Tem cheiro de segredo. E de mofo. Mas principalmente de segredo.',
        'O portão lá no fundo está trancado. Procure um baú — talvez numa sala lateral, a oeste do salão de entrada.',
      ];
      break;
    case 'gate':
      pages = [
        'Chave na mão! O portão trancado fica ao norte do salão de entrada. Chegue perto e aperte E.',
        'Do outro lado... sinto algo enorme respirando. Que tal conferir seus corações antes?',
      ];
      break;
    case 'boss':
      pages = state.bossDefeated ? [
        'Você conseguiu!! Pegue o Contêiner de Coração no centro da arena, vai!',
      ] : [
        'É o Guardião Musgoso! Quando ele socar o chão, fica atordoado e o núcleo brilhante aparece.',
        'Trave a mira com Q e ataque o núcleo! E role para longe quando ele erguer os braços — eu ficaria longe, mas eu sou só uma luz.',
      ];
      break;
    default:
      pages = ['Conseguimos! Quer dizer... você conseguiu. Eu brilhei com muito entusiasmo, o que também conta.'];
  }
  pages = pages.slice();
  if (night && state.songs.has('aurora') && s !== 'victory') {
    pages.push(`Psiu: está de noite. Esqueletos adoram passear pelos campos. Se quiser o dia de volta, toque a Canção da Aurora: ${notesStr('aurora')}.`);
  }
  if ((player.hp || 0) <= 2 && playerAlive()) {
    pages.unshift('Você está bem machucado! Corte grama ou procure corações antes de seguir. Eu espero. Eu sempre espero.');
  }
  return pages;
}
function talkToLume() {
  lume.wants = false;
  runSequence(async () => { await say('Lume', lumeHintPages()); });
}

// ---------------------------------------------------------------------------
// Diálogos dos NPCs
// ---------------------------------------------------------------------------
function facePlayerTo(n) {
  const pp = player.position;
  const yaw = Math.atan2(n.pos.x - pp.x, n.pos.z - pp.z);
  player.yaw = yaw;
  if (player.root) player.root.rotation.y = yaw;
}
function talkTo(n) {
  runSequence(async () => {
    n.talking = true;
    facePlayerTo(n);
    try {
      switch (n.id) {
        case 'orvo': await talkOrvo(n); break;
        case 'mira': await talkMira(n); break;
        case 'tila': await talkTila(n); break;
        case 'brom': await talkBrom(n); break;
        default: await say(n.name, ['Bom dia! Ou boa tarde. Ou boa noite. Eu perco a noção do tempo aqui na vila.']);
      }
    } finally {
      n.talking = false;
      n.talks++;
    }
  });
}

async function talkOrvo(n) {
  const nm = n.name;
  if (!player.hasInstrument) {
    await say(nm, [
      'Ah! Finalmente acordou. Você dormiu tanto que o galo desistiu e foi cantar na vila vizinha.',
      'Sou Orvo, guardião das velhas canções da Vila Brisa. E essa luzinha tagarela ao seu lado é a Lume. Ela escolheu você. Não me pergunte por quê.',
      'Escute bem: há dias o vento parou de soprar do norte. O Santuário da Raiz está selado, e algo lá dentro ronca feito pedra rolando morro abaixo.',
      'Sem vento, os moinhos param, as pipas murcham e o Brom fica sem assunto. Isso nós não podemos permitir.',
      'Tome. Era do meu avô, que era do avô dele, que achou numa barraquinha de feira. Não conte para ninguém.',
    ]);
    player.hasInstrument = true;
    state.flags.flute = true;
    await itemGet('Flauta dos Ventos', 'Uma flauta antiga que guarda a voz do vento. Aperte F para tocar e use as teclas 1 a 5 para as notas.');
    await say(nm, [
      'Agora, uma canção. Esta faz o sol e a lua trocarem de turno. Ouça com atenção — só vou tocar uma vez.',
      'Bom, duas. Três, se você fizer essa cara de perdido.',
    ]);
    await learnSong('aurora');
    await say(nm, [
      `Para tocá-la: aperte F para levar a flauta à boca e toque ${notesStr('aurora')}. Esc ou F de novo guarda a flauta.`,
      'Já a Canção do Santuário, a que desperta as portas da Raiz... eu esqueci. É a idade. Ou o chá. Provavelmente o chá.',
      'Mas minha neta Mira sabe de cor! Ela vive numa clareira no Bosque Sussurrante, a noroeste daqui.',
      'Vá até ela. E leve a espada: o bosque anda de muito mau humor ultimamente.',
    ]);
    setStage('mira');
    return;
  }
  if (!state.songs.has('aurora')) {
    await say(nm, ['Ah, quase esqueci a canção! Ouça:']);
    await learnSong('aurora');
    return;
  }
  const s = state.stage;
  if (s === 'start' || s === 'mira') {
    await say(nm, [
      'A Mira fica no Bosque Sussurrante, a noroeste. Siga as árvores que cochicham.',
      'Se elas pararem de cochichar... corra.',
    ]);
  } else if (s === 'temple') {
    await say(nm, [
      'Você aprendeu a Canção do Santuário! Eu sabia que a Mira não ia esquecer. Ela puxou à avó.',
      'Toque-a diante da grande porta de pedra, no alto da colina ao norte. E limpe os pés antes de entrar.',
    ]);
  } else if (s === 'inside' || s === 'gate') {
    await say(nm, [
      'O santuário é antigo e cheio de portas teimosas. Procure uma chave: os antigos adoravam esconder chaves em baús.',
      'Muito original da parte deles, eu sei.',
    ]);
  } else if (s === 'boss') {
    await say(nm, state.bossDefeated
      ? ['Sinto o vento voltando! Vá até o fim, criança, e traga o coração do santuário consigo.']
      : ['Sinto o chão tremendo até aqui. Seja corajoso... e rápido. Principalmente rápido.']);
  } else {
    await say(nm, ['O vento voltou a soprar! As canções vão falar de você. Desafinadas, mas vão.']);
  }
}

async function talkMira(n) {
  const nm = n.name;
  if (!state.miraCleared) {
    await say(nm, n.talks === 0 ? [
      'Psiu! Aqui embaixo! Não, mais pra cá! ...Cuidado, quase pisou em mim!',
      'Goblins e umas plantas mordedoras cercaram minha clareira. Estou escondida atrás deste tronco faz dois dias.',
      'Só comi cogumelo. Cogumelo no café, cogumelo no almoço, cogumelo na janta. Estou começando a entender os cogumelos.',
      'Se você der um jeito neles, eu te ensino uma coisa que vale a pena. Promessa de neta do Orvo!',
    ] : [
      'Ainda tem bicho rondando por aqui! Eu ouço eles mastigando... sabe-se lá o quê.',
      'Derrote todos os inimigos da clareira e volte. Eu fico aqui, sendo muito corajosa. Escondida, mas corajosa.',
    ]);
    return;
  }
  if (!state.songs.has('santuario')) {
    if (!player.hasInstrument) {
      await say(nm, [
        'Você me salvou! A clareira está quieta de novo. Até os pássaros voltaram — os mal-educados, mas voltaram.',
        'Eu queria te ensinar uma canção, mas você nem tem instrumento! Fale com meu avô, o Orvo, na Vila Brisa.',
      ]);
      return;
    }
    await say(nm, [
      'Você conseguiu! A clareira está quieta de novo. Até os pássaros voltaram — os mal-educados, mas voltaram.',
      'O vovô Orvo te mandou, não foi? E aposto que ele esqueceu a canção de novo. Típico.',
      'Essa flauta... é a Flauta dos Ventos! Então preste atenção. Esta é a Canção do Santuário. Ela acorda as portas antigas.',
    ]);
    await learnSong('santuario');
    await say(nm, [
      `As notas são ${notesStr('santuario')}. Toque bem diante da porta de pedra do Santuário da Raiz, no alto da colina ao norte da vila.`,
      'E cuidado lá dentro. Dizem que o guardião dorme há tanto tempo que criou musgo até nas ideias.',
    ]);
    setStage('temple');
    return;
  }
  const s = state.stage;
  if (stageIdx(s) <= stageIdx('temple')) {
    await say(nm, [
      'O santuário fica ao norte da vila, no alto da colina. Toque a Canção do Santuário diante da porta.',
      'Se ela não abrir, toque mais alto. Brincadeira. Ou não.',
    ]);
  } else if (s === 'victory') {
    await say(nm, ['O bosque está cochichando sobre você! Coisas boas. Na maior parte.']);
  } else {
    await say(nm, ['Vá, herói! E me traga uma lembrancinha do templo. Uma pedrinha serve. Uma pedrinha bonita.']);
  }
}

const TILA_LINES = [
  ['Você viu? A Lume brilha mais quando você corta grama! ...Acho. Pode ser impressão minha.'],
  ['Meu irmão diz que, à noite, esqueletos saem pra dançar no campo.', 'Eu acho que eles só querem fazer amigos. Amigos bem magrinhos.'],
  ['Aposto que você não consegue cortar TODA a grama da vila.', '...Por favor, não corte toda a grama da vila. O Brom vende a grama.'],
  ['O vovô Orvo toca uma música e o dia vira noite! Ele faz isso quando quer que eu vá dormir mais cedo.', 'Eu descobri o truque. Agora eu durmo de olhos abertos.'],
  ['Quando eu crescer, quero ser uma lenda. Ou padeira. Lenda-padeira.'],
];
async function talkTila(n) {
  const lines = TILA_LINES[n.talks % TILA_LINES.length];
  if (state.stage === 'victory') {
    await say(n.name, ['Você derrotou o guardião?! Me ensina? Eu tenho um graveto aqui que é praticamente uma espada.']);
    return;
  }
  await say(n.name, lines);
}

const BROM_PRICE = 100;
async function talkBrom(n) {
  const nm = n.name;
  if (state.flags.bromSold) {
    await say(nm, [
      'Estoque esgotado! Volte semana que vem. Ou ano que vem. Ou quando o vento trouxer mercadoria.',
      'Enquanto isso, aceito elogios. Elogios são de graça. Por enquanto.',
    ]);
    return;
  }
  const pages = [
    'Bem-vindo à Barraca do Brom! Temos de tudo! ...Bom, temos uma coisa.',
    'Um Contêiner de Coração legítimo! Aumenta sua vitalidade. Garantia de três dias ou até levar uma pancada de golem, o que vier primeiro.',
  ];
  if (state.gems >= BROM_PRICE) {
    pages.push(`Custa ${BROM_PRICE} gemas. E pelo brilho da sua bolsa, você tem! Fale comigo de novo (E) e ele é seu.`);
  } else {
    pages.push(`Custa ${BROM_PRICE} gemas. Você tem ${state.gems}. Corte umas gramas por aí — os bichos do campo também andam carregando trocados.`);
  }
  await say(nm, pages);
  state.flags.bromPitched = true;
}
async function buyFromBrom(n) {
  if (state.gems < BROM_PRICE || state.flags.bromSold) return;
  n.talking = true;
  facePlayerTo(n);
  try {
    addGems(-BROM_PRICE);
    state.flags.bromSold = true;
    await say(n.name, ['Negócio fechado! Foi um prazer. Sem devoluções, sem reclamações, sem embrulho pra presente.']);
    addHeartContainer();
    await itemGet('Contêiner de Coração', 'Seu vigor aumentou! Você ganhou mais um coração. (Comprado, mas conta igual.)');
  } finally { n.talking = false; }
}

// ---------------------------------------------------------------------------
// Interações (prompt + E)
// ---------------------------------------------------------------------------
function findInteraction() {
  const pp = player.position;
  let best = null, bd = Infinity;
  for (const n of npcs) {
    const d = hdist(n.pos, pp);
    if (d < 2.5 && d < bd && Math.abs(n.pos.y - pp.y) < 3) {
      bd = d;
      const buy = n.id === 'brom' && state.flags.bromPitched && !state.flags.bromSold && state.gems >= BROM_PRICE;
      best = buy ? { kind: 'buy', npc: n, text: `E  Comprar (${BROM_PRICE} gemas)` } : { kind: 'npc', npc: n, text: 'E  Falar' };
    }
  }
  for (const c of chests) {
    if (c.opened) continue;
    const d = hdist(c.pos, pp);
    if (d < 2.2 && d < bd && Math.abs(c.pos.y - pp.y) < 2.5) { bd = d; best = { kind: 'chest', chest: c, text: 'E  Abrir' }; }
  }
  const gate = world.bossGate;
  if (gate && !gate.isOpen && gate.position) {
    const d = hdist(gate.position, pp);
    if (d < 4.5 && d < bd) {
      bd = d;
      best = state.keys > 0 ? { kind: 'gate', text: 'E  Destrancar' } : { kind: 'locked', text: 'Trancado — precisa de uma chave' };
    }
  }
  const door = world.templeDoor;
  if (door && !door.isOpen && door.position) {
    const d = hdist(door.position, pp);
    if (d < 8 && d < bd) { bd = d; best = { kind: 'door', text: 'Porta selada — toque uma canção (F)' }; }
  }
  return best;
}
function doInteraction(it) {
  if (!it) return;
  switch (it.kind) {
    case 'npc': talkTo(it.npc); break;
    case 'buy': runSequence(() => buyFromBrom(it.npc)); break;
    case 'chest': openChest(it.chest); break;
    case 'gate': unlockGate(); break;
    case 'locked': sfx('error'); U('toast', 'Está trancado. Uma Chave Pequena resolveria isso.'); break;
    case 'door':
      sfx('error');
      U('toast', state.songs.has('santuario') ? 'A porta parece esperar uma canção...' : 'Uma porta antiga e silenciosa. Talvez alguém saiba como despertá-la.');
      break;
  }
}
function unlockGate() {
  const gate = world.bossGate;
  if (!gate || gate.isOpen || state.keys <= 0) return;
  runSequence(async () => {
    state.keys--;
    sfx('unlock');
    const gp = gate.position;
    const pp = player.position;
    const dir = new V3(pp.x - gp.x, 0, pp.z - gp.z);
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
    dir.normalize();
    cam.override = {
      pos: new V3(gp.x + dir.x * 6 + dir.z * 2.5, safeHeight(pp.x, pp.z) + 3, gp.z + dir.z * 6 - dir.x * 2.5),
      look: new V3(gp.x, safeHeight(gp.x, gp.z) + 2, gp.z),
    };
    await wait(0.6);
    call(gate, 'open', 'bossGate');
    sfx('door');
    await wait(1.6);
    setStage('boss');
  });
}

// ---------------------------------------------------------------------------
// Flauta / canções
// ---------------------------------------------------------------------------
const inst = { open: false, buf: [], busy: false };
function openInstrument() {
  if (!player.hasInstrument) {
    sfx('error');
    U('toast', 'Você ainda não tem um instrumento.');
    return;
  }
  inst.open = true;
  inst.buf = [];
  inst.busy = false;
  setLock(null);
  setPrompt(null);
  call(player, 'setPlaying', 'player', true);
  U('showInstrument', true);
  U('clearNotes');
}
function closeInstrument() {
  if (!inst.open) return;
  inst.open = false;
  inst.busy = false;
  call(player, 'setPlaying', 'player', false);
  U('showInstrument', false);
  U('clearNotes');
}
function handleInstrumentNotes() {
  if (inst.busy) return;
  for (let i = 0; i < 5; i++) {
    if (!input.pressed('note' + (i + 1))) continue;
    A('playNote', i);
    U('pushNote', i);
    inst.buf.push(i);
    if (inst.buf.length > 16) inst.buf.shift();
    for (const key of state.songs) {
      const notes = SONG_DEFS[key]?.notes;
      if (!notes || inst.buf.length < notes.length) continue;
      const tail = inst.buf.slice(-notes.length);
      if (tail.every((v, j) => v === notes[j])) { performSong(key); return; }
    }
  }
}
async function performSong(key) {
  const d = SONG_DEFS[key];
  inst.busy = true;
  inst.buf = [];
  await wait(0.45);
  if (!inst.open || mode !== 'play') { inst.busy = false; return; }
  U('toast', `♪ ${d.name}`);
  A('playMelody', d.notes);
  await wait(d.notes.length * 0.42 + 0.7);
  inst.busy = false;
  closeInstrument();
  U('clearNotes');
  if (mode !== 'play' || !playerAlive()) return;
  applySong(key);
}
function applySong(key) {
  if (key === 'aurora') {
    const wasNight = !!call(world, 'isNight', 'world');
    call(world, 'toggleDayNight', 'world');
    sfx('secret');
    U('showBanner', SONG_DEFS.aurora.name, wasNight ? 'O sol desperta no horizonte' : 'A lua assume o turno');
  } else if (key === 'santuario') {
    const door = world.templeDoor;
    if (door && door.position && hdist(door.position, player.position) < 12) {
      if (!door.isOpen) templeDoorCutscene();
      else U('toast', 'A porta já está desperta.');
    } else {
      U('toast', 'Nada acontece aqui...');
    }
  }
}
function templeDoorCutscene() {
  const door = world.templeDoor;
  runSequence(async () => {
    const dp = door.position;
    const gy = Math.max(dp.y || 0, safeHeight(dp.x, dp.z + 4));
    cam.override = {
      pos: new V3(dp.x + 7, gy + 5, dp.z + 14),
      look: new V3(dp.x, gy + 3, dp.z),
    };
    await wait(1.0);
    call(door, 'open', 'templeDoor');
    sfx('door');
    await wait(2.4);
    sfx('secret');
    U('showBanner', 'Santuário da Raiz', 'A porta despertou!');
    await wait(1.2);
    setStage('inside');
  });
}

// ---------------------------------------------------------------------------
// Lock-on
// ---------------------------------------------------------------------------
function setLock(t) {
  lockTarget = t || null;
  call(player, 'setLockTarget', 'player', lockTarget);
}
function lockable(e) {
  return e && !isDead(e) && e.lockable !== false && e.position && e.root?.visible !== false;
}
function findLockTarget() {
  const pp = player.position;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const py = playerYaw();
  const px = Math.sin(py), pz = Math.cos(py);
  let best = null, bs = Infinity;
  for (const e of enemies.list || []) {
    if (!lockable(e)) continue;
    const dx = e.position.x - pp.x, dz = e.position.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (d > 20 || d < 1e-3) continue;
    const dot = Math.max((dx * fx + dz * fz) / d, (dx * px + dz * pz) / d);
    if (dot < -0.25 && d > 4) continue;
    const score = d * (1.8 - dot);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}
function toggleLock() {
  if (lockTarget) { setLock(null); return; }
  const t = findLockTarget();
  if (t) { setLock(t); sfx('lock'); }
  else cam.recenterT = 0.45;
}
function validateLock() {
  if (!lockTarget) return;
  if (player.lockTarget === null && lockTarget) { lockTarget = null; return; }
  if (!lockable(lockTarget) || hdist(lockTarget.position, player.position) > 25) setLock(null);
}
const _proj = new V3();
function updateReticle() {
  if (!lockTarget || mode !== 'play') { U('setLockOn', null); return; }
  _proj.copy(lockTarget.position);
  _proj.y += (lockTarget.height || 1.5) * 0.7;
  camera.updateMatrixWorld(); // a câmera acabou de mudar neste frame: evita retícula atrasada
  _proj.project(camera);
  if (_proj.z > 1 || _proj.z < -1) { U('setLockOn', null); return; }
  U('setLockOn', (_proj.x * 0.5 + 0.5) * window.innerWidth, (-_proj.y * 0.5 + 0.5) * window.innerHeight);
}

// ---------------------------------------------------------------------------
// Câmera 3ª pessoa
// ---------------------------------------------------------------------------
const SENS = 0.0024;
const cam = {
  yaw: 0, pitch: 0.3, dist: 6.5, curDist: 6.5,
  focus: new V3(), look: new V3(), recenterT: 0, override: null, blend: 1, snap: true,
};
const _cv1 = new V3(), _cv2 = new V3(), _cv3 = new V3(), _dir = new V3(), _probe = new V3(), _des = new V3();
function updateCamera(dt, mouse) {
  const p = player.position;
  const zid = curZoneId;
  const indoor = zid === 'temple' || zid === 'boss';
  _cv1.set(p.x, p.y + 1.5, p.z);
  if (cam.snap) cam.focus.copy(_cv1); else cam.focus.lerp(_cv1, damp(12, dt));

  if (cam.override) {
    // câmeras de cutscene também não atravessam paredes (raio da cabeça do herói até ela)
    _des.copy(cam.override.pos);
    if (camCol.ready) {
      _cv1.subVectors(_des, cam.focus);
      const L = _cv1.length();
      if (L > 0.8) {
        _cv1.divideScalar(L);
        const t = camCol.cast(cam.focus, _cv1, L);
        if (t < L) _des.copy(cam.focus).addScaledVector(_cv1, Math.max(0.7, t - 0.3));
      }
    }
    camera.position.lerp(_des, damp(3, dt));
    cam.look.lerp(cam.override.look, damp(4, dt));
    camera.lookAt(cam.look);
    cam.blend = 0;
    setLetterbox(true);
    return;
  }
  cam.blend = Math.min(1, cam.blend + dt * 1.4);

  const lt = lockTarget;
  if (mouse && !lt) {
    cam.yaw -= (mouse.x || 0) * SENS;
    cam.pitch += (mouse.y || 0) * SENS;
  }
  const lookPt = _cv2.copy(cam.focus);
  let maxD = indoor ? (zid === 'boss' ? 8.5 : 5.4) : cam.dist;
  if (lt && lt.position) {
    const tx = lt.position.x - p.x, tz = lt.position.z - p.z;
    if (tx * tx + tz * tz > 0.01) cam.yaw = lerpAngle(cam.yaw, Math.atan2(-tx, -tz), damp(5, dt));
    cam.pitch = lerp(cam.pitch, 0.3, damp(3, dt));
    _cv3.copy(lt.position);
    _cv3.y += (lt.height || 1.5) * 0.5;
    lookPt.lerp(_cv3, 0.42);
    maxD += indoor ? 0.6 : 1.0;
  } else if (cam.recenterT > 0) {
    cam.recenterT -= dt;
    cam.yaw = lerpAngle(cam.yaw, playerYaw() + Math.PI, damp(12, dt));
    cam.pitch = lerp(cam.pitch, 0.28, damp(8, dt));
  }
  cam.yaw = wrapAngle(cam.yaw);
  cam.pitch = clamp(cam.pitch, -0.35, indoor ? 0.95 : 1.15);
  setLetterbox(!!lt);

  const cp = Math.cos(cam.pitch);
  _dir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

  // ponto ideal (sem obstáculos), mantido acima do chão e abaixo do "teto" interno
  _des.copy(cam.focus).addScaledVector(_dir, maxD);
  const g0 = safeHeight(_des.x, _des.z);
  if (_des.y < g0 + 0.5) _des.y = g0 + 0.5;
  if (indoor) {
    const cap = safeHeight(p.x, p.z) + (zid === 'boss' ? 11 : 5.5);
    if (_des.y > cap) _des.y = cap;
  }
  _probe.subVectors(_des, cam.focus);
  const segLen = Math.max(0.01, _probe.length());
  _probe.divideScalar(segLen); // direção final (unitária)

  // colisão: raios do foco (cabeça) até o ponto ideal; encurta até o acerto - margem
  let allowed = segLen;
  if (camCol.ready) {
    // raio central + 4 raios deslocados (aproxima o volume do plano near da câmera)
    _cv3.set(_probe.z, 0, -_probe.x); // direita aproximada
    if (_cv3.lengthSq() < 1e-6) _cv3.set(1, 0, 0);
    _cv3.normalize();
    let frac = 1;
    for (let k = 0; k < 5; k++) {
      const ox = k === 1 ? 0.32 : k === 2 ? -0.32 : 0;
      const oy = k === 3 ? 0.25 : k === 4 ? -0.2 : 0;
      _cv1.copy(_des).addScaledVector(_cv3, ox);
      _cv1.y += oy;
      _cv1.sub(cam.focus);
      const L = _cv1.length();
      if (L < 1e-3) continue;
      _cv1.divideScalar(L);
      const t = camCol.cast(cam.focus, _cv1, L);
      if (t < L) frac = Math.min(frac, Math.max(0, t - 0.3) / L);
    }
    allowed = Math.max(0.7, segLen * frac);
  } else if (typeof world.resolveCollision === 'function') {
    // fallback antigo: marcha contra os colisores do mundo
    for (let s = 0.7; s <= segLen; s += 0.45) {
      _cv1.copy(cam.focus).addScaledVector(_probe, s);
      const ox = _cv1.x, oz = _cv1.z;
      try { world.resolveCollision(_cv1, 0.25); } catch (e) { warnOnce('world.resolveCollision', e); break; }
      if (Math.abs(_cv1.x - ox) + Math.abs(_cv1.z - oz) > 0.02) { allowed = Math.max(0.9, s - 0.45); break; }
    }
  }
  allowed = Math.min(allowed, segLen);
  // aproxima na hora (nunca fica dentro da parede); afasta suavemente
  if (cam.snap || allowed < cam.curDist) cam.curDist = allowed;
  else cam.curDist = lerp(cam.curDist, allowed, damp(2.6, dt));

  _des.copy(cam.focus).addScaledVector(_probe, cam.curDist);
  const g = safeHeight(_des.x, _des.z);
  if (_des.y < g + 0.35) _des.y = g + 0.35;

  // tremor de câmera (golpes do chefe etc.)
  const shake = Math.min(1, Number(enemies?.cameraShake) || 0);
  if (shake > 0.01) {
    const a = shake * shake * 0.22;
    _des.x += (Math.random() - 0.5) * a; _des.y += (Math.random() - 0.5) * a; _des.z += (Math.random() - 0.5) * a;
  }

  if (cam.snap) {
    camera.position.copy(_des);
    cam.look.copy(lookPt);
    cam.snap = false;
  } else {
    camera.position.lerp(_des, damp(lerp(3, 30, cam.blend), dt));
    cam.look.lerp(lookPt, damp(lerp(4, 28, cam.blend), dt));
    // a posição suavizada pode ter atravessado algo: confere de novo com um raio
    if (camCol.ready) {
      _cv1.subVectors(camera.position, cam.focus);
      const L = _cv1.length();
      if (L > 0.75) {
        _cv1.divideScalar(L);
        const t = camCol.cast(cam.focus, _cv1, L);
        if (t < L) camera.position.copy(cam.focus).addScaledVector(_cv1, Math.max(0.7, t - 0.3));
      }
    }
  }
  camera.lookAt(cam.look);
}
let titleAngle = 0;
function updateTitleCamera(dt) {
  titleAngle += dt * 0.06;
  const r = 42;
  const x = Math.sin(titleAngle) * r, z = Math.cos(titleAngle) * r;
  camera.position.set(x, safeHeight(x, z) + 16, z);
  camera.lookAt(0, 4, 0);
}

// ---------------------------------------------------------------------------
// Zonas / música
// ---------------------------------------------------------------------------
function musicFor(z) {
  if (!z) return null;
  if (z.id === 'boss') return state.bossSpawned && !state.bossDefeated ? 'boss' : 'temple';
  const night = !!call(world, 'isNight', 'world');
  if (night && (z.id === 'field' || z.music === 'field')) return 'night';
  return z.music || null;
}
function updateMusic() {
  if (mode !== 'play') return;
  const want = musicFor(curZone);
  if (want !== curMusic) {
    curMusic = want;
    A('setMusic', want);
  }
}
const lastZoneBanner = { name: null, t: -1e9 }; // praça 'temple_out' e interior têm o mesmo nome
function updateZone() {
  let z = null;
  try { z = world.getZone(player.position.x, player.position.z); } catch (e) { warnOnce('world.getZone', e); }
  if (!z) return;
  if (z.id !== curZoneId) {
    if (curZoneId) zoneLeftAt[curZoneId] = gameTime;
    curZoneId = z.id;
    curZone = z;
    if (z.id !== 'boss') {
      const last = zoneLeftAt[z.id];
      const sameName = z.name && z.name === lastZoneBanner.name && gameTime - lastZoneBanner.t < 25;
      if ((!visitedZones.has(z.id) || (last != null && gameTime - last > 20)) && !sameName) {
        U('showBanner', z.name || '', ZONE_SUB[z.id] || '');
        lastZoneBanner.name = z.name; lastZoneBanner.t = gameTime;
      }
    }
    visitedZones.add(z.id);
  }
  curZone = z;
  if (z.id === 'boss' && !state.bossSpawned && !state.bossDefeated && !busy && playerAlive()) startBoss();
  updateMusic();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudCache = { hp: null, max: null, gems: null, keys: null };
let minimapTimer = 0, clockTimer = 0, lowHpTimer = 0;
function syncHUD(dt) {
  const hp = Math.max(0, player.hp ?? 0), max = player.maxHearts ?? 3;
  if (hp !== hudCache.hp || max !== hudCache.max) { hudCache.hp = hp; hudCache.max = max; U('setHearts', hp, max); }
  if (state.gems !== hudCache.gems) { hudCache.gems = state.gems; U('setGems', state.gems); }
  if (state.keys !== hudCache.keys) { hudCache.keys = state.keys; U('setKeys', state.keys); }

  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.1;
    const pp = player.position;
    const markers = [];
    for (const n of npcs) markers.push({ x: n.pos.x, z: n.pos.z, color: '#ffd84a' });
    for (const c of chests) if (!c.opened) markers.push({ x: c.pos.x, z: c.pos.z, color: '#e0a030' });
    const door = world.templeDoor;
    if (door?.position) markers.push({ x: door.position.x, z: door.position.z, color: door.isOpen ? '#7fd6c2' : '#a6e4ff' });
    const gate = world.bossGate;
    if (gate?.position && !gate.isOpen && hdist(gate.position, pp) < 60) markers.push({ x: gate.position.x, z: gate.position.z, color: '#c99bff' });
    for (const e of enemies.list || []) {
      if (!lockable(e) && !e?.isBoss) continue;
      if (isDead(e) || !e.position) continue;
      if (hdist(e.position, pp) < 55) markers.push({ x: e.position.x, z: e.position.z, color: '#ff4040' });
    }
    for (const pk of pickups) if (pk.victory) markers.push({ x: pk.pos.x, z: pk.pos.z, color: '#ff8fb0' });
    U('updateMinimap', pp.x, pp.z, playerYaw(), markers);
  }
  clockTimer -= dt;
  if (clockTimer <= 0) {
    clockTimer = 0.25;
    U('setClock', world.timeOfDay ?? 0.5);
  }
  if (hp > 0 && hp <= 2 && mode === 'play') {
    lowHpTimer -= dt;
    if (lowHpTimer <= 0) { lowHpTimer = 1.5; sfx('lowHealth'); }
  } else lowHpTimer = 0.4;
}

// ---------------------------------------------------------------------------
// Morte / respawn
// ---------------------------------------------------------------------------
function villageSpawn() {
  const s = spawns.player ? spawns.player.clone() : new V3(0, 0, 12);
  s.y = safeHeight(s.x, s.z);
  return s;
}
function templeEntrance() {
  const d = world.templeDoor?.position;
  const p = d ? new V3(d.x, 0, d.z - 14) : new V3(0, 0, -189);
  p.y = safeHeight(p.x, p.z);
  return p;
}
function checkDeath() {
  if (dying || mode !== 'play') return;
  if ((player.hp ?? 1) > 0) return;
  dying = true;
  closeInstrument();
  setLock(null);
  setPrompt(null);
  (async () => {
    await wait(2.2);
    mode = 'gameover';
    U('showBossBar', null, null);
    U('setLockOn', null);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignora */ }
    try { await guardUi(U('showGameOver'), null, 3600); } catch { /* ignora */ }
    respawnAfterDeath();
    mode = 'play';
    dying = false;
    call(input, 'requestLock', 'input');
  })();
}
function respawnAfterDeath() {
  const inTemple = curZoneId === 'temple' || curZoneId === 'boss';
  let pos = inTemple ? templeEntrance() : villageSpawn();
  if (!inTemple && curZoneId === 'temple_out' && world.templeDoor?.position) {
    // morreu na praça do santuário: volta diante da porta
    const d = world.templeDoor.position;
    pos = new V3(d.x, 0, d.z + 7);
    pos.y = safeHeight(pos.x, pos.z);
  }
  try { player.respawn(pos); } catch (e) { warnOnce('player.respawn', e); player.position?.copy(pos); }
  fullHeal();
  call(player, 'freeze', 'player', false);
  // reset de inimigos
  call(enemies, 'clear', 'enemies');
  state.boss = null;
  if (!state.bossDefeated) state.bossSpawned = false;
  U('showBossBar', null, null);
  spawnAllEnemies();
  for (let i = pickups.length - 1; i >= 0; i--) if (!pickups[i].persistent) removePickup(pickups[i]);
  setLock(null);
  busy = false;
  cam.override = null;
  cam.yaw = playerYaw() + Math.PI;
  cam.pitch = 0.3;
  cam.snap = true;
  curZoneId = null;
  curMusic = undefined;
}

// ---------------------------------------------------------------------------
// Pausa
// ---------------------------------------------------------------------------
function setPaused(p) {
  if (p === paused) return;
  paused = p;
  pausedAt = performance.now();
  U('setPaused', p);
  if (!p) call(input, 'requestLock', 'input');
}
document.addEventListener('mousedown', () => {
  if (mode !== 'play') return;
  if (paused) { if (performance.now() - pausedAt > 250) setPaused(false); }
  else if (!input.pointerLocked) call(input, 'requestLock', 'input');
});

// ---------------------------------------------------------------------------
// Entrada por frame
// ---------------------------------------------------------------------------
function handleGlobalInput() {
  if (mode === 'play' && input.pressed('pause')) {
    if (paused) {
      if (performance.now() - pausedAt > 300) setPaused(false);
    } else if (inst.open) {
      if (!inst.busy) closeInstrument();
    } else {
      setPaused(true);
    }
  }
  const locked = !!input.pointerLocked;
  if (wasLocked && !locked && mode === 'play' && !paused) {
    if (inst.open && !inst.busy) closeInstrument();
    setPaused(true);
  }
  wasLocked = locked;
}
function handlePlayInput() {
  // diálogos/overlays abertos: E/ataque avançam
  if (busy) {
    if (input.pressed('interact') || input.pressed('attack')) {
      if (overlayCount > 0 || dialogOpen()) U('advanceDialog');
    }
    return;
  }
  if (dying || !playerAlive()) return;

  if (input.pressed('instrument')) {
    if (inst.open) { if (!inst.busy) closeInstrument(); }
    else openInstrument();
  }
  if (inst.open) { handleInstrumentNotes(); return; }

  if (input.pressed('lock')) toggleLock();
  if (input.pressed('wisp')) { talkToLume(); return; }
  if (input.pressed('interact')) doInteraction(findInteraction());
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function enemyArg() {
  const arr = Array.isArray(enemies.list) ? enemies.list.slice() : [];
  arr.list = arr;
  return arr;
}
function step(label, fn) {
  try { fn(); } catch (e) { warnOnce(label, e); }
}

function tick(dt) {
  if (mode === 'title' || mode === 'loading') {
    step('world.update', () => world.update(dt, spawns.player || new V3(0, 0, 12)));
    updateTitleCamera(dt);
    call(input, 'consumeMouse', 'input');
    return;
  }

  handleGlobalInput();
  if (paused) { call(input, 'consumeMouse', 'input'); return; }

  gameTime += dt;
  tickWaits(dt);
  tickWatchers(dt);

  let mouse = call(input, 'consumeMouse', 'input') || { x: 0, y: 0 };

  if (mode === 'play') {
    // 1. input
    step('input', handlePlayInput);
    // 2. player
    step('player.update', () => player.update(dt, input, cam.yaw, enemyArg()));
    // 3. enemies
    if (!busy) step('enemies.update', () => enemies.update(dt, player, onKill));
    // 4. world
    step('world.update', () => world.update(dt, player.position));
    const night = !!call(world, 'isNight', 'world');
    if (night !== lastNight) {
      const first = lastNight !== null;
      lastNight = night;
      call(enemies, 'setNight', 'enemies', night);
      if (first && night && !state.flags.sawNight) {
        state.flags.sawNight = true;
        U('toast', 'A noite caiu sobre Valdora. Cuidado com o que anda pelos campos...');
      }
    }
    // 5. entidades
    step('npcs', () => updateNPCs(dt));
    step('chests', () => updateChests(dt));
    step('risingFx', () => updateRisingFx(dt));
    step('cuttables', updateCuttables);
    step('regrow', () => regrowCuttables(dt));
    step('pickups', () => updatePickups(dt));
    step('particles', () => updateParticles(dt));
    step('lume', () => updateLume(dt));
    step('enemyRecords', () => checkEnemyRecords(dt));
    step('lock', validateLock);
    step('zone', updateZone);
    step('boss', () => {
      const b = state.boss;
      if (b && !state.bossDefeated) {
        if (isDead(b)) onBossDefeated();
        else U('showBossBar', BOSS_NAME, clamp((b.hp ?? 1) / (b.maxHp || 1), 0, 1));
      }
    });
    step('death', checkDeath);
    if (pendingLumeAlert && !busy && !inst.open) {
      pendingLumeAlert = false;
      // não empilha o mesmo aviso (ex.: chave + portão em sequência)
      if (!lume.wants || gameTime - (lume.alertAt ?? -1e9) > 20) {
        lume.alertAt = gameTime;
        U('toast', 'Lume quer falar (C)');
      }
      lume.wants = true;
    }
    // 6. câmera
    step('camera', () => updateCamera(dt, busy || inst.busy ? null : mouse));
    // 7. UI
    step('prompt', () => {
      if (busy || inst.open || dying || !playerAlive()) setPrompt(null);
      else setPrompt(findInteraction()?.text || null);
    });
    step('reticle', updateReticle);
    step('hud', () => syncHUD(dt));
  } else {
    // gameover / victory: mundo continua vivo, sem controle
    if (mode === 'victory') step('player.update', () => player.update(dt, input, cam.yaw, enemyArg()));
    step('world.update', () => world.update(dt, player.position));
    step('npcs', () => updateNPCs(dt));
    step('pickups', () => updatePickups(dt));
    step('particles', () => updateParticles(dt));
    step('lume', () => updateLume(dt));
    if (mode === 'victory') cam.yaw += dt * 0.15;
    step('camera', () => updateCamera(dt, null));
    step('hud', () => syncHUD(dt));
  }
}

let simSubsteps = 1; // só no modo ?debug (testes automatizados em máquinas lentas)
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const n = DEBUG ? clamp(simSubsteps | 0, 1, 30) : 1;
  for (let i = 0; i < n; i++) {
    try { tick(dt); } catch (e) { warnOnce('tick', e); }
    if (i < n - 1) { try { input.endFrame(); } catch (e) { warnOnce('input.endFrame', e); } }
  }
  try { renderer.render(scene, camera); } catch (e) { warnOnce('render', e); }
  try { input.endFrame(); } catch (e) { warnOnce('input.endFrame', e); }
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
function setupEntities() {
  step('camCol', () => camCol.build());
  step('spawnNPCs', spawnNPCs);
  step('spawnChests', spawnChests);
  step('spawnLume', spawnLume);
}
function onFirstGesture() {
  A('init');
  if (mode === 'title' && curMusic !== 'title') { curMusic = 'title'; A('setMusic', 'title'); }
  window.removeEventListener('pointerdown', onFirstGesture, true);
  window.removeEventListener('keydown', onFirstGesture, true);
}

async function start() {
  setupEntities();
  mode = 'title';
  window.addEventListener('pointerdown', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);
  requestAnimationFrame(frame);
  // remove a tela de carregamento após o primeiro frame
  requestAnimationFrame(() => {
    const ld = document.getElementById('loading');
    if (ld) { ld.style.opacity = '0'; setTimeout(() => ld.remove(), 450); }
  });
  try { await guardUi(U('showTitle'), null, Infinity); } catch (e) { warnOnce('ui.showTitle', e); }

  A('init');
  call(input, 'requestLock', 'input');
  step('spawnEnemies', spawnAllEnemies);
  mode = 'play';
  cam.yaw = playerYaw() + Math.PI;
  cam.pitch = 0.3;
  cam.snap = true;
  curMusic = undefined;
  hudCache.hp = null;
  // Lume se apresenta
  wait(3).then(() => { if (state.stage === 'start') pendingLumeAlert = true; });
}

// Debug
if (DEBUG) {
  window.addEventListener('keydown', (e) => {
    if (mode !== 'play' || busy) return;
    const pp = player.position;
    const tp = (x, z) => {
      pp.set(x, safeHeight(x, z), z);
      cam.snap = true;
      lume.init = false;
    };
    switch (e.code) {
      case 'KeyG':
        player.hasInstrument = true;
        state.songs.add('aurora'); state.songs.add('santuario');
        state.keys += 1;
        addGems(100);
        state.miraCleared = true;
        if (stageIdx(state.stage) < stageIdx('temple')) state.stage = 'temple';
        U('toast', 'DEBUG: flauta, canções, chave e gemas!');
        break;
      case 'KeyT': {
        const d = world.templeDoor?.position || new V3(0, 0, -175);
        tp(d.x, d.z + 6);
        player.yaw = Math.PI;
        cam.yaw = 0;
        break;
      }
      case 'KeyB': {
        call(world.templeDoor, 'open', 'templeDoor');
        call(world.bossGate, 'open', 'bossGate');
        const b = spawns.boss || new V3(0, 12, -245);
        tp(b.x, b.z + 15);
        player.yaw = Math.PI;
        cam.yaw = 0;
        break;
      }
      case 'KeyN': call(world, 'toggleDayNight', 'world'); break;
      case 'KeyH': fullHeal(); break;
    }
  });
}

window.game = {
  THREE, renderer, scene, camera, world, player, enemies, input, audio, ui, models,
  state, cam, npcs, chests, pickups, lume, inst, SONGS: SONG_DEFS, DEBUG,
  get mode() { return mode; },
  get paused() { return paused; },
  get busy() { return busy; },
  get lockTarget() { return lockTarget; },
  get zone() { return curZoneId; },
  get substeps() { return simSubsteps; },
  set substeps(v) { simSubsteps = v; },
  camCol,
  setStage: (s) => { state.stage = s; pendingLumeAlert = true; },
  spawnPickup: (type, x, z) => spawnPickup(type, new V3(x, safeHeight(x, z), z), { pop: true }),
  teleport: (x, z) => { player.position.set(x, safeHeight(x, z), z); cam.snap = true; lume.init = false; },
  playSong: (key) => applySong(key),
  learnSong: (key) => state.songs.add(key),
  startBoss,
};

start().catch(showFatal);
