// Ecos de Valdora — modelos procedurais low-poly (estilo N64), feitos só com primitivas do Three.js.
// Convenções: Y para cima, 1 unidade = 1 m, modelos olham para +Z, pés em y = 0.
// Personagens: pose de repouso = todas as rotações dos `pivots` em zero (seguro zerar tudo).
import * as THREE from 'three';

const PI = Math.PI;
const TAU = Math.PI * 2;
const DS = THREE.DoubleSide;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function makeMaterial(color, o = {}) {
  if (o.basic) {
    const translucent = o.opacity !== undefined || !!o.additive;
    return new THREE.MeshBasicMaterial({
      color,
      transparent: translucent,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: !translucent,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }
  const p = { color, flatShading: o.flat !== false, side: o.side ?? THREE.FrontSide };
  if (o.emissive !== undefined) {
    p.emissive = new THREE.Color(o.emissive);
    p.emissiveIntensity = o.ei ?? 1;
  }
  if (o.opacity !== undefined) {
    p.transparent = true;
    p.opacity = o.opacity;
    p.depthWrite = false;
  }
  return new THREE.MeshLambertMaterial(p);
}

// Cache global de materiais (para NPCs e cenário — nunca piscam).
const _matCache = new Map();
function M(color, o = {}) {
  const key = color + '|' + JSON.stringify(o);
  let m = _matCache.get(key);
  if (!m) {
    m = makeMaterial(color, o);
    _matCache.set(key, m);
  }
  return m;
}

// Fábrica de materiais por instância (inimigos/chefe): todos Lambert (têm .emissive)
// e ficam listados em `.list` para o efeito de flash.
function ownFactory() {
  const cache = new Map();
  const list = [];
  const f = (color, o = {}) => {
    const o2 = { ...o };
    delete o2.basic;
    delete o2.additive;
    const key = color + '|' + JSON.stringify(o2);
    let m = cache.get(key);
    if (!m) {
      m = makeMaterial(color, o2);
      cache.set(key, m);
      list.push(m);
    }
    return m;
  };
  f.list = list;
  return f;
}

const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, s = 8, open = false, ts = 0, tl = TAU) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open, ts, tl),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  sph: (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dod: (r, d = 0) => new THREE.DodecahedronGeometry(r, d),
  oct: (r) => new THREE.OctahedronGeometry(r, 0),
  tor: (r, t, rs = 6, ts = 10, arc = TAU) => new THREE.TorusGeometry(r, t, rs, ts, arc),
};

function add(parent, geo, mat, p, r, s, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (s !== undefined && s !== null) {
    if (typeof s === 'number') m.scale.setScalar(s);
    else m.scale.set(s[0], s[1], s[2]);
  }
  m.castShadow = cast;
  m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}

function grp(parent, x = 0, y = 0, z = 0, name) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (name) g.name = name;
  if (parent) parent.add(g);
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
function orient(obj, x, y, z) {
  obj.quaternion.setFromUnitVectors(_up, new THREE.Vector3(x, y, z).normalize());
  return obj;
}

// Deforma vértices coincidentes de forma consistente (pedras, blobs).
function jitter(geo, amt) {
  if (geo.index) geo = geo.toNonIndexed();
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    let o = map.get(k);
    if (!o) {
      o = [rnd(-amt, amt), rnd(-amt, amt), rnd(-amt, amt)];
      map.set(k, o);
    }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

// Funde todas as malhas de um grupo estático em uma malha por material.
function mergeGroup(src) {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const buckets = new Map();
  const mtx = new THREE.Matrix4();
  src.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    mtx.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(mtx);
    if (!g.attributes.normal) g.computeVertexNormals();
    let b = buckets.get(o.material);
    if (!b) buckets.set(o.material, (b = []));
    b.push(g);
  });
  const out = [];
  for (const [mat, geos] of buckets) {
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    let off = 0;
    for (const g of geos) {
      const pa = g.attributes.position, na = g.attributes.normal;
      for (let i = 0; i < pa.count; i++) {
        pos[off + i * 3] = pa.getX(i); pos[off + i * 3 + 1] = pa.getY(i); pos[off + i * 3 + 2] = pa.getZ(i);
        nor[off + i * 3] = na.getX(i); nor[off + i * 3 + 1] = na.getY(i); nor[off + i * 3 + 2] = na.getZ(i);
      }
      off += pa.count * 3;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    out.push({ geometry: geo, material: mat });
  }
  return out;
}

function instFromParts(parts, cast = true, receive = true, target = null) {
  const g = target || new THREE.Group();
  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    g.add(mesh);
  }
  return g;
}

function bake(raw, cast = true, receive = true, target = null) {
  return instFromParts(mergeGroup(raw), cast, receive, target);
}

