// Ecos de Valdora — herói: movimento, combate, animação procedural.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const WALK_SPEED = 4.5;
const RUN_SPEED = 7.5;
const LOCK_SPEED = 4.3;
const BLOCK_MUL = 0.42;
const CHARGE_MUL = 0.55;
const RADIUS = 0.45;
const ROLL_DUR = 0.45;
const ROLL_SPEED = 9.8;
const ROLL_IFRAME_END = 0.4;
const HURT_DUR = 0.35;
const INVULN = 1.0;
const CHARGE_TIME = 0.8;
const SPIN_DUR = 0.55;
const SPIN_ACTIVE = [0.06, 0.52];
const SPIN_RADIUS = 2.8;
const LOCK_MAX = 25;
const BLOCK_DOT = Math.cos(THREE.MathUtils.degToRad(52)); // ~104° de cone frontal
const TUMBLE_H = 0.55;
const TRAIL_N = 26;
const TRAIL_LIFE = 0.17;

// kind: h = horizontal (dir→esq), b = backhand (esq→dir), o = overhead/estocada
const COMBO = [
  { kind: 'h', dur: 0.32, active: [0.28, 0.66], damage: 1, sfx: 'swing', lunge: 2.8, recover: 0.16 },
  { kind: 'b', dur: 0.32, active: [0.26, 0.64], damage: 1, sfx: 'swing2', lunge: 2.8, recover: 0.16 },
  { kind: 'o', dur: 0.46, active: [0.40, 0.66], damage: 2, sfx: 'swing', lunge: 4.2, recover: 0.28 },
];

const PIVOTS = ['hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'foreArmL', 'foreArmR'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
const angleDiff = (from, to) => wrapAngle(to - from);
const dampAngle = (cur, target, rate, dt) => cur + angleDiff(cur, target) * (1 - Math.exp(-rate * dt));

// ---------------------------------------------------------------------------
// Modelo reserva (caso models.createHero falhe)
function buildFallbackHero() {
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const box = (w, h, d, c, y = 0, z = 0, x = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.9; root.add(hips);
  hips.add(box(0.36, 0.16, 0.24, 0x6b4a2b, 0));
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(box(0.44, 0.52, 0.26, 0x2f8f3a, 0.3));
  const head = new THREE.Group(); head.position.y = 0.58; torso.add(head);
  head.add(box(0.28, 0.3, 0.28, 0xf0c8a0, 0.15));
  head.add(box(0.32, 0.12, 0.32, 0x8a5a2a, 0.32));
  const mkArm = (side) => {
    const arm = new THREE.Group(); arm.position.set(side * 0.29, 0.52, 0); torso.add(arm);
    arm.add(box(0.12, 0.3, 0.12, 0x2f8f3a, -0.15));
    const fore = new THREE.Group(); fore.position.y = -0.3; arm.add(fore);
    fore.add(box(0.1, 0.28, 0.1, 0xf0c8a0, -0.14));
    return { arm, fore };
  };
  const L = mkArm(1), R = mkArm(-1);
  const mkLeg = (side) => {
    const leg = new THREE.Group(); leg.position.set(side * 0.11, -0.02, 0); hips.add(leg);
    leg.add(box(0.15, 0.86, 0.16, 0x5a3d22, -0.45));
    return leg;
  };
  const legL = mkLeg(1), legR = mkLeg(-1);
  const sword = new THREE.Group(); sword.position.y = -0.3; R.fore.add(sword);
  sword.add(box(0.05, 0.05, 0.16, 0x553311, 0, 0.02));
  sword.add(box(0.2, 0.04, 0.04, 0xccaa33, 0, 0.1));
  sword.add(box(0.06, 0.02, 0.85, 0xdde6ff, 0, 0.55));
  const shield = new THREE.Group(); shield.position.set(0.08, -0.15, 0); L.fore.add(shield);
  shield.add(box(0.04, 0.46, 0.36, 0x2a4fa0));
  const instrument = new THREE.Group(); instrument.position.set(0, 0.08, 0.22); head.add(instrument);
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 6), mat(0x8fd0ff));
  fl.rotation.z = Math.PI / 2; instrument.add(fl);
  instrument.visible = false;
  return {
    root, sword, shield, instrument,
    pivots: { hips, torso, head, armL: L.arm, armR: R.arm, legL, legR, foreArmL: L.fore, foreArmR: R.fore },
  };
}

