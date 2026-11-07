const SETS = __SETS__;
const SEEN = __SEEN__;
const NEWS = __NEWS__;
const SAMPLE_CARDS = __SAMPLE_CARDS__;
const APP_VERSION = '0.1 (31 Oct 2026)';
const REPO = 'belipede/slabfolio-web';

// ---------- storage ----------
const KEY = 'slabfolio-web-v1';
function load(){ try{ return JSON.parse(localStorage.getItem(KEY)) || null }catch(e){ return null } }
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)) }catch(e){} }
let S = load() || { user:'ben', reports:[], mod:true, monthsEarned:{}, sampleLoaded:false };
if (!S.cards){ S.cards = SAMPLE_CARDS.map(c => ({ ...c })); S.sampleCards = true; }
S.comps = S.comps || {}; S.invAdded = S.invAdded || {};

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
const allReports = () => seenReports().concat(S.reports);

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
  return S.reports.filter(r => r.user === u && r.status === 'verified' && r.firstVerified).reduce((a, r) => a + r.points, 0)
       - S.reports.filter(r => r.user === u && r.status === 'rejected' && r.fake).length * 50;
}

// ---------- state / routing ----------
let view = { tab: 'home', cq: '', cseg: 'owned', cf: '', csort: 'value', cmore: 60, set: null, grp: 0, par: 0, q: '', filter: 'all', news: 'football', np: '' };
const ROUTES = ['home','cards','hunt','news','feed','review','me','scan','grade'];
const NAV_OF = { feed: 'hunt', review: 'hunt', scan: 'hunt', grade: 'me' };
function go(tab){ closeSheet(); view.tab = tab; if (tab !== 'hunt') view.set = null; location.hash = tab; render(); window.scrollTo(0,0); }
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== view.tab && ROUTES.includes(h)){ view.tab = h; view.set = null; render(); } });
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));