// Reduz draw calls de personagens: dentro de cada nó (pivô) funde as malhas-folha filhas diretas
// que usam o MESMO material (mesmo objeto) e mesmas flags de sombra. Como todas são filhas do mesmo
// pai, movem-se juntas — pivôs/animações continuam valendo. Objetos referenciados no resultado
// (pivots, sword, core, lid...) nunca são fundidos nem removidos; materiais são preservados
// (flash de dano continua funcionando).
function mergeRig(res) {
  if (!res || !res.root) return res;
  const keep = new Set();
  const mark = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 2) return;
    if (v.isObject3D) { keep.add(v); return; }
    if (v.isMaterial || v.isBufferGeometry) return;
    for (const k of Object.keys(v)) mark(v[k], depth + 1);
  };
  for (const k of Object.keys(res)) if (k !== 'root') mark(res[k], 0);
  const mergeable = (o) => o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !keep.has(o) && o.visible
    && o.children.length === 0 && o.material && !Array.isArray(o.material) && !o.material.map && !o.material.vertexColors
    && !o.morphTargetInfluences && o.geometry?.attributes?.position && !o.onBeforeRender?.__custom;
  const nodes = [];
  res.root.traverse((o) => { if (o.children.length > 1) nodes.push(o); });
  for (const node of nodes) {
    const buckets = new Map();
    for (const c of node.children) {
      if (!mergeable(c)) continue;
      // detalhes minúsculos (botões, olhos...) não precisam projetar sombra: poupa o passe de sombra
      if (c.castShadow) {
        if (!c.geometry.boundingSphere) c.geometry.computeBoundingSphere();
        const r = (c.geometry.boundingSphere?.radius || 1) * Math.max(c.scale.x, c.scale.y, c.scale.z);
        if (r < 0.06) c.castShadow = false;
      }
      const key = c.material.uuid + '|' + (c.castShadow ? 1 : 0) + (c.receiveShadow ? 1 : 0) + '|' + c.renderOrder + '|' + (c.frustumCulled ? 1 : 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      let n = 0;
      const geos = [];
      for (const c of list) {
        c.updateMatrix();
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        g.applyMatrix4(c.matrix);
        if (!g.attributes.normal) g.computeVertexNormals();
        geos.push(g);
        n += g.attributes.position.count;
      }
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let off = 0;
      for (const g of geos) {
        const pa = g.attributes.position, na = g.attributes.normal;
        for (let i = 0; i < pa.count; i++) { pos[off + i * 3] = pa.getX(i); pos[off + i * 3 + 1] = pa.getY(i); pos[off + i * 3 + 2] = pa.getZ(i); }
        for (let i = 0; i < na.count; i++) { nor[off + i * 3] = na.getX(i); nor[off + i * 3 + 1] = na.getY(i); nor[off + i * 3 + 2] = na.getZ(i); }
        off += g.attributes.position.count * 3;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const first = list[0];
      const mesh = new THREE.Mesh(geo, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder; mesh.frustumCulled = first.frustumCulled;
      mesh.name = first.name ? first.name + '+' : 'merged';
      for (const c of list) node.remove(c);
      node.add(mesh);
    }
  }
  return res;
}

// Variações cacheadas de props estáticos (geometria compartilhada, só leitura).
const _variants = new Map();
function variant(key, max, build) {
  let arr = _variants.get(key);
  if (!arr) _variants.set(key, (arr = []));
  if (arr.length < max) {
    const parts = mergeGroup(build(arr.length));
    arr.push(parts);
    return parts;
  }
  return arr[(Math.random() * arr.length) | 0];
}

// ---------------------------------------------------------------------------
// Esqueleto humanoide genérico
// ---------------------------------------------------------------------------
// c: {legLen, thigh, hipW, waist, torsoLen, neck, shoulderW, shoulderY, uaLen, faLen, lean, splay, armFwd:{L,R}, elbow:{L,R}}
function rig(c) {
  const root = new THREE.Group();
  const P = {};
  P.hips = grp(root, 0, c.legLen, 0, 'hips');
  P.torso = grp(P.hips, 0, c.waist, 0, 'torso');
  const chest = grp(P.torso, 0, 0, 0, 'chest');
  chest.rotation.x = c.lean || 0;
  P.head = grp(chest, 0, c.torsoLen, 0, 'head');
  const headInner = grp(P.head);
  headInner.rotation.x = -(c.lean || 0) * 0.85;
  const armIn = {}, foreIn = {};
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const arm = grp(chest, sg * c.shoulderW, c.shoulderY, 0, 'arm' + s);
    const ai = grp(arm);
    ai.rotation.set(-(c.lean || 0) * 0.9 - (c.armFwd?.[s] ?? 0), 0, sg * (c.splay ?? 0.08));
    const fore = grp(ai, 0, -c.uaLen, 0, 'foreArm' + s);
    const fi = grp(fore);
    fi.rotation.x = -(c.elbow?.[s] ?? 0);
    const hand = grp(fi, 0, -c.faLen, 0, 'hand' + s);
    const leg = grp(P.hips, sg * c.hipW, 0, 0, 'leg' + s);
    const shin = grp(leg, 0, -c.thigh, 0, 'shin' + s);
    P['arm' + s] = arm; P['foreArm' + s] = fore; P['hand' + s] = hand;
    P['leg' + s] = leg; P['shin' + s] = shin;
    armIn[s] = ai; foreIn[s] = fi;
  }
  return { root, P, chest, headInner, armIn, foreIn };
}

function headCenter(c) {
  return c.neck + c.headR * c.headSY;
}

function addFace(h, c, m) {
  const r = c.headR, sy = c.headSY, sz = c.headSZ ?? 1, hc = headCenter(c);
  const zs = (dx, dy) => Math.sqrt(Math.max(0, r * r - dx * dx - (dy / sy) ** 2)) * sz * 0.93;
  const col = c.col;
  const ex = r * 0.38, ey = r * (c.eyeY ?? 0.05);
  for (const sg of [1, -1]) {
    const z = zs(ex, ey);
    if (c.eyeStyle === 'line') {
      add(h, G.box(r * 0.3, r * 0.07, 0.02), m(0x2a1a14), [sg * ex, hc + ey, z], [0, sg * 0.35, 0], null, false);
    } else {
      add(h, G.box(r * 0.3, r * 0.36, 0.02), m(col.sclera ?? 0xffffff, col.scleraEm ? { emissive: col.scleraEm, ei: 0.8 } : {}), [sg * ex, hc + ey, z], [0, sg * 0.35, 0], null, false);
      add(h, G.box(r * 0.16, r * 0.24, 0.02), m(col.eye ?? 0x2a2a2a), [sg * (ex - r * 0.03), hc + ey - r * 0.03, z + 0.008], [0, sg * 0.35, 0], null, false);
    }
    if (col.brow !== undefined) {
      add(h, G.box(r * 0.4, r * (c.browH ?? 0.08), 0.03), m(col.brow), [sg * ex, hc + ey + r * 0.3, zs(ex, ey + r * 0.3) + 0.006], [0, sg * 0.35, sg * (c.browTilt ?? 0.12)], null, false);
    }
    if (!c.noEars) add(h, G.sph(r * 0.22, 6, 5), m(col.skin), [sg * r * 0.97, hc, -r * 0.05], null, [0.45, 1, 0.75]);
  }
  const nose = c.noseSize ?? 1;
  add(h, G.cone(r * 0.11 * nose, r * 0.32 * nose, 4), m(col.skin), [0, hc - r * 0.12, zs(0, -r * 0.12) + r * 0.08 * nose], [PI / 2, 0, 0], null, false);
  if (!c.noMouth) add(h, G.box(r * 0.32, r * 0.05, 0.02), m(col.mouth ?? 0x9a3b3b), [0, hc - r * 0.45, zs(0, -r * 0.45)], null, null, false);
}

// Roupas/corpo padrão sobre o rig.
function dress(r, c, m) {
  const { P, chest, headInner } = r;
  const col = c.col;
  // pelve
  add(P.hips, G.cyl(c.hipR, c.hipR * 0.9, 0.17, 8), m(col.pants), [0, 0, 0], null, [1, 1, c.depth]);
  // tronco
  add(chest, G.cyl(c.chestR, c.waistR, c.torsoLen, 8), m(col.shirt), [0, c.torsoLen / 2, 0], null, [1, 1, c.depth]);
  // pescoço e cabeça
  const nr = c.neckR ?? c.headR * 0.38;
  add(headInner, G.cyl(nr, nr * 1.1, c.neck + 0.05, 6), m(col.skin), [0, c.neck / 2, 0]);
  const hc = headCenter(c);
  add(headInner, G.sph(c.headR, 8, 7), m(col.skin), [0, hc, 0], null, [1, c.headSY, c.headSZ ?? 1]);
  if (!c.noFace) addFace(headInner, c, m);
  // braços
  for (const s of ['L', 'R']) {
    const ai = r.armIn[s];
    const fi = r.foreIn[s];
    add(ai, G.sph(c.armR * 1.25, 7, 5), m(col.sleeve), [0, 0, 0]);
    add(ai, G.cyl(c.armR, c.armR * 0.88, c.uaLen, 7), m(col.sleeve), [0, -c.uaLen / 2, 0]);
    add(fi, G.sph(c.armR * 0.9, 6, 4), m(col.fore), [0, 0, 0]);
    add(fi, G.cyl(c.armR * 0.88, c.armR * 0.72, c.faLen, 7), m(col.fore), [0, -c.faLen / 2, 0]);
    if (col.bracer !== undefined) add(fi, G.cyl(c.armR * 0.98, c.armR * 0.86, c.faLen * 0.45, 7), m(col.bracer), [0, -c.faLen * 0.68, 0]);
    add(P['hand' + s], G.box(c.armR * 1.35, c.armR * 1.7, c.armR * 1.45), m(col.hand ?? col.skin), [0, -c.armR * 0.75, 0.005]);
    // pernas
    const leg = P['leg' + s], shin = P['shin' + s];
    add(leg, G.cyl(c.legR, c.legR * 0.88, c.thigh, 7), m(col.pants), [0, -c.thigh / 2, 0]);
    add(shin, G.sph(c.legR * 0.88, 6, 4), m(col.pants), [0, 0, 0]);
    const shinLen = c.legLen - c.thigh;
    add(shin, G.cyl(c.legR * 0.86, c.legR * 0.7, shinLen, 7), m(col.pants), [0, -shinLen / 2, 0]);
    const bh = c.bootH;
    add(shin, G.cyl(c.legR * 0.9, c.legR * 0.95, bh, 7), m(col.boot), [0, -shinLen + bh / 2, 0]);
    if (col.cuff !== undefined) add(shin, G.cyl(c.legR * 1.1, c.legR * 1.02, 0.05, 7), m(col.cuff), [0, -shinLen + bh, 0]);
    add(shin, G.box(c.legR * 1.6, 0.075, c.legR * 2.9), m(col.boot), [0, -shinLen + 0.0375, c.legR * 0.75]);
  }
  if (c.skirt) {
    const sk = c.skirt;
    const top = sk.top ?? 0.07;
    add(P.hips, G.cyl(sk.r0, sk.r1, sk.len, sk.seg ?? 8, true), m(sk.color, { side: DS }), [0, top - sk.len / 2, 0], null, [1, 1, sk.depth ?? c.depth * 1.1]);
    if (sk.hem !== undefined) add(P.hips, G.cyl(sk.r1 * 1.02, sk.r1 * 1.04, 0.04, sk.seg ?? 8, true), m(sk.hem, { side: DS }), [0, top - sk.len + 0.02, 0], null, [1, 1, sk.depth ?? c.depth * 1.1]);
  }
  return { hc };
}

function hairCap(h, c, m, color, { front = 0.38, back = 0.75, scale = 1.08 } = {}) {
  const r = c.headR * scale, hc = headCenter(c), s = [1, c.headSY, c.headSZ ?? 1];
  add(h, new THREE.SphereGeometry(r, 9, 6, 0, TAU, 0, PI * front), m(color), [0, hc + c.headR * 0.02, -c.headR * 0.02], null, s);
  add(h, new THREE.SphereGeometry(r * 0.99, 9, 6, PI, PI, 0, PI * back), m(color), [0, hc + c.headR * 0.02, -c.headR * 0.03], null, s);
}

// Cone de cabelo / mecha apontando numa direção.
function tuft(parent, m, color, pos, dir, r, len) {
  const t = add(parent, G.cone(r, len, 4), m(color), pos);
  orient(t, dir[0], dir[1], dir[2]);
  // desloca para que a base fique na posição dada
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(len / 2);
  t.position.add(d);
  return t;
}

// ---------------------------------------------------------------------------
// HERÓI — Kael
// ---------------------------------------------------------------------------
export function createHero() {
  const m = M;
  const C = {
    skin: 0xf1c09a, hair: 0x7b3f1e, hairLight: 0x95522a, tunic: 0x1c8ea3, tunicDark: 0x146a7c,
    pants: 0xdccba4, boot: 0x5c3a1f, cuff: 0x86582f, leather: 0x6a4222, bronze: 0xc98f3a,
    scarf: 0xf2a51e, scarfDark: 0xd47a12, eye: 0x2f5a3e, steel: 0xdbe3ec, steelDark: 0x9aa6b4,
    grip: 0x4a2d18, wood: 0xa86b35, woodDark: 0x7d4c22, iron: 0x6c6f7a, sun: 0xf6c843, sunRed: 0xe0582a,
    clay: 0xc4683a,
  };
  const d = {
    legLen: 0.82, thigh: 0.4, hipW: 0.09, waist: 0.05, torsoLen: 0.46, neck: 0.05,
    shoulderW: 0.215, shoulderY: 0.4, uaLen: 0.27, faLen: 0.25, splay: 0.1,
  };
  const r = rig(d);
  const c = {
    ...d, chestR: 0.17, waistR: 0.145, hipR: 0.15, depth: 0.72, armR: 0.056, legR: 0.07,
    headR: 0.135, headSY: 1.08, bootH: 0.25, eyeY: 0.02,
    col: { skin: C.skin, shirt: C.tunic, sleeve: C.tunic, fore: C.skin, pants: C.pants, boot: C.boot,
      cuff: C.cuff, bracer: C.leather, eye: C.eye, brow: C.hair },
    skirt: { color: C.tunic, r0: 0.158, r1: 0.228, len: 0.28, hem: C.tunicDark },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  r.root.name = 'Kael';

  // cinto, fivela, bolsinha
  add(P.hips, G.cyl(0.163, 0.163, 0.065, 8), m(C.leather), [0, 0.065, 0], null, [1, 1, 0.8]);
  add(P.hips, G.box(0.075, 0.065, 0.03), m(C.bronze), [0, 0.065, 0.135]);
  add(P.hips, G.box(0.04, 0.03, 0.035), m(C.leather), [0, 0.065, 0.14]);
  add(P.hips, G.box(0.085, 0.095, 0.055), m(C.leather), [0.135, 0.02, -0.05], [0, 0.6, 0]);
  add(P.hips, G.box(0.09, 0.03, 0.06), m(C.cuff), [0.135, 0.07, -0.05], [0, 0.6, 0]);
  // detalhes do peito: faixa e cordão
  add(chest, G.box(0.035, 0.26, 0.012), m(C.tunicDark), [0, 0.2, 0.118]);
  for (let i = 0; i < 3; i++) add(chest, G.box(0.06, 0.012, 0.012), m(C.pants), [0, 0.28 - i * 0.06, 0.124], [0, 0, i % 2 ? 0.5 : -0.5], null, false);
  // barras das mangas
  for (const s of ['L', 'R']) add(r.armIn[s], G.cyl(0.054, 0.054, 0.03, 7), m(C.tunicDark), [0, -d.uaLen + 0.02, 0]);

  // cabelo castanho bagunçado
  hairCap(headInner, c, m, C.hair, { front: 0.38, back: 0.78 });
  const hr = c.headR;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rnd(-0.2, 0.2);
    const sx = Math.sin(a), cz = Math.cos(a);
    tuft(headInner, m, i % 3 ? C.hair : C.hairLight, [sx * hr * 0.6, hc + hr * 0.72, cz * hr * 0.55 - 0.01],
      [sx * 0.95, 0.6, cz * 0.7 - 0.25], 0.055, rnd(0.1, 0.13));
  }
  tuft(headInner, m, C.hair, [0.01, hc + hr * 0.95, -0.01], [0.25, 1, -0.4], 0.05, 0.09);
  // franja
  const fr = [[-0.07, -0.25], [-0.025, 0.05], [0.025, -0.1], [0.07, 0.25]];
  for (const [x, tilt] of fr) {
    tuft(headInner, m, C.hair, [x, hc + hr * 0.62, hr * 0.78], [x * 3 + tilt * 0.4, -0.75, 0.55], 0.045, 0.13);
  }
  // costeletas e nuca
  for (const sg of [1, -1]) tuft(headInner, m, C.hair, [sg * hr * 0.9, hc + hr * 0.35, hr * 0.15], [sg * 0.15, -1, 0.05], 0.035, 0.13);
  for (let i = -1; i <= 1; i++) tuft(headInner, m, C.hair, [i * 0.05, hc - hr * 0.1, -hr * 0.85], [i * 0.3, -1, -0.35], 0.045, 0.12);

  // cachecol âmbar (laço no pescoço + duas pontas articuladas)
  const scarf = grp(chest, 0, d.torsoLen - 0.015, 0, 'scarf');
  add(scarf, G.tor(0.085, 0.05, 5, 10), m(C.scarf), [0, 0.06, 0], [PI / 2, 0, 0], [1, 0.9, 1]);
  add(scarf, G.tor(0.12, 0.055, 5, 10), m(C.scarfDark), [0, 0.015, 0], [PI / 2, 0.15, 0], [1, 0.82, 1]);
  add(scarf, G.sph(0.055, 6, 5), m(C.scarf), [0.07, 0.01, 0.1]);
  const knot = add(scarf, G.box(0.07, 0.14, 0.025), m(C.scarf), [0.085, -0.07, 0.115], [0.25, 0, 0.25]);
  knot.castShadow = true;
  const tails = [];
  const mkTail = (x, y, z, n, segLen, w, rz) => {
    let parent = grp(scarf, x, y, z);
    parent.rotation.z = rz;
    const segs = [];
    for (let i = 0; i < n; i++) {
      const p = grp(parent, 0, i === 0 ? 0 : -segLen, 0);
      p.rotation.x = i === 0 ? 0.35 : 0.12;
      const ww = w * (1 - i * 0.05);
      add(p, G.box(ww, segLen * 1.08, 0.025), m(i === n - 2 ? C.scarfDark : C.scarf), [0, -segLen / 2, 0]);
      segs.push(p);
      parent = p;
    }
    for (let k = -1; k <= 1; k++) add(parent, G.box(0.02, 0.06, 0.015), m(C.scarfDark), [k * w * 0.32, -segLen - 0.02, 0]);
    tails.push(segs);
  };
  mkTail(0.045, -0.03, -0.12, 5, 0.14, 0.1, 0.08);
  mkTail(-0.02, -0.04, -0.12, 3, 0.13, 0.085, -0.12);
  scarf.userData.segments = tails;
  scarf.userData.rest = tails.map((t) => t.map((s) => s.rotation.x));

  // espada fina de aço com guarda de bronze (lâmina aponta +Z local, cabo na mão direita)
  const sword = grp(P.handR, 0, -0.05, 0.0, 'sword');
  sword.rotation.x = 0.3;
  add(sword, G.cyl(0.018, 0.018, 0.14, 6), m(C.grip), [0, 0, 0], [PI / 2, 0, 0]);
  add(sword, G.sph(0.03, 6, 5), m(C.bronze), [0, 0, -0.085]);
  add(sword, G.box(0.04, 0.2, 0.035), m(C.bronze), [0, 0, 0.085]);
  for (const sy of [1, -1]) add(sword, G.sph(0.025, 5, 4), m(C.bronze), [0, sy * 0.1, 0.085]);
  add(sword, G.box(0.012, 0.05, 0.74), m(C.steel), [0, 0, 0.47]);
  add(sword, G.box(0.015, 0.012, 0.58), m(C.steelDark), [0, 0, 0.42], null, null, false);
  add(sword, G.cone(0.025, 0.11, 4), m(C.steel), [0, 0, 0.895], [PI / 2, 0, 0], [0.48, 1, 1]);
  sword.userData = { length: 0.95, tip: new THREE.Vector3(0, 0, 0.95), base: new THREE.Vector3(0, 0, 0.1) };

  // escudo redondo de madeira com sol pintado (face voltada para +X local, lado de fora do braço esquerdo)
  const shield = grp(r.foreIn.L, 0.08, -0.14, 0.0, 'shield');
  add(shield, G.cyl(0.23, 0.23, 0.035, 12), m(C.wood), [0, 0, 0], [0, 0, -PI / 2]);
  add(shield, G.tor(0.23, 0.024, 4, 12), m(C.iron), [0, 0, 0], [0, PI / 2, 0]);
  for (const z of [-0.085, 0.085]) add(shield, G.box(0.006, 0.42, 0.012), m(C.woodDark), [0.019, 0, z], null, null, false);
  const star = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + PI / 16;
    const rr = i % 2 ? 0.075 : 0.14;
    if (i === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.008, bevelEnabled: false });
  add(shield, starGeo, m(C.sun), [0.018, 0, 0], [0, PI / 2, 0], null, false);
  add(shield, G.cyl(0.06, 0.06, 0.016, 10), m(C.sunRed), [0.03, 0, 0], [0, 0, -PI / 2], null, false);
  add(shield, G.cyl(0.035, 0.035, 0.02, 8), m(C.sun), [0.036, 0, 0], [0, 0, -PI / 2], null, false);
  add(shield, G.box(0.03, 0.2, 0.05), m(C.leather), [-0.03, 0, 0]);
  shield.userData.faceNormal = new THREE.Vector3(1, 0, 0);

  // flauta de barro (invisível por padrão), perto da boca
  const instrument = grp(headInner, 0, hc - hr * 0.5, hr * 0.88, 'instrument');
  const tube = grp(instrument);
  tube.rotation.x = 2.09;
  add(tube, G.cyl(0.02, 0.026, 0.2, 7), m(C.clay), [0, 0.1, 0]);
  add(tube, G.cyl(0.032, 0.027, 0.03, 7), m(C.clay), [0, 0.2, 0]);
  add(tube, G.box(0.03, 0.025, 0.02), m(C.clay), [0, 0.0, 0]);
  for (const y of [0.06, 0.17]) add(tube, G.cyl(0.0235, 0.0245, 0.012, 7), m(C.tunic), [0, y, 0]);
  for (let i = 0; i < 4; i++) add(tube, G.cyl(0.006, 0.006, 0.006, 5), m(0x3a1a0a), [0, 0.085 + i * 0.022, -0.022], [PI / 2, 0, 0], null, false);
  instrument.visible = false;

  const pivots = {
    hips: P.hips, torso: P.torso, head: P.head, armL: P.armL, armR: P.armR,
    foreArmL: P.foreArmL, foreArmR: P.foreArmR, handL: P.handL, handR: P.handR,
    legL: P.legL, legR: P.legR, shinL: P.shinL, shinR: P.shinR,
  };
  r.root.userData.height = 1.72;
  return mergeRig({ root: r.root, pivots, sword, shield, instrument, scarf, height: 1.72 });
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------
function npcPivots(P) {
  return {
    hips: P.hips, torso: P.torso, head: P.head, armL: P.armL, armR: P.armR,
    foreArmL: P.foreArmL, foreArmR: P.foreArmR, handL: P.handL, handR: P.handR,
    legL: P.legL, legR: P.legR, shinL: P.shinL, shinR: P.shinR,
  };
}

function npcElder(m) {
  const d = {
    legLen: 0.7, thigh: 0.34, hipW: 0.08, waist: 0.05, torsoLen: 0.44, neck: 0.05,
    shoulderW: 0.2, shoulderY: 0.38, uaLen: 0.25, faLen: 0.24, lean: 0.42, splay: 0.12,
    armFwd: { L: 0.15, R: 0.55 }, elbow: { L: 0.5, R: 0.35 },
  };
  const robe = 0x6a3d9a, robeDark = 0x4b2a72, gold = 0xe0b84a, white = 0xf3f1ea, skin = 0xe8b996;
  const r = rig(d);
  const c = {
    ...d, chestR: 0.17, waistR: 0.16, hipR: 0.15, depth: 0.8, armR: 0.06, legR: 0.065,
    headR: 0.13, headSY: 1.05, bootH: 0.12, eyeStyle: 'line', browTilt: -0.18, browH: 0.13,
    noseSize: 1.4, noMouth: true,
    col: { skin, shirt: robe, sleeve: robe, fore: robe, pants: robeDark, boot: 0x5a4030, brow: white, hand: skin },
    skirt: { color: robe, r0: 0.17, r1: 0.31, len: 0.74, hem: gold, seg: 9 },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  const hr = c.headR;
  // mangas largas
  for (const s of ['L', 'R']) {
    add(r.foreIn[s], G.cyl(0.065, 0.11, 0.2, 8, true), m(robe, { side: DS }), [0, -d.faLen + 0.08, 0]);
    add(r.foreIn[s], G.cyl(0.112, 0.114, 0.03, 8, true), m(gold, { side: DS }), [0, -d.faLen - 0.02, 0]);
  }
  // manto nos ombros, cordão
  add(chest, G.tor(0.15, 0.06, 5, 10), m(robeDark), [0, d.torsoLen - 0.04, -0.01], [PI / 2, 0, 0], [1.1, 0.85, 1]);
  add(P.hips, G.cyl(0.165, 0.165, 0.045, 8), m(0xc9a56a), [0, 0.07, 0], null, [1, 1, 0.85]);
  add(P.hips, G.box(0.03, 0.18, 0.03), m(0xc9a56a), [0.06, -0.03, 0.14], [0, 0, 0.15]);
  add(chest, G.oct(0.035), m(0x5ad0a0, { emissive: 0x1a6a4a, ei: 0.6 }), [0, d.torsoLen - 0.12, 0.15]);
  // cabeça calva com coroa de cabelo branco
  add(headInner, G.tor(hr * 0.92, hr * 0.22, 5, 10, PI), m(white), [0, hc - hr * 0.05, -hr * 0.05], [-PI / 2, 0, 0]);
  for (const sg of [1, -1]) add(headInner, G.sph(hr * 0.3, 6, 5), m(white), [sg * hr * 0.9, hc - hr * 0.05, 0], null, [0.8, 1.1, 1.1]);
  // barba longa e bigode
  const L = hr * 3.1;
  add(headInner, G.cone(hr * 0.72, L, 7), m(white), [0, hc - hr * 0.55 - (L / 2) * 0.98, hr * 0.55 + (L / 2) * 0.2], [PI - 0.2, 0, 0], [1, 1, 0.7]);
  for (const sg of [1, -1]) {
    add(headInner, G.cone(hr * 0.12, hr * 0.6, 4), m(white), [sg * hr * 0.25, hc - hr * 0.38, hr * 0.85], [0, 0, sg * 1.9]);
  }
  // cajado com cristal
  r.root.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  P.handR.getWorldQuaternion(q);
  const hp = new THREE.Vector3();
  P.handR.getWorldPosition(hp);
  const staff = grp(P.handR, 0, -0.04, 0, 'staff');
  staff.quaternion.copy(q.invert());
  const SL = 1.75;
  const yMid = -hp.y + SL / 2 + 0.04;
  add(staff, G.cyl(0.026, 0.034, SL, 6), m(0x7a5a3a), [0, yMid, 0]);
  add(staff, G.tor(0.07, 0.022, 5, 8, PI * 1.5), m(0x7a5a3a), [0, yMid + SL / 2 + 0.05, 0], [0, 0, -0.3]);
  add(staff, G.oct(0.05), m(0x7ff0c8, { emissive: 0x2ab08a, ei: 0.9 }), [0, yMid + SL / 2 + 0.06, 0], null, [1, 1.4, 1]);
  return { root: r.root, pivots: { ...npcPivots(P), staff }, height: 1.5 };
}

function leafGeometry(w, h) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(w, -h * 0.35, 0, -h);
  s.quadraticCurveTo(-w, -h * 0.35, 0, 0);
  return new THREE.ShapeGeometry(s, 3);
}

function npcGirl(m) {
  const d = {
    legLen: 0.78, thigh: 0.38, hipW: 0.08, waist: 0.05, torsoLen: 0.42, neck: 0.055,
    shoulderW: 0.19, shoulderY: 0.37, uaLen: 0.25, faLen: 0.23, splay: 0.1,
  };
  const C = { skin: 0xf0c4a0, tunic: 0x8fbf5a, pants: 0x5a4632, boot: 0x6b4a2a, cuff: 0x8a6a3a, eye: 0x3d7a3a,
    hair: 0xa8431f, hairLight: 0xc0582c, g1: 0x3f8a3a, g2: 0x5aa845, g3: 0x2f6e2f };
  const r = rig(d);
  const c = {
    ...d, chestR: 0.15, waistR: 0.13, hipR: 0.14, depth: 0.72, armR: 0.05, legR: 0.063,
    headR: 0.125, headSY: 1.07, bootH: 0.28, eyeY: 0.03, browTilt: 0.05,
    col: { skin: C.skin, shirt: C.tunic, sleeve: C.tunic, fore: C.tunic, pants: C.pants, boot: C.boot, cuff: C.cuff,
      bracer: 0x7a5a3a, eye: C.eye, brow: C.hair, mouth: 0xb84a4a },
    skirt: { color: C.tunic, r0: 0.145, r1: 0.19, len: 0.2 },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  const hr = c.headR;
  add(P.hips, G.cyl(0.15, 0.15, 0.045, 8), m(0x7a5a3a), [0, 0.07, 0], null, [1, 1, 0.8]);
  add(P.hips, G.box(0.07, 0.08, 0.05), m(0x6b4a2a), [-0.13, 0.02, 0.04], [0, -0.5, 0]);
  // cabelo ruivo + trança
  hairCap(headInner, c, m, C.hair, { front: 0.36, back: 0.8 });
  for (const [x, dx] of [[-0.06, -0.5], [-0.02, -0.2], [0.03, 0.2], [0.07, 0.5]]) {
    tuft(headInner, m, C.hair, [x, hc + hr * 0.7, hr * 0.7], [dx, -0.6, 0.5], 0.045, 0.11);
  }
  for (const sg of [1, -1]) tuft(headInner, m, C.hair, [sg * hr * 0.9, hc + hr * 0.4, hr * 0.25], [sg * 0.12, -1, 0.05], 0.04, 0.2);
  const braid = grp(headInner, 0, hc - hr * 0.25, -hr * 0.95, 'braid');
  braid.rotation.x = 0.25;
  for (let i = 0; i < 6; i++) {
    const rr = 0.048 - i * 0.004;
    add(braid, G.sph(rr, 6, 5), m(i % 2 ? C.hairLight : C.hair), [0, -i * 0.075, 0], null, [1, 1.25, 1]);
  }
  add(braid, G.cyl(0.03, 0.03, 0.025, 6), m(C.g2), [0, -0.44, 0]);
  add(braid, leafGeometry(0.04, 0.12), m(C.g2, { side: DS }), [0, -0.45, 0.0], [0, 0.3, 0]);
  // flor no cabelo
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    add(headInner, G.sph(0.025, 5, 4), m(0xffffff), [hr * 0.75 + Math.cos(a) * 0.025, hc + hr * 0.55 + Math.sin(a) * 0.025, hr * 0.35], null, [1, 1, 0.4]);
  }
  add(headInner, G.sph(0.018, 5, 4), m(0xffd23f), [hr * 0.75, hc + hr * 0.55, hr * 0.37]);
  // capa de folhas, capuz abaixado
  const cloakTop = d.torsoLen + 0.01;
  add(chest, G.cyl(0.19, 0.33, 0.9, 9, true, PI / 2, PI), m(C.g1, { side: DS }), [0, cloakTop - 0.45, -0.01]);
  const leaf = leafGeometry(0.075, 0.22);
  for (let row = 0; row < 4; row++) {
    const y = cloakTop - 0.08 - row * 0.2;
    const t = (cloakTop - y) / 0.9;
    const rad = 0.19 + (0.33 - 0.19) * t + 0.015;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const th = PI / 2 + ((i + 0.5 + (row % 2) * 0.5) / (n + 0.5)) * PI;
      const lg = grp(chest, Math.sin(th) * rad, y + 0.05, Math.cos(th) * rad * 1.0 - 0.01);
      lg.rotation.y = th;
      const lm = add(lg, leaf, m(pick([C.g1, C.g2, C.g3]), { side: DS }), [0, 0, 0.0], [-0.18, 0, rnd(-0.2, 0.2)]);
      lm.castShadow = true;
    }
  }
  // folhas nos ombros
  for (const sg of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const lg = grp(chest, sg * (0.12 + k * 0.04), cloakTop + 0.02, 0.02 - k * 0.04);
      lg.rotation.set(0, sg * PI / 2, 0);
      add(lg, leaf, m(k % 2 ? C.g2 : C.g1, { side: DS }), [0, 0, 0.0], [-0.6, 0, sg * 0.3]);
    }
  }
  add(chest, G.sph(0.15, 8, 5), m(C.g3), [0, d.torsoLen + 0.02, -0.11], null, [1.15, 0.55, 0.75]);
  add(chest, G.tor(0.12, 0.035, 5, 10, PI), m(C.g1), [0, d.torsoLen + 0.0, -0.02], [-PI / 2 - 0.2, 0, 0]);
  add(chest, G.cyl(0.03, 0.03, 0.02, 8), m(0xc98f3a), [0, d.torsoLen - 0.05, 0.1], [PI / 2 - 0.2, 0, 0]);
  return { root: r.root, pivots: { ...npcPivots(P), braid }, height: 1.62 };
}