// ---------------------------------------------------------------------------
export class Player {
  constructor(scene, world, models, audio) {
    this.scene = scene;
    this.world = world;
    this.models = models;
    this.audio = audio;

    this.root = new THREE.Group();
    this.root.name = 'Player';
    this.position = this.root.position;
    this.yaw = Math.PI; // olhando para -Z
    this.velocity = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.radius = RADIUS;
    this.height = 1.7;

    this.maxHearts = 3;
    this.hp = 6;
    this.state = 'idle';
    this.hasSword = true;
    this.hasInstrument = false;
    this.lockTarget = null;
    this.onFootstep = null; // (position, running) => void

    this.frozen = false;
    this.playing = false;
    this.stateT = 0;
    this.time = 0;
    this.invulnT = 0;
    this.chargeT = 0;
    this.atk = null;
    this._atkId = 0;
    this._atkWasDown = false;
    this._aimYaw = null;
    this._targetVel = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._rollDir = new THREE.Vector3(0, 0, 1);
    this._strafeR = 0;
    this._phase = 0;
    this._lastHalf = 0;
    this._lockSnap = null;
    this._chargeReady = false;

    this._buildModel();
    this._buildTrail();
    scene?.add?.(this.root);

    const sp = world?.spawns?.player;
    if (sp && typeof sp.x === 'number') this.position.copy(sp);
    else this.position.set(0, 0, 12);
    this.position.y = this._ground(this.position.x, this.position.z, this.position.y);
    this.root.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------ setup
  _buildModel() {
    let hero = null;
    try { hero = this.models?.createHero?.(); } catch (e) { console.warn('[player] createHero falhou, usando reserva', e); }
    if (!hero || !hero.root) hero = buildFallbackHero();
    this.hero = hero;
    this.model = hero.root;

    // tumble: pivô no centro de massa para cambalhota/giro sem alterar yaw
    this.tumble = new THREE.Group();
    this.tumble.position.y = TUMBLE_H;
    this.root.add(this.tumble);
    hero.root.position.y -= TUMBLE_H;
    this.tumble.add(hero.root);

    this.piv = {};
    this.pivBase = {};
    for (const n of PIVOTS) {
      const p = hero.pivots?.[n];
      if (p && p.rotation) { this.piv[n] = p; this.pivBase[n] = p.rotation.clone(); }
    }
    this.hipsBaseY = this.piv.hips ? this.piv.hips.position.y : 0;

    const hand = this.piv.foreArmR || this.piv.armR || hero.root;
    this.sword = hero.sword;
    if (!this.sword) {
      const fb = buildFallbackHero();
      this.sword = fb.sword;
      this.sword.position.set(0, -0.3, 0);
      hand.add(this.sword);
    }
    this.shield = hero.shield || null;
    this.instrument = hero.instrument;
    if (!this.instrument) {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 6),
        new THREE.MeshLambertMaterial({ color: 0x8fd0ff, flatShading: true }));
      fl.rotation.z = Math.PI / 2;
      fl.position.set(0, 1.5, 0.25);
      this.instrument = fl;
      (this.piv.head || hero.root).add(fl);
      if (this.piv.head) fl.position.set(0, 0.08, 0.22);
    }
    this.instrument.visible = false;
    this.scarf = hero.scarf || null;
    this.scarfBase = this.scarf ? this.scarf.rotation.clone() : null;