function render(){
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (NAV_OF[view.tab] || view.tab)));
  const a = $('#app');
  if (view.tab === 'home') a.innerHTML = renderDash();
  else if (view.tab === 'cards') a.innerHTML = renderCards();
  else if (view.tab === 'grade') a.innerHTML = renderGrade();
  else if (view.tab === 'hunt') a.innerHTML = view.set ? renderSet() : renderHunt();
  else if (view.tab === 'feed') a.innerHTML = renderFeed();
  else if (view.tab === 'news') a.innerHTML = renderNews();
  else if (view.tab === 'scan') a.innerHTML = renderScan();
  else if (view.tab === 'review') a.innerHTML = renderReview();
  else a.innerHTML = renderMe();
  bind();
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
function progHtml(t, label, noOnes){
  return `<div class="prog"><div class="pl"><span>${label}</span><b>${t.found.toLocaleString()} of ${t.slots.toLocaleString()} · ${pctTxt(t.found, t.slots)}</b></div>${sbar(t, t.slots)}
  ${t.ones && !noOnes ? `<div class="pl" style="margin-top:8px"><span>1/1s found</span><b>${t.onesF} of ${t.ones} · ${pctTxt(t.onesF, t.ones)}</b></div><div class="sbar"><i style="width:${t.onesF ? Math.max(.8, pct(t.onesF, t.ones)).toFixed(2) : 0}%;background:var(--accent)"></i></div>` : ''}</div>`;
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
  const t = r.status === 'verified' ? 'Verified' : r.status === 'pending' ? 'Reported, waiting for review' : 'Seen for sale on eBay';
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
    S.reports.push(r); save(); closeSheet(); render();
    toast(r.status === 'verified' ? 'Verified by cert check (simulated)' : r.dupOf ? 'Reported. Someone already reported this copy, so a moderator will compare both.' : 'Reported. It shows as pending until reviewed.');
  };
}
function shrink(file){
  return new Promise(res => { if (!file) return res(''); const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => {
    const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .7)); }; img.src = fr.result; }; fr.readAsDataURL(file); });
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
  const evName = r.seen ? 'Found by searching eBay' : { graded: 'Graded slab (cert on file, hidden)', listing: 'Listing link', photo: 'Photos with code ' + r.code, video: 'Break video', inventory: 'From my collection (needs photos or a slab before it can be verified)' }[r.ev];
  let h = `<h2>${esc(c[1])} ${r.run === 1 ? '1/1' : (r.serial || '?') + '/' + r.run}</h2>
  <div class="sub">${esc(short(s.name))} · ${esc(g.n)} · ${esc(r.par)} · ${esc(cardNo(g, c[0]))}</div>
  <div style="margin-top:12px">${badge(r)} ${r.sample ? '<span class="badge b-s">SAMPLE</span>' : ''}</div>
  <div class="item" style="margin-top:12px"><div class="m">${r.seen ? 'Added from an eBay search on 31 Oct' : `Reported by ${esc(shownUser(r))} on ${fmtDate(r.t)}`}</div>
  <div class="m">Proof: ${esc(evName)}</div>
  ${r.link ? `<div class="m"><a href="${esc(r.link)}" target="_blank" rel="noopener">Open ${r.seen ? 'eBay page' : 'link'}</a></div>` : ''}
  ${r.note ? `<div class="m">${r.seen ? esc(r.note) : '“' + esc(r.note) + '”'}</div>` : ''}
  ${r.seen ? `<div class="m">A listing shows the card exists. It still needs a moderator check before it counts as verified.</div>` : ''}
  ${r.autoNote ? `<div class="m">${esc(r.autoNote)}</div>` : ''}
  ${r.dupOf ? `<div class="m" style="color:var(--pend)">Another report already exists for this copy</div>` : ''}
  ${r.status === 'verified' ? `<div class="m">${r.firstVerified ? `First verified report · +${r.points} points` : 'Already verified earlier, no points'}</div>` : ''}
  ${r.photo ? `<img class="thumb" src="${r.photo}">` : ''}</div>`;
  if (S.mod && r.status === 'pending') h += `<div class="btns"><button class="btn" data-v="${r.id}">Verify</button><button class="btn ghost" data-x="${r.id}">Reject</button></div><button class="btn red" data-f="${r.id}">Reject as fake (−50 points)</button>`;
  if (r.seen) h += `<button class="btn ghost" data-own="${r.id}">I own this card, report it</button>`;
  openSheet(h);
  const own = $('#sheet [data-own]'); if (own) own.onclick = () => openReport({ set: r.set, grp: r.grp, card: r.card, par: r.par, serial: r.serial || 1 });
}
function badge(r){ return r.status === 'verified' ? `<span class="badge b-v">VERIFIED${r.auto ? ' · CERT' : ''}</span>` : r.status === 'pending' ? '<span class="badge b-p">PENDING</span>' : r.status === 'seen' ? '<span class="badge b-o">SEEN ON EBAY</span>' : `<span class="badge b-r">${r.fake ? 'FAKE' : 'REJECTED'}</span>`; }
function itemHtml(r){
  const s = setById(r.set), g = grpOf(s, r.grp), c = cardOf(g, r.card);
  return `<div class="item" data-detail="${r.id}"><div class="t">${esc(c[1])} · ${esc(r.par)} ${r.run === 1 ? '1/1' : (r.serial || '?') + '/' + r.run}</div>
  <div class="m">${esc(short(s.name))} · ${esc(g.n)} · ${esc(shownUser(r))}${r.seen ? '' : ' · ' + fmtDate(r.t)}</div><div style="margin-top:6px">${badge(r)} ${r.sample ? '<span class="badge b-s">SAMPLE</span>' : ''}</div></div>`;
}