function npcMerchant(m) {
  const d = {
    legLen: 0.78, thigh: 0.38, hipW: 0.11, waist: 0.05, torsoLen: 0.5, neck: 0.04,
    shoulderW: 0.26, shoulderY: 0.44, uaLen: 0.27, faLen: 0.25, splay: 0.22,
  };
  const C = { skin: 0xe0a882, shirt: 0xb8452f, pants: 0x5a4a3a, boot: 0x3d2a1a, apron: 0xeee0c0, leather: 0x8a5a30,
    leatherDark: 0x6a4220, hair: 0x5a3218, cap: 0x3f7a4a };
  const r = rig(d);
  const c = {
    ...d, chestR: 0.22, waistR: 0.25, hipR: 0.2, depth: 0.85, armR: 0.068, legR: 0.08,
    headR: 0.14, headSY: 1.02, bootH: 0.2, browTilt: -0.05, browH: 0.11, noMouth: true, noseSize: 1.3,
    col: { skin: C.skin, shirt: C.shirt, sleeve: C.shirt, fore: C.skin, pants: C.pants, boot: C.boot, eye: 0x332211, brow: C.hair },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  const hr = c.headR;
  // barriga e avental
  add(chest, G.sph(0.26, 9, 7), m(C.shirt), [0, 0.15, 0.05], null, [1, 0.92, 0.85]);
  add(chest, G.cyl(0.285, 0.3, 0.62, 9, true, -0.75, 1.5), m(C.apron, { side: DS }), [0, 0.06, 0.04]);
  add(chest, G.box(0.16, 0.1, 0.03), m(0xd8c8a0), [0.06, -0.05, 0.33]);
  for (const sg of [1, -1]) add(chest, G.box(0.03, 0.26, 0.02), m(C.apron), [sg * 0.11, 0.38, 0.17], [-0.35, 0, 0]);
  for (const s of ['L', 'R']) add(r.armIn[s], G.cyl(0.075, 0.075, 0.05, 7), m(0x9a3a26), [0, -d.uaLen + 0.02, 0]);
  // mochila grande
  const pack = grp(chest, 0, 0.27, -0.33, 'backpack');
  add(pack, G.box(0.56, 0.72, 0.36), m(C.leather), [0, 0, 0]);
  add(pack, G.box(0.58, 0.2, 0.38), m(C.leatherDark), [0, 0.27, 0.0]);
  add(pack, G.box(0.3, 0.22, 0.08), m(C.leatherDark), [0, -0.12, -0.21]);
  add(pack, G.cyl(0.11, 0.11, 0.72, 8), m(0xc0392b), [0, 0.47, 0], [0, 0, PI / 2]);
  for (const sg of [1, -1]) add(pack, G.cyl(0.115, 0.115, 0.04, 8), m(0xe8c06a), [sg * 0.2, 0.47, 0], [0, 0, PI / 2]);
  add(pack, G.cyl(0.14, 0.12, 0.04, 9), m(0x3a3a40), [0.33, 0.0, 0], [0, 0, PI / 2]);
  add(pack, G.box(0.03, 0.2, 0.03), m(0x3a3a40), [0.34, 0.2, 0]);
  add(pack, G.sph(0.1, 7, 6), m(0x8a6a4a), [-0.33, -0.05, 0]);
  add(pack, G.box(0.1, 0.14, 0.1), m(0x3a3a40), [-0.33, 0.2, 0.02]);
  add(pack, G.box(0.06, 0.08, 0.06), m(0xffd56a, { emissive: 0xffa030, ei: 0.6 }), [-0.33, 0.2, 0.025], null, null, false);
  for (const sg of [1, -1]) add(chest, G.box(0.05, 0.35, 0.03), m(C.leatherDark), [sg * 0.15, 0.33, 0.2], [-0.4, 0, 0]);
  // cabeça: boné, bigodão, bochechas
  add(headInner, G.cyl(hr * 1.02, hr * 1.06, hr * 0.55, 8), m(C.cap), [0, hc + hr * 0.65, -hr * 0.03]);
  add(headInner, G.sph(hr * 1.02, 8, 4, 0, TAU, 0, PI / 2), m(C.cap), [0, hc + hr * 0.9, -hr * 0.03], null, [1, 0.6, 1]);
  add(headInner, G.box(hr * 1.6, 0.025, hr * 0.7), m(0x2f5f3a), [0, hc + hr * 0.42, hr * 0.85], [0.15, 0, 0]);
  add(headInner, G.tor(hr * 0.92, hr * 0.18, 5, 10, PI), m(C.hair), [0, hc + hr * 0.15, -hr * 0.05], [-PI / 2, 0, 0]);
  for (const sg of [1, -1]) {
    add(headInner, G.cone(hr * 0.17, hr * 0.75, 5), m(C.hair), [sg * hr * 0.32, hc - hr * 0.35, hr * 0.88], [0, 0, sg * -1.85]);
    add(headInner, G.sph(hr * 0.16, 5, 4), m(0xf08070), [sg * hr * 0.55, hc - hr * 0.15, hr * 0.72], null, [1, 0.7, 0.5], false);
  }
  return { root: r.root, pivots: { ...npcPivots(P), backpack: pack }, height: 1.74 };
}

function npcChild(m) {
  const d = {
    legLen: 0.44, thigh: 0.21, hipW: 0.065, waist: 0.04, torsoLen: 0.3, neck: 0.035,
    shoulderW: 0.14, shoulderY: 0.26, uaLen: 0.17, faLen: 0.16, splay: 0.12,
  };
  const C = { skin: 0xf6cba5, dress: 0xf4c430, dressDark: 0xd9a020, hair: 0x4a2a14, ribbon: 0xe0453a };
  const r = rig(d);
  const c = {
    ...d, chestR: 0.11, waistR: 0.1, hipR: 0.1, depth: 0.78, armR: 0.04, legR: 0.045,
    headR: 0.125, headSY: 1.02, bootH: 0.09, eyeY: 0.0, browTilt: -0.05,
    col: { skin: C.skin, shirt: C.dress, sleeve: C.dress, fore: C.skin, pants: C.skin, boot: C.ribbon, eye: 0x3a2a1a, brow: C.hair, mouth: 0xc05050 },
    skirt: { color: C.dress, r0: 0.11, r1: 0.2, len: 0.24, hem: 0xffffff },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  const hr = c.headR;
  add(chest, G.tor(0.07, 0.025, 4, 8), m(0xffffff), [0, d.torsoLen - 0.01, 0], [PI / 2, 0, 0]);
  add(chest, G.box(0.13, 0.12, 0.01), m(C.dressDark), [0, 0.13, 0.085]);
  hairCap(headInner, c, m, C.hair, { front: 0.36, back: 0.8, scale: 1.1 });
  for (const x of [-0.06, -0.02, 0.02, 0.06]) tuft(headInner, m, C.hair, [x, hc + hr * 0.7, hr * 0.72], [x * 2, -0.7, 0.5], 0.04, 0.09);
  for (const sg of [1, -1]) {
    add(headInner, G.sph(0.07, 7, 6), m(C.hair), [sg * hr * 1.15, hc + hr * 0.1, -hr * 0.2], null, [0.8, 1.2, 0.9]);
    add(headInner, G.box(0.05, 0.035, 0.035), m(C.ribbon), [sg * hr * 1.0, hc + hr * 0.35, -hr * 0.2]);
    add(headInner, G.sph(hr * 0.13, 5, 4), m(0xf3a08a), [sg * hr * 0.55, hc - hr * 0.22, hr * 0.78], null, [1, 0.7, 0.5], false);
  }
  return { root: r.root, pivots: npcPivots(P), height: 1.12 };
}

function npcVillager(m) {
  const female = Math.random() < 0.5;
  const d = {
    legLen: rnd(0.76, 0.84), thigh: 0.38, hipW: 0.09, waist: 0.05, torsoLen: rnd(0.44, 0.5), neck: 0.05,
    shoulderW: female ? 0.19 : 0.22, shoulderY: 0.4, uaLen: 0.27, faLen: 0.25, splay: 0.1,
  };
  d.thigh = d.legLen * 0.48;
  const shirt = pick([0xd0603a, 0x4a7fc0, 0xe0b040, 0x7a9a40, 0xb05a90, 0x40a0a0, 0xd88a4a]);
  const pants = pick([0x5a4632, 0x3f4a5a, 0x6a5a3a, 0x4a3a30]);
  const hair = pick([0x2a1a10, 0x5a3218, 0x9a5a20, 0xd8b060, 0x8a8a8a]);
  const skin = pick([0xf1c09a, 0xe0a882, 0xc68a62, 0x9a6440, 0xf6d0b0]);
  const r = rig(d);
  const c = {
    ...d, chestR: female ? 0.15 : 0.18, waistR: 0.15, hipR: 0.15, depth: 0.75, armR: 0.055, legR: 0.068,
    headR: 0.132, headSY: 1.06, bootH: 0.2,
    col: { skin, shirt, sleeve: shirt, fore: Math.random() < 0.5 ? skin : shirt, pants, boot: 0x4a3020, eye: 0x2a2a2a, brow: hair },
    skirt: female ? { color: pick([0x8a3a5a, 0x3a5a8a, 0x6a4a2a, 0x2f7a5a]), r0: 0.16, r1: 0.3, len: 0.66, hem: 0xf0e0c0, seg: 9 } : null,
  };
  const { hc } = dress(r, c, m);
  const { P, headInner, chest } = r;
  const hr = c.headR;
  add(P.hips, G.cyl(0.16, 0.16, 0.05, 8), m(0x6a4222), [0, 0.07, 0], null, [1, 1, 0.8]);
  hairCap(headInner, c, m, hair, { front: 0.36, back: female ? 0.85 : 0.65 });
  if (female) {
    add(headInner, G.sph(0.07, 6, 5), m(hair), [0, hc + hr * 0.4, -hr * 1.05]);
    if (Math.random() < 0.6) {
      add(headInner, new THREE.SphereGeometry(hr * 1.14, 9, 5, 0, TAU, 0, PI * 0.3), m(pick([0xe05050, 0xf0f0e0, 0x5080d0])), [0, hc + hr * 0.15, -hr * 0.05]);
    }
    add(chest, G.box(0.2, 0.12, 0.01), m(0xf0e0c0), [0, 0.32, 0.12]);
  } else {
    if (Math.random() < 0.55) {
      add(headInner, G.cyl(hr * 0.8, hr * 0.95, hr * 0.6, 8), m(0xe2c26a), [0, hc + hr * 0.9, 0]);
      add(headInner, G.cyl(hr * 2.1, hr * 2.1, 0.03, 10), m(0xe2c26a), [0, hc + hr * 0.62, 0]);
      add(headInner, G.cyl(hr * 0.82, hr * 0.97, hr * 0.15, 8), m(0xa0402a), [0, hc + hr * 0.7, 0]);
    }
    if (Math.random() < 0.4) add(headInner, G.box(hr * 1.2, hr * 0.5, hr * 0.4), m(hair), [0, hc - hr * 0.6, hr * 0.7]);
  }
  return { root: r.root, pivots: npcPivots(P), height: 1.7 };
}

export function createNPC(kind = 'villager') {
  let res;
  switch (kind) {
    case 'elder': res = npcElder(M); break;
    case 'girl': res = npcGirl(M); break;
    case 'merchant': res = npcMerchant(M); break;
    case 'child': res = npcChild(M); break;
    default: res = npcVillager(M); kind = 'villager';
  }
  res.root.userData.kind = kind;
  res.root.userData.height = res.height;
  res.kind = kind;
  return mergeRig(res);
}

// ---------------------------------------------------------------------------
// INIMIGOS
// ---------------------------------------------------------------------------
function enemySlime(m) {
  const root = new THREE.Group();
  const body = grp(root, 0, 0, 0, 'body');
  add(body, G.sph(0.42, 12, 9), m(0x55d66b, { opacity: 0.78, flat: false, emissive: 0x0f3a14, ei: 1 }), [0, 0.3, 0], null, [1, 0.78, 1]);
  add(body, G.ico(0.13, 0), m(0x2f8a3a), [0, 0.24, -0.04], [0.4, 0.3, 0]);
  for (const [x, y, z, rr] of [[0.15, 0.2, 0.05, 0.04], [-0.12, 0.3, -0.12, 0.03], [0.05, 0.4, -0.15, 0.025]]) {
    add(body, G.sph(rr, 5, 4), m(0xb8ffc0, { opacity: 0.8 }), [x, y, z], null, null, false);
  }
  add(body, G.sph(0.08, 6, 4), m(0xffffff, { opacity: 0.6, flat: false }), [-0.17, 0.5, 0.18], null, [1, 0.5, 0.6], false);
  const eyes = grp(body, 0, 0.42, 0.33, 'eyes');
  for (const sg of [1, -1]) {
    add(eyes, G.sph(0.075, 7, 6), m(0xffffff), [sg * 0.12, 0, 0], null, [1, 1.1, 0.6]);
    add(eyes, G.sph(0.04, 6, 5), m(0x111111), [sg * 0.115, -0.005, 0.042], null, [1, 1.2, 0.5]);
  }
  return { root, pivots: { body, eyes }, height: 0.7 };
}

function enemyGoblin(m) {
  const d = {
    legLen: 0.5, thigh: 0.24, hipW: 0.09, waist: 0.04, torsoLen: 0.38, neck: 0.04,
    shoulderW: 0.2, shoulderY: 0.33, uaLen: 0.26, faLen: 0.25, lean: 0.35, splay: 0.18,
    armFwd: { L: 0.15, R: 0.25 }, elbow: { L: 0.2, R: 0.4 },
  };
  const C = { skin: 0x7d9470, skinDark: 0x5f7556, vest: 0x6e5236, cloth: 0x5a4430, wood: 0x7a5230, eye: 0xf2e14a };
  const r = rig(d);
  const c = {
    ...d, chestR: 0.17, waistR: 0.15, hipR: 0.14, depth: 0.8, armR: 0.05, legR: 0.06,
    headR: 0.15, headSY: 0.95, bootH: 0.1, browTilt: 0.35, browH: 0.12, noseSize: 1.9, noEars: true,
    col: { skin: C.skin, shirt: C.vest, sleeve: C.skin, fore: C.skin, pants: C.cloth, boot: C.skinDark,
      sclera: C.eye, scleraEm: 0x6a5a00, eye: 0x401010, brow: C.skinDark, mouth: 0x3a1a1a, hand: C.skinDark },
    skirt: { color: C.cloth, r0: 0.15, r1: 0.2, len: 0.2, seg: 6 },
  };
  const { hc } = dress(r, c, m);
  const { P, chest, headInner } = r;
  const hr = c.headR;
  // orelhas grandes
  for (const sg of [1, -1]) {
    tuft(headInner, m, C.skin, [sg * hr * 0.85, hc + hr * 0.1, -hr * 0.1], [sg * 1, 0.35, -0.25], 0.065, 0.3);
    tuft(headInner, m, 0xb07a70, [sg * hr * 0.9, hc + hr * 0.1, -hr * 0.05], [sg * 1, 0.35, -0.2], 0.035, 0.2);
    add(headInner, G.cone(0.015, 0.05, 4), m(0xf0ead0), [sg * hr * 0.25, hc - hr * 0.42, hr * 0.85]);
  }
  add(headInner, G.box(hr * 1.2, hr * 0.4, hr * 0.6), m(C.skinDark), [0, hc - hr * 0.6, hr * 0.35]);
  // colete com tachas, cinto de corda
  for (let i = 0; i < 3; i++) add(chest, G.sph(0.018, 4, 3), m(0x9a9a9a), [0.06, 0.12 + i * 0.08, 0.13]);
  add(P.hips, G.cyl(0.155, 0.155, 0.04, 6), m(0x8a6a40), [0, 0.06, 0], null, [1, 1, 0.85]);
  // clava
  const club = grp(P.handR, 0, -0.04, 0, 'club');
  club.rotation.x = -0.2;
  add(club, G.cyl(0.025, 0.032, 0.38, 6), m(C.wood), [0, 0, 0.1], [PI / 2, 0, 0]);
  add(club, G.dod(0.1), m(C.wood), [0, 0, 0.36], null, [1, 1, 1.4]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    tuft(club, m, 0xa0a4ac, [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.36 + (i % 2 ? 0.06 : -0.04)], [Math.cos(a), Math.sin(a), 0.1], 0.02, 0.07);
  }
  club.userData = { length: 0.5, tip: new THREE.Vector3(0, 0, 0.5) };
  return { root: r.root, pivots: { ...npcPivots(P), club }, height: 1.25, weapon: club };
}

function enemySkeleton(m) {
  const d = {
    legLen: 0.86, thigh: 0.42, hipW: 0.1, waist: 0.06, torsoLen: 0.48, neck: 0.07,
    shoulderW: 0.2, shoulderY: 0.42, uaLen: 0.28, faLen: 0.26, splay: 0.12, lean: 0.08,
  };
  const bone = 0xe6dfc6, dark = 0x2a2420, rust = 0x9a5a2a, cloth = 0x5a2a3a;
  const r = rig(d);
  const { P, chest, headInner } = r;
  const B = m(bone);
  // pelve e coluna
  add(P.hips, G.box(0.24, 0.1, 0.14), B, [0, 0, 0]);
  add(P.hips, G.cyl(0.17, 0.2, 0.18, 7, true), m(cloth, { side: DS }), [0, -0.03, 0], null, [1, 1, 0.8]);
  add(chest, G.cyl(0.025, 0.03, d.torsoLen, 5), B, [0, d.torsoLen / 2, -0.06]);
  for (let i = 0; i < 5; i++) add(chest, G.box(0.05, 0.03, 0.04), B, [0, 0.05 + i * 0.09, -0.08]);
  const ribs = [[0.13, 0.36], [0.145, 0.29], [0.14, 0.22], [0.12, 0.15]];
  const gap = 0.7;
  for (const [rr, y] of ribs) {
    const geo = G.tor(rr, 0.014, 4, 12, TAU - gap);
    geo.rotateZ(1.5 * PI + gap / 2);
    add(chest, geo, B, [0, y, -0.02], [-PI / 2, 0, 0], [1, 0.75, 1]);
  }
  add(chest, G.box(0.04, 0.24, 0.02), B, [0, 0.26, 0.085]);
  for (const sg of [1, -1]) add(chest, G.cyl(0.015, 0.015, 0.2, 4), B, [sg * 0.1, d.torsoLen - 0.04, 0.02], [0, 0, PI / 2]);
  // membros
  for (const s of ['L', 'R']) {
    const ai = r.armIn[s], fi = r.foreIn[s];
    add(ai, G.sph(0.048, 5, 4), B, [0, 0, 0]);
    add(ai, G.cyl(0.03, 0.026, d.uaLen, 5), B, [0, -d.uaLen / 2, 0]);
    add(fi, G.sph(0.038, 5, 4), B, [0, 0, 0]);
    add(fi, G.cyl(0.026, 0.022, d.faLen, 5), B, [0, -d.faLen / 2, 0]);
    add(P['hand' + s], G.box(0.07, 0.08, 0.035), B, [0, -0.04, 0]);
    const shinLen = d.legLen - d.thigh;
    add(P['leg' + s], G.sph(0.05, 5, 4), B, [0, 0, 0]);
    add(P['leg' + s], G.cyl(0.036, 0.03, d.thigh, 5), B, [0, -d.thigh / 2, 0]);
    add(P['shin' + s], G.sph(0.044, 5, 4), B, [0, 0, 0]);
    add(P['shin' + s], G.cyl(0.03, 0.025, shinLen - 0.04, 5), B, [0, -shinLen / 2, 0]);
    add(P['shin' + s], G.box(0.08, 0.045, 0.17), B, [0, -shinLen + 0.022, 0.04]);
  }
  // crânio
  const hc = d.neck + 0.12;
  add(headInner, G.cyl(0.02, 0.025, d.neck + 0.03, 5), B, [0, d.neck / 2, 0]);
  add(headInner, G.sph(0.12, 8, 6), B, [0, hc + 0.02, -0.01], null, [0.95, 1.05, 1.05]);
  for (const sg of [1, -1]) {
    add(headInner, G.box(0.055, 0.05, 0.03), m(dark), [sg * 0.045, hc + 0.02, 0.1], null, null, false);
    add(headInner, G.sph(0.013, 4, 3), m(0xff4020, { emissive: 0xff3010, ei: 1.5 }), [sg * 0.045, hc + 0.015, 0.115], null, null, false);
  }
  add(headInner, G.cone(0.018, 0.035, 3), m(dark), [0, hc - 0.03, 0.115], [PI, 0, 0], null, false);
  const jaw = grp(headInner, 0, hc - 0.06, -0.02, 'jaw');
  add(jaw, G.box(0.13, 0.04, 0.12), B, [0, -0.02, 0.06]);
  add(jaw, G.box(0.09, 0.02, 0.01), m(0xfaf6e8), [0, 0.005, 0.118], null, null, false);
  add(headInner, G.box(0.09, 0.02, 0.01), m(0xfaf6e8), [0, hc - 0.055, 0.11], null, null, false);
  // espada enferrujada
  const sword = grp(P.handR, 0, -0.04, 0, 'sword');
  sword.rotation.x = 0.25;
  add(sword, G.cyl(0.018, 0.018, 0.13, 5), m(dark), [0, 0, 0], [PI / 2, 0, 0]);
  add(sword, G.box(0.03, 0.18, 0.03), m(rust), [0, 0, 0.08]);
  add(sword, G.box(0.016, 0.07, 0.68), m(0x8a7a6a), [0, 0, 0.43]);
  add(sword, G.box(0.018, 0.03, 0.12), m(rust), [0, 0.025, 0.3], null, null, false);
  add(sword, G.box(0.018, 0.025, 0.1), m(rust), [0, -0.03, 0.55], null, null, false);
  add(sword, G.box(0.02, 0.02, 0.04), m(dark), [0, 0.032, 0.62], null, null, false);
  add(sword, G.cone(0.035, 0.12, 4), m(0x8a7a6a), [0, 0, 0.83], [PI / 2, 0, 0], [0.45, 1, 1]);
  sword.userData = { length: 0.89, tip: new THREE.Vector3(0, 0, 0.89) };
  return { root: r.root, pivots: { ...npcPivots(P), jaw, sword }, height: 1.75, weapon: sword };
}

function batWingGeometry(sg) {
  const pts = [[0, 0.07], [0.12, 0.12], [0.28, 0.11], [0.46, 0.03], [0.38, -0.05], [0.33, -0.02], [0.26, -0.11],
    [0.19, -0.05], [0.1, -0.12], [0.03, -0.06], [0, -0.05]];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x * sg, y) : s.moveTo(x * sg, y)));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(PI / 2);
  return g;
}

