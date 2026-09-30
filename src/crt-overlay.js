/*
 * <crt-overlay> — CRT-накладка поверх обычной HTML-страницы, без WebGL.
 * Постоянно: строки развёртки, RGB-маска, виньетка, мерцание.
 * При загрузке и переходах: рывок строк и разъезд цветов (SVG-фильтр на живой вёрстке).
 *
 * Использование — один тег перед </body>, лучше в общем шаблоне сайта:
 *   <crt-overlay preset='{"tear":40,"ca":4}' links="true"></crt-overlay>
 *   <script type="module" src="/js/crt-overlay.js"></script>
 *
 * Атрибуты (все необязательные):
 *   preset    JSON со всеми параметрами сразу (из студии)
 *   tear      сила рывка строк при глитче, px                (40)
 *   ca        разъезд цветов при глитче, px                  (4)
 *   duration  длительность глитча при появлении, мс          (900)
 *   fade      "true" — появление из чёрного                  (true)
 *   scan      заметность строк развёртки, 0…1                (0.35)
 *   mask      заметность RGB-маски, 0…1                      (0)
 *   pixel     шаг строк и маски, px                          (3)
 *   vignette  затемнение по краям, 0…1                       (0.35)
 *   flicker   мерцание и бегущая полоса, 0…1                 (0.15)
 *   idle      частота случайных микро-глитчей, 0…1           (0)
 *   trigger   load | none                                    (load)
 *   links     "true" — глитч при переходе по внутренним ссылкам (false)
 *
 * Если тег лежит прямо в <body>, накладка на весь экран, а глитч действует на
 * соседние элементы. Если внутри другого блока — только на этот блок (так работает превью в студии).
 * Методы: el.play() — глитч появления; el.playOut() — глитч ухода (Promise); el.set({…}).
 * С prefers-reduced-motion остаётся только статичная накладка.
 */

export const OVERLAY_DEFAULTS = {
  tear: 40, ca: 4, duration: 900, fade: true, scan: 0.35, mask: 0, pixel: 3,
  vignette: 0.35, flicker: 0.15, idle: 0, trigger: 'load', links: false,
};

