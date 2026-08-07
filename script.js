/*
  TRUTHCHAIN — script.js
  -----------------------
  This file controls what happens when you click things (the interactivity).

  How it's organized, top to bottom:
  1. Utilities        - small helper functions used everywhere (hashing text,
                         hashing files, formatting text, escaping HTML)
  2. In-memory ledger  - a simple JavaScript array that acts as our "database"
                         of published records (resets on page refresh)
  3. Hero demo         - the fingerprint shown at the top of the page
  4. Publish demo      - #publish section logic
  5. Verify demo       - #verify section logic (two tabs)
  6. Photo / AI check  - #photo section logic (three tabs)
  7. Detect demo       - #detect section logic
  8. Explorer demo     - #explorer section logic (search, filter, table)

  Every demo follows the same pattern:
    - find the button/input with document.getElementById(...)
    - listen for a click or input event with .addEventListener(...)
    - run some logic
    - write the result into the page with .innerHTML = `...`
*/

// ---------- utilities ----------
async function sha256Hex(input){
  const enc = new TextEncoder();
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256HexFromFile(file){
  const buf = await file.arrayBuffer();
  return sha256Hex(new Uint8Array(buf));
}
function shortHash(h){ return h.slice(0,10) + '…' + h.slice(-8); }
function nowStamp(){
  const d = new Date();
  return d.toISOString().replace('T',' ').slice(0,19) + ' UTC';
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- in-memory ledger ----------
const ledger = [];
let ledgerSeeded = false;

async function seedLedger(){
  const seeds = [
    {type:'article', title:'City council approves new transit line', publisher:'Ridgeline Daily',
     body:'After eighteen months of hearings, the city council voted 6-1 Tuesday to approve funding for the Ridgeline light-rail extension, which will connect the downtown core to the eastern suburbs by 2029.'},
    {type:'article', title:'Harvest yields down 4% across the valley', publisher:'Northfork Gazette',
     body:'Regional agricultural data released Monday shows this season\'s grain harvest fell roughly 4 percent below the five-year average, which officials attributed to a dry spring.'},
    {type:'photo', title:'ridgeline-rail-groundbreaking.jpg', publisher:'Ridgeline Daily',
     body:'PHOTO-BYTES-SEED-1-ridgeline-groundbreaking-ceremony-image-data'},
  ];
  for(const s of seeds){
    const hash = await sha256Hex(s.body);
    ledger.push({...s, hash, time: nowStamp()});
  }
  ledgerSeeded = true;
  renderExplorer();
}

function addToLedger(entry){
  ledger.unshift(entry);
  renderExplorer();
}

// ---------- hero ambient fingerprint ----------
(async function heroDemo(){
  const sample = "TruthChain verifies news articles and photos with cryptographic fingerprints.";
  const h = await sha256Hex(sample);
  document.getElementById('heroHashA').textContent = h;
  document.getElementById('heroHashB').textContent = h;
  document.getElementById('heroTime').textContent = nowStamp();
})();

// ---------- PUBLISH ----------
document.getElementById('pubBtn').addEventListener('click', async () => {
  const publisher = document.getElementById('pubPublisher').value.trim() || 'Unnamed publisher';
  const title = document.getElementById('pubTitle').value.trim() || 'Untitled';
  const body = document.getElementById('pubBody').value.trim();
  const box = document.getElementById('pubResult');
  if(!body){
    box.style.display='block';
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>No content</div><div class="hashline">Add some article text before publishing.</div>';
    return;
  }
  const hash = await sha256Hex(body);
  const time = nowStamp();
  addToLedger({type:'article', title, publisher, body, hash, time});
  box.style.display='block';
  box.innerHTML = `
    <div class="badge ok"><span class="sq"></span>Published to ledger</div>
    <div class="hashline">
      Title &nbsp;&nbsp;${escapeHtml(title)}<br>
      Publisher &nbsp;${escapeHtml(publisher)}<br>
      Fingerprint &nbsp;${hash}<br>
      Timestamp &nbsp;${time}
    </div>`;
});

// ---------- VERIFY: tabs ----------
document.querySelectorAll('[data-vtab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-vtab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.vtab;
    document.getElementById('vtab-check').style.display = tab==='check' ? 'block':'none';
    document.getElementById('vtab-avalanche').style.display = tab==='avalanche' ? 'block':'none';
  });
});

const verifyPresets = {
  match: "After eighteen months of hearings, the city council voted 6-1 Tuesday to approve funding for the Ridgeline light-rail extension, which will connect the downtown core to the eastern suburbs by 2029.",
  tampered: "After eighteen months of hearings, the city council voted 7-0 Tuesday to approve funding for the Ridgeline light-rail extension, which will connect the downtown core to the eastern suburbs by 2029."
};
document.querySelectorAll('[data-verify-preset]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.getElementById('verInput').value = verifyPresets[btn.dataset.verifyPreset];
  });
});

