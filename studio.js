/* PlushTrack Studio: generate (Veo-style API) + upload (YouTube Data API, OAuth) */
const S = { mode:'manual', fmt:'short', blob:null, meta:null, token:null, auto:null, busy:false };
const GEN = 'https://generativelanguage.googleapis.com/v1beta/';
const today = () => new Date().toDateString();
const cred = store.get('pt_cred', { day: today(), used: 0, made: 0 });
['genKey','genModel','imgModel','credTotal','credCost','perDay'].forEach(id => {
  const el = $('#'+id), v = store.get('pt_'+id, null); if (v !== null) el.value = v;
  el.addEventListener('input', () => { store.set('pt_'+id, el.value); drawCred(); });
});
const log = (t, bad) => { const d = document.createElement('div'); d.textContent = new Date().toLocaleTimeString()+'  '+t; if (bad) d.style.color='#b3261e'; $('#log').prepend(d); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ----- credits (reset at local midnight) ----- */
function rollDay(){ if (cred.day !== today()) { cred.day = today(); cred.used = 0; cred.made = 0; store.set('pt_cred', cred); } }
function drawCred(){
  rollDay(); const t = +$('#credTotal').value || 1;
  $('#credBar').style.width = Math.min(100, cred.used / t * 100) + '%';
  $('#credTxt').textContent = cred.used + ' / ' + t;
  const n = new Date(); const m = new Date(n.getFullYear(), n.getMonth(), n.getDate()+1);
  const h = Math.floor((m-n)/36e5), mi = Math.floor((m-n)%36e5/6e4);
  $('#credReset').textContent = `Reset ki ${h}h ${mi}m. Ee roju ${cred.made} videos.`;
}
setInterval(drawCred, 30000); drawCred();
const canSpend = () => (rollDay(), cred.used + (+$('#credCost').value||1) <= (+$('#credTotal').value||0));

/* ----- toggles ----- */
document.querySelectorAll('[data-mode],[data-fmt]').forEach(b => b.onclick = () => {
  const k = b.dataset.mode ? 'mode' : 'fmt'; S[k] = b.dataset.mode || b.dataset.fmt;
  document.querySelectorAll(b.dataset.mode ? '[data-mode]' : '[data-fmt]').forEach(x => x.classList.toggle('on', x === b));
  const auto = S.mode === 'auto';
  $('#autoRow').hidden = !auto; $('#autoBtn').hidden = !auto; $('#genBtn').hidden = auto; $('#upBtn').hidden = auto;
});

/* ----- AI helpers ----- */
async function gjson(path, body, key){
  const r = await fetch(GEN + path, { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message || r.status); return d;
}
async function channelVideos(){
  const key = $('#apiKey').value.trim(); if (!current || current.id==='DEMO' || !key) throw new Error('Mundu paina channel ni real API key tho Track cheyyi');
  const ch = await api('channels', { part:'contentDetails', id: current.id }, key);
  const pl = await api('playlistItems', { part:'contentDetails', playlistId: ch.items[0].contentDetails.relatedPlaylists.uploads, maxResults: 50 }, key);
  const ids = pl.items.map(i => i.contentDetails.videoId).join(',');
  const v = await api('videos', { part:'snippet,statistics,contentDetails', id: ids }, key);
  return v.items.map(x => ({ title:x.snippet.title, tags:(x.snippet.tags||[]).slice(0,6), date:x.snippet.publishedAt.slice(0,10), dur:x.contentDetails.duration,
    views:+x.statistics.viewCount||0, likes:+x.statistics.likeCount||0, comments:+x.statistics.commentCount||0 }));
}
const usedTopics = () => store.get('pt_used', []);
async function analyze(){
  const key = $('#genKey').value.trim(); if (!key) throw new Error('Video AI API key pettandi');
  log('🧠 Channel videos analyze chesthunna…');
  const vids = await channelVideos();
  const top = [...vids].sort((a,b)=>b.views-a.views);
  const ask = `You are a YouTube growth strategist. Channel "${current.title}" has ${current.subs} subscribers.
Videos (title, views, likes, comments, date, duration): ${JSON.stringify(top)}
Tasks: 1) detect the channel category/niche. 2) find what topics/formats/title patterns get the MOST views and engagement (likes+comments per view) and what flops. 3) suggest 5 NEW video topics that continue the winning pattern but are not duplicates of existing titles. For each give expected effect on views, likes, subscribers and why.
Return ONLY JSON: {"category":"","insight":"3-4 short lines on what works","topics":[{"topic":"","why":"","effect":"views/likes/subs impact in one line","fmt":"short|long"}]}`;
  const d = await gjson('models/gemini-2.5-flash:generateContent', { contents:[{parts:[{text:ask}]}], generationConfig:{ responseMimeType:'application/json' } }, key);
  const r = JSON.parse(d.candidates[0].content.parts[0].text.replace(/```json|```/g,''));
  S.topics = r.topics; $('#cat').value = r.category; store.set('pt_topics', r);
  showTopics(r); log('✅ '+r.topics.length+' topics ready'); return r;
}
function showTopics(r){
  $('#insight').hidden = false; $('#insight').textContent = '📊 '+r.insight;
  $('#topics').innerHTML = '';
  r.topics.forEach(t => { const d = document.createElement('div'); d.className='topic';
    d.innerHTML = `${t.topic}<small>${t.why}</small><small><em>📈 ${t.effect}</em> · ${t.fmt}</small>`;
    d.onclick = () => { $('#topic').value = t.topic; autoGrow(); document.querySelectorAll('.topic').forEach(x=>x.classList.remove('sel')); d.classList.add('sel'); };
    $('#topics').appendChild(d); });
}
$('#anaBtn').onclick = async () => { try { await analyze(); sparkle(); } catch(e){ log('❌ '+e.message, true); } };
const saved = store.get('pt_topics', null); if (saved) { S.topics = saved.topics; showTopics(saved); $('#cat').value = saved.category; }
function autoGrow(){ const t=$('#topic'); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,320)+'px';
  const n=t.value.length; $('#topicCount').textContent = n+' chars · '+(n>300?'Long prompt (direct ga vaadatha)':'Short prompt (AI detail ga expand chestundi)'); }
$('#topic').addEventListener('input', autoGrow); autoGrow();

async function pickTopic(){
  const typed = $('#topic').value.trim(); if (typed) return typed;
  if (!S.topics) await analyze();
  const used = usedTopics(), t = S.topics.find(x => !used.includes(x.topic)) || S.topics[0];
  store.set('pt_used', [...used, t.topic].slice(-30)); $('#topic').value = t.topic; autoGrow(); return t.topic;
}
async function makeIdea(){
  const key = $('#genKey').value.trim(); if (!key) throw new Error('Video AI API key pettandi');
  const topic = await pickTopic(), long = topic.length > 300;
  let titles = []; try { titles = (await channelVideos()).slice(0,15).map(v=>v.title); } catch {}
  const ask = `YouTube channel "${current?.title||'my channel'}", category: ${$('#cat').value||'infer from titles'}. Existing titles: ${titles.join(' | ')||'unknown'}.
Video format: ${S.fmt==='short'?'YouTube Shorts (vertical, under 60s)':'long-form'}.
User prompt (${long?'LONG and detailed: keep its details, only polish':'SHORT: expand into a rich cinematic prompt with subject, setting, camera movement, lighting, style, mood, audio'}): """${topic}"""
Create the full post. Rules:
- title: max 70 chars, strong hook, main keyword first, curiosity, no clickbait lies.
- description: 150-250 words. First 2 lines = hook with keyword (shown before "more"). Then summary, why watch, a call to action (like, subscribe, comment question), then 3-5 relevant hashtags at the end.
- tags: 12-15 SEO tags mixing broad + specific + long-tail, total under 450 chars.
- prompt: final video-generation prompt (English).
- thumbText: 2-4 words ALL CAPS punchy hook for the thumbnail (not the full title).
- thumbPrompt: English prompt for a 16:9 eye-catching YouTube thumbnail BACKGROUND image: one clear subject, bold saturated colors, high contrast, dramatic lighting, empty space on the left/bottom for text. NO text or letters in the image.
Return ONLY JSON: {"category":"","title":"","description":"","tags":[""],"prompt":"","thumbText":"","thumbPrompt":""}`;
  const d = await gjson('models/gemini-2.5-flash:generateContent', { contents:[{parts:[{text:ask}]}], generationConfig:{ responseMimeType:'application/json' } }, key);
  const m = JSON.parse(d.candidates[0].content.parts[0].text.replace(/```json|```/g,''));
  if (m.category) $('#cat').value = m.category; return m;
}
async function makeVideo(prompt){
  const key = $('#genKey').value.trim(), model = $('#genModel').value.trim();
  if (!model) throw new Error('Video model ID pettandi');
  const op = await gjson(`models/${model}:predictLongRunning`, { instances:[{prompt}], parameters:{ aspectRatio: S.fmt==='short'?'9:16':'16:9' } }, key);
  for (let i = 0; i < 90; i++) {
    await sleep(8000);
    const r = await (await fetch(GEN + op.name, { headers:{'x-goog-api-key':key} })).json();
    if (r.error) throw new Error(r.error.message);
    if (r.done) {
      const uri = r.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri; if (!uri) throw new Error('Video raaledu (safety filter ledha quota)');
      const v = await fetch(uri, { headers:{'x-goog-api-key':key} }); return await v.blob();
    }
    log('Generating… ' + (i+1));
  }
  throw new Error('Timeout');
}

/* ----- YouTube upload (OAuth + resumable) ----- */
function getToken(){
  return new Promise((res, rej) => {
    if (S.token && S.token.exp > Date.now()) return res(S.token.v);
    const cid = $('#clientId').value.trim(); if (!cid) return rej(new Error('OAuth Client ID pettandi'));
    google.accounts.oauth2.initTokenClient({ client_id: cid, scope:'https://www.googleapis.com/auth/youtube.upload',
      callback: t => t.access_token ? (S.token = { v:t.access_token, exp: Date.now()+3e6 }, res(t.access_token)) : rej(new Error(t.error||'Auth failed')) }).requestAccessToken();
  });
}
async function upload(blob, m){
  const tok = await getToken();
  const tags = (m.tags||[]).slice(0,15); if (S.fmt==='short') tags.push('Shorts');
  const meta = { snippet:{ title:(m.title+(S.fmt==='short'?' #Shorts':'')).slice(0,100), description:m.description, tags }, status:{ privacyStatus:'private', selfDeclaredMadeForKids:false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method:'POST',
    headers:{ Authorization:'Bearer '+tok, 'Content-Type':'application/json', 'X-Upload-Content-Type': blob.type||'video/mp4' }, body:JSON.stringify(meta) });
  if (!init.ok) throw new Error('Upload init failed: '+(await init.text()).slice(0,150));
  const put = await fetch(init.headers.get('Location'), { method:'PUT', headers:{'Content-Type': blob.type||'video/mp4'}, body:blob });
  if (!put.ok) throw new Error('Upload failed '+put.status);
  return (await put.json()).id;
}

/* ----- one full run ----- */
async function generate(){
  if (!canSpend()) throw new Error('Ee roju credits aipoyayi. Reset tarvata malli.');
  log('💡 Idea create chesthunna…'); S.meta = await makeIdea(); log('Category: '+S.meta.category+' | '+S.meta.title);
  log('🎞️ Video generate avthundi (konni nimishalu)…'); S.blob = await makeVideo(S.meta.prompt);
  cred.used += +$('#credCost').value||1; cred.made++; store.set('pt_cred', cred); drawCred();
  $('#preview').src = URL.createObjectURL(S.blob); $('#preview').hidden = false;
  $('#mTitle').value=S.meta.title; $('#mDesc').value=S.meta.description; $('#mTags').value=(S.meta.tags||[]).join(', '); $('#metaBox').hidden=false; log('✅ Video ready');
}
$('#genBtn').onclick = async () => { if (S.busy) return; S.busy = true; $('#upBtn').disabled = true;
  try { await generate(); $('#upBtn').disabled = false; sparkle(); } catch(e){ log('❌ '+e.message, true); } S.busy = false; };
$('#upBtn').onclick = async () => { try { log('🚀 Uploading…'); S.meta = { ...S.meta, title:$('#mTitle').value, description:$('#mDesc').value, tags:$('#mTags').value.split(',').map(s=>s.trim()).filter(Boolean) };
  const id = await upload(S.blob, S.meta); log('🎉 Uploaded: https://youtu.be/'+id); celebrate(); $('#upBtn').disabled = true; } catch(e){ log('❌ '+e.message, true); } };

/* ----- automatic mode (tab open undali) ----- */
$('#autoBtn').onclick = () => {
  if (S.auto) { clearInterval(S.auto); S.auto = null; $('#autoBtn').textContent = '▶ Start Auto'; return log('⏹ Auto stopped'); }
  $('#autoBtn').textContent = '⏸ Stop Auto'; log('🤖 Auto started. Tab close cheyyaku.');
  const tick = async () => {
    rollDay(); if (S.busy || cred.made >= (+$('#perDay').value||1)) return;
    if (!canSpend()) return;                        // reset ayyaka automatic ga continue avthundi
    S.busy = true;
    try { await generate(); const id = await upload(S.blob, S.meta); log('🎉 Auto uploaded https://youtu.be/'+id); celebrate(); }
    catch(e){ log('❌ '+e.message, true); } S.busy = false;
  };
  tick(); S.auto = setInterval(tick, 60000);
};

/* ----- sparkles + confetti ----- */
function sparkle(){ for (let i=0;i<14;i++){ const s=document.createElement('span'); s.className='sp'; s.textContent=['✨','⭐','💖'][i%3];
  s.style.left=innerWidth/2+'px'; s.style.top=innerHeight/2+'px'; s.style.setProperty('--dx',(Math.random()-.5)*500+'px'); s.style.setProperty('--dy',(Math.random()-.5)*400+'px');
  document.body.appendChild(s); setTimeout(()=>s.remove(),1000); } }
function celebrate(){
  sparkle(); const c=$('#fx'), x=c.getContext('2d'); c.width=innerWidth; c.height=innerHeight;
  const cols=['#ff8f87','#8fd9b8','#8fc6ff','#ffd978','#c9b0ff'];
  const P=[...Array(160)].map(()=>({x:innerWidth/2,y:innerHeight/3,vx:(Math.random()-.5)*16,vy:Math.random()*-14-2,r:Math.random()*6+3,c:cols[Math.random()*5|0],a:1}));
  (function f(){ x.clearRect(0,0,c.width,c.height); let live=0;
    P.forEach(p=>{ p.vy+=.35; p.x+=p.vx; p.y+=p.vy; p.a-=.008; if(p.a>0){live++; x.globalAlpha=p.a; x.fillStyle=p.c; x.fillRect(p.x,p.y,p.r,p.r*1.6);} });
    if(live) requestAnimationFrame(f); else x.clearRect(0,0,c.width,c.height); })();
}

/* ----- thumbnail: AI background + crisp canvas text ----- */
S.bg = null; S.thumbBlob = null;
async function makeBg(prompt){
  const key = $('#genKey').value.trim(), model = $('#imgModel').value.trim() || 'gemini-2.5-flash-image';
  const d = await gjson(`models/${model}:generateContent`, { contents:[{parts:[{text:prompt+'. 16:9 landscape, no text, no letters, no watermark.'}]}], generationConfig:{ responseModalities:['TEXT','IMAGE'] } }, key);
  const p = d.candidates?.[0]?.content?.parts?.find(x => x.inlineData); if (!p) throw new Error('Thumbnail image raaledu');
  const img = new Image(); img.src = 'data:'+p.inlineData.mimeType+';base64,'+p.inlineData.data; await img.decode(); return img;
}
function star(x, g, cx, r){ g.save(); g.translate(cx, r); g.fillStyle = '#fff'; g.shadowColor='#ffd978'; g.shadowBlur=20; g.beginPath();
  for (let i=0;i<8;i++){ const a=i*Math.PI/4, rad=i%2? x*.25 : x; g.lineTo(Math.cos(a)*rad, Math.sin(a)*rad); } g.fill(); g.restore(); }
function renderThumb(){
  const cv = $('#thumbCv'), g = cv.getContext('2d'), W = 1280, H = 720;
  if (S.bg) { const s = Math.max(W/S.bg.width, H/S.bg.height), w = S.bg.width*s, h = S.bg.height*s; g.drawImage(S.bg, (W-w)/2, (H-h)/2, w, h); }
  else { const gr = g.createLinearGradient(0,0,W,H); gr.addColorStop(0,'#ff8f87'); gr.addColorStop(1,'#c9b0ff'); g.fillStyle = gr; g.fillRect(0,0,W,H); }
  const v = g.createLinearGradient(0,0,W*.8,0); v.addColorStop(0,'rgba(0,0,0,.65)'); v.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle = v; g.fillRect(0,0,W,H);
  const b = g.createLinearGradient(0,H*.5,0,H); b.addColorStop(0,'rgba(0,0,0,0)'); b.addColorStop(1,'rgba(0,0,0,.55)'); g.fillStyle = b; g.fillRect(0,0,W,H);
  const words = ($('#thumbText').value || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length/2)).join(' '), words.slice(Math.ceil(words.length/2)).join(' ')] : [words.join(' ')];
  let fs = 150; g.font = `900 ${fs}px Fredoka, Impact, sans-serif`;
  while (fs > 60 && Math.max(...lines.map(l => g.measureText(l).width)) > W*.62) { fs -= 6; g.font = `900 ${fs}px Fredoka, Impact, sans-serif`; }
  g.textBaseline = 'middle'; g.lineJoin = 'round'; const top = H/2 - (lines.length-1)*fs*.55;
  lines.forEach((l, i) => { const y = top + i*fs*1.1, x = 60;
    g.lineWidth = fs*.14; g.strokeStyle = '#2b1230'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 22; g.shadowOffsetY = 8; g.strokeText(l, x, y);
    g.shadowColor='transparent'; g.fillStyle = i % 2 ? '#fff' : '#ffd978'; g.fillText(l, x, y); });
  star(26, g, W-110, 110); star(14, g, W-190, 180); star(18, g, W-70, 200);
  cv.toBlob(b => S.thumbBlob = b, 'image/jpeg', .9);
}
async function buildThumb(newImg){
  if (!$('#thumbOn').checked || !S.meta) return;
  $('#thumbText').value = $('#thumbText').value && !newImg ? $('#thumbText').value : (S.meta.thumbText || S.meta.title.split(' ').slice(0,3).join(' '));
  $('#thumbBox').hidden = false;
  try { log('🖼️ Thumbnail generate avthundi…'); S.bg = await makeBg(S.meta.thumbPrompt || S.meta.title); } catch(e){ S.bg = null; log('⚠️ Thumbnail image fail, gradient vaadatha: '+e.message, true); }
  renderThumb(); log('✅ Thumbnail ready');
}
$('#thumbRe').onclick = renderThumb;
$('#thumbNew').onclick = async () => { try { S.bg = await makeBg(S.meta.thumbPrompt || S.meta.title); renderThumb(); } catch(e){ log('❌ '+e.message, true); } };
$('#thumbDl').onclick = () => { const a = document.createElement('a'); a.href = $('#thumbCv').toDataURL('image/jpeg', .92); a.download = 'thumbnail.jpg'; a.click(); };
async function setThumb(videoId){
  if (!$('#thumbOn').checked || !S.thumbBlob) return;
  const r = await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+videoId+'&uploadType=media',
    { method:'POST', headers:{ Authorization:'Bearer '+S.token.v, 'Content-Type':'image/jpeg' }, body:S.thumbBlob });
  log(r.ok ? '🖼️ Thumbnail set ayyindi' : '⚠️ Thumbnail set kaaledu (channel verify cheyyali / Shorts ki support limited): '+r.status, !r.ok);
}
/* hook into flow */
const _gen = generate; generate = async function(){ await _gen(); await buildThumb(true); };
const _up = upload; upload = async function(b, m){ const id = await _up(b, m); try { await setThumb(id); } catch(e){ log('⚠️ '+e.message, true); } return id; };
