// Ecos de Valdora — inimigos, IA, combate e chefe "Guardião Musgoso".
import * as THREE from 'three';

const TAU = Math.PI * 2;
const AGGRO = 14;
const LEASH = 26;
const CULL_OUT = 92; // m: além disso o inimigo some (e não roda IA)
const CULL_IN = 86;  // m: volta a aparecer
const PLAYER_R = 0.45;

const TYPES = {
  slime:    { hp: 2, dmg: 1, radius: 0.5,  height: 0.8, speed: 3.2, walk: 1.4, aggro: AGGRO, knock: 7 },
  goblin:   { hp: 4, dmg: 2, radius: 0.55, height: 1.4, speed: 3.3, walk: 1.3, aggro: AGGRO, knock: 6, reach: 1.9, windup: 0.6, swing: 0.26, recover: 0.75 },
  skeleton: { hp: 5, dmg: 2, radius: 0.5,  height: 1.8, speed: 4.3, walk: 1.8, aggro: AGGRO + 2, knock: 5, reach: 2.0, windup: 0.42, swing: 0.22, recover: 0.55, block: 0.35 },
  bat:      { hp: 1, dmg: 1, radius: 0.4,  height: 0.6, speed: 5.5, walk: 2.0, aggro: AGGRO, knock: 7, fly: 1.5 },
  plant:    { hp: 3, dmg: 2, radius: 0.6,  height: 1.4, speed: 0,   walk: 0,   aggro: 9, knock: 0, reach: 3.0, windup: 0.45, swing: 0.22, recover: 0.85, rooted: true },
};

const BOSS = { hp: 24, radius: 1.8, height: 5.6, aggro: 20 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
const angleDiff = (a, b) => wrapAngle(b - a);
const rand = (a, b) => a + Math.random() * (b - a);

// --------------------------------------------------------------------------- geometria compartilhada
const GEO = {
  puff: new THREE.IcosahedronGeometry(0.3, 0),
  rock: new THREE.DodecahedronGeometry(0.35, 0),
  spark: new THREE.OctahedronGeometry(0.09, 0),
  ring: new THREE.RingGeometry(0.86, 1.0, 40),
  shadow: new THREE.CircleGeometry(1, 16),
  boulder: new THREE.DodecahedronGeometry(0.75, 0),
};
const MAT = {
  rock: new THREE.MeshLambertMaterial({ color: 0x7c776c, flatShading: true }),
  moss: new THREE.MeshLambertMaterial({ color: 0x4f7d35, flatShading: true }),
};

// --------------------------------------------------------------------------- modelos reserva
function lam(c, extra = {}) { return new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra }); }
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m;
}
function fallbackEnemy(type) {
  const root = new THREE.Group();
  const pivots = {};
  let height = TYPES[type]?.height || 1;
  if (type === 'slime') {
    const body = new THREE.Group(); root.add(body); pivots.body = body;
    body.add(mesh(new THREE.IcosahedronGeometry(0.5, 1), lam(0x55cc66, { transparent: true, opacity: 0.9 }), 0, 0.42, 0));
    body.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), lam(0x111111), 0.15, 0.55, 0.42));
    body.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), lam(0x111111), -0.15, 0.55, 0.42));
  } else if (type === 'bat') {
    const body = new THREE.Group(); root.add(body); pivots.body = body;
    body.add(mesh(new THREE.IcosahedronGeometry(0.22, 0), lam(0x3b2a4a), 0, 0.3, 0));
    for (const s of [1, -1]) {
      const w = new THREE.Group(); w.position.set(0.15 * s, 0.32, 0); body.add(w);
      w.add(mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3), lam(0x5a3a6a), 0.25 * s, 0, 0));
      pivots[s > 0 ? 'wingL' : 'wingR'] = w;
    }
  } else if (type === 'plant') {
    const stem = new THREE.Group(); root.add(stem); pivots.stem = stem;
    stem.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6), lam(0x3f8a2e), 0, 0.45, 0));
    const head = new THREE.Group(); head.position.y = 0.95; stem.add(head); pivots.head = head;
    head.add(mesh(new THREE.ConeGeometry(0.38, 0.5, 6), lam(0xc0304a), 0, 0.12, 0.05));
    const jaw = new THREE.Group(); head.add(jaw); pivots.jaw = jaw;
    jaw.add(mesh(new THREE.ConeGeometry(0.34, 0.3, 6), lam(0xe0d070), 0, -0.1, 0.05));
    for (let i = 0; i < 4; i++) {
      const lf = mesh(new THREE.BoxGeometry(0.5, 0.04, 0.2), lam(0x2f7a28), 0, 0.05, 0);
      lf.rotation.y = i * Math.PI / 2; lf.position.set(Math.cos(i * Math.PI / 2) * 0.25, 0.05, Math.sin(i * Math.PI / 2) * 0.25);
      root.add(lf);
    }
  } else {
    const skel = type === 'skeleton';
    const cBody = skel ? 0xe8e2d0 : 0x6f8f2f, cCloth = skel ? 0x444444 : 0x7a4a24;
    const s = skel ? 1.25 : 1;
    const torso = new THREE.Group(); torso.position.y = 0.75 * s; root.add(torso); pivots.torso = torso;
    torso.add(mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.32 * s), lam(cCloth), 0, 0.2 * s, 0));
    const head = new THREE.Group(); head.position.y = 0.5 * s; torso.add(head); pivots.head = head;
    head.add(mesh(new THREE.BoxGeometry(0.36 * s, 0.32 * s, 0.32 * s), lam(cBody), 0, 0.15 * s, 0));
    for (const sd of [1, -1]) {
      const arm = new THREE.Group(); arm.position.set(0.32 * s * sd, 0.4 * s, 0); torso.add(arm);
      arm.add(mesh(new THREE.BoxGeometry(0.12, 0.5 * s, 0.12), lam(cBody), 0, -0.25 * s, 0));
      pivots[sd > 0 ? 'armL' : 'armR'] = arm;
      const leg = new THREE.Group(); leg.position.set(0.13 * sd * s, 0.75 * s, 0); root.add(leg);
      leg.add(mesh(new THREE.BoxGeometry(0.15, 0.72 * s, 0.15), lam(cBody), 0, -0.37 * s, 0));
      pivots[sd > 0 ? 'legL' : 'legR'] = leg;
    }
    const weapon = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), lam(skel ? 0xbbbbcc : 0x5a3a1a), 0, -0.5 * s, 0.35);
    pivots.armR.add(weapon);
    height = skel ? 1.8 : 1.4;
  }
  return { root, pivots, height };
}

function fallbackBoss() {
  const root = new THREE.Group();
  const stone = lam(0x7c776c), moss = lam(0x4f7d35);
  const hips = new THREE.Group(); hips.position.y = 2.0; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(mesh(new THREE.DodecahedronGeometry(1.4, 0), stone, 0, 1.3, 0));
  torso.add(mesh(new THREE.BoxGeometry(2.4, 0.4, 1.6), moss, 0, 2.3, 0));
  const head = new THREE.Group(); head.position.y = 2.6; torso.add(head);
  head.add(mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), stone, 0, 0.4, 0.1));
  const core = mesh(new THREE.IcosahedronGeometry(0.35, 0),
    new THREE.MeshLambertMaterial({ color: 0xaaff66, emissive: 0x66ff33, emissiveIntensity: 0.4, flatShading: true }), 0, 1.3, 1.25);
  torso.add(core);
  const pivots = { torso, head, core };
  for (const sd of [1, -1]) {
    const arm = new THREE.Group(); arm.position.set(1.6 * sd, 2.1, 0); torso.add(arm);
    arm.add(mesh(new THREE.BoxGeometry(0.7, 1.8, 0.7), stone, 0, -0.9, 0));
    arm.add(mesh(new THREE.DodecahedronGeometry(0.65, 0), moss, 0, -2.0, 0));
    pivots[sd > 0 ? 'armL' : 'armR'] = arm;
    const leg = new THREE.Group(); leg.position.set(0.7 * sd, 0, 0); hips.add(leg);
    leg.add(mesh(new THREE.BoxGeometry(0.8, 2.0, 0.8), stone, 0, -1.0, 0));
    pivots[sd > 0 ? 'legL' : 'legR'] = leg;
  }
  return { root, pivots };
}