document.getElementById('verBtn').addEventListener('click', async () => {
  const text = document.getElementById('verInput').value.trim();
  const box = document.getElementById('verResult');
  if(!text){
    box.style.display='block';
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>Nothing to check</div><div class="hashline">Paste some text first.</div>';
    return;
  }
  const hash = await sha256Hex(text);
  const match = ledger.find(e => e.hash === hash);
  box.style.display='block';
  if(match){
    box.innerHTML = `
      <div class="badge ok"><span class="sq"></span>Verified — matches the ledger</div>
      <div class="hashline">
        Matches record published by ${escapeHtml(match.publisher)} (${match.time})<br>
        Fingerprint &nbsp;${hash}
      </div>`;
  } else {
    box.innerHTML = `
      <div class="badge bad"><span class="sq"></span>No matching record</div>
      <div class="hashline">
        This exact text does not match anything currently on the ledger. That can mean it was never published through TruthChain, or that it has been altered from the original.<br>
        Fingerprint &nbsp;${hash}
      </div>`;
  }
});

// ---------- VERIFY: avalanche ----------
async function updateAvalanche(){
  const val = document.getElementById('avaInput').value;
  const original = "The vote passed by a 6-1 margin.";
  const [h, hOrig] = await Promise.all([sha256Hex(val), sha256Hex(original)]);
  document.getElementById('avaHash').textContent = shortHash(h);
  const cmp = document.getElementById('avaCompare');
  if(h === hOrig){
    cmp.textContent = 'Matches original fingerprint exactly.';
    cmp.style.color = 'var(--verify)';
  } else {
    cmp.textContent = 'Does not match — the fingerprint changed completely, even though the text barely did.';
    cmp.style.color = 'var(--tamper)';
  }
}
document.getElementById('avaInput').addEventListener('input', updateAvalanche);
updateAvalanche();

// ---------- PHOTO: tabs ----------
document.querySelectorAll('[data-ptab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-ptab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['single','compare','resave'].forEach(t=>{
      document.getElementById('ptab-'+t).style.display = (t===btn.dataset.ptab) ? 'block':'none';
    });
  });
});

