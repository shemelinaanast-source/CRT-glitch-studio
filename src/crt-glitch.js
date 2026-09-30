/*
 * <crt-glitch> — CRT/глитч-эффект на WebGL для картинок и видео.
 * Шейдер по мотивам ausify.com.au (crtEffect): дрожание строк, хроматическая
 * аберрация, RGB-маска, строки развёртки и «рывок» при появлении.
 *
 * Использование:
 *   <crt-glitch jitter="0.00065" ca="0.0015" trigger="visible">
 *     <img src="/hero.jpg" alt="…">          ← или <video src="…" muted loop playsinline autoplay>
 *   </crt-glitch>
 *
 * Атрибуты (все необязательные):
 *   preset    JSON со всеми параметрами сразу (из студии)
 *   jitter    постоянное дрожание строк, доля ширины        (0.00065)
 *   ca        хроматическая аберрация                         (0.0015)
 *   tear      сила рывка строк во время перехода             (0.05)
 *   mask      "true" — RGB-маска и строки развёртки           (false)
 *   pixel     укрупнение маски, в пикселях экрана            (1)
 *   duration  длительность перехода, мс                      (1100)
 *   fade      "true" — во время перехода выходить из чёрного  (true)
 *   trigger   visible | load | hover | none                  (visible)
 *   idle      частота случайных микро-глитчей, 0…1           (0)
 *   fit       cover | contain                                (cover)
 *
 * Методы: el.play() — проиграть переход; el.set({…}) — поменять параметры;
 *         el.snapshot() — PNG текущего кадра (Promise<Blob>); el.canvas;
 *         el.renderSize = [w, h] — зафиксировать разрешение холста (null — по экрану).
 * Без WebGL или с prefers-reduced-motion остаётся исходная картинка/спокойный кадр.
 */

const FRAG = `precision highp float;
uniform float uTime, uTransition, uJitter, uCa, uTear, uSimple, uPix, uFade;
uniform vec2 uRes, uScale, uOffset;
uniform sampler2D tMap;
varying vec2 vUv;

float crtRand(float s){ return fract(sin(s) * 123400.0); }

vec4 sampleTex(vec2 uv){
  vec2 t = uv * uScale + uOffset;
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
  return texture2D(tMap, t);
}

void main(){
  vec2 uv = vec2(vUv.x + crtRand(uTime + vUv.y) * mix(0.0, uTear, 1.0 - uTransition), vUv.y);
  vec2 d  = vec2(uv.x + crtRand(uTime + uv.y) * uJitter, uv.y);

  vec4 color = sampleTex(d);
  vec2 caOff = normalize(d - 0.5 + 1e-5) * uCa;
  color.r = sampleTex(d + caOff).r;
  color.b = sampleTex(d - caOff).b;

  vec3 rgb = vec3(0.1);
  float pp = mod(floor(uv.x * uRes.x / uPix), 3.0);
  if (pp < 0.5) rgb.r = 1.0; else if (pp < 1.5) rgb.g = 1.0; else rgb.b = 1.0;
  color.rgb = mix(mix(color.rgb, color.rgb * rgb * 1.2, 0.5), color.rgb, uSimple);
  vec3 scan = vec3(clamp(mod(floor(gl_FragCoord.y / uPix), 4.0), 0.0, 1.0));
  color.rgb = mix(color.rgb * scan, color.rgb, uSimple);

  color *= mix(1.0, uTransition, uFade);
  gl_FragColor = color;
}`;

const VERT = `attribute vec2 p; varying vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(p, 0.0, 1.0); }`;

export const DEFAULTS = {
  jitter: 0.00065, ca: 0.0015, tear: 0.05, mask: false, pixel: 1,
  duration: 1100, fade: true, trigger: 'visible', idle: 0, fit: 'cover',
};

