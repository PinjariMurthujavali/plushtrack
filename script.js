/* PlushTrack — real YouTube stats via the official YouTube Data API v3 */
const $ = s => document.querySelector(s);
const API = 'https://www.googleapis.com/youtube/v3/';
const fmt = n => Number(n).toLocaleString('en-IN');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let current = null;      // {id, ...stats}
let demoMode = false;
let timer = null;

/* ---------- init ---------- */
$('#channelInput').value = store.get('pt_channel', '');
$('#apiKey').value = store.get('pt_key', '');
const goals = store.get('pt_goals', { subs: 1000, likes: 5000 });
$('#goalSubs').value = goals.subs;
$('#goalLikes').value = goals.likes;

$('#fetchBtn').onclick = () => run(false);
$('#demoBtn').onclick = () => run(true);
$('#refreshBtn').onclick = () => run(demoMode);
['goalSubs', 'goalLikes'].forEach(id => $('#' + id).addEventListener('input', () => {
  store.set('pt_goals', { subs: +$('#goalSubs').value || 1, likes: +$('#goalLikes').value || 1 });
  if (current) renderGoals(current);
}));
window.addEventListener('resize', () => current && drawChart());

/* ---------- 3D tilt ---------- */
document.addEventListener('mousemove', e => {
  document.querySelectorAll('.tilt').forEach(c => {
    const r = c.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); return;
    }
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    c.style.setProperty('--ry', (x * 8).toFixed(2) + 'deg');
    c.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
  });
});

/* ---------- helpers ---------- */
function say(text, type = '') { const m = $('#msg'); m.textContent = text; m.className = 'msg ' + type; }

function parseInput(raw) {
  const s = raw.trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i))) return { id: m[1] };
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if ((m = s.match(/youtube\.com\/@([\w.\-%]+)/i))) return { handle: '@' + decodeURIComponent(m[1]) };
  if ((m = s.match(/youtube\.com\/user\/([\w.\-]+)/i))) return { username: m[1] };
  if ((m = s.match(/youtube\.com\/c\/([\w.\-%]+)/i))) return { search: decodeURIComponent(m[1]) };
  if (s.startsWith('@')) return { handle: s };
  return { search: s };
}

async function api(path, params, key) {
  const url = API + path + '?' + new URLSearchParams({ ...params, key });
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'API error ' + res.status);
  return data;
}

async function fetchChannel(ref, key) {
  const base = { part: 'snippet,statistics,contentDetails' };
  let data;
  if (ref.id) data = await api('channels', { ...base, id: ref.id }, key);
  else if (ref.handle) data = await api('channels', { ...base, forHandle: ref.handle }, key);
  else if (ref.username) data = await api('channels', { ...base, forUsername: ref.username }, key);
  else {
    const s = await api('search', { part: 'snippet', type: 'channel', maxResults: 1, q: ref.search }, key);
    const id = s.items?.[0]?.snippet?.channelId || s.items?.[0]?.id?.channelId;
    if (!id) throw new Error('Channel not found');
    data = await api('channels', { ...base, id }, key);
  }
  const ch = data.items?.[0];
  if (!ch) throw new Error('Channel not found — check the link / handle');

  // likes = sum of likes on the latest 50 uploads
  let likes = 0;
  try {
    const up = ch.contentDetails.relatedPlaylists.uploads;
    const pl = await api('playlistItems', { part: 'contentDetails', playlistId: up, maxResults: 50 }, key);
    const ids = pl.items.map(i => i.contentDetails.videoId).join(',');
    if (ids) {
      const v = await api('videos', { part: 'statistics', id: ids }, key);
      likes = v.items.reduce((a, x) => a + (+x.statistics.likeCount || 0), 0);
    }
  } catch (e) { console.warn('Likes fetch skipped:', e.message); }

  const st = ch.statistics;
  return {
    id: ch.id,
    title: ch.snippet.title,
    handle: ch.snippet.customUrl || '',
    avatar: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url,
    created: ch.snippet.publishedAt,
    subs: +st.subscriberCount || 0,
    hidden: !!st.hiddenSubscriberCount,
    views: +st.viewCount || 0,
    videos: +st.videoCount || 0,
    likes
  };
}