const NUM = ['tear', 'ca', 'duration', 'scan', 'mask', 'pixel', 'vignette', 'flicker', 'idle'];
const BOOL = ['fade', 'links'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t;
const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG = 'http://www.w3.org/2000/svg';
let uid = 0;

const CSS = `
:host{position:fixed;inset:0;display:block;pointer-events:none;z-index:2147483000;overflow:hidden}
:host([data-scoped]){position:absolute}
.l{position:absolute;inset:0}
.scan{background:repeating-linear-gradient(to bottom,rgba(0,0,0,var(--scan)) 0 var(--px),transparent var(--px) calc(var(--px) * 2))}
.mask{opacity:var(--mask);mix-blend-mode:multiply;
  background:repeating-linear-gradient(to right,#ff7a7a 0 var(--px),#7aff7a var(--px) calc(var(--px) * 2),#7a7aff calc(var(--px) * 2) calc(var(--px) * 3))}
.vig{background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,var(--vig)) 100%)}
.fl{background:#000;opacity:0;animation:fl 3.7s steps(1) infinite}
.roll{height:18%;inset:auto 0 auto 0;top:-20%;opacity:var(--roll);
  background:linear-gradient(to bottom,transparent,rgba(255,255,255,.06) 50%,transparent);animation:roll 7s linear infinite}
.black{background:#000;opacity:0}
@keyframes fl{0%{opacity:0}9%{opacity:var(--fl)}11%{opacity:0}37%{opacity:calc(var(--fl) * .6)}39%{opacity:0}71%{opacity:var(--fl)}72%{opacity:0}}
@keyframes roll{to{top:110%}}
@media (prefers-reduced-motion:reduce){.fl,.roll{animation:none;opacity:0}}
`;

export class CrtOverlay extends HTMLElement {
  static get observedAttributes() { return ['preset', ...Object.keys(OVERLAY_DEFAULTS)]; }

  constructor() {
    super();
    this.p = { ...OVERLAY_DEFAULTS };
    this._anim = null;
    this._raf = 0;
    this._idleTimer = 0;
    this._saved = new Map();
    this._lastSeed = 0;
  }

  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.setAttribute('aria-hidden', 'true');
    this.scoped = this.parentElement !== document.body;
    this.toggleAttribute('data-scoped', this.scoped);
    if (this.scoped && getComputedStyle(this.parentElement).position === 'static') this.parentElement.style.position = 'relative';

    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="l mask"></div><div class="l scan"></div><div class="l vig"></div>`
      + `<div class="l roll"></div><div class="l fl"></div><div class="l black"></div>`;
    this._black = root.querySelector('.black');
    this._buildFilter();
    this._readAttrs();
    this._applyStatic();

    this._onClick = e => this._handleLink(e);
    (this.scoped ? this.parentElement : document).addEventListener('click', this._onClick);
    this._onShow = e => { if (e.persisted) { this._stop(); this.play(); } }; // возврат «назад» из bfcache
    addEventListener('pageshow', this._onShow);

    if (this.p.trigger === 'load') this.play();
    this._scheduleIdle();
  }

  disconnectedCallback() {
    this._stop();
    clearTimeout(this._idleTimer);
    (this.scoped ? this.parentElement : document)?.removeEventListener('click', this._onClick);
    removeEventListener('pageshow', this._onShow);
    this._svg?.remove();
    this._ready = false;
    this.shadowRoot && (this.shadowRoot.innerHTML = '');
  }

  attributeChangedCallback() { if (this._ready) { this._readAttrs(); this._applyStatic(); this._scheduleIdle(); } }

  set(opts = {}) {
    Object.assign(this.p, opts);
    if (this._ready) { this._applyStatic(); this._scheduleIdle(); }
  }

  /** Глитч появления: из рывка (и чёрного) в спокойный кадр. */
  play() { return this._run({ dir: 'in', dur: this.p.duration, amp: 1, fade: this.p.fade }); }

  /** Глитч ухода: кадр рвётся и гаснет. Резолвится, когда экран чёрный. */
  playOut() { return this._run({ dir: 'out', dur: Math.min(550, this.p.duration * 0.6), amp: 1, fade: true }); }

  // ---------- внутреннее ----------
  _readAttrs() {
    const p = { ...OVERLAY_DEFAULTS };
    const preset = this.getAttribute('preset');
    if (preset) { try { Object.assign(p, JSON.parse(preset)); } catch (e) { console.warn('crt-overlay: неверный preset', e); } }
    for (const k of NUM) if (this.hasAttribute(k)) { const v = parseFloat(this.getAttribute(k)); if (!Number.isNaN(v)) p[k] = v; }
    for (const k of BOOL) if (this.hasAttribute(k)) p[k] = this.getAttribute(k) !== 'false';
    if (this.hasAttribute('trigger')) p.trigger = this.getAttribute('trigger');
    this.p = p;
  }

  _applyStatic() {
    const p = this.p, s = this.style;
    s.setProperty('--scan', p.scan);
    s.setProperty('--mask', p.mask);
    s.setProperty('--px', Math.max(1, p.pixel) + 'px');
    s.setProperty('--vig', p.vignette);
    s.setProperty('--fl', p.flicker * 0.12);
    s.setProperty('--roll', Math.min(1, p.flicker * 2));
  }

  _buildFilter() {
    this._fid = 'crt-overlay-f' + (++uid);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, { position: 'absolute', width: '0', height: '0', overflow: 'hidden' });
    // Шум → ступенчатые полосы по вертикали → сдвиг строк по X; потом R и B разводятся в стороны.
    svg.innerHTML = `<filter id="${this._fid}" x="-5%" y="0" width="110%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.035" numOctaves="1" seed="1" result="n"/>
      <feComponentTransfer in="n" result="q"><feFuncR type="discrete" tableValues="0.5 0.1 0.5 0.9 0.5 0.3 0.5 0.7 0.5"/></feComponentTransfer>
      <feColorMatrix in="q" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="m"/>
      <feDisplacementMap in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feOffset in="r" dx="0" result="r2"/>
      <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feOffset in="b" dx="0" result="b2"/>
      <feBlend in="r2" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b2" mode="screen"/>
    </filter>`;
    document.body.appendChild(svg);
    this._svg = svg;
    this._turb = svg.querySelector('feTurbulence');
    this._disp = svg.querySelector('feDisplacementMap');
    [this._offR, this._offB] = svg.querySelectorAll('feOffset');
  }

  _targets() {
    const parent = this.parentElement;
    return parent ? [...parent.children].filter(c => c !== this && c !== this._svg && !SKIP.has(c.tagName)) : [];
  }

  _run(a) {
    if (!this._ready) return Promise.resolve();
    if (reduceMotion()) { this._black.style.opacity = a.dir === 'out' ? '1' : '0'; return Promise.resolve(); }
    this._anim?.resolve?.();
    return new Promise(resolve => {
      this._anim = { ...a, t0: performance.now(), resolve };
      if (!this._raf) this._raf = requestAnimationFrame(this._frame);
    });
  }

  _frame = now => {
    this._raf = 0;
    const a = this._anim;
    if (!a) return;
    const t = Math.min(1, (now - a.t0) / Math.max(1, a.dur));
    const k = a.dir === 'in' ? 1 - easeOut(t) : easeIn(t);
    this._black.style.opacity = a.fade ? String(k) : '0';
    this._apply(k * a.amp, now);
    if (t < 1) { this._raf = requestAnimationFrame(this._frame); return; }
    this._anim = null;
    if (a.dir === 'in') this._apply(0, now);
    a.resolve();
  };

  _apply(s, now) {
    const els = this._targets();
    if (s < 0.002) {
      for (const el of els) this._restore(el);
      return;
    }
    // шум меняется рывками, примерно 20 раз в секунду — так больше похоже на срыв кадра
    if (now - this._lastSeed > 50) { this._lastSeed = now; this._turb.setAttribute('seed', String(1 + Math.floor(Math.random() * 999))); }
    this._disp.setAttribute('scale', String(this.p.tear * s * 2));
    this._offR.setAttribute('dx', String(this.p.ca * s));
    this._offB.setAttribute('dx', String(-this.p.ca * s));
    const jump = s > 0.6 ? (Math.random() - 0.5) * this.p.tear * 0.25 * s : 0;
    for (const el of els) {
      if (!this._saved.has(el)) this._saved.set(el, { filter: el.style.filter, transform: el.style.transform });
      el.style.filter = `url(#${this._fid})`;
      el.style.transform = jump ? `translateY(${jump.toFixed(1)}px)` : this._saved.get(el).transform;
    }
  }

  _restore(el) {
    const s = this._saved.get(el);
    if (!s) return;
    el.style.filter = s.filter; el.style.transform = s.transform;
    this._saved.delete(el);
  }

  _stop() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    this._anim?.resolve?.(); this._anim = null;
    for (const el of [...this._saved.keys()]) this._restore(el);
    if (this._black) this._black.style.opacity = '0';
  }

  _scheduleIdle() {
    clearTimeout(this._idleTimer);
    if (!(this.p.idle > 0) || reduceMotion()) return;
    const wait = (2000 + Math.random() * 5000) / this.p.idle;
    this._idleTimer = setTimeout(() => {
      if (!this._anim && !document.hidden) this._run({ dir: 'in', dur: 260, amp: 0.45 + Math.random() * 0.3, fade: false });
      this._scheduleIdle();
    }, wait);
  }

  _handleLink(e) {
    if (!this.p.links || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    if (this.scoped) { // превью в студии: никуда не уходим, просто показываем уход и появление
      e.preventDefault();
      this.playOut().then(() => this.play());
      return;
    }
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // якорь на той же странице
    e.preventDefault();
    // страховка: если анимация не отработала (вкладка в фоне и т.п.), всё равно уходим
    const timeout = new Promise(r => setTimeout(r, Math.min(550, this.p.duration * 0.6) + 250));
    Promise.race([this.playOut(), timeout]).then(() => { location.href = url.href; });
  }
}

if (!customElements.get('crt-overlay')) customElements.define('crt-overlay', CrtOverlay);