const NUM = ['jitter', 'ca', 'tear', 'pixel', 'duration', 'idle'];
const BOOL = ['mask', 'fade'];
const easeOut = t => 1 - Math.pow(1 - t, 3);
const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class CrtGlitch extends HTMLElement {
  static get observedAttributes() { return ['preset', ...Object.keys(DEFAULTS)]; }

  constructor() {
    super();
    this.p = { ...DEFAULTS };
    this.transition = 1;
    this._anim = null;
    this._visible = false;
    this._raf = 0;
    this._nextIdle = 0;
  }

  connectedCallback() {
    if (this._ready) return;
    this.style.display ||= 'block';
    if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
    this._readAttrs();

    this.source = this.querySelector('img, video');
    if (!this.source) return;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, alpha: true });
    if (!gl) return; // нет WebGL — остаётся обычная картинка
    this.canvas = canvas; this.gl = gl;
    this._setup();
    this.appendChild(canvas);
    this._ready = true;

    const whenLoaded = () => {
      this._texReady = true;
      this._upload();
      this.source.style.opacity = '0';       // оригинал держит место в вёрстке и остаётся для SEO/alt
      this._resize();
      if (this.p.trigger === 'load' || (this.p.trigger === 'visible' && this._visible)) this.play();
      else this.transition = 1;
      this._kick();
    };
    if (this.source.tagName === 'VIDEO') {
      this.source.readyState >= 2 ? whenLoaded() : this.source.addEventListener('loadeddata', whenLoaded, { once: true });
    } else {
      this.source.complete && this.source.naturalWidth ? whenLoaded() : this.source.addEventListener('load', whenLoaded, { once: true });
    }

    if (this.p.trigger === 'visible' || this.p.trigger === 'load') this.transition = 0;

    this._ro = new ResizeObserver(() => { this._resize(); this._kick(); });
    this._ro.observe(this);
    this._io = new IntersectionObserver(([e]) => {
      const was = this._visible;
      this._visible = e.isIntersecting;
      if (this._visible && !was && this.p.trigger === 'visible' && !this._played && this._texReady) this.play();
      this._kick();
    }, { threshold: 0.25 });
    this._io.observe(this);
    this.addEventListener('pointerenter', () => { if (this.p.trigger === 'hover') this.play(); });
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    this._ro?.disconnect(); this._io?.disconnect();
  }

  attributeChangedCallback() { this._readAttrs(); this._kick(); }

  _readAttrs() {
    const p = { ...DEFAULTS };
    const preset = this.getAttribute('preset');
    if (preset) { try { Object.assign(p, JSON.parse(preset)); } catch (e) { console.warn('crt-glitch: preset не JSON', e); } }
    for (const k of NUM) if (this.hasAttribute(k)) p[k] = parseFloat(this.getAttribute(k));
    for (const k of BOOL) if (this.hasAttribute(k)) p[k] = this.getAttribute(k) !== 'false';
    for (const k of ['trigger', 'fit']) if (this.hasAttribute(k)) p[k] = this.getAttribute(k);
    this.p = p;
    if (this.gl) this._resize();
  }

  /** Поменять параметры из JS: el.set({ ca: 0.004 }) */
  set(params) { Object.assign(this.p, params); this._resize(); this._kick(); }
  get params() { return { ...this.p }; }

  /** Проиграть переход «рывок → спокойный кадр». */
  play(duration = this.p.duration, from = 0) {
    this._played = true;
    if (reduceMotion()) { this.transition = 1; this._kick(); return; }
    this._anim = { t0: performance.now(), dur: Math.max(1, duration), from };
    this._kick();
  }

  /** PNG текущего кадра. */
  snapshot(type = 'image/png') {
    this._draw(performance.now());
    const url = this.canvas.toDataURL(type);
    return fetch(url).then(r => r.blob());
  }

  _setup() {
    const gl = this.gl;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uTime','uTransition','uJitter','uCa','uTear','uSimple','uPix','uFade','uRes','uScale','uOffset'])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  _upload() {
    const gl = this.gl, s = this.source;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s); }
    catch (e) { console.warn('crt-glitch: не удалось прочитать источник (CORS?)', e); }
  }

  _resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.getBoundingClientRect();
    // renderSize = [w, h] — фиксированное разрешение холста (например, для экспорта)
    const [w, h] = this.renderSize
      ? this.renderSize.map(n => Math.max(1, Math.round(n)))
      : [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
    // object-fit: cover / contain
    const s = this.source;
    const sw = s.videoWidth || s.naturalWidth || 1, sh = s.videoHeight || s.naturalHeight || 1;
    const ca = w / h, sa = sw / sh;
    let sx = 1, sy = 1;
    if (this.p.fit === 'contain') { if (sa > ca) sy = sa / ca; else sx = ca / sa; }
    else { if (sa > ca) sx = ca / sa; else sy = sa / ca; }
    this._scale = [sx, sy]; this._offset = [(1 - sx) / 2, (1 - sy) / 2];
  }

  _kick() { if (!this._raf && this._ready) this._raf = requestAnimationFrame(t => this._frame(t)); }

  _frame(now) {
    this._raf = 0;
    const animating = this._draw(now);
    const live = this._visible && (animating || this.source.tagName === 'VIDEO' || (!reduceMotion() && (this.p.jitter > 0 || this.p.idle > 0)));
    if (live) this._kick();
  }

  _draw(now) {
    if (!this._texReady) return false;
    const gl = this.gl, u = this.u, p = this.p;
    if (this.source.tagName === 'VIDEO') this._upload();

    if (!this._anim && p.idle > 0 && !reduceMotion()) {
      if (!this._nextIdle) this._nextIdle = now + (2000 + Math.random() * 5000) / p.idle;
      if (now > this._nextIdle) { this._nextIdle = 0; this._anim = { t0: now, dur: 280, from: 0.55 + Math.random() * 0.3, idle: true }; }
    }
    if (this._anim) {
      const k = Math.min(1, (now - this._anim.t0) / this._anim.dur);
      this.transition = this._anim.from + (1 - this._anim.from) * easeOut(k);
      if (k >= 1) { this._anim = null; this.dispatchEvent(new Event('crt-done')); }
    }
    const calm = reduceMotion();
    gl.uniform1f(u.uTime, calm ? 0 : (now / 1000) % 100);
    gl.uniform1f(u.uTransition, this.transition);
    gl.uniform1f(u.uJitter, calm ? 0 : p.jitter);
    gl.uniform1f(u.uCa, p.ca);
    gl.uniform1f(u.uTear, p.tear);
    gl.uniform1f(u.uSimple, p.mask ? 0 : 1);
    gl.uniform1f(u.uPix, Math.max(1, p.pixel) * Math.min(window.devicePixelRatio || 1, 2));
    gl.uniform1f(u.uFade, p.fade ? 1 : 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uScale, this._scale[0], this._scale[1]);
    gl.uniform2f(u.uOffset, this._offset[0], this._offset[1]);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return !!this._anim;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('crt-glitch')) {
  customElements.define('crt-glitch', CrtGlitch);
}
