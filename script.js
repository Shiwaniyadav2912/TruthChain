/*
  TRUTHCHAIN — script.js
  -----------------------
  This file controls what happens when you click things (the interactivity).

  How it's organized, top to bottom:
  1. Utilities         - hashing text/files, formatting, escaping HTML
  2. Storage helpers    - wraps window.storage as a simple "database"
                          (shared = visible to everyone; personal = just you)
  3. Blockchain registry - Demo Blockchain Mode: simulates registerArticle()/
                          verifyArticle() from a real smart contract
  4. Users & auth        - register, login, logout, password hashing, sessions
  5. Seed demo data       - creates the admin + ISRO demo publisher/article
  6. Session-aware UI     - shows/hides nav links and gated sections by role
  7. Auth modal           - login/register form logic
  8. Publisher portal     - apply-to-become-a-publisher flow
  9. Admin dashboard       - approve/reject publishers, list all users
  10. Hero demo            - the fingerprint shown at the top of the page
  11. Publish (Register Article) - gated to verified publishers only
  12. Verify demo          - #verify section logic (registry check + ISRO
                          tampering demonstration)
  13. Photo / AI check     - #photo section logic (three tabs, unchanged)
  14. Detect demo          - #detect section logic (unchanged)
  15. Blockchain Records    - #explorer section logic (search, table, detail)
  16. App init              - seeds demo data and renders the page on load

  Every demo follows the same pattern:
    - find the button/input with document.getElementById(...)
    - listen for a click or input event with .addEventListener(...)
    - run some logic
    - write the result into the page with .innerHTML = `...`
*/

// ---------- storage fallback for running outside Claude ----------
// window.storage only exists inside Claude's own artifact preview. When this
// file is opened as a normal webpage (VS Code Live Server, GitHub Pages, a
// plain double-clicked index.html, etc.) we provide the same get/set/delete
// API backed by the browser's localStorage instead, so the app behaves
// identically either way. Inside Claude, this block does nothing.
if(typeof window.storage === 'undefined'){
  window.storage = {
    async get(key, shared){
      const k = (shared ? 'tc_shared:' : 'tc_personal:') + key;
      const v = localStorage.getItem(k);
      if(v === null) throw new Error('key not found: ' + key);
      return {key, value: v, shared: !!shared};
    },
    async set(key, value, shared){
      const k = (shared ? 'tc_shared:' : 'tc_personal:') + key;
      localStorage.setItem(k, value);
      return {key, value, shared: !!shared};
    },
    async delete(key, shared){
      const k = (shared ? 'tc_shared:' : 'tc_personal:') + key;
      localStorage.removeItem(k);
      return {key, deleted: true, shared: !!shared};
    },
    async list(prefix, shared){
      const p = (shared ? 'tc_shared:' : 'tc_personal:') + (prefix || '');
      const keys = Object.keys(localStorage).filter(k => k.startsWith(p)).map(k => k.slice((shared ? 'tc_shared:' : 'tc_personal:').length));
      return {keys, prefix, shared: !!shared};
    }
  };
}

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

// ---------- storage helpers ----------
// Wraps window.storage so the rest of the app can just await getJSON/setJSON.
// "shared" storage acts as our demo database (users, publishers, articles).
// "personal" (non-shared) storage holds just the current visitor's session.
async function getJSON(key, shared, fallback){
  try{
    const res = await window.storage.get(key, shared);
    return res ? JSON.parse(res.value) : fallback;
  }catch(e){
    return fallback;
  }
}
async function setJSON(key, value, shared){
  try{
    await window.storage.set(key, JSON.stringify(value), shared);
  }catch(e){
    console.error('storage error', e);
  }
}