// ---------------------------------------------------------------------------
export class EnemyManager {
  constructor(scene, world, models, audio) {
    this.scene = scene;
    this.world = world;
    this.models = models;
    this.audio = audio;
    this.all = [];        // todos (inclusive noturnos inativos)
    this.list = [];       // vivos e ativos
    this.dying = [];
    this.particles = [];
    this.projectiles = [];
    this.shockwaves = [];
    this.isNight = false;
    this.time = 0;
    this.cameraShake = 0; // EXTRA: main pode ler (0..1) e tremer a câmera
    this.boss = null;
    this._onKill = null;
    this._v = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ util
  _sfx(n) { try { this.audio?.sfx?.(n); } catch (e) { /* ignore */ } }
  _ground(x, z, fb = 0) {
    try { const h = this.world?.getHeight?.(x, z); return Number.isFinite(h) ? h : fb; } catch (e) { return fb; }
  }
  _water(x, z) { try { return !!this.world?.isWater?.(x, z); } catch (e) { return false; } }
  _collide(pos, r) { try { this.world?.resolveCollision?.(pos, r); } catch (e) { /* ignore */ } }

  _collectMaterials(model, exclude) {
    const out = [];
    const push = (m) => {
      if (!m) return;
      out.push({ m, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity ?? 1, color: m.color ? m.color.clone() : null });
    };
    if (Array.isArray(model.materials) && model.materials.length) {
      for (const m of model.materials) if (m !== exclude) push(m);
      return out;
    }
    const seen = new Map();
    model.root.traverse((o) => {
      if (!o.isMesh || !o.material || o === exclude) return;
      const arr = Array.isArray(o.material);
      const mats = (arr ? o.material : [o.material]).map((m) => {
        if (!seen.has(m)) { const c = m.clone(); seen.set(m, c); push(c); }
        return seen.get(m);
      });
      o.material = arr ? mats : mats[0];
    });
    return out;
  }

  _snapshotPivots(pivots) {
    const base = {};
    for (const k in pivots) {
      const p = pivots[k];
      if (p && p.rotation) base[k] = { r: p.rotation.clone(), p: p.position.clone(), s: p.scale.clone() };
    }
    return base;
  }

  _makeEnemy(type, model, cfg, position, opts) {
    const root = model.root;
    root.position.copy(position);
    root.position.y = this._ground(position.x, position.z, position.y || 0);
    const yaw = opts.yaw ?? rand(0, TAU);
    root.rotation.y = yaw;
    const e = {
      type, root, model, position: root.position,
      radius: cfg.radius, height: model.height || cfg.height,
      hp: cfg.hp, maxHp: cfg.hp, alive: true, active: true, isBoss: false, lockable: true,
      night: !!opts.night, cfg,
      spawnPos: root.position.clone(),
      pivots: model.pivots || {},
      base: this._snapshotPivots(model.pivots || {}),
      mats: [], yaw, state: 'idle', t: 0,
      vel: new THREE.Vector3(), hitStop: 0, flashT: 0, pop: 0, lastHitId: -1,
      atkCd: rand(0.3, 1), stun: 0, phase: Math.random() * TAU,
      wander: null, wanderWait: rand(0.5, 2), squash: 0, air: 0, hopCd: rand(0.2, 1),
      hopDir: new THREE.Vector3(), hopSpeed: 0, hopY: 0, fy: cfg.fly || 0, didHit: false,
      tint: null, tintAmt: 0, _tinted: false, guardT: 0, alertT: 0,
    };
    return e;
  }

  // ------------------------------------------------------------------ API
  spawn(type, position, opts = {}) {
    if (type === 'boss') return this.spawnBoss(position);
    const cfg = TYPES[type] || TYPES.slime;
    let model = null;
    try { model = this.models?.createEnemy?.(type); } catch (err) { console.warn('[enemies] createEnemy falhou', type, err); }
    if (!model || !model.root) model = fallbackEnemy(TYPES[type] ? type : 'slime');
    const e = this._makeEnemy(type, model, cfg, position || new THREE.Vector3(), opts);
    e.mats = this._collectMaterials(model);
    if (type === 'bat') { e.fy = cfg.fly; e.state = 'hover'; }
    if (type === 'goblin' || type === 'skeleton') e.state = 'patrol';
    // (flags de sombra vêm do modelo: detalhes pequenos não projetam sombra)
    this.scene?.add?.(model.root);
    this.all.push(e);
    if (e.night && !this.isNight) this._setActive(e, false, false);
    this._rebuildList();
    return e;
  }

  spawnBoss(position) {
    let model = null;
    try { model = this.models?.createBoss?.(); } catch (err) { console.warn('[enemies] createBoss falhou', err); }
    if (!model || !model.root) model = fallbackBoss();
    const cfg = { ...BOSS, knock: 0 };
    const e = this._makeEnemy('boss', model, cfg, position || new THREE.Vector3(), { yaw: 0 });
    e.isBoss = true;
    e.name = 'Guardião Musgoso';
    e.height = BOSS.height;
    e.state = 'dormant';
    e.phase2 = false;
    e.slamsLeft = 0;
    e.walkT = 0;
    e.core = model.pivots?.core || null;
    e.coreMat = null;
    if (e.core && e.core.isMesh && e.core.material && !Array.isArray(e.core.material)) {
      e.core.material = e.core.material.clone();
      e.coreMat = e.core.material;
      e.coreBase = { e: e.coreMat.emissive ? e.coreMat.emissive.clone() : null, i: e.coreMat.emissiveIntensity ?? 1 };
      e.coreScale = e.core.scale.clone();
    }
    e.mats = this._collectMaterials(model, e.core);
    // aponta para o centro da sala / jogador ao acordar
    // (flags de sombra vêm do modelo)
    this.scene?.add?.(model.root);
    this.all.push(e);
    this.boss = e;
    this._rebuildList();
    return e;
  }

  setNight(on) {
    on = !!on;
    if (on === this.isNight) return;
    this.isNight = on;
    for (const e of this.all) if (e.night && e.alive) this._setActive(e, on, true);
    this._rebuildList();
  }

  clear(filter) {
    let fn;
    if (!filter) fn = () => true;
    else if (typeof filter === 'function') fn = filter;
    else if (typeof filter === 'string') fn = (e) => e.type === filter;
    else if (typeof filter === 'object') fn = (e) => Object.keys(filter).every((k) => e[k] === filter[k]);
    else fn = () => true;
    const keep = [];
    for (const e of this.all) {
      let match = false;
      try { match = !!fn(e); } catch (err) { match = false; }
      if (match) this._removeEnemy(e); else keep.push(e);
    }
    this.all = keep;
    this.dying = this.dying.filter((d) => {
      let match = false;
      try { match = !!fn(d.e); } catch (err) { match = false; }
      if (match) this._removeEnemy(d.e);
      return !match;
    });
    if (this.boss && !this.all.includes(this.boss) && !this.dying.some((d) => d.e === this.boss)) {
      this.boss = null;
      for (const p of this.projectiles) this._disposeProjectile(p);
      this.projectiles.length = 0;
      for (const s of this.shockwaves) { this.scene?.remove?.(s.mesh); s.mesh.material.dispose(); }
      this.shockwaves.length = 0;
    }
    this._rebuildList();
  }

  _removeEnemy(e) {
    e.alive = false;
    e.lockable = false;
    this.scene?.remove?.(e.root);
    if (!Array.isArray(e.model?.materials)) for (const m of e.mats) m.m.dispose?.();
    if (e.coreMat) e.coreMat.dispose?.();
    if (e.heldRock) { this.scene?.remove?.(e.heldRock); e.heldRock = null; }
  }

  _rebuildList() {
    this.list = this.all.filter((e) => e.alive && e.active);
  }

  _setActive(e, on, fx) {
    if (!on && e.active && fx && e.root.visible) this._puffs(e.position, 7, 0x6a4a8a, e.height * 0.5);
    e.active = on;
    e.root.visible = on;
    e.culled = false;
    e.lockable = on;
    if (on) {
      e.position.copy(e.spawnPos);
      e.hp = e.maxHp;
      e.state = e.type === 'bat' ? 'hover' : (e.type === 'goblin' || e.type === 'skeleton') ? 'patrol' : 'idle';
      e.t = 0; e.vel.set(0, 0, 0); e.flashT = 0; e.stun = 0;
      if (fx) this._puffs(e.position, 6, 0x6a4a8a, e.height * 0.5);
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, player, onKill) {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (typeof onKill === 'function') this._onKill = onKill;
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);

    let atk = null;
    try { atk = player?.getAttack?.() || null; } catch (err) { atk = null; }

    const pp = player?.position;
    for (const e of this.all) {
      if (!e.alive || !e.active) continue;
      // culling por distância: longe do herói (névoa esconde) não desenha nem roda IA,
      // a menos que esteja em perseguição. Histerese evita piscar na borda.
      if (pp && !e.isBoss) {
        const dx = e.position.x - pp.x, dz = e.position.z - pp.z;
        const d2 = dx * dx + dz * dz;
        const far = e.culled ? d2 > CULL_IN * CULL_IN : d2 > CULL_OUT * CULL_OUT;
        const culled = far && !e._aggro && !(e.alertT > 0);
        if (culled !== !!e.culled) { e.culled = culled; e.root.visible = !culled; }
        if (culled) continue;
      }
      if (atk) this._checkHit(e, atk, player);
      if (!e.alive) continue;
      if (e.hitStop > 0) {
        e.hitStop -= dt;
        this._visuals(e, dt);
        continue;
      }
      if (e.isBoss) this._bossAI(e, dt, player);
      else this._ai(e, dt, player);
      this._visuals(e, dt);
    }

    this._separate(player);
    this._updateDying(dt);
    this._updateProjectiles(dt, player);
    this._updateShockwaves(dt, player);
    this._updateParticles(dt);
    this._rebuildList();
  }

  // ------------------------------------------------------------------ dano
  _checkHit(e, atk, player) {
    if (e.lastHitId === atk.id || !atk.center) return;
    const dx = e.position.x - atk.center.x, dz = e.position.z - atk.center.z;
    const d = Math.hypot(dx, dz);
    if (d > atk.radius + e.radius) return;
    const y = atk.center.y;
    if (y < e.position.y - 0.9 || y > e.position.y + e.height + 0.9) return;
    e.lastHitId = atk.id;

    const pp = player?.position || atk.center;
    const kx = e.position.x - pp.x, kz = e.position.z - pp.z;
    const kl = Math.hypot(kx, kz) || 1;
    const hitPoint = new THREE.Vector3(e.position.x - (kx / kl) * e.radius, Math.max(e.position.y + 0.3, Math.min(y, e.position.y + e.height)), e.position.z - (kz / kl) * e.radius);

    if (e.isBoss) {
      if (e.state !== 'stuck') {
        this._sfx('block');
        this._sparks(hitPoint, 6);
        e.pop = 0.25;
        return;
      }
      e.hp -= atk.damage || 1;
      this._sfx('bossHit');
      this._sparks(hitPoint, 8, 0xc8ff80);
      e.flashT = 0.22; e.pop = 0.6; e.hitStop = 0.06;
      this.cameraShake = Math.max(this.cameraShake, 0.25);
      if (e.hp <= 0) this._kill(e);
      return;
    }

    // esqueleto às vezes bloqueia (não durante ataque, nem contra o giro)
    if (e.type === 'skeleton' && atk.kind !== 'spin' && !['windup', 'swing', 'stun'].includes(e.state)
        && Math.random() < e.cfg.block) {
      this._sfx('block');
      this._sparks(hitPoint, 5);
      e.guardT = 0.45;
      e.vel.set(kx / kl, 0, kz / kl).multiplyScalar(3);
      e.state = 'recover'; e.t = e.cfg.recover * 0.4;
      return;
    }

    e.hp -= atk.damage || 1;
    this._sfx('enemyHit');
    this._sparks(hitPoint, 5);
    e.flashT = 0.24; e.pop = 1; e.hitStop = 0.07;
    if (!e.cfg.rooted) {
      const k = (e.cfg.knock || 5) * (atk.kind === 'spin' ? 1.4 : 1) * (atk.damage > 1 ? 1.25 : 1);
      e.vel.set(kx / kl, 0, kz / kl).multiplyScalar(k);
    }
    e.alertT = 3;
    if (e.hp <= 0) { this._kill(e); return; }
    // atordoa / interrompe telegrafia
    if (e.type === 'goblin' || e.type === 'skeleton' || e.type === 'plant') {
      e.state = 'stun'; e.t = 0; e.stun = e.type === 'plant' ? 0.5 : 0.4;
    } else if (e.type === 'bat') {
      e.state = 'rise'; e.t = 0;
    } else if (e.type === 'slime') {
      e.air = 0; e.hopY = 0; e.hopCd = 0.5;
    }
  }

  _kill(e) {
    e.alive = false;
    e.lockable = false;
    e.hp = 0;
    if (e.heldRock) { this.scene?.remove?.(e.heldRock); e.heldRock = null; }
    if (e.isBoss) {
      this._sfx('bossRoar');
      this._sfx('bossHit');
      e.state = 'dying'; e.t = 0;
      e.deathBase = e.position.clone();
      for (const p of this.projectiles) this._disposeProjectile(p);
      this.projectiles.length = 0;
      this.dying.push({ e, t: 0, boss: true });
      this.cameraShake = 0.6;
    } else {
      this._sfx('enemyDie');
      this._puffs(e.position, 12, 0x7a4aa8, e.height * 0.5);
      this._sparks(this._v.copy(e.position).setY(e.position.y + e.height * 0.5), 6, 0xffffff);
      this.dying.push({ e, t: 0, boss: false });
      this._callKill(e);
    }
  }

  _callKill(e) {
    try { this._onKill?.(e); } catch (err) { console.warn('[enemies] onKill erro', err); }
  }

  _hurtPlayer(player, dmg, from, opts) {
    if (!player || typeof player.takeDamage !== 'function') return false;
    if (player.state === 'dead') return false;
    try { return !!player.takeDamage(dmg, from, opts); } catch (err) { return false; }
  }

  // ------------------------------------------------------------------ IA comum
  _ai(e, dt, player) {
    const cfg = e.cfg;
    e.t += dt;
    if (e.atkCd > 0) e.atkCd -= dt;
    if (e.alertT > 0) e.alertT -= dt;
    if (e.guardT > 0) e.guardT -= dt;
    const pp = player?.position;
    const alive = pp && player.state !== 'dead';
    let dx = 0, dz = 0, dist = 1e9;
    if (alive) { dx = pp.x - e.position.x; dz = pp.z - e.position.z; dist = Math.hypot(dx, dz); }
    const homeD = Math.hypot(e.position.x - e.spawnPos.x, e.position.z - e.spawnPos.z);
    const aggro = alive && (dist < cfg.aggro || (e.alertT > 0 && dist < cfg.aggro * 1.8)) && homeD < LEASH;
    e._dist = dist; e._aggro = aggro;
    const ox = e.position.x, oz = e.position.z;

    switch (e.type) {
      case 'slime': this._aiSlime(e, dt, player, dist, dx, dz, aggro, homeD); break;
      case 'bat': this._aiBat(e, dt, player, dist, dx, dz, aggro, homeD); break;
      case 'plant': this._aiPlant(e, dt, player, dist, dx, dz); break;
      default: this._aiMelee(e, dt, player, dist, dx, dz, aggro, homeD); break;
    }

    // knockback
    if (!cfg.rooted) {
      e.position.x += e.vel.x * dt;
      e.position.z += e.vel.z * dt;
      e.vel.multiplyScalar(Math.exp(-6 * dt));
    } else e.vel.set(0, 0, 0);

    // água e colisão
    if (e.type !== 'bat' && this._water(e.position.x, e.position.z) && !this._water(ox, oz)) {
      e.position.x = ox; e.position.z = oz; e.vel.set(0, 0, 0); e.wander = null;
    }
    if (!cfg.rooted) this._collide(e.position, e.radius);
    if (!Number.isFinite(e.position.x) || !Number.isFinite(e.position.z)) { e.position.x = ox; e.position.z = oz; }

    const g = this._ground(e.position.x, e.position.z, e.position.y);
    if (e.type === 'bat') e.position.y = g + e.fy;
    else if (e.type === 'slime') e.position.y = g + e.hopY;
    else e.position.y = g;

    e.root.rotation.y = e.yaw;
  }

  _face(e, tx, tz, rate, dt) {
    const target = Math.atan2(tx, tz);
    e.yaw += angleDiff(e.yaw, target) * (1 - Math.exp(-rate * dt));
  }

  _step(e, dirX, dirZ, speed, dt) {
    const l = Math.hypot(dirX, dirZ);
    if (l < 1e-4) return;
    e.position.x += (dirX / l) * speed * dt;
    e.position.z += (dirZ / l) * speed * dt;
  }

  _wanderTarget(e, radius) {
    const a = rand(0, TAU), r = rand(1, radius);
    return new THREE.Vector3(e.spawnPos.x + Math.cos(a) * r, 0, e.spawnPos.z + Math.sin(a) * r);
  }

  // ---- slime: pulos em direção ao jogador, dano por contato
  _aiSlime(e, dt, player, dist, dx, dz, aggro, homeD) {
    e.squash = damp(e.squash, 0, 8, dt);
    if (e.air > 0) {
      e.air -= dt;
      const p = 1 - Math.max(0, e.air) / e.airDur;
      e.hopY = 4 * 0.6 * p * (1 - p);
      e.position.x += e.hopDir.x * e.hopSpeed * dt;
      e.position.z += e.hopDir.z * e.hopSpeed * dt;
      if (e.air <= 0) {
        e.hopY = 0; e.squash = 1;
        e.hopCd = aggro ? rand(0.25, 0.55) : rand(0.9, 2.0);
      }
    } else {
      e.hopY = 0;
      e.hopCd -= dt;
      if (e.hopCd <= 0) {
        let tx, tz;
        if (aggro) { tx = dx; tz = dz; e.hopSpeed = e.cfg.speed; }
        else if (homeD > 4) { tx = e.spawnPos.x - e.position.x; tz = e.spawnPos.z - e.position.z; e.hopSpeed = e.cfg.walk * 1.4; }
        else { const a = rand(0, TAU); tx = Math.cos(a); tz = Math.sin(a); e.hopSpeed = e.cfg.walk; }
        const l = Math.hypot(tx, tz) || 1;
        e.hopDir.set(tx / l, 0, tz / l);
        e.yaw = Math.atan2(e.hopDir.x, e.hopDir.z);
        e.airDur = e.air = aggro ? 0.45 : 0.5;
        e.squash = -0.6; // estica
      }
    }
    if (aggro && dist < e.radius + PLAYER_R + 0.1 && e.atkCd <= 0) {
      e.atkCd = 1.0;
      const l = dist || 1;
      this._hurtPlayer(player, e.cfg.dmg, e.position);
      e.vel.set(-dx / l, 0, -dz / l).multiplyScalar(4);
    }
  }

  // ---- goblin / esqueleto: patrulha → persegue → telegrafa → golpe
  _aiMelee(e, dt, player, dist, dx, dz, aggro, homeD) {
    const cfg = e.cfg;
    switch (e.state) {
      case 'patrol': {
        if (aggro) { e.state = 'chase'; e.t = 0; e.alertHop = 0.25; break; }
        if (!e.wander) {
          e.wanderWait -= dt;
          if (e.wanderWait <= 0) e.wander = this._wanderTarget(e, 6);
        } else {
          const wx = e.wander.x - e.position.x, wz = e.wander.z - e.position.z;
          if (Math.hypot(wx, wz) < 0.5) { e.wander = null; e.wanderWait = rand(1, 2.5); }
          else { this._face(e, wx, wz, 6, dt); this._step(e, Math.sin(e.yaw), Math.cos(e.yaw), cfg.walk, dt); e._moving = cfg.walk; }
        }
        break;
      }
      case 'chase': {
        if (!aggro) { e.state = homeD > 2 ? 'return' : 'patrol'; e.t = 0; break; }
        this._face(e, dx, dz, 9, dt);
        if (dist > cfg.reach - 0.2) {
          const sp = e.alertHop > 0 ? 0 : cfg.speed;
          this._step(e, dx, dz, sp, dt); e._moving = sp;
        }
        if (e.alertHop > 0) e.alertHop -= dt;
        if (dist < cfg.reach && e.atkCd <= 0) { e.state = 'windup'; e.t = 0; }
        break;
      }
      case 'windup': {
        this._face(e, dx, dz, 4, dt);
        e.tint = e.type === 'skeleton' ? 0xff3322 : 0xffaa22;
        e.tintAmt = 0.25 + 0.35 * Math.abs(Math.sin(e.t * 18));
        if (e.t >= cfg.windup) { e.state = 'swing'; e.t = 0; e.didHit = false; e.tint = null; }
        break;
      }
      case 'swing': {
        this._step(e, Math.sin(e.yaw), Math.cos(e.yaw), 2.2, dt);
        if (!e.didHit && e.t > cfg.swing * 0.4) {
          e.didHit = true;
          const ang = Math.abs(angleDiff(e.yaw, Math.atan2(dx, dz)));
          if (dist < cfg.reach + 0.45 && ang < 1.25) {
            const hit = this._hurtPlayer(player, cfg.dmg, e.position);
            if (!hit && player?.state === 'block') {
              const l = dist || 1;
              e.vel.set(-dx / l, 0, -dz / l).multiplyScalar(4);
              e.state = 'stun'; e.t = 0; e.stun = 0.5;
              break;
            }
          }
        }
        if (e.t >= cfg.swing) { e.state = 'recover'; e.t = 0; }
        break;
      }
      case 'recover': {
        if (e.t >= cfg.recover) { e.state = aggro ? 'chase' : 'patrol'; e.t = 0; e.atkCd = rand(0.2, 0.6); }
        break;
      }
      case 'stun': {
        e.tint = null;
        if (e.t >= e.stun) { e.state = aggro ? 'chase' : 'patrol'; e.t = 0; e.atkCd = rand(0.3, 0.7); }
        break;
      }
      case 'return': {
        const hx = e.spawnPos.x - e.position.x, hz = e.spawnPos.z - e.position.z;
        if (Math.hypot(hx, hz) < 1) { e.state = 'patrol'; e.hp = e.maxHp; e.wander = null; break; }
        if (aggro && homeD < LEASH * 0.7) { e.state = 'chase'; break; }
        this._face(e, hx, hz, 6, dt);
        this._step(e, hx, hz, cfg.speed * 0.75, dt); e._moving = cfg.speed * 0.75;
        break;
      }
      default: e.state = 'patrol';
    }
  }

  // ---- morcego: circula e dá rasantes
  _aiBat(e, dt, player, dist, dx, dz, aggro, homeD) {
    const cfg = e.cfg;
    if (e.swoopCd === undefined) { e.swoopCd = rand(1.5, 3); e.orbitA = rand(0, TAU); }
    const pp = player?.position;
    switch (e.state) {
      case 'hover': {
        e.fy = damp(e.fy, cfg.fly + Math.sin(this.time * 2 + e.phase) * 0.25, 3, dt);
        const hx = e.spawnPos.x + Math.cos(this.time * 0.7 + e.phase) * 2 - e.position.x;
        const hz = e.spawnPos.z + Math.sin(this.time * 0.7 + e.phase) * 2 - e.position.z;
        this._step(e, hx, hz, Math.min(cfg.walk, Math.hypot(hx, hz) * 2), dt);
        this._face(e, hx, hz, 4, dt);
        if (aggro) { e.state = 'circle'; e.t = 0; }
        break;
      }
      case 'circle': {
        if (!aggro) { e.state = 'hover'; break; }
        e.orbitA += dt * 1.5;
        const tx = pp.x + Math.cos(e.orbitA) * 3.6 - e.position.x;
        const tz = pp.z + Math.sin(e.orbitA) * 3.6 - e.position.z;
        this._step(e, tx, tz, Math.min(cfg.speed, Math.hypot(tx, tz) * 3), dt);
        e.fy = damp(e.fy, 2.6, 3, dt);
        this._face(e, dx, dz, 8, dt);
        e.swoopCd -= dt;
        if (e.swoopCd <= 0) {
          e.state = 'swoop'; e.t = 0; e.didHit = false;
          const sx = dx, sz = dz, l = Math.hypot(sx, sz) || 1;
          const dur = 0.6;
          e.swoopV = new THREE.Vector3((sx / l) * (l + 1.5) / dur, 0, (sz / l) * (l + 1.5) / dur);
          e.swoopFy0 = e.fy;
          e.swoopDur = dur;
        }
        break;
      }
      case 'swoop': {
        const p = clamp(e.t / e.swoopDur, 0, 1);
        e.position.x += e.swoopV.x * dt;
        e.position.z += e.swoopV.z * dt;
        e.fy = lerp(e.swoopFy0, 0.9, Math.sin(p * Math.PI * 0.85));
        e.yaw = Math.atan2(e.swoopV.x, e.swoopV.z);
        if (!e.didHit && pp) {
          const hx = pp.x - e.position.x, hz = pp.z - e.position.z;
          const hy = (pp.y + 1.0) - e.position.y;
          if (Math.hypot(hx, hz) < 0.85 && Math.abs(hy) < 1.0) {
            e.didHit = true;
            this._hurtPlayer(player, cfg.dmg, e.position);
          }
        }
        if (p >= 1) { e.state = 'rise'; e.t = 0; }
        break;
      }
      case 'rise': {
        e.fy = damp(e.fy, 2.6, 4, dt);
        if (e.t > 0.7) { e.state = aggro ? 'circle' : 'hover'; e.t = 0; e.swoopCd = rand(1.8, 3.2); }
        break;
      }
      default: e.state = 'hover';
    }
    if (homeD > LEASH && e.state !== 'hover') e.state = 'hover';
  }

  // ---- planta: estacionária, bote quando perto
  _aiPlant(e, dt, player, dist, dx, dz) {
    const cfg = e.cfg;
    const near = dist < cfg.aggro;
    switch (e.state) {
      case 'idle':
        if (near) this._face(e, dx, dz, 5, dt);
        if (dist < cfg.reach && e.atkCd <= 0) { e.state = 'windup'; e.t = 0; }
        break;
      case 'windup':
        this._face(e, dx, dz, 7, dt);
        e.tint = 0xff4422; e.tintAmt = 0.2 + 0.3 * Math.abs(Math.sin(e.t * 20));
        if (e.t >= cfg.windup) { e.state = 'swing'; e.t = 0; e.didHit = false; e.tint = null; }
        break;
      case 'swing':
        if (!e.didHit && e.t > cfg.swing * 0.35) {
          e.didHit = true;
          const ang = Math.abs(angleDiff(e.yaw, Math.atan2(dx, dz)));
          if (dist < cfg.reach + 0.35 && ang < 1.0) this._hurtPlayer(player, cfg.dmg, e.position);
        }
        if (e.t >= cfg.swing) { e.state = 'recover'; e.t = 0; }
        break;
      case 'recover':
        if (e.t >= cfg.recover) { e.state = 'idle'; e.t = 0; e.atkCd = rand(0.2, 0.5); }
        break;
      case 'stun':
        e.tint = null;
        if (e.t >= e.stun) { e.state = 'idle'; e.t = 0; e.atkCd = 0.4; }
        break;
      default: e.state = 'idle';
    }
  }

  // ------------------------------------------------------------------ chefe
  _bossAI(e, dt, player) {
    e.t += dt;
    const pp = player?.position;
    const alive = pp && player.state !== 'dead';
    let dx = 0, dz = 0, dist = 1e9;
    if (pp) { dx = pp.x - e.position.x; dz = pp.z - e.position.z; dist = Math.hypot(dx, dz); }
    const ph2 = e.phase2;
    const speed = ph2 ? 2.1 : 1.35;
    e._moving = 0;

    if (!e.phase2 && e.hp <= e.maxHp / 2 && e.state !== 'stuck' && e.state !== 'dormant') {
      e.phase2 = true;
      e.state = 'roar'; e.t = 0;
      this._sfx('bossRoar');
      this.cameraShake = Math.max(this.cameraShake, 0.5);
    }

    switch (e.state) {
      case 'dormant':
        if (alive && dist < BOSS.aggro) { e.state = 'roar'; e.t = 0; this._sfx('bossRoar'); this.cameraShake = 0.5; }
        break;
      case 'roar':
        if (pp) this._face(e, dx, dz, 3, dt);
        if (e.t > (e.phase2 ? 1.3 : 1.8)) { e.state = 'walk'; e.t = 0; e.walkT = 0; }
        break;
      case 'walk': {
        if (!alive) break;
        e.walkT += dt;
        this._face(e, dx, dz, ph2 ? 3.5 : 2.4, dt);
        if (dist > 4.2) { this._step(e, dx, dz, speed, dt); e._moving = speed; }
        if (dist < 5.5) {
          e.slamsLeft = ph2 ? 3 : 2;
          e.state = 'slamWind'; e.t = 0; e.firstSlam = true;
        } else if (dist > 9 && e.walkT > (ph2 ? 2.2 : 3.2)) {
          e.state = 'throwWind'; e.t = 0;
          this._spawnHeldRock(e);
        }
        break;
      }
      case 'slamWind': {
        if (pp) this._face(e, dx, dz, ph2 ? 3 : 2, dt);
        const wind = e.firstSlam ? (ph2 ? 0.6 : 0.85) : (ph2 ? 0.4 : 0.55);
        if (e.t >= wind) { e.state = 'slam'; e.t = 0; e.didHit = false; }
        break;
      }
      case 'slam': {
        if (!e.didHit && e.t >= 0.12) {
          e.didHit = true;
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
          const c = new THREE.Vector3(e.position.x + fx * 3.0, 0, e.position.z + fz * 3.0);
          c.y = this._ground(c.x, c.z, e.position.y);
          this._spawnShockwave(c);
          this._sfx('door');
          this._rocks(c, 6, 4, 0.5);
          this._puffs(c, 6, 0xb8a888, 0.2);
          this.cameraShake = Math.max(this.cameraShake, 0.55);
          // golpe direto do punho
          if (pp && Math.hypot(pp.x - c.x, pp.z - c.z) < 1.6) this._hurtPlayer(player, 2, c, { unblockable: true });
        }
        if (e.t >= 0.5) {
          e.slamsLeft--;
          e.firstSlam = false;
          if (e.slamsLeft > 0) { e.state = 'slamWind'; e.t = 0; }
          else { e.state = 'stuck'; e.t = 0; this._sfx('bossRoar'); }
        }
        break;
      }
      case 'stuck':
        if (e.t >= 2.5) { e.state = 'getUp'; e.t = 0; }
        break;
      case 'getUp':
        if (e.t >= 0.7) { e.state = 'walk'; e.t = 0; e.walkT = 0; }
        break;
      case 'throwWind': {
        if (pp) this._face(e, dx, dz, 4, dt);
        this._positionHeldRock(e);
        if (e.t >= (ph2 ? 0.7 : 1.0)) {
          this._throwRock(e, player);
          e.state = 'throwRec'; e.t = 0;
        }
        break;
      }
      case 'throwRec':
        if (e.t >= 0.6) { e.state = 'walk'; e.t = 0; e.walkT = 0; }
        break;
      default: e.state = 'walk';
    }

    // colisão com o mundo; empurra o jogador para fora do corpo
    this._collide(e.position, e.radius);
    e.position.y = this._ground(e.position.x, e.position.z, e.position.y);
    if (pp && dist < e.radius + PLAYER_R && dist > 1e-4) {
      const push = e.radius + PLAYER_R - dist;
      pp.x += (dx / dist) * push; pp.z += (dz / dist) * push;
    }
    e.root.rotation.y = e.yaw;
  }

  _spawnHeldRock(e) {
    const r = new THREE.Mesh(GEO.boulder, MAT.rock);
    r.castShadow = true;
    e.heldRock = r;
    this.scene?.add?.(r);
    this._positionHeldRock(e);
  }

  _positionHeldRock(e) {
    if (!e.heldRock) return;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const rx = -fz, rz = fx;
    const lift = clamp(e.t / 0.6, 0, 1);
    e.heldRock.position.set(
      e.position.x - fx * 0.9 * lift + rx * 1.2,
      e.position.y + lerp(2.5, e.height + 0.6, lift),
      e.position.z - fz * 0.9 * lift + rz * 1.2,
    );
    e.heldRock.rotation.x += 0.05;
  }

  _throwRock(e, player) {
    const mesh = e.heldRock || new THREE.Mesh(GEO.boulder, MAT.rock);
    if (!e.heldRock) this.scene?.add?.(mesh);
    e.heldRock = null;
    const start = mesh.position.clone();
    const pp = player?.position || e.position;
    const flight = e.phase2 ? 0.95 : 1.15;
    const lead = player?.velocity ? 0.5 : 0;
    const target = new THREE.Vector3(pp.x + (player?.velocity?.x || 0) * flight * lead, 0, pp.z + (player?.velocity?.z || 0) * flight * lead);
    target.y = this._ground(target.x, target.z, pp.y);
    const shadow = new THREE.Mesh(GEO.shadow, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    this.scene?.add?.(shadow);
    this.projectiles.push({ mesh, shadow, start, target, t: 0, flight, apex: 4.5 });
    this._sfx('swing');
  }

  _disposeProjectile(p) {
    this.scene?.remove?.(p.mesh);
    this.scene?.remove?.(p.shadow);
    p.shadow.material.dispose();
  }

  _updateProjectiles(dt, player) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = clamp(p.t / p.flight, 0, 1);
      const x = lerp(p.start.x, p.target.x, k), z = lerp(p.start.z, p.target.z, k);
      const y = lerp(p.start.y, p.target.y + 0.6, k) + 4 * p.apex * k * (1 - k);
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.z += dt * 4;
      const gy = this._ground(x, z, p.target.y);
      p.shadow.position.set(x, gy + 0.05, z);
      const sc = 0.5 + 0.9 * k;
      p.shadow.scale.set(sc, sc, sc);
      p.shadow.material.opacity = 0.2 + 0.35 * k;
      if (k >= 1) {
        const pp = player?.position;
        if (pp && Math.hypot(pp.x - p.target.x, pp.z - p.target.z) < 1.7) this._hurtPlayer(player, 2, p.target);
        this._rocks(p.target, 9, 5, 0.6);
        this._puffs(p.target, 6, 0xb0a080, 0.3);
        this._sfx('door');
        this.cameraShake = Math.max(this.cameraShake, 0.3);
        this._disposeProjectile(p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  _spawnShockwave(center) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8d8a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(GEO.ring, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, center.y + 0.08, center.z);
    mesh.scale.setScalar(0.1);
    mesh.renderOrder = 3;
    this.scene?.add?.(mesh);
    this.shockwaves.push({ mesh, center: center.clone(), r: 0.3, speed: 9.5, maxR: 11, hit: false });
  }

  _updateShockwaves(dt, player) {
    const pp = player?.position;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.r += s.speed * dt;
      s.mesh.scale.setScalar(s.r);
      s.mesh.material.opacity = 0.85 * (1 - s.r / s.maxR);
      if (!s.hit && pp && player.state !== 'roll' && player.state !== 'dead') {
        const d = Math.hypot(pp.x - s.center.x, pp.z - s.center.z);
        const dy = Math.abs(pp.y - s.center.y);
        if (Math.abs(d - s.r) < 0.65 && dy < 1.2) {
          if (this._hurtPlayer(player, 2, s.center, { unblockable: true })) s.hit = true;
        }
      }
      if (s.r >= s.maxR) {
        this.scene?.remove?.(s.mesh);
        s.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ separação
  _separate(player) {
    const L = this.all;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive || !a.active || a.type === 'bat') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.alive || !b.active || b.type === 'bat') continue;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 1e-6 ? dx / d : 1, nz = d2 > 1e-6 ? dz / d : 0;
        const over = min - d;
        const aFix = a.isBoss || a.cfg.rooted, bFix = b.isBoss || b.cfg.rooted;
        if (aFix && bFix) continue;
        const wa = aFix ? 0 : bFix ? 1 : 0.5, wb = 1 - wa;
        a.position.x -= nx * over * wa; a.position.z -= nz * over * wa;
        b.position.x += nx * over * wb; b.position.z += nz * over * wb;
      }
      // não atravessa o jogador
      const pp = player?.position;
      if (pp && !a.isBoss && !a.cfg.rooted && player.state !== 'dead') {
        const dx = a.position.x - pp.x, dz = a.position.z - pp.z;
        const min = a.radius + PLAYER_R;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4) {
          a.position.x = pp.x + (dx / d) * min;
          a.position.z = pp.z + (dz / d) * min;
        }
      }
    }
  }