    // geometria local da lâmina (base/ponta) para trilha e brilho
    this.root.updateMatrixWorld(true);
    this._bladeBase = new THREE.Vector3(0, 0.25, 0);
    this._bladeTip = new THREE.Vector3(0, 0.95, 0);
    try {
      const inv = new THREE.Matrix4().copy(this.sword.matrixWorld).invert();
      const box = new THREE.Box3();
      const m = new THREE.Matrix4();
      this.sword.traverse((o) => {
        if (o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
          box.union(bb);
        }
      });
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const c = box.getCenter(new THREE.Vector3());
        const k = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
        const lo = box.min[k], hi = box.max[k];
        const tipV = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
        const hiltV = tipV === hi ? lo : hi;
        const tip = c.clone(); tip[k] = tipV;
        const hilt = c.clone(); hilt[k] = hiltV;
        this._bladeTip.copy(hilt).lerp(tip, 1.08);
        this._bladeBase.copy(hilt).lerp(tip, 0.3);
      }
    } catch (e) { /* mantém padrão */ }

    // materiais da espada clonados (brilho do giro carregado)
    this._swordMats = [];
    this.sword.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const arr = Array.isArray(o.material);
      const mats = (arr ? o.material : [o.material]).map((mm) => mm.clone());
      o.material = arr ? mats : mats[0];
      for (const mm of mats) {
        if (mm.emissive) this._swordMats.push({ m: mm, e: mm.emissive.clone(), i: mm.emissiveIntensity ?? 1 });
      }
    });
    const dir = this._bladeTip.clone().sub(this._bladeBase);
    const len = Math.max(0.2, dir.length());
    this._glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this._glow.position.copy(this._bladeBase).add(this._bladeTip).multiplyScalar(0.5);
    this._glow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this._glow.scale.set(0.1, len * 0.62, 0.1);
    this._glow.visible = false;
    this.sword.add(this._glow);
    this._glowScaleBase = this._glow.scale.clone();
  }

  _buildTrail() {
    const g = new THREE.BufferGeometry();
    this._trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this._trailCol = new Float32Array(TRAIL_N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this._trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this._trail.frustumCulled = false;
    this._trail.renderOrder = 5;
    this._trail.visible = false;
    this._trailSamples = []; // {b, t, age}
    this._trailPool = [];
    this._trailColor = new THREE.Color(1, 1, 1);
    this.scene?.add?.(this._trail);
  }

  // ------------------------------------------------------------------ helpers
  _sfx(name) { try { this.audio?.sfx?.(name); } catch (e) { /* ignore */ } }

  _ground(x, z, fallback = 0) {
    try {
      const h = this.world?.getHeight?.(x, z);
      return Number.isFinite(h) ? h : fallback;
    } catch (e) { return fallback; }
  }

  _isWater(x, z) {
    try { return !!this.world?.isWater?.(x, z); } catch (e) { return false; }
  }

  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get isAttacking() { return this.state === 'attack' || this.state === 'spin'; }
  get isBlocking() { return this.state === 'block'; }
  get isRolling() { return this.state === 'roll'; }
  get isDead() { return this.state === 'dead'; }
  get isInvulnerable() {
    return this.invulnT > 0 || this.state === 'dead' || (this.state === 'roll' && this.stateT < ROLL_IFRAME_END);
  }
  get chargeLevel() { return clamp(this.chargeT / CHARGE_TIME, 0, 1); }

  setLockTarget(enemy) {
    this.lockTarget = enemy || null;
  }

  _validateLock() {
    const t = this.lockTarget;
    if (!t) return;
    const p = t.position;
    if (this.state === 'dead' || !p || t.alive === false || t.active === false || t.lockable === false) {
      this.lockTarget = null; return;
    }
    const dx = p.x - this.position.x, dz = p.z - this.position.z;
    if (dx * dx + dz * dz > LOCK_MAX * LOCK_MAX) this.lockTarget = null;
  }

  _yawTo(p) { return Math.atan2(p.x - this.position.x, p.z - this.position.z); }

  // ------------------------------------------------------------------ public API
  update(dt, input, cameraYaw = 0, enemies = null) {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.stateT += dt;
    if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - dt);
    const list = Array.isArray(enemies) ? enemies : (enemies && Array.isArray(enemies.list) ? enemies.list : []);
    this._validateLock();
    this._control(dt, input, cameraYaw || 0, list);
    this._physics(dt);
    this._animate(dt);
    this._updateTrail(dt);
  }

  takeDamage(halves, fromPos, opts = {}) {
    if (this.state === 'dead') return false;
    if (this.invulnT > 0) return false;
    if (this.state === 'roll' && this.stateT < ROLL_IFRAME_END) return false;
    const dir = new THREE.Vector3();
    if (fromPos) dir.set(this.position.x - fromPos.x, 0, this.position.z - fromPos.z);
    if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    dir.normalize();

    // escudo: atacante dentro do cone frontal
    if (this.state === 'block' && fromPos && !opts.unblockable) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const dot = -(dir.x * fx + dir.z * fz);
      if (dot >= BLOCK_DOT) {
        this._sfx('block');
        this.knock.addScaledVector(dir, 4.0);
        this._blockFlash = 0.15;
        return false;
      }
    }

    halves = Math.max(0, halves | 0) || 1;
    this.hp = Math.max(0, this.hp - halves);
    this._sfx('hurt');
    this.knock.copy(dir).multiplyScalar(opts.knock ?? 7.5);
    this.chargeT = 0;
    this.atk = null;
    if (this.playing) this.setPlaying(false);
    if (this.hp <= 0) {
      this._setState('dead');
      this.lockTarget = null;
      this.invulnT = 0;
    } else {
      this._setState('hurt');
      this.invulnT = INVULN;
    }
    return true;
  }

  heal(halves) {
    if (this.state === 'dead') return;
    this.hp = Math.min(this.maxHearts * 2, this.hp + Math.max(0, halves || 0));
  }

  getAttack() {
    if (!this.hasSword) return null;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (this.state === 'attack' && this.atk) {
      const c = COMBO[this.atk.step];
      const p = this.stateT / c.dur;
      if (p >= c.active[0] && p <= c.active[1]) {
        return {
          center: new THREE.Vector3(this.position.x + fx * 1.3, this.position.y + 1.1, this.position.z + fz * 1.3),
          radius: 1.3, damage: c.damage, id: this.atk.id, kind: 'slash', step: this.atk.step,
        };
      }
    } else if (this.state === 'spin' && this.atk) {
      const p = this.stateT / SPIN_DUR;
      if (p >= SPIN_ACTIVE[0] && p <= SPIN_ACTIVE[1]) {
        return {
          center: new THREE.Vector3(this.position.x, this.position.y + 1.0, this.position.z),
          radius: SPIN_RADIUS, damage: 2, id: this.atk.id, kind: 'spin', step: 3,
        };
      }
    }
    return null;
  }

  setPlaying(on) {
    on = !!on;
    if (on) {
      if (this.state === 'dead') return;
      this.playing = true;
      this.atk = null;
      this.chargeT = 0;
      this._setState('play');
      this.velocity.set(0, 0, 0);
      this.instrument.visible = true;
      if (this.sword) this.sword.visible = false;
    } else {
      this.playing = false;
      this.instrument.visible = false;
      if (this.sword) this.sword.visible = this.hasSword;
      if (this.state === 'play') this._setState(this.frozen ? 'talk' : 'idle');
    }
  }

  freeze(on) {
    this.frozen = !!on;
    if (this.frozen) {
      this.chargeT = 0;
    } else if (this.state === 'talk') {
      this._setState('idle');
    }
  }

  respawn(pos) {
    if (pos) this.position.copy(pos);
    this.position.y = this._ground(this.position.x, this.position.z, this.position.y);
    this.hp = this.maxHearts * 2;
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.lockTarget = null;
    this.atk = null;
    this.chargeT = 0;
    this.playing = false;
    this.instrument.visible = false;
    if (this.sword) this.sword.visible = this.hasSword;
    this.tumble.rotation.set(0, 0, 0);
    this.tumble.position.y = TUMBLE_H;
    this.model.visible = true;
    this.invulnT = 1.5;
    this._setState(this.frozen ? 'talk' : 'idle');
    for (const n in this.piv) this.piv[n].rotation.copy(this.pivBase[n]);
    this._trailSamples.length = 0;
  }

  // ------------------------------------------------------------------ state
  _setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  _startAttack(step, wish, list) {
    this._setState('attack');
    this.atk = { step, id: ++this._atkId, buffered: false };
    const c = COMBO[step];
    // auto-mira
    let aim = null;
    if (this.lockTarget) aim = this._yawTo(this.lockTarget.position);
    else {
      const hasWish = wish.lengthSq() > 0.01;
      const refYaw = hasWish ? Math.atan2(wish.x, wish.z) : this.yaw;
      let best = null, bestD = 3.6;
      for (const e of list) {
        if (!e || e.alive === false || e.active === false || !e.position) continue;
        const dx = e.position.x - this.position.x, dz = e.position.z - this.position.z;
        const d = Math.hypot(dx, dz) - (e.radius || 0.5);
        if (d > bestD) continue;
        if (Math.abs(angleDiff(refYaw, Math.atan2(dx, dz))) > 1.2) continue;
        best = e; bestD = d;
      }
      if (best) aim = this._yawTo(best.position);
      else if (hasWish) aim = refYaw;
    }
    this._aimYaw = aim;
    this._sfx(c.sfx);
    this._trailSamples.length = 0;
    this._trailColor.setRGB(1, 1, 1);
  }

  _startSpin() {
    this._setState('spin');
    this.atk = { step: 3, id: ++this._atkId, buffered: false };
    this.chargeT = 0;
    this._chargeReady = false;
    this._sfx('spin');
    this._trailSamples.length = 0;
    this._trailColor.setRGB(0.55, 0.9, 1);
  }

  _startRoll(wish) {
    if (wish.lengthSq() > 0.01) this._rollDir.copy(wish).setY(0).normalize();
    else this._rollDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.yaw = Math.atan2(this._rollDir.x, this._rollDir.z);
    this.atk = null;
    this.chargeT = 0;
    this._setState('roll');
    this._sfx('roll');
  }

  _control(dt, input, cameraYaw, list) {
    const s0 = this.state;
    const tv = this._targetVel.set(0, 0, 0);
    this._strafeR = 0;

    if (s0 === 'dead') return;

    // ---- congelado (diálogo / cutscene)
    if (this.frozen) {
      if (['idle', 'move', 'block', 'attack', 'spin'].includes(s0)) { this.atk = null; this._setState('talk'); }
      if (s0 === 'hurt' && this.stateT >= HURT_DUR) this._setState('talk');
      if (s0 === 'roll' && this.stateT >= ROLL_DUR) this._setState('talk');
      if (s0 === 'roll') tv.copy(this._rollDir).multiplyScalar(ROLL_SPEED * (1 - this.stateT / ROLL_DUR));
      this.chargeT = 0;
      this._atkWasDown = false;
      return;
    }
    if (s0 === 'talk') this._setState('idle');
    if (s0 === 'play') return;

    const down = (a) => { try { return !!input?.isDown?.(a); } catch (e) { return false; } };
    const pressed = (a) => { try { return !!input?.pressed?.(a); } catch (e) { return false; } };

    // ---- direção desejada (relativa à câmera ou ao alvo)
    let ix = 0, iz = 0;
    let mv = null;
    try { mv = input?.getMove?.(); } catch (e) { mv = null; }
    if (mv && Number.isFinite(mv.x) && Number.isFinite(mv.y)) { ix = mv.x; iz = mv.y; }
    else if (input) {
      ix = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
      iz = (down('forward') ? 1 : 0) - (down('back') ? 1 : 0);
    }
    let mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }
    const wish = this._wish.set(0, 0, 0);
    const lt = this.lockTarget;
    if (mag > 0.05) {
      let fx, fz;
      if (lt) {
        fx = lt.position.x - this.position.x; fz = lt.position.z - this.position.z;
        const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      } else {
        fx = -Math.sin(cameraYaw); fz = -Math.cos(cameraYaw);
      }
      const rx = -fz, rz = fx;
      wish.set(fx * iz + rx * ix, 0, fz * iz + rz * ix);
    }

    // ---- carga do golpe giratório
    const atkDown = down('attack');
    const canCharge = this.hasSword && ['idle', 'move', 'block', 'attack'].includes(this.state);
    if (atkDown && canCharge) {
      this.chargeT += dt;
      if (!this._chargeReady && this.chargeT >= CHARGE_TIME) this._chargeReady = true;
    } else if (!atkDown && this._atkWasDown && canCharge && this.chargeT >= CHARGE_TIME) {
      this._atkWasDown = false;
      this._startSpin();
      return;
    } else if (!atkDown || !canCharge) {
      this.chargeT = 0;
      this._chargeReady = false;
    }
    this._atkWasDown = atkDown;

    const s = this.state;
    const t = this.stateT;

    if (s === 'hurt') {
      if (t >= HURT_DUR) this._setState('idle');
      return;
    }
    if (s === 'roll') {
      const p = clamp(t / ROLL_DUR, 0, 1);
      const sp = ROLL_SPEED * (1 - 0.65 * p * p);
      this.velocity.copy(this._rollDir).multiplyScalar(sp);
      tv.copy(this.velocity);
      if (t >= ROLL_DUR) {
        this.velocity.multiplyScalar(0.45);
        this._setState(down('shield') ? 'block' : 'idle');
      }
      return;
    }
    if (s === 'spin') {
      if (t >= SPIN_DUR + 0.16) { this.atk = null; this._setState('idle'); }
      return;
    }
    if (s === 'attack' && this.atk) {
      const c = COMBO[this.atk.step];
      if (pressed('attack') && t > c.dur * 0.22) this.atk.buffered = true;
      // mira
      if (lt) this._aimYaw = this._yawTo(lt.position);
      if (this._aimYaw !== null) this.yaw = dampAngle(this.yaw, this._aimYaw, 28, dt);
      // avanço (lunge)
      const pEnd = c.active[1] * c.dur;
      if (t < pEnd) {
        const k = 1 - t / pEnd;
        tv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(c.lunge * k);
      }
      if (pressed('roll') && t > pEnd) { this._startRoll(wish); return; }
      if (t >= c.dur && this.atk.buffered && this.atk.step < COMBO.length - 1) {
        this._startAttack(this.atk.step + 1, wish, list);
        return;
      }
      if (t >= c.dur + c.recover) {
        this.atk = null;
        this._setState(down('shield') ? 'block' : 'idle');
      }
      return;
    }

    // ---- livre: idle / move / block
    if (pressed('roll')) { this._startRoll(wish); return; }
    if (pressed('attack') && this.hasSword) { this._startAttack(0, wish, list); return; }

    const blocking = down('shield');
    const charging = this.chargeT > 0.15;
    let speed = lt ? LOCK_SPEED : (down('run') && !blocking && !charging ? RUN_SPEED : WALK_SPEED);
    if (blocking) speed *= BLOCK_MUL;
    else if (charging) speed *= CHARGE_MUL;
    tv.copy(wish).multiplyScalar(speed);

    if (lt) {
      this.yaw = dampAngle(this.yaw, this._yawTo(lt.position), 16, dt);
      if (Math.abs(iz) < 0.2 && Math.abs(ix) > 0.2) {
        this._strafeR = Math.hypot(lt.position.x - this.position.x, lt.position.z - this.position.z);
      }
    } else if (!blocking && wish.lengthSq() > 0.01) {
      const target = Math.atan2(wish.x, wish.z);
      const diff = Math.abs(angleDiff(this.yaw, target));
      this.yaw = dampAngle(this.yaw, target, diff > 2.4 ? 22 : 13, dt);
    }

    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    const next = blocking ? 'block' : (hs > 0.35 || mag > 0.05 ? 'move' : 'idle');
    if (next !== s) this._setState(next);
  }

  _physics(dt) {
    const s = this.state;
    if (s !== 'roll') {
      const tv = this._targetVel;
      const accel = tv.lengthSq() > this.velocity.lengthSq() ? 11 : 15;
      const r = s === 'dead' || s === 'hurt' || s === 'play' || s === 'talk' ? 10 : accel;
      this.velocity.x = damp(this.velocity.x, tv.x, r, dt);
      this.velocity.z = damp(this.velocity.z, tv.z, r, dt);
    }
    this.velocity.y = 0;
    this.knock.multiplyScalar(Math.exp(-7 * dt));
    if (this.knock.lengthSq() < 1e-4) this.knock.set(0, 0, 0);

    const pos = this.position;
    const ox = pos.x, oz = pos.z;
    const mx = (this.velocity.x + this.knock.x) * dt;
    const mz = (this.velocity.z + this.knock.z) * dt;
    pos.x += mx; pos.z += mz;

    // strafe circular ao redor do alvo travado
    if (this._strafeR > 0.5 && this.lockTarget) {
      const tp = this.lockTarget.position;
      const dx = pos.x - tp.x, dz = pos.z - tp.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) { pos.x = tp.x + (dx / d) * this._strafeR; pos.z = tp.z + (dz / d) * this._strafeR; }
    }

    // não entra em água funda (tenta deslizar por eixo)
    if ((mx !== 0 || mz !== 0) && !this._isWater(ox, oz) && this._isWater(pos.x, pos.z)) {
      if (!this._isWater(ox + mx, oz)) { pos.x = ox + mx; pos.z = oz; this.velocity.z = 0; }
      else if (!this._isWater(ox, oz + mz)) { pos.x = ox; pos.z = oz + mz; this.velocity.x = 0; }
      else { pos.x = ox; pos.z = oz; this.velocity.x = 0; this.velocity.z = 0; this.knock.set(0, 0, 0); }
    }

    try { this.world?.resolveCollision?.(pos, RADIUS); } catch (e) { /* ignore */ }
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) { pos.x = ox; pos.z = oz; }

    const g = this._ground(pos.x, pos.z, pos.y);
    if (!Number.isFinite(pos.y) || Math.abs(g - pos.y) > 3) pos.y = g;
    else pos.y = damp(pos.y, g, g > pos.y ? 24 : 16, dt);

    this.root.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------ animation
  _animate(dt) {
    const T = this._poseT || (this._poseT = Object.fromEntries(PIVOTS.map((n) => [n, [0, 0, 0]])));
    for (const n of PIVOTS) { const a = T[n]; a[0] = a[1] = a[2] = 0; }
    const set = (n, x, y, z) => { const a = T[n]; a[0] = x; a[1] = y; a[2] = z; };
    const add = (n, x, y, z, w = 1) => { const a = T[n]; a[0] += x * w; a[1] += y * w; a[2] += z * w; };

    const s = this.state, t = this.stateT, time = this.time;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    let hipsY = 0, rate = 14;
    let tumbleX = 0, tumbleY = 0, tumbleH = TUMBLE_H, tumbleDirect = false, tumbleRate = 12;

    // ---- locomoção + respiração
    const loco = s === 'idle' || s === 'move' || s === 'block' || s === 'talk';
    if (loco) {
      const run = clamp((hs - WALK_SPEED * 0.9) / (RUN_SPEED - WALK_SPEED * 0.9), 0, 1);
      const mb = clamp(hs / 2.2, 0, 1);
      const stride = lerp(1.75, 2.7, run);
      this._phase += (hs * dt / stride) * TAU;
      const half = Math.floor(this._phase / Math.PI);
      if (half !== this._lastHalf) {
        this._lastHalf = half;
        if (hs > 1.0 && s !== 'talk') this._footstep(run > 0.5);
      }
      const sn = Math.sin(this._phase), cs = Math.cos(this._phase);
      const amp = lerp(0.5, 0.85, run) * mb;
      add('legL', -sn * amp, 0, 0);
      add('legR', sn * amp, 0, 0);
      add('armL', sn * amp * 0.9, 0, 0.07);
      add('armR', -sn * amp * 0.9, 0, -0.07);
      add('foreArmL', -(0.15 + run * 0.95) * mb, 0, 0);
      add('foreArmR', -(0.15 + run * 0.95) * mb, 0, 0);
      add('torso', (0.05 + run * 0.3) * mb, sn * 0.12 * mb, 0);
      add('hips', 0, -sn * 0.09 * mb, 0);
      add('head', -(0.03 + run * 0.22) * mb, -sn * 0.06 * mb, 0);
      hipsY += (Math.abs(cs) * 0.07 - 0.035) * mb * (1 + run * 0.6);
      // idle: respiração
      const br = Math.sin(time * 2.1) * (1 - mb);
      add('torso', 0.03 * br, 0, 0);
      add('head', -0.025 * br + 0.02 * Math.sin(time * 0.7) * (1 - mb), 0.06 * Math.sin(time * 0.43) * (1 - mb), 0);
      add('armL', 0, 0, (0.09 + 0.03 * br) * (1 - mb));
      add('armR', -0.1 * (1 - mb), 0, (-0.09 - 0.03 * br) * (1 - mb));
      add('foreArmR', -0.25 * (1 - mb), 0, 0);
      add('foreArmL', -0.12 * (1 - mb), 0, 0);
      hipsY += 0.008 * br;
      rate = 12;

      if (s === 'block') {
        set('armL', -1.35, -0.15, -0.45);
        set('foreArmL', -0.55, 0, 0);
        add('torso', 0.12, 0.18, 0);
        add('legL', -0.2, 0, 0.05);
        add('legR', 0.25, 0, -0.05);
        hipsY -= 0.05;
        rate = 22;
      }
      if (this.chargeT > 0.12) {
        const shake = this._chargeReady ? Math.sin(time * 45) * 0.03 : 0;
        set('armR', -0.35 + shake, -0.45, -1.05);
        set('foreArmR', -0.25, 0, 0);
        add('torso', 0.08, -0.35, 0);
        hipsY -= 0.04;
        rate = 18;
      }
      if (this._blockFlash > 0) { this._blockFlash -= dt; add('torso', -0.15, 0, 0); }
    } else if (s === 'attack' && this.atk) {
      const c = COMBO[this.atk.step];
      const p = t / c.dur;
      const a0 = c.active[0], a1 = c.active[1];
      const k = p < a0 ? 0 : p > a1 ? 1 : easeOutCubic((p - a0) / (a1 - a0));
      rate = p < a0 ? 26 : 55;
      set('legL', -0.45, 0, 0.05);
      set('legR', 0.35, 0, -0.05);
      set('armL', -0.45, 0, 0.45);
      set('foreArmL', -0.4, 0, 0);
      hipsY -= 0.07;
      if (c.kind === 'h') {
        set('armR', -0.1, lerp(-0.7, 2.5, k), -1.45);
        set('foreArmR', -0.1, 0, 0);
        set('torso', 0.12, lerp(-0.6, 0.65, k), 0);
        set('hips', 0, lerp(-0.25, 0.3, k), 0);
        set('head', -0.05, -lerp(-0.6, 0.65, k) * 0.6, 0);
      } else if (c.kind === 'b') {
        set('armR', 0.15, lerp(2.4, -0.55, k), -1.3);
        set('foreArmR', -0.15, 0, 0);
        set('torso', 0.12, lerp(0.65, -0.65, k), 0);
        set('hips', 0, lerp(0.3, -0.3, k), 0);
        set('head', -0.05, -lerp(0.65, -0.65, k) * 0.6, 0);
      } else {
        set('armR', lerp(-3.3, -0.85, k), 0, lerp(-0.15, 0.05, k));
        set('foreArmR', lerp(-0.5, 0, k), 0, 0);
        set('armL', lerp(-2.8, -0.6, k), 0, 0.2);
        set('torso', lerp(-0.25, 0.4, k), 0, 0);
        set('head', lerp(0.1, -0.3, k), 0, 0);
        set('legL', -0.65, 0, 0.05);
        set('legR', 0.45, 0, -0.05);
        hipsY -= 0.08 * k;
      }
    } else if (s === 'spin') {
      const p = clamp(t / SPIN_DUR, 0, 1);
      tumbleY = TAU * easeInOut(p);
      tumbleDirect = p < 1;
      set('armR', 0, 0.2, -1.5);
      set('foreArmR', 0, 0, 0);
      set('armL', -0.2, 0, 1.1);
      set('torso', 0.18, 0, 0);
      set('head', -0.1, 0, 0);
      set('legL', -0.1, 0, 0.35);
      set('legR', 0.1, 0, -0.35);
      hipsY -= 0.14;
      rate = 30;
    } else if (s === 'roll') {
      const p = clamp(t / ROLL_DUR, 0, 1);
      tumbleX = TAU * (p < 1 ? Math.sin(p * Math.PI / 2) ** 1.3 : 1);
      tumbleDirect = p < 1;
      tumbleH = TUMBLE_H - 0.24 * Math.sin(p * Math.PI);
      const tuck = Math.sin(Math.min(1, p * 1.25) * Math.PI);
      set('legL', -1.7 * tuck, 0, 0);
      set('legR', -1.6 * tuck, 0, 0);
      set('armL', -1.25 * tuck, 0, 0.25 * tuck);
      set('armR', -1.25 * tuck, 0, -0.25 * tuck);
      set('foreArmL', -0.8 * tuck, 0, 0);
      set('foreArmR', -0.8 * tuck, 0, 0);
      set('torso', 0.6 * tuck, 0, 0);
      set('head', 0.45 * tuck, 0, 0);
      rate = 32;
    } else if (s === 'hurt') {
      const p = clamp(t / HURT_DUR, 0, 1);
      const w = 1 - p;
      set('torso', -0.45 * w, 0, 0);
      set('head', -0.35 * w, 0, 0);
      set('armL', -0.5 * w, 0, 0.75 * w);
      set('armR', -0.5 * w, 0, -0.75 * w);
      set('legL', -0.25 * w, 0, 0);
      tumbleX = -0.28 * Math.sin(p * Math.PI);
      rate = 26; tumbleRate = 20;
    } else if (s === 'dead') {
      tumbleX = -Math.PI / 2;
      tumbleH = 0.18;
      set('armL', -0.3, 0, 1.25);
      set('armR', -0.3, 0, -1.25);
      set('legL', -0.15, 0, 0.12);
      set('legR', 0.1, 0, -0.08);
      set('head', -0.25, 0.3, 0);
      rate = 5; tumbleRate = 4.5;
    } else if (s === 'play') {
      const sw = Math.sin(time * 1.6);
      set('armR', -1.5, 0, 0.55);
      set('armL', -1.5, 0, -0.55);
      set('foreArmR', -0.95, 0, 0);
      set('foreArmL', -0.95, 0, 0);
      set('head', 0.12, 0, 0.04 * sw);
      set('torso', 0.02 + 0.02 * Math.sin(time * 2.1), 0.05 * sw, 0.04 * sw);
      set('legL', 0, 0, 0.04);
      set('legR', 0, 0, -0.04);
      hipsY = 0.01 * Math.sin(time * 2.1);
      rate = 8;
    }

    // ---- aplica
    const kf = 1 - Math.exp(-rate * dt);
    for (const n of PIVOTS) {
      const p = this.piv[n];
      if (!p) continue;
      const b = this.pivBase[n], o = T[n];
      p.rotation.x += (b.x + o[0] - p.rotation.x) * kf;
      p.rotation.y += (b.y + o[1] - p.rotation.y) * kf;
      p.rotation.z += (b.z + o[2] - p.rotation.z) * kf;
    }
    if (this.piv.hips) this.piv.hips.position.y = damp(this.piv.hips.position.y, this.hipsBaseY + hipsY, rate, dt);

    const tb = this.tumble;
    if (tumbleDirect) {
      tb.rotation.x = tumbleX; tb.rotation.y = tumbleY;
    } else {
      tb.rotation.x = dampAngle(wrapAngle(tb.rotation.x), tumbleX, tumbleRate, dt);
      tb.rotation.y = dampAngle(wrapAngle(tb.rotation.y), tumbleY, tumbleRate * 1.5, dt);
    }
    tb.position.y = damp(tb.position.y, tumbleH, s === 'roll' ? 40 : tumbleRate, dt);

    // ---- cachecol
    if (this.scarf && this.scarfBase) {
      const sp = clamp(hs / RUN_SPEED, 0, 1);
      const sx = this.scarfBase.x + sp * 0.55 + Math.sin(time * 7.5) * 0.07 * (0.35 + sp);
      const sz = this.scarfBase.z + Math.sin(time * 5.3) * 0.08 * (0.3 + sp);
      this.scarf.rotation.x = damp(this.scarf.rotation.x, sx, 8, dt);
      this.scarf.rotation.z = damp(this.scarf.rotation.z, sz, 8, dt);
    }

    // ---- brilho da espada (carga / giro)
    let glow = 0;
    if (s === 'spin') glow = 1 - 0.6 * clamp(t / SPIN_DUR, 0, 1);
    else if (this.chargeT > 0.1) {
      glow = clamp((this.chargeT - 0.1) / (CHARGE_TIME - 0.1), 0, 1) * 0.65;
      if (this._chargeReady) glow = 0.85 + 0.15 * Math.sin(time * 22);
    }
    this._glowLevel = damp(this._glowLevel || 0, glow, 20, dt);
    const gl = this._glowLevel;
    for (const sm of this._swordMats) {
      sm.m.emissive.copy(sm.e).lerp(_GLOW_COLOR, clamp(gl * 1.2, 0, 1));
      sm.m.emissiveIntensity = sm.i + gl * 1.4;
    }
    this._glow.visible = gl > 0.02 && this.sword.visible;
    this._glow.material.opacity = gl * 0.55;
    this._glow.scale.copy(this._glowScaleBase).multiplyScalar(1 + 0.15 * Math.sin(time * 30) * gl);

    // ---- visibilidade
    if (this.sword) this.sword.visible = this.hasSword && !this.playing;
    if (this.invulnT > 0 && s !== 'dead') this.model.visible = Math.floor(this.invulnT * 16) % 2 === 0;
    else this.model.visible = true;
  }

  _footstep(running) {
    if (typeof this.onFootstep === 'function') {
      try { this.onFootstep(this.position, running); } catch (e) { /* ignore */ }
    } else {
      this._sfx('step');
    }
  }

  // ------------------------------------------------------------------ trail
  _updateTrail(dt) {
    const samples = this._trailSamples;
    for (const sm of samples) sm.age += dt;
    while (samples.length && samples[samples.length - 1].age > TRAIL_LIFE) this._trailPool.push(samples.pop());

    let emit = false;
    if (this.state === 'attack' && this.atk) {
      const c = COMBO[this.atk.step];
      const p = this.stateT / c.dur;
      emit = p >= c.active[0] - 0.06 && p <= c.active[1] + 0.1;
    } else if (this.state === 'spin') {
      const p = this.stateT / SPIN_DUR;
      emit = p >= 0.02 && p <= 0.96;
    }
    if (emit && this.sword && this.sword.visible) {
      this.root.updateMatrixWorld(true);
      const sm = this._trailPool.pop() || { b: new THREE.Vector3(), t: new THREE.Vector3(), age: 0 };
      sm.age = 0;
      this.sword.localToWorld(sm.b.copy(this._bladeBase));
      this.sword.localToWorld(sm.t.copy(this._bladeTip));
      samples.unshift(sm);
      if (samples.length > TRAIL_N) this._trailPool.push(samples.pop());
    }

    const n = samples.length;
    if (n < 2) { this._trail.visible = false; return; }
    const P = this._trailPos, C = this._trailCol, col = this._trailColor;
    for (let i = 0; i < n; i++) {
      const sm = samples[i];
      const life = clamp(1 - sm.age / TRAIL_LIFE, 0, 1);
      const along = 1 - i / (n - 1 || 1);
      const a = life * (0.25 + 0.75 * along) * 0.9;
      const o = i * 6, q = i * 8;
      P[o] = sm.b.x; P[o + 1] = sm.b.y; P[o + 2] = sm.b.z;
      P[o + 3] = sm.t.x; P[o + 4] = sm.t.y; P[o + 5] = sm.t.z;
      C[q] = col.r; C[q + 1] = col.g; C[q + 2] = col.b; C[q + 3] = a * 0.15;
      C[q + 4] = col.r; C[q + 5] = col.g; C[q + 6] = col.b; C[q + 7] = a;
    }
    const g = this._trail.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
    this._trail.visible = true;
  }

  dispose() {
    this.scene?.remove?.(this.root);
    this.scene?.remove?.(this._trail);
    this._trail.geometry.dispose();
    this._trail.material.dispose();
  }
}

const _GLOW_COLOR = new THREE.Color(0.55, 0.9, 1.0);
