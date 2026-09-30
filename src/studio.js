import { DEFAULTS } from './crt-glitch.js';

const PRESETS = {
  ausify: { jitter:0.00065, ca:0.0015, tear:0.05, mask:false, pixel:1, duration:1100, fade:true, idle:0 },
  subtle: { jitter:0.0003, ca:0.0008, tear:0.025, mask:false, pixel:1, duration:800, fade:true, idle:0 },
  vhs:    { jitter:0.004, ca:0.006, tear:0.14, mask:false, pixel:1, duration:1500, fade:true, idle:0.5 },
  tube:   { jitter:0.0012, ca:0.0035, tear:0.06, mask:true, pixel:2, duration:1200, fade:true, idle:0.2 },
};
const state = { ...DEFAULTS, ...PRESETS.ausify, trigger:'visible', fit:'cover' };
const $ = id => document.getElementById(id);
const stage = $('stage');
let el = null, srcInfo = { kind:'img', url:null, name:'hero.jpg' }, ar = '16/9', codeMode = 'astro';

// ---------- пример-обложка ----------
async function sampleImage(){
  try{ await Promise.all([document.fonts.load('400 160px "Instrument Serif"'),document.fonts.load('italic 400 160px "Instrument Serif"'),document.fonts.load('600 30px "JetBrains Mono"')]); }catch(e){}
  const W=1920,H=1080,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#1b0b14');g.addColorStop(1,'#000');x.fillStyle=g;x.fillRect(0,0,W,H);
  const cx=W*0.72,cy=H*0.5,R=380;x.fillStyle='#200d18';x.beginPath();x.arc(cx,cy,R,0,7);x.fill();
  x.strokeStyle='rgba(255,143,199,.35)';for(let r=90;r<R;r+=10){x.lineWidth=r%30===0?2:1;x.beginPath();x.arc(cx,cy,r,0,7);x.stroke();}
  x.fillStyle='#ff8fc7';x.beginPath();x.arc(cx,cy,85,0,7);x.fill();x.fillStyle='#000';x.beginPath();x.arc(cx,cy,10,0,7);x.fill();
  x.fillStyle='#ff8fc7';x.font='400 190px "Instrument Serif", Georgia, serif';x.fillText('Your Name',110,H*0.47);
  x.font='italic 400 190px "Instrument Serif", Georgia, serif';x.fillText('on air',110,H*0.47+170);
  x.fillStyle='#ebbe32';x.font='600 34px "JetBrains Mono", monospace';x.fillText('(( SEARCH. LISTEN. DEFY. ))',116,H*0.47+260);
  x.fillStyle='rgba(255,143,199,.6)';x.font='400 24px "JetBrains Mono", monospace';x.fillText('CH 03 ·  REC ● 00:00:14',110,90);
  return c.toDataURL('image/jpeg',0.92);
}

// ---------- сцена ----------
function mount(){
  stage.style.aspectRatio = ar;
  stage.innerHTML = '';
  el = document.createElement('crt-glitch');
  el.setAttribute('trigger','none');
  const media = document.createElement(srcInfo.kind==='video'?'video':'img');
  if(srcInfo.kind==='video'){ Object.assign(media,{muted:true,loop:true,playsInline:true,autoplay:true}); media.setAttribute('muted',''); }
  else media.alt = 'Превью';
  media.src = srcInfo.url;
  el.appendChild(media);
  stage.appendChild(el);
  el.set({ ...state, trigger:'none' });
  if(srcInfo.kind==='video') media.play?.().catch(()=>{});
  setTimeout(()=>el.play(), 150);
}
function fitStage(){ // не выше 70% окна
  const [a,b] = ar.split('/').map(Number);
  const maxH = Math.max(240, innerHeight*0.7), w = stage.parentElement.clientWidth - 28;
  stage.style.width = Math.min(w, maxH*a/b) + 'px';
}
addEventListener('resize', fitStage);

// ---------- пульт ----------
const fmt = { tear:v=>v.toFixed(3), duration:v=>String(v), jitter:v=>v.toFixed(5), ca:v=>v.toFixed(4), idle:v=>v.toFixed(2), pixel:v=>v+' px' };
function syncUI(){
  for(const k of Object.keys(fmt)){ $(k).value = state[k]; $(k+'V').textContent = fmt[k](state[k]); }
  $('mask').checked = state.mask; $('fade').checked = state.fade; $('trigger').value = state.trigger;
  renderSnippet();
}
for(const k of Object.keys(fmt)) $(k).addEventListener('input', e=>{ state[k]=parseFloat(e.target.value); $(k+'V').textContent=fmt[k](state[k]); el?.set({[k]:state[k]}); renderSnippet(); });
$('tear').addEventListener('change', ()=>el?.play());
$('duration').addEventListener('change', ()=>el?.play());
$('mask').addEventListener('change', e=>{ state.mask=e.target.checked; el?.set({mask:state.mask}); renderSnippet(); });
$('fade').addEventListener('change', e=>{ state.fade=e.target.checked; el?.set({fade:state.fade}); renderSnippet(); el?.play(); });
$('trigger').addEventListener('change', e=>{ state.trigger=e.target.value; renderSnippet(); });
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
  Object.assign(state, PRESETS[b.dataset.preset]); el?.set({ ...state, trigger:'none' }); syncUI(); el?.play(); }));
