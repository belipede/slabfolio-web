const SETS = __SETS__;
const SEEN = __SEEN__;
let NEWS = __NEWS__;   // snapshot from build time; refreshData() swaps in the latest data/news.json
let FINDS = { finds: [], penalties: {} };   // shared finds from GitHub issues, loaded from data/finds.json
const SAMPLE_CARDS = __SAMPLE_CARDS__;
const APP_VERSION = '0.5 (18 Nov 2026)';
const REPO = 'belipede/slabfolio-web';

// ---------- storage ----------
const KEY = 'slabfolio-web-v1';
function load(){ try{ return JSON.parse(localStorage.getItem(KEY)) || null }catch(e){ return null } }
function save(quiet){
  if (!quiet) S.changedAt = Date.now();
  try{ localStorage.setItem(KEY, JSON.stringify(S)); return true }
  catch(e){ toast('This phone\'s app storage is full. Remove some photos, or export a backup and start over.'); return false }
}
let S = load() || { user:'ben', reports:[], mod:true, monthsEarned:{}, sampleLoaded:false };
if (!S.cards){ S.cards = SAMPLE_CARDS.map(c => ({ ...c })); S.sampleCards = true; }
S.comps = S.comps || {}; S.invAdded = S.invAdded || {}; S.photos = S.photos || {};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setById = id => SETS.find(s => s.id === id);
const grpOf = (s, name) => s.groups.find(g => g.n === name) || s.groups[0];
const cardOf = (g, code) => g.cards.find(c => c[0] === code);
const slotKey = (set, grp, card, par, serial) => `${set}|${grp}|${card}|${par}|${serial}`;
const fmtDate = t => new Date(t).toLocaleDateString('en-SG', {day:'numeric', month:'short'});
const runTxt = r => r === 1 ? '1/1' : '/' + r;
const cardNo = (g, code) => g.n === 'Base' ? '#' + code : code;
const short = n => n.replace('2025-26 Topps ', '');
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 2400); }
function pointsFor(run){ return run === 1 ? 100 : run <= 5 ? 40 : run <= 10 ? 20 : 10; }
const POINTS_PER_MONTH = 300;
const RANK = { seen: 1, pending: 2, verified: 3 };
const ser = r => r.serial || (r.run === 1 ? 1 : 0);
const cls = r => r ? ({ verified: 'v', pending: 'p', seen: 's' })[r.status] : '';

// online sightings found by searching eBay (not community reports)
const seenReports = () => SEEN.map((x, i) => { const s = setById(x[0]), g = grpOf(s, x[1]), p = g.pars.find(q => q.n === x[3]);
  return { id: 'seen' + i, seen: true, set: x[0], grp: x[1], card: x[2], par: x[3], run: p.r, serial: x[4], ev: 'listing', link: x[5], note: x[6], user: 'ebay', status: 'seen', t: Date.parse('2026-10-31T02:30:00Z') - i * 6e4 }; });
// finds shared on the public registry (GitHub issues, verified by a moderator label)
let sharedCache = null;
const sharedReports = () => sharedCache || (sharedCache = FINDS.finds.filter(f => setById(f.set)).map(f => ({ ...f, shared: true, t: Date.parse(f.t) || 0 })));
const sharedKey = r => slotKey(r.set, r.grp, r.card, r.par, r.serial) + '|' + (r.code || '');
// a local report that has since shown up on the public registry is shown once, as the shared copy
const localReports = () => { const sh = new Set(sharedReports().map(sharedKey)); return S.reports.filter(r => !(r.sharedAt && sh.has(sharedKey(r)))); };
const allReports = () => seenReports().concat(sharedReports(), localReports());

// best status per slot: verified > pending > seen online; rejected ignored; serial 0 = copy number unknown
function slotIndex(){
  const m = new Map();
  for (const r of allReports()){
    if (r.status === 'rejected' || !ser(r)) continue;
    const k = slotKey(r.set, r.grp, r.card, r.par, ser(r)), cur = m.get(k);
    if (!cur || RANK[r.status] > RANK[cur.status]) m.set(k, r);
  }
  return m;
}
function unknownCounts(){ const m = new Map(); for (const r of allReports()) if (!ser(r) && r.status !== 'rejected'){ const k = slotKey(r.set, r.grp, r.card, r.par, 0); m.set(k, (m.get(k) || 0) + 1); } return m; }
const unknownFor = (set, grp, card, par) => allReports().filter(r => !ser(r) && r.status !== 'rejected' && r.set === set && r.grp === grp && r.card === card && r.par === par);
function userPoints(u){
  const gh = (S.gh || '').toLowerCase(), shared = gh ? sharedReports().filter(r => r.user.toLowerCase() === gh) : [];
  return localReports().filter(r => r.user === u && r.status === 'verified' && r.firstVerified).reduce((a, r) => a + r.points, 0)
       - localReports().filter(r => r.user === u && r.status === 'rejected' && r.fake).length * 50
       + shared.filter(r => r.status === 'verified' && r.firstVerified).reduce((a, r) => a + r.points, 0)
       - (gh ? Object.entries(FINDS.penalties || {}).filter(([k]) => k.toLowerCase() === gh).reduce((a, [, n]) => a + n, 0) * 50 : 0);
}
const myShared = () => { const gh = (S.gh || '').toLowerCase(); return gh ? sharedReports().filter(r => r.user.toLowerCase() === gh) : []; };

// ---------- state / routing ----------
let view = { tab: 'home', cq: '', cseg: 'owned', cf: '', csort: 'value', cmore: 60, set: null, grp: 0, par: 0, q: '', filter: 'all', news: 'football', np: '' };
const ROUTES = ['home','cards','display','comps','hunt','news','feed','review','me','scan','grade'];
const NAV_OF = { feed: 'hunt', review: 'hunt', scan: 'hunt', grade: 'me', comps: 'cards' };
function go(tab){ closeSheet(); view.tab = tab; if (tab !== 'hunt') view.set = null; location.hash = tab; render(); window.scrollTo(0,0); }
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== view.tab && ROUTES.includes(h)){ view.tab = h; view.set = null; render(); } });
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => b.dataset.tab === 'add' ? openAdd() : go(b.dataset.tab));

function render(){
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ({ hunt: 'home', feed: 'home', review: 'home', scan: 'home', news: 'home', comps: 'home', grade: 'me' }[view.tab] || view.tab)));
  const a = $('#app');
  if (view.tab === 'home') a.innerHTML = renderDash();
  else if (view.tab === 'cards') a.innerHTML = renderCards();
  else if (view.tab === 'display') a.innerHTML = renderDisplay();
  else if (view.tab === 'comps') a.innerHTML = renderComps();
  else if (view.tab === 'grade') a.innerHTML = renderGrade();
  else if (view.tab === 'hunt') a.innerHTML = view.set ? renderSet() : renderHunt();
  else if (view.tab === 'feed') a.innerHTML = renderFeed();
  else if (view.tab === 'news') a.innerHTML = renderNews();
  else if (view.tab === 'scan') a.innerHTML = renderScan();
  else if (view.tab === 'review') a.innerHTML = renderReview();
  else a.innerHTML = renderMe();
  bind(); bindChart(); if (view.tab === 'home') countUp();
  if (!S.mode && !askMode.done){ askMode.done = true; askMode(); }
}
const defaultPar = g => Math.max(0, g.pars.findIndex(p => p.r === 1 && !/Plate|Club|Rose|Gloves|Manufacturer/.test(p.n)));

// ---------- hunt: home ----------
// found = seen + reported + verified copies; ones = 1/1 parallels only
function tally(s, groups, onlyPar, idx){
  const um = unknownCounts();
  const t = { slots: 0, v: 0, p: 0, s: 0, ones: 0, onesF: 0, cards: 0 };
  for (const g of groups){ t.cards += g.cards.length;
    for (const par of g.pars){ if (onlyPar && par.n !== onlyPar) continue;
      for (const c of g.cards){
        t.slots += par.r; let got = 0;
        for (let n = 1; n <= par.r; n++){ const r = idx.get(slotKey(s.id, g.n, c[0], par.n, n)); if (r){ got++; r.status === 'verified' ? t.v++ : r.status === 'pending' ? t.p++ : t.s++; } }
        const unk = Math.min(par.r - got, (um.get(slotKey(s.id, g.n, c[0], par.n, 0)) || 0)); t.s += unk;
        if (par.r === 1){ t.ones++; if (got) t.onesF++; }
      }
    }
  }
  t.found = t.v + t.p + t.s;
  return t;
}
const pct = (n, d) => d ? n / d * 100 : 0;
const pctTxt = (n, d) => { const x = pct(n, d); return x === 0 ? '0%' : x < .1 ? '<0.1%' : x < 10 ? x.toFixed(1) + '%' : Math.round(x) + '%'; };
// stacked bar: verified, reported, seen; tiny non-zero values get a visible sliver
function sbar(t, total){
  const w = n => n ? Math.max(.8, pct(n, total)).toFixed(2) : 0;
  return `<div class="sbar"><i style="width:${w(t.v)}%;background:var(--ok)"></i><i style="width:${w(t.p)}%;background:var(--pend)"></i><i style="width:${w(t.s)}%;background:var(--seen)"></i></div>`;
}
// early on the share found is tiny, so lead with the count; the percentage and bar only show once they mean something (1% or more)
function progHtml(t, label, noOnes){
  const line = (n, of) => pct(n, of) >= 1 ? `<b>${n.toLocaleString()} of ${of.toLocaleString()} · ${pctTxt(n, of)}</b>` : `<b>${n.toLocaleString()} <span class="sub" style="font-weight:400">of ${of.toLocaleString()} tracked</span></b>`;
  return `<div class="prog"><div class="pl"><span>${label}</span>${line(t.found, t.slots)}</div>${pct(t.found, t.slots) >= 1 ? sbar(t, t.slots) : ''}
  ${t.ones && !noOnes ? `<div class="pl" style="margin-top:8px"><span>1/1s found</span>${line(t.onesF, t.ones)}</div>${pct(t.onesF, t.ones) >= 1 ? `<div class="sbar"><i style="width:${pct(t.onesF, t.ones).toFixed(2)}%;background:var(--accent)"></i></div>` : ''}` : ''}</div>`;
}
function renderHunt(){
  const idx = slotIndex();
  let h = finderTop() + `<div class="banner">Checklists are real. <b>Blue</b> = seen for sale on eBay (linked, not yet checked by a moderator). Load sample reports from <b>Me</b> to see the other colours.</div>`;
  const all = { slots: 0, v: 0, p: 0, s: 0, found: 0, ones: 0, onesF: 0 }, per = SETS.map(s => tally(s, s.groups, null, idx));
  per.forEach(t => { for (const k in all) all[k] += t[k]; });
  h += `<div class="prof" style="padding:14px"><b>All 6 sets</b>${progHtml(all, 'Copies found')}
  <div class="stats"><span><b>${all.v}</b> verified</span><span><b>${all.p}</b> reported</span><span><b>${all.s}</b> seen on eBay</span></div>
  <button class="btn ghost" data-act="scan" style="margin-top:12px">Scan my collection</button></div>`;
  SETS.forEach((s, si) => {
    const st = per[si];
    h += `<div class="setcard" data-set="${s.id}">
      <h3>${esc(short(s.name))}</h3>
      <div class="sub">${esc(s.comp)} · ${st.cards.toLocaleString()} cards in ${s.groups.length} base, insert and autograph sets · ${st.slots.toLocaleString()} numbered copies /25 or lower</div>
      ${progHtml(st, 'Copies found')}
      <div class="stats"><span><b>${st.v}</b> verified</span><span><b>${st.p}</b> reported</span><span><b>${st.s}</b> seen on eBay</span></div>
    </div>`;
  });
  return h + `<p class="sub">Only parallels numbered /25 or lower are tracked. Not included yet: Chrome base autographs, and Merlin's Magical Ink, Spellbinding Trios and Match Ball autographs (no public checklist I could reach).</p>`;
}