// ---------- demo blockchain registry (Demo Blockchain Mode) ----------
// This simulates a smart contract's registerArticle()/verifyArticle() calls.
// It is clearly NOT a real blockchain — see the note in the README / final report.
function makeTxId(){
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'DEMO-0x' + Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function registerArticleOnChain({title, category, pubDate, url, hash, publisherUsername, publisherName}){
  const id = 'TC-' + Date.now().toString(36).toUpperCase();
  const record = {
    id, title, category, pubDate, url, hash,
    publisher: publisherUsername, publisherName,
    time: nowStamp(),
    status: 'registered',
    txId: makeTxId(),
    mode: 'Demo Blockchain Mode'
  };
  await setJSON('articles:' + id, record, true);
  const index = await getJSON('articles:index', true, []);
  index.unshift(id);
  await setJSON('articles:index', index, true);
  return record;
}

async function getAllArticles(){
  const index = await getJSON('articles:index', true, []);
  const out = [];
  for(const id of index){
    const rec = await getJSON('articles:' + id, true, null);
    if(rec) out.push(rec);
  }
  return out;
}

async function findArticleByHash(hash){
  const all = await getAllArticles();
  return all.find(a => a.hash === hash) || null;
}

// ---------- users & auth ----------
async function findUser(username){
  return getJSON('users:' + username.toLowerCase(), true, null);
}
async function saveUser(user){
  await setJSON('users:' + user.username.toLowerCase(), user, true);
  const index = await getJSON('users:index', true, []);
  if(!index.includes(user.username.toLowerCase())){
    index.push(user.username.toLowerCase());
    await setJSON('users:index', index, true);
  }
}
async function getAllUsers(){
  const index = await getJSON('users:index', true, []);
  const out = [];
  for(const u of index){
    const rec = await getJSON('users:' + u, true, null);
    if(rec) out.push(rec);
  }
  return out;
}

// NOTE: this hashes passwords with SHA-256 purely so we never store them in
// plain text in this prototype's demo storage. It is NOT a substitute for
// real server-side authentication (e.g. Supabase Auth with salted hashing),
// which is what a production version of TruthChain should use instead.
async function hashPassword(pw){ return sha256Hex('truthchain-demo-salt::' + pw); }

async function getSession(){ return getJSON('session', false, null); }
async function setSession(session){ await setJSON('session', session, false); }
async function clearSession(){ try{ await window.storage.delete('session', false); }catch(e){} }

async function registerPublisherApplication(username, org){
  const app = {
    username, orgName: org.orgName, email: org.email, website: org.website,
    description: org.description, publisherType: org.publisherType,
    docName: org.docName || '(none provided — prototype only)',
    status: 'pending', appliedAt: nowStamp()
  };
  await setJSON('publishers:' + username.toLowerCase(), app, true);
  const index = await getJSON('publishers:index', true, []);
  if(!index.includes(username.toLowerCase())){
    index.push(username.toLowerCase());
    await setJSON('publishers:index', index, true);
  }
  return app;
}
async function getAllPublisherApps(){
  const index = await getJSON('publishers:index', true, []);
  const out = [];
  for(const u of index){
    const rec = await getJSON('publishers:' + u, true, null);
    if(rec) out.push(rec);
  }
  return out;
}

// ---------- seed demo data (runs once) ----------
async function seedDemoData(){
  const already = await getJSON('seeded:v2', true, false);
  if(already) return;

  const adminPass = await hashPassword('admin123');
  await saveUser({username:'admin', passwordHash: adminPass, role:'admin', publisherStatus:null, createdAt: nowStamp()});

  const pubPass = await hashPassword('isro1234');
  await saveUser({username:'isro', passwordHash: pubPass, role:'publisher', publisherStatus:'approved', createdAt: nowStamp()});
  await setJSON('publishers:isro', {
    username:'isro', orgName:'ISRO', email:'press@isro.gov.in', website:'https://isro.gov.in',
    description:'India\'s national space agency (demo account).', publisherType:'Government agency',
    docName:'(demo account — pre-approved)', status:'approved', appliedAt: nowStamp()
  }, true);
  const pubIndex = await getJSON('publishers:index', true, []);
  if(!pubIndex.includes('isro')){ pubIndex.push('isro'); await setJSON('publishers:index', pubIndex, true); }

  const isroBody = ISRO_ORIGINAL_TEXT;
  const isroHash = await sha256Hex(isroBody);
  await registerArticleOnChain({
    title:'ISRO Successfully Launches Chandrayaan-3', category:'Space & science',
    pubDate:'2023-07-14', url:'https://isro.gov.in/chandrayaan3', hash: isroHash,
    publisherUsername:'isro', publisherName:'ISRO'
  });

  await setJSON('seeded:v2', true, true);
}

// Demo article text used by the tampering demonstration and seed data.
const ISRO_ORIGINAL_TEXT = "ISRO successfully launched the Chandrayaan-3 mission from the Satish Dhawan Space Centre, sending an orbiter, lander, and rover toward the Moon. Officials said the lander is targeting a soft touchdown near the lunar south pole, a region no previous mission has reached intact. [DEMO ARTICLE]";
const ISRO_MODIFIED_TEXT = "ISRO successfully launched the Chandrayaan-4 mission from the Satish Dhawan Space Centre, sending an orbiter, lander, and rover toward the Moon. Officials said the lander is targeting a soft touchdown near the lunar south pole, a region no previous mission has reached intact. [DEMO ARTICLE]";

// ---------- session-aware UI ----------
let currentSession = null; // {username, role} or null

async function refreshSessionUI(){
  currentSession = await getSession();
  const authArea = document.getElementById('authArea');

  if(!currentSession){
    authArea.innerHTML = `<button class="btn-sm" id="openAuthBtn">Login / Register</button>`;
    document.getElementById('openAuthBtn').addEventListener('click', openAuthModal);
  } else {
    const user = await findUser(currentSession.username);
    const roleLabel = currentSession.role === 'admin' ? 'Administrator'
      : currentSession.role === 'publisher' ? 'Verified publisher'
      : 'Normal user';
    authArea.innerHTML = `
      <div class="user-pill">
        <span>${escapeHtml(currentSession.username)}</span>
        <span class="role-pill">${roleLabel}</span>
      </div>
      <button class="btn-sm" id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn').addEventListener('click', async ()=>{
      await clearSession();
      await refreshSessionUI();
    });
  }

  // Nav: show/hide role-specific links (role is 'guest' when logged out)
  const role = currentSession ? currentSession.role : 'guest';
  document.querySelectorAll('[data-nav]').forEach(a=>{
    const allowed = a.dataset.nav.split(',');
    a.style.display = allowed.includes(role) ? '' : 'none';
  });

  // Gated sections
  const isApprovedPublisher = currentSession && currentSession.role === 'publisher';
  document.getElementById('publishLock').style.display = isApprovedPublisher ? 'none' : 'block';
  document.getElementById('publishUnlocked').style.display = isApprovedPublisher ? 'block' : 'none';
  document.getElementById('adminDashboard').style.display = currentSession && currentSession.role === 'admin' ? 'block' : 'none';
  // Register Image tab (#photo) — gated the same way as Publish
  document.getElementById('imgRegisterLock').style.display = isApprovedPublisher ? 'none' : 'block';
  document.getElementById('imgRegisterUnlocked').style.display = isApprovedPublisher ? 'block' : 'none';

  await renderPublisherPortal();
  if(isApprovedPublisher){ await renderMyArticles(); await renderMyImages(); }
  if(currentSession && currentSession.role === 'admin'){
    await renderPendingPublishers();
    await renderAllUsers();
  }
}

// ---------- auth modal ----------
function openAuthModal(){ document.getElementById('authModal').style.display = 'flex'; }
function closeAuthModal(){ document.getElementById('authModal').style.display = 'none'; }
document.getElementById('authClose').addEventListener('click', closeAuthModal);
document.getElementById('authModal').addEventListener('click', (e)=>{
  if(e.target.id === 'authModal') closeAuthModal();
});

document.querySelectorAll('[data-authtab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-authtab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('authtab-login').style.display = btn.dataset.authtab==='login' ? 'block':'none';
    document.getElementById('authtab-register').style.display = btn.dataset.authtab==='register' ? 'block':'none';
  });
});

let regRole = 'user';
document.querySelectorAll('.role-chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.role-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    regRole = btn.dataset.role;
    document.getElementById('regPublisherFields').style.display = regRole==='publisher' ? 'block' : 'none';
  });
});

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const username = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const box = document.getElementById('loginResult');
  box.style.display = 'block';
  if(!username || !pass){
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>Missing details</div><div class="hashline">Enter a username and password.</div>';
    return;
  }
  const user = await findUser(username);
  const hash = await hashPassword(pass);
  if(!user || user.passwordHash !== hash){
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>Login failed</div><div class="hashline">Incorrect username or password.</div>';
    return;
  }
  await setSession({username: user.username, role: user.role});
  box.innerHTML = '<div class="badge ok"><span class="sq"></span>Logged in</div>';
  await refreshSessionUI();
  setTimeout(closeAuthModal, 400);
});

document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const username = document.getElementById('regUser').value.trim();
  const pass = document.getElementById('regPass').value;
  const box = document.getElementById('registerResult');
  box.style.display = 'block';

  if(!username || pass.length < 6){
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>Check your details</div><div class="hashline">Username is required and password must be at least 6 characters.</div>';
    return;
  }
  const existing = await findUser(username);
  if(existing){
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>Username taken</div><div class="hashline">Try a different username.</div>';
    return;
  }

  const passwordHash = await hashPassword(pass);
  const role = regRole === 'publisher' ? 'user' : 'user'; // publisher access is granted only after admin approval
  const publisherStatus = regRole === 'publisher' ? 'pending' : null;
  const user = {username, passwordHash, role, publisherStatus, createdAt: nowStamp()};
  await saveUser(user);

  if(regRole === 'publisher'){
    const org = {
      orgName: document.getElementById('regOrgName').value.trim() || username,
      email: document.getElementById('regOrgEmail').value.trim(),
      website: document.getElementById('regOrgSite').value.trim(),
      description: document.getElementById('regOrgDesc').value.trim(),
      publisherType: document.getElementById('regOrgType').value.trim(),
      docName: (document.getElementById('regOrgDoc').files[0] || {}).name
    };
    await registerPublisherApplication(username, org);
  }

  await setSession({username, role});
  box.innerHTML = regRole === 'publisher'
    ? '<div class="badge warn"><span class="sq"></span>Account created</div><div class="hashline">Your publisher application is pending admin review. You can verify articles as a normal user in the meantime.</div>'
    : '<div class="badge ok"><span class="sq"></span>Account created</div>';
  await refreshSessionUI();
  setTimeout(closeAuthModal, 900);
});

// ---------- publisher portal ----------
async function renderPublisherPortal(){
  const panel = document.getElementById('portalPanel');
  if(!currentSession){
    panel.innerHTML = `<p class="hint">Log in or create a normal-user account, then apply here to become a verified publisher.</p>
      <button class="btn-sm" id="portalLoginBtn">Login / Register</button>`;
    document.getElementById('portalLoginBtn').addEventListener('click', openAuthModal);
    return;
  }
  if(currentSession.role === 'admin'){
    panel.innerHTML = `<p class="hint">Admin accounts manage publisher applications from the Admin Dashboard below.</p>`;
    return;
  }
  if(currentSession.role === 'publisher'){
    panel.innerHTML = `<div class="status-pill approved">✓ Verified publisher</div><p class="hint" style="margin-top:10px;">You can register articles from the Publisher Dashboard.</p>`;
    return;
  }
  const app = await getJSON('publishers:' + currentSession.username, true, null);
  if(app && app.status === 'pending'){
    panel.innerHTML = `<div class="status-pill pending">Pending verification</div><p class="hint" style="margin-top:10px;">Your application for <strong>${escapeHtml(app.orgName)}</strong> is awaiting admin review.</p>`;
    return;
  }
  if(app && app.status === 'rejected'){
    panel.innerHTML = `<div class="status-pill rejected">Application rejected</div><p class="hint" style="margin-top:10px;">Contact support, or submit a new application below.</p>` + publisherFormHtml();
    wirePublisherForm();
    return;
  }
  panel.innerHTML = publisherFormHtml();
  wirePublisherForm();
}

function publisherFormHtml(){
  return `
    <div class="row2">
      <div class="field"><label for="pfOrgName">Publisher / organization name</label><input type="text" id="pfOrgName" placeholder="e.g. Ridgeline Daily"></div>
      <div class="field"><label for="pfOrgEmail">Official email</label><input type="text" id="pfOrgEmail" placeholder="editor@ridgelinedaily.com"></div>
    </div>
    <div class="row2">
      <div class="field"><label for="pfOrgSite">Website</label><input type="text" id="pfOrgSite" placeholder="https://ridgelinedaily.com"></div>
      <div class="field"><label for="pfOrgType">Publisher type</label><input type="text" id="pfOrgType" placeholder="e.g. Newspaper, Agency, Independent"></div>
    </div>
    <div class="field"><label for="pfOrgDesc">Description</label><textarea id="pfOrgDesc" rows="2" placeholder="What does this outlet publish?"></textarea></div>
    <div class="field"><label for="pfOrgDoc">Verification document (prototype only)</label><input type="file" id="pfOrgDoc"></div>
    <button class="btn-sm" id="pfSubmit">Submit application</button>
    <div class="result" id="pfResult" style="display:none;"></div>`;
}
function wirePublisherForm(){
  const btn = document.getElementById('pfSubmit');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    const org = {
      orgName: document.getElementById('pfOrgName').value.trim(),
      email: document.getElementById('pfOrgEmail').value.trim(),
      website: document.getElementById('pfOrgSite').value.trim(),
      description: document.getElementById('pfOrgDesc').value.trim(),
      publisherType: document.getElementById('pfOrgType').value.trim(),
      docName: (document.getElementById('pfOrgDoc').files[0] || {}).name
    };
    const box = document.getElementById('pfResult');
    if(!org.orgName || !org.email){
      box.style.display='block';
      box.innerHTML = '<div class="badge warn"><span class="sq"></span>Missing details</div><div class="hashline">Organization name and email are required.</div>';
      return;
    }
    await registerPublisherApplication(currentSession.username, org);
    const user = await findUser(currentSession.username);
    user.publisherStatus = 'pending';
    await saveUser(user);
    await renderPublisherPortal();
  });
}

// ---------- admin: pending publishers + all users ----------
async function renderPendingPublishers(){
  const apps = await getAllPublisherApps();
  const pending = apps.filter(a=>a.status==='pending');
  const body = document.getElementById('pendingPublishersBody');
  document.getElementById('pendingPublishersEmpty').style.display = pending.length ? 'none':'block';
  body.innerHTML = pending.map(a=>`
    <tr>
      <td>${escapeHtml(a.orgName)}</td>
      <td>${escapeHtml(a.email)}</td>
      <td>${escapeHtml(a.website||'—')}</td>
      <td>${a.appliedAt}</td>
      <td><span class="status-pill pending">Pending</span></td>
      <td>
        <button class="btn-approve" data-approve="${escapeHtml(a.username)}">Approve</button>
        <button class="btn-reject" data-reject="${escapeHtml(a.username)}">Reject</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-approve]').forEach(b=>b.addEventListener('click', async ()=>{
    await setApplicationStatus(b.dataset.approve, 'approved');
  }));
  body.querySelectorAll('[data-reject]').forEach(b=>b.addEventListener('click', async ()=>{
    await setApplicationStatus(b.dataset.reject, 'rejected');
  }));
}
async function setApplicationStatus(username, status){
  const app = await getJSON('publishers:' + username, true, null);
  if(!app) return;
  app.status = status;
  await setJSON('publishers:' + username, app, true);
  const user = await findUser(username);
  if(user){
    user.publisherStatus = status;
    if(status === 'approved') user.role = 'publisher';
    await saveUser(user);
  }
  await renderPendingPublishers();
  await renderAllUsers();
}
async function renderAllUsers(){
  const users = await getAllUsers();
  document.getElementById('allUsersBody').innerHTML = users.map(u=>`
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td>${u.publisherStatus ? `<span class="status-pill ${u.publisherStatus}">${u.publisherStatus}</span>` : '—'}</td>
      <td>${u.createdAt}</td>
    </tr>`).join('');
}