function enemyBat(m) {
  const root = new THREE.Group();
  const body = grp(root, 0, 0.3, 0, 'body');
  const fur = m(0x4b3566), mem = m(0x7a4590, { side: DS }), boneC = m(0x2e1f3d);
  add(body, G.sph(0.12, 7, 6), fur, [0, 0, 0], null, [1, 0.9, 1.1]);
  const head = grp(body, 0, 0.05, 0.1, 'head');
  add(head, G.sph(0.09, 7, 6), fur, [0, 0, 0]);
  for (const sg of [1, -1]) {
    tuft(head, m, 0x4b3566, [sg * 0.045, 0.06, -0.01], [sg * 0.4, 1, -0.1], 0.035, 0.1);
    add(head, G.sph(0.018, 5, 4), m(0xff3030, { emissive: 0xff2020, ei: 1.2 }), [sg * 0.035, 0.02, 0.075], null, null, false);
    add(head, G.cone(0.01, 0.035, 3), m(0xffffff), [sg * 0.018, -0.045, 0.07], [PI, 0, 0], null, false);
  }
  add(head, G.box(0.05, 0.03, 0.03), m(0x7a5a8a), [0, -0.015, 0.085], null, null, false);
  for (const sg of [1, -1]) add(body, G.cone(0.015, 0.06, 3), boneC, [sg * 0.04, -0.12, -0.02], [PI, 0, 0]);
  const wings = {};
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const wp = grp(body, sg * 0.08, 0.02, 0, 'wing' + s);
    const w = grp(wp);
    w.rotation.z = sg * 0.35; // diedro de repouso (asa levemente em V)
    add(w, batWingGeometry(sg), mem, [0, 0, 0]);
    add(w, G.cyl(0.012, 0.008, 0.47, 4), boneC, [sg * 0.23, 0.005, 0.07], [0, 0, PI / 2]);
    for (const [x, z] of [[0.26, -0.11], [0.1, -0.12]]) {
      const len = Math.hypot(x, z + 0.07);
      const b = add(w, G.cyl(0.006, 0.004, len, 3), boneC, [sg * x / 2, 0.005, (z + 0.07) / 2 + 0.0]);
      orient(b, sg * x, 0, z - 0.07);
    }
    wings[s] = wp;
  }
  return { root, pivots: { body, head, wingL: wings.L, wingR: wings.R }, height: 0.5 };
}