// ---------- hunt: set ----------
function renderSet(){
  const s = setById(view.set), g = s.groups[view.grp], par = g.pars[view.par], idx = slotIndex(), q = view.q.toLowerCase();
  let h = `<header class="top"><button class="back" data-act="home">‹ Sets</button></header>
  <h1 style="margin:0 0 2px;font-size:22px">${esc(short(s.name))}</h1>
  <div class="sub" style="margin-bottom:12px">${esc(s.comp)} · <a class="src" href="${s.src}" target="_blank" rel="noopener">checklist source</a></div>
  <select class="grp" id="grp">${s.groups.map((x, i) => `<option value="${i}" ${i === view.grp ? 'selected' : ''}>${esc(x.n)} · ${x.cards.length} cards</option>`).join('')}</select>
  <div class="pills">${g.pars.map((p, i) => `<button class="pill ${i === view.par ? 'on' : ''}" data-par="${i}">${esc(p.n)} ${runTxt(p.r)}</button>`).join('')}</div>
  <div class="row"><input class="search" id="q" placeholder="Search player or team" value="${esc(view.q)}">
  <div class="seg">${['all','open','found'].map(f => `<button data-filter="${f}" class="${view.filter === f ? 'on' : ''}">${f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Found'}</button>`).join('')}</div></div>
  <div class="prof" style="padding:12px">${progHtml(tally(s, [g], par.n, idx), `${esc(par.n)} ${runTxt(par.r)} found`, true)}${(() => { const t = tally(s, [g], null, idx); return `<div class="pl" style="margin-top:8px"><span>All parallels in ${esc(g.n)}</span><b>${t.found} of ${t.slots.toLocaleString()} · ${pctTxt(t.found, t.slots)}</b></div>${sbar(t, t.slots)}`; })()}</div>
  <div class="legend"><span style="--c:var(--empty)">Not reported</span><span style="--c:var(--seen)">Seen on eBay</span><span style="--c:var(--pend)">Reported</span><span style="--c:var(--ok)">Verified</span></div>
  <div class="grid">`;
  let shown = 0;
  for (const c of g.cards){
    if (q && !(c[1].toLowerCase().includes(q) || c[2].toLowerCase().includes(q) || c[0].toLowerCase() === q)) continue;
    let dots = '', best = '', cnt = 0;
    for (let n = 1; n <= par.r; n++){
      const k = cls(idx.get(slotKey(s.id, g.n, c[0], par.n, n)));
      if (k){ cnt++; if (!best || 'spv'.indexOf(k) > 'spv'.indexOf(best)) best = k; }
      dots += `<i class="dot ${k}"></i>`;
    }
    const unk = unknownFor(s.id, g.n, c[0], par.n).length;
    if (view.filter === 'open' && cnt === par.r) continue;
    if (view.filter === 'found' && !cnt && !unk) continue;
    if (!best && unk) best = 's';
    shown++;
    h += `<div class="tile ${best === 'v' ? 'hasv' : best === 'p' ? 'hasp' : best === 's' ? 'hass' : ''}" data-card="${esc(c[0])}">
      <div class="no">${esc(cardNo(g, c[0]))} · ${cnt}/${par.r} found</div><div class="pl">${esc(c[1])}</div><div class="tm">${esc(c[2])}</div>
      ${unk ? `<div class="unk">+${unk} seen, copy number unknown</div>` : ''}
      <div class="dots">${dots}</div></div>`;
  }
  h += `</div>`;
  if (!shown) h += `<div class="empty">No cards match.</div>`;
  return h;
}

// ---------- card sheet ----------
function openSheet(html){ const sh = $('#sheet'); sh.innerHTML = `<div class="grab"></div>` + html; $('#sheetbg').style.display = 'block'; requestAnimationFrame(() => sh.classList.add('open')); bindSheet(); }
function closeSheet(){ $('#sheet').classList.remove('open'); $('#sheetbg').style.display = 'none'; }
$('#sheetbg').onclick = closeSheet;

function openCard(setId, grpIdx, code, parIdx){
  const s = setById(setId), g = s.groups[grpIdx], c = cardOf(g, code), par = g.pars[parIdx], idx = slotIndex();
  let h = `<h2>${esc(c[1])}</h2><div class="sub">${esc(cardNo(g, c[0]))}${c[2] ? ' · ' + esc(c[2]) : ''}<br>${esc(short(s.name))} · ${esc(g.n)} · ${esc(par.n)} ${runTxt(par.r)}</div>`;
  if (par.r === 1){
    const r = idx.get(slotKey(s.id, g.n, c[0], par.n, 1));
    h += `<div class="one ${cls(r)}" data-slot="1">${r ? statusLine(r) : '<b>Not reported yet</b><span class="sub">Tap to report this 1/1</span>'}</div>`;
  } else {
    h += `<div class="slots">`;
    for (let n = 1; n <= par.r; n++){
      const r = idx.get(slotKey(s.id, g.n, c[0], par.n, n));
      h += `<div class="slot ${cls(r)}" data-slot="${n}">${n}<small>/${par.r}</small></div>`;
    }
    h += `</div><div class="hint">Tap a number to see who found it, or to report it.</div>`;
  }
  const hist = allReports().filter(r => r.set === s.id && r.grp === g.n && r.card === c[0] && r.par === par.n).sort((a, b) => b.t - a.t);
  if (hist.length) h += `<label class="f">Sightings and reports</label>` + hist.map(itemHtml).join('');
  openSheet(h);
  $('#sheet').querySelectorAll('[data-slot]').forEach(el => el.onclick = () => {
    const n = +el.dataset.slot, r = idx.get(slotKey(s.id, g.n, c[0], par.n, n));
    if (r) openDetail(r.id); else openReport({ set: s.id, grp: g.n, card: c[0], par: par.n, serial: n });
  });
}
function statusLine(r){
  const t = r.status === 'verified' ? 'Verified' : r.status === 'pending' ? (r.shared ? 'Shared, waiting for a moderator' : 'Reported, waiting for review') : 'Seen for sale on eBay';
  return `<b>${t}</b><span class="sub">${r.seen ? esc(r.note) : 'by ' + esc(shownUser(r)) + ' · ' + fmtDate(r.t)}</span>`;
}
function shownUser(r){ return r.seen ? 'eBay listing' : r.anon ? 'anonymous collector' : '@' + r.user; }

// ---------- report form ----------
function newCode(){ const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length: 5}, () => a[Math.floor(Math.random() * a.length)]).join(''); }
function openReport(pre){
  const setId = pre.set || (view.set || SETS[0].id), code = newCode();
  const h = `<h2>Report a pull</h2><div class="sub">First verified report of each numbered copy earns points.</div>
  <form id="rf">
  <label class="f">Set</label><select class="inp" name="set">${SETS.map(x => `<option value="${x.id}" ${x.id === setId ? 'selected' : ''}>${esc(short(x.name))}</option>`).join('')}</select>
  <label class="f">Base, insert or autograph</label><select class="inp" name="grp"></select>
  <label class="f">Card</label><select class="inp" name="card"></select>
  <label class="f">Parallel</label><select class="inp" name="par"></select>
  <label class="f">Serial number</label><select class="inp" name="serial"></select>
  <label class="f">Proof</label><select class="inp" name="ev">
    <option value="graded">Graded slab with cert number</option><option value="listing">eBay or Carousell listing link</option>
    <option value="photo">Photos with today's code</option><option value="video">Break video or stream clip</option></select>
  <div id="evbox"></div>
  <label class="f">Note (optional)</label><textarea class="inp" name="note" placeholder="Where you pulled it, which break, etc."></textarea>
  <div class="switch"><span>Hide my username on the registry</span><button type="button" class="tog" id="anon"></button></div>
  <button class="btn" type="submit">Submit report</button>
  </form>`;
  openSheet(h);
  const f = $('#rf');
  const curS = () => setById(f.set.value), curG = () => curS().groups[+f.grp.value], curP = () => curG().pars.find(x => x.n === f.par.value) || curG().pars[0];
  const fillSerial = () => { const p = curP();
    f.serial.innerHTML = Array.from({length: p.r}, (_, i) => `<option value="${i + 1}" ${i + 1 === pre.serial ? 'selected' : ''}>${i + 1}/${p.r}</option>`).join(''); };
  const fillGrp = () => { const g = curG();
    f.card.innerHTML = g.cards.map(c => `<option value="${esc(c[0])}" ${c[0] === pre.card ? 'selected' : ''}>${esc(cardNo(g, c[0]))} ${esc(c[1])}</option>`).join('');
    f.par.innerHTML = g.pars.map(p => `<option value="${esc(p.n)}" ${p.n === pre.par ? 'selected' : ''}>${esc(p.n)} ${runTxt(p.r)}</option>`).join(''); fillSerial(); };
  const fillSet = () => { const s = curS();
    f.grp.innerHTML = s.groups.map((g, i) => `<option value="${i}" ${g.n === (pre.grp || (view.set === s.id ? s.groups[view.grp].n : 'Base')) ? 'selected' : ''}>${esc(g.n)}</option>`).join(''); fillGrp(); };
  const fillEv = () => {
    const ev = f.ev.value, box = $('#evbox');
    if (ev === 'graded') box.innerHTML = `<label class="f">Cert number</label><input class="inp" name="cert" inputmode="numeric" placeholder="e.g. 12345678"><div class="hint">Checked against the grader's cert lookup. Never shown publicly.</div>`;
    else if (ev === 'listing' || ev === 'video') box.innerHTML = `<label class="f">${ev === 'listing' ? 'Listing link' : 'Video link with timestamp'}</label><input class="inp" name="link" type="url" placeholder="https://">`;
    else box.innerHTML = `<label class="f">Write this code on paper next to the card</label><div class="code">${code}</div><div class="hint">Photograph front and back with the serial number readable and this note in the shot.</div>
      <label class="f">Photo</label><input class="inp" name="photo" type="file" accept="image/*"><img id="prev" class="thumb" style="display:none">`;
    const ph = f.photo; if (ph) ph.onchange = () => shrink(ph.files[0]).then(d => { f.dataset.photo = d; const p = $('#prev'); p.src = d; p.style.display = 'block'; });
  };
  f.set.onchange = () => { pre = {}; fillSet(); }; f.grp.onchange = () => { pre = {}; fillGrp(); }; f.par.onchange = fillSerial; f.ev.onchange = fillEv;
  fillSet(); fillEv();
  const anon = $('#anon'); anon.onclick = () => anon.classList.toggle('on');
  f.onsubmit = e => {
    e.preventDefault();
    const s = curS(), g = curG(), p = curP();
    const r = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), set: s.id, grp: g.n, card: f.card.value, par: p.n, run: p.r, serial: +f.serial.value,
      ev: f.ev.value, cert: f.cert ? f.cert.value.trim() : '', link: f.link ? f.link.value.trim() : '', photo: f.dataset.photo || '', code,
      note: f.note.value.trim(), anon: anon.classList.contains('on'), user: S.user, t: Date.now(), status: 'pending' };
    if (r.ev === 'graded' && !/^\d{8,10}$/.test(r.cert)) return toast('Enter the 8 to 10 digit cert number');
    if ((r.ev === 'listing' || r.ev === 'video') && !/^https?:\/\//.test(r.link)) return toast('Paste the full link');
    if (r.ev === 'photo' && !r.photo) return toast('Add a photo first');
    const dup = slotIndex().get(slotKey(r.set, r.grp, r.card, r.par, r.serial));
    if (dup && !dup.seen) r.dupOf = dup.id;
    if (r.ev === 'graded'){ r.autoNote = 'Cert check simulated in this test build'; verify(r, true); }
    S.reports.push(r); save(); closeSheet(); render(); openDetail(r.id);
    toast(r.status === 'verified' ? 'Verified by cert check (simulated)' : r.dupOf ? 'Reported. Someone already reported this copy, so a moderator will compare both.' : 'Reported. It shows as pending until reviewed.');
  };
}
function shrink(file, max = 800, q = .7){
  return new Promise(res => { if (!file) return res(''); const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; img.src = fr.result; }; fr.readAsDataURL(file); });
}

// ---------- verification + points ----------
function verify(r, auto){
  const k = slotKey(r.set, r.grp, r.card, r.par, r.serial);
  const already = S.reports.some(x => x !== r && x.status === 'verified' && x.firstVerified && slotKey(x.set, x.grp, x.card, x.par, x.serial) === k);
  r.status = 'verified'; r.vt = Date.now(); r.auto = !!auto;
  r.firstVerified = !already; r.points = already ? 0 : pointsFor(r.run);
}
function reject(r, fake){ r.status = 'rejected'; r.fake = !!fake; r.vt = Date.now(); }

// ---------- detail ----------
function openDetail(id){
  const r = allReports().find(x => x.id === id); if (!r) return;
  const s = setById(r.set), g = grpOf(s, r.grp), c = cardOf(g, r.card);
  const evName = r.seen ? 'Found by searching eBay' : r.shared && r.ev === 'graded' ? 'Graded slab (photos on GitHub)' : { graded: 'Graded slab (cert on file, hidden)', listing: 'Listing link', photo: 'Photos with code ' + r.code, video: 'Break video', inventory: 'From my collection (needs photos or a slab before it can be verified)' }[r.ev];
  let h = `<h2>${esc(c[1])} ${r.run === 1 ? '1/1' : (r.serial || '?') + '/' + r.run}</h2>
  <div class="sub">${esc(short(s.name))} · ${esc(g.n)} · ${esc(r.par)} · ${esc(cardNo(g, c[0]))}</div>
  ${r.sample ? '<div style="margin-top:12px"><span class="badge b-s">SAMPLE</span></div>' : ''}
  <div style="margin-top:12px">${badge(r)} ${r.shared ? '<span class="badge b-o">PUBLIC</span>' : r.sample ? '' : '<span class="badge b-s">ONLY ON THIS PHONE</span>'}</div>
  <div class="item" style="margin-top:12px"><div class="m">${r.seen ? 'Added from an eBay search on 31 Oct' : `Reported by ${esc(shownUser(r))} on ${fmtDate(r.t)}`}</div>
  <div class="m">Proof: ${esc(evName)}</div>
  ${r.link ? `<div class="m"><a href="${esc(r.link)}" target="_blank" rel="noopener">Open ${r.seen ? 'eBay page' : 'link'}</a></div>` : ''}
  ${r.note ? `<div class="m">${r.seen ? esc(r.note) : '“' + esc(r.note) + '”'}</div>` : ''}
  ${r.seen ? `<div class="m">A listing shows the card exists. It still needs a moderator check before it counts as verified.</div>` : ''}
  ${r.autoNote ? `<div class="m">${esc(r.autoNote)}</div>` : ''}
  ${r.dupOf ? `<div class="m" style="color:var(--pend)">Another report already exists for this copy</div>` : ''}
  ${r.status === 'verified' ? `<div class="m">${r.firstVerified ? `First verified report · +${r.points} points` : 'Already verified earlier, no points'}</div>` : ''}
  ${r.photo ? `<img class="thumb" src="${esc(r.photo)}" alt="" referrerpolicy="no-referrer">` : ''}
  ${r.shared ? `<div class="m"><a href="${esc(r.url)}" target="_blank" rel="noopener">${r.status === 'pending' && S.mod ? 'Review it on GitHub (add the verified or rejected label)' : 'See the photos and proof on GitHub'} ↗</a></div>` : ''}</div>`;
  if (!r.shared && !r.seen && !r.sample && r.status !== 'rejected') h += r.sharedAt
    ? `<div class="hint">You opened the share page on ${fmtDate(r.sharedAt)}. It shows here as public once the issue is posted (a few minutes).</div><button class="btn ghost" data-share="${r.id}">Open the share page again</button>`
    : `<button class="btn" data-share="${r.id}">Share on the public registry</button><div class="hint">Opens a GitHub issue with this report filled in. You add your photos there and post it. Everyone sees it as pending until a moderator checks it. You need a free GitHub account, and your GitHub username shows on the issue.</div>`;
  if (S.mod && r.status === 'pending' && !r.shared) h += `<div class="btns"><button class="btn" data-v="${r.id}">Verify</button><button class="btn ghost" data-x="${r.id}">Reject</button></div><button class="btn red" data-f="${r.id}">Reject as fake (−50 points)</button>`;
  if (r.seen) h += `<button class="btn ghost" data-own="${r.id}">I own this card, report it</button>`;
  openSheet(h);
  const sb = $('#sheet [data-share]'); if (sb) sb.onclick = () => { r.sharedAt = r.sharedAt || Date.now(); save(); window.open(shareUrl(r), '_blank'); openDetail(r.id); };
  const own = $('#sheet [data-own]'); if (own) own.onclick = () => openReport({ set: r.set, grp: r.grp, card: r.card, par: r.par, serial: r.serial || 1 });
}
// pre-filled GitHub issue for the public registry; scripts/update_finds.py reads the block back
function shareUrl(r){
  const s = setById(r.set), g = grpOf(s, r.grp), c = cardOf(g, r.card), num = r.run === 1 ? '1/1' : (r.serial || '?') + '/' + r.run;
  const proof = { graded: 'Add a photo of the slab, front and back. You can cover the cert number.',
    listing: 'The listing link is above. Add a screenshot too, in case the listing comes down.',
    video: 'The video link is above. Add a screenshot of the moment you pull it.',
    photo: `Add photos of the front and back with the serial number readable and a paper note saying **${r.code}** in the shot.`,
    inventory: `Add photos of the front and back with the serial number readable and a paper note saying **${r.code}** in the shot.` }[r.ev] || '';
  const data = { v: 1, set: r.set, grp: r.grp, card: r.card, par: r.par, serial: r.serial || 0, ev: r.ev === 'inventory' ? 'photo' : r.ev, link: r.link || '', code: r.code || '', note: r.note || '', anon: !!r.anon };
  const body = `**${c[1]}** · ${r.par} ${num}\n${short(s.name)} · ${g.n} · ${cardNo(g, c[0])}\n\n` +
    (r.link ? `Proof link: ${r.link}\n\n` : '') + (r.note ? `> ${r.note}\n\n` : '') +
    `### Photos\n${proof}\n\n_Drag your photos into this box, then tap Submit. A moderator adds the **verified** label once the proof checks out._\n\n` +
    `<!-- slabfolio-find\n${JSON.stringify(data)}\n-->\n<sub>Shared from Cappd ${APP_VERSION}. Please leave the hidden block above as it is.</sub>`;
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Find: ${c[1]} ${r.par} ${num} (${short(s.name)})`)}&body=${encodeURIComponent(body)}`;
}
function badge(r){ return r.status === 'verified' ? `<span class="badge b-v">VERIFIED${r.auto ? ' · CERT' : ''}</span>` : r.status === 'pending' ? '<span class="badge b-p">PENDING</span>' : r.status === 'seen' ? '<span class="badge b-o">SEEN ON EBAY</span>' : `<span class="badge b-r">${r.fake ? 'FAKE' : 'REJECTED'}</span>`; }
function itemHtml(r){
  const s = setById(r.set), g = grpOf(s, r.grp), c = cardOf(g, r.card);
  return `<div class="item" data-detail="${r.id}"><div class="t">${esc(c[1])} · ${esc(r.par)} ${r.run === 1 ? '1/1' : (r.serial || '?') + '/' + r.run}</div>
  <div class="m">${esc(short(s.name))} · ${esc(g.n)} · ${esc(shownUser(r))}${r.seen ? '' : ' · ' + fmtDate(r.t)}</div><div style="margin-top:6px">${badge(r)} ${r.sample ? '<span class="badge b-s">SAMPLE</span>' : ''}${r.shared ? ' <span class="badge b-o">PUBLIC</span>' : ''}</div></div>`;
}

// ---------- feed / review / me ----------
function finderTop(){
  const n = allReports().filter(r => r.status === 'pending').length;
  return `<header class="top"><h1>Card Finder</h1><button class="mini acc" data-act="report">+ Report a pull</button></header>
  <div class="seg wide" style="margin-bottom:12px">${[['hunt','Sets'],['feed','Latest finds'],['review','Review' + (n ? ' (' + n + ')' : '')]].map(([k, l]) => `<button data-go="${k}" class="${view.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function renderFeed(){
  const list = allReports().sort((a, b) => b.t - a.t);
  return finderTop() + list.map(itemHtml).join('');
}
function renderReview(){
  const list = localReports().filter(r => r.status === 'pending').sort((a, b) => a.t - b.t);
  const shared = sharedReports().filter(r => r.status === 'pending').sort((a, b) => a.t - b.t);
  return finderTop() + `
  ${S.mod ? '' : `<div class="banner">Turn on Moderator mode in Me to verify or reject reports.</div>`}
  <div class="sub" style="margin-bottom:10px">Graded cards with a cert number skip this queue. Everything else waits here for a check.</div>` +
  (list.length ? list.map(itemHtml).join('') : `<div class="empty">Nothing waiting for review on this phone.</div>`) +
  (shared.length ? `<div class="sec">Shared on GitHub, waiting for a label</div><div class="sub" style="margin-bottom:8px">Open one, check the photos on GitHub, then add the <b>verified</b> or <b>rejected</b> label there (or <b>fake</b> to take 50 points off). The registry updates a minute or two later.</div>` + shared.map(itemHtml).join('') : '');
}
// ---------- sample data (clearly marked) ----------
const SAMPLE = [
  ['chrome','Base','10','SuperFractor',1,'graded','verified','pullkingsg'],['chrome','Base','182','Red',3,'listing','verified','breakroom_uk'],
  ['chrome','Base','112','Black',7,'photo','pending','ripnflip'],['chrome','Wonderkids','WK-4','Orange',12,'video','verified','breakroom_uk'],
  ['merlin','Base','123','SuperFractor',1,'listing','verified','merlinmagic'],['merlin','Base Autographs','MV-CP','Red',2,'graded','verified','pullkingsg'],
  ['merlin','Young Magicians','YM-3','Black',4,'photo','pending','gooners_pc'],['pristine','Base','17','PL Trophy Malachite',9,'listing','verified','gooners_pc'],
  ['pristine','Pristine Autographs','PA-EH','Red',4,'video','pending','bluesbreaks'],['inception','Base','8','Gold',1,'graded','verified','cules_cards'],
  ['inception','Base Autographs','ES-RN','Orange',5,'listing','pending','ripnflip'],['royalty','Base','7','Platinum',1,'listing','verified','gooners_pc'],
  ['royalty','Royalty Autographs','RA-RN','Tyrian Purple',2,'photo','verified','merlinmagic'],['museum','Base','19','Emerald',1,'video','pending','cules_cards'],
  ['museum','Archival Autographs','AA-LY','Diamond',3,'graded','verified','pullkingsg']
];
function loadSample(){
  const now = Date.now();
  SAMPLE.forEach((x, i) => { const s = setById(x[0]), g = grpOf(s, x[1]), p = g.pars.find(q => q.n === x[3]);
    const r = { id: 'sample' + i, sample: true, set: x[0], grp: x[1], card: x[2], par: x[3], run: p.r, serial: x[4], ev: x[5], status: 'pending', user: x[7], t: now - (i + 1) * 3.6e6 * 5,
      link: x[5] === 'listing' || x[5] === 'video' ? 'https://example.com/sample' : '', code: 'SMPL' + i, note: 'Sample report for testing, not a real pull.' };
    if (x[6] === 'verified') verify(r, x[5] === 'graded');
    S.reports.push(r); });
  S.sampleLoaded = true;
}