// ---------- hero ambient fingerprint ----------
(async function heroDemo(){
  const sample = "TruthChain verifies news articles and photos with cryptographic fingerprints.";
  const h = await sha256Hex(sample);
  document.getElementById('heroHashA').textContent = h;
  document.getElementById('heroHashB').textContent = h;
  document.getElementById('heroTime').textContent = nowStamp();
})();

// ---------- PUBLISH (Register New Article — gated to verified publishers) ----------
document.getElementById('pubBtn').addEventListener('click', async () => {
  const box = document.getElementById('pubResult');
  if(!currentSession || currentSession.role !== 'publisher'){
    box.style.display='block';
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>Not authorized</div><div class="hashline">Only verified publishers can register articles.</div>';
    return;
  }
  const title = document.getElementById('pubTitle').value.trim() || 'Untitled';
  const category = document.getElementById('pubCategory').value.trim() || 'Uncategorized';
  const pubDate = document.getElementById('pubDate').value.trim() || nowStamp().slice(0,10);
  const url = document.getElementById('pubUrl').value.trim() || '(none provided)';
  const body = document.getElementById('pubBody').value.trim();
  if(!body){
    box.style.display='block';
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>No content</div><div class="hashline">Add some article text before registering.</div>';
    return;
  }
  const user = await findUser(currentSession.username);
  const publisherApp = await getJSON('publishers:' + currentSession.username, true, null);
  const publisherName = publisherApp ? publisherApp.orgName : currentSession.username;

  const hash = await sha256Hex(body); // only the hash is ever registered — article text stays off-chain
  const record = await registerArticleOnChain({
    title, category, pubDate, url, hash,
    publisherUsername: currentSession.username, publisherName
  });

  box.style.display='block';
  box.innerHTML = `
    <div class="badge ok"><span class="sq"></span>✓ Blockchain Registered <span style="opacity:.7;">(Demo Blockchain Mode)</span></div>
    <div class="hashline">
      Article ID &nbsp;${record.id}<br>
      SHA-256 Hash &nbsp;${hash}<br>
      Publisher &nbsp;${escapeHtml(publisherName)}<br>
      Timestamp &nbsp;${record.time}<br>
      Blockchain Status &nbsp;registered<br>
      Transaction ID &nbsp;${record.txId}
    </div>`;
  await renderMyArticles();
});