function enemyPlant(m) {
  const root = new THREE.Group();
  const leafM = m(0x2f7a2a), stemM = m(0x3c7a2a), red = m(0xc8283a), inner = m(0x7a1040, { side: DS }), tooth = m(0xf4f0dc);
  for (let i = 0; i < 6; i++) {
    const lg = grp(root);
    lg.rotation.y = (i / 6) * TAU + rnd(-0.2, 0.2);
    add(lg, G.cone(0.1, 0.6, 4), i % 2 ? leafM : m(0x3f9a35), [0, 0.06, 0.28], [PI / 2 - 0.25, 0, 0], [1.6, 1, 0.3]);
  }
  add(root, G.sph(0.12, 6, 4), stemM, [0, 0.05, 0], null, [1, 0.6, 1]);
  const stem = grp(root, 0, 0.08, 0, 'stem');
  add(stem, G.cyl(0.05, 0.065, 0.55, 6), stemM, [0, 0.275, 0]);
  const sl = grp(stem, 0.04, 0.3, 0);
  sl.rotation.z = -1.0;
  add(sl, G.cone(0.06, 0.25, 4), leafM, [0, 0.12, 0], null, [1.4, 1, 0.3]);
  const stem2 = grp(stem, 0, 0.55, 0, 'stem2');
  add(stem2, G.cyl(0.04, 0.05, 0.5, 6), stemM, [0, 0.25, 0]);
  const head = grp(stem2, 0, 0.5, 0, 'head');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const cg = grp(head, Math.sin(a) * 0.05, -0.02, Math.cos(a) * 0.05 - 0.06);
    cg.rotation.y = a;
    add(cg, G.cone(0.05, 0.18, 4), leafM, [0, 0.0, 0.06], [1.2, 0, 0], [1, 1, 0.35]);
  }
  const jawTop = grp(head, 0, 0, -0.14, 'jawTop');
  const jt = grp(jawTop);
  jt.rotation.x = -0.18;
  add(jt, new THREE.SphereGeometry(0.22, 9, 5, 0, TAU, 0, PI / 2), red, [0, 0, 0.14], null, [1, 0.85, 1.1]);
  add(jt, new THREE.CircleGeometry(0.215, 9), inner, [0, 0.002, 0.14], [PI / 2, 0, 0], [1, 1.08, 1], false);
  for (const [x, y, z, rr] of [[0.08, 0.15, 0.12, 0.04], [-0.1, 0.13, 0.2, 0.035], [0.0, 0.18, 0.02, 0.03], [0.15, 0.08, 0.25, 0.03], [-0.15, 0.1, 0.05, 0.035]]) {
    add(jt, G.sph(rr, 5, 4), m(0xfff2e0), [x, y, z + 0.0], null, [1, 0.5, 1], false);
  }
  const jawBottom = grp(head, 0, 0, -0.14, 'jawBottom');
  const jb = grp(jawBottom);
  jb.rotation.x = 0.12;
  add(jb, new THREE.SphereGeometry(0.2, 9, 4, 0, TAU, PI / 2, PI / 2), red, [0, 0, 0.14], null, [1, 0.7, 1.05]);
  add(jb, new THREE.CircleGeometry(0.195, 9), inner, [0, -0.002, 0.14], [-PI / 2, 0, 0], [1, 1.05, 1], false);
  add(jb, G.sph(0.08, 6, 4), m(0xe05080), [0, 0.0, 0.15], null, [1, 0.3, 1.4], false);
  for (let i = 0; i < 7; i++) {
    const a = -1.3 + (i / 6) * 2.6;
    const x = Math.sin(a), z = Math.cos(a);
    add(jt, G.cone(0.022, 0.07, 4), tooth, [x * 0.19, -0.03, 0.14 + z * 0.2], [PI, 0, 0], null, false);
    add(jb, G.cone(0.02, 0.06, 4), tooth, [Math.sin(a + 0.2) * 0.17, 0.03, 0.14 + Math.cos(a + 0.2) * 0.18], null, null, false);
  }
  return { root, pivots: { stem, stem2, head, jawTop, jawBottom }, height: 1.45 };
}

export function createEnemy(type = 'slime') {
  const m = ownFactory();
  let res;
  switch (type) {
    case 'goblin': res = enemyGoblin(m); break;
    case 'skeleton': res = enemySkeleton(m); break;
    case 'bat': res = enemyBat(m); break;
    case 'plant': res = enemyPlant(m); break;
    default: res = enemySlime(m); type = 'slime';
  }
  res.root.traverse((o) => {
    if (o.isMesh) o.receiveShadow = false;
  });
  res.root.userData.type = type;
  res.root.userData.height = res.height;
  res.type = type;
  res.materials = m.list;
  return mergeRig(res);
}