  // ------------------------------------------------------------------ visuais
  _pose(e, name, x, y, z, rate, dt) {
    const p = e.pivots[name], b = e.base[name];
    if (!p || !b) return;
    const k = 1 - Math.exp(-rate * dt);
    p.rotation.x += (b.r.x + x - p.rotation.x) * k;
    p.rotation.y += (b.r.y + y - p.rotation.y) * k;
    p.rotation.z += (b.r.z + z - p.rotation.z) * k;
  }

  _visuals(e, dt) {
    const time = this.time;
    e.phase += dt * (e._moving ? 2 + e._moving * 2 : 2);
    const mv = e._moving || 0;
    e._moving = 0;
    const st = e.state;
    let sx = 1, sy = 1, sz = 1;
    let shake = 0;

    if (e.isBoss) this._bossVisuals(e, dt);
    else switch (e.type) {
      case 'slime': {
        const q = e.squash;
        const wob = Math.sin(time * 6 + e.phase) * 0.04;
        sx = sz = 1 + q * 0.25 + wob; sy = 1 - q * 0.3 - wob;
        if (e.air > 0) { sx = sz = 0.88; sy = 1.18; }
        this._pose(e, 'body', 0, 0, 0, 10, dt);
        break;
      }
      case 'bat': {
        const f = Math.sin(time * 22 + e.phase);
        const flap = st === 'swoop' ? 0.25 : 0.9;
        this._pose(e, 'wingL', 0, 0, f * flap, 40, dt);
        this._pose(e, 'wingR', 0, 0, -f * flap, 40, dt);
        this._pose(e, 'armL', 0, 0, f * flap, 40, dt);
        this._pose(e, 'armR', 0, 0, -f * flap, 40, dt);
        this._pose(e, 'body', st === 'swoop' ? 0.5 : 0.1 * f, 0, 0, 12, dt);
        break;
      }
      case 'plant': {
        const sw = Math.sin(time * 2 + e.phase);
        let lean = 0.06 * sw, jaw = 0.1 + 0.08 * Math.sin(time * 4 + e.phase), headX = 0;
        if (st === 'windup') { lean = -0.45; jaw = 0.6; headX = -0.3; shake = 0.03; }
        else if (st === 'swing') { lean = 0.75; jaw = 0.9; headX = 0.4; }
        else if (st === 'recover') { lean = 0.2; jaw = 0.2; }
        else if (st === 'stun') { lean = -0.3; jaw = 0.05; headX = -0.4; }
        const r = st === 'swing' ? 40 : 12;
        this._pose(e, 'stem', lean, 0, 0.05 * sw, r, dt);
        this._pose(e, 'body', lean, 0, 0.05 * sw, r, dt);
        this._pose(e, 'torso', lean, 0, 0.05 * sw, r, dt);
        this._pose(e, 'head', headX, 0, 0, r, dt);
        this._pose(e, 'jaw', jaw, 0, 0, r, dt);
        this._pose(e, 'mouth', jaw, 0, 0, r, dt);
        break;
      }
      default: {
        // humanoides: goblin / esqueleto
        const sn = Math.sin(e.phase * 2.2);
        const amp = clamp(mv / 3, 0, 1) * 0.7;
        let armR = [-sn * amp * 0.7, 0, 0], armL = [sn * amp * 0.7, 0, 0], torso = [0.05 * amp, 0, 0], head = [0, 0, 0];
        let legL = [-sn * amp, 0, 0], legR = [sn * amp, 0, 0];
        let rate = 12;
        if (st === 'windup') {
          armR = [-2.7, 0, -0.2]; torso = [-0.25, -0.3, 0]; head = [0.1, 0, 0];
          legL = [-0.3, 0, 0]; legR = [0.3, 0, 0];
          shake = 0.025; rate = 14;
        } else if (st === 'swing') {
          armR = [-0.6, 0, 0.1]; torso = [0.4, 0.25, 0]; legL = [-0.5, 0, 0]; legR = [0.4, 0, 0]; rate = 40;
        } else if (st === 'recover') {
          armR = [-0.4, 0, 0]; torso = [0.25, 0.1, 0];
        } else if (st === 'stun') {
          torso = [-0.35, 0, 0.1]; head = [-0.3, 0, 0]; armR = [0.3, 0, -0.4]; armL = [0.3, 0, 0.4]; rate = 20;
        } else if (st === 'chase' && e.alertHop > 0) {
          armL = [-2.5, 0, 0.3]; armR = [-2.5, 0, -0.3]; rate = 20;
        } else if (mv < 0.1) {
          const br = Math.sin(time * 2.3 + e.phase);
          torso = [0.03 * br, 0, 0]; head = [0, 0.3 * Math.sin(time * 0.6 + e.phase), 0];
        }
        if (e.guardT > 0) { armL = [-1.4, 0, -0.5]; armR = [-1.2, 0, 0.6]; rate = 30; }
        this._pose(e, 'armR', ...armR, rate, dt);
        this._pose(e, 'armL', ...armL, rate, dt);
        this._pose(e, 'torso', ...torso, rate, dt);
        this._pose(e, 'body', ...torso, rate, dt);
        this._pose(e, 'head', ...head, rate, dt);
        this._pose(e, 'legL', ...legL, rate, dt);
        this._pose(e, 'legR', ...legR, rate, dt);
        if (mv > 0.1) e.position.y += Math.abs(Math.sin(e.phase * 2.2)) * 0.06;
      }
    }

    // pop do acerto + tremida de telegrafia
    e.pop = damp(e.pop, 0, 12, dt);
    const pop = 1 + e.pop * 0.25;
    e.root.scale.set(sx * pop, sy * pop, sz * pop);
    if (shake > 0) {
      e.root.rotation.z = Math.sin(time * 60) * shake;
    } else if (!e.isBoss) e.root.rotation.z = 0;

    // flash (branco → vermelho) ou tinta de telegrafia
    if (e.flashT > 0) {
      e.flashT -= dt;
      this._tint(e, e.flashT > 0.16 ? _WHITE : _RED, e.flashT > 0.16 ? 1 : 0.8);
    } else if (e.tint !== null && e.tint !== undefined && st !== 'stun') {
      _TMP.setHex(e.tint);
      this._tint(e, _TMP, e.tintAmt);
    } else if (e._tinted) {
      this._restore(e);
    }
  }

