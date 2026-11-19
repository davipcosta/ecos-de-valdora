// Ecos de Valdora — input (teclado, mouse com pointer lock, gamepad)
// Agente D.

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  KeyJ: 'attack',
  KeyK: 'shield',
  Space: 'roll',
  KeyQ: 'lock',
  KeyE: 'interact',
  KeyF: 'instrument',
  Digit1: 'note1', Digit2: 'note2', Digit3: 'note3', Digit4: 'note4', Digit5: 'note5',
  Numpad1: 'note1', Numpad2: 'note2', Numpad3: 'note3', Numpad4: 'note4', Numpad5: 'note5',
  Escape: 'pause', KeyP: 'pause',
  KeyC: 'wisp',
};

// Gamepad "standard" mapping -> ações
// 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 dpad ↑↓←→
const PAD_BUTTONS = [
  [0, 'roll'],
  [2, 'attack'],
  [5, 'shield'],
  [4, 'lock'], [6, 'lock'],
  [3, 'interact'],
  [1, 'instrument'],
  [9, 'pause'],
  [8, 'wisp'],
  [10, 'run'],
  [12, 'note1'], [15, 'note2'], [13, 'note3'], [14, 'note4'], [7, 'note5'],
];

const MOUSE_BUTTONS = { 0: 'attack', 2: 'shield' };

const STICK_DEADZONE = 0.18;
const RIGHT_STICK_SPEED = 900; // "pixels" de mouse por segundo em deflexão total