// ---------------------------------------------------------------------------
// CHEFE — Guardião Musgoso (golem de pedra ~6 m)
// ---------------------------------------------------------------------------
export function createBoss() {
  const m = ownFactory();
  const stone = m(0x8c8a80), stoneD = m(0x6a675f), stoneL = m(0xa29f94);
  const moss = m(0x4f8a2e), mossL = m(0x6aa83a);
  const rune = m(0xffb23a, { emissive: 0xff9a20, ei: 1.2 });
  const eyeM = m(0xffd060, { emissive: 0xffb020, ei: 2.0 });
  const coreM = m(0xffb030, { emissive: 0xff8a00, ei: 1.8 });

  const root = new THREE.Group();
  root.name = 'GuardiaoMusgoso';
  const P = {};
  P.hips = grp(root, 0, 2.0, 0, 'hips');
  add(P.hips, G.box(1.9, 0.75, 1.25), stoneD, [0, 0.1, 0]);
  add(P.hips, G.ico(0.4, 0), moss, [0.5, 0.45, 0.4], null, [1.2, 0.35, 1]);
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const leg = grp(P.hips, sg * 0.8, 0, 0, 'leg' + s);
    add(leg, jitter(G.dod(0.58), 0.06), stone, [0, -0.5, 0], null, [1, 1.15, 1]);
    add(leg, G.box(0.95, 0.85, 0.95), stoneD, [0, -1.2, 0], [0, sg * 0.2, 0]);
    add(leg, G.box(1.15, 0.45, 1.45), stone, [0, -1.775, 0.15]);
    for (const x of [-0.35, 0, 0.35]) add(leg, G.box(0.28, 0.3, 0.25), stoneL, [x, -1.85, 0.92]);
    add(leg, G.ico(0.3, 0), mossL, [sg * 0.2, -0.95, 0.4], null, [1, 0.4, 1]);
    P['leg' + s] = leg;
  }
  P.torso = grp(P.hips, 0, 0.35, 0, 'torso');
  const chest = grp(P.torso);
  chest.rotation.x = 0.15;
  add(chest, G.box(2.0, 0.9, 1.45), stoneD, [0, 0.3, 0]);
  add(chest, G.box(2.8, 2.2, 1.75), stone, [0, 1.5, 0]);
  add(chest, jitter(G.dod(1.05), 0.12), stoneD, [0, 2.15, -0.45], null, [1.45, 0.85, 1]);
  for (const sg of [1, -1]) add(chest, jitter(G.dod(0.8), 0.1), stone, [sg * 1.5, 2.3, 0]);
  // núcleo
  for (const [x, y, w, h] of [[0, 2.0, 1.1, 0.25], [0, 0.85, 1.1, 0.25], [0.5, 1.42, 0.25, 1.0], [-0.5, 1.42, 0.25, 1.0]]) {
    add(chest, G.box(w, h, 0.3), stoneL, [x, y, 0.85]);
  }
  add(chest, G.box(0.8, 0.95, 0.1), m(0x2a2620), [0, 1.42, 0.82]);
  const core = add(chest, G.oct(0.38), coreM, [0, 1.42, 0.92], null, [0.8, 1.15, 0.7]);
  core.name = 'core';
  const halo = add(core, G.sph(0.6, 10, 8), makeMaterial(0xffa030, { basic: true, additive: true, opacity: 0.25 }), [0, 0, 0], null, null, false);
  halo.renderOrder = 2;
  const coreLight = new THREE.PointLight(0xffa030, 8, 10, 2);
  core.add(coreLight);
  // runas
  for (const [x, y, w, h, rz] of [[0.9, 1.6, 0.06, 0.8, 0.3], [-0.9, 1.6, 0.06, 0.8, -0.3], [0.75, 0.75, 0.5, 0.06, 0.4], [-0.75, 0.75, 0.5, 0.06, -0.4], [0, 2.35, 0.7, 0.06, 0]]) {
    add(chest, G.box(w, h, 0.04), rune, [x, y, 0.89], [0, 0, rz], null, false);
  }
  // musgo
  for (const [x, y, z, s] of [[1.5, 2.95, 0, 0.7], [-1.5, 2.95, 0.1, 0.65], [0.3, 2.7, -0.5, 0.9], [-0.8, 2.62, 0.3, 0.5], [1.0, 1.0, 0.85, 0.35]]) {
    add(chest, G.ico(s, 0), moss, [x, y, z], [0, rnd(0, 3), 0], [1.2, 0.3, 1.1]);
  }
  for (let i = 0; i < 9; i++) {
    const x = rnd(-1.3, 1.3), len = rnd(0.25, 0.6);
    add(chest, G.box(0.06, len, 0.06), mossL, [x, 2.6 - len / 2, 0.9 + rnd(-0.03, 0.03)], [0, 0, rnd(-0.15, 0.15)], null, false);
  }
  for (let i = 0; i < 6; i++) tuft(chest, m, 0x7ac040, [rnd(-1.2, 1.2), 2.62, rnd(-0.5, 0.3)], [rnd(-0.3, 0.3), 1, rnd(-0.3, 0.3)], 0.05, rnd(0.2, 0.4));
  // cabeça
  P.head = grp(chest, 0, 2.6, 0.35, 'head');
  const hi = grp(P.head);
  hi.rotation.x = -0.12;
  add(hi, G.box(1.1, 1.0, 1.0), stone, [0, 0.45, 0]);
  add(hi, G.box(1.22, 0.24, 0.35), stoneD, [0, 0.78, 0.4], [0.2, 0, 0]);
  add(hi, G.box(0.85, 0.3, 0.5), stoneD, [0, 0.0, 0.35]);
  for (const sg of [1, -1]) {
    add(hi, G.box(0.24, 0.11, 0.08), eyeM, [sg * 0.25, 0.55, 0.5], [0, 0, sg * -0.15], null, false);
  }
  add(hi, G.box(0.5, 0.06, 0.05), m(0x2a2620), [0, 0.12, 0.61], null, null, false);
  add(hi, G.ico(0.55, 0), moss, [0, 0.98, -0.05], null, [1.05, 0.3, 1.0]);
  // brotinho na cabeça
  add(hi, G.cyl(0.02, 0.025, 0.3, 4), m(0x5a9a30), [0.2, 1.15, 0.0]);
  for (const sg of [1, -1]) {
    const lf = add(hi, G.cone(0.06, 0.18, 4), mossL, [0.2 + sg * 0.08, 1.3, 0], [0, 0, sg * -1.0], [1, 1, 0.3]);
    lf.castShadow = true;
  }
  // braços
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const arm = grp(chest, sg * 1.65, 2.25, 0, 'arm' + s);
    const ai = grp(arm);
    ai.rotation.set(-0.15, 0, sg * 0.15);
    add(ai, jitter(G.dod(0.6), 0.08), stoneD, [0, -0.65, 0], null, [1, 1.45, 1]);
    add(ai, G.ico(0.4, 0), moss, [0, 0.35, 0], null, [1.3, 0.35, 1.3]);
    const fore = grp(ai, 0, -1.5, 0, 'foreArm' + s);
    add(fore, G.dod(0.42), stone, [0, 0, 0]);
    add(fore, G.box(1.0, 1.35, 1.0), stone, [0, -0.7, 0], [0, sg * 0.2, 0]);
    add(fore, G.box(0.06, 0.9, 0.04), rune, [sg * 0.2, -0.7, 0.52], [0, sg * 0.2, 0], null, false);
    add(fore, G.box(0.5, 0.06, 0.04), rune, [sg * 0.1, -0.35, 0.52], [0, sg * 0.2, 0], null, false);
    const hand = grp(fore, 0, -1.55, 0, 'hand' + s);
    add(hand, jitter(G.dod(0.72), 0.08), stoneD, [0, 0, 0], null, [1.1, 0.9, 1.15]);
    for (const x of [-0.35, -0.12, 0.12, 0.35]) add(hand, G.box(0.22, 0.25, 0.3), stoneL, [x, -0.3, 0.55]);
    P['arm' + s] = arm; P['foreArm' + s] = fore; P['hand' + s] = hand;
  }
  root.traverse((o) => {
    if (o.isMesh) o.receiveShadow = false;
  });
  halo.castShadow = false;
  const pivots = { ...P, core };
  root.userData.height = 6.2;
  return mergeRig({ root, pivots, core, coreLight, halo, materials: m.list, height: 6.2 });
}

// ---------------------------------------------------------------------------
// COMPANHEIRA — Lume (wisp)
// ---------------------------------------------------------------------------
export function createWisp() {
  const root = new THREE.Group();
  root.name = 'Lume';
  const orb = grp(root, 0, 0, 0, 'orb');
  add(orb, G.ico(0.1, 1), makeMaterial(0xf2fdff, { basic: true }), [0, 0, 0], null, null, false);
  const glow = add(orb, G.sph(0.2, 10, 8), makeMaterial(0x8fe0ff, { basic: true, additive: true, opacity: 0.35 }), [0, 0, 0], null, null, false);
  const glow2 = add(orb, G.sph(0.32, 10, 8), makeMaterial(0x6ac8ff, { basic: true, additive: true, opacity: 0.12 }), [0, 0, 0], null, null, false);
  glow.renderOrder = 3; glow2.renderOrder = 3;
  const wingMat = makeMaterial(0xc8f4ff, { basic: true, additive: true, opacity: 0.55, side: DS });
  const wings = [];
  const pivots = { orb };
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const w = grp(orb, sg * 0.06, 0.05, -0.03, 'wing' + s);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.08 * sg, 0.14, 0.24 * sg, 0.16, 0.22 * sg, 0.06);
    shape.bezierCurveTo(0.2 * sg, -0.01, 0.08 * sg, -0.02, 0, 0);
    const lower = new THREE.Shape();
    lower.moveTo(0, 0);
    lower.bezierCurveTo(0.1 * sg, -0.02, 0.16 * sg, -0.1, 0.1 * sg, -0.12);
    lower.bezierCurveTo(0.05 * sg, -0.12, 0.02 * sg, -0.05, 0, 0);
    const wm = add(w, new THREE.ShapeGeometry([shape, lower], 6), wingMat, [0, 0, 0], [0, sg * 0.5, 0], null, false);
    wm.renderOrder = 3;
    wings.push(w);
    pivots['wing' + s] = w;
  }
  const light = new THREE.PointLight(0x9fe8ff, 3, 8, 2);
  root.add(light);
  return { root, light, wings, pivots, glow };
}

// ---------------------------------------------------------------------------
// CENÁRIO — vegetação e rochas (geometria fundida e cacheada)
// ---------------------------------------------------------------------------
function buildOak() {
  const g = new THREE.Group();
  const bark = M(0x6e4a2a);
  const leafA = M(pick([0x4fae3a, 0x5cbf45, 0x47a336]));
  const leafB = M(pick([0x3b8f30, 0x438f2a]));
  const h = rnd(2.2, 2.9);
  add(g, G.cyl(0.22, 0.34, h, 7), bark, [0, h / 2, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rnd(-0.3, 0.3);
    const rt = add(g, G.cone(0.14, 0.7, 5), bark, [Math.cos(a) * 0.3, 0.15, Math.sin(a) * 0.3]);
    orient(rt, Math.cos(a), -0.5, Math.sin(a));
  }
  for (let i = 0; i < 2; i++) {
    const a = rnd(0, TAU);
    const br = add(g, G.cyl(0.07, 0.11, 1.2, 5), bark, [Math.cos(a) * 0.35, h - 0.3, Math.sin(a) * 0.35]);
    orient(br, Math.cos(a), 1, Math.sin(a));
  }
  const R = rnd(1.5, 1.85);
  add(g, jitter(G.ico(R, 1), 0.12), leafA, [0, h + R * 0.55, 0], [0, rnd(0, 3), 0], [1, 0.85, 1]);
  const n = 3 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.4, 0.4);
    const rr = R * rnd(0.5, 0.7);
    add(g, jitter(G.ico(rr, 0), 0.08), i % 2 ? leafB : leafA, [Math.cos(a) * R * 0.75, h + rnd(0.1, 1.2), Math.sin(a) * R * 0.75], [rnd(0, 3), rnd(0, 3), 0]);
  }
  return g;
}

function buildPine() {
  const g = new THREE.Group();
  const bark = M(0x5e3d22);
  const ca = M(pick([0x2d7a46, 0x2f8048])), cb = M(pick([0x266b3d, 0x2a6e40]));
  add(g, G.cyl(0.16, 0.26, 1.7, 6), bark, [0, 0.85, 0]);
  const tiers = 4;
  const s = rnd(0.9, 1.15);
  for (let k = 0; k < tiers; k++) {
    const r = (1.7 - k * 0.36) * s, h = 1.6 * s;
    add(g, G.cone(r, h, 8), k % 2 ? cb : ca, [0, (1.2 + k * 1.05) * s + h / 2, 0], [0, rnd(0, 1), 0]);
  }
  return g;
}

function buildGiantTree() {
  const g = new THREE.Group();
  const bark = M(0x5b3b22), barkD = M(0x48301c);
  const ca = M(0x2f6b2e), cb = M(0x3a7d33), cc = M(0x285f2a), mossM = M(0x4f8a2e), vine = M(0x3f7a30);
  const H = rnd(8.5, 10);
  add(g, jitter(G.cyl(0.95, 1.55, H, 9), 0.08), bark, [0, H / 2, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rnd(-0.2, 0.2);
    const rt = add(g, G.cone(0.55, 3.0, 5), i % 2 ? bark : barkD, [Math.cos(a) * 1.6, 0.55, Math.sin(a) * 1.6]);
    orient(rt, Math.cos(a), -0.45, Math.sin(a));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rnd(-0.4, 0.4);
    const br = add(g, G.cyl(0.25, 0.45, 4.0, 6), bark, [Math.cos(a) * 1.4, H - 1.0, Math.sin(a) * 1.4]);
    orient(br, Math.cos(a), 0.9, Math.sin(a));
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd(0, TAU), y = rnd(1.5, H - 2);
    add(g, G.ico(0.6, 0), mossM, [Math.cos(a) * 1.2, y, Math.sin(a) * 1.2], null, [1, 1.3, 0.4]).lookAt(0, y, 0);
  }
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * TAU + rnd(-0.3, 0.3);
    const rr = rnd(3.0, 4.2), d = i === 0 ? 0 : rnd(2.5, 3.6);
    add(g, jitter(G.ico(rr, 1), 0.25), [ca, cb, cc][i % 3], [Math.cos(a) * d, H + rnd(1.5, 3.2), Math.sin(a) * d], [0, rnd(0, 3), 0], [1, 0.75, 1]);
  }
  add(g, jitter(G.ico(3.6, 1), 0.25), ca, [0, H + 4.2, 0], null, [1, 0.8, 1]);
  for (let i = 0; i < 10; i++) {
    const a = rnd(0, TAU), d = rnd(2.5, 5.5), len = rnd(1.5, 3.2);
    add(g, G.box(0.07, len, 0.07), vine, [Math.cos(a) * d, H + 0.5 - len / 2, Math.sin(a) * d]);
  }
  return g;
}

export function createTree(variant = 0) {
  const v = ((variant | 0) % 3 + 3) % 3;
  const builders = [buildOak, buildPine, buildGiantTree];
  const parts = variant_cached('tree' + v, v === 2 ? 3 : 4, builders[v]);
  const g = instFromParts(parts, true, true);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'tree';
  g.userData.variant = v;
  g.userData.radius = [0.4, 0.3, 1.6][v];
  return g;
}

function variant_cached(key, max, build) {
  return variant(key, max, build);
}

export function createRock(size = 1) {
  const parts = variant('rock', 6, () => {
    const g = new THREE.Group();
    const grey = M(pick([0x8d9097, 0x9a9690, 0x7f848c]));
    add(g, jitter(G.dod(0.7, 0), 0.14), grey, [0, 0.28, 0], [rnd(0, 1), rnd(0, 3), 0], [1.2, 0.75, 1]);
    if (Math.random() < 0.6) add(g, jitter(G.dod(0.35, 0), 0.08), grey, [rnd(0.5, 0.75), 0.12, rnd(-0.4, 0.4)], [rnd(0, 3), rnd(0, 3), 0]);
    if (Math.random() < 0.5) add(g, G.ico(0.42, 0), M(0x5a9a3a), [rnd(-0.15, 0.15), 0.72, 0], null, [1.1, 0.25, 0.9]);
    return g;
  });
  const g = instFromParts(parts, true, true);
  g.scale.setScalar(size);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'rock';
  g.userData.radius = 0.85 * size;
  return g;
}

export function createBush() {
  const parts = variant('bush', 4, () => {
    const g = new THREE.Group();
    const a = M(0x3f9b3a), b = M(0x4aad40), c = M(0x358a32);
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.3, 0.3), d = i === 0 ? 0 : rnd(0.3, 0.45);
      add(g, jitter(G.ico(rnd(0.38, 0.55), 0), 0.05), [a, b, c][i % 3], [Math.cos(ang) * d, rnd(0.35, 0.55), Math.sin(ang) * d], [rnd(0, 3), rnd(0, 3), 0]);
    }
    if (Math.random() < 0.5) {
      const berry = M(pick([0xe0303a, 0x6040d0]));
      for (let i = 0; i < 6; i++) {
        const ang = rnd(0, TAU);
        add(g, G.sph(0.05, 5, 4), berry, [Math.cos(ang) * 0.5, rnd(0.4, 0.8), Math.sin(ang) * 0.5]);
      }
    }
    return g;
  });
  const g = instFromParts(parts, true, true);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'bush';
  return g;
}

export function createGrassTuft() {
  const parts = variant('grass', 5, () => {
    const g = new THREE.Group();
    const a = M(0x6cc04a), b = M(0x5aad3e), c = M(0x7fd458);
    const n = 6 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.3, 0.3);
      const h = rnd(0.35, 0.6), d = rnd(0.02, 0.12);
      const bl = add(g, G.cone(0.045, h, 3), [a, b, c][i % 3], [Math.cos(ang) * d, 0, Math.sin(ang) * d]);
      orient(bl, Math.cos(ang) * 0.35, 1, Math.sin(ang) * 0.35);
      bl.position.add(new THREE.Vector3(Math.cos(ang) * 0.35, 1, Math.sin(ang) * 0.35).normalize().multiplyScalar(h / 2));
    }
    return g;
  });
  const g = instFromParts(parts, false, false);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'grass';
  return g;
}