function wireDropzone(zoneId, inputId, onFile){
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', ()=> input.click());
  zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', ()=> zone.classList.remove('drag'));
  zone.addEventListener('drop', e=>{
    e.preventDefault(); zone.classList.remove('drag');
    if(e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e=>{
    if(e.target.files[0]) onFile(e.target.files[0]);
  });
}

// ---------- AI image likelihood heuristic ----------
function loadImageEl(file){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function hasExifMarker(file){
  const head = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  for(let i=0;i<head.length-4;i++){
    if(head[i]===0x45 && head[i+1]===0x78 && head[i+2]===0x69 && head[i+3]===0x66) return true; // "Exif"
  }
  return false;
}

async function analyzeImage(file){
  const img = await loadImageEl(file);
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let gradSum = 0, gradCount = 0;
  const grads = [];
  for(let y=1; y<h-1; y+=2){
    for(let x=1; x<w-1; x+=2){
      const i = (y*w+x)*4;
      const iR = (y*w+x+1)*4;
      const iD = ((y+1)*w+x)*4;
      const g = Math.abs(data[i]-data[iR]) + Math.abs(data[i]-data[iD]);
      grads.push(g); gradSum += g; gradCount++;
    }
  }
  const meanGrad = gradSum / gradCount;
  const variance = grads.reduce((a,b)=>a+(b-meanGrad)*(b-meanGrad),0) / gradCount;
  const stdGrad = Math.sqrt(variance);

  const colorBuckets = new Set();
  for(let i=0;i<data.length;i+=4*5){
    colorBuckets.add(((data[i]>>4)<<8) | ((data[i+1]>>4)<<4) | (data[i+2]>>4));
  }
  const colorRichness = colorBuckets.size / (data.length/4/5);

  const hasExif = await hasExifMarker(file);

  const signals = [];
  let score = 0;
  if(meanGrad < 6){ signals.push('Very low pixel-to-pixel variation — unusually smooth for a photographed scene'); score += 25; }
  if(stdGrad < 4){ signals.push('Texture detail looks uniform across the whole frame'); score += 20; }
  if(!hasExif){ signals.push('No camera metadata (EXIF) found in the file'); score += 25; }
  if(colorRichness < 0.3){ signals.push('Limited color variation relative to the image size'); score += 15; }
  if(meanGrad > 40){ signals.push('Fine-grain noise present, consistent with a camera sensor'); score -= 15; }
  if(hasExif){ signals.push('Camera metadata (EXIF) is present — more typical of a real photograph'); score -= 15; }
  if(!signals.length){ signals.push('No strong signals in either direction'); }

  score = Math.max(0, Math.min(100, score));
  return { score, signals, hasExif, meanGrad, w, h };
}

function verdictFor(score){
  if(score >= 55) return {level:'bad', label:'Signals lean AI-generated'};
  if(score >= 25) return {level:'warn', label:'Mixed or inconclusive signals'};
  return {level:'ok', label:'Signals lean real photograph'};
}

// single photo scan
wireDropzone('dropSingle','fileSingle', async (file)=>{
  const box = document.getElementById('singleResult');
  box.style.display='block';
  box.innerHTML = '<div class="hashline">Analyzing image…</div>';
  const url = URL.createObjectURL(file);
  const { score, signals } = await analyzeImage(file);
  const v = verdictFor(score);
  const fillColor = v.level==='ok' ? 'var(--verify)' : v.level==='warn' ? 'var(--amber)' : 'var(--tamper)';
  box.innerHTML = `
    <img src="${url}" class="thumb" alt="Uploaded photo preview">
    <div class="badge ${v.level}"><span class="sq"></span>${v.label} — score ${score}/100</div>
    <div class="meter"><div class="meter-fill" style="width:${score}%; background:${fillColor};"></div></div>
    <ul class="signals">${signals.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>
    <div class="hint">A simplified signal-based estimate for demo purposes — not a verified AI-detection system.</div>`;
});

// compare two photos
let fileA=null, fileB=null;
wireDropzone('dropA','fileA', f=>{ fileA=f; renderCompare(); });
wireDropzone('dropB','fileB', f=>{ fileB=f; renderCompare(); });
async function renderCompare(){
  if(!fileA || !fileB) return;
  const box = document.getElementById('compareResult');
  box.style.display='block';
  box.innerHTML = '<div class="hashline">Analyzing both images…</div>';
  const [a, b] = await Promise.all([analyzeImage(fileA), analyzeImage(fileB)]);
  const va = verdictFor(a.score), vb = verdictFor(b.score);
  box.innerHTML = `
    <div class="row2">
      <div>
        <div class="badge ${va.level}"><span class="sq"></span>Photo A — ${a.score}/100</div>
        <div class="hashline">${va.label}</div>
      </div>
      <div>
        <div class="badge ${vb.level}"><span class="sq"></span>Photo B — ${b.score}/100</div>
        <div class="hashline">${vb.label}</div>
      </div>
    </div>
    <div class="hint">${a.score===b.score ? 'Both images show a similar level of AI-likelihood signals.' : (a.score>b.score ? 'Photo A shows more AI-likelihood signals than Photo B.' : 'Photo B shows more AI-likelihood signals than Photo A.')}</div>`;
}

// metadata inspector
wireDropzone('dropResave','fileResave', async (file)=>{
  const box = document.getElementById('resaveResult');
  box.style.display='block';
  box.innerHTML = '<div class="hashline">Reading file metadata…</div>';
  const img = await loadImageEl(file);
  const hasExif = await hasExifMarker(file);
  box.innerHTML = `
    <div class="badge ${hasExif?'ok':'warn'}"><span class="sq"></span>${hasExif ? 'Camera metadata (EXIF) found' : 'No camera metadata (EXIF) found'}</div>
    <div class="hashline">
      File name &nbsp;${escapeHtml(file.name)}<br>
      File type &nbsp;${escapeHtml(file.type || 'unknown')}<br>
      File size &nbsp;${(file.size/1024).toFixed(1)} KB<br>
      Dimensions &nbsp;${img.width} × ${img.height}px
    </div>
    <div class="hint">${hasExif ? 'EXIF data is common in unedited camera photos and often stripped by AI generators, screenshots, and some messaging apps.' : 'Missing EXIF is common in AI-generated images and screenshots — but also in photos shared through apps that strip metadata on upload, so this alone is not conclusive.'}</div>`;
});

// ---------- DETECT ----------
const detectPresets = {
  clean: "City council approves new transit line\n\nThe city council voted 6-1 Tuesday to approve funding for the Ridgeline light-rail extension. Officials say construction will begin next spring, with service expected by 2029, according to the city's transportation department.",
  clickbait: "YOU WON'T BELIEVE What The City Just Approved!!! Locals Are FURIOUS!!!\n\nThis is HUGE. The council just voted on something that will change EVERYTHING and nobody is talking about it!!!",
  satire: "Sources say the entire council secretly agreed to the deal months ago in a private meeting nobody can confirm happened. No officials would go on record, but everyone knows it's true."
};
document.querySelectorAll('[data-detect-preset]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.getElementById('detInput').value = detectPresets[btn.dataset.detectPreset];
  });
});

