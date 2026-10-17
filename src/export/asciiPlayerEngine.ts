// The player that ships inside the exported HTML file and the React component. It is plain JavaScript
// kept as a string (not compiled from TypeScript) so the exact same code is written into both outputs.
// Contract: createAsciiPlayer(root, data, { autoPlay, loop, audioSrc, fontSrc }) → { play, pause, toggle, seek, destroy }.
// `data` is the AsciiPlayerData shape (see asciiText.ts). Frames are picked from a clock (the audio's when
// there is sound, else the wall clock), so a slow frame skips ahead instead of drifting out of sync.

export const PLAYER_ENGINE_JS = String.raw`export function createAsciiPlayer(root, data, opts) {
  opts = opts || {};
  var n = data.frames.length, fps = data.fps, cw = data.cellWidth, ch = data.cellHeight;
  var W = data.cols * cw, H = data.rows * ch, st = data.style, family = st.family;
  var loop = opts.loop !== false, playing = false, last = -1, raf = 0, offset = 0, t0 = 0, scale = 1, dead = false;
  var audio = opts.audioSrc ? new Audio(opts.audioSrc) : null;
  if (audio) { audio.preload = 'auto'; audio.loop = loop; }

  function el(tag, props, parent) {
    var e = document.createElement(tag);
    for (var k in props) e[k] = props[k];
    if (parent) parent.appendChild(e);
    return e;
  }
  var css = el('style', { textContent: '.ap-view{position:relative;width:100%;overflow:hidden}.ap-stage{position:absolute;left:0;top:0;transform-origin:0 0}' +
    '.ap-stage pre{margin:0;white-space:pre;font-synthesis:none}.ap-stage canvas{display:block}' +
    '.ap-bar{display:flex;gap:12px;align-items:center;padding:8px 0;font:14px system-ui,sans-serif;color:inherit}.ap-bar input[type=range]{flex:1;min-width:0}' +
    '.ap-bar button{font:inherit;padding:4px 12px;cursor:pointer}' }, root);
  root.tabIndex = 0;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'ASCII animation player');
  var view = el('div', { className: 'ap-view' }, root);
  var stage = el('div', { className: 'ap-stage' }, view);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.background = st.background;
  var bar = el('div', { className: 'ap-bar' }, root);
  var btn = el('button', { type: 'button', textContent: 'Play' }, bar);
  btn.setAttribute('aria-label', 'Play');
  var seekBar = el('input', { type: 'range', min: 0, max: Math.max(0, n - 1), step: 1, value: 0 }, bar);
  seekBar.setAttribute('aria-label', 'Frame');
  var loopLabel = el('label', {}, bar);
  var loopBox = el('input', { type: 'checkbox', checked: loop }, loopLabel);
  loopLabel.appendChild(document.createTextNode(' Loop'));

  var pre = null, canvas = null, g = null, img = null, px32 = null, masks = {};
  var mw = Math.ceil(cw), mh = Math.ceil(ch), Wp = Math.round(W), Hp = Math.round(H);
  if (data.mono) {
    pre = el('pre', {}, stage);
    pre.setAttribute('aria-hidden', 'true');
    pre.style.color = st.ink;
    pre.style.fontFamily = family + ',monospace';
    pre.style.fontWeight = st.weight;
    pre.style.fontSize = ch / st.lineHeight + 'px';
    pre.style.lineHeight = ch + 'px';
  } else {
    canvas = el('canvas', {}, stage);
    canvas.setAttribute('role', 'img');
    canvas.style.imageRendering = 'auto';
    canvas.setAttribute('aria-label', 'ASCII animation');
  }

  function fit() {
    var w = view.clientWidth || W;
    scale = w / W;
    stage.style.transform = 'scale(' + scale + ')';
    view.style.height = H * scale + 'px';
    if (canvas && !g) {
      canvas.width = Wp;
      canvas.height = Hp;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      g = canvas.getContext('2d');
      img = g.createImageData(Wp, Hp);
      px32 = new Uint32Array(img.data.buffer);
    }
  }
  function metrics() {
    // Letter spacing makes the font's advance fill the cell exactly, as the renderer's grid does.
    var m = el('canvas', {}).getContext('2d');
    m.font = st.weight + ' ' + ch / st.lineHeight + 'px ' + family;
    pre.style.letterSpacing = cw - m.measureText('M').width + 'px';
  }

  function draw(f) {
    if (f === last) return;
    last = f;
    var fr = data.frames[f];
    root.dataset.frame = String(f);
    seekBar.value = String(f);
    if (pre) { pre.textContent = fr.lines.join('\n'); return; }
    px32.fill(0);
    for (var y = 0; y < data.rows; y++) {
      var line = fr.lines[y], cl = fr.colors[y], oy = Math.round(y * ch);
      for (var x = 0; x < data.cols; x++) {
        var c = line.charAt(x);
        if (c === ' ') continue;
        var m = masks[c] || (masks[c] = glyphMask(c));
        var v = parseInt(cl.substr(x * 6, 6), 16), col = ((v & 255) << 16) | (v & 0xff00) | (v >> 16), ox = Math.round(x * cw);
        for (var j = 0; j < mh && oy + j < Hp; j++) {
          for (var i = 0, o = (oy + j) * Wp + ox, k = j * mw; i < mw && ox + i < Wp; i++, o++, k++) {
            if (m[k]) px32[o] = (m[k] << 24) | col;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  // A glyph's coverage (alpha) over one cell, drawn once with the browser's own text rendering.
  var scratch = null;
  function glyphMask(c) {
    if (!scratch) { scratch = el('canvas', { width: mw, height: mh }).getContext('2d', { willReadFrequently: true }); }
    scratch.clearRect(0, 0, mw, mh);
    scratch.font = st.weight + ' ' + ch / st.lineHeight + 'px ' + family + ',monospace';
    scratch.textAlign = 'center';
    scratch.textBaseline = 'middle';
    scratch.fillStyle = '#fff';
    scratch.fillText(c, mw / 2, mh / 2);
    var d = scratch.getImageData(0, 0, mw, mh).data, a = new Uint8Array(mw * mh);
    for (var q = 0; q < a.length; q++) a[q] = d[q * 4 + 3];
    return a;
  }

  function clock() { return audio ? audio.currentTime : offset + (performance.now() - t0) / 1000; }
  function cur() { return last < 0 ? 0 : last; }
  function frameAt(t) {
    var f = Math.floor(t * fps + 1e-6);
    if (f < n) return f;
    if (loop) {
      if (!audio) { offset = t % (n / fps); t0 = performance.now(); }
      return f % n;
    }
    return -1;
  }
  function tick() {
    if (!playing || dead) return;
    var f = frameAt(clock());
    if (f < 0) { draw(n - 1); pause(); return; }
    draw(f);
    raf = requestAnimationFrame(tick);
  }
  function setUi() {
    btn.textContent = playing ? 'Pause' : 'Play';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.dataset.playing = String(playing);
  }
  function play() {
    if (playing || dead) return Promise.resolve();
    if (cur() >= n - 1 && !loop) seek(0);
    var start = function () { playing = true; t0 = performance.now(); setUi(); raf = requestAnimationFrame(tick); };
    if (!audio) { start(); return Promise.resolve(); }
    audio.loop = loop;
    return audio.play().then(start, function () { setUi(); }); // autoplay with sound can be blocked: wait for a click
  }
  function pause() {
    if (!playing) return;
    offset = clock();
    playing = false;
    cancelAnimationFrame(raf);
    if (audio) audio.pause();
    setUi();
  }
  function seek(f) {
    f = Math.max(0, Math.min(n - 1, f | 0));
    offset = f / fps;
    t0 = performance.now();
    if (audio) audio.currentTime = offset;
    last = -1;
    draw(f);
  }
  function toggle() { return playing ? pause() : play(); }

  btn.addEventListener('click', toggle);
  seekBar.addEventListener('input', function () { seek(Number(seekBar.value)); });
  loopBox.addEventListener('change', function () { loop = loopBox.checked; if (audio) audio.loop = loop; });
  root.addEventListener('keydown', function (e) {
    if (e.target !== root) return; // buttons and sliders keep their own keys
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); seek(cur() + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); seek(cur() - 1); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
  });
  var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(view);

  function ready() {
    if (dead) return;
    if (pre) metrics();
    fit();
    draw(0);
    setUi();
    if (opts.autoPlay !== false) play();
  }
  var load = Promise.resolve();
  if (opts.fontSrc && typeof FontFace === 'function') {
    var face = new FontFace(family, 'url(' + opts.fontSrc + ')', { weight: '100 900' });
    load = face.load().then(function () { document.fonts.add(face); });
  } else if (document.fonts && document.fonts.load) {
    load = document.fonts.load(st.weight + ' 16px ' + family);
  }
  load.then(ready, ready);

  return {
    play: play, pause: pause, toggle: toggle, seek: seek, audio: audio,
    destroy: function () { dead = true; playing = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (audio) { audio.pause(); audio.removeAttribute('src'); } root.textContent = ''; },
  };
}
`;

/** Types for the engine, shipped next to it in the React zip. */
export const PLAYER_ENGINE_DTS = `export interface AsciiPlayerData {
  cols: number;
  rows: number;
  fps: number;
  cellWidth: number;
  cellHeight: number;
  mono: boolean;
  style: { family: string; weight: number; lineHeight: number; ink: string; background: string };
  frames: { lines: string[]; colors?: string[] }[];
}
export interface AsciiPlayerOptions {
  autoPlay?: boolean;
  loop?: boolean;
  audioSrc?: string;
  fontSrc?: string;
}
export interface AsciiPlayerHandle {
  play(): Promise<void>;
  pause(): void;
  toggle(): void;
  seek(frame: number): void;
  audio: HTMLAudioElement | null;
  destroy(): void;
}
export function createAsciiPlayer(root: HTMLElement, data: AsciiPlayerData, opts?: AsciiPlayerOptions): AsciiPlayerHandle;
`;