  _tint(e, color, amt) {
    for (const o of e.mats) {
      const m = o.m;
      if (m.emissive && o.emissive) {
        m.emissive.copy(o.emissive).lerp(color, clamp(amt, 0, 1));
        m.emissiveIntensity = Math.max(o.ei, 1);
      } else if (m.color && o.color) {
        m.color.copy(o.color).lerp(color, clamp(amt * 0.7, 0, 1));
      }
    }
    e._tinted = true;
  }

  _restore(e) {
    for (const o of e.mats) {
      if (o.m.emissive && o.emissive) { o.m.emissive.copy(o.emissive); o.m.emissiveIntensity = o.ei; }
      else if (o.m.color && o.color) o.m.color.copy(o.color);
    }
    e._tinted = false;
  }

  _bossVisuals(e, dt) {
    const st = e.state, t = e.t, time = this.time;
    let armL = [0, 0, 0.1], armR = [0, 0, -0.1], torso = [0, 0, 0], head = [0, 0, 0];
    let legL = [0, 0, 0], legR = [0, 0, 0];
    let rate = 6;
    if (st === 'walk') {
      const sn = Math.sin(time * (e.phase2 ? 4.2 : 3));
      legL = [-sn * 0.35, 0, 0]; legR = [sn * 0.35, 0, 0];
      armL = [sn * 0.3, 0, 0.15]; armR = [-sn * 0.3, 0, -0.15];
      torso = [0.1, sn * 0.08, 0];
    } else if (st === 'dormant') {
      torso = [0.35, 0, 0]; head = [0.4, 0, 0]; armL = [0.1, 0, 0.05]; armR = [0.1, 0, -0.05];
    } else if (st === 'roar') {
      torso = [-0.3, 0, 0]; head = [-0.5, 0, 0]; armL = [-0.6, 0, 1.0]; armR = [-0.6, 0, -1.0]; rate = 5;
    } else if (st === 'slamWind') {
      armL = [-2.9, 0, -0.3]; armR = [-2.9, 0, 0.3]; torso = [-0.3, 0, 0]; head = [-0.2, 0, 0]; rate = 7;
    } else if (st === 'slam') {
      armL = [-1.1, 0, -0.15]; armR = [-1.1, 0, 0.15]; torso = [0.55, 0, 0]; head = [0.2, 0, 0];
      legL = [-0.3, 0, 0]; legR = [0.3, 0, 0]; rate = 35;
    } else if (st === 'stuck') {
      const tr = Math.sin(time * 30) * 0.02;
      armL = [-1.0 + tr, 0, -0.1]; armR = [-1.0 - tr, 0, 0.1]; torso = [0.65, tr, 0]; head = [0.35, 0, 0];
      legL = [-0.35, 0, 0]; legR = [0.35, 0, 0]; rate = 10;
    } else if (st === 'getUp') {
      torso = [0.2, 0, 0]; rate = 4;
    } else if (st === 'throwWind') {
      armR = [-2.8, 0, -0.4]; armL = [-0.5, 0, 0.4]; torso = [-0.2, -0.35, 0]; rate = 6;
    } else if (st === 'throwRec') {
      armR = [-0.9, 0, 0.2]; torso = [0.35, 0.35, 0]; rate = 25;
    } else if (st === 'dying') {
      torso = [0.7, 0, 0.15]; head = [0.5, 0, 0.2]; armL = [-0.3, 0, 0.6]; armR = [-0.3, 0, -0.6];
      legL = [-0.5, 0, 0]; legR = [0.4, 0, 0]; rate = 2;
    }
    this._pose(e, 'armL', ...armL, rate, dt);
    this._pose(e, 'armR', ...armR, rate, dt);
    this._pose(e, 'torso', ...torso, rate, dt);
    this._pose(e, 'head', ...head, rate, dt);
    this._pose(e, 'legL', ...legL, rate, dt);
    this._pose(e, 'legR', ...legR, rate, dt);

    // núcleo
    if (e.core) {
      let glow = 0.25, sc = 1;
      if (st === 'stuck') { glow = 1.6 + Math.sin(time * 10) * 0.8; sc = 1.15 + Math.sin(time * 10) * 0.12; }
      else if (st === 'dying') { glow = 2 + Math.sin(time * 30) * 1.5; sc = 1.2; }
      else if (st === 'slam' || st === 'slamWind') glow = 0.5;
      if (e.coreMat && e.coreMat.emissive) {
        if (e.phase2) e.coreMat.emissive.setRGB(1.0, 0.55, 0.15);
        else if (e.coreBase?.e) e.coreMat.emissive.copy(e.coreBase.e);
        e.coreMat.emissiveIntensity = damp(e.coreMat.emissiveIntensity, glow, 10, dt);
      }
      if (e.coreScale) e.core.scale.copy(e.coreScale).multiplyScalar(damp(e.core.scale.x / (e.coreScale.x || 1), sc, 10, dt));
    }
  }