async function renderMyArticles(){
  if(!currentSession) return;
  const all = await getAllArticles();
  const mine = all.filter(a => a.publisher === currentSession.username);
  document.getElementById('myArticlesEmpty').style.display = mine.length ? 'none':'block';
  document.getElementById('myArticlesBody').innerHTML = mine.map(a=>`
    <tr>
      <td class="hash-short">${a.id}</td>
      <td>${escapeHtml(a.title)}</td>
      <td class="hash-short">${shortHash(a.hash)}</td>
      <td>${a.time}</td>
      <td><span class="badge ok"><span class="sq"></span>registered</span></td>
    </tr>`).join('');
}

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

const verifyPresets = { match: ISRO_ORIGINAL_TEXT, tampered: ISRO_MODIFIED_TEXT };
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
  const match = await findArticleByHash(hash);
  box.style.display='block';
  if(match){
    box.innerHTML = `
      <div class="badge ok"><span class="sq"></span>✓ Authentic version verified</div>
      <div class="hashline">
        Publisher &nbsp;${escapeHtml(match.publisherName)}<br>
        Registration date &nbsp;${match.time}<br>
        SHA-256 &nbsp;${hash}<br>
        Blockchain status &nbsp;✓ verified<br>
        Transaction / record &nbsp;${match.txId} (${match.id})
      </div>`;
  } else {
    box.innerHTML = `
      <div class="badge warn"><span class="sq"></span>⚠ Article not found</div>
      <div class="hashline">
        No matching registered version was found in the TruthChain blockchain registry.<br>
        Authenticity could not be verified because no matching blockchain record was found.<br>
        Fingerprint &nbsp;${hash}
      </div>`;
  }
});