// ---------- news ----------
// Headlines only: title, publisher, link, date. "n" holds name-like words from the headline and teaser for matching.
const newsItems = k => (NEWS.items || []).filter(n => n.k === k);
const ago = iso => { const m = (Date.now() - Date.parse(iso)) / 6e4; return !(m >= 0) ? '' : m < 60 ? Math.max(1, Math.round(m)) + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : m < 1440 * 7 ? Math.round(m / 1440) + 'd ago' : fmtDate(iso); };
const PARTICLES = new Set(['van', 'de', 'der', 'den', 'da', 'di', 'dos', 'el', 'al', 'ten', 'ter', 'le', 'la']);
// owned players, with the value of their cards so news about bigger holdings ranks first
function myPlayers(){
  const m = new Map();
  for (const c of S.cards.filter(owned)) for (const p of String(c.player || '').split(/\s*(?:\/|&|,|\+|\band\b)\s*/)){
    const name = p.trim(); if (!name) continue;
    const toks = norm(name).replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(Boolean); if (!toks.length) continue;
    // surname = everything after the first name ("van de ven"); single names (Pedri) match on their own
    const sur = toks.length > 1 ? toks.slice(1) : toks;
    if (sur.join('').length < 4 && toks.length < 2) continue;
    const cur = m.get(name) || { name, sur: sur.length === 1 && sur[0].length < 4 ? toks : sur, v: 0, n: 0 };
    cur.v += (val(c).v || 0) * qty(c); cur.n += qty(c); m.set(name, cur);
  }
  return [...m.values()].sort((x, y) => y.v - x.v || y.n - x.n);
}
function tagNews(list, players){
  return list.map(n => { const w = new Set(n.n || []);
    const ps = players.filter(p => p.sur.every(t => w.has(t)) && !(p.sur.length === 1 && PARTICLES.has(p.sur[0])));
    const hrs = Math.max(0, (Date.now() - Date.parse(n.d)) / 36e5);
    return { ...n, ps, score: ps.length ? (1 + Math.log10(1 + Math.max(...ps.map(p => p.v)))) * Math.exp(-hrs / 72) : 0 }; });
}
function forYou(){ return tagNews(newsItems('football'), myPlayers()).filter(n => n.ps.length).sort((a, b) => b.score - a.score); }
const newsHtml = (n, chips) => `<a class="item news" href="${esc(n.u)}" target="_blank" rel="noopener">${chips}<div class="t">${esc(n.t)}</div><div class="m">${esc(n.s)}${n.d ? ' · ' + ago(n.d) : ''} ↗</div></a>`;
const playerChips = n => n.ps.slice(0, 3).map(p => `<span class="chip">${esc(p.name)}</span>`).join(' ');
function renderNews(){
  const sub = view.news;
  let h = `<header class="top"><h1>News</h1></header>
  <div class="seg wide">${[['football','Your players'],['cards','Card news']].map(([k, n]) => `<button data-news="${k}" class="${sub === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (sub === 'football'){
    const players = myPlayers(), tagged = tagNews(newsItems('football'), players), mine = tagged.filter(n => n.ps.length);
    const withNews = players.filter(p => mine.some(n => n.ps.includes(p)));
    const list = (view.np ? mine.filter(n => n.ps.some(p => p.name === view.np)) : mine).sort((a, b) => b.score - a.score);
    h += withNews.length ? `<div class="sub" style="margin:12px 0 6px">Players in your collection with news, biggest holdings first</div>
    <div class="pills"><button class="pill ${view.np ? '' : 'on'}" data-np="">All</button>${withNews.map(p => `<button class="pill ${view.np === p.name ? 'on' : ''}" data-np="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>` : '';
    h += list.length ? list.slice(0, 60).map(n => newsHtml(n, playerChips(n))).join('')
      : `<div class="empty">No headlines about the ${players.length} players in your collection in the last two weeks.</div>`;
    const rest = tagged.filter(n => !n.ps.length).slice(0, 15);
    if (!view.np && rest.length) h += `<div class="sec">Latest football</div>` + rest.map(n => newsHtml(n, '')).join('');
  } else {
    const lines = new Set(S.cards.filter(owned).map(c => norm(c.line)).filter(x => x.length > 3));
    const cards = newsItems('cards').map(n => ({ ...n, mine: [...lines].some(l => norm(n.t).includes(l)) })).sort((a, b) => b.mine - a.mine || b.d.localeCompare(a.d));
    h += `<div class="sub" style="margin:12px 0 6px">Releases and checklists · ★ = a product line you collect</div>` +
    (cards.length ? cards.slice(0, 30).map(n => newsHtml(n, `<span class="chip c">${n.mine ? '★ ' : ''}${esc(n.tag || 'Cards')}</span>`)).join('') : `<div class="empty">No football card news in the last two weeks.</div>`) +
    `<div class="sub" style="margin:16px 0 6px">Notable listings in your tracked sets</div>` + seenReports().map(itemHtml).join('');
  }
  const src = (NEWS.sources || []).join(', ');
  return h + `<p class="sub">Headlines link to the publisher; Cappd never copies the article. Updated ${ago(NEWS.pulled) || esc(NEWS.pulled)}${src ? ' from ' + esc(src) : ''}. Refreshed every 6 hours.</p>`;
}
function bindNews(a){
  a.querySelectorAll('[data-news]').forEach(el => el.onclick = () => { view.news = el.dataset.news; render(); });
  a.querySelectorAll('[data-np]').forEach(el => el.onclick = () => { view.np = el.dataset.np; render(); });
}

// ---------- scan my collection ----------
const norm = x => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const SET_HINTS = [[/merlin/i, 'merlin'], [/chrome/i, 'chrome'], [/pristine/i, 'pristine'], [/inception/i, 'inception'], [/museum/i, 'museum'], [/royalty/i, 'royalty']];
const OTHER_INSERTS = ['future stars'];   // insert names from other years that would otherwise match a base parallel
const HIT_GROUP = /auto|relic|signature|patch|swatch|material|book|ink|pen/i;
// returns { out: [candidate slots] } or { why: reason there is no match }
function matchInv(line, desc, player, serialTxt){
  const m = /(\d+)\s*\/\s*(\d+)/.exec(serialTxt || ''); if (!m) return { why: 'No serial number' };
  const serial = +m[1], run = +m[2];
  if (run > 25) return { why: 'Numbered higher than /25, not tracked' };
  const hint = SET_HINTS.find(h => h[0].test(line + ' ' + desc)); if (!hint) return { why: 'Not one of the 6 tracked sets' };
  const s = setById(hint[1]), pn = norm(player), d = norm(desc);
  const auto = /auto|patch|relic|sign/.test(d), patch = /patch|relic|jersey/.test(d);
  const named = s.groups.filter(g => g.n !== 'Base' && d.includes(norm(g.n.replace(/ \(.*\)/, ''))));
  const other = OTHER_INSERTS.find(w => d.includes(w));
  if (!named.length && other) return { why: `${short(s.name)} has no "${other}" insert, so this is probably a different year` };
  const out = [];
  for (const g of named.length ? named : s.groups){
    if (!named.length && HIT_GROUP.test(g.n) !== auto) continue;
    if (!named.length && patch && !/relic|patch|material|swatch/i.test(g.n)) continue;
    for (const c of g.cards){
      const cn = norm(c[1]); if (cn !== pn && !cn.split(/\s*[\/&,]\s*/).includes(pn)) continue;
      for (const par of g.pars) if (par.r === run && serial <= run) out.push({ set: s.id, grp: g.n, card: c[0], par: par.n, run, serial });
    }
  }
  if (out.length) return { out };
  const missing = auto && s.id === 'chrome' ? '. Chrome base autographs are not loaded yet' : auto && s.id === 'merlin' ? ". Some Merlin autographs are not loaded yet" : '';
  return { why: `No ${player} card numbered /${run} in ${short(s.name)}${missing}. Your sheet has no year, so it may be another season` };
}
const candTxt = c => { const g = grpOf(setById(c.set), c.grp); return `${short(setById(c.set).name)} · ${g.n} ${cardNo(g, c.card)} · ${c.par} ${c.run === 1 ? '1/1' : c.serial + '/' + c.run}`; };
function invRow(row, i){
  const [id, line, desc, player, serial] = row, res = matchInv(line, desc, player, serial), done = (S.invAdded || {})[id];
  let h = `<div class="item"><div class="t">${esc(player)} · ${esc(serial)}</div><div class="m">${esc(line)} · ${esc(desc)}${/^C\d/.test(id) ? ' · ' + esc(id) : ''}</div>`;
  if (done) h += `<div style="margin-top:8px"><span class="badge b-p">ADDED · WAITING FOR REVIEW</span></div><div class="m" style="margin-top:4px">${esc(done)}</div>`;
  else if (res.out){
    h += `<div class="m" style="margin-top:8px;color:var(--text)">${res.out.length > 1 ? 'Possible matches. Pick the one that is your card:' : 'Possible match. Check it is the 2025-26 card:'}</div>
    ${res.out.slice(0, 8).map((c, k) => `<label class="cand"><input type="radio" name="inv${i}" value="${k}" ${k ? '' : 'checked'}> ${esc(candTxt(c))}</label>`).join('')}
    <button class="btn" style="margin-top:10px;padding:10px" data-inv="${i}">Add to registry</button>`;
  } else h += `<div class="m" style="margin-top:6px">${esc(res.why)}</div>`;
  return h + `</div>`;
}
function invRows(){ return S.cards.filter(c => c.status !== 'Sold' && c.run && +c.run <= 25 && c.serial).map(c => [c.id, c.line, c.desc, c.player, c.serial]); }
function scanRows(){ return invRows().concat(view.paste || []); }
function renderScan(){
  const rows = scanRows(), hits = rows.filter(r => matchInv(r[1], r[2], r[3], r[4]).out).length;
  const INV = invRows();
  return `<header class="top"><button class="back" data-go="hunt">‹ Card Finder</button></header>
  <h1 style="margin:0 0 4px;font-size:22px">Scan my collection</h1>
  <div class="sub" style="margin-bottom:12px">${INV.length} cards you own are numbered /25 or lower${S.sampleCards ? ' (sample collection)' : ''}. ${hits} match one of the 6 tracked checklists. Adding one creates a report that a moderator checks before it turns green.</div>
  ${rows.map(invRow).join('')}
  <div class="prof"><b>Add more cards</b><div class="sub" style="margin-top:4px">One card per line: set, player, serial. For example: Pristine, Emiliano Martinez, 2/25</div>
  <textarea class="inp" id="paste" style="margin-top:8px" placeholder="Merlin, Cole Palmer, 3/5"></textarea>
  <button class="btn ghost" id="pastego">Check these cards</button></div>`;
}
function bindScan(a){
  a.querySelectorAll('[data-inv]').forEach(el => el.onclick = () => {
    const i = +el.dataset.inv, row = scanRows()[i], res = matchInv(row[1], row[2], row[3], row[4]);
    const pick = a.querySelector(`input[name=inv${i}]:checked`), c = res.out[pick ? +pick.value : 0];
    const dup = S.reports.find(r => r.user === S.user && r.status !== 'rejected' && slotKey(r.set, r.grp, r.card, r.par, r.serial) === slotKey(c.set, c.grp, c.card, c.par, c.serial));
    if (dup) return toast('You already reported this copy');
    S.reports.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...c, ev: 'inventory', code: newCode(), link: '', photo: '', cert: '',
      note: `From my collection${/^C\d/.test(row[0]) ? ' (' + row[0] + ')' : ''}`, anon: false, user: S.user, t: Date.now(), status: 'pending' });
    S.invAdded = S.invAdded || {}; S.invAdded[row[0]] = candTxt(c);
    save(); render(); toast('Added to the registry · waiting for review');
  });
  const pg = $('#pastego'); if (pg) pg.onclick = () => {
    view.paste = $('#paste').value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x.length >= 3 && x[1])
      .map((x, k) => ['P' + Date.now().toString(36) + k, x[0], x[0], x[1], x[2]]);
    render(); toast(view.paste.length ? `Checked ${view.paste.length} card${view.paste.length > 1 ? 's' : ''}` : 'Use: set, player, serial');
  };
}

// ---------- bindings ----------
function bind(){
  const a = $('#app');
  a.querySelectorAll('[data-set]').forEach(el => el.onclick = () => { view.set = el.dataset.set; view.grp = 0; view.par = defaultPar(setById(view.set).groups[0]); view.q = ''; view.filter = 'all'; render(); window.scrollTo(0,0); });
  a.querySelectorAll('[data-act=home]').forEach(el => el.onclick = () => { view.set = null; view.tab === 'hunt' ? render() : go('hunt'); });
  a.querySelectorAll('[data-act=feed]').forEach(el => el.onclick = () => go('feed'));
  a.querySelectorAll('[data-act=scan]').forEach(el => el.onclick = () => go('scan'));
  a.querySelectorAll('[data-act=me]').forEach(el => el.onclick = () => go('me'));
  a.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { view.set = null; go(el.dataset.go); });
  a.querySelectorAll('[data-act=report]').forEach(el => el.onclick = () => openReport({}));
  bindNews(a); bindScan(a); bindApp(a);
  const grp = $('#grp'); if (grp) grp.onchange = () => { view.grp = +grp.value; view.par = defaultPar(setById(view.set).groups[view.grp]); render(); };
  a.querySelectorAll('[data-par]').forEach(el => el.onclick = () => { view.par = +el.dataset.par; render(); });
  a.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => { view.filter = el.dataset.filter; render(); });
  a.querySelectorAll('[data-card]').forEach(el => el.onclick = () => openCard(view.set, view.grp, el.dataset.card, view.par));
  a.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => openDetail(el.dataset.detail));
  const on = a.querySelector('.pill.on'); if (on) on.parentNode.scrollLeft = on.offsetLeft - 40;
  const q = $('#q'); if (q) q.oninput = () => { view.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  const gn = $('#ghname'); if (gn) gn.onchange = () => { S.gh = gn.value.trim().replace(/^@/, ''); save(); render(); };
  const un = $('#uname'); if (un) un.onchange = () => { S.user = un.value.trim().replace(/^@/, '') || 'ben'; save(); render(); };
  const mod = $('#mod'); if (mod) mod.onclick = () => { S.mod = !S.mod; save(); render(); };
  const sm = $('#sample'); if (sm) sm.onclick = () => { if (S.sampleLoaded){ S.reports = S.reports.filter(r => !r.sample); S.sampleLoaded = false; } else loadSample(); save(); render(); toast(S.sampleLoaded ? 'Sample reports loaded' : 'Sample reports removed'); };
  const cl = $('#clear'); if (cl) cl.onclick = () => { if (cl.dataset.armed){ S.reports = []; S.sampleLoaded = false; save(); render(); toast('Your reports cleared'); } else { cl.dataset.armed = 1; cl.textContent = 'Tap again'; } };
  const claim = $('#claim'); if (claim) claim.onclick = () => { S.monthsEarned[new Date().toISOString().slice(0, 7)] = 1; save(); render(); toast('Free month of Pro added (simulated)'); };
}
function bindSheet(){
  const sh = $('#sheet');
  sh.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => openDetail(el.dataset.detail));
  const act = (attr, fn) => sh.querySelectorAll(`[${attr}]`).forEach(el => el.onclick = () => { const r = S.reports.find(x => x.id === el.getAttribute(attr)); fn(r); save(); closeSheet(); render(); });
  act('data-v', r => { verify(r, false); toast(r.firstVerified ? `Verified · +${r.points} points to @${r.user}` : 'Verified (copy already verified, no points)'); });
  act('data-x', r => { reject(r, false); toast('Rejected'); });
  act('data-f', r => { reject(r, true); toast('Marked as fake · −50 points'); });
}

