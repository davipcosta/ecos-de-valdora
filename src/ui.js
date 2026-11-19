// Ecos de Valdora — HUD em DOM. Estilos ficam em index.html (tokens CSS em :root).
// Agente D.

const NOTE_COLORS = ['var(--note-0)', 'var(--note-1)', 'var(--note-2)', 'var(--note-3)', 'var(--note-4)'];
const NOTE_HEX = ['#ffd25a', '#63e0a6', '#5fb4ff', '#ff7f9e', '#c99bff'];
const NOTE_KEYS = ['1', '2', '3', '4', '5'];

const HEART_PATH = 'M12 21.4l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.4z';

const CONTROLS = [
  ['WASD / Setas', 'Mover'],
  ['Mouse', 'Câmera'],
  ['Shift', 'Correr'],
  ['Espaço', 'Rolar'],
  ['J / Clique', 'Atacar (segure: giro)'],
  ['K / Botão dir.', 'Escudo'],
  ['Q', 'Mirar no alvo'],
  ['E', 'Interagir / Falar'],
  ['F', 'Flauta dos Ventos'],
  ['1 – 5', 'Notas da flauta'],
  ['C', 'Falar com Lume'],
  ['Esc / P', 'Pausar'],
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function heartSVG(fill, stroke) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>` +
    (fill.startsWith('url') ? '<path d="M6.2 6.2c1.2-1.1 3-1 3.9.2" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.6" stroke-linecap="round"/>' : '') + '</svg>';
}

const GEM_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true"><polygon points="10,1 17,7 10,19 3,7" fill="var(--gem)" stroke="#0b3b1b" stroke-width="1.3" stroke-linejoin="round"/><polygon points="10,1 13,7 10,19 7,7" fill="#b7ffcb" opacity=".55"/><polygon points="3,7 17,7 10,1" fill="#fff" opacity=".25"/></svg>`;
const KEY_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="10" r="4" fill="none" stroke="var(--key)" stroke-width="2.6"/><path d="M10 10h8M15 10v3.5M17.5 10v2.5" stroke="var(--key)" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const STAR_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="vd-emb" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#fffbe8"/><stop offset=".45" stop-color="#ffe39a"/><stop offset="1" stop-color="#a8792a"/></radialGradient></defs><path d="M50 4 L61 38 L96 50 L61 62 L50 96 L39 62 L4 50 L39 38 Z" fill="url(#vd-emb)" stroke="#5a3d10" stroke-width="2"/><circle cx="50" cy="50" r="9" fill="#fff" opacity=".9"/></svg>`;

/** pauta com notas (para modais e para o instrumento) */
function buildStaff() {
  const staff = el('div', 'staff');
  for (let k = 0; k < 5; k++) {
    const line = el('div', 'staff-line');
    line.style.top = `${15 + k * 17.5}%`;
    staff.appendChild(line);
  }
  const notes = el('div', 'staff-notes');
  staff.appendChild(notes);
  return { staff, notes };
}

function noteGlyph(i) {
  const g = el('div', 'note-glyph', `<span>${NOTE_KEYS[i] || '?'}</span>`);
  g.style.background = NOTE_COLORS[i];
  g.style.color = NOTE_HEX[i];
  g.style.top = `${15 + (4 - i) * 17.5}%`; // nota 0 na linha de baixo, 4 na de cima
  return g;
}

export class UI {
  constructor() {
    this.root = document.getElementById('hud');
    if (!this.root) {
      this.root = el('div');
      this.root.id = 'hud';
      document.body.appendChild(this.root);
    }
    this.root.innerHTML = '';
    this.onDialogChar = null; // EXTRA: callback opcional (ex.: () => audio.sfx('talk'))

    this._buildDefs();
    this._buildHUD();
    this._buildDialog();
    this._buildStaff();

    this._hp = -1; this._maxHearts = -1;
    this._gems = -1; this._keys = -1;
    this._prompt = undefined;
    this._clockKey = '';
    this._dlg = null;
    this._dlgQueue = [];
    this._modalCount = 0;
    this._modalChain = Promise.resolve();
    this._confirm = [];   // pilha de handlers de confirmação {keys, click, fn}
    this._padPrev = false;
    this._padRAF = 0;
    this._toasts = [];
    this._lockShown = false;

    this._bindConfirm();
  }

  // ================================================================ construção
  _buildDefs() {
    const defs = el('div');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    defs.innerHTML = `<svg width="0" height="0" aria-hidden="true"><defs>
      <linearGradient id="vd-heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--heart-hi)"/><stop offset=".45" stop-color="var(--heart)"/><stop offset="1" stop-color="#b3132a"/></linearGradient>
    </defs></svg>`;
    this.root.appendChild(defs);
  }

  _buildHUD() {
    this.hudLayer = el('div', 'hud-layer');
    this.root.appendChild(this.hudLayer);

    // canto superior esquerdo
    const tl = el('div', 'hud-tl');
    this.heartsEl = el('div', 'hearts');
    this.heartsEl.setAttribute('aria-label', 'Vida');
    const counters = el('div', 'counters');
    this.gemsEl = el('div', 'counter gems', `${GEM_SVG}<span>000</span>`);
    this.keysEl = el('div', 'counter keys hud-hidden', `${KEY_SVG}<span>×0</span>`);
    counters.append(this.gemsEl, this.keysEl);
    tl.append(this.heartsEl, counters);

    // canto superior direito
    const tr = el('div', 'hud-tr');
    const hints = el('div', 'hints');
    hints.innerHTML = [['J', 'Atacar'], ['K', 'Escudo'], ['F', 'Flauta']]
      .map(([k, t]) => `<div class="hint"><span class="key">${k}</span>${t}</div>`).join('');
    this.promptEl = el('div', 'prompt hud-hidden');
    tr.append(hints, this.promptEl);

    // canto inferior direito: minimapa + relógio
    const br = el('div', 'hud-br');
    const wrap = el('div', 'minimap-wrap');
    this.mapCanvas = el('canvas', 'minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    wrap.append(this.mapCanvas, el('div', 'minimap-n', 'N'));
    this.clockEl = el('div', 'clock');
    this.clockEl.innerHTML = `<svg viewBox="0 0 64 44" aria-hidden="true">
        <path class="ck-arc" d="M6 38 A26 26 0 0 1 58 38" fill="none" stroke="rgba(233,196,106,.55)" stroke-width="2.5" stroke-dasharray="3 3"/>
        <line x1="2" y1="38" x2="62" y2="38" stroke="rgba(245,239,224,.5)" stroke-width="1.5"/>
        <g class="ck-icon"></g></svg><div class="clock-time">06:00</div>`;
    this.clockIcon = this.clockEl.querySelector('.ck-icon');
    this.clockArc = this.clockEl.querySelector('.ck-arc');
    this.clockTime = this.clockEl.querySelector('.clock-time');
    br.append(this.clockEl, wrap);

    // banner, toasts, retícula, barra do chefe
    this.bannerEl = el('div', 'banner', '<div class="banner-title"></div><div class="banner-line"></div><div class="banner-sub"></div>');
    this.toastsEl = el('div', 'toasts');
    this.reticleEl = el('div', 'reticle hud-hidden');
    this.reticleEl.innerHTML = `<svg viewBox="-50 -50 100 100" aria-hidden="true">${[0, 120, 240].map((a) =>
      `<g transform="rotate(${a})"><path d="M0 -44 L-11 -30 L11 -30 Z" fill="var(--gold)" stroke="#3a2a08" stroke-width="2.5" stroke-linejoin="round"/><path d="M0 -38 L-5 -32 L5 -32 Z" fill="var(--gold-bright)"/></g>`).join('')}
      <circle r="5" fill="none" stroke="var(--gold-bright)" stroke-width="2" opacity=".7"/></svg>`;
    this.bossEl = el('div', 'bossbar hud-hidden', '<div class="bossbar-name"></div><div class="bossbar-frame"><div class="bossbar-lag"></div><div class="bossbar-fill"></div></div>');
    this.bossName = this.bossEl.querySelector('.bossbar-name');
    this.bossFill = this.bossEl.querySelector('.bossbar-fill');
    this.bossLag = this.bossEl.querySelector('.bossbar-lag');

    this.hudLayer.append(tl, tr, br, this.bannerEl, this.toastsEl, this.reticleEl, this.bossEl);
    this._sizeMinimap();
    window.addEventListener('resize', () => this._sizeMinimap());
  }

  _buildDialog() {
    this.dialogEl = el('div', 'dialog hud-hidden');
    this.dialogEl.innerHTML = '<div class="dialog-panel"><div class="dialog-name"></div><div class="dialog-text"></div><div class="dialog-next">▼</div></div>';
    this.dlgName = this.dialogEl.querySelector('.dialog-name');
    this.dlgText = this.dialogEl.querySelector('.dialog-text');
    this.dlgNext = this.dialogEl.querySelector('.dialog-next');
    this.root.appendChild(this.dialogEl);
  }

  _buildStaff() {
    this.staffPanel = el('div', 'staff-panel hud-hidden');
    const title = el('div', 'staff-title', 'Flauta dos Ventos');
    const { staff, notes } = buildStaff();
    this.staffNotes = notes;
    const legend = el('div', 'staff-legend');
    legend.innerHTML = NOTE_KEYS.map((k, i) =>
      `<span class="legend-item"><span class="key" style="background:${NOTE_COLORS[i]}">${k}</span></span>`).join('') +
      '<span class="legend-item legend-close"><span class="key">F</span>guardar</span>';
    this.staffPanel.append(title, staff, legend);
    this.root.appendChild(this.staffPanel);
    this._notes = [];
  }

  /** EXTRA: esconde/mostra a camada de jogo (corações, mapa, etc.) */
  setHudVisible(v) { this.hudLayer.classList.toggle('hud-hidden', !v); }

  // ================================================================ corações / contadores
  setHearts(hpHalves, maxHearts) {
    hpHalves = Math.max(0, Math.round(hpHalves || 0));
    maxHearts = Math.max(1, Math.round(maxHearts || 3));
    if (hpHalves === this._hp && maxHearts === this._maxHearts) return;
    if (maxHearts !== this._maxHearts) {
      this.heartsEl.innerHTML = '';
      for (let k = 0; k < maxHearts; k++) {
        const h = el('div', 'heart empty');
        h.innerHTML = heartSVG('var(--heart-empty)', 'var(--heart-stroke)') + `<div class="h-fill">${heartSVG('url(#vd-heart)', 'var(--heart-stroke)')}</div>`;
        this.heartsEl.appendChild(h);
      }
    }
    const prev = this._hp;
    const low = hpHalves > 0 && hpHalves <= 2;
    [...this.heartsEl.children].forEach((h, k) => {
      const v = Math.max(0, Math.min(2, hpHalves - k * 2));
      const before = prev < 0 ? v : Math.max(0, Math.min(2, prev - k * 2));
      h.classList.toggle('empty', v === 0);
      h.classList.toggle('half', v === 1);
      h.classList.toggle('low', low && v > 0);
      if (v !== before && !low) {
        h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump');
      }
    });
    this._hp = hpHalves; this._maxHearts = maxHearts;
    this.heartsEl.setAttribute('aria-label', `Vida: ${hpHalves / 2} de ${maxHearts} corações`);
  }

  _pop(e) { e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }

  setGems(n) {
    n = Math.max(0, n | 0);
    if (n === this._gems) return;
    const first = this._gems < 0;
    this._gems = n;
    this.gemsEl.querySelector('span').textContent = String(n).padStart(3, '0');
    if (!first) this._pop(this.gemsEl);
  }

  setKeys(n) {
    n = Math.max(0, n | 0);
    if (n === this._keys) return;
    const first = this._keys < 0;
    this._keys = n;
    this.keysEl.querySelector('span').textContent = `×${n}`;
    this.keysEl.classList.toggle('hud-hidden', n === 0);
    if (!first) this._pop(this.keysEl);
  }

  // ================================================================ prompt de ação
  showPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    if (!text) { this.promptEl.classList.add('hud-hidden'); return; }
    // tecla = 1ª palavra curta seguida de 2+ espaços ("E  Falar"), como no contrato.
    // Evita que frases comuns ("Porta selada — ...") virem uma tecla.
    const m = /^\s*(\S{1,6})\s{2,}(.+)$/.exec(text);
    this.promptEl.innerHTML = m ? `<span class="key">${esc(m[1])}</span><span>${esc(m[2])}</span>` : `<span>${esc(text)}</span>`;
    this.promptEl.classList.remove('hud-hidden');
    this.promptEl.style.animation = 'none'; void this.promptEl.offsetWidth; this.promptEl.style.animation = '';
  }

  // ================================================================ diálogo
  showDialog(speaker, pages) {
    if (!Array.isArray(pages)) pages = [String(pages ?? '')];
    if (!pages.length) pages = [''];
    return new Promise((resolve) => {
      const item = { speaker, pages, resolve };
      if (this._dlg) this._dlgQueue.push(item);
      else this._openDialog(item); // abre já (síncrono): isDialogOpen() é true logo após a chamada
    });
  }

  _openDialog({ speaker, pages, resolve }) {
    this._dlg = { speaker, pages, idx: 0, resolve, opened: performance.now() };
    this.dlgName.textContent = speaker || '';
    this.dlgName.classList.toggle('hud-hidden', !speaker);
    this.dialogEl.classList.remove('hud-hidden');
    requestAnimationFrame(() => { if (this._dlg) this.dialogEl.classList.add('show'); });
    this._startPage();
  }

  isDialogOpen() { return !!this._dlg; }

  advanceDialog() {
    const d = this._dlg;
    if (!d) return;
    if (performance.now() - d.opened < 150) return; // evita pular com a mesma tecla que abriu
    if (d.typing) { this._finishTyping(); return; }
    d.idx++;
    if (d.idx < d.pages.length) { this._startPage(); return; }
    // fecha
    cancelAnimationFrame(d.raf);
    this._dlg = null;
    if (this._dlgQueue.length) { this._openDialog(this._dlgQueue.shift()); d.resolve(); return; }
    this.dialogEl.classList.remove('show');
    setTimeout(() => { if (!this._dlg) this.dialogEl.classList.add('hud-hidden'); }, 200);
    d.resolve();
  }

  _parseRich(text) {
    // *texto* -> destaque dourado
    const segs = [];
    String(text).split('*').forEach((s, k) => { if (s) segs.push({ s, hl: k % 2 === 1 }); });
    return segs;
  }

  _renderTyped(segs, n) {
    let out = '', left = n;
    for (const { s, hl } of segs) {
      if (left <= 0) break;
      const part = s.slice(0, left);
      left -= part.length;
      out += hl ? `<span class="hl">${esc(part)}</span>` : esc(part);
    }
    this.dlgText.innerHTML = out;
  }

  _startPage() {
    const d = this._dlg;
    const segs = this._parseRich(d.pages[d.idx]);
    const total = segs.reduce((a, b) => a + b.s.length, 0);
    d.segs = segs; d.total = total; d.shown = 0; d.typing = true;
    d.opened = Math.max(d.opened, performance.now() - 1000);
    this.dlgNext.classList.remove('show');
    this.dlgText.innerHTML = '';
    const CPS = 48;
    let last = performance.now(), acc = 0, sinceBlip = 0;
    const step = (now) => {
      if (this._dlg !== d || !d.typing) return;
      acc += ((now - last) / 1000) * CPS; last = now;
      const add = Math.floor(acc);
      if (add > 0) {
        acc -= add;
        const prevShown = d.shown;
        d.shown = Math.min(total, d.shown + add);
        this._renderTyped(segs, d.shown);
        sinceBlip += d.shown - prevShown;
        if (this.onDialogChar && sinceBlip >= 3) { sinceBlip = 0; try { this.onDialogChar(); } catch { /* */ } }
      }
      if (d.shown >= total) { this._finishTyping(); return; }
      d.raf = requestAnimationFrame(step);
    };
    d.raf = requestAnimationFrame(step);
  }

  _finishTyping() {
    const d = this._dlg;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    d.typing = false; d.shown = d.total;
    this._renderTyped(d.segs, d.total);
    this.dlgNext.classList.add('show');
  }

  // ================================================================ banner / toast
  showBanner(title, subtitle) {
    const t = this.bannerEl;
    t.querySelector('.banner-title').textContent = title || '';
    const sub = t.querySelector('.banner-sub');
    sub.textContent = subtitle || '';
    sub.style.display = subtitle ? '' : 'none';
    clearTimeout(this._bannerT);
    t.classList.remove('show'); void t.offsetWidth;
    t.classList.add('show');
    this._bannerT = setTimeout(() => t.classList.remove('show'), 3200);
  }

  toast(text) {
    const e = el('div', 'toast');
    e.textContent = text;
    this.toastsEl.appendChild(e);
    this._toasts.push(e);
    while (this._toasts.length > 4) this._toasts.shift().remove();
    setTimeout(() => {
      e.classList.add('out');
      setTimeout(() => { e.remove(); this._toasts = this._toasts.filter((x) => x !== e); }, 420);
    }, 2600);
  }

  // ================================================================ instrumento
  showInstrument(open) {
    this.root.classList.toggle('instrument-open', !!open);
    if (open) {
      this.staffPanel.classList.remove('hud-hidden');
      requestAnimationFrame(() => this.staffPanel.classList.add('show'));
    } else {
      this.staffPanel.classList.remove('show');
      clearTimeout(this._staffT);
      this._staffT = setTimeout(() => { if (!this.staffPanel.classList.contains('show')) this.staffPanel.classList.add('hud-hidden'); }, 260);
    }
  }

  pushNote(i) {
    i = Math.max(0, Math.min(4, i | 0));
    const g = noteGlyph(i);
    g.classList.add('enter');
    this.staffNotes.appendChild(g);
    this._notes.push(g);
    while (this._notes.length > 8) this._notes.shift().remove();
    this._notes.forEach((n, k) => { n.style.left = `${((k + 0.5) / 8) * 100}%`; });
  }

  clearNotes() {
    this._notes.forEach((n) => n.remove());
    this._notes = [];
  }

  // ================================================================ modais
  /** EXTRA: true enquanto um modal (item/canção) estiver aberto ou na fila */
  isModalOpen() { return this._modalCount > 0; }

  _modal(build, minDelay = 650) {
    this._modalCount++;
    const run = () => new Promise((resolve) => {
      const back = el('div', 'modal-back');
      const box = el('div', 'modal');
      build(box);
      const foot = el('div', 'modal-foot', 'Pressione <span class="key">Enter</span> ou <span class="key">E</span> para continuar');
      box.appendChild(foot);
      back.appendChild(box);
      this.root.appendChild(back);
      const t0 = performance.now();
      const done = () => {
        if (performance.now() - t0 < minDelay) return false;
        back.style.transition = 'opacity .2s'; back.style.opacity = '0';
        setTimeout(() => back.remove(), 220);
        this._modalCount--;
        resolve();
        return true;
      };
      this._pushConfirm({ keys: ['Enter', 'NumpadEnter', 'Space', 'KeyE', 'KeyJ'], click: true, fn: done });
    });
    const p = this._modalChain.then(run);
    this._modalChain = p.catch(() => {});
    return p;
  }

  showSongLearned(name, notes) {
    return this._modal((box) => {
      box.appendChild(el('div', 'modal-kicker', 'Você aprendeu a'));
      box.appendChild(el('div', 'modal-title', esc(name)));
      const { staff, notes: lay } = buildStaff();
      (notes || []).forEach((n, k, arr) => {
        const g = noteGlyph(n);
        g.style.left = `${((k + 0.5) / arr.length) * 100}%`;
        g.style.animationDelay = `${0.15 + k * 0.12}s`;
        g.classList.add('enter');
        g.style.animationFillMode = 'backwards';
        lay.appendChild(g);
      });
      box.appendChild(staff);
      const seq = (notes || []).map((n) => `<span class="key" style="background:${NOTE_COLORS[n]}">${NOTE_KEYS[n]}</span>`).join(' ');
      box.appendChild(el('div', 'modal-desc', `Toque com a flauta (<span class="key">F</span>):<br>${seq}`));
    }, 900);
  }

  showItemGet(title, desc) {
    return this._modal((box) => {
      box.appendChild(el('div', 'emblem', STAR_SVG));
      box.appendChild(el('div', 'modal-kicker', 'Você obteve'));
      box.appendChild(el('div', 'modal-title', esc(title)));
      if (desc) box.appendChild(el('div', 'modal-desc', esc(desc)));
    });
  }

  // ---------- confirmação (teclado / clique / gamepad) para modais e telas
  _pushConfirm(h) {
    this._confirm.push(h);
    this._startPadPoll();
  }

  _popConfirm(h) {
    this._confirm = this._confirm.filter((x) => x !== h);
  }

  _fireConfirm() {
    const h = this._confirm[this._confirm.length - 1];
    if (h && h.fn() !== false) this._popConfirm(h);
  }

  _bindConfirm() {
    // fase de captura na window: consome o evento para o Input não ver a mesma tecla
    window.addEventListener('keydown', (e) => {
      const h = this._confirm[this._confirm.length - 1];
      if (!h || !h.keys.includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this._fireConfirm();
    }, true);
    window.addEventListener('mousedown', (e) => {
      const h = this._confirm[this._confirm.length - 1];
      if (!h || !h.click || e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.stopPropagation();
      this._fireConfirm();
    }, true);
  }

  _startPadPoll() {
    if (this._padRAF) return;
    const loop = () => {
      if (!this._confirm.length) { this._padRAF = 0; return; }
      let down = false;
      try {
        for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) {
          if (!p) continue;
          for (const b of [0, 2, 3, 9]) if (p.buttons[b] && p.buttons[b].pressed) down = true;
        }
      } catch { /* */ }
      if (down && !this._padPrev) this._fireConfirm();
      this._padPrev = down;
      this._padRAF = requestAnimationFrame(loop);
    };
    // começa assumindo "pressionado" para não confirmar com o botão que abriu
    this._padPrev = true;
    this._padRAF = requestAnimationFrame(loop);
  }

  // ================================================================ retícula / chefe
  setLockOn(x, y) {
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) {
      if (this._lockShown) { this.reticleEl.classList.add('hud-hidden'); this._lockShown = false; }
      return;
    }
    if (!this._lockShown) {
      this._lockShown = true;
      this.reticleEl.classList.remove('hud-hidden', 'enter');
      void this.reticleEl.offsetWidth;
      this.reticleEl.classList.add('enter');
    }
    this.reticleEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  showBossBar(name, frac) {
    if (frac == null) { this.bossEl.classList.add('hud-hidden'); this._bossFrac = null; return; }
    frac = Math.max(0, Math.min(1, frac));
    this.bossEl.classList.remove('hud-hidden');
    if (name != null && name !== this._bossName) { this._bossName = name; this.bossName.textContent = name; }
    if (frac !== this._bossFrac) {
      this._bossFrac = frac;
      this.bossFill.style.width = `${frac * 100}%`;
      this.bossLag.style.width = `calc(${frac * 100}% - 4px)`;
    }
  }

  // ================================================================ minimapa / relógio
  _sizeMinimap() {
    const css = this.mapCanvas.getBoundingClientRect().width || 140;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._mapCss = css;
    this.mapCanvas.width = Math.round(css * dpr);
    this.mapCanvas.height = Math.round(css * dpr);
    this._mapDpr = dpr;
    if (this._lastMap) this.updateMinimap(...this._lastMap);
  }

  /** Norte para cima (world -Z = cima, +X = direita). Escala: 1px (base 140px) = 1,5 m; raio 70px ≈ 105 m. */
  updateMinimap(px, pz, yaw, markers) {
    this._lastMap = [px, pz, yaw, markers];
    const c = this.mapCtx, W = this.mapCanvas.width;
    if (!W) return;
    const R = W / 2;
    const k = W / 140;                // fator do tamanho atual vs base 140px
    const s = k / 1.5;                // px por metro
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();

    const bg = c.createRadialGradient(R, R * 0.8, R * 0.1, R, R, R);
    bg.addColorStop(0, 'rgba(46, 84, 72, 0.92)');
    bg.addColorStop(1, 'rgba(14, 28, 30, 0.92)');
    c.fillStyle = bg; c.fillRect(0, 0, W, W);

    // grade em coordenadas do mundo (linhas a cada 25 m), alinhada ao norte
    c.strokeStyle = 'rgba(233, 196, 106, 0.12)';
    c.lineWidth = 1 * k;
    const step = 25;
    const x0 = Math.floor((px - 110) / step) * step, z0 = Math.floor((pz - 110) / step) * step;
    c.beginPath();
    for (let gx = x0; gx <= px + 110; gx += step) { const sx = R + (gx - px) * s; c.moveTo(sx, 0); c.lineTo(sx, W); }
    for (let gz = z0; gz <= pz + 110; gz += step) { const sy = R + (gz - pz) * s; c.moveTo(0, sy); c.lineTo(W, sy); }
    c.stroke();
    c.strokeStyle = 'rgba(233, 196, 106, 0.18)';
    c.beginPath(); c.arc(R, R, R * 0.5, 0, Math.PI * 2); c.stroke();

    // marcadores
    for (const m of markers || []) {
      if (!m || !isFinite(m.x) || !isFinite(m.z)) continue;
      let dx = (m.x - px) * s, dy = (m.z - pz) * s;
      const d = Math.hypot(dx, dy);
      const edge = R - 7 * k;
      const out = d > edge;
      if (out) { dx = (dx / d) * edge; dy = (dy / d) * edge; }
      const r = (m.size || 4) * k * (out ? 0.75 : 1);
      c.globalAlpha = out ? 0.75 : 1;
      c.fillStyle = m.color || '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.lineWidth = 1.5 * k;
      c.beginPath();
      if (out) {
        // seta apontando para fora
        const a = Math.atan2(dy, dx);
        c.moveTo(R + dx + Math.cos(a) * r * 1.4, R + dy + Math.sin(a) * r * 1.4);
        c.lineTo(R + dx + Math.cos(a + 2.3) * r, R + dy + Math.sin(a + 2.3) * r);
        c.lineTo(R + dx + Math.cos(a - 2.3) * r, R + dy + Math.sin(a - 2.3) * r);
        c.closePath();
      } else {
        c.arc(R + dx, R + dy, r, 0, Math.PI * 2);
      }
      c.fill(); c.stroke();
    }
    c.globalAlpha = 1;

    // jogador: frente do modelo = (sin yaw, cos yaw) em (x, z) => ângulo de tela = π - yaw
    c.translate(R, R);
    c.rotate(Math.PI - (yaw || 0));
    const a = 9 * k;
    c.fillStyle = 'rgba(255, 255, 255, 0.12)';
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, a * 3.2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(0, -a); c.lineTo(a * 0.7, a * 0.75); c.lineTo(0, a * 0.35); c.lineTo(-a * 0.7, a * 0.75); c.closePath();
    c.fillStyle = '#ffe39a'; c.strokeStyle = '#3a2a08'; c.lineWidth = 2 * k;
    c.fill(); c.stroke();
    c.restore();

    // vinheta interna
    const v = c.createRadialGradient(R, R, R * 0.7, R, R, R);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v;
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.fill();
  }

  setClock(t) {
    t = ((+t % 1) + 1) % 1;
    const mins = Math.floor(t * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(Math.floor((mins % 60) / 10) * 10).padStart(2, '0');
    const day = t >= 0.25 && t < 0.75;
    const key = `${hh}:${mm}|${day}|${Math.round(t * 200)}`;
    if (key === this._clockKey) return;
    this._clockKey = key;
    this.clockTime.textContent = `${hh}:${mm}`;
    const frac = day ? (t - 0.25) / 0.5 : (((t - 0.75) + 1) % 1) / 0.5;
    const ang = Math.PI * (1 - frac);
    const x = 32 + Math.cos(ang) * 26, y = 38 - Math.sin(ang) * 26;
    if (day !== this._clockDay) {
      this._clockDay = day;
      this.clockArc.setAttribute('stroke', day ? 'rgba(233,196,106,.6)' : 'rgba(150,180,255,.55)');
      this.clockIcon.innerHTML = day
        ? `<g stroke="#ffcf4a" stroke-width="2" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((r) =>
            `<line x1="0" y1="-9" x2="0" y2="-12" transform="rotate(${r})"/>`).join('')}</g><circle r="6.5" fill="#ffd95a" stroke="#a8792a" stroke-width="1.5"/>`
        : '<circle r="7" fill="#e8eeff" stroke="#6b7bb0" stroke-width="1.2"/><circle cx="3.6" cy="-2.4" r="6" fill="#1b2340"/>';
    }
    this.clockIcon.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  }

  // ================================================================ telas
  _controlsHTML() {
    return `<div class="controls">${CONTROLS.map(([k, d]) => `<div><b>${k}</b>${d}</div>`).join('')}</div>`;
  }

  showTitle() {
    return new Promise((resolve) => {
      this.setHudVisible(false);
      const scr = el('div', 'screen title-screen');
      const motes = el('div', 'motes');
      for (let k = 0; k < 26; k++) {
        const m = el('div', 'mote');
        m.style.left = `${Math.random() * 100}%`;
        m.style.animationDuration = `${9 + Math.random() * 12}s`;
        m.style.animationDelay = `${-Math.random() * 20}s`;
        m.style.setProperty('--drift', `${(Math.random() - 0.5) * 140}px`);
        const sz = 3 + Math.random() * 6;
        m.style.width = m.style.height = `${sz}px`;
        motes.appendChild(m);
      }
      scr.appendChild(motes);
      scr.insertAdjacentHTML('beforeend', `
        <div class="logo"><small>✦ ✦ ✦</small>Ecos de Valdora</div>
        <div class="logo-rule"></div>
        <div class="logo-sub">Uma aventura nos ecos do vento</div>
        <div class="press-start">Pressione Enter ou clique para começar</div>
        ${this._controlsHTML()}
        <div class="title-foot">Gamepad: analógicos movem e giram a câmera · A rolar · X atacar · RB escudo · LB/LT mirar · Y interagir · B flauta</div>`);
      this.root.appendChild(scr);
      const t0 = performance.now();
      const h = {
        keys: ['Enter', 'NumpadEnter', 'Space'], click: true,
        fn: () => {
          if (performance.now() - t0 < 300) return false;
          scr.classList.add('out');
          setTimeout(() => scr.remove(), 500);
          this.setHudVisible(true);
          resolve();
          return true;
        },
      };
      this._pushConfirm(h);
    });
  }

  showGameOver() {
    this.setLockOn(null);
    return new Promise((resolve) => {
      const scr = el('div', 'screen gameover-screen');
      scr.innerHTML = `<div class="gameover-title">Você caiu...</div>
        <div class="logo-sub" style="margin-top:12px">Mas os ventos de Valdora ainda chamam por você.</div>
        <button class="btn" type="button">Continuar</button>
        <div class="btn-hint">ou pressione Enter</div>`;
      this.root.appendChild(scr);
      const btn = scr.querySelector('button');
      const t0 = performance.now();
      let closed = false;
      const finish = () => {
        if (closed || performance.now() - t0 < 900) return false;
        closed = true;
        this._popConfirm(h);
        scr.classList.add('out');
        setTimeout(() => scr.remove(), 500);
        resolve();
        return true;
      };
      const h = { keys: ['Enter', 'NumpadEnter', 'Space', 'KeyE'], click: false, fn: finish };
      btn.addEventListener('click', finish);
      this._pushConfirm(h);
      setTimeout(() => { try { btn.focus({ preventScroll: true }); } catch { /* */ } }, 50);
    });
  }

  showVictory() {
    this.showBossBar(null, null);
    this.setLockOn(null);
    const scr = el('div', 'screen victory-screen');
    scr.innerHTML = `<div class="credits">
      <h1>Fim</h1>
      <p class="lead">O Guardião Musgoso repousa, e a raiz do santuário volta a cantar.</p>
      <p class="lead">Os ventos de Valdora sopram em paz mais uma vez.</p>
      <h2>Ecos de Valdora</h2>
      <p>Uma aventura original nos ecos do vento</p>
      <h2>Mundo e Modelos</h2><p>Esculpidos em polígonos, à mão, por código</p>
      <h2>Música e Sons</h2><p>Sintetizados ao vivo pelo seu navegador</p>
      <h2>Elenco</h2><p>Orvo, o ancião · Mira, guardiã do bosque<br>Tila · Brom, o mercador · Lume, a luz companheira</p>
      <h2>E você</h2><p>Obrigado por jogar!</p>
      <button class="btn" type="button">Jogar novamente</button>
    </div>`;
    scr.querySelector('button').addEventListener('click', () => location.reload());
    this.root.appendChild(scr);
  }

  setPaused(p) {
    if (p) {
      if (this._pauseEl) return;
      const scr = el('div', 'screen pause-screen');
      scr.innerHTML = `<div class="pause-title">Pausado</div>
        <div class="logo-sub" style="margin-top:6px">Pressione <span class="key">Esc</span> ou <span class="key">P</span> — ou clique — para continuar</div>
        ${this._controlsHTML()}`;
      this.root.appendChild(scr);
      this._pauseEl = scr;
    } else if (this._pauseEl) {
      const e = this._pauseEl;
      this._pauseEl = null;
      e.classList.add('out');
      setTimeout(() => e.remove(), 400);
    }
  }
}