// ---------- VERIFY: tampering demonstration (ISRO demo article) ----------
document.querySelectorAll('[data-ava-preset]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.getElementById('avaInput').value = btn.dataset.avaPreset === 'match' ? ISRO_ORIGINAL_TEXT : ISRO_MODIFIED_TEXT;
  });
});
document.getElementById('avaBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('avaInput').value.trim();
  const box = document.getElementById('avaResult');
  box.style.display = 'block';
  if(!text){
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>Nothing to check</div><div class="hashline">Load the original or modified version first.</div>';
    return;
  }
  const hash = await sha256Hex(text);
  const isroHash = await sha256Hex(ISRO_ORIGINAL_TEXT);
  if(hash === isroHash){
    box.innerHTML = `<div class="badge ok"><span class="sq"></span>✓ Match found</div><div class="hashline">This text matches ISRO's registered blockchain record exactly.<br>Fingerprint &nbsp;${hash}</div>`;
  } else {
    box.innerHTML = `<div class="badge bad"><span class="sq"></span>✗ Hash mismatch</div><div class="hashline">The submitted content differs from the version registered by the publisher.<br>Fingerprint &nbsp;${hash}</div>`;
  }
});

// ---------- PHOTO: tabs ----------
const PHOTO_TABS = ['verify','register','compare','scan','resave'];
document.querySelectorAll('[data-ptab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-ptab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    PHOTO_TABS.forEach(t=>{
      document.getElementById('ptab-'+t).style.display = (t===btn.dataset.ptab) ? 'block':'none';
    });
  });
});
function switchPhotoTab(tab){
  document.querySelector(`[data-ptab="${tab}"]`).click();
}

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

// ---------- IMAGE REGISTRY (Demo Blockchain Mode — mirrors the article registry) ----------
// Only the SHA-256 hash, perceptual fingerprint, and metadata are ever stored —
// never the image bytes themselves, per the "don't store images on-chain" rule.
async function registerImageOnChain({title, description, pubDate, sourceUrl, hash, phash, publisherUsername, publisherName, demo}){
  const id = 'TC-IMG-' + Date.now().toString(36).toUpperCase();
  const record = {
    id, title, description, pubDate, sourceUrl, hash, phash,
    publisher: publisherUsername, publisherName,
    time: nowStamp(), status: 'registered', txId: makeTxId(),
    mode: 'Demo Blockchain Mode', demo: !!demo
  };
  await setJSON('images:' + id, record, true);
  const index = await getJSON('images:index', true, []);
  index.unshift(id);
  await setJSON('images:index', index, true);
  return record;
}
async function getAllImages(){
  const index = await getJSON('images:index', true, []);
  const out = [];
  for(const id of index){
    const rec = await getJSON('images:' + id, true, null);
    if(rec) out.push(rec);
  }
  return out;
}
async function findImageByHash(hash){
  const all = await getAllImages();
  return all.find(r => r.hash === hash) || null;
}
// Best perceptual match across the registry, by Hamming distance (lower = more similar).
async function bestPerceptualImageMatch(phash){
  const all = await getAllImages();
  let best = null, bestDist = 65;
  for(const rec of all){
    if(!rec.phash) continue;
    const d = hammingDistanceHex(phash, rec.phash);
    if(d < bestDist){ bestDist = d; best = rec; }
  }
  return { best, bestDist };
}

// ---------- image verification check log (drives the Image Detection Dashboard) ----------
async function logImageCheck(entry){
  const id = 'CHK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  const record = { id, time: nowStamp(), ...entry };
  await setJSON('imageChecks:' + id, record, true);
  const index = await getJSON('imageChecks:index', true, []);
  index.unshift(id);
  await setJSON('imageChecks:index', index, true);
  return record;
}
async function getAllImageChecks(){
  const index = await getJSON('imageChecks:index', true, []);
  const out = [];
  for(const id of index){
    const rec = await getJSON('imageChecks:' + id, true, null);
    if(rec) out.push(rec);
  }
  return out;
}
async function renderImageDashboard(){
  const checks = await getAllImageChecks();
  const images = await getAllImages();
  document.getElementById('imgStatTotal').textContent = checks.length;
  document.getElementById('imgStatAuthentic').textContent = checks.filter(c=>c.status==='authentic').length;
  document.getElementById('imgStatModified').textContent = checks.filter(c=>c.status==='possible').length;
  document.getElementById('imgStatUnverified').textContent = checks.filter(c=>c.status==='unverified').length;
  document.getElementById('imgStatRegistered').textContent = images.length;

  const body = document.getElementById('imageChecksBody');
  const recent = checks.slice(0, 12);
  document.getElementById('imageChecksEmpty').style.display = recent.length ? 'none' : 'block';
  const statusBadge = { authentic:'ok', possible:'warn', unverified:'bad' };
  const statusLabel = { authentic:'Authentic', possible:'Possible match', unverified:'Not verified' };
  body.innerHTML = recent.map(c=>`
    <tr>
      <td>${escapeHtml(c.filename||'(unnamed)')}</td>
      <td>${escapeHtml(c.publisherName || '—')}</td>
      <td class="hash-short">${shortHash(c.hash)}</td>
      <td>${c.similarity}%</td>
      <td><span class="badge ${statusBadge[c.status]}"><span class="sq"></span>${statusLabel[c.status]}</span></td>
      <td>${c.time}</td>
    </tr>`).join('');
}

