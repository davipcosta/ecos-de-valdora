// Ecos de Valdora — world.js (Agente B)
// Mundo: terreno procedural, vila, bosque, lago, Santuário da Raiz, céu e ciclo dia/noite.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Constantes do mapa
// ---------------------------------------------------------------------------
const WORLD_HALF = 250;
const GRID_N = 200;
const CELL = (WORLD_HALF * 2) / GRID_N; // 2.5 m
const GRID_V = GRID_N + 1;
const FLOOR_Y = 12;
const WATER_Y = -0.3;
const DAY_LENGTH = 360; // segundos reais por dia
const BOUND = 228;
const SHADOW_EXT = 60;
const SKY_R = 300;

const VILLAGE = { x: 0, z: 0, r: 45 };
const FOREST = { x: -130, z: -110, r: 70 };
const CLEARING = { x: -140, z: -130, r: 16 };
const LAKE = { x: 140, z: -20, r: 45 };
const ISLAND = { x: 128, z: -22, r: 7 };
const ARENA = { x: 0, z: -245, r: 22 };
const PLATEAU = { x0: -50, x1: 50, z0: -278, z1: -163 };

// Interior do templo (retângulos internos dos cômodos)
const TEMPLE_RECTS = [
  { x0: -14, x1: 14, z0: -210, z1: -177, front: true }, // salão de entrada
  { x0: -22, x1: -14, z0: -208, z1: -202 },              // corredor lateral
  { x0: -42, x1: -22, z0: -216, z1: -194 },              // sala lateral (baú da chave)
  { x0: -4, x1: 4, z0: -225, z1: -210 },                 // corredor do portão
];

const PATHS = [
  [[0, -11], [1, -45], [5, -80], [-4, -125], [0, -160], [0, -174]],                      // vila -> santuário
  [[-9, -2], [-34, -1], [-48, -20], [-62, -48], [-95, -88], [-122, -112], [-136, -124]], // vila -> bosque
  [[9, -2], [34, -3], [60, -14], [97, -22]],                                              // vila -> lago
];

// ---------------------------------------------------------------------------
// Utilidades matemáticas / ruído determinístico
// ---------------------------------------------------------------------------
const SEED = 7331;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function hash2(ix, iz, s = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul((SEED + s) | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, z * f, s + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sdBox(x, z, x0, x1, z0, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

const SEGMENTS = [];
for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) SEGMENTS.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
function pathDist(x, z) {
  let best = 1e9;
  for (const s of SEGMENTS) {
    const ax = s[0], az = s[1], bx = s[2] - ax, bz = s[3] - az;
    const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
    if (d < best) best = d;
  }
  return best;
}

function inTempleShape(x, z, pad = 0) {
  if (x < -48 || x > 28 || z > -170 || z < -272) return false;
  for (const r of TEMPLE_RECTS) {
    const z1 = r.front ? Math.min(r.z1 + pad, -175) : r.z1 + pad;
    if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= z1) return true;
  }
  return Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + pad;
}

function lakeRadius(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz) || 1e-6;
  return LAKE.r + (vnoise(dx / d * 1.6 + 10, dz / d * 1.6 + 10, 3) - 0.5) * 14;
}
function cliffMask(x, z) {
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e < 190) return 0;
  const ce = e + (fbm(x * 0.03, z * 0.03, 3, 21) - 0.5) * 16;
  return smooth(212, 238, ce);
}
function baseField(x, z) {
  let h = -0.8 + fbm(x * 0.011, z * 0.011, 4, 0) * 9;
  h += (fbm(x * 0.05, z * 0.05, 2, 5) - 0.5) * 1.4;
  const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
  const fw = smooth(FOREST.r + 10, FOREST.r - 20, fd);
  if (fw > 0) h += fw * (fbm(x * 0.03, z * 0.03, 3, 41) - 0.5) * 5;
  return h;
}
const CLEARING_H = baseField(CLEARING.x, CLEARING.z);

function heightRaw(x, z) {
  let h = baseField(x, z);
  // clareira da Mira: plana
  const cd = Math.hypot(x - CLEARING.x, z - CLEARING.z);
  const cw = smooth(CLEARING.r + 10, CLEARING.r - 4, cd);
  if (cw > 0) h = lerp(h, CLEARING_H, cw);
  // vila: plana
  const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  const wv = smooth(72, 48, dv);
  if (wv > 0) h = lerp(h, 0.3 + (vnoise(x * 0.07, z * 0.07, 9) - 0.5) * 0.35, wv);
  // lago
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 40) {
    const rl = lakeRadius(x, z);
    const sb = smooth(rl + 20, rl + 2, dl);
    const bed = 0.5 - 5.2 * smooth(rl - 1, rl - 24, dl);
    h = lerp(h, bed, sb);
    const di = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    const wi = smooth(ISLAND.r + 5, ISLAND.r - 1, di);
    if (wi > 0) h = lerp(h, 1.0 + smooth(ISLAND.r, 0, di) * 0.7, wi);
  }
  // colina do templo (rampa suave até o platô y=12)
  const dP = sdBox(x, z, PLATEAU.x0, PLATEAU.x1, PLATEAU.z0, PLATEAU.z1);
  if (dP < 75) {
    const dn = dP + (vnoise(x * 0.05, z * 0.05, 11) - 0.5) * 8 * smooth(4, 25, dP);
    const wh = smooth(60, 2, dn);
    h = lerp(h, FLOOR_Y, wh);
  }
  // penhascos nas bordas
  const cm = cliffMask(x, z);
  if (cm > 0) h += cm * (16 + fbm(x * 0.025, z * 0.025, 3, 23) * 34);
  // terreno sob o templo fica logo abaixo do piso
  if (inTempleShape(x, z, 4.5)) h = FLOOR_Y - 0.1;
  return h;
}

// ---------------------------------------------------------------------------
// Paleta (Color converte sRGB -> linear automaticamente)
// ---------------------------------------------------------------------------
const C = {
  grassA: new THREE.Color(0x5aa83c), grassB: new THREE.Color(0x7cc24a), grassLight: new THREE.Color(0x9bd35a),
  forestA: new THREE.Color(0x356e2c), forestB: new THREE.Color(0x2a5a26), clearing: new THREE.Color(0x86c456),
  dirt: new THREE.Color(0xa8824f), dirtLight: new THREE.Color(0xbb9762),
  sand: new THREE.Color(0xe2d08e), sandWet: new THREE.Color(0xb9a46c), lakeBed: new THREE.Color(0x58704a),
  rock: new THREE.Color(0x8d8880), rockDark: new THREE.Color(0x6a6660), stone: new THREE.Color(0xa49d8e),
};
const TEMPLE_FOG = new THREE.Color(0x0e0b09);
const FOREST_FOG = new THREE.Color(0x2c4636);
const TEMPLE_HS = new THREE.Color(0xc0a080);
const TEMPLE_HG = new THREE.Color(0x4a3a2a);

function terrainColor(x, z, h, slope, out, tmp) {
  const n1 = vnoise(x * 0.045, z * 0.045, 31), n2 = vnoise(x * 0.13, z * 0.13, 37);
  out.copy(C.grassA).lerp(C.grassB, n1);
  if (n2 > 0.72) out.lerp(C.grassLight, (n2 - 0.72) * 2.5);
  const fd = Math.hypot(x - FOREST.x, z - FOREST.z) + (n1 - 0.5) * 20;
  const fm = smooth(FOREST.r + 12, FOREST.r - 12, fd);
  if (fm > 0) { tmp.copy(C.forestA).lerp(C.forestB, n2); out.lerp(tmp, fm); }
  const cd = Math.hypot(x - CLEARING.x, z - CLEARING.z);
  const cm = smooth(CLEARING.r + 3, CLEARING.r - 4, cd);
  if (cm > 0) out.lerp(C.clearing, cm * 0.8);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 25) {
    const rl = lakeRadius(x, z);
    const sm = smooth(rl + 9, rl + 3, dl + (n2 - 0.5) * 4) * smooth(2.4, 1.6, h);
    if (sm > 0) out.lerp(C.sand, sm);
    if (h < WATER_Y + 0.35) out.copy(C.sandWet).lerp(C.lakeBed, smooth(WATER_Y, WATER_Y - 3, h));
  }
  const pd = pathDist(x, z) + (n2 - 0.5) * 1.4;
  const pm = smooth(3.0, 1.5, pd);
  if (pm > 0) { tmp.copy(C.dirt).lerp(C.dirtLight, n1); out.lerp(tmp, pm); }
  const vd = Math.hypot(x, z + 2) + (n2 - 0.5) * 3;
  const vm = smooth(12.5, 9.5, vd);
  if (vm > 0) out.lerp(C.dirtLight, vm);
  if (z < -158 && z > -180 && Math.abs(x) < 16) out.lerp(C.stone, smooth(-158, -163, z) * smooth(16, 12, Math.abs(x)));
  if (inTempleShape(x, z, 4.5)) out.copy(C.stone);
  const cl = cliffMask(x, z);
  const rm = Math.max(smooth(0.22, 0.5, cl), smooth(0.7, 1.1, slope));
  if (rm > 0) { tmp.copy(C.rock).lerp(C.rockDark, n2); out.lerp(tmp, rm); }
  return out;
}

// ---------------------------------------------------------------------------
// Céu: keyframes do ciclo
// ---------------------------------------------------------------------------
const SKY_KEYS = [
  { t: 0.00, top: 0x050a1e, hor: 0x1a2a52, light: 0x8ea6ff, li: 0.8, hs: 0x5a70b0, hg: 0x1b2131, hi: 2.4, fog: 0x16213f },
  { t: 0.21, top: 0x141a46, hor: 0x4a3f70, light: 0x9a9ad0, li: 0.7, hs: 0x6a6aa0, hg: 0x262433, hi: 2.2, fog: 0x332f55 },
  { t: 0.26, top: 0x3f62a8, hor: 0xff9a62, light: 0xffb27a, li: 1.7, hs: 0xffcfae, hg: 0x4a4638, hi: 1.3, fog: 0xd99a80 },
  { t: 0.33, top: 0x3b7dd8, hor: 0xbfe2ff, light: 0xfff0d4, li: 2.5, hs: 0xd6eaff, hg: 0x5b6b3a, hi: 1.35, fog: 0xbcdaf3 },
  { t: 0.50, top: 0x2c70d4, hor: 0xb2dcff, light: 0xffffff, li: 2.7, hs: 0xdaf0ff, hg: 0x5f7040, hi: 1.4, fog: 0xb4d8f4 },
  { t: 0.67, top: 0x3b78d0, hor: 0xc4e0fa, light: 0xfff0d8, li: 2.5, hs: 0xd6eaff, hg: 0x5b6b3a, hi: 1.35, fog: 0xbfd9ef },
  { t: 0.74, top: 0x4a5498, hor: 0xff7a48, light: 0xff9858, li: 1.6, hs: 0xffb294, hg: 0x4a3a3a, hi: 1.3, fog: 0xdc8868 },
  { t: 0.79, top: 0x191d4e, hor: 0x5e3766, light: 0x8a8ac0, li: 0.7, hs: 0x5c5a92, hg: 0x221f2f, hi: 2.2, fog: 0x342a52 },
];
SKY_KEYS.push({ ...SKY_KEYS[0], t: 1.0 });
for (const k of SKY_KEYS) for (const f of ['top', 'hor', 'light', 'hs', 'hg', 'fog']) k[f] = new THREE.Color(k[f]);

// ---------------------------------------------------------------------------
// Materiais e primitivas de fallback
// ---------------------------------------------------------------------------
const _matCache = new Map();
function lam(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = _matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }); _matCache.set(key, m); }
  return m;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
const FB = {
  tree(v = 0) {
    const g = new THREE.Group();
    const s = v === 2 ? 2.4 : 1;
    g.add(mesh(new THREE.CylinderGeometry(0.28 * s, 0.4 * s, 2.6 * s, 6), lam(0x6b4a2b), 0, 1.3 * s, 0));
    if (v === 1) {
      g.add(mesh(new THREE.ConeGeometry(2.0, 3.6, 7), lam(0x2f6b34), 0, 3.6, 0));
      g.add(mesh(new THREE.ConeGeometry(1.4, 2.8, 7), lam(0x2f6b34), 0, 5.4, 0));
    } else {
      g.add(mesh(new THREE.IcosahedronGeometry(2.2 * s, 0), lam(v === 2 ? 0x2f6a30 : 0x4f9a3a), 0, 3.8 * s, 0));
    }
    return g;
  },
  rock(size = 1) {
    const g = new THREE.Group();
    const m = mesh(new THREE.DodecahedronGeometry(size * 0.8, 0), lam(0x8a857c), 0, size * 0.35, 0);
    m.scale.y = 0.7; g.add(m); return g;
  },
  bush() { const g = new THREE.Group(); g.add(mesh(new THREE.IcosahedronGeometry(0.9, 0), lam(0x3f8a34), 0, 0.6, 0)); return g; },
  grass() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = mesh(new THREE.ConeGeometry(0.12, 0.8, 3), lam(0x6cbf45), Math.cos(i * 1.7) * 0.18, 0.4, Math.sin(i * 1.7) * 0.18);
      b.rotation.z = Math.cos(i * 2.3) * 0.3; b.rotation.x = Math.sin(i * 2.3) * 0.3; g.add(b);
    }
    return g;
  },
  flower() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 3), lam(0x3f8a34), 0, 0.25, 0));
    const cols = [0xff5c7a, 0xffd23f, 0xffffff, 0x9b6bff, 0xff8c3a];
    g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), lam(cols[Math.floor(Math.random() * cols.length)]), 0, 0.52, 0));
    return g;
  },
  house() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(6, 3.4, 6), lam(0xe8dcc0), 0, 1.7, 0));
    const roof = mesh(new THREE.ConeGeometry(5, 2.6, 4), lam(0xb0453a), 0, 4.7, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
    g.add(mesh(new THREE.BoxGeometry(1.2, 2, 0.2), lam(0x6b4a2b), 0, 1, 3.05));
    return g;
  },
  fence(len = 4) {
    const g = new THREE.Group();
    const n = Math.max(2, Math.round(len / 2) + 1);
    for (let i = 0; i < n; i++) g.add(mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), lam(0x8a6038), -len / 2 + (len * i) / (n - 1), 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(len, 0.12, 0.08), lam(0x9a6e42), 0, 0.8, 0));
    g.add(mesh(new THREE.BoxGeometry(len, 0.12, 0.08), lam(0x9a6e42), 0, 0.45, 0));
    return g;
  },
  well() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.9, 10), lam(0x9a958a), 0, 0.45, 0));
    g.add(mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), lam(0x6b4a2b), -1.1, 1.6, 0));
    g.add(mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), lam(0x6b4a2b), 1.1, 1.6, 0));
    const r = mesh(new THREE.ConeGeometry(1.8, 0.9, 4), lam(0xb0453a), 0, 3.0, 0); r.rotation.y = Math.PI / 4; g.add(r);
    return g;
  },
  sign() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.15, 1.3, 0.15), lam(0x6b4a2b), 0, 0.65, 0));
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 0.1), lam(0xa07a4a), 0, 1.25, 0.05));
    return g;
  },
  torch() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.6, 5), lam(0x5a3e24), 0, 0.8, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.25, 6), lam(0x3a3a3a), 0, 1.65, 0));
    g.add(mesh(new THREE.ConeGeometry(0.16, 0.45, 5), new THREE.MeshBasicMaterial({ color: 0xffa040 }), 0, 1.95, 0));
    const light = new THREE.PointLight(0xffa040, 1, 10, 2); light.position.y = 2; g.add(light);
    return { root: g, light };
  },
  door(w = 7, h = 8) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(w, h, 0.8), lam(0x7d786c), 0, h / 2, 0));
    g.add(mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.22, 0.12, 4, 8), new THREE.MeshLambertMaterial({ color: 0x2a6a4a, emissive: 0x3aff9a, emissiveIntensity: 0.6 }), 0, h * 0.55, 0.42));
    return g;
  },
  gate(w = 8, h = 7) {
    const g = new THREE.Group();
    const n = Math.round(w / 0.7);
    for (let i = 0; i <= n; i++) g.add(mesh(new THREE.BoxGeometry(0.14, h, 0.14), lam(0x3a3a40), -w / 2 + (w * i) / n, h / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(w, 0.2, 0.2), lam(0x3a3a40), 0, h * 0.75, 0));
    g.add(mesh(new THREE.BoxGeometry(w, 0.2, 0.2), lam(0x3a3a40), 0, h * 0.3, 0));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.8, 0.35), lam(0xc8a040), 0, h * 0.45, 0.15));
    return g;
  },
  pot() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.25, 8), lam(0xb06a3a), 0, 0.12, 0));
    g.add(mesh(new THREE.SphereGeometry(0.36, 8, 5), lam(0xc07a46), 0, 0.42, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.2, 8), lam(0xb06a3a), 0, 0.78, 0));
    return g;
  },
};