// ---------- feed / review / me ----------
function finderTop(){
  const n = S.reports.filter(r => r.status === 'pending').length;
  return `<header class="top"><h1>Card Finder</h1><button class="mini acc" data-act="report">+ Report a pull</button></header>
  <div class="seg wide" style="margin-bottom:12px">${[['hunt','Sets'],['feed','Latest finds'],['review','Review' + (n ? ' (' + n + ')' : '')]].map(([k, l]) => `<button data-go="${k}" class="${view.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function renderFeed(){
  const list = allReports().sort((a, b) => b.t - a.t);
  return finderTop() + list.map(itemHtml).join('');
}
function renderReview(){
  const list = S.reports.filter(r => r.status === 'pending').sort((a, b) => a.t - b.t);
  return finderTop() + `
  ${S.mod ? '' : `<div class="banner">Turn on Moderator mode in Me to verify or reject reports.</div>`}
  <div class="sub" style="margin-bottom:10px">Graded cards with a cert number skip this queue. Everything else waits here for a check.</div>` +
  (list.length ? list.map(itemHtml).join('') : `<div class="empty">Nothing waiting for review.</div>`);
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
function renderNews(){
  const sub = view.news;
  let h = `<header class="top"><h1>News</h1></header>
  <div class="seg wide">${[['football','Football news'],['cards','Card news']].map(([k, n]) => `<button data-news="${k}" class="${sub === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (sub === 'football'){
    const mine = new Set(S.cards.filter(c => c.status !== 'Sold').map(c => norm(c.player)));
    const players = [...new Set(NEWS.football.map(n => n.p))].sort((x, y) => mine.has(norm(y)) - mine.has(norm(x)));
    const list = NEWS.football.filter(n => !view.np || n.p === view.np);
    h += `<div class="sub" style="margin:12px 0 6px">Players · ★ = in your collection</div>
    <div class="pills"><button class="pill ${view.np ? '' : 'on'}" data-np="">All</button>${players.map(x => `<button class="pill ${view.np === x ? 'on' : ''}" data-np="${esc(x)}">${mine.has(norm(x)) ? '★ ' : ''}${esc(x)}</button>`).join('')}</div>` +
    list.map(n => `<a class="item news" href="${esc(n.u)}" target="_blank" rel="noopener"><span class="chip">${esc(n.p)}</span><div class="t">${esc(n.t)}</div><div class="m">${esc(n.s)}${n.d ? ' · ' + esc(n.d) : ''} ↗</div></a>`).join('');
  } else {
    h += `<div class="sub" style="margin:12px 0 6px">Releases and checklists</div>` +
    NEWS.cards.map(n => `<a class="item news" href="${esc(n.u)}" target="_blank" rel="noopener"><span class="chip c">${esc(n.tag)}</span><div class="t">${esc(n.t)}</div><div class="m">${esc(n.s)} ↗</div></a>`).join('') +
    `<div class="sub" style="margin:16px 0 6px">Notable listings in your tracked sets</div>` + seenReports().map(itemHtml).join('');
  }
  return h + `<p class="sub">Headlines link to the publisher; Slabfolio never copies the article. Pulled ${esc(NEWS.pulled)} for this test. The real app would refresh these from a news feed and follow every player in your collection automatically.</p>`;
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
  if (l) return { v: l.p, kind: 'sold', src: `Sale you logged (${l.s}${l.d ? ', ' + l.d : ''})` };
  if (money(c.comp) !== null) return { v: money(c.comp), kind: 'sold', src: 'Comp price from your sheet' + (c.compDate ? ` (${c.compDate})` : '') };
  if (money(c.ask) !== null) return { v: money(c.ask), kind: 'own', src: 'Your asking price, no sale logged yet' };
  return { v: null, kind: 'none', src: 'No value yet' };
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

// ---------- home ----------
function renderDash(){
  const t = totals(), own = S.cards.filter(owned), diff = t.value - t.paid;
  const moves = own.filter(c => val(c).kind === 'sold' && money(c.cost) !== null).map(c => ({ c, d: val(c).v - money(c.cost) })).sort((a, b) => b.d - a.d);
  const sold = S.cards.filter(c => !owned(c) && c.soldDate).sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 3);
  const scan = invRows().filter(r => matchInv(r[1], r[2], r[3], r[4]).out && !S.invAdded[r[0]]).length;
  const mine = new Set(own.map(c => norm(c.player))), news = NEWS.football.filter(n => mine.has(norm(n.p))).slice(0, 2);
  const tb = Object.values(t.tones).reduce((a, b) => a + b, 0) || 1;
  const row = (c, right) => `<div class="crow" data-c="${esc(c.id)}"><div class="l"><div class="pl">${esc(c.player)}</div><div class="ds">${esc(cardLine(c))}</div></div><div class="r">${right}</div></div>`;
  return `<header class="top"><h1>Slabfolio</h1><button class="mini" data-act="bug">Report a bug</button></header>
  ${S.sampleCards ? `<div class="banner">You're looking at a <b>sample collection</b> with made-up prices. Import your Cards v2 sheet from <b>Me</b> to see your own.</div>` : ''}
  <div class="prof"><div class="sub">Collection value</div><div class="big">${sgd(t.value)}</div>
  <div class="sub">${t.n} cards you own · paid ${sgd(t.paid)} · <span class="${diff > 5 ? 'g' : diff < -5 ? 'rd' : 'o'}">${diff >= 0 ? '+' : ''}${sgd(diff)}</span></div>
  <div class="sbar" style="height:10px;margin-top:12px">${['g', 'o', 'rd', 'pu', 'nt'].map(k => `<i style="width:${pct(t.tones[k], tb)}%;background:${{ g: 'var(--ok)', o: 'var(--pend)', rd: 'var(--bad)', pu: '#b18cff', nt: 'var(--line)' }[k]}"></i>`).join('')}</div>
  <div class="legend2"><span style="--c:var(--ok)">${t.tones.g} up</span><span style="--c:var(--pend)">${t.tones.o} flat</span><span style="--c:var(--bad)">${t.tones.rd} down</span><span style="--c:#b18cff">${t.tones.pu} your value</span>${t.tones.nt ? `<span style="--c:var(--line)">${t.tones.nt} no price</span>` : ''}</div>
  <div class="kpis"><div><b>${sgd(t.spent)}</b><span>spent</span></div><div><b>${sgd(t.got)}</b><span>received</span></div><div><b class="${t.got - t.spent >= 0 ? 'g' : 'rd'}">${sgd(t.got - t.spent)}</b><span>net cash</span></div></div></div>
  ${t.needs ? `<div class="item" data-go="cards" data-cf="needs" style="cursor:pointer"><div class="t">${t.needs} ${t.needs === 1 ? 'hit needs' : 'hits need'} a comp</div><div class="m">They show your own value in purple until you log a real sale. Tap to see them.</div></div>` : ''}
  ${moves.length ? `<div class="sec">Biggest gains</div>${moves.slice(0, 3).filter(m => m.d > 0).map(m => row(m.c, `<b class="g">+${sgd(m.d)}</b><span>${sgd(val(m.c).v)}</span>`)).join('') || '<div class="sub">None yet.</div>'}
  <div class="sec">Biggest drops</div>${moves.slice(-3).reverse().filter(m => m.d < 0).map(m => row(m.c, `<b class="rd">${sgd(m.d)}</b><span>${sgd(val(m.c).v)}</span>`)).join('') || '<div class="sub">None yet.</div>'}` : ''}
  ${sold.length ? `<div class="sec">Latest sales</div>${sold.map(c => { const p = profitSold(c); return row(c, `<b>${sgd(money(c.sold))}</b><span class="${p >= 0 ? 'g' : 'rd'}">${p >= 0 ? '+' : ''}${sgd(p)}</span>`); }).join('')}` : ''}
  <div class="sec">Card Finder</div>
  <div class="item" data-go="${scan ? 'scan' : 'hunt'}" style="cursor:pointer"><div class="t">${scan ? `${scan} of your cards can go on the pull registry` : 'Browse the pull registry'}</div><div class="m">6 sets tracked · ${allReports().filter(r => r.status !== 'rejected').length} copies found so far</div></div>
  ${news.length ? `<div class="sec">News about your players</div>${news.map(n => `<a class="item news" href="${esc(n.u)}" target="_blank" rel="noopener"><span class="chip">${esc(n.p)}</span><div class="t">${esc(n.t)}</div><div class="m">${esc(n.s)} ↗</div></a>`).join('')}<button class="btn ghost" data-go="news" style="margin-top:4px">All news</button>` : ''}`;
}

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
  const list = cardsList();
  let h = `<header class="top"><h1>Collection</h1><button class="mini acc" data-act="addcard">+ Add card</button></header>
  <div class="row"><input class="search" id="cq" placeholder="Search player, set or ID" value="${esc(view.cq)}">
  <div class="seg">${[['owned', 'Owned'], ['sold', 'Sold'], ['all', 'All']].map(([k, n]) => `<button data-cseg="${k}" class="${view.cseg === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
  <div class="pills">${CFILTERS.map(([k, n]) => `<button class="pill ${view.cf === k ? 'on' : ''}" data-cf="${k}">${n}</button>`).join('')}</div>
  <div class="row" style="align-items:center"><span class="sub" style="flex:1">${list.length} cards${S.sampleCards ? ' · sample collection' : ''}</span>
  <select class="mini" id="csort">${[['value', 'Value, high to low'], ['low', 'Value, low to high'], ['profit', 'Profit'], ['id', 'Newest']].map(([k, n]) => `<option value="${k}" ${view.csort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  for (const c of list.slice(0, view.cmore)){
    let right;
    if (owned(c)){ const x = val(c); right = `<b class="${tone(c)}">${sgd(x.v)}</b><span>${esc(c.status)}${money(c.cost) !== null ? ' · paid ' + sgd(money(c.cost)) : ''}</span>`; }
    else { const p = profitSold(c); right = `<b>${sgd(money(c.sold))}</b><span class="${p === null ? '' : p >= 0 ? 'g' : 'rd'}">${p === null ? 'Sold' : (p >= 0 ? '+' : '') + sgd(p)}</span>`; }
    h += `<div class="crow" data-c="${esc(c.id)}"><div class="l"><div class="pl">${esc(c.player)}</div><div class="ds">${esc(cardLine(c))}</div>
    <div style="margin-top:3px">${cardTags(c).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div></div><div class="r">${right}</div></div>`;
  }
  if (list.length > view.cmore) h += `<button class="btn ghost" data-act="more">Show ${Math.min(60, list.length - view.cmore)} more</button>`;
  if (!list.length) h += `<div class="empty">No cards match.</div>`;
  return h + `<p class="sub">Green = worth over S$5 more than you paid, orange = within S$5, red = down S$5 or more, purple = your own value until a sale is logged. Asking prices never count as sales.</p>`;
}

// ---------- card detail ----------
const ebaySold = c => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(c.search || [c.player, c.line, c.desc, c.run ? '/' + c.run : ''].join(' ')) + '&LH_Sold=1&LH_Complete=1';
function openC(id, mode){
  const c = S.cards.find(x => x.id === id); if (!c) return;
  const x = val(c), cost = money(c.cost), comps = compsOf(c), m = matchInv(c.line, c.desc, c.player, c.serial);
  const dl = (k, v) => v === null || v === undefined || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  let h = `<h2>${esc(c.player)}</h2><div class="sub">${esc(cardLine(c))}${c.id && !/^S\d/.test(c.id) ? ' · ' + esc(c.id) : ''}</div>
  <div style="margin-top:8px">${cardTags(c).map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(c.status)}</span></div>
  <dl class="kv">${owned(c) ? dl('Value', `<b class="${tone(c)}">${sgd(x.v)}</b>`) + dl('Based on', `<span class="sub">${esc(x.src)}</span>`) : dl('Sold for', sgd(money(c.sold))) + dl('Sold', esc([c.soldDate, c.channel].filter(Boolean).join(' · ')))}
  ${dl('Paid', cost === null ? null : sgd(cost))}${owned(c) && x.v !== null && cost !== null ? dl('Up / down', `<span class="${tone(c)}">${x.v - cost >= 0 ? '+' : ''}${sgd(x.v - cost)}</span>`) : ''}
  ${!owned(c) && profitSold(c) !== null ? dl('Profit', `<span class="${profitSold(c) >= 0 ? 'g' : 'rd'}">${sgd(profitSold(c))}</span>`) : ''}
  ${dl('Asking', money(c.ask) === null ? null : sgd(money(c.ask)))}${dl('Grading', c.stage && c.stage !== 'Raw' ? esc(c.stage) : null)}</dl>
  <div class="links"><a href="${ebaySold(c)}" target="_blank" rel="noopener">eBay sold ↗</a><a href="https://130point.com/sales/" target="_blank" rel="noopener">130point ↗</a></div>`;
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
    h += `<label class="f">Carousell listing text</label><textarea class="inp" id="caro" style="min-height:120px">${esc(txt)}</textarea><button class="btn" data-copy>Copy text</button><div class="hint">Paste it into Carousell with your photos. Slabfolio never posts for you.</div>`; }
  else {
    h += owned(c) ? `<div class="btns"><button class="btn ghost" data-mode="sale">Add a sale you saw</button><button class="btn ghost" data-mode="sold">Mark sold</button></div>
    <div class="btns"><button class="btn ghost" data-mode="edit" style="margin-top:8px">Edit</button><button class="btn ghost" data-mode="caro" style="margin-top:8px">Sell on Carousell</button></div>` : `<button class="btn ghost" data-mode="edit">Edit</button>`;
    if (owned(c) && m.out) h += `<button class="btn" data-act="toscan">This card is on the pull registry · report it</button>`;
  }
  openSheet(h);
  const sh = $('#sheet');
  sh.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => openC(id, el.dataset.mode));
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
  channel: ['channel'], comp: ['comp price'], compDate: ['comp date'], search: ['comp search'], notes: ['notes'] };
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
  S.cards = cards; S.sampleCards = false; S.invAdded = {}; save(); render();
  toast(`Imported ${cards.length} cards · ${cards.filter(owned).length} owned`);
}