function runDetection(text){
  const signals = [];
  let score = 0;

  const letters = text.replace(/[^a-zA-Z]/g,'');
  const caps = text.replace(/[^A-Z]/g,'');
  const capsRatio = letters.length ? caps.length / letters.length : 0;
  if(capsRatio > 0.15){ signals.push('Unusually high ratio of capital letters'); score += 25; }

  const exclaims = (text.match(/!/g)||[]).length;
  if(exclaims >= 3){ signals.push(`${exclaims} exclamation marks — heavier punctuation than typical reporting`); score += 20; }

  const sensational = ['you won\'t believe','shocking','secretly','nobody is talking about','furious','everyone knows','sources say'];
  const hits = sensational.filter(p => text.toLowerCase().includes(p));
  if(hits.length){ signals.push(`Sensational phrasing detected: ${hits.map(h=>'"'+h+'"').join(', ')}`); score += hits.length * 15; }

  const hasAttribution = /(according to|said|reported|officials|department|sources? (confirmed|said))/i.test(text);
  if(!hasAttribution){ signals.push('No clear attribution or named source found'); score += 20; }

  const vague = /(no officials would go on record|nobody can confirm|everyone knows it\'s true)/i.test(text);
  if(vague){ signals.push('Contains claims that are explicitly unconfirmable'); score += 20; }

  score = Math.min(100, score);
  return {score, signals};
}

document.getElementById('detBtn').addEventListener('click', ()=>{
  const text = document.getElementById('detInput').value.trim();
  const box = document.getElementById('detResult');
  if(!text){
    box.style.display='block';
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>Nothing to scan</div><div class="hashline">Paste or load some text first.</div>';
    return;
  }
  const {score, signals} = runDetection(text);
  box.style.display='block';
  let level = 'ok', label='Low risk signals';
  if(score >= 60){ level='bad'; label='High risk signals'; }
  else if(score >= 25){ level='warn'; label='Some risk signals'; }

  const fillColor = level==='ok' ? 'var(--verify)' : level==='warn' ? 'var(--amber)' : 'var(--tamper)';
  box.innerHTML = `
    <div class="badge ${level}"><span class="sq"></span>${label} — score ${score}/100</div>
    <div class="meter"><div class="meter-fill" style="width:${score}%; background:${fillColor};"></div></div>
    ${signals.length ? `<ul class="signals">${signals.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '<div class="hint">No common risk signals found in this pattern scan.</div>'}
    <div class="hint">This is a surface-level pattern check, not a fact-check. Always confirm with the original source.</div>
  `;
});

// ---------- EXPLORER ----------
let currentFilter = 'all';
document.querySelectorAll('[data-filter]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-filter]').forEach(b=>{
      b.style.background='transparent'; b.style.color='var(--slate-light)'; b.style.borderColor='var(--line)';
    });
    btn.style.background='var(--paper)'; btn.style.color='var(--ink)'; btn.style.borderColor='var(--paper)';
    currentFilter = btn.dataset.filter;
    renderExplorer();
  });
});
document.getElementById('explSearch').addEventListener('input', renderExplorer);

function renderExplorer(){
  const q = document.getElementById('explSearch').value.trim().toLowerCase();
  const body = document.getElementById('explBody');
  const rows = ledger.filter(e=>{
    if(currentFilter !== 'all' && e.type !== currentFilter) return false;
    if(!q) return true;
    return e.title.toLowerCase().includes(q) || e.publisher.toLowerCase().includes(q) || e.hash.includes(q);
  });
  body.innerHTML = rows.map((e,i)=>`
    <tr data-idx="${ledger.indexOf(e)}">
      <td><span class="tag ${e.type}">${e.type}</span></td>
      <td>${escapeHtml(e.title)}</td>
      <td>${escapeHtml(e.publisher)}</td>
      <td class="hash-short">${shortHash(e.hash)}</td>
      <td>${e.time}</td>
    </tr>`).join('') || `<tr><td colspan="5" style="color:var(--slate); text-align:center; padding:30px;">No records match your search.</td></tr>`;

  body.querySelectorAll('tr[data-idx]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const e = ledger[tr.dataset.idx];
      const det = document.getElementById('explDetail');
      det.style.display='block';
      det.innerHTML = `
        <div class="badge ok"><span class="sq"></span>Ledger record</div>
        <div class="hashline">
          Title &nbsp;&nbsp;${escapeHtml(e.title)}<br>
          Type &nbsp;&nbsp;&nbsp;${e.type}<br>
          Publisher &nbsp;${escapeHtml(e.publisher)}<br>
          Fingerprint &nbsp;${e.hash}<br>
          Timestamp &nbsp;${e.time}
        </div>`;
    });
  });
}

seedLedger();