// ---------------------------------------------------------------------------
// Batching estático: agrupa geometrias por (chunk, material) para poucos draw calls
// ---------------------------------------------------------------------------
function matKey(m) {
  return [m.type, m.color ? m.color.getHexString() : '', m.emissive ? m.emissive.getHexString() : '',
    m.emissiveIntensity ?? '', m.flatShading ? 1 : 0, m.vertexColors ? 1 : 0, m.transparent ? 1 : 0, m.opacity,
    m.side, m.map ? m.map.uuid : '', m.alphaTest || 0, m.wireframe ? 1 : 0,
    m.gradientMap ? 'g' + (m.gradientMap.image?.width || 0) : '', m.toneMapped ? 1 : 0, m.fog ? 1 : 0].join('|');
}
// Materiais opacos simples (sem textura/emissão) viram um único material com cores por vértice
const BAKE_TYPES = new Set(['MeshLambertMaterial', 'MeshToonMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial']);
const _bakedMats = new Map();
function bucketFor(m) {
  const emissive = m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0;
  if (BAKE_TYPES.has(m.type) && m.color && !m.map && !m.transparent && !m.alphaTest && !emissive && !m.wireframe) {
    const key = 'B|' + m.type + '|' + (m.flatShading ? 1 : 0) + '|' + m.side + '|' + (m.gradientMap ? 'g' + (m.gradientMap.image?.width || 0) : '') + '|' + (m.fog ? 1 : 0);
    let out = _bakedMats.get(key);
    if (!out) {
      out = m.clone();
      out.color = new THREE.Color(1, 1, 1);
      out.vertexColors = true;
      _bakedMats.set(key, out);
    }
    return { key, mat: out, tint: m.color, needUV: false, needColor: true };
  }
  return { key: matKey(m), mat: m, tint: null, needUV: !!m.map, needColor: !!m.vertexColors };
}

function toF32(attr, size) {
  const n = attr.count, out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    if (size > 0) out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.itemSize > 1 ? attr.getY(i) : 0;
    if (size > 2) out[i * size + 2] = attr.itemSize > 2 ? attr.getZ(i) : (size === 3 && attr.itemSize === 2 ? 0 : 1);
  }
  return new THREE.BufferAttribute(out, size);
}
function prepGeometry(src, matrix, needUV, needColor, tint = null) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  const out = new THREE.BufferGeometry();
  const pos = g.attributes.position;
  out.setAttribute('position', toF32(pos, 3));
  if (g.attributes.normal) out.setAttribute('normal', toF32(g.attributes.normal, 3));
  else out.computeVertexNormals();
  if (needUV) out.setAttribute('uv', g.attributes.uv ? toF32(g.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (needColor) {
    if (g.attributes.color) out.setAttribute('color', toF32(g.attributes.color, 3));
    else out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
    if (tint) {
      const ca = out.attributes.color.array;
      for (let i = 0; i < ca.length; i += 3) { ca[i] *= tint.r; ca[i + 1] *= tint.g; ca[i + 2] *= tint.b; }
    }
  }
  g.dispose();
  out.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    for (const name of Object.keys(out.attributes)) {
      const a = out.attributes[name], s = a.itemSize, arr = a.array;
      for (let i = 0; i + 2 < a.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t;
        }
      }
    }
  }
  return out;
}
function collectMeshes(obj) {
  obj.updateMatrixWorld(true);
  const meshes = [];
  let ok = true;
  obj.traverse((o) => {
    if (!ok || o.isLight) return;
    if (o.isMesh) {
      if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry?.attributes?.position || o.morphTargetInfluences) ok = false;
      else if (o.visible && o.material) meshes.push(o);
    } else if (o.isPoints || o.isLine || o.isSprite) ok = false;
  });
  return ok ? meshes : null;
}
function stripLights(obj) {
  const lights = [];
  obj.traverse((o) => { if (o.isLight) lights.push(o); });
  for (const l of lights) l.parent && l.parent.remove(l);
  return lights;
}

class StaticBatcher {
  constructor(chunk = 96) { this.chunk = chunk; this.buckets = new Map(); }
  add(obj, cast = true, receive = true) {
    stripLights(obj);
    const meshes = collectMeshes(obj);
    if (!meshes) return false;
    const h = this.chunk / 2;
    const cx = Math.floor((obj.position.x + h) / this.chunk), cz = Math.floor((obj.position.z + h) / this.chunk);
    try {
      const preps = [];
      for (const m of meshes) {
        const b = bucketFor(m.material);
        const key = cx + ',' + cz + '#' + b.key + '#' + (cast ? 1 : 0) + (receive ? 1 : 0);
        preps.push([key, b.mat, prepGeometry(m.geometry, m.matrixWorld, b.needUV, b.needColor, b.tint)]);
      }
      for (const [key, mat, g] of preps) {
        let b = this.buckets.get(key);
        if (!b) { b = { mat, geos: [], cast, receive }; this.buckets.set(key, b); }
        b.geos.push(g);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  finalize(scene) {
    let count = 0;
    for (const b of this.buckets.values()) {
      let merged = null;
      try { merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false); } catch (e) { merged = null; }
      const list = merged ? [merged] : b.geos;
      for (const g of list) {
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, b.mat);
        m.castShadow = b.cast; m.receiveShadow = b.receive;
        m.matrixAutoUpdate = false; m.updateMatrix();
        scene.add(m); count++;
      }
      if (merged && b.geos.length > 1) for (const g of b.geos) g.dispose();
    }
    this.buckets.clear();
    return count;
  }
}

// Junta todas as malhas de um objeto (por material) — usado para tufos/vasos cortáveis
function collapse(obj) {
  const meshes = collectMeshes(obj);
  if (!meshes) return obj;
  const groups = new Map();
  try {
    for (const m of meshes) {
      const b = bucketFor(m.material);
      let g = groups.get(b.key);
      if (!g) { g = { mat: b.mat, geos: [] }; groups.set(b.key, g); }
      g.geos.push(prepGeometry(m.geometry, m.matrixWorld, b.needUV, b.needColor, b.tint));
    }
    const root = new THREE.Group();
    for (const g of groups.values()) {
      const geo = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
      if (!geo) return obj;
      root.add(new THREE.Mesh(geo, g.mat));
    }
    return root;
  } catch (e) {
    return obj;
  }
}

function mergeList(geos) {
  const prepared = geos.map((g) => prepGeometry(g, new THREE.Matrix4(), false, false));
  geos.forEach((g) => g.dispose());
  return mergeGeometries(prepared, false);
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Construtor de malhas com cores por vértice (templo): tudo vira 1 draw call por material
// ---------------------------------------------------------------------------
const _ba = new THREE.Vector3(), _bb = new THREE.Vector3(), _bn = new THREE.Vector3();
class VCBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  get empty() { return this.p.length === 0; }
  // triângulo; se `ref` for dado, orienta a face para longe de ref (centro do sólido)
  tri(a, b, c, col, ref = null) {
    _ba.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _bb.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _bn.crossVectors(_ba, _bb);
    const l = _bn.length();
    if (l < 1e-10) return;
    if (ref) {
      const mx = (a[0] + b[0] + c[0]) / 3 - ref[0], my = (a[1] + b[1] + c[1]) / 3 - ref[1], mz = (a[2] + b[2] + c[2]) / 3 - ref[2];
      if (_bn.x * mx + _bn.y * my + _bn.z * mz < 0) { const t = b; b = c; c = t; _bn.negate(); }
    }
    _bn.divideScalar(l);
    const P = this.p, N = this.n, C = this.c;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { N.push(_bn.x, _bn.y, _bn.z); C.push(col.r, col.g, col.b); }
  }
  quad(a, b, c, d, col, ref) { this.tri(a, b, c, col, ref); this.tri(a, c, d, col, ref); }
  // sólido de 8 vértices: v[0..3] uma face, v[4..7] a face oposta (mesma ordem)
  hexa(v, col) {
    const ref = [0, 0, 0];
    for (const q of v) { ref[0] += q[0] / 8; ref[1] += q[1] / 8; ref[2] += q[2] / 8; }
    const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const f of F) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], col, ref);
  }
  box(cx, cy, cz, sx, sy, sz, col, rotY = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    this.hexa([P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz),
      P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)], col);
  }
  boxMM(x0, x1, y0, y1, z0, z1, col) { this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col); }
  // setor de anel (ângulo a: 0 = +Z, cresce para +X)
  sector(cx, cz, r0, r1, a0, a1, y0, y1, col) {
    const P = (r, a, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
    this.hexa([P(r0, a0, y0), P(r1, a0, y0), P(r1, a1, y0), P(r0, a1, y0),
      P(r0, a0, y1), P(r1, a0, y1), P(r1, a1, y1), P(r0, a1, y1)], col);
  }
  // anexa uma BufferGeometry qualquer (já posicionada); a geometria é descartada
  geo(g, col) {
    const ng = g.index ? g.toNonIndexed() : g;
    const pa = ng.attributes.position;
    for (let i = 0; i + 2 < pa.count; i += 3) {
      this.tri([pa.getX(i), pa.getY(i), pa.getZ(i)], [pa.getX(i + 1), pa.getY(i + 1), pa.getZ(i + 1)], [pa.getX(i + 2), pa.getY(i + 2), pa.getZ(i + 2)], col);
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  }
  // tubo afinado ao longo de uma curva (raízes)
  taper(pts, r0, r1, col, sides = 5, steps = 0) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = steps || Math.max(4, pts.length * 3);
    const fr = curve.computeFrenetFrames(n, false);
    const rings = [], centers = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, P = curve.getPointAt(t), N = fr.normals[i], B = fr.binormals[i];
      const r = lerp(r0, r1, t), ring = [];
      for (let s = 0; s < sides; s++) {
        const an = (s / sides) * Math.PI * 2, ca = Math.cos(an) * r, sa = Math.sin(an) * r;
        ring.push([P.x + N.x * ca + B.x * sa, P.y + N.y * ca + B.y * sa, P.z + N.z * ca + B.z * sa]);
      }
      rings.push(ring); centers.push([P.x, P.y, P.z]);
    }
    for (let i = 0; i < n; i++) {
      const ref = [(centers[i][0] + centers[i + 1][0]) / 2, (centers[i][1] + centers[i + 1][1]) / 2, (centers[i][2] + centers[i + 1][2]) / 2];
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides;
        this.quad(rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s], col, ref);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    this.p = []; this.n = []; this.c = [];
    return g;
  }
}
const _toneC = new THREE.Color(), _toneT = new THREE.Color();
// cor com variação de brilho (e leve mistura opcional com outra cor)
function tone(hex, rng, j = 0.1, mixHex = null, mix = 0) {
  _toneC.setHex(hex);
  if (mixHex != null && mix > 0) _toneC.lerp(_toneT.setHex(mixHex), mix);
  return _toneC.multiplyScalar(1 + (rng() - 0.5) * 2 * j);
}

