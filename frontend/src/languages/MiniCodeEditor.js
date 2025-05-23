/* MiniCodeEditor.js v0.26 */
export class MiniCodeEditor {
  /**
   * @param {Element} mountElement DOM container (position: relative or static)
   * @param {{language?:string,value?:string,font?:string,
   *          liveProvider?:(symbol:string)=>any,
   *          autocompleteProvider?:(prefix:string)=>string[],
   *          onChange?:(value:string)=>void}} options
   */
  constructor(mountElement, options = {}) {
    if (!(mountElement instanceof Element)) throw Error('mountElement');
    const m = mountElement, o = options, cs = getComputedStyle(m);
    if (cs.position === 'static') m.style.position = 'relative';
    if (!m.style.height || cs.height === '0px') m.style.height = '100%';
    m.classList.add('mce');

    /* config */
    const LN_W = 48; /* gutter width in px */

    /* one‑time style */
    if (!document.getElementById('mce-css')) {
      const s = document.createElement('style');
      s.id = 'mce-css';
      s.textContent = `.mce{width:100%;height:100%;font:var(--f,14px/1.4 monospace);background:#282828}
.mce>textarea,.mce>pre{position:absolute;top:0;bottom:0;width:100%;margin:0;border:0;resize:none;outline:0;font:inherit;white-space:pre;overflow:auto;box-sizing:border-box}
.mce>textarea{background:none;color:transparent;caret-color:#fff;padding:8px 8px 8px calc(${LN_W}px + 8px)}
.mce>textarea::selection,.mce>textarea::-moz-selection{color:transparent;background:rgba(0,0,0,.25)}
.mce>pre.code{pointer-events:none;color:#ddd;left:${LN_W}px;right:0;padding:8px;overflow:hidden; width:calc(100% - ${LN_W}px)}
.mce>pre.code code{display:inline-block;min-width:100%}
.mce>pre.ln{pointer-events:none;color:#555;left:0;width:${LN_W}px;text-align:right;padding:8px 4px 8px 0;margin:0;user-select:none;overflow:hidden}
.ac{list-style:none;position:absolute;max-width:200px;background:#222;border:1px solid #555;margin:0;padding:0;z-index:10}
.ac.hide{display:none}.ac li{padding:2px 6px;cursor:pointer}.ac li.sel{background:#444}
.kw{color:#8ef}.num{color:#e8a}.str{color:#fa6}.cmt{color:#69808f}.live{color:#0f0;opacity:.8}`;
      document.head.appendChild(s);
    }
    m.style.setProperty('--f', o.font || `${cs.fontSize} ${cs.fontFamily}`);

    /* build DOM */
    const ta = m.appendChild(document.createElement('textarea')),
          ln = m.appendChild(document.createElement('pre')),
          pr = m.appendChild(document.createElement('pre')),
          cd = pr.appendChild(document.createElement('code')),
          ac = m.appendChild(document.createElement('ul')),
          ov = m.appendChild(document.createElement('div'));
    ln.className = 'ln'; pr.className = 'code'; ac.className = 'ac hide';
    ta.value = o.value || '';

    /* language */
    const lang = MiniCodeEditor.languages[(o.language || 'st').toLowerCase()];
    if (!lang) throw Error('language');

    /* utils */
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const colour = t => lang.rules.reduce((v, r) => v.split(/(<span[^>]*>.*?<\/span>)/gs)
      .map(s => s.startsWith('<span') ? s : s.replace(r.regex, m => `<span class="${r.className}">${m}</span>`))
      .join(''), esc(t));
    const paint = () => { cd.innerHTML = colour(ta.value) + '\u200B'; updateLN(); };

    /* line numbers */
    const updateLN = () => {
      const lines = ta.value.split(/\n/).length; let out='';
      for(let i=1;i<=lines;i++) out += i+'\n';
      ln.textContent = out;
    };

    /* caret px helper */
    const caretPx = i => {
      const d = document.createElement('div'), s = getComputedStyle(ta);
      d.style.cssText = `position:absolute;white-space:pre-wrap;visibility:hidden;font:${s.font};padding:${s.padding}`;
      d.textContent = ta.value.slice(0, i);
      const sp = d.appendChild(document.createElement('span'));
      sp.textContent = ta.value.slice(i) || ' ';
      document.body.appendChild(d);
      const p = { x: sp.offsetLeft, y: sp.offsetTop, h: sp.offsetHeight };
      document.body.removeChild(d);
      return p;
    };

    /* scrolling sync */
    const sync = () => {
      pr.scrollLeft = ta.scrollLeft;
      pr.scrollTop = ta.scrollTop;
      ln.scrollTop = ta.scrollTop;
      ov.style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`;
      if (!ac.classList.contains('hide')) posAC(ta.selectionStart);
    };
    ta.addEventListener('scroll', sync);

    /* live overlay */
    let live = o.liveProvider || (() => undefined);
    const overlay = () => {
      ov.innerHTML = '';
      const re = /\b([A-Za-z_]\w*)\b/g;
      let mx;
      while ((mx = re.exec(ta.value))) {
        const val = live(mx[1]);
        if (val === undefined) continue;
        const p = caretPx(mx.index + mx[1].length);
        const s = document.createElement('span');
        s.className = 'live';
        s.textContent = ' = ' + val;
        s.style.cssText = `position:absolute;left:${p.x + LN_W + 6}px;top:${p.y}px`;
        ov.appendChild(s);
      }
    };

    /* expose live methods */
    this.refreshLive = () => { overlay(); sync(); };
    this.setLiveProvider = fn => { if (typeof fn === 'function') { live = fn; this.refreshLive(); } };

    /* autocomplete */
    let sel = 0;
    const wordSrc = o.autocompleteProvider || (pref => lang.words || []);
    const hide = () => ac.classList.add('hide');
    const posAC = i => { const p = caretPx(i); ac.style.left = p.x - ta.scrollLeft + LN_W + 'px'; ac.style.top = p.y - ta.scrollTop + p.h + 'px'; };

    ta.addEventListener('keyup', e => {
      if (['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(e.key)) return;
      const i = ta.selectionStart, pref = /[A-Za-z_]\w*$/.exec(ta.value.slice(0, i))?.[0] || '';
      if (!pref) return hide();
      const list = wordSrc(pref).filter(w => w.startsWith(pref.toUpperCase())).slice(0, 8);
      if (!list.length) return hide();
      ac.innerHTML = list.map((w, j) => `<li class="${j ? '' : 'sel'}">${w}</li>`).join('');
      sel = 0; ac.classList.remove('hide'); posAC(i);
    });

    const insertAC = w => {
      const i = ta.selectionStart, pref = /[A-Za-z_]\w*$/.exec(ta.value.slice(0, i))?.[0] || '';
      ta.value = ta.value.slice(0, i - pref.length) + w + ta.value.slice(i);
      ta.selectionStart = ta.selectionEnd = i - pref.length + w.length;
      ta.dispatchEvent(new Event('input'));
      hide();
    };

    /* TAB inserts four spaces */
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey && ac.classList.contains('hide')) {
        e.preventDefault();
        ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
        return;
      }
    });

    /* keydown for AC navigation */
    ta.addEventListener('keydown', e => {
      if (ac.classList.contains('hide')) return;
      const li = [...ac.children];
      switch (e.key) {
        case 'ArrowDown': case 'ArrowUp':
          e.preventDefault();
          li[sel].classList.remove('sel');
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + li.length) % li.length;
          li[sel].classList.add('sel');
          break;
        case 'Tab': case 'Enter':
          e.preventDefault(); insertAC(li[sel].textContent); break;
        case 'Escape': hide(); break;
      }
    });
    ac.addEventListener('mousedown', e => { if (e.target.tagName === 'LI') insertAC(e.target.textContent); });

    /* reactive render with small init delay */
    const tick = () => { paint(); sync(); overlay(); o.onChange && o.onChange(ta.value); };
    setTimeout(() => { ta.addEventListener('input', tick); tick(); this._timer = setInterval(overlay, 200); }, 100);

    /* Public API */
    this.getValue = () => ta.value;
    this.setValue = v => { const sl = ta.scrollLeft, st = ta.scrollTop; ta.value = v; tick(); ta.scrollLeft = sl; ta.scrollTop = st; };
    this.getScrollHeight = () => (cd.scrollHeight || 0) + 16 ;
  }

  destroy() { clearInterval(this._timer); }

  static registerLanguage(name, spec) { MiniCodeEditor.languages[name.toLowerCase()] = spec; }
}
MiniCodeEditor.languages = {};

/* Structured Text */
MiniCodeEditor.registerLanguage('st', {
  rules: [
    { regex: /\(\*[\s\S]*?\*\)/g, className: 'cmt' },
    { regex: /\/\/.*$/gm, className: 'cmt' },
    { regex: /"(?:\\.|[^"])*"/g, className: 'str' },
    { regex: /\b(END_IF|IF|THEN|ELSE|VAR|BOOL|INT|REAL)\b/g, className: 'kw' },
    { regex: /\b\d+(?:\.\d+)?\b/g, className: 'num' }
  ],
  words: ['IF','THEN','ELSE','END_IF','BOOL','INT','REAL']
});

/* JavaScript */
MiniCodeEditor.registerLanguage('js', {
  rules: [
    { regex: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, className: 'cmt' },
    { regex: /`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, className: 'str' },
    { regex: /\b(function|return|let|const|if|else)\b/g, className: 'kw' },
    { regex: /\b\d+\b/g, className: 'num' }
  ],
  words: ['function','return','console','document']
});

/* Assembly */
MiniCodeEditor.registerLanguage('asm', {
  rules: [
    { regex: /\/\*[\s\S]*?\*\//g, className: 'cmt' },
    { regex: /\/\/.*$/gm, className: 'cmt' },
    { regex: /#.*$/gm, className: 'cmt' },
    { regex: /^\s*[A-Za-z_]\w*:|\b(ptr\.[a-z_]+|u8\.[a-z_]+|jmp(?:_if_not)?|jmp(?:_if)?|jump(?:_if_not)?|jump(?:_if)?|call|ret(?:_if)?|ret(?:_if_not)?|exit|loop|const|cvt|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/igm, className: 'kw' },
    { regex: /\b\d+\.\d+|\.\d+\b/g, className: 'num' },
    { regex: /\b0x[\da-f]+|\b\d+\b/gi, className: 'num' }
  ],
  words: ['PTR.CONST','U8.CONST','U8.LOAD','U8.MOVE','U8.ADD','U8.SUB','U8.CMP_EQ','U8.CMP_LT','JUMP','JUMP_IF_NOT','CALL','RET','RET_IF','RET_IF_NOT','EXIT','NOP']
});

export default MiniCodeEditor;