// ---------- me ----------
function renderMe(){
  const pts = userPoints(S.user), mine = S.reports.filter(r => r.user === S.user);
  const ym = new Date().toISOString().slice(0, 7), earned = S.monthsEarned[ym] || 0;
  return `<header class="top"><h1>Me</h1><button class="mini" data-act="bug">Report a bug</button></header>
  <div class="prof"><b>Your collection</b><div class="sub" style="margin-top:4px">${S.sampleCards ? 'Showing the sample collection.' : `${S.cards.length} cards imported, ${S.cards.filter(owned).length} owned.`} Everything stays on this phone.</div>
  <label class="f">Import your Cards v2 sheet</label>
  <div class="hint" style="margin-top:0">In the Google Sheets app, open the Inventory tab, then ⋮ › Share &amp; export › Save as › CSV. Pick that file here, or paste the CSV text below.</div>
  <input class="inp" id="csvfile" type="file" accept=".csv,.tsv,text/csv,text/plain" style="margin-top:8px">
  <textarea class="inp" id="csvtext" style="margin-top:8px" placeholder="…or paste CSV here"></textarea>
  <button class="btn" id="csvgo">Import</button>
  ${S.sampleCards ? '' : `<button class="btn ghost" id="usesample">Go back to the sample collection</button>`}</div>
  <div class="prof"><b>Back up</b><div class="sub" style="margin-top:4px">Your sales, reports and edits only live in this app. Export now and then and keep the copy in Notes or Files.</div>
  <div class="btns"><button class="btn ghost" id="exp">${view.exp ? 'Hide' : 'Export data'}</button><button class="btn ghost" id="restore">Restore</button></div>
  ${view.exp ? `<textarea class="inp" id="expt" readonly style="margin-top:8px">${esc(JSON.stringify(S))}</textarea><div class="btns"><button class="btn" id="copyexp">Copy</button><button class="btn ghost" id="saveexp">Save as file</button></div>` : ''}
  ${view.rest ? `<textarea class="inp" id="restt" style="margin-top:8px" placeholder="Paste an export here"></textarea><button class="btn" id="restgo">Restore this backup</button>` : ''}</div>
  <div class="prof"><b>Tools</b><button class="btn ghost" data-go="grade">Grading calculator</button><button class="btn ghost" data-go="scan">Scan my collection for the pull registry</button></div>
  <div class="prof"><b>Card Finder points</b>
  <div class="sub" style="margin-top:6px">Username</div><input class="inp" id="uname" value="${esc(S.user)}" style="margin-top:6px">
  <div style="display:flex;gap:20px;margin-top:14px"><div><div class="big">${pts}</div><div class="sub">points</div></div>
  <div><div class="big">${mine.filter(r => r.status === 'verified').length}</div><div class="sub">verified</div></div>
  <div><div class="big">${mine.filter(r => r.status === 'pending').length}</div><div class="sub">pending</div></div></div>
  <div class="bar" style="margin-top:14px"><i style="width:${Math.min(100, (pts % POINTS_PER_MONTH) / POINTS_PER_MONTH * 100)}%;background:var(--accent)"></i></div>
  <div class="sub" style="margin-top:6px">${earned ? 'Free month of Pro already earned this month (limit 1 a month).' : `${POINTS_PER_MONTH - (pts % POINTS_PER_MONTH)} points to a free month of Pro`}</div>
  ${pts >= POINTS_PER_MONTH && !earned ? `<button class="btn" id="claim">Claim free month of Pro</button>` : ''}
  <ul class="rules"><li>Only the first verified report of each numbered copy earns points.</li><li>1/1 = 100 · /5 or lower = 40 · /10 or lower = 20 · /25 or lower = 10</li>
  <li>${POINTS_PER_MONTH} points = 1 free month of Pro, at most 1 a month. A fake report costs 50 points.</li></ul></div>
  <div class="prof"><b>Testing</b>
  <div class="switch"><span>Moderator mode<br><span class="sub">Lets you verify reports while testing</span></span><button class="tog ${S.mod ? 'on' : ''}" id="mod"></button></div>
  <div class="switch"><span>Sample pull reports<br><span class="sub">Fills the registry with marked sample data</span></span><button class="pill" id="sample">${S.sampleLoaded ? 'Remove' : 'Load'}</button></div>
  <div class="switch"><span>Start over<br><span class="sub">Deletes everything in this app. Export first.</span></span><button class="pill" id="clear">Delete</button></div></div>
  <p class="sub">Slabfolio test build ${APP_VERSION}. Checklists from collectosk.com and cardsmithsbreaks.com. Not affiliated with Topps, Panini or the leagues. Values are estimates, not financial advice.</p>`;
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
  a.querySelectorAll('[data-graw]').forEach(el => el.onclick = () => { const c = S.cards.find(x => x.id === el.dataset.graw); view.g.raw = String(val(c).v ?? ''); render(); });
  const cs = $('#csort'); if (cs) cs.onchange = () => { view.csort = cs.value; render(); };
  const cq = $('#cq'); if (cq) cq.oninput = () => { view.cq = cq.value; view.cmore = 60; const pos = cq.selectionStart; render(); const n = $('#cq'); n.focus(); n.setSelectionRange(pos, pos); };
  const gf = $('#gf'); if (gf) gf.oninput = e => { view.g[e.target.name] = e.target.value; const nm = e.target.name, pos = e.target.selectionStart; render(); const n = $('#gf')[nm]; n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} };
  const go2 = $('#csvgo'); if (go2) go2.onclick = () => { const fl = $('#csvfile').files[0]; if (fl){ const fr = new FileReader(); fr.onload = () => doImport(fr.result); fr.readAsText(fl); } else if ($('#csvtext').value.trim()) doImport($('#csvtext').value); else toast('Pick a CSV file or paste the text'); };
  const us = $('#usesample'); if (us) us.onclick = () => { S.cards = SAMPLE_CARDS.map(c => ({ ...c })); S.sampleCards = true; save(); render(); toast('Sample collection back'); };
  const ex = $('#exp'); if (ex) ex.onclick = () => { view.exp = !view.exp; view.rest = false; render(); };
  const rs = $('#restore'); if (rs) rs.onclick = () => { view.rest = !view.rest; view.exp = false; render(); };
  const ce = $('#copyexp'); if (ce) ce.onclick = async () => { const ta = $('#expt'); try { await navigator.clipboard.writeText(ta.value); toast('Copied. Paste it somewhere safe, like Notes.'); } catch (e) { ta.select(); toast('Select all the text and copy it'); } };
  const se = $('#saveexp'); if (se) se.onclick = () => { const b = new Blob([JSON.stringify(S)], { type: 'application/json' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = `slabfolio-backup-${new Date().toISOString().slice(0, 10)}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  const rg = $('#restgo'); if (rg) rg.onclick = () => { try { const d = JSON.parse($('#restt').value); if (!Array.isArray(d.cards) || !Array.isArray(d.reports)) throw 0; S = d; S.comps = S.comps || {}; S.invAdded = S.invAdded || {}; view.rest = false; save(); render(); toast('Backup restored'); } catch (e) { toast('That is not a Slabfolio export'); } };
  const cl = $('#clear'); if (cl) cl.onclick = () => { if (cl.dataset.armed){ localStorage.removeItem(KEY); location.hash = ''; location.reload(); } else { cl.dataset.armed = 1; cl.textContent = 'Tap again'; } };
}

const h0 = location.hash.slice(1); if (ROUTES.includes(h0)) view.tab = h0;
render();