// ---------- collection: values ----------
const money = x => { if (x === null || x === undefined || x === '') return null; const n = parseFloat(String(x).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
const sgd = n => n === null || n === undefined ? '–' : (n < 0 ? '−' : '') + 'S$' + Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 });
const owned = c => c.status !== 'Sold';
const isHit = c => !!(c.hit || c.serial || /yes/i.test(c.auto || '') || /yes/i.test(c.patch || ''));
const compsOf = c => (S.comps[c.id] || []).slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''));
// value = latest sale you logged, then the sheet's comp price, then your own asking price (purple)
function val(c){
  const l = compsOf(c)[0];
  if (l) return { v: l.p, kind: 'sold', src: `Sale you logged (${l.s}${l.d ? ', ' + l.d : ''})`, via: l.s, d: l.d, n: compsOf(c).length };
  if (money(c.comp) !== null) return { v: money(c.comp), kind: 'sold', src: 'Comp price from your sheet' + (c.compDate ? ` (${c.compDate})` : ''), via: 'your sheet', d: c.compDate, n: 0 };
  if (money(c.ask) !== null) return { v: money(c.ask), kind: 'own', src: 'Your asking price, no sale logged yet' };
  return { v: null, kind: 'none', src: 'No value yet' };
}
// where a value came from, in plain words: "Last sold 6 Nov · eBay sold · 3 sales logged"
const shortDate = d => { if (!d) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); if (!m) return String(d);
  const t = new Date(+m[1], +m[2] - 1, +m[3]); return t.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', ...(t.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
function srcLine(c, short){
  const x = val(c);
  if (x.kind === 'own') return short ? '' : 'Your asking price · no sale logged yet';
  if (x.kind === 'none') return short ? '' : 'No value yet';
  if (x.via === 'your sheet') return short ? (x.d ? `Comp ${shortDate(x.d)}` : 'Sheet comp') : `Comp from your sheet${x.d ? ' · ' + shortDate(x.d) : ' · no date'}`;
  const d = shortDate(x.d);
  if (short) return `Sold ${d || ''}${d ? ' · ' : ''}${x.via}`.replace(/^Sold $/, 'Sold');
  return `Last sold${d ? ' ' + d : ''} · ${x.via}${x.n > 1 ? ` · ${x.n} sales logged` : ''}`;
}
function tone(c){
  const x = val(c), cost = money(c.cost);
  if (x.kind === 'own') return 'pu';
  if (x.v === null || cost === null) return 'nt';
  return x.v - cost > 5 ? 'g' : x.v - cost <= -5 ? 'rd' : 'o';
}
const qty = c => +c.qty || 1;
const profitSold = c => money(c.sold) === null ? null : money(c.sold) - (money(c.cost) || 0);
const cardLine = c => [c.line && !c.desc.toLowerCase().includes(c.line.toLowerCase()) ? c.line : '', c.desc].filter(Boolean).join(' · ');
const cardTags = c => [c.serial, /yes/i.test(c.auto || '') ? 'Auto' : '', /yes/i.test(c.patch || '') ? 'Patch' : '', /yes/i.test(c.rc || '') ? 'RC' : '', c.grade && c.grade !== 'Raw' ? c.grade : ''].filter(Boolean);
function totals(){
  const t = { value: 0, paid: 0, n: 0, spent: 0, got: 0, tones: { g: 0, o: 0, rd: 0, pu: 0, nt: 0 }, needs: 0 };
  for (const c of S.cards){
    t.spent += (money(c.cost) || 0);
    if (!owned(c)){ t.got += (money(c.sold) || 0); continue; }
    const x = val(c); t.n += qty(c); t.value += (x.v || 0) * qty(c); t.paid += (money(c.cost) || 0); t.tones[tone(c)]++;
    if (isHit(c) && x.kind !== 'sold') t.needs++;
  }
  return t;
}

// ---------- easy / pro ----------
// Easy: plain words, photos first, fewer tabs. Pro: denser, trading-app style with % change, breakdowns and every tool.
const pro = () => S.mode === 'pro';
const modeSeg = () => `<div class="seg mode" role="group" aria-label="App style">${[['easy', 'Easy'], ['pro', 'Pro']].map(([k, n]) => `<button data-setmode="${k}" class="${(S.mode || 'easy') === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
function setMode(m){ S.mode = m; save(true); closeSheet(); if (m !== 'pro' && view.tab === 'hunt') view.tab = 'home'; render(); }
function askMode(){
  openSheet(`<h2>How do you collect?</h2><div class="sub" style="margin-top:4px">Pick a style. You can switch any time from Home or Me.</div>
  <button class="pick rec" data-setmode="easy"><b>Easy<em>Recommended</em></b><span>I want to see my cards, what they're worth, and show them off. Big photos, plain words.</span></button>
  <button class="pick" data-setmode="pro"><b>Pro</b><span>I track costs, comps, profit and flips. Charts, % change, breakdowns and every tool.</span></button>
  <button class="skip" data-setmode="easy">Not sure yet, start with Easy</button>`);
  $('#sheet').querySelectorAll('[data-setmode]').forEach(el => el.onclick = () => setMode(el.dataset.setmode));
}

// ---------- value history ----------
// One point a day, saved on this phone from the day you start. The sample collection gets a made-up month so the chart has something to show.
const dayKey = t => new Date(t).toISOString().slice(0, 10);
function trackHist(t){
  if (S.sampleCards) return;
  const h = S.hist = S.hist || [], d = dayKey(Date.now()), v = Math.round(t.value * 100) / 100, last = h[h.length - 1];
  if (last && last.d === d){ if (last.v === v) return; last.v = v; } else h.push({ d, v });
  if (h.length > 730) h.splice(0, h.length - 730);
  save(true);
}
function histPoints(t){
  if (!S.sampleCards) return S.hist || [];
  const n = 30, end = t.value, start = t.paid * .96, out = []; let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++){ const k = i / (n - 1), wob = i === n - 1 ? 0 : (rnd() - .5) * end * .06 * Math.sin(k * Math.PI);
    out.push({ d: dayKey(Date.now() - (n - 1 - i) * DAY), v: Math.round((start + (end - start) * (k * k * (3 - 2 * k)) + wob) * 100) / 100 }); }
  return out;
}
const RANGES = [['1w', '1W', 7], ['1m', '1M', 31], ['3m', '3M', 92], ['all', 'All', 1e9]];
const inRange = (pts, r) => { const days = RANGES.find(x => x[0] === r)[2], from = dayKey(Date.now() - days * DAY); const p = pts.filter(x => x.d >= from); return p.length >= 2 ? p : pts.slice(-2); };
const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
// up / down / flat marker: an arrow plus the number, so it never relies on colour alone
function delta(d, base, opt = {}){
  const dir = d > .005 ? 'up' : d < -.005 ? 'dn' : 'fl', p = base ? Math.abs(d) / base * 100 : null;
  return `<span class="chg ${dir}${opt.big ? ' big' : ''}">${{ up: '▲', dn: '▼', fl: '–' }[dir]} ${opt.pctOnly ? '' : sgd(Math.abs(d))}${p !== null ? (opt.pctOnly ? '' : ' (') + (p < 10 ? p.toFixed(1) : Math.round(p)) + '%' + (opt.pctOnly ? '' : ')') : ''}</span>`;
}
// single-series value chart: 2px line over a soft wash, hairline + readout on touch or hover
function chartHtml(pts){
  const W = 320, H = 120, P = 6, vs = pts.map(p => p.v), mn = Math.min(...vs), mx = Math.max(...vs), sp = mx - mn || 1;
  const x = i => pts.length === 1 ? W / 2 : i / (pts.length - 1) * W, y = v => P + (1 - (v - mn) / sp) * (H - 2 * P - 14);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const up = vs[vs.length - 1] >= vs[0], col = up ? 'var(--ok)' : 'var(--bad)';
  return `<div class="chart" id="chart" data-pts='${esc(JSON.stringify(pts))}' tabindex="0" role="img" aria-label="Collection value from ${fmtDay(pts[0].d)} to ${fmtDay(pts[pts.length - 1].d)}: ${sgd(vs[0])} to ${sgd(vs[vs.length - 1])}">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? '#2fc787' : '#ef5350'}" stop-opacity=".28"/><stop offset="1" stop-color="${up ? '#2fc787' : '#ef5350'}" stop-opacity="0"/></linearGradient></defs>
  <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#cg)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
  <i class="hair" id="hair"></i><i class="cdot" id="cdot" style="background:${col}"></i><div class="ctip" id="ctip"></div>
  <div class="cax"><span>${fmtDay(pts[0].d).replace(/ \d{4}$/, '')}</span><span>${fmtDay(pts[pts.length - 1].d).replace(/ \d{4}$/, '')}</span></div></div>`;
}
function bindChart(){
  const el = $('#chart'); if (!el) return;
  const pts = JSON.parse(el.dataset.pts), hair = $('#hair'), dot = $('#cdot'), tip = $('#ctip');
  const vs = pts.map(p => p.v), mn = Math.min(...vs), mx = Math.max(...vs), sp = mx - mn || 1;
  const show = i => { const r = el.getBoundingClientRect(), px = pts.length === 1 ? r.width / 2 : i / (pts.length - 1) * r.width, h = r.height - 18, py = (6 + (1 - (pts[i].v - mn) / sp) * (120 - 12 - 14)) / 120 * h;
    hair.style.cssText = `display:block;left:${px}px`; dot.style.display = 'block'; dot.style.left = px + 'px'; dot.style.top = py + 'px';
    tip.textContent = ''; const b = document.createElement('b'); b.textContent = sgd(pts[i].v); const s = document.createElement('span'); s.textContent = fmtDay(pts[i].d); tip.append(b, s);
    tip.style.display = 'block'; tip.style.left = Math.min(Math.max(px, 56), r.width - 56) + 'px'; el.dataset.i = i; };
  const hide = () => { hair.style.display = dot.style.display = tip.style.display = 'none'; };
  const at = e => { const r = el.getBoundingClientRect(); show(Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left) / r.width * (pts.length - 1))))); };
  el.onpointerdown = el.onpointermove = at; el.onpointerleave = el.onpointercancel = hide; el.onblur = hide;
  el.onkeydown = e => { if (!/Arrow(Left|Right)/.test(e.key)) return; e.preventDefault(); const i = +(el.dataset.i ?? pts.length - 1); show(Math.max(0, Math.min(pts.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))); };
}
// what the collection is made of. Colours follow the category, never its rank; "Other" is always grey.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'], OTHER_COL = '#6b7591';
const TYPE_ORDER = ['Graded', 'Autographs', 'Numbered', 'Rookies', 'Base and inserts'], STATUS_ORDER = ['Held', 'PC', 'To list', 'Listed', 'Sealed'];
const typeOf = c => c.grade && c.grade !== 'Raw' ? 'Graded' : /yes/i.test(c.auto || '') || /auto/i.test(c.hit || '') ? 'Autographs' : c.serial ? 'Numbered' : /yes/i.test(c.rc || '') ? 'Rookies' : 'Base and inserts';
function breakdown(dim){
  const m = new Map(); let total = 0;
  for (const c of S.cards.filter(owned)){ const k = dim === 'type' ? typeOf(c) : dim === 'status' ? (c.status || 'Held') : c.player, v = (val(c).v || 0) * qty(c); total += v; const e = m.get(k) || { k, v: 0, n: 0 }; e.v += v; e.n += qty(c); m.set(k, e); }
  let rows = [...m.values()];
  if (dim === 'player'){ rows.sort((a, b) => b.v - a.v); const top = rows.slice(0, 5), rest = rows.slice(5); rows = top.map((r, i) => ({ ...r, col: SERIES[i] }));
    if (rest.length) rows.push({ k: `${rest.length} other players`, v: rest.reduce((a, r) => a + r.v, 0), n: rest.reduce((a, r) => a + r.n, 0), col: OTHER_COL }); }
  else { const order = dim === 'type' ? TYPE_ORDER : STATUS_ORDER; rows = rows.map(r => ({ ...r, col: SERIES[order.indexOf(r.k)] || OTHER_COL })).sort((a, b) => b.v - a.v); }
  return { rows: rows.filter(r => r.v > 0), total };
}
function breakdownHtml(){
  const dim = view.bd || 'type', { rows, total } = breakdown(dim);
  return `<div class="sec">What it's made of</div><div class="prof" style="padding:14px">
  <div class="seg wide sm" style="margin-bottom:12px">${[['type', 'Type'], ['player', 'Player'], ['status', 'Status']].map(([k, n]) => `<button data-bd="${k}" class="${dim === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  ${total ? `<div class="stack" role="img" aria-label="Share of collection value by ${dim}">${rows.map(r => `<i style="flex:${r.v};background:${r.col}" title="${esc(r.k)}: ${sgd(r.v)}"></i>`).join('')}</div>
  <table class="bd"><tbody>${rows.map(r => `<tr><td><i class="key" style="background:${r.col}"></i>${esc(r.k)}<span class="sub"> · ${r.n}</span></td><td>${sgd(r.v)}</td><td class="sub">${Math.round(pct(r.v, total))}%</td></tr>`).join('')}</tbody></table>` : `<div class="sub">Add values to your cards to see the split.</div>`}</div>`;
}
// a card row like a stock row: photo, name, then value with its change since you bought it
function chgOf(c){ const x = val(c), cost = money(c.cost);
  if (x.kind === 'own') return `<span class="chg own">Your value</span>`;
  if (x.v === null || cost === null || !cost) return '';
  return delta(x.v - cost, cost, { pctOnly: true }); }
const tRow = (c, right) => `<div class="crow" data-c="${esc(c.id)}">${thumbHtml(c)}<div class="l"><div class="pl">${esc(c.player)}</div><div class="ds">${esc(cardLine(c))}</div></div><div class="r">${right}</div></div>`;

// ---------- card art: real photo, or a generated card face so the layout never looks empty ----------
const hashOf = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const runOf = c => +(c.run || (/\/\s*(\d+)/.exec(c.serial || '') || [])[1] || 0);
// rarity drives the frame: 1/1 holo, /25 or lower gold, /99 or lower silver, gem-mint slabs green
function rarityOf(c){
  const r = runOf(c);
  if (r === 1 || /1\s*\/\s*1\b/.test(c.serial || '')) return 'holo';
  if (/(psa|bgs|sgc|cgc|tag)\s*10/i.test(c.grade || '')) return 'gem';
  if (r && r <= 25) return 'gold';
  if (r && r <= 99) return 'silver';
  return '';
}
function artHtml(c, opt = {}){
  const ph = photosOf(c)[0], rar = rarityOf(c);
  const badges = `${c.serial ? `<span class="dbadge">${esc(c.serial)}</span>` : ''}${c.grade && c.grade !== 'Raw' ? `<span class="dbadge gr">${esc(c.grade)}</span>` : ''}${opt.chg || ''}`;
  if (ph) return `<div class="art ${rar}">${imgTag(ph)}${phStock(ph) ? '<i class="stk">Stock photo</i>' : ''}${badges}</div>`;
  const h = hashOf(c.player) % 360;
  return `<div class="art gen ${rar}" style="--h:${h}"><div class="gface"><span class="gin">${esc(initials(c))}</span><span class="gln">${esc((c.line || c.brand || '').slice(0, 26))}</span></div>${opt.add ? '<small class="gadd">+ Add photo</small>' : ''}${badges}</div>`;
}