function demoChannel() {
  const base = Date.now();
  const d = {
    id: 'DEMO', title: 'Demo Channel', handle: '@demo-channel',
    avatar: 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='#c9b0ff'/><text x='60' y='80' font-size='64' text-anchor='middle'>🧶</text></svg>"),
    created: new Date(base - 400 * 864e5).toISOString(),
    subs: 742, views: 38210, videos: 36, likes: 2890, hidden: false
  };
  // fake history for the preview only
  const hist = [];
  for (let i = 14; i >= 0; i--) hist.push({ t: base - i * 864e5, subs: Math.round(742 - i * 9 - Math.sin(i) * 3), views: 38210 - i * 210, likes: 2890 - i * 22 });
  store.set('pt_hist_DEMO', hist);
  return d;
}

/* ---------- history ---------- */
function history(id) { return store.get('pt_hist_' + id, []); }
function saveSnapshot(c) {
  const h = history(c.id), now = Date.now();
  const snap = { t: now, subs: c.subs, views: c.views, likes: c.likes };
  const last = h[h.length - 1];
  if (last && new Date(last.t).toDateString() === new Date(now).toDateString()) h[h.length - 1] = snap;
  else h.push(snap);
  store.set('pt_hist_' + c.id, h.slice(-365));
}

/* ---------- main run ---------- */
async function run(demo) {
  demoMode = demo;
  const btn = $('#fetchBtn'); btn.disabled = true;
  try {
    let c;
    if (demo) { c = demoChannel(); }
    else {
      const key = $('#apiKey').value.trim();
      const ref = parseInput($('#channelInput').value);
      if (!ref) throw new Error('Channel link or @handle ivvu bro');
      if (!key) throw new Error('API key paste cheyyi (free ga Google Cloud lo vasthundi)');
      say('Fetching real stats…');
      const prev = current && current.id !== 'DEMO' ? current : null;
      c = await fetchChannel(ref, key);
      store.set('pt_channel', $('#channelInput').value.trim());
      store.set('pt_key', key);
      saveSnapshot(c);
    }
    const before = current && current.id === c.id ? current : null;
    c.prev = before ? { subs: before.subs, views: before.views, likes: before.likes } : null;
    current = c;
    render(c);
    say(demo ? '' : 'Done! Live data loaded ✔', 'ok');
    clearInterval(timer);
    if (!demo) timer = setInterval(() => run(false), 5 * 60 * 1000); // auto-refresh every 5 min
  } catch (e) {
    say('⚠ ' + e.message, 'err');
  } finally { btn.disabled = false; }
}