export function createFlower() {
  const parts = variant('flower', 10, () => {
    const g = new THREE.Group();
    const petal = M(pick([0xff5a7a, 0xffd23f, 0xb07aff, 0xffffff, 0x5ab0ff, 0xff8a3a]));
    const stemM = M(0x4a9a35);
    const h = rnd(0.25, 0.38);
    add(g, G.cyl(0.012, 0.016, h, 4), stemM, [0, h / 2, 0]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      add(g, G.sph(0.045, 5, 4), petal, [Math.cos(a) * 0.045, h, Math.sin(a) * 0.045], [0, -a, 0], [1, 0.35, 0.6]);
    }
    add(g, G.sph(0.028, 5, 4), M(0xffc020), [0, h + 0.01, 0]);
    for (const sg of [1, -1]) add(g, G.cone(0.03, 0.12, 3), stemM, [sg * 0.04, h * 0.35, 0], [0, 0, sg * -1.0], [1, 1, 0.3]);
    return g;
  });
  const g = instFromParts(parts, false, false);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'flower';
  return g;
}

// ---------------------------------------------------------------------------
// CONSTRUÇÕES
// ---------------------------------------------------------------------------
function buildWindow(parent, x, y, z, ry, trim, shutter) {
  const w = grp(parent, x, y, z);
  w.rotation.y = ry;
  add(w, G.box(0.9, 0.85, 0.08), M(0x2c4470), [0, 0, 0.02]);
  add(w, G.box(1.05, 0.1, 0.16), trim, [0, 0.47, 0.05]);
  add(w, G.box(1.1, 0.1, 0.28), trim, [0, -0.47, 0.1]);
  for (const sg of [1, -1]) {
    add(w, G.box(0.1, 0.9, 0.14), trim, [sg * 0.5, 0, 0.05]);
    add(w, G.box(0.42, 0.9, 0.05), shutter, [sg * 0.75, 0, 0.06]);
    add(w, G.box(0.3, 0.05, 0.06), M(0x3a2a1a), [sg * 0.75, 0.2, 0.09]);
    add(w, G.box(0.3, 0.05, 0.06), M(0x3a2a1a), [sg * 0.75, -0.2, 0.09]);
  }
  add(w, G.box(0.06, 0.85, 0.1), trim, [0, 0, 0.05]);
  add(w, G.box(0.9, 0.06, 0.1), trim, [0, 0, 0.05]);
  return w;
}

function buildHouse(v) {
  const g = new THREE.Group();
  const pal = [
    { wall: 0xf2e4c4, roof: 0xc8462f, roofDark: 0xa3341f, trim: 0x6b4423, shutter: 0x3f7fbf },
    { wall: 0xe9d6a0, roof: 0x3d6fb8, roofDark: 0x2d5592, trim: 0x5a3a20, shutter: 0xc84b3a },
    { wall: 0xf4e8e0, roof: 0x5e9a3a, roofDark: 0x4a7d2c, trim: 0x70482a, shutter: 0xe0a030 },
  ][v];
  const stone = M(0x9c958a), wall = M(pal.wall), trim = M(pal.trim), roof = M(pal.roof), roofD = M(pal.roofDark);
  const shutter = M(pal.shutter), door = M(0x8b5a2b), bronze = M(0xc98f3a);
  const W = 6, D = 6, base = 0.45, wallH = 2.8, top = base + wallH;
  add(g, G.box(W + 0.4, base, D + 0.4), stone, [0, base / 2, 0]);
  add(g, G.box(W, wallH, D), wall, [0, base + wallH / 2, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, G.box(0.3, wallH, 0.3), trim, [sx * W / 2, base + wallH / 2, sz * D / 2]);
  for (const sz of [-1, 1]) {
    add(g, G.box(W + 0.1, 0.22, 0.22), trim, [0, top - 0.11, sz * D / 2]);
    add(g, G.box(W + 0.1, 0.18, 0.2), trim, [0, base + 0.1, sz * D / 2]);
  }
  for (const sx of [-1, 1]) {
    add(g, G.box(0.22, 0.22, D + 0.1), trim, [sx * W / 2, top - 0.11, 0]);
    add(g, G.box(0.2, 0.18, D + 0.1), trim, [sx * W / 2, base + 0.1, 0]);
    for (const sz of [-1, 1]) add(g, G.box(0.14, 2.6, 0.14), trim, [sx * (W / 2 + 0.02), base + wallH / 2, sz * 1.7], [sz * sx * 0.0 + sz * 0.55, 0, 0]);
  }
  // sótão (prisma) e telhado de duas águas com cumeeira ao longo de Z
  const rise = 2.3;
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2, 0); tri.lineTo(W / 2, 0); tri.lineTo(0, rise); tri.closePath();
  const gab = new THREE.ExtrudeGeometry(tri, { depth: D, bevelEnabled: false });
  gab.translate(0, 0, -D / 2);
  add(g, gab, wall, [0, top, 0]);
  const ov = 0.55;
  const alpha = Math.atan2(rise, W / 2);
  const L = (W / 2 + ov) / Math.cos(alpha) + 0.1;
  const run = W / 2 + ov;
  for (const sx of [1, -1]) {
    const nx = Math.sin(alpha) * sx, ny = Math.cos(alpha);
    const cx = (sx * run) / 2 + nx * 0.12 - sx * 0.05;
    const cy = top + rise - (run / 2) * Math.tan(alpha) + ny * 0.12;
    add(g, G.box(L, 0.24, D + 0.9), roof, [cx, cy, 0], [0, 0, -sx * alpha]);
    for (const t of [0.22, 0.44, 0.66, 0.88]) {
      const px = sx * Math.cos(alpha) * t * L + nx * 0.25;
      const py = top + rise - Math.sin(alpha) * t * L + ny * 0.25;
      add(g, G.box(0.08, 0.07, D + 0.92), roofD, [px, py, 0], [0, 0, -sx * alpha]);
    }
  }
  add(g, G.box(0.36, 0.36, D + 1.0), roofD, [0, top + rise + 0.1, 0], [0, 0, PI / 4]);
  // janela redonda no frontão
  add(g, G.cyl(0.36, 0.36, 0.1, 8), M(0x2c4470), [0, top + 0.85, D / 2 + 0.02], [PI / 2, 0, 0]);
  add(g, G.tor(0.38, 0.07, 4, 8), trim, [0, top + 0.85, D / 2 + 0.06]);
  // porta
  add(g, G.box(1.45, 2.25, 0.16), trim, [0, base + 1.1, D / 2 + 0.04]);
  add(g, G.box(1.1, 2.0, 0.12), door, [0, base + 1.0, D / 2 + 0.08]);
  for (const x of [-0.28, 0.0, 0.28]) add(g, G.box(0.03, 1.9, 0.02), M(0x6a4220), [x, base + 1.0, D / 2 + 0.145]);
  add(g, G.sph(0.06, 6, 4), bronze, [0.38, base + 1.0, D / 2 + 0.17]);
  add(g, G.box(1.7, 0.28, 0.75), stone, [0, 0.14, D / 2 + 0.55]);
  add(g, G.box(1.9, 0.1, 0.9), roof, [0, base + 2.45, D / 2 + 0.4], [0.35, 0, 0]);
  for (const sx of [-1, 1]) add(g, G.box(0.08, 0.5, 0.08), trim, [sx * 0.85, base + 2.2, D / 2 + 0.3], [-0.6, 0, 0]);
  // janelas
  for (const sx of [-1, 1]) {
    buildWindow(g, sx * 1.95, base + 1.45, D / 2, 0, trim, shutter);
    const fb = grp(g, sx * 1.95, base + 0.88, D / 2 + 0.2);
    add(fb, G.box(1.0, 0.2, 0.25), M(0x8a5a2b), [0, 0, 0]);
    for (let i = 0; i < 4; i++) add(fb, G.sph(0.07, 5, 4), M(pick([0xff5a7a, 0xffd23f, 0xb07aff, 0xffffff])), [-0.36 + i * 0.24, 0.14, 0]);
    buildWindow(g, sx * W / 2, base + 1.45, 0, sx * PI / 2, trim, shutter);
  }
  buildWindow(g, 0, base + 1.45, -D / 2, PI, trim, shutter);
  // chaminé / extras por variante
  if (v !== 2) {
    const cx = v === 0 ? 1.6 : -1.6;
    add(g, G.box(0.7, 2.4, 0.7), stone, [cx, top + 1.5, -1.3]);
    add(g, G.box(0.85, 0.15, 0.85), M(0x7a746a), [cx, top + 2.75, -1.3]);
  }
  if (v === 0 || v === 2) {
    const bx = v === 0 ? 1.2 : -1.3;
    add(g, G.cyl(0.32, 0.32, 0.8, 9), M(0x9a6a3a), [bx, 0.4 + base * 0 + 0.0, D / 2 + 0.75]);
    for (const y of [0.15, 0.65]) add(g, G.cyl(0.335, 0.335, 0.06, 9), M(0x4a4a50), [bx, y, D / 2 + 0.75]);
  }
  if (v === 2) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) {
      add(g, G.cyl(0.16, 0.16, 1.4, 7), M(j % 2 ? 0x8a5a30 : 0x9a6a3a), [W / 2 + 0.35 + i * 0.0, 0.18 + i * 0.3, -1.6 + j * 0.34 + i * 0.17], [PI / 2, 0, 0]);
    }
  }
  if (v === 1) {
    add(g, G.box(0.6, 0.6, 0.6), M(0xa0703e), [-1.4, 0.3, D / 2 + 0.75], [0, 0.3, 0]);
    add(g, G.box(0.45, 0.45, 0.45), M(0xb08048), [-1.45, 0.82, D / 2 + 0.75], [0, -0.2, 0]);
  }
  return g;
}

export function createHouse(variant = 0) {
  const v = ((variant | 0) % 3 + 3) % 3;
  const parts = variant_cached('house' + v, 1, () => buildHouse(v));
  const g = instFromParts(parts, true, true);
  g.userData.kind = 'house';
  g.userData.size = { w: 6, d: 6 };
  g.userData.collider = { minX: -3.2, maxX: 3.2, minZ: -3.2, maxZ: 3.2 };
  return g;
}

// Cerca ao longo do eixo X, centralizada na origem (de -length/2 a +length/2).
export function createFence(length = 4) {
  length = Math.max(0.5, length);
  const g = new THREE.Group();
  const post = M(0x8a5f33), rail = M(0xa2733f);
  const n = Math.max(2, Math.ceil(length / 1.6) + 1);
  const sp = length / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + i * sp;
    add(g, G.box(0.14, 1.0, 0.14), post, [x, 0.5, 0], [0, rnd(-0.1, 0.1), rnd(-0.03, 0.03)]);
    add(g, G.cone(0.11, 0.18, 4), post, [x, 1.09, 0], [0, PI / 4, 0]);
  }
  for (const y of [0.45, 0.8]) add(g, G.box(length + 0.1, 0.1, 0.05), rail, [0, y, 0.09]);
  const out = bake(g, true, true);
  out.userData.kind = 'fence';
  out.userData.length = length;
  out.userData.axis = 'x';
  return out;
}

export function createWell() {
  const parts = variant_cached('well', 1, () => {
    const g = new THREE.Group();
    const stone = M(0x9a958c), wood = M(0x8a5f33), roof = M(0xb8452f);
    const ring = new THREE.LatheGeometry([
      new THREE.Vector2(1.0, 0), new THREE.Vector2(1.0, 0.85), new THREE.Vector2(0.75, 0.85),
      new THREE.Vector2(0.75, 0), new THREE.Vector2(1.0, 0),
    ], 10);
    add(g, ring, stone, [0, 0, 0]);
    add(g, G.tor(0.88, 0.1, 4, 10), M(0x8a857c), [0, 0.88, 0], [PI / 2, 0, 0]);
    add(g, new THREE.CircleGeometry(0.76, 10), M(0x2f6fa8), [0, 0.55, 0], [-PI / 2, 0, 0]);
    for (const sx of [-1, 1]) add(g, G.box(0.15, 2.2, 0.15), wood, [sx * 0.9, 1.1, 0]);
    add(g, G.cyl(0.06, 0.06, 2.0, 6), wood, [0, 1.75, 0], [0, 0, PI / 2]);
    add(g, G.box(0.05, 0.3, 0.05), wood, [1.05, 1.62, 0]);
    for (const sz of [-1, 1]) add(g, G.box(2.5, 0.08, 0.95), roof, [0, 2.32, sz * 0.38], [sz * 0.62, 0, 0]);
    add(g, G.box(2.6, 0.1, 0.1), M(0x7a3426), [0, 2.62, 0]);
    add(g, G.cyl(0.012, 0.012, 0.5, 4), M(0xc8b080), [0, 1.45, 0]);
    add(g, G.cyl(0.14, 0.11, 0.22, 7), wood, [0, 1.12, 0]);
    add(g, G.cyl(0.145, 0.145, 0.03, 7), M(0x4a4a50), [0, 1.18, 0]);
    return g;
  });
  const g = instFromParts(parts, true, true);
  g.userData.kind = 'well';
  g.userData.radius = 1.05;
  return g;
}

export function createSign() {
  const parts = variant_cached('sign', 1, () => {
    const g = new THREE.Group();
    const wood = M(0x8a5f33), board = M(0xc79a5b), dark = M(0x5a3a1a);
    add(g, G.box(0.12, 1.4, 0.12), wood, [0, 0.7, 0]);
    add(g, G.box(1.1, 0.56, 0.07), board, [0, 1.25, 0.08]);
    add(g, G.box(1.16, 0.06, 0.09), wood, [0, 1.55, 0.08]);
    add(g, G.box(1.16, 0.06, 0.09), wood, [0, 0.95, 0.08]);
    for (const z of [0.12, 0.04]) {
      for (let i = 0; i < 3; i++) add(g, G.box(i === 1 ? 0.55 : 0.75, 0.04, 0.01), dark, [i === 1 ? -0.08 : 0, 1.38 - i * 0.13, z === 0.12 ? 0.118 : 0.04], null, null, false);
    }
    add(g, G.cone(0.08, 0.12, 4), wood, [0, 1.47 + 0.15, 0], [0, PI / 4, 0]);
    return g;
  });
  const g = instFromParts(parts, true, true);
  g.userData.kind = 'sign';
  return g;
}