// ---------- engagement: daily streak, value milestones, badges ----------
const localDay = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function touchStreak(){
  const d = localDay(Date.now()), s = S.streak || (S.streak = { n: 0, best: 0, last: '', days: [] });
  if (s.last === d) return;
  s.n = s.last === localDay(Date.now() - DAY) ? s.n + 1 : 1; s.best = Math.max(s.best || 0, s.n); s.last = d;
  s.days = (s.days || []).filter(x => x !== d).concat(d).slice(-60); save(true);
}
function streakHtml(){
  const s = S.streak || { n: 1, best: 1, days: [] }, set = new Set(s.days), now = new Date(), dow = (now.getDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => { const t = Date.now() - (dow - i) * DAY, k = localDay(t);
    return `<i class="${set.has(k) ? 'on' : ''}${i === dow ? ' today' : ''}${i > dow ? ' fut' : ''}">${'MTWTFSS'[i]}</i>`; }).join('');
  return `<div class="streak"><div class="fl">${ICONS.fire}</div><div class="st"><b>${s.n}-day streak</b><span>${s.n >= (s.best || 0) && s.n > 1 ? 'Your best yet. ' : s.best > s.n ? `Best ${s.best} days. ` : ''}New headlines about your players land every few hours.</span></div><div class="wk">${week}</div></div>`;
}
const TIERS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
function milestone(v){ const next = TIERS.find(x => x > v) || TIERS[TIERS.length - 1] * 2, prev = [...TIERS].reverse().find(x => x <= v) || 0; return { next, prev, p: Math.min(1, (v - prev) / (next - prev || 1)) }; }
const ringSvg = (p, size = 56, w = 6) => { const r = (size - w) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${w}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`; };
const ICONS = {
  fire: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 5 5.6 5 10.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5c0-2.2 1.2-3.7 2.3-4.6.1 1.6.9 2.8 2.2 3.3C11 8.7 11.2 5 12 2zM12 22a7 7 0 0 1-7-7c0-.6.1-1.2.2-1.7A7 7 0 0 0 12 20a7 7 0 0 0 6.8-6.7c.1.5.2 1.1.2 1.7a7 7 0 0 1-7 7z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>',
  slab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 7h14"/><rect x="8" y="10" width="8" height="9" rx="1"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-1 4 2 7 0s3-4 6-3"/><path d="M14 4l6 6-8 8H6v-6z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/></svg>',
  gem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 18 3-18"/></svg>',
};
// number badges look like squad numbers on a shirt back; icon badges for the rest
const BADGES = [
  { id: 'first', n: 'First card', d: 'Add your first card.', num: '1', ok: x => x.owned >= 1 },
  { id: 'xi', n: 'Starting XI', d: 'Own 11 cards.', num: 'XI', ok: x => x.owned >= 11 },
  { id: 'squad', n: 'Full squad', d: 'Own 25 cards.', num: '25', ok: x => x.owned >= 25 },
  { id: 'slab', n: 'Slabbed', d: 'Own a graded card.', ic: 'slab', ok: x => x.graded >= 1 },
  { id: 'gem', n: 'Gem Mint', d: 'Own a grade 10.', ic: 'gem', ok: x => x.gem >= 1 },
  { id: 'auto', n: 'Signed', d: 'Own an autograph.', ic: 'pen', ok: x => x.auto >= 1 },
  { id: 'low', n: 'Low numbered', d: 'Own a card numbered /25 or lower.', num: '/25', ok: x => x.low >= 1 },
  { id: 'one', n: 'One of one', d: 'Own a 1/1.', num: '1/1', ok: x => x.one >= 1 },
  { id: 'comps', n: 'Market watcher', d: 'Log 5 real sales.', ic: 'chart', ok: x => x.comps >= 5 },
  { id: 'photos', n: 'Photographer', d: 'Add photos to 10 cards.', ic: 'cam', ok: x => x.photos >= 10 },
  { id: 'sale', n: 'First sale', d: 'Sell a card.', ic: 'coin', ok: x => x.sold >= 1 },
  { id: 'flip', n: 'In the green', d: 'Sell a card for more than you paid.', ic: 'star', ok: x => x.flips >= 1 },
  { id: 'streak', n: 'Week streak', d: 'Open Cappd 7 days in a row.', ic: 'fire', ok: x => x.best >= 7 },
  { id: 'k1', n: 'S$1K club', d: 'Collection worth S$1,000.', ic: 'trophy', ok: x => x.value >= 1000 },
  { id: 'safe', n: 'Safe keeper', d: 'Back up your collection.', ic: 'shield', ok: x => !!x.backup },
];
function badgeStats(){
  const own = S.cards.filter(owned), sold = S.cards.filter(c => !owned(c));
  return { owned: own.reduce((a, c) => a + qty(c), 0), graded: own.filter(c => c.grade && c.grade !== 'Raw').length, gem: own.filter(c => rarityOf(c) === 'gem').length,
    auto: own.filter(c => /yes/i.test(c.auto || '') || /auto/i.test(c.hit || '')).length, low: own.filter(c => runOf(c) && runOf(c) <= 25).length, one: own.filter(c => rarityOf(c) === 'holo').length,
    comps: Object.values(S.comps).reduce((a, l) => a + l.length, 0), photos: S.cards.filter(c => photosOf(c).length).length, sold: sold.length, flips: sold.filter(c => (profitSold(c) || 0) > 0).length,
    best: (S.streak || {}).best || 0, value: totals().value, backup: S.backupAt };
}
const medal = (b, on) => `<div class="medal ${on ? 'on' : ''}" title="${esc(b.n)}: ${esc(b.d)}">${b.num ? `<b>${b.num}</b>` : ICONS[b.ic]}</div>`;
function badgesState(){ const x = badgeStats(); return BADGES.map(b => ({ ...b, on: b.ok(x) })); }
// new badges celebrate once; whatever is already earned the first time this runs is marked as seen quietly
function checkBadges(list){
  const on = list.filter(b => b.on).map(b => b.id);
  if (!S.badgesSeen){ S.badgesSeen = on; save(true); return; }
  const fresh = list.filter(b => b.on && !S.badgesSeen.includes(b.id));
  if (!fresh.length) return;
  S.badgesSeen = S.badgesSeen.concat(fresh.map(b => b.id)); save(true);
  setTimeout(() => celebrate(fresh[0]), 350);
}
function celebrate(b){
  openSheet(`<div class="celebrate"><div class="burst">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>${medal(b, true)}
  <div class="sub" style="margin-top:14px;text-transform:uppercase;letter-spacing:1px;font-size:11px">Badge unlocked</div><h2 style="margin-top:4px">${esc(b.n)}</h2><div class="sub">${esc(b.d)}</div>
  <button class="btn" data-close>Nice</button></div>`);
  $('#sheet').querySelector('[data-close]').onclick = closeSheet;
}
function openBadges(){
  const list = badgesState(), n = list.filter(b => b.on).length;
  openSheet(`<h2>Trophy cabinet</h2><div class="sub" style="margin-bottom:12px">${n} of ${list.length} badges earned</div>${streakHtml()}<div class="cab">${list.map(b => `<div class="cb">${medal(b, b.on)}<b>${esc(b.n)}</b><span>${esc(b.d)}</span></div>`).join('')}</div>`);
}
// card of the day: the same card all day, a new one tomorrow; cards with photos first
function spotlight(){
  const own = S.cards.filter(owned); if (!own.length) return null;
  const pool = own.filter(c => photosOf(c).length).length >= 3 ? own.filter(c => photosOf(c).length) : own;
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / DAY);
  return pool.slice().sort((a, b) => a.id.localeCompare(b.id))[day % pool.length];
}
// hero number counts up once per visit, so opening the app feels alive
function countUp(){
  const el = $('#hv'); if (!el || countUp.done) return; countUp.done = true;
  const end = +el.dataset.v || 0; if (!end || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now(), dur = 900;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = sgd(Math.round(end * e * 100) / 100); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// ---------- home ----------
function renderDash(){
  const t = totals(), own = S.cards.filter(owned), diff = t.value - t.paid; trackHist(t);
  const all = histPoints(t), range = view.range || '1m', pts = all.length >= 2 ? inRange(all, range) : all;
  const moves = own.filter(c => val(c).kind === 'sold' && money(c.cost)).map(c => ({ c, d: val(c).v - money(c.cost), p: (val(c).v - money(c.cost)) / money(c.cost) }));
  const sold = S.cards.filter(c => !owned(c) && c.soldDate).sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 3);
  const news = forYou().slice(0, 3), needs = compQueue().length, ms = milestone(t.value), badges = badgesState(), earned = badges.filter(b => b.on).length;
  checkBadges(badges);
  const rangeD = pts.length >= 2 ? pts[pts.length - 1].v - pts[0].v : null;
  const who = S.user && S.user !== 'ben' ? '@' + S.user : 'collector';
  const head = `<header class="top home"><div class="brand">${LOGO}<span>Cappd</span></div><button class="chip-streak" data-act="badges" aria-label="Streak and badges">${ICONS.fire}${(S.streak || {}).n || 1}</button>${modeSeg()}</header>
  ${S.sampleCards ? `<div class="banner">This is a <b>sample collection</b> with made-up prices${pro() ? ' and a made-up value chart' : ''}. Import your own from <b>Me</b>.</div>` : ''}`;
  const chart = pts.length >= 2 ? chartHtml(pts) : `<div class="chart0">Your value chart starts today and fills in day by day.</div>`;
  const hero = `<section class="hero2"><div class="pitch" aria-hidden="true"></div><div class="hg">${greet()}, ${esc(who)}</div>
    <div class="hl">${pro() ? 'Portfolio value' : 'Your collection is worth'}</div><div class="hv" id="hv" data-v="${t.value}">${sgd(t.value)}</div>
    <div class="hs">${Math.abs(diff) < .005 ? '<span class="chg fl">– the same as you paid</span>' : `${delta(diff, t.paid)} <span class="sub">${pro() ? 'vs paid' : diff > 0 ? 'more than you paid' : 'less than you paid'}</span>`}${pro() && rangeD !== null ? ` <span class="dotsep"></span> ${delta(rangeD, pts[0].v, { pctOnly: true })} <span class="sub">${{ '1w': '1W', '1m': '1M', '3m': '3M', all: 'all time' }[range]}</span>` : ''}</div>
    ${chart}${pro() && all.length >= 2 ? `<div class="seg wide sm ranges">${RANGES.map(([k, n]) => `<button data-range="${k}" class="${range === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}</section>`;
  const movers = moves.slice().sort((a, b) => Math.abs(b.p) - Math.abs(a.p)).slice(0, 8);
  const topArt = (movers.length >= 3 ? movers.map(m => ({ c: m.c, chg: delta(m.d, money(m.c.cost), { pctOnly: true }) })) : own.slice().sort((a, b) => (val(b).v ?? 0) - (val(a).v ?? 0)).slice(0, 8).map(c => ({ c, chg: '' })));
  const carousel = topArt.length ? `<div class="sec row2"><span>${movers.length >= 3 ? 'Top movers' : 'Your top cards'}</span><button class="lnk" data-go="cards">See all</button></div>
    <div class="hscroll">${topArt.map(({ c, chg }) => `<button class="hcard" data-c="${esc(c.id)}">${artHtml(c, { chg: chg ? `<span class="mchg">${chg}</span>` : '' })}<div class="dpl">${esc(c.player)}</div><div class="dpr">${sgd(val(c).v)}</div></button>`).join('')}</div>` : '';
  const sp = spotlight(), spot = sp ? `<div class="sec">Card of the day</div><button class="spot ${rarityOf(sp)}" data-c="${esc(sp.id)}"><div class="spa">${artHtml(sp)}</div>
    <div class="spi"><span class="sub">${esc(sp.line || sp.brand || '')}</span><b>${esc(sp.player)}</b><span class="sub">${esc(sp.desc || '')}</span><div class="spv">${sgd(val(sp).v)}</div>${chgOf(sp)}${srcLine(sp, true) ? `<span class="srcl">${esc(srcLine(sp, true))}</span>` : ''}${sp.serial ? `<span class="tag" style="margin-top:6px;align-self:flex-start">${esc(sp.serial)}</span>` : ''}</div></button>` : '';
  const goals = `<div class="sec row2"><span>Goals</span><button class="lnk" data-act="badges">Trophy cabinet</button></div>
    <div class="goals"><div class="goal">${ringSvg(ms.p)}<div><b>${sgd(ms.next - t.value)} to go</b><span>to the ${sgd(ms.next).replace('.00', '')} club</span></div></div>
    <button class="goal" data-act="badges"><div class="medals">${badges.filter(b => b.on).slice(-3).map(b => medal(b, true)).join('') || medal(badges[0], false)}</div><div><b>${earned} of ${badges.length} badges</b><span>Next: ${esc((badges.find(b => !b.on) || badges[0]).n)}</span></div></button></div>`;
  const backup = backupDue() ? `<div class="item warn" data-act="backup" style="cursor:pointer"><div class="t">Back up your collection</div><div class="m">${backupWhen()} Your cards, photos and sales only live on this phone. Tap to save a copy.</div></div>` : '';
  const explore = `<div class="sec">Explore</div><div class="tiles">
    <button class="tile2" data-go="news"><span class="ti">${ICONS.star}</span><b>News</b><span>${news.length ? `${forYou().length} about your players` : 'Football and card news'}</span></button>
    <button class="tile2" data-go="hunt"><span class="ti">${ICONS.gem}</span><b>Card Finder</b><span>Hunt 1/1s and low numbers</span></button>
    <button class="tile2" data-go="comps"><span class="ti">${ICONS.chart}</span><b>Check prices</b><span>${needs ? `${needs} ${needs === 1 ? 'card needs' : 'cards need'} a real sale` : 'All cards have a sale'}</span></button>
    <button class="tile2" data-go="grade"><span class="ti">${ICONS.slab}</span><b>Grade or not?</b><span>Grading calculator</span></button></div>`;
  const newsSec = news.length ? `<div class="sec row2"><span>About your players</span><button class="lnk" data-go="news">All news</button></div>${news.map(n => newsHtml(n, playerChips(n))).join('')}` : '';

  if (!pro()){
    const noPh = own.filter(c => !photosOf(c).length).length;
    const next = backup || (needs ? `<button class="nudge" data-go="comps"><span class="ti">${ICONS.chart}</span><div><b>Check ${needs} ${needs === 1 ? 'price' : 'prices'}</b><span>${needs === 1 ? 'One card is' : 'Some cards are'} using your own guess. See what ${needs === 1 ? 'it' : 'they'} really sold for.</span></div><i>›</i></button>`
      : noPh ? `<button class="nudge" data-go="display"><span class="ti">${ICONS.cam}</span><div><b>Add photos to ${noPh} ${noPh === 1 ? 'card' : 'cards'}</b><span>Cards with photos look better on your Display.</span></div><i>›</i></button>` : '');
    return head + hero + `<div class="acts"><button data-act="addcard"><span>＋</span>Add a card</button><button data-go="comps"><span>${ICONS.chart}</span>Check prices</button><button data-go="display"><span>${ICONS.star}</span>Show off</button></div>`
      + (next ? `<div class="sec">Next step</div>${next}` : '') + carousel + spot + goals + newsSec
      + `<p class="sub" style="margin-top:18px;text-align:center">Grading calculator, Card Finder and more are in <b>Me</b>. Want % change and breakdowns? Switch to <b>Pro</b> at the top.</p>`;
  }
  const mv = view.mv || 'up', list = moves.filter(m => mv === 'up' ? m.d > 0 : m.d < 0).sort((a, b) => mv === 'up' ? b.p - a.p : a.p - b.p).slice(0, 5);
  const scan = invRows().filter(r => matchInv(r[1], r[2], r[3], r[4]).out && !S.invAdded[r[0]]).length;
  return head + hero + `<div class="kpis k4"><div><span>Cards</span><b>${t.n}</b></div><div><span>Paid</span><b>${sgd(t.paid)}</b></div><div><span>Sold</span><b>${sgd(t.got)}</b></div><div><span>Net cash</span><b class="${t.got - t.spent >= 0 ? 'g' : 'rd'}">${sgd(t.got - t.spent)}</b></div></div>`
    + backup + streakHtml() + carousel
    + (needs ? `<button class="nudge" data-go="comps"><span class="ti">${ICONS.chart}</span><div><b>${needs} ${needs === 1 ? 'card needs' : 'cards need'} a comp</b><span>Values marked "Your value" are your own until a real sale is logged. Start a comp sprint.</span></div><i>›</i></button>` : '')
    + (moves.length ? `<div class="sec row2"><span>Movers</span><div class="seg sm">${[['up', 'Gainers'], ['dn', 'Losers']].map(([k, n]) => `<button data-mv="${k}" class="${mv === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    ${list.map(m => tRow(m.c, `<b>${sgd(val(m.c).v)}</b>${delta(m.d, money(m.c.cost), { pctOnly: true })}`)).join('') || `<div class="sub" style="padding:4px 2px">No ${mv === 'up' ? 'gainers' : 'losers'} yet.</div>`}` : '')
    + breakdownHtml() + goals + spot
    + (sold.length ? `<div class="sec">Latest sales</div>${sold.map(c => { const p = profitSold(c); return tRow(c, `<b>${sgd(money(c.sold))}</b>${delta(p, money(c.cost))}`); }).join('')}` : '')
    + (scan ? `<button class="nudge" data-go="scan"><span class="ti">${ICONS.gem}</span><div><b>${scan} of your cards can go on the pull registry</b><span>Report them in Card Finder and earn points.</span></div><i>›</i></button>` : '')
    + newsSec + explore;
}
const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 19c0-6.6 4.9-12 11-12s11 5.4 11 12z" fill="var(--accent)"/><path d="M3 19h26.5c.8 0 1.2 1 .6 1.5L28 22H4.5A1.5 1.5 0 0 1 3 20.5z" fill="#ffe59a"/><path d="M16 7v12M10.5 9.5C12 12 12.5 15 12.5 19M21.5 9.5C20 12 19.5 15 19.5 19" stroke="#7a5a0a" stroke-width="1.2" fill="none" opacity=".55"/><circle cx="16" cy="6.5" r="1.8" fill="#ffe59a"/><path d="M16 6.5c3 1 4 4 3.4 7.5" stroke="#ffe59a" stroke-width="1.3" fill="none"/><circle cx="19.4" cy="14.6" r="1.2" fill="#ffe59a"/></svg>';

// ---------- collection list ----------
const CFILTERS = [['', 'All'], ['hits', 'Hits'], ['num', 'Numbered'], ['auto', 'Autos'], ['graded', 'Graded'], ['needs', 'Needs a comp'], ['pc', 'PC'], ['grade', 'To grade']];
function cardsList(){
  const q = norm(view.cq);
  let list = S.cards.filter(c => view.cseg === 'all' || (view.cseg === 'sold' ? !owned(c) : owned(c)));
  if (q) list = list.filter(c => norm([c.player, c.desc, c.line, c.brand, c.serial, c.id].join(' ')).includes(q));
  const f = view.cf;
  if (f === 'hits') list = list.filter(isHit);
  if (f === 'num') list = list.filter(c => c.serial);
  if (f === 'auto') list = list.filter(c => /yes/i.test(c.auto || '') || /auto/i.test(c.hit || ''));
  if (f === 'graded') list = list.filter(c => c.grade && c.grade !== 'Raw');
  if (f === 'needs') list = list.filter(c => owned(c) && isHit(c) && val(c).kind !== 'sold');
  if (f === 'pc') list = list.filter(c => c.status === 'PC');
  if (f === 'grade') list = list.filter(c => /to be graded/i.test(c.stage || ''));
  const v = c => owned(c) ? (val(c).v ?? -1) : (money(c.sold) ?? -1);
  const sorters = { value: (a, b) => v(b) - v(a), low: (a, b) => v(a) - v(b), profit: (a, b) => ((owned(b) ? (val(b).v ?? 0) : money(b.sold) ?? 0) - (money(b.cost) || 0)) - ((owned(a) ? (val(a).v ?? 0) : money(a.sold) ?? 0) - (money(a.cost) || 0)), id: (a, b) => b.id.localeCompare(a.id) };
  return list.sort(sorters[view.csort]);
}
function renderCards(){
  const list = cardsList(), sum = list.reduce((a, c) => a + (owned(c) ? (val(c).v || 0) * qty(c) : (money(c.sold) || 0)), 0);
  const paid = list.filter(owned).reduce((a, c) => a + (money(c.cost) || 0), 0), grid = view.cview ? view.cview === 'grid' : !pro();
  let h = `<header class="top"><h1>Collection</h1><button class="mini acc" data-act="addcard">+ Add card</button></header>
  <div class="csum"><div><span class="sub">${view.cseg === 'sold' ? 'Sold for' : 'Value'}</span><b>${sgd(sum)}</b>${view.cseg !== 'sold' && paid ? delta(sum - paid, paid) : ''}</div>
  <div><span class="sub">Cards</span><b>${list.length}</b></div><div><span class="sub">Hits</span><b>${list.filter(isHit).length}</b></div></div>
  <div class="row"><input class="search" id="cq" placeholder="${pro() ? 'Search player, set or ID' : 'Search your cards'}" value="${esc(view.cq)}">
  <button class="vt" data-cview="${grid ? 'list' : 'grid'}" aria-label="${grid ? 'Show as list' : 'Show as grid'}">${grid ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>'}</button></div>
  <div class="seg wide" style="margin-bottom:10px">${[['owned', 'Owned'], ['sold', 'Sold']].concat(pro() ? [['all', 'All']] : []).map(([k, n]) => `<button data-cseg="${k}" class="${view.cseg === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (pro()) h += `<div class="pills">${CFILTERS.map(([k, n]) => `<button class="pill ${view.cf === k ? 'on' : ''}" data-cf="${k}">${n}</button>`).join('')}</div>
  <div class="row" style="align-items:center"><span class="sub" style="flex:1">${S.sampleCards ? 'Sample collection' : ''}</span>
  <select class="mini" id="csort">${[['value', 'Value, high to low'], ['low', 'Value, low to high'], ['profit', 'Profit'], ['id', 'Newest']].map(([k, n]) => `<option value="${k}" ${view.csort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  if (pro() && view.cf === 'needs' && list.length) h += `<button class="btn" data-go="comps" style="margin:0 0 10px">Start a comp sprint (${compQueue().length} cards)</button>`;
  const shown = list.slice(0, view.cmore);
  if (grid) h += `<div class="dgrid">` + shown.map(c => `<button class="dtile" data-c="${esc(c.id)}">${artHtml(c, { add: true })}
      <div class="dpl">${esc(c.player)}</div><div class="dds">${esc(cardLine(c))}</div><div class="dprow"><span class="dpr">${owned(c) ? sgd(val(c).v) : 'Sold ' + sgd(money(c.sold))}</span>${owned(c) ? chgOf(c) : ''}</div>${owned(c) && srcLine(c, true) ? `<span class="srcl">${esc(srcLine(c, true))}</span>` : ''}</button>`).join('') + `</div>`;
  else for (const c of shown){
    let right;
    if (owned(c)) right = `<b>${sgd(val(c).v)}</b>${chgOf(c)}`;
    else { const p = profitSold(c); right = `<b>${sgd(money(c.sold))}</b>${p === null ? '<span>Sold</span>' : delta(p, money(c.cost))}`; }
    h += `<div class="crow" data-c="${esc(c.id)}">${thumbHtml(c)}<div class="l"><div class="pl">${esc(c.player)}</div><div class="ds">${esc(cardLine(c))}</div>
    <div class="tl">${cardTags(c).map(x => `<span class="tag">${esc(x)}</span>`).join('')}<span class="sub">${esc(c.status)}${money(c.cost) !== null ? ' · paid ' + sgd(money(c.cost)) : ''}${owned(c) && srcLine(c, true) ? ' · ' + esc(srcLine(c, true)) : ''}</span></div></div><div class="r">${right}</div></div>`;
  }
  if (list.length > view.cmore) h += `<button class="btn ghost" data-act="more">Show ${Math.min(60, list.length - view.cmore)} more</button>`;
  if (!list.length) h += `<div class="empty">${view.cq ? 'No cards match.' : 'No cards here yet. Tap + to add one.'}</div>`;
  return h + (pro() ? `<p class="sub">▲ ▼ show the change from what you paid, using the latest real sale. A dashed "Your value" means no sale is logged yet, so it's your own asking price.</p>` : '');
}

// ---------- card detail ----------
const ebaySold = c => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(c.search || [c.player, c.line, c.desc, c.run ? '/' + c.run : ''].join(' ')) + '&LH_Sold=1&LH_Complete=1';
function openC(id, mode){
  const c = S.cards.find(x => x.id === id); if (!c) return;
  const x = val(c), cost = money(c.cost), comps = compsOf(c), m = matchInv(c.line, c.desc, c.player, c.serial);
  const dl = (k, v) => v === null || v === undefined || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  const phs = photosOf(c), editing = mode === 'photos';
  const web = sameEveryCopy(c) && phs.length < MAX_PHOTOS;
  const bg = phs[0] ? phU(phs[0]) : '';
  let h = `<div class="chero ${rarityOf(c)}">${bg ? `<div class="cbg" style="background-image:url('${esc(bg)}')"></div>` : ''}<div class="phs">${phs.map((u, i) => `<div class="ph">${imgTag(u)}${phStock(u) ? '<i class="stk" title="A photo of the same card from the web, not this copy">Stock photo</i>' : ''}${editing ? `<button class="phx" data-rmph="${i}" aria-label="Remove photo">×</button>` : ''}</div>`).join('')}
  ${phs.length < MAX_PHOTOS ? `<label class="ph add"><input type="file" accept="image/*" id="phin" hidden><span>+</span>${phs.length ? 'Add photo' : 'Add a photo of the front'}</label>` : ''}</div></div>
  ${(phs.length && !editing) || (web && mode !== 'web') ? `<div class="links" style="margin:0 0 8px">${web && mode !== 'web' ? `<button class="mini" data-mode="web">Use a photo from the web</button>` : ''}${phs.length && !editing ? `<button class="mini" data-mode="photos">Remove photos</button>` : ''}</div>` : ''}
  ${mode === 'web' ? `<div class="prof" style="margin:0 0 10px"><b>Use a photo from the web</b>
    <div class="sub" style="margin-top:4px">Every copy of this card looks the same, so a photo of another copy works. It gets a small <i class="stk inl">Stock photo</i> tag so nobody mistakes it for yours.</div>
    <div class="links"><a href="${imgSearch(c)}" target="_blank" rel="noopener">Google Images ↗</a><a href="${ebayListings(c)}" target="_blank" rel="noopener">eBay listings ↗</a></div>
    <div class="hint">Find a clear photo of the front, long-press it and tap Copy, then come back:</div>
    <button class="btn" data-act="pastestock" style="margin-top:8px">Paste copied photo</button>
    <label class="f">…or paste the image link</label><div class="btns"><input class="inp" id="stkurl" placeholder="https://…" autocapitalize="off" autocorrect="off" style="flex:3"><button class="btn ghost" data-act="stkurl" style="margin:0;flex:1">Add</button></div>
    <label class="btn ghost" style="text-align:center">Pick a saved photo<input type="file" accept="image/*" id="stkfile" hidden></label>
    <button class="mini" data-mode="" style="margin-top:10px">Cancel</button></div>` : ''}
  <h2>${esc(c.player)}</h2><div class="sub">${esc(cardLine(c))}${c.id && !/^S\d/.test(c.id) ? ' · ' + esc(c.id) : ''}</div>
  <div style="margin-top:8px">${cardTags(c).map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(c.status)}</span></div>
  <dl class="kv">${owned(c) ? dl('Value', `<b class="${tone(c)}">${sgd(x.v)}</b>`) + dl('Source', `<span class="sub">${esc(srcLine(c))}</span>`) : dl('Sold for', sgd(money(c.sold))) + dl('Sold', esc([c.soldDate, c.channel].filter(Boolean).join(' · ')))}
  ${dl('Paid', cost === null ? null : sgd(cost))}${owned(c) && x.v !== null && cost !== null ? dl('Up / down', `<span class="${tone(c)}">${x.v - cost >= 0 ? '+' : ''}${sgd(x.v - cost)}</span>`) : ''}
  ${!owned(c) && profitSold(c) !== null ? dl('Profit', `<span class="${profitSold(c) >= 0 ? 'g' : 'rd'}">${sgd(profitSold(c))}</span>`) : ''}
  ${dl('Asking', money(c.ask) === null ? null : sgd(money(c.ask)))}${dl('Grading', c.stage && c.stage !== 'Raw' ? esc(c.stage) : null)}</dl>
  ${owned(c) ? `<a class="btn${x.kind === 'sold' ? ' ghost' : ''}" data-ebay href="${ebaySold(c)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Check eBay sold ↗</a>` : ''}
  <div class="links"><a href="https://130point.com/sales/" target="_blank" rel="noopener">130point ↗</a>${owned(c) ? '' : `<a href="${ebaySold(c)}" target="_blank" rel="noopener">eBay sold ↗</a>`}</div>
  <div class="switch" style="border:0;padding:12px 0 0"><span>Show on Display<br><span class="sub">${{ sale: 'Under For sale', pc: 'Under PC', sold: 'Under Sold' }[dispGroup(c)]}</span></span><button class="tog ${c.hideDisp ? '' : 'on'}" id="dtog" role="switch" aria-checked="${!c.hideDisp}" aria-label="Show on Display"></button></div>`;
  if (comps.length) h += `<label class="f">Sales you logged</label>` + comps.map(s => `<div class="item"><div class="t">${sgd(s.p)}</div><div class="m">${esc(s.s)}${s.d ? ' · ' + esc(s.d) : ''}</div></div>`).join('');
  if (mode === 'sale') h += `<form id="cf"><label class="f">Sale price (S$, the price it actually sold for)</label><input class="inp" name="p" inputmode="decimal" required>
    <label class="f">Date sold</label><input class="inp" name="d" type="date" value="${new Date().toISOString().slice(0, 10)}">
    <label class="f">Where</label><select class="inp" name="s"><option>eBay sold</option><option>130point</option><option>Carousell</option><option>Card show</option><option>Facebook group</option></select>
    <div class="hint">Only exact matches: same print run, colour, grade and year. Asking prices don't count.</div><button class="btn">Save sale</button></form>`;
  else if (mode === 'sold') h += `<form id="cf"><label class="f">You sold it for (S$)</label><input class="inp" name="p" inputmode="decimal" required>
    <label class="f">Date</label><input class="inp" name="d" type="date" value="${new Date().toISOString().slice(0, 10)}">
    <label class="f">Channel</label><select class="inp" name="s"><option>Carousell</option><option>eBay</option><option>Card show</option><option>Friend</option></select><button class="btn">Mark as sold</button></form>`;
  else if (mode === 'edit') h += `<form id="cf"><label class="f">Asking price (S$)</label><input class="inp" name="ask" inputmode="decimal" value="${money(c.ask) ?? ''}">
    <label class="f">Paid (S$)</label><input class="inp" name="cost" inputmode="decimal" value="${cost ?? ''}">
    <label class="f">Status</label><select class="inp" name="status">${['Held', 'PC', 'To list', 'Listed', 'Sealed', 'Sold'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label class="f">Grading</label><select class="inp" name="stage">${['Raw', 'To be graded', 'At grader', 'Graded'].map(s => `<option ${(c.stage || 'Raw').startsWith(s) ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn">Save</button></form>`;
  else if (mode === 'caro') { const txt = `${c.player} ${c.desc}${c.serial ? ' ' + c.serial : ''}${c.grade && c.grade !== 'Raw' ? ' ' + c.grade : ''}\n${money(c.ask) !== null ? 'S$' + money(c.ask) + ' ' : ''}(price negotiable)\nCondition: as pictured. Card sleeved and toploaded.\nMeet-up or mailing available.`;
    h += `<label class="f">Carousell listing text</label><textarea class="inp" id="caro" style="min-height:120px">${esc(txt)}</textarea><button class="btn" data-copy>Copy text</button><div class="hint">Paste it into Carousell with your photos. Cappd never posts for you.</div>`; }
  else {
    if (editing) h += `<button class="btn" data-mode="">Done</button>`;
    h += owned(c) ? `<div class="btns"><button class="btn ghost" data-mode="sale">Add a sale you saw</button><button class="btn ghost" data-mode="sold">Mark sold</button></div>
    <div class="btns"><button class="btn ghost" data-mode="edit" style="margin-top:8px">Edit</button><button class="btn ghost" data-mode="caro" style="margin-top:8px">Sell on Carousell</button></div>` : `<button class="btn ghost" data-mode="edit">Edit</button>`;
    if (owned(c) && m.out) h += `<button class="btn" data-act="toscan">This card is on the pull registry · report it</button>`;
  }
  openSheet(h);
  const sh = $('#sheet');
  sh.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => openC(id, el.dataset.mode));
  const pin = $('#phin'); if (pin) pin.onchange = () => addPhoto(id, pin.files[0]);
  const sf = $('#stkfile'); if (sf) sf.onchange = () => addPhoto(id, sf.files[0], true);
  const ps = sh.querySelector('[data-act=pastestock]'); if (ps) ps.onclick = () => pasteStock(id);
  const su = sh.querySelector('[data-act=stkurl]'); if (su) su.onclick = () => addStockLink(id, $('#stkurl').value);
  sh.querySelectorAll('[data-rmph]').forEach(el => el.onclick = () => removePhoto(id, +el.dataset.rmph));
  const eb = sh.querySelector('[data-ebay]'); if (eb) eb.addEventListener('click', () => setTimeout(() => openC(id, 'sale'), 400));
  const dt = $('#dtog'); if (dt) dt.onclick = () => { c.hideDisp = !c.hideDisp; save(); render(); openC(id, mode); };
  const ts = sh.querySelector('[data-act=toscan]'); if (ts) ts.onclick = () => { closeSheet(); go('scan'); };
  const cp = sh.querySelector('[data-copy]'); if (cp) cp.onclick = async () => { const ta = $('#caro'); try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch (e) { ta.select(); toast('Select the text and copy it'); } };
  const f = $('#cf'); if (f) f.onsubmit = e => {
    e.preventDefault();
    if (mode === 'sale'){ const p = money(f.p.value); if (p === null) return toast('Enter a price'); (S.comps[id] = S.comps[id] || []).push({ p, d: f.d.value, s: f.s.value }); toast('Sale saved · value updated'); }
    if (mode === 'sold'){ const p = money(f.p.value); if (p === null) return toast('Enter a price'); Object.assign(c, { status: 'Sold', sold: p, soldDate: f.d.value, channel: f.s.value }); toast(`Marked sold · ${profitSold(c) >= 0 ? '+' : ''}${sgd(profitSold(c))} profit`); }
    if (mode === 'edit'){ Object.assign(c, { ask: money(f.ask.value), cost: money(f.cost.value), status: f.status.value, stage: f.stage.value }); toast('Saved'); }
    save(); render(); openC(id);
  };
}
function openAdd(){
  openSheet(`<h2>Add a card</h2><form id="af">
  <label class="f">Player</label><input class="inp" name="player" required placeholder="e.g. Archie Gray">
  <label class="f">Product line</label><input class="inp" name="line" placeholder="e.g. Topps Chrome UCC 2025-26">
  <label class="f">Card, insert or parallel</label><input class="inp" name="desc" placeholder="e.g. Orange Refractor Auto">
  <div class="btns"><div style="flex:1"><label class="f">Serial</label><input class="inp" name="serial" placeholder="7/25"></div><div style="flex:1"><label class="f">Grade</label><input class="inp" name="grade" placeholder="Raw"></div></div>
  <div class="btns"><div style="flex:1"><label class="f">Paid (S$)</label><input class="inp" name="cost" inputmode="decimal"></div><div style="flex:1"><label class="f">Asking (S$)</label><input class="inp" name="ask" inputmode="decimal"></div></div>
  <label class="f">Status</label><select class="inp" name="status"><option>Held</option><option>PC</option><option>To list</option></select>
  <button class="btn">Add to collection</button></form>`);
  const f = $('#af'); f.onsubmit = e => {
    e.preventDefault();
    const serial = f.serial.value.trim(), run = (/\/\s*(\d+)/.exec(serial) || [])[1] || '';
    const c = { id: 'A' + Date.now().toString(36).toUpperCase(), status: f.status.value, player: f.player.value.trim(), line: f.line.value.trim(), desc: f.desc.value.trim(), serial, run,
      hit: serial ? 'Numbered' : '', auto: /auto/i.test(f.desc.value) ? 'Yes' : '', grade: f.grade.value.trim() || 'Raw', stage: 'Raw', qty: 1, cost: money(f.cost.value), ask: money(f.ask.value) };
    S.cards.unshift(c); save(); closeSheet(); render(); toast('Card added');
  };
}

// ---------- photos ----------
// Photos you add are shrunk and kept on this phone with the rest of your data. Cards from the public Display page come with their photos.
const PHOTO_DIR = 'display/img/';
const BUILTIN_PHOTOS = { C0083: ['gray-1', 'gray-2', 'gray-3'], C0159: ['schweini-1', 'schweini-2', 'schweini-3'], C0376: ['emi-1'], C0394: ['moore-rev-1', 'moore-rev-2'],
  C0402: ['vitinha-1', 'vitinha-2'], C0471: ['spurs-1', 'spurs-2'], C0465: ['yamal-1', 'yamal-2'], C0406: ['casado-1', 'casado-2'], C0388: ['neymar-1', 'neymar-2'],
  C0403: ['moore-sq-1', 'moore-sq-2'], C0391: ['acuna-1', 'acuna-2'], C0405: ['porro-1', 'porro-2'], S02: ['emi-1'], S05: ['gray-1', 'gray-2', 'gray-3'] };
const MAX_PHOTOS = 4;
// A photo is a URL / data URL string (a photo of your own copy) or { u, stock: 1 } (a photo from the web of the same card, tagged "Stock photo").
const phU = x => typeof x === 'string' ? x : x.u;
const phStock = x => !!(x && typeof x === 'object' && x.stock);
// Google Drive share links don't load in an <img>; the thumbnail endpoint does (the file must be shared "anyone with the link")
const driveImg = u => { const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/.exec(u || ''); return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : u; };
const sheetPhotos = c => [c.photoF, c.photoB].filter(u => /^https?:\/\//.test(u || '')).map(driveImg);
const photosOf = c => S.photos[c.id] ? S.photos[c.id] : BUILTIN_PHOTOS[c.id] ? BUILTIN_PHOTOS[c.id].map(n => PHOTO_DIR + n + '.webp') : sheetPhotos(c);
// web photos only make sense when every copy looks the same: not numbered or a 1/1, not graded (the slab label is unique), no patch or relic (every swatch differs)
const sameEveryCopy = c => !c.serial && !c.run && !/1\s*\/\s*1|one of one|patch|relic|jersey|memorabilia/i.test(c.desc || '') && !/yes/i.test(c.patch || '') && (!c.grade || c.grade === 'Raw') && !/^graded/i.test(c.stage || '');
const initials = c => (c.player || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const imgTag = (x, cls = '') => `<img src="${esc(phU(x))}" alt="" loading="lazy" referrerpolicy="no-referrer"${cls ? ` class="${cls}"` : ''}>`;
const thumbHtml = c => { const ph = photosOf(c)[0]; return `<div class="cth ${rarityOf(c)}"${ph ? '' : ` style="--h:${hashOf(c.player) % 360}"`}>${ph ? imgTag(ph) + (phStock(ph) ? '<i class="stk sm">Stock</i>' : '') : `<span>${esc(initials(c))}</span>`}</div>`; };
async function addPhoto(id, file, stock){
  const c = S.cards.find(x => x.id === id); if (!c || !file) return;
  const list = photosOf(c).slice(); if (list.length >= MAX_PHOTOS) return toast(`Up to ${MAX_PHOTOS} photos a card`);
  const d = await shrink(file, 700, .68); if (!d) return toast('Could not read that image');
  return keepPhoto(c, list, stock ? { u: d, stock: 1 } : d);
}
function keepPhoto(c, list, entry){
  const before = S.photos[c.id]; S.photos[c.id] = list.concat([entry]);
  if (!save()){ if (before) S.photos[c.id] = before; else delete S.photos[c.id]; return; }
  toast(phStock(entry) ? 'Stock photo added' : 'Photo added'); render(); openC(c.id);
}
// iPhone: long-press a photo in Safari › Copy, then this reads it from the clipboard (needs a tap, and Safari asks to allow Paste)
async function pasteStock(id){
  try {
    const items = await navigator.clipboard.read();
    for (const it of items){ const t = it.types.find(x => x.startsWith('image/')); if (t) return addPhoto(id, await it.getType(t), true); }
    toast('No photo on the clipboard. Long-press a photo and tap Copy first.');
  } catch (e) { toast('Pasting photos isn\'t allowed here. Save the photo instead, then pick it below.'); }
}
function addStockLink(id, url){
  const c = S.cards.find(x => x.id === id); url = (url || '').trim();
  if (!/^https:\/\/\S+$/.test(url)) return toast('Paste a link that starts with https://');
  const list = photosOf(c).slice(); if (list.length >= MAX_PHOTOS) return toast(`Up to ${MAX_PHOTOS} photos a card`);
  keepPhoto(c, list, { u: driveImg(url), stock: 1 });
}
const imgSearch = c => 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent([c.player, c.line, c.desc].filter(Boolean).join(' '));
const ebayListings = c => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent([c.player, c.line, c.desc].filter(Boolean).join(' '));
function removePhoto(id, i){
  const c = S.cards.find(x => x.id === id); if (!c) return;
  const list = photosOf(c).slice(); list.splice(i, 1); S.photos[id] = list; save(); render(); openC(id, list.length ? 'photos' : '');
}

// ---------- display (your cards as a photo showcase) ----------
const forSale = c => owned(c) && (/to list|listed/i.test(c.status) || (money(c.ask) !== null && c.status !== 'PC'));
const dispGroup = c => !owned(c) ? 'sold' : forSale(c) ? 'sale' : 'pc';
const dispPrice = c => { const g = dispGroup(c);
  if (g === 'sale') return money(c.ask) !== null ? sgd(money(c.ask)) : 'Make an offer';
  if (g === 'sold') return money(c.sold) !== null ? 'Sold ' + sgd(money(c.sold)) : 'Sold';
  return val(c).v !== null ? sgd(val(c).v) : ''; };
function saleText(){
  const list = S.cards.filter(c => dispGroup(c) === 'sale' && !c.hideDisp);
  return `Cards for sale (${list.length})\n\n` + list.map((c, i) => `${i + 1}. ${c.player} · ${[cardLine(c), c.serial, c.grade && c.grade !== 'Raw' ? c.grade : ''].filter(Boolean).join(' · ')} · ${dispPrice(c)}`).join('\n')
    + `\n\nPrices negotiable. Bundle discounts available. DM to buy. Meet-up or mailing in Singapore.`;
}
function renderDisplay(){
  const g = view.dg || 'sale', all = S.cards.filter(c => dispGroup(c) === g), list = all.filter(c => view.dhidden || !c.hideDisp);
  const n = k => S.cards.filter(c => dispGroup(c) === k && !c.hideDisp).length, noPh = list.filter(c => !photosOf(c).length).length, hid = all.filter(c => c.hideDisp).length;
  list.sort((a, b) => (photosOf(b).length ? 1 : 0) - (photosOf(a).length ? 1 : 0) || (val(b).v ?? money(b.sold) ?? 0) - (val(a).v ?? money(a.sold) ?? 0));
  let h = `<header class="top"><h1>Display</h1>${g === 'sale' && n('sale') ? `<button class="mini acc" data-act="saletext">Copy sale post</button>` : ''}</header>
  <div class="sub" style="margin:-6px 2px 12px">Your cards as a photo showcase, sorted into For sale, PC and Sold from your collection. Tap a card to add photos or hide it.</div>
  <div class="seg wide" style="margin-bottom:12px">${[['sale', 'For sale'], ['pc', 'PC'], ['sold', 'Sold']].map(([k, l]) => `<button data-dg="${k}" class="${g === k ? 'on' : ''}">${l} (${n(k)})</button>`).join('')}</div>`;
  if (!list.length) h += `<div class="empty">${g === 'sale' ? 'Nothing for sale yet. Give a card an asking price, or set its status to To list.' : g === 'pc' ? 'No PC cards yet.' : 'Nothing sold yet.'}</div>`;
  const withPh = list.filter(c => photosOf(c).length), fold = withPh.length && withPh.length < list.length, shown = fold ? withPh : list, rest = fold ? list.filter(c => !photosOf(c).length) : [];
  h += `<div class="dgrid">` + shown.map(c => { const ph = photosOf(c)[0];
    return `<button class="dtile${c.hideDisp ? ' hid' : ''}" data-c="${esc(c.id)}">${artHtml(c, { add: true })}
    <div class="dpl">${esc(c.player)}</div><div class="dds">${esc(cardLine(c))}</div><div class="dpr ${g === 'sale' ? 'sale' : g === 'sold' ? '' : tone(c)}">${dispPrice(c)}</div></button>`; }).join('') + `</div>`;
  if (fold){
    h += `<button class="needph" data-act="dnoph" aria-expanded="${!!view.dnoph}"><span class="ti">${ICONS.cam}</span><div><b>${rest.length} ${rest.length === 1 ? 'card needs' : 'cards need'} a photo</b><span>${view.dnoph ? 'Tap one to add its photo' : 'They join the showcase once they have one'}</span></div><i>${view.dnoph ? 'Hide' : 'Add'}</i></button>`;
    if (view.dnoph) h += `<div class="needlist">${rest.map(c => tRow(c, `<b class="${g === 'sale' ? 'sale' : ''}">${dispPrice(c)}</b>`)).join('')}</div>`;
  } else if (noPh) h += `<p class="sub">${noPh} ${noPh === 1 ? 'card has' : 'cards have'} no photo yet. Tap a card to add one.</p>`;
  if (hid) h += `<button class="btn ghost" data-act="dhidden">${view.dhidden ? 'Hide' : 'Show'} ${hid} hidden ${hid === 1 ? 'card' : 'cards'}</button>`;
  return h + `<p class="sub">Only you see this for now. A public link you can put in your bio comes with accounts at launch.</p>`;
}

// ---------- comp sprint: log real sold prices for cards that only have your own value ----------
const USD_SGD = 1.28;
const compQueue = () => S.cards.filter(c => owned(c) && val(c).kind !== 'sold' && (isHit(c) || money(c.ask) !== null || money(c.cost) >= 20))
  .sort((a, b) => ((money(b.ask) ?? money(b.cost) ?? 0) - (money(a.ask) ?? money(a.cost) ?? 0)));
function renderComps(){
  const skip = view.cskip || (view.cskip = new Set()), q = compQueue(), left = q.filter(c => !skip.has(c.id)), c = left[0], done = view.cdone || 0;
  let h = `<header class="top"><button class="back" data-go="cards">‹ Collection</button></header><h1 style="margin:0 0 4px;font-size:22px">Comp sprint</h1>
  <div class="sub">One card at a time: check what it last sold for on eBay, type it in, next. Exact matches only (same parallel, print run and grade).</div>
  <div class="prog" style="margin:14px 0"><div class="pl"><span>${done} logged this sprint · ${skip.size} skipped</span><b>${left.length} to go</b></div><div class="bar"><i style="width:${pct(done + skip.size, done + q.length)}%;background:var(--accent)"></i></div></div>`;
  if (!c) return h + `<div class="empty">${q.length ? 'You skipped the rest. ' : 'Every card has a real sale logged. '}Nice work.</div>${skip.size ? `<button class="btn ghost" data-act="unskip">Go through the skipped ones again</button>` : ''}`;
  const ph = photosOf(c)[0];
  return h + `<div class="prof">${ph ? `<div style="position:relative;width:fit-content;margin:0 auto">${imgTag(ph, 'cimg')}${phStock(ph) ? '<i class="stk">Stock photo</i>' : ''}</div>` : ''}<h2 style="margin:0;font-size:19px">${esc(c.player)}</h2><div class="sub">${esc(cardLine(c))}</div>
  <div style="margin-top:6px">${cardTags(c).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
  <dl class="kv"><dt>Your value now</dt><dd class="pu">${sgd(val(c).v)}</dd>${money(c.cost) !== null ? `<dt>Paid</dt><dd>${sgd(money(c.cost))}</dd>` : ''}</dl>
  <a class="btn" href="${ebaySold(c)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Check eBay sold ↗</a>
  <div class="links" style="justify-content:center"><a href="https://130point.com/sales/" target="_blank" rel="noopener">130point ↗</a><a href="https://www.carousell.sg/search/${encodeURIComponent(c.player + ' ' + (c.serial || c.desc))}" target="_blank" rel="noopener">Carousell ↗</a></div>
  <form id="sprint"><label class="f">Latest exact sale</label><div class="btns"><input class="inp" name="p" inputmode="decimal" placeholder="e.g. 42.50" style="flex:2">
  <select class="inp" name="cur" style="flex:1"><option value="sgd">S$</option><option value="usd" ${view.ccur === 'usd' ? 'selected' : ''}>US$</option></select></div>
  <div class="btns"><div style="flex:1"><label class="f">Date sold</label><input class="inp" name="d" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
  <div style="flex:1"><label class="f">Where</label><select class="inp" name="s"><option>eBay sold</option><option>130point</option><option>Carousell</option><option>Facebook group</option></select></div></div>
  <div class="hint">US$ is converted at ${USD_SGD} to S$. Leave out shipping.</div>
  <div class="btns"><button class="btn ghost" type="button" data-act="skip">No sale found, skip</button><button class="btn">Save and next</button></div></form></div>`;
}
function bindComps(a){
  const f = a.querySelector('#sprint'), skip = view.cskip;
  if (f) f.onsubmit = e => { e.preventDefault(); let p = money(f.p.value); if (p === null) return toast('Type the sold price, or skip');
    view.ccur = f.cur.value; if (f.cur.value === 'usd') p = Math.round(p * USD_SGD * 100) / 100;
    const c = compQueue().find(x => !skip.has(x.id)); (S.comps[c.id] = S.comps[c.id] || []).push({ p, d: f.d.value, s: f.s.value }); save();
    view.cdone = (view.cdone || 0) + 1; toast(`${c.player}: ${sgd(p)} saved`); render(); window.scrollTo(0, 0); };
  a.querySelectorAll('[data-act=skip]').forEach(el => el.onclick = () => { const c = compQueue().find(x => !skip.has(x.id)); skip.add(c.id); render(); window.scrollTo(0, 0); });
  a.querySelectorAll('[data-act=unskip]').forEach(el => el.onclick = () => { skip.clear(); render(); });
}

// ---------- backup reminder ----------
const DAY = 864e5;
const daysAgo = t => Math.floor((Date.now() - t) / DAY);
function backupDue(){
  if (S.sampleCards || !S.changedAt) return false;
  if (S.backupAt && S.backupAt >= S.changedAt) return false;
  return Date.now() - (S.backupAt || S.importAt || S.changedAt) > 7 * DAY;
}
const backupWhen = () => S.backupAt ? `Last backup ${daysAgo(S.backupAt) ? daysAgo(S.backupAt) + (daysAgo(S.backupAt) === 1 ? ' day' : ' days') + ' ago' : 'today'}.` : 'No backup yet.';
const markBackup = () => { S.backupAt = Date.now(); save(true); };

// ---------- import / export ----------
function parseCSV(t){
  const rows = []; let row = [], cell = '', q = false;
  const sep = t.split('\n')[0].includes('\t') && !t.split('\n')[0].includes(',') ? '\t' : ',';
  for (let i = 0; i < t.length; i++){
    const ch = t[i];
    if (q){ if (ch === '"' && t[i + 1] === '"'){ cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep){ row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const COLS = { id: ['id'], status: ['status'], hit: ['hit type'], sport: ['sport'], brand: ['brand'], line: ['product line'], desc: ['card / insert', 'card'], player: ['player'], serial: ['serial'], run: ['print run'],
  auto: ['auto'], patch: ['patch'], rc: ['rc'], grade: ['grade'], stage: ['grade stage'], qty: ['qty'], cost: ['total cost', 'bought for'], ask: ['asking'], sold: ['sold for'], soldDate: ['sold date'],
  channel: ['channel'], comp: ['comp price'], compDate: ['comp date'], search: ['comp search'], notes: ['notes'], photoF: ['photo front'], photoB: ['photo back'] };
function importRows(rows){
  const head = rows[0].map(x => x.trim().toLowerCase()), idx = {};
  for (const [k, names] of Object.entries(COLS)){
    let i = -1;
    for (const n of names){ i = head.findIndex(x => x === n); if (i < 0) i = head.findIndex(x => x.startsWith(n)); if (i >= 0) break; }
    idx[k] = i;
  }
  if (idx.player < 0 || idx.status < 0) return null;
  return rows.slice(1).map((r, n) => { const c = {}; for (const k in idx) c[k] = idx[k] >= 0 ? (r[idx[k]] || '').trim() : '';
    c.id = c.id || 'R' + (n + 1); ['cost', 'ask', 'sold', 'comp'].forEach(k => c[k] = money(c[k])); c.qty = +c.qty || 1; return c; })
    .filter(c => c.player && c.status && c.status !== 'Sealed');
}
function doImport(text){
  const cards = importRows(parseCSV(text));
  if (!cards || !cards.length) return toast('Could not read that. Use the Inventory tab saved as CSV.');
  S.cards = cards; S.sampleCards = false; S.invAdded = {}; S.importAt = S.importAt || Date.now(); save(); render();
  toast(`Imported ${cards.length} cards · ${cards.filter(owned).length} owned`);
}

// ---------- me ----------
function renderMe(){
  const pts = userPoints(S.user), mine = localReports().filter(r => r.user === S.user).concat(myShared());
  const ym = new Date().toISOString().slice(0, 7), earned = S.monthsEarned[ym] || 0;
  return `<header class="top"><h1>Me</h1><button class="mini" data-act="bug">Report a bug</button></header>
  <div class="prof"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>App style</b><div class="sub" style="margin-top:2px">${pro() ? 'Pro: charts, % change, breakdowns and every tool.' : 'Easy: big photos and plain words.'}</div></div>${modeSeg()}</div></div>
  <div class="prof"><b>Your collection</b><div class="sub" style="margin-top:4px">${S.sampleCards ? 'Showing the sample collection.' : `${S.cards.length} cards imported, ${S.cards.filter(owned).length} owned.`} Everything stays on this phone.</div>
  <label class="f">Import your Cards v2 sheet</label>
  <div class="hint" style="margin-top:0">In the Google Sheets app, open the Inventory tab, then ⋮ › Share &amp; export › Save as › CSV. Pick that file here, or paste the CSV text below.</div>
  <input class="inp" id="csvfile" type="file" accept=".csv,.tsv,text/csv,text/plain" style="margin-top:8px">
  <textarea class="inp" id="csvtext" style="margin-top:8px" placeholder="…or paste CSV here"></textarea>
  <button class="btn" id="csvgo">Import</button>
  ${S.sampleCards ? '' : `<button class="btn ghost" id="usesample">Go back to the sample collection</button>`}</div>
  <div class="prof"><b>Back up</b><div class="sub" style="margin-top:4px">Your cards, photos, sales and reports only live in this app. Export now and then and keep the copy in Files or Google Drive. ${S.sampleCards ? '' : `<b class="${backupDue() ? 'rd' : ''}">${backupWhen()}</b>`}</div>
  <div class="btns"><button class="btn ghost" id="exp">${view.exp ? 'Hide' : 'Export data'}</button><button class="btn ghost" id="restore">Restore</button></div>
  ${view.exp ? `<textarea class="inp" id="expt" readonly style="margin-top:8px">${esc(JSON.stringify(S))}</textarea><div class="btns"><button class="btn" id="copyexp">Copy</button><button class="btn ghost" id="saveexp">Save as file</button></div>` : ''}
  ${view.rest ? `<textarea class="inp" id="restt" style="margin-top:8px" placeholder="Paste an export here"></textarea><button class="btn" id="restgo">Restore this backup</button>` : ''}</div>
  <div class="prof"><b>Tools</b><button class="btn ghost" data-act="badges">Trophy cabinet</button><button class="btn ghost" data-go="hunt">Card Finder (pull registry)</button><button class="btn ghost" data-go="news">News</button><button class="btn ghost" data-go="grade">Grading calculator</button><button class="btn ghost" data-go="scan">Scan my collection for the pull registry</button></div>
  ${pro() ? `<div class="prof"><b>Card Finder points</b>
  <div class="sub" style="margin-top:6px">Username</div><input class="inp" id="uname" value="${esc(S.user)}" style="margin-top:6px">
  <div class="sub" style="margin-top:10px">GitHub username, so finds you share publicly count here</div><input class="inp" id="ghname" value="${esc(S.gh || '')}" placeholder="e.g. belipede" autocapitalize="off" autocorrect="off" style="margin-top:6px">
  ${S.gh ? `<div class="hint">${myShared().length} shared finds from @${esc(S.gh)} on the public registry.</div>` : ''}
  <div style="display:flex;gap:20px;margin-top:14px"><div><div class="big">${pts}</div><div class="sub">points</div></div>
  <div><div class="big">${mine.filter(r => r.status === 'verified').length}</div><div class="sub">verified</div></div>
  <div><div class="big">${mine.filter(r => r.status === 'pending').length}</div><div class="sub">pending</div></div></div>
  <div class="bar" style="margin-top:14px"><i style="width:${Math.min(100, (pts % POINTS_PER_MONTH) / POINTS_PER_MONTH * 100)}%;background:var(--accent)"></i></div>
  <div class="sub" style="margin-top:6px">${earned ? 'Free month of Pro already earned this month (limit 1 a month).' : `${POINTS_PER_MONTH - (pts % POINTS_PER_MONTH)} points to a free month of Pro`}</div>
  ${pts >= POINTS_PER_MONTH && !earned ? `<button class="btn" id="claim">Claim free month of Pro</button>` : ''}
  <ul class="rules"><li>Only the first verified report of each numbered copy earns points.</li><li>1/1 = 100 · /5 or lower = 40 · /10 or lower = 20 · /25 or lower = 10</li>
  <li>${POINTS_PER_MONTH} points = 1 free month of Pro, at most 1 a month. A fake report costs 50 points.</li></ul></div>` : ''}
  <div class="prof"><b>${pro() ? 'Testing' : 'Reset'}</b>
  ${pro() ? `<div class="switch"><span>Moderator mode<br><span class="sub">Lets you verify reports on this phone. Shared finds are verified with labels on GitHub.</span></span><button class="tog ${S.mod ? 'on' : ''}" id="mod" role="switch" aria-checked="${!!S.mod}" aria-label="Moderator mode"></button></div>
  <div class="switch"><span>Sample pull reports<br><span class="sub">Fills the registry with marked sample data</span></span><button class="pill" id="sample">${S.sampleLoaded ? 'Remove' : 'Load'}</button></div>` : ''}
  <div class="switch"><span>Start over<br><span class="sub">Deletes everything in this app. Export first.</span></span><button class="pill" id="clear">Delete</button></div></div>
  <p class="sub">Cappd test build ${APP_VERSION}. Checklists from collectosk.com and cardsmithsbreaks.com. Not affiliated with Topps, Panini or the leagues. Values are estimates, not financial advice.</p>`;
}

// ---------- grading calculator ----------
function renderGrade(){
  const g = view.g || (view.g = { raw: '', p10: '', p9: '', chance: 40, fee: 70 });
  const raw = money(g.raw), p10 = money(g.p10), p9 = money(g.p9), fee = money(g.fee) || 0, ch = Math.min(100, Math.max(0, +g.chance || 0)) / 100;
  const ev = p10 !== null && p9 !== null ? ch * p10 + (1 - ch) * p9 - fee : null;
  const todo = S.cards.filter(c => owned(c) && /to be graded/i.test(c.stage || ''));
  return `<header class="top"><button class="back" data-act="me">‹ Me</button></header><h1 style="margin:0 0 4px;font-size:22px">Grading calculator</h1>
  <div class="sub">Is grading worth it? Use real sold prices for the graded card (eBay sold or 130point).</div>
  ${todo.length ? `<div class="sec">Your cards marked to be graded</div>${todo.map(c => `<div class="crow" data-graw="${esc(c.id)}"><div class="l"><div class="pl">${esc(c.player)}</div><div class="ds">${esc(cardLine(c))}</div></div><div class="r"><b class="${tone(c)}">${sgd(val(c).v)}</b><span>tap to use</span></div></div>`).join('')}` : ''}
  <div class="prof" style="margin-top:12px"><form id="gf">
  <label class="f">Raw value now (S$)</label><input class="inp" name="raw" inputmode="decimal" value="${esc(g.raw)}">
  <div class="btns"><div style="flex:1"><label class="f">PSA 10 sells for</label><input class="inp" name="p10" inputmode="decimal" value="${esc(g.p10)}"></div><div style="flex:1"><label class="f">PSA 9 sells for</label><input class="inp" name="p9" inputmode="decimal" value="${esc(g.p9)}"></div></div>
  <div class="btns"><div style="flex:1"><label class="f">Chance of a 10 (%)</label><input class="inp" name="chance" inputmode="numeric" value="${esc(g.chance)}"></div><div style="flex:1"><label class="f">All-in cost (S$)</label><input class="inp" name="fee" inputmode="decimal" value="${esc(g.fee)}"></div></div>
  <div class="hint">PSA through a Singapore sender is about S$55–90 a card all-in; TAG via Newtro from S$33.</div></form>
  ${ev !== null ? `<dl class="kv"><dt>Expected after grading</dt><dd><b>${sgd(ev)}</b></dd><dt>Raw now</dt><dd>${sgd(raw)}</dd><dt>Difference</dt><dd class="${raw === null ? '' : ev - raw >= 0 ? 'g' : 'rd'}">${raw === null ? '–' : (ev - raw >= 0 ? '+' : '') + sgd(ev - raw)}</dd></dl>
  <div class="item" style="margin-top:12px"><div class="t">${raw === null ? 'Add the raw value to compare' : ev - raw > 10 ? 'Worth grading' : ev - raw > 0 ? 'Only just worth it' : 'Keep it raw'}</div><div class="m">Based on a ${Math.round(ch * 100)}% chance of a 10, otherwise a 9. Lower grades would make it worse.</div></div>` : '<div class="hint">Add both graded prices to see the answer.</div>'}</div>`;
}

// ---------- bug report ----------
function bugUrl(){
  const body = `**What happened**\n\n\n**What you expected**\n\n\n---\nScreen: ${view.tab}${view.set ? ' / ' + view.set : ''}\nVersion: ${APP_VERSION}\nDevice: ${navigator.userAgent}\nHome Screen app: ${navigator.standalone || matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'}`;
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent('Bug: ')}&body=${encodeURIComponent(body)}`;
}

// ---------- bindings for the collection side ----------
function bindApp(a){
  a.querySelectorAll('[data-c]').forEach(el => el.onclick = () => openC(el.dataset.c));
  a.querySelectorAll('[data-cf]').forEach(el => el.addEventListener('click', () => { view.cf = el.dataset.cf; view.cmore = 60; if (view.tab === 'cards') render(); }));
  a.querySelectorAll('[data-cseg]').forEach(el => el.onclick = () => { view.cseg = el.dataset.cseg; view.cmore = 60; render(); });
  a.querySelectorAll('[data-act=bug]').forEach(el => el.onclick = () => window.open(bugUrl(), '_blank'));
  a.querySelectorAll('[data-act=addcard]').forEach(el => el.onclick = openAdd);
  a.querySelectorAll('[data-act=more]').forEach(el => el.onclick = () => { view.cmore += 60; render(); });
  a.querySelectorAll('[data-dg]').forEach(el => el.onclick = () => { view.dg = el.dataset.dg; render(); });
  a.querySelectorAll('[data-act=dhidden]').forEach(el => el.onclick = () => { view.dhidden = !view.dhidden; render(); });
  a.querySelectorAll('[data-act=dnoph]').forEach(el => el.onclick = () => { view.dnoph = !view.dnoph; render(); });
  a.querySelectorAll('[data-act=saletext]').forEach(el => el.onclick = async () => { try { await navigator.clipboard.writeText(saleText()); toast('Sale post copied. Paste it into Instagram, Facebook or Carousell.'); } catch (e) { openSheet(`<h2>Sale post</h2><textarea class="inp" style="min-height:220px">${esc(saleText())}</textarea><div class="hint">Select all and copy.</div>`); } });
  a.querySelectorAll('[data-act=backup]').forEach(el => el.onclick = () => { view.exp = true; view.rest = false; go('me'); const t = $('#expt'); if (t) t.scrollIntoView({ block: 'center' }); });
  bindComps(a);
  a.querySelectorAll('[data-setmode]').forEach(el => el.onclick = () => setMode(el.dataset.setmode));
  a.querySelectorAll('[data-range]').forEach(el => el.onclick = () => { view.range = el.dataset.range; render(); });
  a.querySelectorAll('[data-mv]').forEach(el => el.onclick = () => { view.mv = el.dataset.mv; render(); });
  a.querySelectorAll('[data-bd]').forEach(el => el.onclick = () => { view.bd = el.dataset.bd; render(); });
  a.querySelectorAll('[data-cview]').forEach(el => el.onclick = () => { view.cview = el.dataset.cview; render(); });
  a.querySelectorAll('[data-act=badges]').forEach(el => el.onclick = openBadges);
  a.querySelectorAll('[data-graw]').forEach(el => el.onclick = () => { const c = S.cards.find(x => x.id === el.dataset.graw); view.g.raw = String(val(c).v ?? ''); render(); });
  const cs = $('#csort'); if (cs) cs.onchange = () => { view.csort = cs.value; render(); };
  const cq = $('#cq'); if (cq) cq.oninput = () => { view.cq = cq.value; view.cmore = 60; const pos = cq.selectionStart; render(); const n = $('#cq'); n.focus(); n.setSelectionRange(pos, pos); };
  const gf = $('#gf'); if (gf) gf.oninput = e => { view.g[e.target.name] = e.target.value; const nm = e.target.name, pos = e.target.selectionStart; render(); const n = $('#gf')[nm]; n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} };
  const go2 = $('#csvgo'); if (go2) go2.onclick = () => { const fl = $('#csvfile').files[0]; if (fl){ const fr = new FileReader(); fr.onload = () => doImport(fr.result); fr.readAsText(fl); } else if ($('#csvtext').value.trim()) doImport($('#csvtext').value); else toast('Pick a CSV file or paste the text'); };
  const us = $('#usesample'); if (us) us.onclick = () => { S.cards = SAMPLE_CARDS.map(c => ({ ...c })); S.sampleCards = true; save(); render(); toast('Sample collection back'); };
  const ex = $('#exp'); if (ex) ex.onclick = () => { view.exp = !view.exp; view.rest = false; render(); };
  const rs = $('#restore'); if (rs) rs.onclick = () => { view.rest = !view.rest; view.exp = false; render(); };
  const ce = $('#copyexp'); if (ce) ce.onclick = async () => { const ta = $('#expt'); try { await navigator.clipboard.writeText(ta.value); markBackup(); toast('Copied. Paste it somewhere safe, like Notes.'); } catch (e) { ta.select(); toast('Select all the text and copy it'); } };
  const se = $('#saveexp'); if (se) se.onclick = () => { const b = new Blob([JSON.stringify(S)], { type: 'application/json' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = `cappd-backup-${new Date().toISOString().slice(0, 10)}.json`; l.click(); markBackup(); render(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  const rg = $('#restgo'); if (rg) rg.onclick = () => { try { const d = JSON.parse($('#restt').value); if (!Array.isArray(d.cards) || !Array.isArray(d.reports)) throw 0; S = d; S.comps = S.comps || {}; S.invAdded = S.invAdded || {}; S.photos = S.photos || {}; view.rest = false; S.backupAt = Date.now(); save(true); render(); toast('Backup restored'); } catch (e) { toast('That is not a Cappd export'); } };
  const cl = $('#clear'); if (cl) cl.onclick = () => { if (cl.dataset.armed){ localStorage.removeItem(KEY); location.hash = ''; location.reload(); } else { cl.dataset.armed = 1; cl.textContent = 'Tap again'; } };
}

touchStreak();
const h0 = location.hash.slice(1); if (ROUTES.includes(h0)) view.tab = h0;
render();

// ---------- live data ----------
// news.json is refreshed by a GitHub Action every 6 hours, finds.json whenever a Card Finder issue changes.
async function refreshData(){
  const get = f => fetch(`data/${f}?t=${Math.floor(Date.now() / 3e5)}`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [n, f] = await Promise.all([get('news.json'), get('finds.json')]);
  let changed = false;
  if (n && Array.isArray(n.items) && n.pulled !== NEWS.pulled){ NEWS = n; changed = true; }
  if (f && Array.isArray(f.finds) && JSON.stringify(f) !== JSON.stringify(FINDS)){ FINDS = { finds: f.finds, penalties: f.penalties || {} }; sharedCache = null; changed = true; }
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (changed && !typing && view.tab !== 'me' && view.tab !== 'grade') render();
}
refreshData();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshData(); });