/* ---------- render ---------- */
function countUp(el, to) {
  const from = +el.dataset.v || 0; el.dataset.v = to;
  const t0 = performance.now(), dur = 1200;
  (function step(t) {
    const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

function delta(el, now, prev) {
  if (prev == null) { el.textContent = ''; return; }
  const d = now - prev;
  el.textContent = d === 0 ? 'no change since last refresh' : (d > 0 ? '▲ +' : '▼ ') + fmt(d) + ' since last refresh';
}

function render(c) {
  $('#dash').hidden = false;
  $('#demoBanner').hidden = !demoMode;
  $('#avatar').src = c.avatar;
  $('#chTitle').textContent = c.title;
  $('#chHandle').textContent = c.handle;
  $('#chMeta').textContent = `${fmt(c.videos)} videos · since ${new Date(c.created).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  if (c.hidden) $('#sSubs').textContent = 'Hidden'; else countUp($('#sSubs'), c.subs);
  countUp($('#sViews'), c.views);
  countUp($('#sLikes'), c.likes);
  delta($('#sSubsDelta'), c.subs, c.prev?.subs);
  delta($('#sViewsDelta'), c.views, c.prev?.views);
  delta($('#sLikesDelta'), c.likes, c.prev?.likes);
  renderGoals(c);
  renderEta(c);
  renderBadges(c);
  drawChart();
  if (!document.body.dataset.scrolled) { $('#dash').scrollIntoView({ behavior: 'smooth' }); document.body.dataset.scrolled = 1; }
}

function renderGoals(c) {
  const g = { subs: +$('#goalSubs').value || 1, likes: +$('#goalLikes').value || 1 };
  const ps = Math.min(100, c.subs / g.subs * 100), pl = Math.min(100, c.likes / g.likes * 100);
  requestAnimationFrame(() => {
    $('#barSubs').style.width = ps + '%'; $('#barLikes').style.width = pl + '%';
  });
  $('#pctSubs').textContent = ps.toFixed(1) + '%';
  $('#pctLikes').textContent = pl.toFixed(1) + '%';
  $('#leftSubs').textContent = c.subs >= g.subs ? '🎉 Goal reached!' : `${fmt(g.subs - c.subs)} more subscribers to go`;
  $('#leftLikes').textContent = c.likes >= g.likes ? '🎉 Goal reached!' : `${fmt(g.likes - c.likes)} more likes to go`;
}

function rate(c) {
  // subs per day: from saved snapshots if ≥1 day span, else lifetime average
  const h = history(c.id);
  if (h.length >= 2) {
    const a = h[0], b = h[h.length - 1], days = (b.t - a.t) / 864e5;
    if (days >= 1) return { r: (b.subs - a.subs) / days, basis: `based on your last ${days.toFixed(0)} day(s) of saved snapshots` };
  }
  const days = Math.max(1, (Date.now() - new Date(c.created)) / 864e5);
  return { r: c.subs / days, basis: 'based on lifetime average (needs a few days of snapshots for a sharper estimate)' };
}

function renderEta(c) {
  const g = +$('#goalSubs').value || 1, { r, basis } = rate(c);
  const nextHundred = (Math.floor(c.subs / 100) + 1) * 100;
  if (c.hidden) { $('#etaBig').textContent = '—'; $('#etaNote').textContent = 'This channel hides its subscriber count.'; return; }
  if (r <= 0) { $('#etaBig').textContent = 'Growing soon'; $('#etaNote').textContent = 'No positive growth detected yet — keep uploading!'; return; }
  const d100 = Math.ceil((nextHundred - c.subs) / r), dGoal = Math.ceil((g - c.subs) / r);
  $('#etaBig').textContent = `~${fmt(Math.max(d100, 1))} days`;
  $('#etaNote').innerHTML = `to reach <b>${fmt(nextHundred)}</b> subs at <b>${r.toFixed(2)}</b> subs/day.<br>` +
    (c.subs >= g ? 'Your goal is already done 🎉' : `Your goal of ${fmt(g)} → about <b>${fmt(dGoal)} days</b>.`) + `<br><small>Estimate ${basis}.</small>`;
}

function renderBadges(c) {
  const marks = [[100, '100'], [500, '500'], [1000, '1K'], [5000, '5K'], [10000, '10K'], [50000, '50K'], [100000, '100K'], [1000000, '1M']];
  $('#badges').innerHTML = marks.map(([n, l], i) =>
    `<div class="badge ${c.subs >= n ? 'on' : 'off'}" style="animation-delay:${i * 80}ms">${c.subs >= n ? '⭐' : '🔒'}<br>${l}</div>`).join('');
}

/* ---------- real watch time (YouTube Analytics API, owner sign-in) ---------- */
$('#clientId').value = store.get('pt_cid', '');
$('#wtBtn').onclick = () => {
  const cid = $('#clientId').value.trim(), m = $('#wtMsg');
  if (!cid) { m.textContent = 'Setup card lo Google OAuth Client ID paste cheyyi (steps kinda undi).'; return; }
  if (!window.google?.accounts?.oauth2) { m.textContent = 'Google sign-in script load avvaledu. Page refresh chesi malli try cheyyi.'; return; }
  store.set('pt_cid', cid);
  google.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: 'https://www.googleapis.com/auth/yt-analytics.readonly',
    callback: r => {
      if (r.error) { m.textContent = '⚠ Sign-in failed: ' + r.error; return; }
      loadWatch(r.access_token).catch(e => { m.textContent = '⚠ ' + e.message; });
    }
  }).requestAccessToken();
};

async function loadWatch(token) {
  const f = d => d.toISOString().slice(0, 10);
  const p = new URLSearchParams({
    ids: 'channel==MINE', startDate: f(new Date(Date.now() - 27 * 864e5)), endDate: f(new Date()),
    metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage', dimensions: 'day', sort: 'day'
  });
  const res = await fetch('https://youtubeanalytics.googleapis.com/v2/reports?' + p, { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Analytics API error (enable "YouTube Analytics API" in Google Cloud)');
  const rows = data.rows || [];
  if (!rows.length) { $('#wtMsg').textContent = 'No watch-time data yet for the last 28 days.'; return; }
  const mins = rows.reduce((a, r) => a + r[1], 0);
  const active = rows.filter(r => r[2] > 0);
  const avgSec = active.length ? active.reduce((a, r) => a + r[2], 0) / active.length : 0;
  const avgPct = active.length ? active.reduce((a, r) => a + r[3], 0) / active.length : 0;
  $('#wtStats').hidden = false; $('#wtChart').hidden = false;
  $('#wtHours').textContent = fmt((mins / 60).toFixed(1));
  $('#wtAvg').textContent = Math.floor(avgSec / 60) + 'm ' + String(Math.round(avgSec % 60)).padStart(2, '0') + 's';
  $('#wtPct').textContent = avgPct.toFixed(1) + '%';
  $('#wtMsg').textContent = 'Connected ✔ real data from YouTube Analytics';
  $('#wtNote').textContent = 'Latest 2–3 days can be incomplete (YouTube processes analytics with a delay). Daily bars below = hours watched.';
  drawWatch(rows);
}

function drawWatch(rows) {
  const cv = $('#wtChart'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = 200;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, w, h);
  const vals = rows.map(r => r[1] / 60), max = Math.max(...vals, 0.1), bw = (w - 20) / vals.length;
  vals.forEach((v, i) => {
    const bh = v / max * (h - 40), bx = 10 + i * bw + 2;
    x.fillStyle = '#8a63e8'; x.beginPath(); x.roundRect(bx, h - 24 - bh, bw - 4, Math.max(bh, 3), 6); x.fill();
  });
  x.fillStyle = '#4a3350'; x.font = '700 12px Nunito'; x.textAlign = 'left';
  x.fillText(rows[0][0], 10, h - 6); x.textAlign = 'right'; x.fillText(rows[rows.length - 1][0], w - 10, h - 6);
}

/* ---------- chart ---------- */
function drawChart() {
  const cv = $('#chart'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 260;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, w, h);
  const data = history(current.id);
  if (data.length < 2) {
    x.fillStyle = '#4a3350'; x.font = '700 16px Nunito'; x.textAlign = 'center';
    x.fillText('Chart appears after 2+ snapshots — visit again tomorrow 🧶', w / 2, h / 2);
    $('#chartNote').textContent = 'Each day you open the tracker, one real snapshot is saved in this browser.';
    return;
  }
  const pad = { l: 56, r: 20, t: 20, b: 34 };
  const min = Math.min(...data.map(d => d.subs)), max = Math.max(...data.map(d => d.subs));
  const lo = min - (max - min || 1) * .15, hi = max + (max - min || 1) * .15;
  const X = i => pad.l + i / (data.length - 1) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v - lo) / (hi - lo) * (h - pad.t - pad.b);
  x.strokeStyle = 'rgba(74,51,80,.15)'; x.fillStyle = '#4a3350'; x.font = '700 12px Nunito'; x.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    x.beginPath(); x.setLineDash([5, 5]); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); x.setLineDash([]);
    x.fillText(fmt(Math.round(v)), pad.l - 8, y + 4);
  }
  const g = x.createLinearGradient(0, pad.t, 0, h - pad.b);
  g.addColorStop(0, 'rgba(255,122,114,.55)'); g.addColorStop(1, 'rgba(255,122,114,0)');
  x.beginPath(); data.forEach((d, i) => i ? x.lineTo(X(i), Y(d.subs)) : x.moveTo(X(i), Y(d.subs)));
  x.lineTo(X(data.length - 1), h - pad.b); x.lineTo(X(0), h - pad.b); x.fillStyle = g; x.fill();
  x.beginPath(); data.forEach((d, i) => i ? x.lineTo(X(i), Y(d.subs)) : x.moveTo(X(i), Y(d.subs)));
  x.strokeStyle = '#ff7a72'; x.lineWidth = 5; x.lineJoin = x.lineCap = 'round'; x.stroke();
  data.forEach((d, i) => { x.beginPath(); x.arc(X(i), Y(d.subs), 6, 0, 7); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#ff7a72'; x.stroke(); });
  x.fillStyle = '#4a3350'; x.textAlign = 'center';
  [0, data.length - 1].forEach(i => x.fillText(new Date(data[i].t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), X(i), h - 10));
  $('#chartNote').textContent = `${data.length} snapshots · ${demoMode ? 'demo history' : 'saved from your real visits'}`;
}