// ---------- PERCEPTUAL HASHING (dHash) — detects visually similar images ----------
// This is a lightweight 64-bit difference-hash computed from an 9x8 grayscale
// thumbnail. It's distinct from the SHA-256 hash: SHA-256 detects ANY byte
// change, this detects visual similarity even after resizing/re-compression.
async function perceptualHash(file){
  const img = await loadImageEl(file);
  const w = 9, h = 8;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = [];
  for(let i=0;i<data.length;i+=4){
    gray.push(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
  }
  let bits = '';
  for(let y=0;y<h;y++){
    for(let x=0;x<w-1;x++){
      const idx = y*w+x;
      bits += gray[idx] < gray[idx+1] ? '1' : '0';
    }
  }
  let hex = '';
  for(let i=0;i<bits.length;i+=4){
    hex += parseInt(bits.substr(i,4),2).toString(16);
  }
  return hex; // 16 hex chars = 64 bits
}
function hammingDistanceHex(a,b){
  let dist = 0;
  for(let i=0;i<Math.min(a.length,b.length);i++){
    let x = parseInt(a[i],16) ^ parseInt(b[i],16);
    while(x){ dist += x & 1; x >>= 1; }
  }
  return dist;
}
function similarityFromHamming(dist, bits=64){
  return Math.max(0, Math.round((1 - dist/bits) * 100));
}
const POSSIBLE_MATCH_MAX_DIST = 16; // similarity >= 75% counted as visually similar

// Core verification: hashes a file, checks it against the image registry, logs
// the check, and returns a result object ready to render.
async function runImageVerification(file){
  const hash = await sha256HexFromFile(file);
  const phash = await perceptualHash(file);
  const exact = await findImageByHash(hash);

  let result;
  if(exact){
    result = {
      status:'authentic', similarity:100, matched:exact,
      badgeLabel:'AUTHENTIC IMAGE', category:'Authentic / Exact Match'
    };
  } else {
    const { best, bestDist } = await bestPerceptualImageMatch(phash);
    if(best && bestDist <= POSSIBLE_MATCH_MAX_DIST){
      result = {
        status:'possible', similarity: similarityFromHamming(bestDist), matched: best,
        badgeLabel:'POSSIBLE MATCH', category:'Likely Same Image'
      };
    } else {
      result = {
        status:'unverified', similarity: best ? similarityFromHamming(bestDist) : 0, matched:null,
        badgeLabel:'IMAGE MODIFIED / NOT VERIFIED', category:'No Match'
      };
    }
  }

  await logImageCheck({
    hash, phash, status: result.status, similarity: result.similarity,
    matchedImageId: result.matched ? result.matched.id : null,
    publisherName: result.matched ? result.matched.publisherName : null,
    filename: file.name
  });
  await renderImageDashboard();
  return { hash, phash, file, ...result };
}

function renderVerifyResult(container, r){
  const url = URL.createObjectURL(r.file);
  const badgeLevel = r.status === 'authentic' ? 'ok' : r.status === 'possible' ? 'warn' : 'bad';
  const icon = r.status === 'authentic' ? '🟢' : r.status === 'possible' ? '🟡' : '🔴';

  let body = '';
  if(r.status === 'authentic'){
    body = `
      <div class="hashline">
        Original Publisher &nbsp;${escapeHtml(r.matched.publisherName)}<br>
        Registration Date &nbsp;${r.matched.time}<br>
        SHA-256 Hash &nbsp;${r.hash}<br>
        Blockchain Verification Status &nbsp;✓ Registered (${r.matched.mode})<br>
        Verification Timestamp &nbsp;${nowStamp()}
      </div>`;
  } else if(r.status === 'possible'){
    body = `
      <div class="hashline">
        Submitted Image Hash &nbsp;${r.hash}<br>
        Closest Registered Hash &nbsp;${r.matched.hash}<br>
        Registered To &nbsp;${escapeHtml(r.matched.publisherName)}<br>
        Perceptual Similarity &nbsp;${r.similarity}%<br>
        Verification Timestamp &nbsp;${nowStamp()}
      </div>
      <div class="hint">The images appear visually similar, but the submitted file is not identical to the registered file — consistent with resizing, re-compression, or a minor edit.</div>`;
  } else {
    body = `
      <div class="hashline">
        Submitted Image Hash &nbsp;${r.hash}<br>
        Registered Hash (if available) &nbsp;${r.matched ? r.matched.hash : '— none found —'}<br>
        Perceptual Similarity to closest record &nbsp;${r.similarity}%<br>
        Verification Timestamp &nbsp;${nowStamp()}
      </div>
      <div class="hint">The submitted image does not match the registered version. Image authenticity could not be verified. This does not automatically mean the image is fake — it may simply not be in the registry yet.</div>`;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <img src="${url}" class="thumb" alt="Uploaded photo preview">
    <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--slate); text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px;">Image Verification Result</div>
    <div class="badge ${badgeLevel}"><span class="sq"></span>${icon} ${r.badgeLabel}</div>
    ${body}
    <div class="hint" style="margin-top:10px;">Category: <strong>${r.category}</strong> · Cryptographic hash detects exact file changes; perceptual similarity detects visually similar images despite resizing/compression. These are shown separately and never combined into one score.</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px;">
      <button class="btn-sm" id="btnViewRecord">View Blockchain Record</button>
      <button class="btn-sm" id="btnCompareImages" style="background:transparent; border:1px solid var(--line); color:var(--paper);">Compare Images</button>
    </div>`;

  const viewBtn = document.getElementById('btnViewRecord');
  if(viewBtn) viewBtn.addEventListener('click', ()=>{
    document.getElementById('imageChecksBody').scrollIntoView({behavior:'smooth', block:'center'});
  });
  const cmpBtn = document.getElementById('btnCompareImages');
  if(cmpBtn) cmpBtn.addEventListener('click', ()=>{
    switchPhotoTab('compare');
    fileA = r.file;
    document.getElementById('dropA').querySelector('p').textContent = r.file.name + ' selected';
    renderCompare();
  });
}

wireDropzone('dropVerify','fileVerify', async (file)=>{
  const box = document.getElementById('verifyResult');
  box.style.display = 'block';
  box.innerHTML = '<div class="hashline">Hashing and checking against the registry…</div>';
  const r = await runImageVerification(file);
  renderVerifyResult(box, r);
});

// ---------- DEMO MODE: 3 deterministic demo cases ----------
// Canvas-generated so results are reproducible every run, without shipping
// binary demo assets. All demo records/images are tagged DEMO DATA.
let demoImagesReady = null;
function canvasToFile(canvas, name, type, quality){
  return new Promise(resolve=>{
    canvas.toBlob(blob=>resolve(new File([blob], name, {type})), type, quality);
  });
}
async function buildDemoOriginalCanvas(){
  const c = document.createElement('canvas'); c.width = 480; c.height = 320;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0,0,480,320);
  g.addColorStop(0,'#0B1220'); g.addColorStop(1,'#33A373');
  ctx.fillStyle = g; ctx.fillRect(0,0,480,320);
  ctx.fillStyle = '#F6F3EC';
  ctx.beginPath(); ctx.arc(240,150,70,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#0B1220'; ctx.font = 'bold 20px sans-serif';
  ctx.fillText('TRUTHCHAIN DEMO ORIGINAL', 60, 280);
  return c;
}
async function buildDemoDifferentCanvas(){
  const c = document.createElement('canvas'); c.width = 480; c.height = 320;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#D14B4B'; ctx.fillRect(0,0,480,320);
  ctx.fillStyle = '#F6F3EC';
  for(let i=0;i<6;i++){ ctx.fillRect(30+i*70, 60, 40, 200); }
  ctx.fillStyle = '#0B1220'; ctx.font = 'bold 20px sans-serif';
  ctx.fillText('UNRELATED DEMO IMAGE', 90, 300);
  return c;
}
async function seedDemoImages(){
  const originalCanvas = await buildDemoOriginalCanvas();
  const differentCanvas = await buildDemoDifferentCanvas();

  const originalFile = await canvasToFile(originalCanvas, 'demo-original.png', 'image/png');
  // simulate a resize + re-compress of the SAME image (changes bytes, keeps look)
  const smallCanvas = document.createElement('canvas'); smallCanvas.width = 160; smallCanvas.height = 107;
  smallCanvas.getContext('2d').drawImage(originalCanvas, 0, 0, 160, 107);
  const resavedCanvas = document.createElement('canvas'); resavedCanvas.width = 480; resavedCanvas.height = 320;
  resavedCanvas.getContext('2d').drawImage(smallCanvas, 0, 0, 480, 320);
  const resavedFile = await canvasToFile(resavedCanvas, 'demo-resaved.jpg', 'image/jpeg', 0.5);
  const differentFile = await canvasToFile(differentCanvas, 'demo-different.png', 'image/png');

  demoImagesReady = { original: originalFile, resaved: resavedFile, different: differentFile };

  const already = await getJSON('imgSeeded:v1', true, false);
  if(!already){
    const hash = await sha256HexFromFile(originalFile);
    const phash = await perceptualHash(originalFile);
    await registerImageOnChain({
      title: 'Demo Original Photo', description: 'Seed image used by the Photo section demo cases.',
      pubDate: nowStamp().slice(0,10), sourceUrl: '(demo)', hash, phash,
      publisherUsername: 'isro', publisherName: 'ISRO (Demo)', demo: true
    });
    await setJSON('imgSeeded:v1', true, true);
  }
  await renderImageDashboard();
}

document.querySelectorAll('[data-img-demo]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    if(!demoImagesReady) await seedDemoImages();
    const file = demoImagesReady[btn.dataset.imgDemo === 'original' ? 'original' : btn.dataset.imgDemo === 'resaved' ? 'resaved' : 'different'];
    const box = document.getElementById('verifyResult');
    box.style.display = 'block';
    box.innerHTML = '<div class="hashline">Hashing and checking against the registry…</div>';
    const r = await runImageVerification(file);
    renderVerifyResult(box, r);
  });
});

// ---------- REGISTER IMAGE (publisher-gated) ----------
let registerImgFile = null;
wireDropzone('dropRegisterImg','fileRegisterImg', (file)=>{
  registerImgFile = file;
  const box = document.getElementById('registerImgPreview');
  box.style.display = 'block';
  const url = URL.createObjectURL(file);
  box.innerHTML = `<img src="${url}" class="thumb" alt="Preview"><div class="hashline">${escapeHtml(file.name)} &nbsp;·&nbsp; ${(file.size/1024).toFixed(1)} KB</div>`;
});
document.getElementById('imgRegisterBtn').addEventListener('click', async ()=>{
  const box = document.getElementById('imgRegisterResult');
  if(!currentSession || currentSession.role !== 'publisher'){
    box.style.display='block';
    box.innerHTML = '<div class="badge bad"><span class="sq"></span>Not authorized</div><div class="hashline">Only verified publishers can register images.</div>';
    return;
  }
  if(!registerImgFile){
    box.style.display='block';
    box.innerHTML = '<div class="badge warn"><span class="sq"></span>No image selected</div><div class="hashline">Choose an image above before registering.</div>';
    return;
  }
  const title = document.getElementById('imgTitle').value.trim() || 'Untitled image';
  const description = document.getElementById('imgDesc').value.trim();
  const pubDate = document.getElementById('imgPubDate').value.trim() || nowStamp().slice(0,10);
  const sourceUrl = document.getElementById('imgSourceUrl').value.trim() || '(none provided)';

  const publisherApp = await getJSON('publishers:' + currentSession.username, true, null);
  const publisherName = publisherApp ? publisherApp.orgName : currentSession.username;

  const hash = await sha256HexFromFile(registerImgFile);
  const phash = await perceptualHash(registerImgFile);
  const record = await registerImageOnChain({
    title, description, pubDate, sourceUrl, hash, phash,
    publisherUsername: currentSession.username, publisherName
  });

  box.style.display = 'block';
  box.innerHTML = `
    <div class="badge ok"><span class="sq"></span>✓ Blockchain Registered <span style="opacity:.7;">(Demo Blockchain Mode)</span></div>
    <div class="hashline">
      Image ID &nbsp;${record.id}<br>
      SHA-256 Hash &nbsp;${hash}<br>
      Perceptual Fingerprint &nbsp;${phash}<br>
      Publisher &nbsp;${escapeHtml(publisherName)}<br>
      Timestamp &nbsp;${record.time}<br>
      Blockchain Status &nbsp;registered<br>
      Transaction ID &nbsp;${record.txId}
    </div>`;
  await renderMyImages();
  await renderImageDashboard();
});
async function renderMyImages(){
  if(!currentSession) return;
  const body = document.getElementById('myImagesBody');
  if(!body) return;
  const all = await getAllImages();
  const mine = all.filter(r => r.publisher === currentSession.username);
  document.getElementById('myImagesEmpty').style.display = mine.length ? 'none' : 'block';
  body.innerHTML = mine.map(r=>`
    <tr>
      <td class="hash-short">${r.id}</td>
      <td>${escapeHtml(r.title)}</td>
      <td class="hash-short">${shortHash(r.hash)}</td>
      <td>${r.time}</td>
      <td><span class="badge ok"><span class="sq"></span>registered</span></td>
    </tr>`).join('');
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
  const [a, b, hashA, hashB, phashA, phashB] = await Promise.all([
    analyzeImage(fileA), analyzeImage(fileB),
    sha256HexFromFile(fileA), sha256HexFromFile(fileB),
    perceptualHash(fileA), perceptualHash(fileB)
  ]);
  const va = verdictFor(a.score), vb = verdictFor(b.score);

  const identical = hashA === hashB;
  const dist = hammingDistanceHex(phashA, phashB);
  const similarity = identical ? 100 : similarityFromHamming(dist);
  let matchBadge, matchLevel, matchLabel, matchExplain;
  if(identical){
    matchBadge = '🟢 Exact Match'; matchLevel = 'ok';
    matchLabel = 'Possible Match Found';
    matchExplain = 'These files are byte-for-byte identical (same SHA-256 hash).';
  } else if(dist <= POSSIBLE_MATCH_MAX_DIST){
    matchBadge = '🟡 Possible Match Found'; matchLevel = 'warn';
    matchLabel = 'Possible Match Found';
    matchExplain = 'The images appear visually similar, but the submitted file is not identical to the registered file.';
  } else {
    matchBadge = '🔴 No Significant Match Found'; matchLevel = 'bad';
    matchLabel = 'No Significant Match Found';
    matchExplain = 'No sufficiently similar image was found between the two files.';
  }

  box.innerHTML = `
    <div class="row2">
      <div>
        <div class="badge ${va.level}"><span class="sq"></span>Photo A — AI signal score ${a.score}/100</div>
        <div class="hashline">${va.label}</div>
      </div>
      <div>
        <div class="badge ${vb.level}"><span class="sq"></span>Photo B — AI signal score ${b.score}/100</div>
        <div class="hashline">${vb.label}</div>
      </div>
    </div>
    <div class="hint" style="margin-bottom:14px;">${a.score===b.score ? 'Both images show a similar level of AI-likelihood signals.' : (a.score>b.score ? 'Photo A shows more AI-likelihood signals than Photo B.' : 'Photo B shows more AI-likelihood signals than Photo A.')}</div>
    <div style="border-top:1px solid var(--line); padding-top:14px;">
      <div class="badge ${matchLevel}"><span class="sq"></span>${matchBadge}</div>
      <div class="hashline">Similarity Score &nbsp;${similarity}%</div>
      <div class="hint">${matchExplain}</div>
    </div>`;
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

// ---------- BLOCKCHAIN RECORDS (registry explorer) ----------
document.getElementById('explSearch').addEventListener('input', renderExplorer);

async function renderExplorer(){
  const q = document.getElementById('explSearch').value.trim().toLowerCase();
  const body = document.getElementById('explBody');
  const all = await getAllArticles();
  const rows = all.filter(e=>{
    if(!q) return true;
    return e.title.toLowerCase().includes(q) || (e.publisherName||'').toLowerCase().includes(q) || e.hash.includes(q);
  });
  body.innerHTML = rows.map(e=>`
    <tr data-id="${e.id}">
      <td class="hash-short">${e.id}</td>
      <td>${escapeHtml(e.publisherName || e.publisher)}</td>
      <td class="hash-short">${shortHash(e.hash)}</td>
      <td>${e.time}</td>
      <td><span class="badge ok"><span class="sq"></span>${e.status}</span></td>
    </tr>`).join('') || `<tr><td colspan="5" style="color:var(--slate); text-align:center; padding:30px;">No records match your search.</td></tr>`;

  body.querySelectorAll('tr[data-id]').forEach(tr=>{
    tr.addEventListener('click', async ()=>{
      const e = rows.find(r=>r.id===tr.dataset.id);
      const det = document.getElementById('explDetail');
      det.style.display='block';
      det.innerHTML = `
        <div class="badge ok"><span class="sq"></span>Blockchain record — ${e.mode}</div>
        <div class="hashline">
          Article ID &nbsp;&nbsp;${e.id}<br>
          Title &nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(e.title)}<br>
          Category &nbsp;${escapeHtml(e.category||'—')}<br>
          Publisher &nbsp;${escapeHtml(e.publisherName || e.publisher)}<br>
          SHA-256 &nbsp;&nbsp;${e.hash}<br>
          Timestamp &nbsp;${e.time}<br>
          Status &nbsp;&nbsp;&nbsp;&nbsp;registered<br>
          Transaction ID &nbsp;${e.txId}
        </div>`;
    });
  });
}

// ---------- app init ----------
(async function init(){
  await seedDemoData();
  await refreshSessionUI();
  await renderExplorer();
  await seedDemoImages();
})();