document.querySelectorAll('[data-ar]').forEach(b=>b.addEventListener('click',()=>{
  ar=b.dataset.ar; document.querySelectorAll('[data-ar]').forEach(x=>x.setAttribute('aria-pressed', String(x===b)));
  stage.style.aspectRatio = ar; fitStage(); el?.play(); }));
$('play').addEventListener('click', ()=>el?.play());
$('file').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  if(srcInfo.url && srcInfo.url.startsWith('blob:')) URL.revokeObjectURL(srcInfo.url);
  srcInfo = { kind: f.type.startsWith('video')?'video':'img', url: URL.createObjectURL(f), name: f.name };
  $('srcName').textContent = f.name; mount(); renderSnippet();
});

// ---------- код ----------
const cleanPreset = () => { const p={}; for(const k of ['jitter','ca','tear','mask','pixel','duration','fade','idle']) p[k]=state[k]; return p; };
function renderSnippet(){
  const p = cleanPreset(), js = JSON.stringify(p), isV = srcInfo.kind==='video';
  const file = srcInfo.name.replace(/[^\w.\-]+/g,'-');
  const props = Object.entries(p).map(([k,v])=>`${k}: ${v}`).join(', ');
  let s;
  if(codeMode==='astro') s =
`---
import CrtGlitch from '../components/crt-glitch/CrtGlitch.astro';
${isV?'':`import hero from '../assets/${file}';\n`}---
<section class="hero">
  <CrtGlitch
    ${isV?`video="/media/${file}"`:`src={hero}\n    alt="Опишите картинку"`}
    trigger="${state.trigger}"
    preset={{ ${props} }}
  />
</section>

<style>
  .hero :global(crt-glitch) { aspect-ratio: ${ar.replace('/',' / ')}; }
</style>`;
  else if(codeMode==='html') s =
`<crt-glitch trigger="${state.trigger}" preset='${js}'>
  ${isV?`<video src="/media/${file}" muted loop playsinline autoplay></video>`:`<img src="/images/${file}" alt="Опишите картинку">`}
</crt-glitch>
<script type="module" src="/js/crt-glitch.js"><\/script>`;
  else s = JSON.stringify({ ...p, trigger: state.trigger }, null, 2);
  $('snippet').textContent = s;
}
document.querySelectorAll('[data-code]').forEach(b=>b.addEventListener('click',()=>{
  codeMode=b.dataset.code; document.querySelectorAll('[data-code]').forEach(x=>x.setAttribute('aria-pressed', String(x===b))); renderSnippet(); }));
$('copy').addEventListener('click', async ()=>{
  const t=$('snippet').textContent;
  try{ await navigator.clipboard.writeText(t); say('Код скопирован'); }
  catch(e){ const r=document.createRange(); r.selectNodeContents($('snippet')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); say('Код выделен — нажмите Cmd+C'); }
});

// ---------- выгрузка ----------
function say(t, err){ const s=$('status'); s.textContent=t; s.classList.toggle('err',!!err); }
function exportSize(){
  const v=$('res').value; if(v==='screen') return null;
  const [a,b]=ar.split('/').map(Number), short=+v;
  return a>=b ? [short*a/b, short] : [short, short*b/a];
}
function save(filename, data){
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  say('Сохранено: ' + filename);
}
const base = () => srcInfo.name.replace(/\.[^.]+$/,'').replace(/[^\w\-]+/g,'-') || 'crt';

$('png').addEventListener('click', async ()=>{
  el.renderSize = exportSize(); el.set({});
  const blob = await el.snapshot();
  el.renderSize = null; el.set({});
  save(`${base()}-crt.png`, blob);
});
$('json').addEventListener('click', ()=> save('crt-preset.json', JSON.stringify({ ...cleanPreset(), trigger: state.trigger }, null, 2)));

$('rec').addEventListener('click', async ()=>{
  if(typeof MediaRecorder==='undefined' || !el.canvas.captureStream){ say('Этот браузер не умеет записывать видео с холста', true); return; }
  const types=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'];
  const mime=types.find(t=>MediaRecorder.isTypeSupported(t)); if(!mime){ say('Нет поддерживаемого видеоформата', true); return; }
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  $('rec').disabled=true; say('Идёт запись…');
  el.renderSize = exportSize(); el.set({});
  const stream = el.canvas.captureStream(60);
  const rec = new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond: 12_000_000});
  const chunks=[]; rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  const done = new Promise(r=>rec.onstop=r);
  rec.start();
  el.play();
  await new Promise(r=>setTimeout(r, state.duration + 1200));
  rec.stop(); await done;
  stream.getTracks().forEach(t=>t.stop());
  el.renderSize=null; el.set({}); $('rec').disabled=false;
  save(`${base()}-crt.${ext}`, new Blob(chunks,{type:mime}));
});

// ---------- старт ----------
srcInfo.url = await sampleImage();
syncUI(); fitStage(); mount();