  // ------------------------------------------------------------------ morte
  _updateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      const e = d.e;
      d.t += dt;
      if (!d.boss) {
        const k = clamp(d.t / 0.25, 0, 1);
        const s = (1 + e.pop * 0.25) * (1 - k);
        e.root.scale.set(s * 1.2, s * 0.6 + 0.001, s * 1.2);
        if (k >= 1) {
          this._removeEnemy(e);
          this.all = this.all.filter((x) => x !== e);
          this.dying.splice(i, 1);
        }
        continue;
      }
      // chefe: tremor + desmoronar + explosão
      e.state = 'dying'; e.t = d.t;
      e.flashT = 0;
      this._bossVisuals(e, dt);
      const T = 2.6;
      const k = clamp(d.t / T, 0, 1);
      const amp = 0.08 + 0.18 * k;
      e.position.set(
        e.deathBase.x + (Math.random() - 0.5) * amp,
        e.deathBase.y - 1.2 * k * k,
        e.deathBase.z + (Math.random() - 0.5) * amp,
      );
      e.root.rotation.z = Math.sin(d.t * 25) * 0.03 * (1 + k);
      this.cameraShake = Math.max(this.cameraShake, 0.25 + 0.3 * k);
      if (Math.random() < dt * 8) {
        const p = e.deathBase.clone(); p.x += rand(-2, 2); p.z += rand(-2, 2);
        this._puffs(p, 2, 0xa09878, rand(0.5, 3));
        if (Math.random() < 0.4) this._sfx('enemyHit');
      }
      if (d.t >= T && !d.exploded) {
        d.exploded = true;
        e.root.visible = false;
        const c = e.deathBase.clone(); c.y += 2.5;
        this._rocks(c, 34, 9, 1.0);
        this._puffs(c, 18, 0x9a8f78, 0);
        this._puffs(c, 10, 0x7a4aa8, 1);
        this._sparks(c, 16, 0xc8ff80);
        this._sfx('enemyDie');
        this._sfx('door');
        this.cameraShake = 1;
        e.position.copy(e.deathBase);
        this._callKill(e);
      }
      if (d.t >= T + 0.2) {
        this._removeEnemy(e);
        this.all = this.all.filter((x) => x !== e);
        this.dying.splice(i, 1);
        if (this.boss === e) this.boss = null;
      }
    }
  }

  // ------------------------------------------------------------------ partículas
  _addParticle(mesh, vel, life, opts = {}) {
    this.scene?.add?.(mesh);
    this.particles.push({ mesh, vel, life, maxLife: life, gravity: opts.gravity || 0, spin: opts.spin || 0,
      grow: opts.grow || 0, fade: !!opts.fade, shrink: !!opts.shrink, ownMat: !!opts.ownMat,
      s0: mesh.scale.x, bounce: !!opts.bounce, ground: opts.ground ?? -Infinity, drag: opts.drag || 0 });
  }

  _puffs(pos, n, color, yOff = 0) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(GEO.puff, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85, flatShading: true, depthWrite: false }));
      m.position.set(pos.x + rand(-0.3, 0.3), pos.y + yOff + rand(-0.2, 0.3), pos.z + rand(-0.3, 0.3));
      m.scale.setScalar(rand(0.6, 1.2));
      m.rotation.set(rand(0, TAU), rand(0, TAU), 0);
      const a = rand(0, TAU), sp = rand(0.8, 2.6);
      this._addParticle(m, new THREE.Vector3(Math.cos(a) * sp, rand(1.0, 2.6), Math.sin(a) * sp), rand(0.55, 0.9),
        { grow: 1.6, fade: true, ownMat: true, spin: rand(-3, 3), drag: 3 });
    }
  }

  _sparks(pos, n, color = 0xfff4c0) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(GEO.spark, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7));
      this._addParticle(m, v, rand(0.15, 0.3), { shrink: true, fade: true, ownMat: true, gravity: 6, spin: 10, drag: 4 });
    }
  }

  _rocks(pos, n, power, size) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(GEO.rock, Math.random() < 0.3 ? MAT.moss : MAT.rock);
      m.castShadow = true;
      m.position.set(pos.x + rand(-0.5, 0.5), pos.y + rand(0, 0.6), pos.z + rand(-0.5, 0.5));
      m.scale.setScalar(rand(0.5, 1.4) * size);
      const a = rand(0, TAU), sp = rand(0.3, 1) * power;
      const g = this._ground(m.position.x, m.position.z, pos.y);
      this._addParticle(m, new THREE.Vector3(Math.cos(a) * sp, rand(0.4, 1) * power, Math.sin(a) * sp), rand(1.2, 2.0),
        { gravity: 18, spin: rand(-8, 8), shrink: true, bounce: true, ground: g });
    }
  }

  _updateParticles(dt) {
    const P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      const m = p.mesh;
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y -= p.gravity * dt;
      m.position.addScaledVector(p.vel, dt);
      if (p.bounce && m.position.y < p.ground + 0.1) {
        m.position.y = p.ground + 0.1;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.6; p.vel.z *= 0.6;
        p.spin *= 0.6;
      }
      if (p.spin) { m.rotation.x += p.spin * dt; m.rotation.y += p.spin * 0.7 * dt; }
      const k = clamp(p.life / p.maxLife, 0, 1);
      if (p.grow) m.scale.setScalar(p.s0 * (1 + p.grow * (1 - k)));
      if (p.shrink) m.scale.setScalar(p.s0 * Math.min(1, k * 2.5));
      if (p.fade && m.material.transparent) m.material.opacity = Math.min(1, k * 1.4) * 0.9;
      if (p.life <= 0) {
        this.scene?.remove?.(m);
        if (p.ownMat) m.material.dispose();
        P.splice(i, 1);
      }
    }
  }
}

const _WHITE = new THREE.Color(1, 1, 1);
const _RED = new THREE.Color(1, 0.12, 0.08);
const _TMP = new THREE.Color();