// Proxy de instância: imita `mesh.visible` para itens de InstancedMesh (cortáveis)
const _ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
class InstanceProxy {
  constructor(parts, matrix, name, position) {
    this.parts = parts;      // [[InstancedMesh, índice]]
    this.matrix = matrix;
    this.name = name;
    this.position = position;
    this.userData = { kind: name };
    this.isInstanceProxy = true;
    this._vis = true;
  }
  get visible() { return this._vis; }
  set visible(v) {
    v = !!v;
    if (v === this._vis) return;
    this._vis = v;
    for (const [im, i] of this.parts) {
      im.setMatrixAt(i, v ? this.matrix : _ZERO_M);
      im.instanceMatrix.needsUpdate = true;
    }
  }
  // compatibilidade defensiva com código que espera um Object3D (não expõe a malha compartilhada)
  traverse() {}
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, models) {
    this.scene = scene;
    this.models = models || {};
    this.timeOfDay = 0.3;
    this.cuttables = [];
    this.signs = [];
    this.waterLevel = WATER_Y;
    this.spawns = { player: new THREE.Vector3(0, 0, 12), npcs: [], enemies: [], chests: [], boss: new THREE.Vector3(ARENA.x, FLOOR_Y, ARENA.z) };

    this._warned = {};
    this._rng = mulberry32(20241117);
    this._time = 0;
    this._transition = null;
    this._forestF = 0;
    this._interiorF = 0;
    this._firstUpdate = true;
    this._occupied = [];
    this._platforms = [];
    this._torches = [];
    this._anims = [];
    this._cullTimer = 0;
    this._torchTimer = 0;
    // colisores
    this._cs = 16;
    this._cells = new Map();
    this._cid = 0;
    this._stamp = 0;
    this._batch = new StaticBatcher(96);

    this.templeDoor = { position: new THREE.Vector3(0, FLOOR_Y, -175), isOpen: false, open: () => this._openDoor() };
    this.bossGate = { position: new THREE.Vector3(0, FLOOR_Y, -215), isOpen: false, open: () => this._openGate() };

    const steps = ['_buildTerrain', '_buildLights', '_buildSky', '_buildWater', '_buildTemple', '_buildVillage',
      '_buildForest', '_buildLake', '_buildField', '_buildSpawns', '_buildCuttables'];
    for (const s of steps) {
      try { this[s](); } catch (e) { console.error('[world] falha em ' + s, e); }
    }
    try { this._batch.finalize(scene); } catch (e) { console.error('[world] batch', e); }
    try { this._buildTorchLights(); } catch (e) { console.error('[world] tochas', e); }
    this.update(0, this.spawns.player);
  }

  // ------------------------------------------------------------------ API
  getHeight(x, z) {
    if (inTempleShape(x, z, 2)) return FLOOR_Y;
    let h = this._terrainHeight(x, z);
    for (const p of this._platforms) {
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.y > h) h = p.y;
    }
    return h;
  }

  isWater(x, z) {
    for (const p of this._platforms) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 14) return false;
    return this._terrainHeight(x, z) < WATER_Y - 0.7;
  }

  isInTemple(x, z, pad = 0) { return inTempleShape(x, z, pad); }

  getZone(x, z) {
    const night = this.isNight();
    if (inTempleShape(x, z, 0.5)) {
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 0.5) return { id: 'boss', name: 'Câmara do Guardião', music: 'boss' };
      return { id: 'temple', name: 'Santuário da Raiz', music: 'temple' };
    }
    // praça diante da fachada do templo (exterior): mesma família de nome, música do campo
    if (z > -180 && Math.hypot(x - this.templeDoor.position.x, z - this.templeDoor.position.z) < 30) return { id: 'temple_out', name: 'Santuário da Raiz', music: night ? 'night' : 'field' };
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 3) return { id: 'village', name: 'Vila Brisa', music: 'village' };
    if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r + 2) return { id: 'forest', name: 'Bosque Sussurrante', music: 'forest' };
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 10) return { id: 'lake', name: 'Lago Espelhado', music: night ? 'night' : 'field' };
    return { id: 'field', name: 'Campos de Valdora', music: night ? 'night' : 'field' };
  }

  isNight() { return this.timeOfDay < 0.22 || this.timeOfDay > 0.78; }

  toggleDayNight() {
    const target = this.isNight() ? 0.5 : 0.0;
    const from = this.timeOfDay;
    const delta = (target - from + 1) % 1;
    if (delta < 1e-3) return;
    this._transition = { from, delta, t: 0, dur: 3 };
  }

  addBoxCollider(minX, maxX, minZ, maxZ) {
    return this._addCollider({ type: 'box', minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ) });
  }
  addCircleCollider(x, z, r) {
    return this._addCollider({ type: 'circle', x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  }
  removeCollider(handle) {
    if (!handle || handle.removed || !handle._keys) return;
    handle.removed = true;
    for (const k of handle._keys) {
      const list = this._cells.get(k);
      if (!list) continue;
      const i = list.indexOf(handle);
      if (i >= 0) list.splice(i, 1);
    }
  }

  resolveCollision(pos, radius = 0.5) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return pos;
    const cs = this._cs;
    for (let iter = 0; iter < 2; iter++) {
      const stamp = ++this._stamp;
      const cx0 = Math.floor((pos.x - radius) / cs), cx1 = Math.floor((pos.x + radius) / cs);
      const cz0 = Math.floor((pos.z - radius) / cs), cz1 = Math.floor((pos.z + radius) / cs);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const list = this._cells.get(this._ckey(cx, cz));
          if (!list) continue;
          for (const c of list) {
            if (c._stamp === stamp) continue;
            c._stamp = stamp;
            this._pushOut(pos, radius, c);
          }
        }
      }
    }
    // parede circular da arena (com abertura do corredor ao sul/+Z)
    const dx = pos.x - ARENA.x, dz = pos.z - ARENA.z, d = Math.hypot(dx, dz);
    if (d < ARENA.r + 3 && d > ARENA.r - radius && !(Math.abs(pos.x) < 4 && dz > 0) && d > 1e-6) {
      const k = (ARENA.r - radius) / d;
      pos.x = ARENA.x + dx * k; pos.z = ARENA.z + dz * k;
    }
    // limites do mundo e penhascos
    if (!inTempleShape(pos.x, pos.z, 2.5)) {
      pos.x = clamp(pos.x, -BOUND, BOUND);
      pos.z = clamp(pos.z, -BOUND, BOUND);
      for (let i = 0; i < 24 && cliffMask(pos.x, pos.z) > 0.3; i++) {
        if (Math.abs(pos.x) > Math.abs(pos.z)) pos.x -= Math.sign(pos.x) * 0.3;
        else pos.z -= Math.sign(pos.z) * 0.3;
      }
    }
    return pos;
  }

  update(dt, playerPos) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const src = playerPos || this.spawns.player;
    const p = (this._pp || (this._pp = new THREE.Vector3())).set(+src.x || 0, +src.y || 0, +src.z || 0);
    this._time += dt;
    // relógio
    if (this._transition) {
      const tr = this._transition;
      tr.t += dt;
      const k = Math.min(tr.t / tr.dur, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.timeOfDay = (tr.from + tr.delta * e) % 1;
      if (k >= 1) this._transition = null;
    } else {
      this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
    }
    // fatores de zona (suavizados)
    const inT = inTempleShape(p.x, p.z, 0) ? 1 : 0;
    const inF = smooth(FOREST.r + 15, FOREST.r - 20, Math.hypot(p.x - FOREST.x, p.z - FOREST.z));
    const k = this._firstUpdate ? 1 : 1 - Math.exp(-dt * 2.5);
    this._firstUpdate = false;
    this._interiorF += (inT - this._interiorF) * k;
    this._forestF += (inF - this._forestF) * k;

    const steps = ['_updateSky', '_updateWater', '_updateTorches', '_updateAnims', '_updateClouds', '_updateCulling', '_updateFireflies', '_updateTemple'];
    for (const s of steps) {
      try { this[s](dt, p); } catch (e) {
        if (!this._warned[s]) { this._warned[s] = true; console.warn('[world] ' + s, e); }
      }
    }
  }

  // ------------------------------------------------------------- internos
  _m(name, ...args) {
    const f = this.models && this.models[name];
    if (typeof f === 'function') {
      try {
        const r = f(...args);
        if (r) return r;
      } catch (e) {
        if (!this._warned[name]) { this._warned[name] = true; console.warn('[world] models.' + name + ' falhou; usando primitiva', e); }
      }
    }
    return null;
  }
  _model(name, fb, ...args) {
    let r = this._m(name, ...args);
    if (r && !r.isObject3D) r = r.root && r.root.isObject3D ? r.root : null;
    return r || fb(...args);
  }

  _terrainHeight(x, z) {
    const fx = clamp((x + WORLD_HALF) / CELL, 0, GRID_N - 1e-6);
    const fz = clamp((z + WORLD_HALF) / CELL, 0, GRID_N - 1e-6);
    const j = Math.floor(fx), i = Math.floor(fz);
    const u = fx - j, v = fz - i;
    const H = this._H, a = i * GRID_V + j;
    const ha = H[a], hb = H[a + 1], hc = H[a + GRID_V], hd = H[a + GRID_V + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  _ckey(cx, cz) { return (cx + 512) * 1024 + (cz + 512); }
  _addCollider(c) {
    c.id = ++this._cid;
    c._stamp = 0;
    c._keys = [];
    const cs = this._cs;
    for (let cx = Math.floor(c.minX / cs); cx <= Math.floor(c.maxX / cs); cx++) {
      for (let cz = Math.floor(c.minZ / cs); cz <= Math.floor(c.maxZ / cs); cz++) {
        const key = this._ckey(cx, cz);
        let list = this._cells.get(key);
        if (!list) { list = []; this._cells.set(key, list); }
        list.push(c);
        c._keys.push(key);
      }
    }
    return c;
  }
  _pushOut(pos, radius, c) {
    if (c.type === 'circle') {
      const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { pos.x = c.x + rr; return; }
      pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr;
      return;
    }
    const qx = clamp(pos.x, c.minX, c.maxX), qz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - qx, dz = pos.z - qz;
    if (dx === 0 && dz === 0) {
      // centro dentro da caixa: sai pelo lado de menor penetração
      const l = pos.x - c.minX, r = c.maxX - pos.x, b = pos.z - c.minZ, t = c.maxZ - pos.z;
      const m = Math.min(l, r, b, t);
      if (m === l) pos.x = c.minX - radius; else if (m === r) pos.x = c.maxX + radius;
      else if (m === b) pos.z = c.minZ - radius; else pos.z = c.maxZ + radius;
      return;
    }
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return;
    const d = Math.sqrt(d2);
    pos.x = qx + (dx / d) * radius; pos.z = qz + (dz / d) * radius;
  }

  _occupy(x, z, r) { this._occupied.push({ x, z, r }); }
  _free(x, z, r) {
    for (const o of this._occupied) {
      const dx = o.x - x, dz = o.z - z, rr = o.r + r;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  }
  _slope(x, z) {
    const e = 1.5;
    return Math.hypot(this._terrainHeight(x + e, z) - this._terrainHeight(x - e, z), this._terrainHeight(x, z + e) - this._terrainHeight(x, z - e)) / (2 * e);
  }

  // Posiciona objeto estático e o envia ao batcher (ou à cena se não for mesclável)
  _place(obj, x, z, { yaw = 0, scale = 1, y = null, cast = true, receive = true, sink = 0 } = {}) {
    obj.position.set(x, (y ?? this.getHeight(x, z)) - sink, z);
    obj.rotation.y += yaw;
    if (scale !== 1) obj.scale.multiplyScalar(scale);
    if (!this._batch.add(obj, cast, receive)) {
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
      this.scene.add(obj);
    }
    return obj;
  }

  // Centraliza um modelo em XZ e (opcionalmente) alinha o eixo longo com X; base em y=0 se pedido
  _normalize(obj, { alignX = false, base = false, fitW = 0, fitH = 0 } = {}) {
    const wrap = new THREE.Group();
    wrap.add(obj);
    let box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return wrap;
    const size = box.getSize(_v1);
    if (alignX && size.z > size.x * 1.2) {
      obj.rotation.y += Math.PI / 2;
      box = new THREE.Box3().setFromObject(obj);
      box.getSize(size);
    }
    if (fitW > 0 && fitH > 0 && size.x > 0.01 && size.y > 0.01) {
      const sx = fitW / size.x, sy = fitH / size.y;
      if (Math.abs(sx - 1) > 0.15 || Math.abs(sy - 1) > 0.15) {
        obj.scale.multiply(_v2.set(sx, sy, Math.min(sx, sy)));
        box = new THREE.Box3().setFromObject(obj);
      }
    }
    const c = box.getCenter(_v2);
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    if (base) obj.position.y -= box.min.y;
    return wrap;
  }

  // ---------------------------------------------------------------- terreno
  _buildTerrain() {
    const N = GRID_N, V = GRID_V;
    const H = new Float32Array(V * V);
    for (let i = 0; i < V; i++) {
      const z = -WORLD_HALF + i * CELL;
      for (let j = 0; j < V; j++) H[i * V + j] = heightRaw(-WORLD_HALF + j * CELL, z);
    }
    this._H = H;
    const vc = new Float32Array(V * V * 3);
    const c = new THREE.Color(), tmp = new THREE.Color();
    for (let i = 0; i < V; i++) {
      for (let j = 0; j < V; j++) {
        const a = i * V + j;
        const hl = H[i * V + Math.max(j - 1, 0)], hr = H[i * V + Math.min(j + 1, N)];
        const hu = H[Math.max(i - 1, 0) * V + j], hd = H[Math.min(i + 1, N) * V + j];
        const slope = Math.hypot(hr - hl, hd - hu) / (2 * CELL);
        terrainColor(-WORLD_HALF + j * CELL, -WORLD_HALF + i * CELL, H[a], slope, c, tmp);
        vc[a * 3] = c.r; vc[a * 3 + 1] = c.g; vc[a * 3 + 2] = c.b;
      }
    }
    const pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
    let p = 0;
    const tri = (i, j, k, ia, ib, ic) => {
      const jit = 0.93 + hash2(i * 3 + k, j, 77) * 0.12;
      const r = (vc[ia * 3] + vc[ib * 3] + vc[ic * 3]) / 3 * jit;
      const g = (vc[ia * 3 + 1] + vc[ib * 3 + 1] + vc[ic * 3 + 1]) / 3 * jit;
      const b = (vc[ia * 3 + 2] + vc[ib * 3 + 2] + vc[ic * 3 + 2]) / 3 * jit;
      for (const idx of [ia, ib, ic]) {
        const vi = Math.floor(idx / V), vj = idx - vi * V;
        pos[p] = -WORLD_HALF + vj * CELL; pos[p + 1] = H[idx]; pos[p + 2] = -WORLD_HALF + vi * CELL;
        col[p] = r; col[p + 1] = g; col[p + 2] = b;
        p += 3;
      }
    };
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * V + j, b = a + 1, cc = a + V, d = cc + 1;
        tri(i, j, 0, a, cc, b);
        tri(i, j, 1, b, cc, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    terrain.name = 'terrain';
    this.terrain = terrain;
    this.scene.add(terrain);
  }

  // ------------------------------------------------------------------ luzes
  _buildLights() {
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -SHADOW_EXT; cam.right = SHADOW_EXT; cam.top = SHADOW_EXT; cam.bottom = -SHADOW_EXT;
    cam.near = 1; cam.far = 420;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.ambient = new THREE.HemisphereLight(0xd6eaff, 0x5b6b3a, 1.35);
    this.hemi = this.ambient;
    this.scene.add(this.ambient);
    this.scene.fog = new THREE.Fog(0xb4d8f4, 60, 300);
    this._bg = new THREE.Color(0xb4d8f4);
    this.scene.background = this._bg;
  }

  // -------------------------------------------------------------------- céu
  _buildSky() {
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, bottomColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.9, 0.7) }, sunGlow: { value: 1 },
        moonDir: { value: new THREE.Vector3(0, -1, 0) }, moonGlow: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          p.z = p.w * 0.99999;
          gl_Position = p;
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor;
        uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow;
        uniform vec3 moonDir; uniform float moonGlow;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h >= 0.0 ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
                              : mix(horizonColor, bottomColor, clamp(-h * 4.0, 0.0, 1.0));
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 6.0) * 0.25 + pow(s, 180.0) * 1.2) * sunGlow;
          float m = max(dot(d, moonDir), 0.0);
          col += vec3(0.45, 0.55, 0.9) * pow(m, 40.0) * 0.3 * moonGlow;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this._skyMat = skyMat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 16), skyMat);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this._sky = sky;
    this.scene.add(sky);

    const sunMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(13, 1), new THREE.MeshBasicMaterial({ color: 0xfff2b8, fog: false, depthWrite: false, depthTest: false }));
    sunMesh.renderOrder = -999;
    const moonMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(8, 1), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false, depthWrite: false, depthTest: false }));
    moonMesh.renderOrder = -999;
    this._sunMesh = sunMesh; this._moonMesh = moonMesh;
    this.scene.add(sunMesh, moonMesh);

    // estrelas
    const rng = mulberry32(99);
    const n = 700, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng() * Math.PI * 2, y = 0.06 + rng() * 0.94, r = Math.sqrt(1 - y * y);
      sp[i * 3] = Math.cos(u) * r * 270; sp[i * 3 + 1] = y * 270; sp[i * 3 + 2] = Math.sin(u) * r * 270;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this._stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this._stars.frustumCulled = false;
    this.scene.add(this._stars);

    // nuvens low-poly
    this._cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x334455 });
    // 4 formatos x 4 instâncias (InstancedMesh: 4 draw calls em vez de 16)
    this._clouds = [];
    this._cloudData = [];
    for (let v = 0; v < 4; v++) {
      const parts = [];
      const nb = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < nb; k++) {
        const g = new THREE.IcosahedronGeometry(6 + rng() * 6, 0);
        g.scale(1, 0.55, 1);
        g.translate((k - nb / 2) * 8 + rng() * 4, rng() * 3, rng() * 8 - 4);
        parts.push(g);
      }
      const im = new THREE.InstancedMesh(mergeList(parts), this._cloudMat, 4);
      im.frustumCulled = false;
      im.name = 'clouds';
      for (let i = 0; i < 4; i++) {
        this._cloudData.push({ im, i, pos: new THREE.Vector3(rng() * 600 - 300, 95 + rng() * 30, rng() * 600 - 300), rot: rng() * Math.PI, s: 0.8 + rng() * 0.5 });
      }
      this._clouds.push(im);
      this.scene.add(im);
    }
    this._cloudM = new THREE.Matrix4(); this._cloudQ = new THREE.Quaternion(); this._cloudS = new THREE.Vector3();
    this._updateClouds(0);
    this._sunDir = new THREE.Vector3();
    this._moonDir = new THREE.Vector3();
    this._st = { top: new THREE.Color(), hor: new THREE.Color(), light: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), fog: new THREE.Color(), li: 1, hi: 1 };
  }

  _skyAt(t) {
    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= t) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    const k = smooth(0, 1, (t - a.t) / (b.t - a.t));
    const st = this._st;
    for (const f of ['top', 'hor', 'light', 'hs', 'hg', 'fog']) st[f].lerpColors(a[f], b[f], k);
    st.li = lerp(a.li, b.li, k);
    st.hi = lerp(a.hi, b.hi, k);
    return st;
  }

  _updateSky(dt, p) {
    const st = this._skyAt(this.timeOfDay);
    const th = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunDir = this._sunDir.set(Math.cos(th), Math.sin(th), 0.35).normalize();
    const moonDir = this._moonDir.set(-Math.cos(th), -Math.sin(th), 0.35).normalize();
    const active = sunDir.y >= 0 ? sunDir : moonDir;
    const fade = smooth(0.0, 0.12, active.y);
    const nightF = 1 - smooth(-0.12, 0.12, sunDir.y);
    this._nightF = nightF;
    const ff = this._forestF, inf = this._interiorF;

    // luz direcional (sol ou lua)
    const sun = this.sun;
    sun.color.copy(st.light);
    sun.intensity = st.li * fade * (1 - 0.35 * ff) * (1 - inf);
    // sombra acompanha jogador com snap ao texel (sem tremulação)
    const right = _v1.crossVectors(UP, active).normalize();
    const up2 = _v2.crossVectors(active, right);
    const texel = (2 * SHADOW_EXT) / 2048;
    const a = Math.round(p.dot(right) / texel) * texel;
    const b = Math.round(p.dot(up2) / texel) * texel;
    const c = p.dot(active);
    const tgt = _v3.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up2, b).addScaledVector(active, c);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(active, 200);
    sun.target.updateMatrixWorld();

    // hemisférica
    const hemi = this.ambient;
    hemi.color.copy(st.hs).lerp(TEMPLE_HS, inf);
    hemi.groundColor.copy(st.hg).lerp(TEMPLE_HG, inf);
    hemi.intensity = lerp(st.hi * (1 - 0.2 * ff), 2.6, inf);

    // névoa
    const fog = this.scene.fog;
    if (fog) {
      fog.color.copy(st.fog).lerp(FOREST_FOG, ff * 0.35 * (1 - nightF * 0.6)).lerp(TEMPLE_FOG, inf);
      const far0 = lerp(320, 210, nightF);
      fog.near = lerp(lerp(60, 14, ff), 8, inf);
      fog.far = lerp(lerp(far0, 120, ff), 78, inf);
      this._bg.copy(fog.color);
      if (this.scene.background !== this._bg && (!this.scene.background || this.scene.background.isColor)) this.scene.background = this._bg;
    }

    // domo do céu
    const u = this._skyMat.uniforms;
    u.topColor.value.copy(st.top);
    u.horizonColor.value.copy(st.hor);
    u.bottomColor.value.copy(st.fog).multiplyScalar(0.8);
    u.sunDir.value.copy(sunDir);
    u.sunColor.value.copy(st.light);
    u.sunGlow.value = smooth(-0.15, 0.1, sunDir.y);
    u.moonDir.value.copy(moonDir);
    u.moonGlow.value = nightF;
    this._sky.position.copy(p);

    this._sunMesh.position.copy(p).addScaledVector(sunDir, 260);
    this._sunMesh.visible = sunDir.y > -0.1;
    this._sunMesh.material.color.setHex(0xfff2b8).lerp(st.light, 0.4);
    this._moonMesh.position.copy(p).addScaledVector(moonDir, 250);
    this._moonMesh.visible = moonDir.y > -0.1;
    this._stars.position.copy(p);
    this._stars.rotation.y = this.timeOfDay * Math.PI * 2;
    this._stars.material.opacity = nightF * 0.95;
    this._stars.visible = nightF > 0.01;

    this._cloudMat.emissive.copy(st.hor).multiplyScalar(0.35 + 0.25 * nightF);
    this._cloudMat.color.setRGB(1, 1, 1).lerp(st.top, nightF * 0.6);
  }

  _updateClouds(dt) {
    if (!this._cloudData) return;
    const M = this._cloudM, Q = this._cloudQ, Sc = this._cloudS;
    for (const c of this._cloudData) {
      c.pos.x += dt * 2.2;
      c.pos.z += dt * 0.6;
      if (c.pos.x > 320) c.pos.x -= 640;
      if (c.pos.z > 320) c.pos.z -= 640;
      M.compose(c.pos, Q.setFromAxisAngle(UP, c.rot), Sc.set(c.s, c.s, c.s));
      c.im.setMatrixAt(c.i, M);
    }
    for (const im of this._clouds) im.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------- água
  _buildWater() {
    const R = 64, rings = 16, segs = 48;
    const pos = [LAKE.x, WATER_Y, LAKE.z];
    for (let r = 1; r <= rings; r++) {
      const rad = (R * r) / rings;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const jr = r < rings ? (hash2(r, s, 91) - 0.5) * 1.2 : 0; // leve irregularidade low-poly
        pos.push(LAKE.x + Math.cos(a) * (rad + jr), WATER_Y, LAKE.z + Math.sin(a) * (rad + jr));
      }
    }
    const idx = [];
    for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
    for (let r = 1; r < rings; r++) {
      const o0 = 1 + (r - 1) * segs, o1 = 1 + r * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(o0 + s, o1 + s, o1 + s1);
        idx.push(o0 + s, o1 + s1, o0 + s1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    // garante que os triângulos apontem para cima
    const P = geo.attributes.position.array;
    for (let t = 0; t < idx.length; t += 3) {
      const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
      const ux = P[ib] - P[ia], uz = P[ib + 2] - P[ia + 2], vx = P[ic] - P[ia], vz = P[ic + 2] - P[ia + 2];
      if (uz * vx - ux * vz < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += 2;
    this._waterBase = Float32Array.from(pos);
    this._waterGeo = geo;
    const mat = new THREE.MeshPhongMaterial({
      color: 0x2f86c8, specular: 0xaad8ff, shininess: 70, flatShading: true,
      transparent: true, opacity: 0.84, emissive: 0x08243a,
    });
    const water = new THREE.Mesh(geo, mat);
    water.receiveShadow = true;
    water.name = 'water';
    this.water = water;
    this.scene.add(water);
  }

  _updateWater() {
    if (!this._waterGeo) return;
    const t = this._time, base = this._waterBase;
    const arr = this._waterGeo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i], z = base[i + 2];
      arr[i + 1] = WATER_Y + Math.sin(x * 0.35 + t * 1.3) * 0.07 + Math.sin(z * 0.29 - t * 1.1 + x * 0.1) * 0.07 + Math.sin((x + z) * 0.8 + t * 2.3) * 0.025;
    }
    this._waterGeo.attributes.position.needsUpdate = true;
  }

  // ----------------------------------------------------------------- tochas
  _addTorch(x, z, { y = null, yaw = 0, indoor = false, model = true } = {}) {
    let root = null, flameY = 1.9;
    if (model) {
      let t = this._m('createTorch');
      if (t && t.isObject3D) t = { root: t, light: null };
      if (!t || !t.root || !t.root.isObject3D) t = FB.torch();
      root = t.root;
      root.updateMatrixWorld(true);
      const light = t.light && t.light.isLight ? t.light : null;
      if (light) flameY = _v1.setFromMatrixPosition(light.matrixWorld).y;
      else {
        const box = new THREE.Box3().setFromObject(root);
        if (!box.isEmpty()) flameY = box.max.y - 0.2;
      }
      const gy = y ?? this.getHeight(x, z);
      this._place(root, x, z, { y: gy, yaw, cast: false, receive: false });
      this.addCircleCollider(x, z, 0.3);
      this._occupy(x, z, 1);
      this._torches.push({ x, y: gy + flameY, z, ph: this._rng() * 10, indoor });
    } else {
      this._torches.push({ x, y: y ?? this.getHeight(x, z) + 1, z, ph: this._rng() * 10, indoor });
    }
  }

  _buildTorchLights() {
    this._pool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 22, 2);
      l.castShadow = false;
      this._pool.push(l);
      this.scene.add(l);
    }
    this._assigned = new Array(6).fill(null);
  }

  _updateTorches(dt, p) {
    if (!this._pool) return;
    this._torchTimer -= dt;
    if (this._torchTimer <= 0) {
      this._torchTimer = 0.25;
      const sorted = this._torches
        .map((t) => [t, (t.x - p.x) ** 2 + (t.z - p.z) ** 2])
        .filter((e) => e[1] < 55 * 55)
        .sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < this._pool.length; i++) this._assigned[i] = sorted[i] ? sorted[i][0] : null;
    }
    const t = this._time, night = this._nightF ?? 0, inf = this._interiorF;
    for (let i = 0; i < this._pool.length; i++) {
      const l = this._pool[i], tr = this._assigned[i];
      if (!tr) { l.intensity = 0; continue; }
      l.position.set(tr.x, tr.y + 0.25, tr.z);
      const fl = 0.82 + 0.12 * Math.sin(t * 11 + tr.ph) + 0.08 * Math.sin(t * 23.7 + tr.ph * 2.1) + 0.04 * Math.sin(t * 37 + tr.ph);
      const base = tr.indoor ? lerp(30, 60, inf) : lerp(6, 32, Math.max(night, inf * 0.5));
      const d = Math.hypot(tr.x - p.x, tr.z - p.z);
      l.intensity = base * fl * smooth(55, 40, d);
    }
  }

  // ------------------------------------------------------------- animações
  _openDoor() {
    const d = this.templeDoor;
    if (d.isOpen) return;
    d.isOpen = true;
    if (!this._doorObj) { this.removeCollider(this._doorCol); return; }
    const y0 = this._doorObj.position.y;
    this._anims.push({ obj: this._doorObj, t: 0, dur: 2.2, y0, y1: y0 - 9, shake: true, x0: this._doorObj.position.x, done: () => { this.removeCollider(this._doorCol); this._doorObj.visible = false; } });
  }
  _openGate() {
    const g = this.bossGate;
    if (g.isOpen) return;
    g.isOpen = true;
    if (!this._gateObj) { this.removeCollider(this._gateCol); return; }
    const y0 = this._gateObj.position.y;
    this._anims.push({ obj: this._gateObj, t: 0, dur: 1.6, y0, y1: y0 + 7.5, shake: false, x0: this._gateObj.position.x, done: () => { this.removeCollider(this._gateCol); this._gateObj.visible = false; } });
  }
  _updateAnims(dt) {
    for (let i = this._anims.length - 1; i >= 0; i--) {
      const a = this._anims[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      const e = k * k * (3 - 2 * k);
      a.obj.position.y = lerp(a.y0, a.y1, e);
      a.obj.position.x = a.x0 + (a.shake && k < 1 ? Math.sin(a.t * 60) * 0.05 : 0);
      if (k >= 1) { this._anims.splice(i, 1); try { a.done && a.done(); } catch (e2) { /* ignora */ } }
    }
  }

  _updateCulling(dt, p) {
    this._cullTimer -= dt;
    if (this._cullTimer > 0) return;
    this._cullTimer = 0.3;
    const R2 = 85 * 85;
    for (const c of this.cuttables) {
      if (!c.alive || !c.mesh || c.mesh.isInstanceProxy) continue;
      const dx = c.position.x - p.x, dz = c.position.z - p.z;
      c.mesh.visible = dx * dx + dz * dz < R2;
    }
  }

  _updateFireflies() {
    if (!this._flies) return;
    const t = this._time, base = this._fliesBase, arr = this._flies.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const ph = i * 0.37;
      arr[i] = base[i] + Math.sin(t * 0.7 + ph) * 1.5;
      arr[i + 1] = base[i + 1] + Math.sin(t * 1.3 + ph * 2) * 0.6;
      arr[i + 2] = base[i + 2] + Math.cos(t * 0.6 + ph) * 1.5;
    }
    this._flies.geometry.attributes.position.needsUpdate = true;
    this._flies.material.opacity = 0.1 + 0.85 * (this._nightF ?? 0) * (1 - this._interiorF);
  }

  // ---------------------------------------------------------- helpers decor
  _tree(x, z, variant, scale = 1) {
    const t = this._model('createTree', FB.tree, variant);
    this._place(t, x, z, { yaw: this._rng() * Math.PI * 2, scale, sink: 0.15 });
    this.addCircleCollider(x, z, (variant === 2 ? 1.4 : 0.55) * scale);
    this._occupy(x, z, (variant === 2 ? 3.5 : 1.6) * scale);
  }
  _rock(x, z, size, collide = true) {
    const r = this._model('createRock', FB.rock, size);
    this._place(r, x, z, { yaw: this._rng() * Math.PI * 2, sink: 0.1 * size });
    if (collide && size >= 0.9) this.addCircleCollider(x, z, 0.7 * size);
    this._occupy(x, z, 0.9 * size);
  }
  _bush(x, z, scale = 1) {
    const b = this._model('createBush', FB.bush);
    this._place(b, x, z, { yaw: this._rng() * 6.28, scale, cast: false });
    this._occupy(x, z, 0.9);
  }
  _flower(x, z) {
    const f = this._model('createFlower', FB.flower);
    this._place(f, x, z, { yaw: this._rng() * 6.28, cast: false });
  }
  _grass(x, z) {
    const y = this.getHeight(x, z);
    const c = { mesh: null, position: new THREE.Vector3(x, y, z), alive: true, type: 'grass' };
    this.cuttables.push(c);
    (this._pendCut || (this._pendCut = [])).push({ c, kind: 'grass', x, y, z, rot: this._rng() * Math.PI * 2, s: 0.85 + this._rng() * 0.35 });
    this._occupy(x, z, 0.4);
  }
  _pot(x, z, y = null) {
    const gy = y ?? this.getHeight(x, z);
    const c = { mesh: null, position: new THREE.Vector3(x, gy, z), alive: true, type: 'pot' };
    this.cuttables.push(c);
    (this._pendCut || (this._pendCut = [])).push({ c, kind: 'pot', x, y: gy, z, rot: this._rng() * Math.PI * 2, s: 1 });
    this._occupy(x, z, 0.6);
  }
  // Cortáveis viram InstancedMesh (poucos draw calls); cada item recebe um proxy com `visible`.
  // Se o modelo não puder ser instanciado, cai no modo antigo (um Group por item).
  _buildCuttables() {
    const pend = this._pendCut || [];
    this._pendCut = null;
    const cfg = {
      grass: { make: () => this._model('createGrassTuft', FB.grass), variants: 3, cast: false, receive: true },
      pot: { make: () => this._model('createPot', FB.pot), variants: 1, cast: true, receive: true },
    };
    const legacy = (it, make) => {
      const g = collapse(make());
      g.position.set(it.x, it.y, it.z);
      g.rotation.y = it.rot;
      g.scale.multiplyScalar(it.s);
      if (it.kind === 'pot') g.name = 'pot';
      g.traverse((o) => { if (o.isMesh) { o.castShadow = it.kind === 'pot'; o.receiveShadow = true; } });
      this.scene.add(g);
      it.c.mesh = g;
    };
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    for (const kind of Object.keys(cfg)) {
      const items = pend.filter((it) => it.kind === kind);
      if (!items.length) continue;
      const k = cfg[kind];
      // monta variantes: lista de partes {geo, mat} em coordenadas locais do item
      const variants = [];
      try {
        for (let v = 0; v < k.variants; v++) {
          const obj = collapse(k.make());
          obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.scale.set(1, 1, 1);
          obj.updateMatrixWorld(true);
          const parts = [];
          let ok = true;
          obj.traverse((o) => {
            if (!ok || !o.isMesh) return;
            if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) { ok = false; return; }
            const geo = o.geometry.clone();
            geo.applyMatrix4(o.matrixWorld);
            parts.push({ geo, mat: o.material });
          });
          if (ok && parts.length) variants.push(parts);
        }
      } catch (e) { variants.length = 0; }
      if (!variants.length) { for (const it of items) legacy(it, k.make); continue; }
      const byVar = variants.map(() => []);
      items.forEach((it, i) => byVar[i % variants.length].push(it));
      variants.forEach((parts, vi) => {
        const list = byVar[vi];
        if (!list.length) return;
        const ims = parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
          im.castShadow = k.cast; im.receiveShadow = k.receive;
          im.name = kind + '_inst';
          this.scene.add(im);
          return im;
        });
        list.forEach((it, i) => {
          const m = new THREE.Matrix4().compose(ps.set(it.x, it.y, it.z), q.setFromAxisAngle(UP, it.rot), sc.setScalar(it.s));
          for (const im of ims) im.setMatrixAt(i, m);
          it.c.mesh = new InstanceProxy(ims.map((im) => [im, i]), m, kind, it.c.position);
        });
        for (const im of ims) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
      });
    }
  }
  _sign(x, z, yaw, text) {
    const s = this._model('createSign', FB.sign);
    this._place(s, x, z, { yaw });
    this.addCircleCollider(x, z, 0.35);
    this._occupy(x, z, 1);
    this.signs.push({ position: new THREE.Vector3(x, this.getHeight(x, z), z), text });
  }
  // Espalha itens com rejeição
  _scatter(count, sample, ok, r, place, tries = count * 30) {
    let n = 0;
    for (let i = 0; i < tries && n < count; i++) {
      const [x, z] = sample();
      if (!ok(x, z) || !this._free(x, z, r)) continue;
      place(x, z);
      n++;
    }
    return n;
  }
  _fieldOK(x, z, pathClear = 3.5) {
    if (Math.hypot(x, z) < 50) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < lakeRadius(x, z) + 6) return false;
    if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r + 4) return false;
    if (sdBox(x, z, PLATEAU.x0, PLATEAU.x1, PLATEAU.z0, PLATEAU.z1) < 8) return false;
    if (Math.abs(x) > 215 || Math.abs(z) > 215 || cliffMask(x, z) > 0.02) return false;
    if (pathDist(x, z) < pathClear) return false;
    if (this._slope(x, z) > 0.6) return false;
    return true;
  }

  // ------------------------------------------------------------------- vila
  _buildVillage() {
    const rng = this._rng;
    // reserva spots de NPCs e baú
    for (const [x, z] of [[6, -5], [-9, 7], [17, 4], [0, 12], [-12, 35]]) this._occupy(x, z, 2);
    this._occupy(0, -3, 3);

    const well = this._model('createWell', FB.well);
    this._place(well, 0, -3);
    this.addCircleCollider(0, -3, 1.6);

    const houses = [[-24, -12, Math.PI / 2], [-24, 12, Math.PI / 2], [24, -12, -Math.PI / 2], [24, 14, -Math.PI / 2],
      [-12, 28, Math.PI], [12, 28, Math.PI], [-14, -28, 0]];
    houses.forEach(([x, z, yaw], i) => {
      const h = this._model('createHouse', FB.house, i % 3);
      h.position.set(x, this.getHeight(x, z), z);
      h.rotation.y += yaw;
      const box = new THREE.Box3().setFromObject(h);
      let hx = 3.2, hz = 3.2, cx = x, cz = z;
      if (!box.isEmpty()) {
        const s = box.getSize(_v1), c = box.getCenter(_v2);
        hx = clamp(s.x / 2 - 0.35, 1.5, 3.6); hz = clamp(s.z / 2 - 0.35, 1.5, 3.6);
        cx = c.x; cz = c.z;
      }
      this.addBoxCollider(cx - hx, cx + hx, cz - hz, cz + hz);
      this._occupy(x, z, 5);
      h.position.set(0, 0, 0); h.rotation.y -= yaw;
      this._place(h, x, z, { yaw });
      // vaso ao lado da casa
      const lx = 3.9, lz = 2.4;
      const px = x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, pz = z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
      this._pot(px, pz);
      // flores no jardim
      for (let k = 0; k < 6; k++) {
        const fx = x + Math.cos(yaw) * (-3.8 + rng() * 0.6) + Math.sin(yaw) * (rng() * 6 - 3);
        const fz = z - Math.sin(yaw) * (-3.8 + rng() * 0.6) + Math.cos(yaw) * (rng() * 6 - 3);
        if (pathDist(fx, fz) > 2) this._flower(fx, fz);
      }
    });
    this._pot(2.2, -5.4); this._pot(-2.4, -5.2);

    // cercas (eixo X ou Z), com aberturas nos caminhos
    const runs = [[-34, 40, 34, 40], [-34, -40, -7, -40], [7, -40, 34, -40], [40, -34, 40, -13], [40, 3, 40, 34], [-40, -34, -40, -16], [-40, 3, -40, 34]];
    for (const [x0, z0, x1, z1] of runs) {
      const alongX = z0 === z1;
      const len = alongX ? x1 - x0 : z1 - z0;
      const n = Math.ceil(len / 8), seg = len / n;
      for (let k = 0; k < n; k++) {
        const cx = alongX ? x0 + seg * (k + 0.5) : x0, cz = alongX ? z0 : z0 + seg * (k + 0.5);
        const f = this._normalize(this._model('createFence', FB.fence, seg), { alignX: true });
        this._place(f, cx, cz, { yaw: alongX ? 0 : Math.PI / 2, cast: true });
        if (alongX) this.addBoxCollider(cx - seg / 2, cx + seg / 2, cz - 0.2, cz + 0.2);
        else this.addBoxCollider(cx - 0.2, cx + 0.2, cz - seg / 2, cz + seg / 2);
        this._occupy(cx, cz, seg / 2);
      }
    }

    // placas
    this._sign(5, -36, 0, 'Norte: Santuário da Raiz');
    this._sign(-36, -8, Math.PI / 2, 'Oeste: Bosque Sussurrante');
    this._sign(36, 2, -Math.PI / 2, 'Leste: Lago Espelhado');
    this._sign(-4, 10, 0, 'Vila Brisa — bem-vindo, viajante!');

    // tochas da praça
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 11, z = -2 + Math.sin(a) * 11;
      if (pathDist(x, z) < 2.6 || !this._free(x, z, 0.8)) continue;
      this._addTorch(x, z);
    }

    // barraca do mercador Brom
    const stall = new THREE.Group();
    const wood = lam(0x8a5a34), clothA = lam(0xd94a3a), clothB = lam(0xf2e6c8);
    stall.add(mesh(new THREE.BoxGeometry(1.4, 1.0, 3.4), wood, 0, 0.5, 0));
    for (const [px, pz] of [[-0.8, -1.7], [-0.8, 1.7], [0.9, -1.7], [0.9, 1.7]]) stall.add(mesh(new THREE.BoxGeometry(0.15, 2.8, 0.15), wood, px, 1.4, pz));
    for (let k = 0; k < 4; k++) {
      const s = mesh(new THREE.BoxGeometry(2.2, 0.12, 0.9), k % 2 ? clothA : clothB, 0, 2.9 - Math.abs(k - 1.5) * 0.05, -1.35 + k * 0.9);
      s.rotation.z = 0.12; stall.add(s);
    }
    stall.add(mesh(new THREE.IcosahedronGeometry(0.25, 0), lam(0xff4466), 0.1, 1.2, -0.8));
    stall.add(mesh(new THREE.IcosahedronGeometry(0.25, 0), lam(0x44aaff), 0.1, 1.2, 0));
    stall.add(mesh(new THREE.IcosahedronGeometry(0.25, 0), lam(0x55dd66), 0.1, 1.2, 0.8));
    this._place(stall, 20.2, 4);
    this.addBoxCollider(19.2, 21.2, 2.2, 5.8);
    this._occupy(20.2, 4, 2.5);
    // barris e caixotes
    const barrel = () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.0, 8), lam(0x8a5a34), 0, 0.5, 0)); g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.08, 8), lam(0x444444), 0, 0.75, 0)); return g; };
    const crate = () => { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), lam(0xb08050), 0, 0.45, 0)); return g; };
    for (const [x, z, f] of [[21.5, 7.2, barrel], [22.6, 6.6, barrel], [21.8, 0.6, crate], [-19.6, -17, barrel], [-19.8, 17.5, crate], [17, 31.5, barrel], [-29, -26, crate]]) {
      this._place(f(), x, z, { yaw: rng() * 6.28 });
      this.addCircleCollider(x, z, 0.5);
      this._occupy(x, z, 0.8);
    }

    // árvores da vila
    for (const [x, z, v] of [[-32, 28, 0], [32, -30, 0], [-31, -33, 1], [31, 32, 0], [-1, 35, 0], [-34, 14, 1], [34, 22, 1], [-20, 34, 0]]) {
      if (this._free(x, z, 1.5)) this._tree(x, z, v, 0.9 + rng() * 0.3);
    }
    // flores e grama cortável da vila
    const inVillage = (x, z) => Math.hypot(x, z + 2) > 13 && pathDist(x, z) > 2.5 && Math.abs(x) < 38 && Math.abs(z) < 38;
    const sampleV = () => [rng() * 76 - 38, rng() * 76 - 38];
    this._scatter(70, sampleV, inVillage, 0.3, (x, z) => this._flower(x, z));
    this._scatter(32, sampleV, inVillage, 0.6, (x, z) => this._grass(x, z));
    this._scatter(10, sampleV, inVillage, 1.2, (x, z) => this._bush(x, z, 0.8));
  }

  // ------------------------------------------------------------------ bosque
  _buildForest() {
    const rng = this._rng;
    // reserva clareira, baú e acampamento
    this._occupy(CLEARING.x, CLEARING.z, CLEARING.r);
    this._occupy(-178, -96, 4);

    const inForest = (x, z, extra = 0) => {
      const d = Math.hypot(x - FOREST.x, z - FOREST.z) + (vnoise(x * 0.05, z * 0.05, 51) - 0.5) * 16;
      if (d > FOREST.r + extra) return false;
      if (pathDist(x, z) < 3.2) return false;
      if (cliffMask(x, z) > 0.05 || Math.abs(x) > 215) return false;
      if (sdBox(x, z, PLATEAU.x0, PLATEAU.x1, PLATEAU.z0, PLATEAU.z1) < 10) return false;
      return true;
    };
    const sample = () => {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (FOREST.r + 8);
      return [FOREST.x + Math.cos(a) * r, FOREST.z + Math.sin(a) * r];
    };
    // árvores gigantes primeiro
    this._scatter(16, sample, (x, z) => inForest(x, z, -8), 4, (x, z) => this._tree(x, z, 2, 0.9 + rng() * 0.35));
    this._scatter(160, sample, (x, z) => inForest(x, z), 1.6, (x, z) => {
      const v = rng() < 0.62 ? 1 : 0;
      this._tree(x, z, v, 0.85 + rng() * 0.45);
    }, 6000);
    this._scatter(45, sample, (x, z) => inForest(x, z, 4), 0.8, (x, z) => this._bush(x, z, 0.8 + rng() * 0.5));
    this._scatter(22, sample, (x, z) => inForest(x, z), 1, (x, z) => this._rock(x, z, 0.6 + rng() * 1.0));
    // cogumelos
    const mush = () => {
      const g = new THREE.Group();
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const ox = (rng() - 0.5) * 0.8, oz = (rng() - 0.5) * 0.8, s = 0.6 + rng() * 0.7;
        g.add(mesh(new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.35 * s, 5), lam(0xf0e6d0), ox, 0.17 * s, oz));
        g.add(mesh(new THREE.ConeGeometry(0.22 * s, 0.18 * s, 6), lam(k % 2 ? 0xd8483a : 0xc87ad8, { emissive: k % 2 ? 0x000000 : 0x3a1a4a }), ox, 0.4 * s, oz));
      }
      return g;
    };
    this._scatter(40, sample, (x, z) => inForest(x, z), 0.5, (x, z) => this._place(mush(), x, z, { cast: false }));
    // troncos caídos
    for (let k = 0; k < 6; k++) {
      const [x, z] = sample();
      if (!inForest(x, z) || !this._free(x, z, 2.5)) continue;
      const g = new THREE.Group();
      const log = mesh(new THREE.CylinderGeometry(0.45, 0.5, 4.5, 7), lam(0x6b4a2b), 0, 0.4, 0);
      log.rotation.z = Math.PI / 2; g.add(log);
      g.add(mesh(new THREE.BoxGeometry(1.2, 0.08, 0.9), lam(0x3f7a32), 0.6, 0.85, 0));
      const yaw = rng() * Math.PI;
      this._place(g, x, z, { yaw });
      this.addCircleCollider(x + Math.cos(yaw) * 1.3, z - Math.sin(yaw) * 1.3, 0.6);
      this.addCircleCollider(x - Math.cos(yaw) * 1.3, z + Math.sin(yaw) * 1.3, 0.6);
      this._occupy(x, z, 2.5);
    }
    // grama na borda do bosque
    this._scatter(30, sample, (x, z) => inForest(x, z, 10) && !inForest(x, z, -25) && this._slope(x, z) < 0.6, 0.6, (x, z) => this._grass(x, z));

    // clareira: pedras em anel, flores, fogueira
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const x = CLEARING.x + Math.cos(a) * 14.5, z = CLEARING.z + Math.sin(a) * 14.5;
      if (pathDist(x, z) < 3) continue;
      this._rock(x, z, 1.1 + rng() * 0.6);
    }
    for (let k = 0; k < 30; k++) {
      const a = rng() * Math.PI * 2, r = 3 + rng() * 10;
      this._flower(CLEARING.x + Math.cos(a) * r, CLEARING.z + Math.sin(a) * r);
    }
    const fire = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const s = mesh(new THREE.DodecahedronGeometry(0.28, 0), lam(0x77736a), Math.cos(k * 1.256) * 0.75, 0.15, Math.sin(k * 1.256) * 0.75);
      fire.add(s);
    }
    for (let k = 0; k < 3; k++) {
      const l = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 5), lam(0x5a3e24), 0, 0.2, 0);
      l.rotation.z = Math.PI / 2 - 0.3; l.rotation.y = k * 2.1; fire.add(l);
    }
    fire.add(mesh(new THREE.ConeGeometry(0.4, 0.9, 5), new THREE.MeshBasicMaterial({ color: 0xff8a2a }), 0, 0.6, 0));
    fire.add(mesh(new THREE.ConeGeometry(0.22, 0.6, 5), new THREE.MeshBasicMaterial({ color: 0xffe07a }), 0, 0.55, 0));
    const fx = CLEARING.x + 4, fz = CLEARING.z - 3.5;
    this._place(fire, fx, fz, { cast: false });
    this.addCircleCollider(fx, fz, 0.9);
    this._addTorch(fx, fz, { y: this.getHeight(fx, fz) + 0.4, model: false });

    // vaga-lumes
    const n = 90, fp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, z] = i < 30
        ? [CLEARING.x + (rng() - 0.5) * 26, CLEARING.z + (rng() - 0.5) * 26]
        : (() => { const a = rng() * 6.28, r = Math.sqrt(rng()) * FOREST.r; return [FOREST.x + Math.cos(a) * r, FOREST.z + Math.sin(a) * r]; })();
      fp[i * 3] = x; fp[i * 3 + 1] = this.getHeight(x, z) + 0.8 + rng() * 2.2; fp[i * 3 + 2] = z;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.computeBoundingSphere();
    this._fliesBase = Float32Array.from(fp);
    this._flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.35, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
    this._flies.frustumCulled = false;
    this.scene.add(this._flies);
  }

  // ------------------------------------------------------------------- lago
  _buildLake() {
    const rng = this._rng;
    const zc = ISLAND.z;
    // encontra a margem oeste e a borda da ilha
    // borda da ilha: a partir do centro, anda para oeste até a água
    let x1 = ISLAND.x;
    while (x1 > ISLAND.x - 20 && heightRaw(x1 - 0.5, zc) >= WATER_Y + 0.7) x1 -= 0.5;
    // margem oeste: a partir da ilha, atravessa a água até a terra
    let x0 = x1 - 1;
    while (x0 > ISLAND.x - 80 && heightRaw(x0, zc) < WATER_Y + 0.7) x0 -= 0.5;
    x0 -= 1.5; x1 += 1.5;
    const deckY = 0.75;
    const bridge = new THREE.Group();
    const plank = lam(0x9a6a3a), post = lam(0x6e4a28);
    for (let x = x0; x <= x1; x += 0.8) {
      const m = mesh(new THREE.BoxGeometry(0.7, 0.18, 3.2), plank, x - x0, deckY - 0.09, 0);
      m.rotation.y = (hash2(Math.round(x * 10), 3, 5) - 0.5) * 0.06;
      bridge.add(m);
    }
    const len = x1 - x0;
    for (let x = 0; x <= len + 0.01; x += 4) {
      for (const s of [-1.55, 1.55]) bridge.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 6.5, 6), post, x, deckY - 2.2, s));
    }
    for (const s of [-1.55, 1.55]) {
      const r = mesh(new THREE.BoxGeometry(len, 0.12, 0.12), plank, len / 2, deckY + 0.95, s); bridge.add(r);
      const r2 = mesh(new THREE.BoxGeometry(len, 0.1, 0.1), plank, len / 2, deckY + 0.5, s); bridge.add(r2);
    }
    this._place(bridge, x0, zc, { y: 0 });
    this._platforms.push({ x0, x1, z0: zc - 1.6, z1: zc + 1.6, y: deckY });
    // corrimãos bloqueiam a queda
    this.addBoxCollider(x0 + 2, x1 - 1, zc - 1.75, zc - 1.45);
    this.addBoxCollider(x0 + 2, x1 - 1, zc + 1.45, zc + 1.75);
    this._addTorch(x0 - 1.5, zc - 2.6);
    this._addTorch(x0 - 1.5, zc + 2.6);

    // ilha
    this._tree(ISLAND.x + 1.5, ISLAND.z - 1, 0, 1.2);
    for (let k = 0; k < 14; k++) {
      const a = rng() * 6.28, r = 1 + rng() * 4.5;
      this._flower(ISLAND.x + Math.cos(a) * r, ISLAND.z + Math.sin(a) * r);
    }
    this._rock(ISLAND.x - 2, ISLAND.z + 3, 1.0);
    // pedra antiga com runa na ilha
    const stele = new THREE.Group();
    stele.add(mesh(new THREE.BoxGeometry(0.9, 2.2, 0.4), lam(0x8a857c), 0, 1.1, 0));
    stele.add(mesh(new THREE.BoxGeometry(0.4, 0.4, 0.05), new THREE.MeshLambertMaterial({ color: 0x3aff9a, emissive: 0x3aff9a, emissiveIntensity: 0.8 }), 0, 1.5, 0.22));
    this._place(stele, ISLAND.x + 3, ISLAND.z + 2, { yaw: -Math.PI / 2 });
    this.addCircleCollider(ISLAND.x + 3, ISLAND.z + 2, 0.6);

    // vitórias-régias e juncos
    const pads = [], reeds = [];
    for (let k = 0; k < 160 && pads.length < 26; k++) {
      const a = rng() * 6.28, d = LAKE.r - 4 - rng() * 14;
      const x = LAKE.x + Math.cos(a) * d, z = LAKE.z + Math.sin(a) * d;
      const h = heightRaw(x, z);
      if (h > WATER_Y - 0.6 || h < WATER_Y - 3 || Math.abs(z - zc) < 3) continue;
      const g = new THREE.CylinderGeometry(0.5 + rng() * 0.4, 0.5, 0.04, 7);
      g.translate(x, WATER_Y + 0.17, z);
      pads.push(g);
    }
    for (let k = 0; k < 600 && reeds.length < 140; k++) {
      const a = rng() * 6.28, d = LAKE.r - 6 + rng() * 14;
      const x = LAKE.x + Math.cos(a) * d, z = LAKE.z + Math.sin(a) * d;
      const h = heightRaw(x, z);
      if (h < WATER_Y - 0.5 || h > WATER_Y + 0.7 || Math.abs(z - zc) < 3) continue;
      const g = new THREE.ConeGeometry(0.06, 1.2 + rng() * 0.8, 3);
      g.rotateZ((rng() - 0.5) * 0.3);
      g.translate(x, h + 0.6, z);
      reeds.push(g);
    }
    if (pads.length) { const m = new THREE.Mesh(mergeList(pads), lam(0x3f9a3a)); m.receiveShadow = true; this.scene.add(m); }
    if (reeds.length) { const m = new THREE.Mesh(mergeList(reeds), lam(0x6a8a3a)); this.scene.add(m); }

    // pedras e areia na margem
    const sample = () => { const a = rng() * 6.28, d = LAKE.r + rng() * 18; return [LAKE.x + Math.cos(a) * d, LAKE.z + Math.sin(a) * d]; };
    const ok = (x, z) => { const h = heightRaw(x, z); return h > WATER_Y + 0.4 && pathDist(x, z) > 3 && Math.abs(z - zc) > 4 && Math.abs(x) < 215 && cliffMask(x, z) < 0.02; };
    this._scatter(14, sample, ok, 1.2, (x, z) => this._rock(x, z, 0.6 + rng() * 1.2));
    this._scatter(14, sample, ok, 1, (x, z) => this._bush(x, z, 0.8));
    this._scatter(20, sample, ok, 0.6, (x, z) => this._grass(x, z));
  }

  // ------------------------------------------------------------------ campos
  _buildField() {
    const rng = this._rng;
    const sample = () => [rng() * 440 - 220, rng() * 440 - 220];
    const ok = (x, z) => this._fieldOK(x, z);
    this._scatter(55, sample, ok, 2.5, (x, z) => this._tree(x, z, rng() < 0.6 ? 0 : 1, 0.85 + rng() * 0.4));
    this._scatter(60, sample, ok, 1.2, (x, z) => this._rock(x, z, 0.5 + rng() * 1.5));
    this._scatter(80, sample, ok, 1, (x, z) => this._bush(x, z, 0.7 + rng() * 0.6));
    // pedras grandes perto dos penhascos
    const edge = () => {
      const s = rng() * 4, t = rng() * 420 - 210, e = 200 + rng() * 14;
      return s < 1 ? [t, e] : s < 2 ? [t, -e] : s < 3 ? [e, t] : [-e, t];
    };
    const edgeOK = (x, z) => cliffMask(x, z) < 0.2 && !inTempleShape(x, z, 10) && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 10;
    this._scatter(40, edge, edgeOK, 2, (x, z) => this._rock(x, z, 2 + rng() * 2.5));
    // campos de flores
    for (let p = 0; p < 18; p++) {
      const [cx, cz] = sample();
      if (!ok(cx, cz)) continue;
      for (let k = 0; k < 12; k++) {
        const x = cx + (rng() - 0.5) * 10, z = cz + (rng() - 0.5) * 10;
        if (ok(x, z)) this._flower(x, z);
      }
    }
    // tufos cortáveis em manchas
    let total = 0;
    for (let p = 0; p < 200 && total < 160; p++) {
      const [cx, cz] = p < 12
        ? [Math.cos(p) * (55 + rng() * 25), Math.sin(p) * (55 + rng() * 25)] // perto da vila
        : sample();
      if (!this._fieldOK(cx, cz, 3)) continue;
      const n = 5 + Math.floor(rng() * 5);
      for (let k = 0; k < n && total < 160; k++) {
        const x = cx + (rng() - 0.5) * 8, z = cz + (rng() - 0.5) * 8;
        if (!this._fieldOK(x, z, 2.5) || !this._free(x, z, 0.5)) continue;
        this._grass(x, z);
        total++;
      }
    }
  }

  // ---------------------------------------------------------------- templo
  // Tudo do templo é montado em poucos VCBuilders (cores por vértice) => ~6 draw calls no total.
  _buildTemple() {
    const Y = FLOOR_Y;
    const R = mulberry32(5150); // RNG próprio: detalhes do templo não alteram o resto do mapa
    const S = new VCBuilder();  // salões: pedra, madeira, musgo, raízes
    const A = new VCBuilder();  // arena do chefe
    const G = new VCBuilder();  // runas / cristais (brilho, sem luz)
    const F = new VCBuilder();  // chamas
    const STONE = [0x8f897b, 0x867f71, 0x9b9485, 0x7c766a, 0x948c7c, 0x837d70];
    const MORTAR = 0x3a352e, TRIM = 0xa39b8a, CEIL = 0x58524a, WOOD = 0x5e4129, WOOD2 = 0x4c3420;
    const FLOOR = [0x7a7366, 0x6f695e, 0x837b6d, 0x686257, 0x756e61];
    const MOSS = [0x4f7a34, 0x5f8a3a, 0x3f6a2e, 0x6a8f3c];
    const ROOT = [0x5a4a2e, 0x4a3a22, 0x63512f];
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const stoneTone = (yRel, mossy = 0.07) => {
      const damp = smooth(3, 0, yRel); // pedras de baixo mais escuras/úmidas
      const m = R() < mossy + damp * 0.1 ? 0.18 + R() * 0.2 : 0;
      const c = tone(pick(STONE), R, 0.09, m ? 0x4a5a32 : 0x4a443a, m || damp * 0.18);
      return c;
    };

    // --- parede de blocos alinhada aos eixos (fiadas desencontradas, rodapé e cornija)
    const blockWall = (B, x0, x1, z0, z1, top, { bottom = Y - 2, plinth = true, cornice = true } = {}) => {
      const alongX = x1 - x0 >= z1 - z0;
      const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
      const b0 = alongX ? z0 : x0, b1 = alongX ? z1 : x1;
      const put = (u0, u1, y0, y1, v0, v1, col) => {
        if (alongX) B.boxMM(u0, u1, y0, y1, v0, v1, col); else B.boxMM(v0, v1, y0, y1, u0, u1, col);
      };
      // núcleo escuro (argamassa vista nas juntas)
      put(a0, a1, bottom, top, b0 + 0.07, b1 - 0.07, tone(MORTAR, R, 0.05));
      let yb = Math.max(bottom, Y + 0.6);
      if (plinth && bottom < Y + 0.6) put(a0, a1, Math.max(bottom, Y - 0.2), Y + 0.6, b0 - 0.16, b1 + 0.16, tone(TRIM, R, 0.05, 0x5a5448, 0.25));
      else yb = bottom;
      const yt = cornice ? top - 0.45 : top;
      if (cornice) put(a0 - 0.02, a1 + 0.02, yt, top, b0 - 0.22, b1 + 0.22, tone(TRIM, R, 0.05));
      const H = yt - yb;
      if (H <= 0.05) return;
      const nC = Math.max(1, Math.round(H / 1.1)), ch = H / nC, g = 0.035;
      for (let c = 0; c < nC; c++) {
        const y0 = yb + c * ch, y1 = y0 + ch;
        let u = a0;
        let first = (c % 2 ? 0.45 : 0.9) + R() * 0.6;
        while (u < a1 - 1e-3) {
          let len = first || 1.3 + R() * 1.1;
          first = 0;
          if (a1 - (u + len) < 0.6) len = a1 - u;
          const p0 = R() * 0.05, p1 = R() * 0.05;
          put(u + g, u + len - g, y0 + g, y1 - g, b0 - p0, b1 + p1, stoneTone(y0 - Y));
          u += len;
        }
      }
    };
    const wall = (x0, x1, z0, z1, top = Y + 9) => {
      blockWall(S, x0, x1, z0, z1, top);
      this.addBoxCollider(x0, x1, z0, z1);
    };
    // --- teto em placas + vigas de madeira
    const ceiling = (B, x0, x1, z0, z1, y0 = Y + 9, y1 = Y + 10.5, ts = 3.2) => {
      const nx = Math.max(1, Math.round((x1 - x0) / ts)), nz = Math.max(1, Math.round((z1 - z0) / ts));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          B.boxMM(lerp(x0, x1, i / nx), lerp(x0, x1, (i + 1) / nx), y0, y1, lerp(z0, z1, j / nz), lerp(z0, z1, (j + 1) / nz), tone(CEIL, R, 0.12));
        }
      }
    };
    const beamsX = (B, x0, x1, zs, y = Y + 9, h = 0.65) => { for (const z of zs) B.boxMM(x0, x1, y - h, y, z - 0.3, z + 0.3, tone(WOOD, R, 0.12)); };
    const beamsZ = (B, z0, z1, xs, y = Y + 9, h = 0.95) => { for (const x of xs) B.boxMM(x - 0.35, x + 0.35, y - h, y, z0, z1, tone(WOOD2, R, 0.1)); };
    // --- piso de lajes desencontradas sobre argamassa (topo exatamente em Y)
    const floorRect = (B, x0, x1, z0, z1, ts = 2.1) => {
      B.boxMM(x0, x1, Y - 0.35, Y - 0.05, z0, z1, tone(MORTAR, R, 0.04));
      const nz = Math.max(1, Math.round((z1 - z0) / ts)), dz = (z1 - z0) / nz, g = 0.05;
      for (let j = 0; j < nz; j++) {
        const za = z0 + j * dz, zb = za + dz;
        let u = x0 - (j % 2 ? ts * 0.5 : 0) - R() * 0.4;
        while (u < x1 - 1e-3) {
          const w = ts * (0.75 + R() * 0.5);
          const ua = Math.max(u, x0), ub = Math.min(u + w, x1);
          if (ub - ua > 0.2) B.boxMM(ua + g, ub - g, Y - 0.25, Y, za + g, zb - g, tone(pick(FLOOR), R, 0.08));
          u += w;
        }
      }
    };
    // --- coluna em tambores
    const column = (B, x, z, h, r, { base = 1.3, cap = true } = {}) => {
      const cyl = (rt, rb, hh, y, seg = 8) => { const c = new THREE.CylinderGeometry(rt, rb, hh, seg); c.rotateY(Math.PI / 8); c.translate(x, y, z); return c; };
      B.geo(cyl(r * base, r * base * 1.05, 0.6, Y + 0.3), tone(TRIM, R, 0.05, 0x5a5448, 0.2));
      B.geo(cyl(r * 1.08, r * base * 0.95, 0.45, Y + 0.82), tone(TRIM, R, 0.05));
      const y0 = Y + 1.05, y1 = Y + h - (cap ? 1.0 : 0);
      B.geo(cyl(r - 0.07, r - 0.07, y1 - y0, (y0 + y1) / 2), tone(MORTAR, R, 0.05));
      const nd = Math.max(2, Math.round((y1 - y0) / 1.5)), dh = (y1 - y0) / nd;
      for (let k = 0; k < nd; k++) {
        const rr = r * (1 - k * 0.012);
        B.geo(cyl(rr, rr, dh - 0.07, y0 + dh * (k + 0.5)), stoneTone(y0 + dh * k - Y, 0.12));
      }
      if (cap) {
        B.geo(cyl(r * 1.3, r * 0.98, 0.55, Y + h - 0.72), tone(TRIM, R, 0.05));
        B.boxMM(x - r * 1.35, x + r * 1.35, Y + h - 0.45, Y + h, z - r * 1.35, z + r * 1.35, tone(TRIM, R, 0.06));
      }
    };
    // --- tufos de musgo
    const moss = (B, x, y, z, s = 1, n = 4) => {
      for (let k = 0; k < n; k++) {
        const g = new THREE.IcosahedronGeometry((0.22 + R() * 0.25) * s, 0);
        g.scale(1, 0.38, 1);
        g.translate(x + (R() - 0.5) * 0.9 * s, y + 0.04, z + (R() - 0.5) * 0.9 * s);
        B.geo(g, tone(pick(MOSS), R, 0.12));
      }
    };
    // --- arandela na parede (n = normal para dentro do cômodo)
    const sconce = (B, x, y, z, nx, nz) => {
      const yaw = Math.atan2(nx, nz);
      const px = x + nx * 0.3, pz = z + nz * 0.3;
      B.box(px, y - 0.25, pz, 0.35, 0.5, 0.6, tone(0x3a3634, R, 0.05), yaw);
      const bx = x + nx * 0.62, bz = z + nz * 0.62;
      const bowl = new THREE.CylinderGeometry(0.3, 0.14, 0.32, 7); bowl.translate(bx, y + 0.1, bz); B.geo(bowl, tone(0x2e2a28, R, 0.05));
      const f1 = new THREE.ConeGeometry(0.22, 0.7, 6); f1.translate(bx, y + 0.6, bz); F.geo(f1, _toneC.setHex(0xff8a2a));
      const f2 = new THREE.ConeGeometry(0.12, 0.45, 5); f2.translate(bx, y + 0.5, bz); F.geo(f2, _toneC.setHex(0xffe07a));
      this._addTorch(bx, bz, { y: y + 0.45, indoor: true, model: false });
    };
    // --- raiz rastejando (lista de pontos)
    const root = (B, pts, r0 = 0.28, r1 = 0.06) => B.taper(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), r0, r1, tone(pick(ROOT), R, 0.1), 5);

    // =============================================================== salões
    // paredes externas e internas (layout no topo do arquivo)
    blockWall(S, -16, -3.5, -177, -175, Y + 12); this.addBoxCollider(-16, -3.5, -177, -175);
    blockWall(S, 3.5, 16, -177, -175, Y + 12); this.addBoxCollider(3.5, 16, -177, -175);
    blockWall(S, -3.5, 3.5, -177, -175, Y + 12, { bottom: Y + 8, plinth: false }); // verga da porta
    wall(-16, -14, -212, -208); wall(-16, -14, -202, -177);
    wall(14, 16, -212, -177);
    wall(-16, -4, -212, -210); wall(4, 16, -212, -210);
    wall(-20, -16, -210, -208); wall(-20, -16, -202, -200);
    wall(-22, -20, -218, -208); wall(-22, -20, -202, -192);
    wall(-44, -42, -218, -192);
    wall(-44, -20, -218, -216); wall(-44, -20, -194, -192);
    wall(-6, -4, -223.5, -212); wall(4, 6, -223.5, -212);
    // vergas sobre as passagens (fecham o vão até o teto)
    blockWall(S, -16, -14, -208, -202, Y + 9, { bottom: Y + 6.4, plinth: false });
    blockWall(S, -22, -20, -208, -202, Y + 9, { bottom: Y + 6.4, plinth: false });
    blockWall(S, -4, 4, -212, -210, Y + 9, { bottom: Y + 7.4, plinth: false });
    // pisos (sem sobreposição => sem z-fighting)
    floorRect(S, -14, 14, -212, -175);
    floorRect(S, -22, -14, -208, -202);
    floorRect(S, -42, -22, -216, -194);
    floorRect(S, -4, 4, -222.5, -212);
    // tetos (sem sobreposição) e telhados
    ceiling(S, -16.5, 16.5, -212.5, -174.5);
    S.boxMM(-12, 12, Y + 10.5, Y + 12, -208, -179, tone(CEIL, R, 0.05));
    ceiling(S, -19.5, -16.5, -210, -200);
    ceiling(S, -44.5, -19.5, -218.5, -191.5);
    ceiling(S, -6.5, 6.5, -223, -212.5);
    beamsZ(S, -210, -177, [-8, 8]);
    beamsX(S, -14, 14, [-180.5, -186, -191.5, -196.5, -201, -206]);
    beamsX(S, -42, -22, [-197.5, -202, -206.5, -211, -214.5]);
    beamsZ(S, -216, -194, [-32]);
    beamsX(S, -4, 4, [-217.5, -221]);
    beamsZ(S, -208, -202, [-18]);
    // colunas do salão
    for (const [x, z] of [[-8, -186], [8, -186], [-8, -201], [8, -201]]) {
      column(S, x, z, 8.05, 1.0);
      this.addCircleCollider(x, z, 1.15);
      moss(S, x + (R() - 0.5) * 1.6, Y, z + 1.2, 0.9, 3);
    }
    // fileira de runas guiando da porta ao portão
    for (let z = -181; z > -210; z -= 3.2) {
      G.boxMM(-0.4, 0.4, Y - 0.02, Y + 0.022, z - 0.05, z + 0.05, _toneC.setHex(0x23c47a));
      G.boxMM(-0.05, 0.05, Y - 0.02, Y + 0.022, z - 0.4, z + 0.4, _toneC.setHex(0x23c47a));
    }
    // fachada: frontão, colunas, batentes
    const ped = new THREE.Shape();
    ped.moveTo(-18, 0); ped.lineTo(18, 0); ped.lineTo(0, 6); ped.lineTo(-18, 0);
    const pg = new THREE.ExtrudeGeometry(ped, { depth: 3, bevelEnabled: false });
    pg.translate(0, Y + 12.3, -177.5); S.geo(pg, tone(0x6a645a, R, 0.02));
    S.boxMM(-18, 18, Y + 11.5, Y + 12.3, -177.6, -174.2, tone(TRIM, R, 0.03));
    for (const x of [-12, -7, 7, 12]) {
      column(S, x, -173.6, 11.5, 0.85);
      this.addCircleCollider(x, -173.6, 1.0);
    }
    S.boxMM(-4.4, -3.5, Y, Y + 8.6, -175.2, -174.3, tone(TRIM, R, 0.03));
    S.boxMM(3.5, 4.4, Y, Y + 8.6, -175.2, -174.3, tone(TRIM, R, 0.03));
    S.boxMM(-4.4, 4.4, Y + 8, Y + 8.8, -175.2, -174.3, tone(TRIM, R, 0.03));
    S.boxMM(-9, 9, Y - 0.3, Y + 0.05, -175, -165, tone(0x8a8476, R, 0.03)); // patamar
    for (let k = -3; k <= 3; k++) G.boxMM(k * 1.4 - 0.35, k * 1.4 + 0.35, Y + 9.6 + (k % 2 ? 0.3 : 0), Y + 10.6 + (k % 2 ? 0.3 : 0), -174.98, -174.85, _toneC.setHex(0x3aff9a));
    for (let k = 0; k < 5; k++) {
      const sx = (k - 2) * 7 + (R() - 0.5) * 2, pts = [];
      for (let i = 0; i <= 6; i++) pts.push([sx + Math.sin(i * 1.3 + k) * 1.5, Y + 15 - i * 2.6, -177.5 + 2.6 + (i === 6 ? 0.8 : 0.1) - (i < 1 ? 2 : 0)]);
      root(S, pts, 0.36 - k * 0.02, 0.12);
    }
    // raízes pelas paredes internas (rente à parede, descendo do teto ao chão)
    const wallRoot = (x, z, nx, nz, tx, tz, len) => {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, w = Math.sin(t * 5 + x) * 0.8;
        const off = 0.3 + (i === 6 ? 0.6 : 0);
        pts.push([x + tx * (t * len + w) + nx * off, Y + 8.8 - t * 8.7, z + tz * (t * len + w) + nz * off]);
      }
      root(S, pts, 0.26, 0.08);
      moss(S, pts[6][0], Y, pts[6][2], 0.9, 3);
    };
    wallRoot(-14, -184, 1, 0, 0, -1, 4); wallRoot(-14, -197, 1, 0, 0, 1, 3);
    wallRoot(14, -189, -1, 0, 0, -1, 5); wallRoot(14, -204, -1, 0, 0, 1, 3);
    wallRoot(-42, -205, 1, 0, 0, -1, 4); wallRoot(-30, -216, 0, 1, 1, 0, 4);
    wallRoot(-9, -210, 0, 1, -1, 0, 3);
    // musgo nos cantos e rodapés
    for (const [x, z] of [[-13.2, -178], [13.2, -178], [-13.2, -209.2], [13.2, -209.2], [-41.2, -195], [-41.2, -215.2], [-22.8, -215.2],
      [-13.3, -192], [13.3, -197], [-36, -215.3], [-3.3, -221], [3.3, -216]]) moss(S, x, Y, z, 1.1, 5);
    // cristais
    const crystal = (x, z, s) => {
      for (let i = 0; i < 3; i++) {
        const g = new THREE.OctahedronGeometry(0.35 * s, 0);
        g.scale(0.6, 2, 0.6);
        g.rotateZ((R() - 0.5) * 0.6);
        g.translate(x + (R() - 0.5) * 0.8, Y + 0.5 * s, z + (R() - 0.5) * 0.8);
        G.geo(g, tone(0x5affd0, R, 0.1));
      }
    };
    for (const [x, z] of [[-12.6, -195], [12.6, -192], [-40.6, -205], [-25, -215], [-20, -230.5], [20, -232], [-15, -261.5], [15, -260.5], [0, -266]]) crystal(x, z, 1 + R() * 0.5);
    // arandelas
    for (const z of [-181, -193.5, -209]) sconce(S, -14.16, Y + 3.6, z, 1, 0);
    for (const z of [-181, -193.5, -206]) sconce(S, 14.16, Y + 3.6, z, -1, 0);
    sconce(S, -42.16, Y + 3.6, -199, 1, 0); sconce(S, -42.16, Y + 3.6, -211, 1, 0);
    sconce(S, -32, Y + 3.6, -216.16, 0, 1); sconce(S, -27, Y + 3.6, -193.84, 0, -1);
    sconce(S, -4.16, Y + 3.6, -219, 1, 0); sconce(S, 4.16, Y + 3.6, -219, -1, 0);

    // ================================================================ arena
    const CX = ARENA.x, CZ = ARENA.z;
    const Ri = ARENA.r + 0.4, Ro = Ri + 2, AY1 = Y + 14, OPEN_Y = Y + 7.4;
    const th = Math.asin(4 / Ri); // meia-abertura do corredor (x = ±4)
    const TAU = Math.PI * 2;
    // núcleo / argamassa
    {
      const n = 60;
      for (let k = 0; k < n; k++) {
        const a0 = th + ((TAU - 2 * th) * k) / n, a1 = th + ((TAU - 2 * th) * (k + 1)) / n;
        A.sector(CX, CZ, Ri + 0.07, Ro - 0.07, a0, a1, Y - 2, OPEN_Y, tone(MORTAR, R, 0.04));
      }
      for (let k = 0; k < 64; k++) A.sector(CX, CZ, Ri + 0.07, Ro - 0.07, (k / 64) * TAU, ((k + 1) / 64) * TAU, OPEN_Y, AY1, tone(MORTAR, R, 0.04));
      // rodapé e cornija
      for (let k = 0; k < 56; k++) {
        const a0 = th + ((TAU - 2 * th) * k) / 56, a1 = th + ((TAU - 2 * th) * (k + 1)) / 56;
        A.sector(CX, CZ, Ri - 0.3, Ri + 0.2, a0, a1, Y - 0.2, Y + 0.8, tone(TRIM, R, 0.05, 0x5a5448, 0.25));
      }
      for (let k = 0; k < 64; k++) A.sector(CX, CZ, Ri - 0.4, Ro + 0.25, (k / 64) * TAU, ((k + 1) / 64) * TAU, AY1 - 0.6, AY1, tone(TRIM, R, 0.05));
    }
    // fiadas de blocos curvos
    const ringCourses = (yb, yt, nC, a0, a1) => {
      const ch = (yt - yb) / nC, g = 0.035;
      for (let c = 0; c < nC; c++) {
        const y0 = yb + c * ch, y1 = y0 + ch;
        const span = a1 - a0;
        let a = a0, first = ((c % 2 ? 1.2 : 2.4) + R() * 0.8) / Ri;
        while (a < a1 - 1e-4) {
          let da = first || (2.2 + R() * 1.1) / Ri;
          first = 0;
          if (a1 - (a + da) < 0.9 / Ri) da = a1 - a;
          const p0 = R() * 0.06, p1 = R() * 0.05;
          A.sector(CX, CZ, Ri - p0, Ro + p1, a + g / Ri, a + da - g / Ri, y0 + g, y1 - g, stoneTone(y0 - Y));
          a += da;
          if (span <= 0) break;
        }
      }
    };
    ringCourses(Y + 0.8, OPEN_Y, 6, th, TAU - th);
    { const s = R() * TAU; ringCourses(OPEN_Y, AY1 - 0.6, 5, s, s + TAU); }
    // pilastras (16, exceto sobre a abertura) e moldura da entrada
    const pil = (a, w, r0, r1, y0, y1, col) => A.sector(CX, CZ, r0, r1, a - w / 2 / Ri, a + w / 2 / Ri, y0, y1, col);
    for (let k = 1; k < 16; k++) {
      const a = (k / 16) * TAU;
      pil(a, 1.5, Ri - 0.5, Ri + 0.1, Y - 0.2, Y + 1.1, tone(TRIM, R, 0.05, 0x5a5448, 0.2));
      const nS = 3;
      for (let s = 0; s < nS; s++) {
        const y0 = Y + 1.1 + ((AY1 - 1.5 - Y - 1.1) * s) / nS, y1 = Y + 1.1 + ((AY1 - 1.5 - Y - 1.1) * (s + 1)) / nS;
        pil(a, 1.1, Ri - 0.42, Ri + 0.1, y0 + 0.03, y1 - 0.03, stoneTone(y0 - Y, 0.15));
      }
      pil(a, 1.6, Ri - 0.62, Ri + 0.1, AY1 - 1.5, AY1 - 0.6, tone(TRIM, R, 0.05));
    }
    for (const sg of [-1, 1]) {
      const a = sg * (th + 0.55 / Ri);
      pil(a, 1.1, Ri - 0.5, Ro - 0.2, Y - 0.2, OPEN_Y + 0.3, tone(TRIM, R, 0.05));
    }
    // lintel da entrada com runas
    A.sector(CX, CZ, Ri - 0.45, Ri + 0.4, -th - 0.02, th + 0.02, OPEN_Y - 0.05, OPEN_Y + 0.9, tone(TRIM, R, 0.04));
    for (let k = -3; k <= 3; k++) {
      const a = (k / 3.5) * th;
      G.sector(CX, CZ, Ri - 0.5, Ri - 0.44, a - 0.25 / Ri, a + 0.25 / Ri, OPEN_Y + 0.2 + (k % 2 ? 0.1 : 0), OPEN_Y + 0.65 + (k % 2 ? 0.1 : 0), _toneC.setHex(0x3aff9a));
    }
    // cúpula (casca de placas + nervuras), apoiada na cornija
    const RhI = Ri - 0.1, HvI = 10, RhO = Ro + 0.3, HvO = 11.2;
    const dp = (rh, hv, phi, a) => [CX + Math.sin(a) * Math.cos(phi) * rh, AY1 + Math.sin(phi) * hv, CZ + Math.cos(a) * Math.cos(phi) * rh];
    const PH = [0, 0.17, 0.34, 0.52, 0.71, 0.9, 1.1, 1.28, 1.44, Math.PI / 2];
    for (let j = 0; j < PH.length - 1; j++) {
      const p0 = PH[j], p1 = PH[j + 1];
      const n = Math.max(8, Math.round(44 * Math.cos((p0 + p1) / 2)));
      const off = R() * TAU;
      for (let k = 0; k < n; k++) {
        const a0 = off + (k / n) * TAU, a1 = off + ((k + 1) / n) * TAU;
        const col = tone(j < 2 ? 0x6a645a : 0x534d45, R, 0.13, 0x3a4a2a, R() < 0.12 ? 0.4 : 0);
        A.hexa([dp(RhI, HvI, p0, a0), dp(RhI, HvI, p0, a1), dp(RhI, HvI, p1, a1), dp(RhI, HvI, p1, a0),
          dp(RhO, HvO, p0, a0), dp(RhO, HvO, p0, a1), dp(RhO, HvO, p1, a1), dp(RhO, HvO, p1, a0)], col);
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      for (let j = 0; j < PH.length - 2; j++) {
        const p0 = PH[j], p1 = PH[j + 1];
        const w0 = Math.min(0.22, 0.5 / (RhI * Math.cos(p0))), w1 = Math.min(0.22, 0.5 / (RhI * Math.cos(p1)));
        const col = tone(0x7d7668, R, 0.06);
        A.hexa([dp(RhI - 0.4, HvI - 0.4, p0, a - w0), dp(RhI - 0.4, HvI - 0.4, p0, a + w0), dp(RhI - 0.4, HvI - 0.4, p1, a + w1), dp(RhI - 0.4, HvI - 0.4, p1, a - w1),
          dp(RhI + 0.05, HvI + 0.05, p0, a - w0), dp(RhI + 0.05, HvI + 0.05, p0, a + w0), dp(RhI + 0.05, HvI + 0.05, p1, a + w1), dp(RhI + 0.05, HvI + 0.05, p1, a - w1)], col);
      }
    }
    // coração de raiz no topo + semente brilhante pendurada
    {
      const knot = new THREE.IcosahedronGeometry(2.4, 1); knot.scale(1, 0.6, 1); knot.translate(CX, AY1 + HvI - 0.6, CZ);
      A.geo(knot, tone(ROOT[1], R, 0.05));
      const seed = new THREE.OctahedronGeometry(0.9, 0); seed.scale(1, 1.6, 1); seed.translate(CX, AY1 + HvI - 3.2, CZ);
      G.geo(seed, _toneC.setHex(0x7affc0));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4;
        root(A, [[CX + Math.sin(a) * 1.2, AY1 + HvI - 0.8, CZ + Math.cos(a) * 1.2], [CX + Math.sin(a) * 0.9, AY1 + HvI - 2.0, CZ + Math.cos(a) * 0.9], [CX + Math.sin(a) * 0.4, AY1 + HvI - 2.8, CZ + Math.cos(a) * 0.4]], 0.3, 0.1);
      }
    }
    // raízes descendo pela cúpula e pendendo no ar (sempre acima do teto da câmera, Y+11)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + (R() - 0.5) * 0.3;
      const pts = [];
      for (let j = 0; j <= 7; j++) {
        const phi = 1.45 - j * 0.19, aa = a + Math.sin(j * 1.1 + k) * 0.06;
        const q = dp(RhI - 0.45, HvI - 0.45, phi, aa);
        pts.push(q);
      }
      root(A, pts, 0.42, 0.18);
      if (k % 2 === 0) {
        // raiz que pende do domo
        const phi = 0.7 + R() * 0.4, aa = a + 0.12;
        const q = dp(RhI - 0.5, HvI - 0.5, phi, aa);
        const tipY = Y + 15.5 + R() * 2.5;
        root(A, [q, [q[0] * 0.98 + CX * 0.02, (q[1] + tipY) / 2 + 0.6, q[2] * 0.98 + CZ * 0.02], [q[0] * 0.95 + CX * 0.05, tipY, q[2] * 0.95 + CZ * 0.05]], 0.28, 0.04);
      }
    }
    // raízes descendo pelas paredes até o chão (entre as pilastras)
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU + 0.12;
      if (Math.cos(a) > 0.9) continue;
      const pts = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6, aa = a + Math.sin(t * 4 + k) * 0.035;
        const rr = Ri - 0.25 - (j === 6 ? 0.9 : 0);
        pts.push([CX + Math.sin(aa) * rr, AY1 - 0.4 - t * (AY1 - Y - 0.55), CZ + Math.cos(aa) * rr]);
      }
      root(A, pts, 0.34, 0.1);
      moss(A, pts[6][0], Y, pts[6][2], 1.1, 5);
    }
    // anel de pilares, arquitrave e vigas radiais (acima da câmera)
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU;
      const x = CX + Math.sin(a) * 18, z = CZ + Math.cos(a) * 18;
      column(A, x, z, 13.2, 1.2);
      this.addCircleCollider(x, z, 1.4);
      moss(A, x + Math.sin(a) * 1.2, Y + 0.6, z + Math.cos(a) * 1.2, 1, 4);
      A.box(CX + Math.sin(a) * 20.4, AY1 - 0.35, CZ + Math.cos(a) * 20.4, 1.0, 0.7, 4.6, tone(TRIM, R, 0.05), a);
    }
    for (let k = 0; k < 48; k++) A.sector(CX, CZ, 17.25, 18.75, (k / 48) * TAU, ((k + 1) / 48) * TAU, Y + 13.2, Y + 14.0, tone(TRIM, R, 0.06));
    // piso radial: laje central, anéis de lajes, argamassa embaixo
    for (let k = 0; k < 64; k++) A.sector(CX, CZ, 0, Ri + 0.1, (k / 64) * TAU, ((k + 1) / 64) * TAU, Y - 0.35, Y - 0.05, tone(MORTAR, R, 0.04));
    {
      const rings = [0, 3.0, 5.4, 7.8, 10.2, 12.6, 15.0, 17.4, 19.8, Ri];
      for (let i = 0; i < rings.length - 1; i++) {
        const r0 = rings[i], r1 = rings[i + 1], rm = (r0 + r1) / 2;
        const n = i === 0 ? 6 : Math.max(8, Math.round((TAU * rm) / 2.3));
        const off = R() * TAU, g = 0.05;
        for (let k = 0; k < n; k++) {
          const a0 = off + (k / n) * TAU, a1 = off + ((k + 1) / n) * TAU;
          A.sector(CX, CZ, r0 > 0 ? r0 + g : 0, r1 - g, a0 + g / Math.max(rm, 1), a1 - g / Math.max(rm, 1), Y - 0.25, Y, tone(pick(FLOOR), R, 0.08));
        }
      }
    }
    // padrão brilhante no chão: anel de runas, estrela central, raízes radiais
    {
      const GL = 0x1a9c5e, y0 = Y - 0.02, y1 = Y + 0.025;
      for (let k = 0; k < 72; k++) {
        const a0 = (k / 72) * TAU, a1 = ((k + 1) / 72) * TAU;
        G.sector(CX, CZ, 9.34, 9.44, a0, a1, y0, y1, _toneC.setHex(GL));
        G.sector(CX, CZ, 10.96, 11.06, a0, a1, y0, y1, _toneC.setHex(GL));
      }
      for (let k = 0; k < 32; k++) {
        const a0 = (k / 32) * TAU, a1 = ((k + 1) / 32) * TAU;
        G.sector(CX, CZ, 2.6, 2.75, a0, a1, y0, y1, _toneC.setHex(GL));
      }
      // glifos entre os anéis
      for (let k = 0; k < 24; k++) {
        const a = ((k + 0.5) / 24) * TAU, rm = 10.2, ca = Math.sin(a), sa = Math.cos(a);
        const gx = CX + ca * rm, gz = CZ + sa * rm;
        const t = k % 4;
        G.box(gx, (y0 + y1) / 2, gz, 0.12, y1 - y0, 0.9, _toneC.setHex(GL), a + Math.PI / 2);
        if (t === 0 || t === 2) G.box(gx + ca * 0.25, (y0 + y1) / 2, gz + sa * 0.25, 0.12, y1 - y0, 0.55, _toneC.setHex(GL), a);
        if (t === 1) G.box(gx - ca * 0.3, (y0 + y1) / 2, gz - sa * 0.3, 0.5, y1 - y0, 0.12, _toneC.setHex(GL), a + Math.PI / 4);
        if (t === 3) { G.box(gx + ca * 0.3, (y0 + y1) / 2, gz + sa * 0.3, 0.12, y1 - y0, 0.4, _toneC.setHex(GL), a + 0.8); G.box(gx - ca * 0.3, (y0 + y1) / 2, gz - sa * 0.3, 0.12, y1 - y0, 0.4, _toneC.setHex(GL), a - 0.8); }
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        G.box(CX + Math.sin(a) * 1.3, (y0 + y1) / 2, CZ + Math.cos(a) * 1.3, 0.14, y1 - y0, 2.4, _toneC.setHex(GL), a);
      }
      // raízes brilhantes: do anel central até a base de cada pilar
      const seg = (x0, z0, x1, z1, w) => {
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
        G.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, w, y1 - y0, l + w * 0.6, _toneC.setHex(GL), Math.atan2(dx, dz));
      };
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * TAU;
        let px = CX + Math.sin(a) * 2.8, pz = CZ + Math.cos(a) * 2.8;
        for (let j = 1; j <= 8; j++) {
          const r = 2.8 + j * 1.75, aa = a + Math.sin(j * 1.7 + k * 2.3) * 0.06;
          const nx = CX + Math.sin(aa) * r, nz = CZ + Math.cos(aa) * r;
          seg(px, pz, nx, nz, 0.13 - j * 0.008);
          if (j === 3 || j === 6) {
            const ba = aa + (j === 3 ? 0.22 : -0.2), br = r + 1.6;
            seg(nx, nz, CX + Math.sin(ba) * br, CZ + Math.cos(ba) * br, 0.08);
          }
          px = nx; pz = nz;
        }
      }
    }
    // arandelas nas pilastras + braseiros
    for (let k = 2; k < 16; k += 2) {
      const a = (k / 16) * TAU, rr = Ri - 0.42;
      sconce(A, CX + Math.sin(a) * rr, Y + 4.4, CZ + Math.cos(a) * rr, -Math.sin(a), -Math.cos(a));
    }
    for (const a of [0.56, -0.56, Math.PI - 0.56, Math.PI + 0.56]) {
      const x = CX + Math.sin(a) * 20.2, z = CZ + Math.cos(a) * 20.2;
      const ped2 = new THREE.CylinderGeometry(0.42, 0.6, 1.0, 8); ped2.translate(x, Y + 0.5, z); A.geo(ped2, tone(TRIM, R, 0.05));
      const bowl = new THREE.CylinderGeometry(0.75, 0.4, 0.45, 8); bowl.translate(x, Y + 1.2, z); A.geo(bowl, tone(0x2e2a28, R, 0.05));
      const coal = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 8); coal.translate(x, Y + 1.4, z); F.geo(coal, _toneC.setHex(0xc8401a));
      const f1 = new THREE.ConeGeometry(0.5, 1.3, 6); f1.translate(x, Y + 2.05, z); F.geo(f1, _toneC.setHex(0xff8a2a));
      const f2 = new THREE.ConeGeometry(0.28, 0.9, 5); f2.translate(x, Y + 1.85, z); F.geo(f2, _toneC.setHex(0xffe07a));
      this.addCircleCollider(x, z, 0.75);
      this._addTorch(x, z, { y: Y + 1.7, indoor: true, model: false });
    }
    // entulho e musgo junto à parede
    for (const a of [1.2, 2.3, 3.6, 4.4, 5.3]) {
      const x = CX + Math.sin(a) * 20.6, z = CZ + Math.cos(a) * 20.6;
      for (let i = 0; i < 4; i++) {
        const g = new THREE.DodecahedronGeometry(0.3 + R() * 0.35, 0);
        g.translate(x + (R() - 0.5) * 1.4, Y + 0.2, z + (R() - 0.5) * 1.4);
        A.geo(g, stoneTone(0, 0.2));
      }
      this.addCircleCollider(x, z, 0.8);
      moss(A, x, Y, z, 1.2, 3);
    }
    for (let k = 0; k < 10; k++) {
      const a = R() * TAU, d = 12 + R() * 8;
      if (Math.cos(a) > 0.95) continue;
      moss(A, CX + Math.sin(a) * d, Y, CZ + Math.cos(a) * d, 0.8, 3);
    }

    // ============================================================ meshes
    const stoneMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this._runeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this._flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const add = (B, mat, cast, receive, name) => {
      if (B.empty) return null;
      const m = new THREE.Mesh(B.build(), mat);
      m.castShadow = cast; m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      m.name = name;
      this.scene.add(m);
      return m;
    };
    add(S, stoneMat, true, true, 'temple_halls');
    add(A, stoneMat, true, true, 'temple_arena');
    add(G, this._runeMat, false, false, 'temple_runes');
    add(F, this._flameMat, false, false, 'temple_flames');

    // porta externa
    try {
      const raw = this._model('createDoor', FB.door, 7, 8);
      const door = this._normalize(raw, { base: true, fitW: 7, fitH: 8 });
      door.position.set(0, Y, -176);
      door.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(door);
      this._doorObj = door;
    } catch (e) { console.warn('[world] porta', e); }
    this._doorCol = this.addBoxCollider(-3.6, 3.6, -177, -174.6);
    // portão do chefe
    try {
      const raw = this._model('createGate', FB.gate, 8, 7);
      const gate = this._normalize(raw, { base: true, fitW: 8, fitH: 7 });
      gate.position.set(0, Y, -215);
      gate.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(gate);
      this._gateObj = gate;
    } catch (e) { console.warn('[world] portão', e); }
    this._gateCol = this.addBoxCollider(-4.2, 4.2, -215.6, -214.4);

    // tochas externas
    this._addTorch(-5.5, -171.5); this._addTorch(5.5, -171.5);
    // vasos
    for (const [x, z] of [[-11.5, -179.2], [11.5, -179.2], [-11.5, -208.5], [11.5, -208.5], [-38, -214.5], [-24.5, -194.8], [-26, -214.5]]) this._pot(x, z, Y);
    // escombros no salão
    for (const [x, z, s] of [[-12, -190, 0.7], [11.5, -197, 0.9], [-33, -195.5, 0.6]]) {
      const r = this._model('createRock', FB.rock, s);
      this._place(r, x, z, { y: Y, yaw: R() * 6, cast: false });
    }
  }

  _updateTemple() {
    if (!this._runeMat) return;
    const t = this._time;
    this._runeMat.color.setScalar(0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6)));
    this._flameMat.color.setScalar(0.88 + 0.08 * Math.sin(t * 13) + 0.04 * Math.sin(t * 29));
  }

  // ---------------------------------------------------------------- spawns
  _buildSpawns() {
    const V = (x, z, y = null) => new THREE.Vector3(x, y ?? this.getHeight(x, z), z);
    const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
    this.spawns.player = V(0, 12);
    this.spawns.npcs = [
      { kind: 'elder', id: 'orvo', name: 'Orvo', position: V(6, -5), yaw: face(6, -5, 0, 12) },
      { kind: 'child', id: 'tila', name: 'Tila', position: V(-9, 7), yaw: face(-9, 7, 0, 0) },
      { kind: 'merchant', id: 'brom', name: 'Brom', position: V(17.6, 4), yaw: -Math.PI / 2 },
      { kind: 'girl', id: 'mira', name: 'Mira', position: V(CLEARING.x, CLEARING.z), yaw: face(CLEARING.x, CLEARING.z, -128, -118) },
    ];
    const E = [];
    const add = (type, x, z, opts = {}) => {
      const y = opts.y ?? this.getHeight(x, z);
      const e = { type, position: new THREE.Vector3(x, y, z) };
      if (opts.night) e.night = true;
      if (opts.tag) e.tag = opts.tag;
      E.push(e);
    };
    // campos
    for (const [x, z] of [[40, 52], [-55, 38], [58, -55], [-28, -72], [72, 30], [24, -100], [-74, 12], [100, 62], [-22, 82], [130, -95]]) add('slime', x, z);
    for (const [x, z] of [[62, 72], [-62, -58], [34, -130], [92, -88], [-95, 70]]) add('goblin', x, z);
    for (const [x, z] of [[36, 64], [-52, 62], [76, -62], [-26, -98], [110, 42], [-110, 30], [60, 110]]) add('skeleton', x, z, { night: true });
    // clareira da Mira (guardas)
    add('goblin', CLEARING.x + 9, CLEARING.z + 7, { tag: 'mira' });
    add('goblin', CLEARING.x - 10, CLEARING.z + 8, { tag: 'mira' });
    add('goblin', CLEARING.x - 6, CLEARING.z - 11, { tag: 'mira' });
    add('plant', CLEARING.x + 11, CLEARING.z - 6, { tag: 'mira' });
    add('plant', CLEARING.x - 12, CLEARING.z - 3, { tag: 'mira' });
    // bosque
    for (const [x, z] of [[-100, -80], [-165, -80], [-110, -150], [-175, -125]]) add('bat', x, z);
    for (const [x, z] of [[-92, -128], [-168, -150]]) add('plant', x, z);
    // templo
    add('slime', -6, -190, { y: FLOOR_Y });
    add('slime', 7, -198, { y: FLOOR_Y });
    add('skeleton', 0, -204, { y: FLOOR_Y });
    add('skeleton', -34, -210, { y: FLOOR_Y });
    this.spawns.enemies = E;
    this.spawns.chests = [
      { id: 'chest_village', position: V(-12, 35), yaw: Math.PI, contents: 'gem_red' },
      { id: 'chest_forest', position: V(-178, -96), yaw: Math.PI / 2, contents: 'gem_red' },
      { id: 'chest_key', position: new THREE.Vector3(-30, FLOOR_Y, -205), yaw: Math.PI / 2, contents: 'key' },
    ];
    this.spawns.boss = new THREE.Vector3(ARENA.x, FLOOR_Y, ARENA.z);
  }
}

export default World;