export function createTorch() {
  const root = new THREE.Group();
  const parts = variant_cached('torch', 1, () => {
    const g = new THREE.Group();
    const iron = M(0x3a3a40);
    add(g, G.cyl(0.22, 0.28, 0.14, 7), M(0x8a857c), [0, 0.07, 0]);
    add(g, G.cyl(0.05, 0.07, 1.4, 6), iron, [0, 0.75, 0]);
    add(g, G.cyl(0.21, 0.1, 0.18, 8), iron, [0, 1.5, 0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4;
      add(g, G.cone(0.03, 0.14, 3), iron, [Math.cos(a) * 0.2, 1.64, Math.sin(a) * 0.2]);
    }
    add(g, G.ico(0.13, 0), M(0x5a1a0a, { emissive: 0xff4010, ei: 0.8 }), [0, 1.57, 0], null, [1, 0.5, 1]);
    return g;
  });
  instFromParts(parts, true, true, root);
  const flame = grp(root, 0, 1.6, 0, 'flame');
  add(flame, G.cone(0.14, 0.45, 6), makeMaterial(0xff7b1c, { basic: true, additive: true, opacity: 0.9 }), [0, 0.2, 0], null, null, false);
  add(flame, G.cone(0.08, 0.3, 6), makeMaterial(0xffe27a, { basic: true }), [0, 0.13, 0], null, null, false);
  const light = new THREE.PointLight(0xffa04a, 12, 14, 2);
  light.position.set(0, 1.9, 0);
  root.add(light);
  root.userData.kind = 'torch';
  root.userData.flame = flame;
  return { root, light, flame };
}

// Ponte ao longo do eixo Z, centralizada; topo do piso em y = 0, largura 3 (x de -1.5 a 1.5).
export function createBridge(length = 10) {
  length = Math.max(2, length);
  const g = new THREE.Group();
  const pa = M(0xa0703e), pb = M(0x946638), beam = M(0x6e4a2a), rope = M(0xc8b080);
  const n = Math.max(2, Math.floor(length / 0.32));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    add(g, G.box(3.0 + rnd(-0.1, 0.1), 0.1, step * 0.9), i % 2 ? pa : pb, [rnd(-0.04, 0.04), -0.05 + rnd(-0.015, 0.0), -length / 2 + (i + 0.5) * step], [0, rnd(-0.02, 0.02), 0]);
  }
  for (const x of [-1.2, 0, 1.2]) add(g, G.box(0.2, 0.25, length), beam, [x, -0.22, 0]);
  const np = Math.max(2, Math.round(length / 2) + 1);
  for (let i = 0; i < np; i++) {
    const z = -length / 2 + (i / (np - 1)) * length;
    for (const sx of [-1, 1]) {
      add(g, G.box(0.14, 1.25, 0.14), beam, [sx * 1.45, 0.5, z]);
      add(g, G.cone(0.1, 0.15, 4), beam, [sx * 1.45, 1.2, z], [0, PI / 4, 0]);
      if (i === 0 || i === np - 1) add(g, G.box(0.3, 2.2, 0.3), beam, [sx * 1.3, -1.2, z]);
    }
  }
  for (const sx of [-1, 1]) {
    add(g, G.box(0.1, 0.1, length), pa, [sx * 1.45, 1.0, 0]);
    add(g, G.cyl(0.025, 0.025, length, 4), rope, [sx * 1.45, 0.55, 0], [PI / 2, 0, 0]);
  }
  const out = bake(g, true, true);
  out.userData.kind = 'bridge';
  out.userData.length = length;
  out.userData.width = 3;
  out.userData.axis = 'z';
  return out;
}

// ---------------------------------------------------------------------------
// BAÚ, PORTA, GRADE
// ---------------------------------------------------------------------------
export function createChest() {
  const root = new THREE.Group();
  const wood = M(0x8a5a2b), woodD = M(0x6a4220), gold = M(0xd4a63a, { emissive: 0x3a2a00, ei: 0.5 });
  const W = 1.0, H = 0.5, Dp = 0.65;
  const base = new THREE.Group();
  add(base, G.box(W, H, Dp), wood, [0, H / 2, 0]);
  for (const y of [0.04, H - 0.03]) add(base, G.box(W + 0.02, 0.06, Dp + 0.02), woodD, [0, y, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(base, G.box(0.08, H + 0.01, 0.08), gold, [sx * (W / 2 - 0.02), H / 2, sz * (Dp / 2 - 0.02)]);
  add(base, G.box(0.18, 0.2, 0.04), gold, [0, H - 0.1, Dp / 2 + 0.01]);
  add(base, G.box(0.04, 0.07, 0.02), M(0x2a1a0a), [0, H - 0.12, Dp / 2 + 0.035]);
  add(base, G.box(W - 0.08, 0.02, Dp - 0.08), M(0x2a1a0e), [0, H - 0.005, 0]);
  bake(base, true, true, root);
  const lid = grp(root, 0, H, -Dp / 2, 'lid');
  const lidRaw = new THREE.Group();
  const lr = Dp / 2;
  add(lidRaw, G.cyl(lr, lr, W, 8, false, 0, PI), wood, [0, 0, lr], [0, 0, PI / 2]);
  for (const x of [-W / 2 + 0.04, 0, W / 2 - 0.04]) add(lidRaw, G.cyl(lr + 0.015, lr + 0.015, 0.07, 8, false, 0, PI), gold, [x, 0, lr], [0, 0, PI / 2]);
  add(lidRaw, G.box(0.14, 0.12, 0.04), gold, [0, 0.0, Dp + 0.01]);
  add(lidRaw, G.box(W - 0.02, 0.03, Dp - 0.02), woodD, [0, 0.015, lr]);
  bake(lidRaw, true, true, lid);
  root.userData.kind = 'chest';
  return { root, lid };
}

// Painel de porta de pedra do templo: largura w (X), altura h (Y), base em y=0, espessura 0.5.
export function createDoor(w = 4, h = 5) {
  const g = new THREE.Group();
  const stone = M(0x8a8476), stoneL = M(0xa59e8e), dark = M(0x3a3630);
  const runeMat = makeMaterial(0x2a8a7a, { emissive: 0x2ad0b0, ei: 0.6 });
  const T = 0.5;
  add(g, G.box(w, h, T), stone, [0, h / 2, 0]);
  for (const sz of [1, -1]) {
    const z = sz * (T / 2 + 0.03);
    add(g, G.box(w, 0.2, 0.06), stoneL, [0, h - 0.1, z]);
    add(g, G.box(w, 0.2, 0.06), stoneL, [0, 0.1, z]);
    for (const sx of [-1, 1]) add(g, G.box(0.2, h, 0.06), stoneL, [sx * (w / 2 - 0.1), h / 2, z]);
    add(g, G.box(0.05, h * 0.92, 0.07), dark, [0, h / 2, z]);
    const er = Math.min(w, h) * 0.2;
    const cy = h * 0.58;
    const rz = sz * (T / 2 + 0.05);
    add(g, G.tor(er, 0.06, 4, 16), runeMat, [0, cy, rz], sz < 0 ? [0, PI, 0] : null);
    add(g, G.box(0.09, er * 1.5, 0.05), runeMat, [0, cy - er * 0.1, rz]);
    for (const sx of [-1, 1]) {
      add(g, G.box(0.07, er * 0.6, 0.05), runeMat, [sx * er * 0.25, cy + er * 0.35, rz], [0, 0, -sx * 0.7]);
      add(g, G.box(0.07, er * 0.7, 0.05), runeMat, [sx * er * 0.3, cy - er * 0.75, rz], [0, 0, sx * 0.6]);
      add(g, G.box(0.07, er * 0.5, 0.05), runeMat, [sx * er * 0.55, cy - er * 1.15, rz], [0, 0, sx * 1.2]);
    }
    for (let i = 0; i < 5; i++) add(g, G.box(0.18, 0.18, 0.05), runeMat, [-w * 0.3 + i * w * 0.15, h * 0.15, rz], [0, 0, PI / 4]);
  }
  const out = bake(g, true, true);
  out.userData.kind = 'door';
  out.userData.runeMaterial = runeMat;
  out.userData.size = { w, h, d: T };
  return out;
}

// Grade trancada: barras de ferro, largura w (X), altura h, base em y=0. userData.lock = cadeado (pode ser escondido).
export function createGate(w = 3, h = 3.5) {
  const g = new THREE.Group();
  const iron = M(0x4b4f58), ironL = M(0x6a6f7a);
  const n = Math.max(3, Math.round(w / 0.3));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.12 + (i / (n - 1)) * (w - 0.24);
    add(g, G.cyl(0.045, 0.045, h, 6), iron, [x, h / 2, 0]);
    add(g, G.cone(0.07, 0.22, 4), ironL, [x, h + 0.1, 0]);
  }
  for (const y of [0.25, h * 0.5, h * 0.9]) add(g, G.box(w, 0.12, 0.1), ironL, [0, y, 0]);
  const out = bake(g, true, true);
  const lock = grp(out, 0, h * 0.5, 0, 'lock');
  const bronze = M(0xb8862f, { emissive: 0x2a1a00, ei: 0.5 });
  add(lock, G.box(0.4, 0.45, 0.25), bronze, [0, 0, 0]);
  add(lock, G.tor(0.12, 0.035, 5, 8, PI), M(0x8a8f99), [0, 0.22, 0]);
  for (const sz of [1, -1]) {
    add(lock, G.cyl(0.04, 0.04, 0.02, 6), M(0x1a1410), [0, 0.05, sz * 0.13], [PI / 2, 0, 0], null, false);
    add(lock, G.box(0.03, 0.09, 0.02), M(0x1a1410), [0, -0.03, sz * 0.13], null, null, false);
  }
  out.userData.kind = 'gate';
  out.userData.lock = lock;
  out.userData.size = { w, h };
  return out;
}

// ---------------------------------------------------------------------------
// ITENS
// ---------------------------------------------------------------------------
let _heartGeo = null;
function heartGeometry() {
  if (_heartGeo) return _heartGeo;
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(0.35, -0.55, 1.0, -0.25, 1.0, 0.25);
  s.bezierCurveTo(1.0, 0.75, 0.45, 0.95, 0, 0.5);
  s.bezierCurveTo(-0.45, 0.95, -1.0, 0.75, -1.0, 0.25);
  s.bezierCurveTo(-1.0, -0.25, -0.35, -0.55, 0, -0.9);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2, curveSegments: 8 });
  g.center();
  _heartGeo = g;
  return g;
}

let _gemGeo = null;
function gemGeometry() {
  if (_gemGeo) return _gemGeo;
  _gemGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.22), new THREE.Vector2(0.14, 0.0), new THREE.Vector2(0.14, 0.04),
    new THREE.Vector2(0.09, 0.12), new THREE.Vector2(0, 0.12),
  ], 6);
  return _gemGeo;
}

export function createPickup(type = 'heart') {
  const root = new THREE.Group();
  const item = grp(root, 0, 0.35, 0, 'item');
  switch (type) {
    case 'gem_green':
    case 'gem_blue':
    case 'gem_red': {
      const def = {
        gem_green: [0x34e06a, 0x0f6a2a, 1.0],
        gem_blue: [0x3a86ff, 0x123c8a, 1.2],
        gem_red: [0xff3550, 0x7a0f1e, 1.45],
      }[type];
      add(item, gemGeometry(), M(def[0], { emissive: def[1], ei: 0.7 }), [0, 0, 0], null, def[2]);
      add(item, G.oct(0.03), M(0xffffff, { emissive: 0xffffff, ei: 0.6 }), [0.06 * def[2], 0.08 * def[2], 0.06 * def[2]], null, null, false);
      item.position.y = 0.3 + 0.05 * def[2];
      break;
    }
    case 'key': {
      const bronze = M(0xc98a3a, { emissive: 0x4a2a00, ei: 0.5 });
      add(item, G.tor(0.08, 0.026, 5, 10), bronze, [0, 0.17, 0]);
      add(item, G.box(0.035, 0.32, 0.035), bronze, [0, -0.04, 0]);
      add(item, G.box(0.085, 0.035, 0.035), bronze, [0.04, -0.17, 0]);
      add(item, G.box(0.065, 0.035, 0.035), bronze, [0.03, -0.1, 0]);
      add(item, G.ico(0.035, 0), M(0x3ac0ff, { emissive: 0x1060a0, ei: 0.8 }), [0, 0.17, 0]);
      item.scale.setScalar(1.4);
      item.position.y = 0.5;
      break;
    }
    case 'heart_container': {
      add(item, heartGeometry(), M(0xf4c542, { emissive: 0x6a4a00, ei: 0.6 }), [0, 0, -0.03], null, [0.34, 0.34, 0.18]);
      add(item, heartGeometry(), M(0xe8243c, { emissive: 0x5a0010, ei: 0.6 }), [0, 0.01, 0.04], null, [0.25, 0.25, 0.3]);
      add(item, G.sph(0.04, 5, 4), M(0xffffff, { emissive: 0xffffff, ei: 0.5 }), [-0.1, 0.07, 0.14], null, [1, 0.7, 0.5], false);
      for (const sx of [-1, 1]) add(item, G.oct(0.05), M(0xfff0a0, { emissive: 0xffd040, ei: 0.8 }), [sx * 0.42, 0.15, 0], null, [1, 1.6, 1]);
      item.position.y = 0.6;
      break;
    }
    case 'heart':
    default: {
      add(item, heartGeometry(), M(0xe8243c, { emissive: 0x5a0010, ei: 0.6 }), [0, 0, 0], null, [0.17, 0.17, 0.2]);
      add(item, G.sph(0.03, 5, 4), M(0xffffff, { emissive: 0xffffff, ei: 0.5 }), [-0.07, 0.05, 0.08], null, [1, 0.7, 0.5], false);
      type = 'heart';
    }
  }
  root.userData.kind = 'pickup';
  root.userData.type = type;
  root.userData.item = item;
  return root;
}

export function createPot() {
  const parts = variant_cached('pot', 1, () => {
    const g = new THREE.Group();
    const clay = M(0xc4673a), clayD = M(0x8b3e22);
    const prof = [[0.0, 0.0], [0.2, 0.0], [0.28, 0.1], [0.31, 0.24], [0.27, 0.4], [0.16, 0.5], [0.15, 0.55], [0.2, 0.6], [0.17, 0.62]];
    add(g, new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 10), clay, [0, 0, 0]);
    add(g, G.cyl(0.315, 0.315, 0.05, 10, true), clayD, [0, 0.27, 0]);
    add(g, G.cyl(0.29, 0.3, 0.025, 10, true), clayD, [0, 0.18, 0]);
    add(g, new THREE.CircleGeometry(0.16, 10), M(0x2a140a), [0, 0.56, 0], [-PI / 2, 0, 0]);
    return g;
  });
  const g = instFromParts(parts, true, true);
  g.rotation.y = rnd(0, TAU);
  g.userData.kind = 'pot';
  g.userData.radius = 0.32;
  return g;
}