function deadzone(x, y, dz = STICK_DEADZONE) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0, m: 0 };
  const nm = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * nm, y: (y / m) * nm, m: nm };
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas || document.getElementById('game') || document.body;

    this._keys = new Set();          // códigos físicos pressionados
    this._keyActs = new Map();       // ação -> nº de teclas segurando
    this._mouseActs = new Set();     // ações seguradas pelo mouse
    this._padActs = new Set();       // ações seguradas pelo gamepad (último poll)
    this._padPrev = new Set();
    this._pressed = new Set();       // bordas de descida neste frame (teclado/mouse)
    this._padPressed = new Set();
    this._polled = false;

    this._mdx = 0; this._mdy = 0;
    this._padLook = { x: 0, y: 0 };
    this._padMove = { x: 0, y: 0 };
    this._lastConsume = performance.now();
    this._locked = false;
    this.gamepadConnected = false;
    this.mouseSensitivity = 1;

    this._bind();
  }

  // ---------- listeners ----------
  _bind() {
    const onKeyDown = (e) => {
      const act = KEYMAP[e.code];
      if (!act) return;
      // evita rolar a página / atalhos do navegador
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      if (e.repeat || this._keys.has(e.code)) return;
      this._keys.add(e.code);
      const n = this._keyActs.get(act) || 0;
      if (n === 0 && !this._mouseActs.has(act)) this._pressed.add(act);
      this._keyActs.set(act, n + 1);
    };
    const onKeyUp = (e) => {
      const act = KEYMAP[e.code];
      if (!act || !this._keys.has(e.code)) return;
      this._keys.delete(e.code);
      const n = (this._keyActs.get(act) || 1) - 1;
      if (n <= 0) this._keyActs.delete(act); else this._keyActs.set(act, n);
    };
    const onMouseDown = (e) => {
      const act = MOUSE_BUTTONS[e.button];
      if (!act) return;
      // só conta cliques no canvas (ou com pointer lock ativo), não em botões do HUD
      if (!this._locked && e.target !== this.canvas) return;
      if (!this._mouseActs.has(act) && !this._keyActs.has(act)) this._pressed.add(act);
      this._mouseActs.add(act);
    };
    const onMouseUp = (e) => {
      const act = MOUSE_BUTTONS[e.button];
      if (act) this._mouseActs.delete(act);
    };
    const onMouseMove = (e) => {
      if (!this._locked) return;
      // alguns navegadores reportam saltos enormes ao travar; ignora outliers
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
      this._mdx += dx * this.mouseSensitivity;
      this._mdy += dy * this.mouseSensitivity;
    };
    const onLockChange = () => {
      const was = this._locked;
      this._locked = document.pointerLockElement === this.canvas;
      if (!this._locked) {
        this._mdx = 0; this._mdy = 0;
        // EXTRA: pseudo-ação 'unlock' (borda) — Esc com pointer lock costuma não gerar keydown no Chrome
        if (was) this._pressed.add('unlock');
      }
    };
    const onBlur = () => this.reset();
    const onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    window.addEventListener('gamepadconnected', () => { this.gamepadConnected = true; });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = this._getPad() != null;
    });
  }

  /** Solta tudo (perda de foco etc.). */
  reset() {
    this._keys.clear();
    this._keyActs.clear();
    this._mouseActs.clear();
    this._pressed.clear();
  }

  // ---------- gamepad ----------
  _getPad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return null; }
    if (!pads) return null;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  _poll() {
    if (this._polled) return;
    this._polled = true;
    const pad = this._getPad();
    const now = new Set();
    if (pad) {
      this.gamepadConnected = true;
      const btn = (i) => {
        const b = pad.buttons[i];
        return !!b && (b.pressed || b.value > 0.5);
      };
      for (const [i, act] of PAD_BUTTONS) if (btn(i)) now.add(act);
      const ax = pad.axes || [];
      const mv = deadzone(ax[0] || 0, ax[1] || 0);
      this._padMove = { x: mv.x, y: -mv.y };
      if (mv.y < -0.5) now.add('forward');
      if (mv.y > 0.5) now.add('back');
      if (mv.x < -0.5) now.add('left');
      if (mv.x > 0.5) now.add('right');
      const lk = deadzone(ax[2] || 0, ax[3] || 0);
      // curva levemente exponencial para precisão
      this._padLook = { x: lk.x * Math.abs(lk.x) ** 0.5, y: lk.y * Math.abs(lk.y) ** 0.5 };
    } else {
      this._padMove = { x: 0, y: 0 };
      this._padLook = { x: 0, y: 0 };
    }
    this._padPressed.clear();
    for (const a of now) if (!this._padPrev.has(a)) this._padPressed.add(a);
    this._padPrev = now;
    this._padActs = now;
  }

  // ---------- API ----------
  isDown(action) {
    this._poll();
    return this._keyActs.has(action) || this._mouseActs.has(action) || this._padActs.has(action);
  }

  pressed(action) {
    this._poll();
    return this._pressed.has(action) || this._padPressed.has(action);
  }

  endFrame() {
    this._poll(); // garante que bordas do gamepad deste frame foram registradas
    this._pressed.clear();
    this._padPressed.clear();
    this._polled = false;
  }

  consumeMouse() {
    this._poll();
    const t = performance.now();
    const dt = Math.min(0.1, Math.max(0, (t - this._lastConsume) / 1000));
    this._lastConsume = t;
    const out = {
      x: this._mdx + this._padLook.x * RIGHT_STICK_SPEED * dt,
      y: this._mdy + this._padLook.y * RIGHT_STICK_SPEED * dt,
    };
    this._mdx = 0; this._mdy = 0;
    return out;
  }

  /** EXTRA: vetor de movimento analógico. x: direita +, y: frente +. Magnitude ≤ 1. */
  getMove() {
    this._poll();
    let kx = 0, ky = 0;
    if (this._keyActs.has('right')) kx += 1;
    if (this._keyActs.has('left')) kx -= 1;
    if (this._keyActs.has('forward')) ky += 1;
    if (this._keyActs.has('back')) ky -= 1;
    const km = Math.hypot(kx, ky);
    if (km > 1) { kx /= km; ky /= km; }
    const pm = Math.hypot(this._padMove.x, this._padMove.y);
    if (pm > Math.hypot(kx, ky)) return { x: this._padMove.x, y: this._padMove.y };
    return { x: kx, y: ky };
  }

  get pointerLocked() { return this._locked; }

  requestLock() {
    if (this._locked || !this.canvas.requestPointerLock) return;
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          // unadjustedMovement não suportado em alguns SOs: tenta sem
          try {
            const r2 = this.canvas.requestPointerLock();
            if (r2 && typeof r2.catch === 'function') r2.catch(() => {});
          } catch { /* ignora */ }
        });
      }
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* ignora */ }
    }
  }

  exitLock() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
}
