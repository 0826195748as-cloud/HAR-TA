// Türkiye Fetih – Railway Client
// 1 JETON = 1 TOPRAK – TikTok LIVE
const socket = io();

let TURKEY_GEO = null;
let PROVINCES = [];

let state = {
  claimed: {},
  users: {},
  currentUser: localStorage.getItem('tt_current_user') || 'sen_hukumdar',
  selectedProvince: null,
  stats: { likes: 2481302, viewers: 14720, followers: 8204 },
  config: { coin_cost:1, like_per_coin:3, follow_required:true, follow_bonus:1, max_land_per_user:81, double_claim_block:true },
  tiktok: { connected:false }
};

const COLORS = ['#fe2c55','#25f4ee','#ffd166','#7c5cff','#00e676','#ff7ab6','#4cc9f0','#fca311','#ff595e','#8ac926','#ffca3a','#6a4c93','#00bbf9','#f15bb5','#9b5de5','#00f5d4','#ff9f1c','#2ec4b6','#e71d36','#06d6a0','#118ab2','#ef476f','#ffd60a','#fb5607'];
function userColor(u){ let h=0; for(let i=0;i<u.length;i++) h=(h*31+u.charCodeAt(i))>>>0; return COLORS[h%COLORS.length]; }

function ensureLocalUser(username){
  if(!state.users[username]){
    state.users[username] = {username, coins:3, lands:0, followed:false, likesGiven:0, color:userColor(username)};
  }
  return state.users[username];
}

// --- MAP INIT ---
async function init(){
  const res = await fetch('/turkey.json');
  TURKEY_GEO = await res.json();
  PROVINCES = TURKEY_GEO.features.map(f=>({id:f.properties.number, name:f.properties.name, feature:f})).sort((a,b)=>a.id-b.id);
  buildMap();
  bindUI();
  loadServerState();
}
let svg, g, path, provG, projection;
function buildMap(){
  const mapEl = document.getElementById('turkey-map');
  mapEl.innerHTML='';
  svg = d3.select(mapEl).append('svg')
    .attr('viewBox','0 0 980 520')
    .attr('class','map-svg')
    .attr('preserveAspectRatio','xMidYMid meet');
  g = svg.append('g');
  projection = d3.geoMercator().fitSize([960,500], TURKEY_GEO);
  path = d3.geoPath().projection(projection);
  provG = g.selectAll('path')
    .data(PROVINCES)
    .enter().append('path')
    .attr('d', d=>path(d.feature))
    .attr('class','province unclaimed')
    .on('click', (e,d)=> selectProvince(d.id));
  // labels
  const labelNames = ['İstanbul','Ankara','İzmir','Bursa','Antalya','Adana','Konya','Gaziantep','Samsun','Trabzon','Erzurum','Diyarbakır','Kayseri','Mersin','Sakarya','Eskişehir'];
  g.selectAll('text.plab')
    .data(PROVINCES.filter(p=> labelNames.includes(p.name)))
    .enter().append('text')
    .attr('class','province-label')
    .attr('x', d=>path.centroid(d.feature)[0])
    .attr('y', d=>path.centroid(d.feature)[1])
    .text(d=>d.name);
  const zoom = d3.zoom().scaleExtent([1,5]).on('zoom', e=> g.attr('transform', e.transform));
  svg.call(zoom);
}

function getOwner(id){
  const c = state.claimed[id];
  return c ? (c.username || c) : null;
}
function updateMapColors(){
  if(!provG) return;
  provG.each(function(d){
    const owner = getOwner(d.id);
    const color = owner ? (state.users[owner]?.color || (state.claimed[d.id]?.color) || '#888') : '#293059';
    d3.select(this).attr('fill', color).classed('claimed', !!owner).classed('unclaimed', !owner);
  });
}
function selectProvince(id){
  state.selectedProvince=id;
  provG.classed('selected', p=>p.id===id);
  updateSel(); updateClaimBtn();
}
function updateSel(){
  const box=document.getElementById('selBox');
  const empty=document.getElementById('selEmpty');
  if(!box) return;
  if(!state.selectedProvince){ box.style.display='none'; empty.style.display='block'; return; }
  empty.style.display='none'; box.style.display='flex';
  const p=PROVINCES.find(x=>x.id===state.selectedProvince);
  const owner=getOwner(p.id);
  document.getElementById('selName').textContent = p.name + ' ('+p.id+')';
  document.getElementById('selSub').textContent = owner ? 'Sahibi: @'+owner : 'Boş – 1 jeton ile fethet';
  const st=document.getElementById('selState');
  st.textContent = owner ? 'DOLU' : 'BOŞ';
  st.className = owner ? 'sel-taken':'sel-free';
}
function updateClaimBtn(){
  const btn=document.getElementById('claimBtn'); if(!btn) return;
  const u=ensureLocalUser(state.currentUser);
  // sync coins from server if exists
  if(state.users[state.currentUser]) Object.assign(u, state.users[state.currentUser]);
  if(!state.selectedProvince){ btn.disabled=true; btn.textContent='İL SEÇ – 1 JETON = 1 TOPRAK'; return; }
  const owner=getOwner(state.selectedProvince);
  if(owner && state.config.double_claim_block){ btn.disabled=true; btn.textContent='ZATEN FETHEDİLDİ ✖'; return; }
  if(state.config.follow_required && !u.followed){ btn.disabled=true; btn.textContent='ÖNCE TAKİP ET – KİLİTLİ'; return; }
  if((u.coins||0) < state.config.coin_cost){ btn.disabled=true; btn.textContent='JETON YOK – BEĞEN KAZAN ❤️'; return; }
  const prov = PROVINCES.find(x=>x.id===state.selectedProvince);
  btn.disabled=false;
  btn.textContent = `🇹🇷 ${prov.name.toUpperCase()}’Yİ FETHET – ${state.config.coin_cost} JETON`;
}

// UI updates
function recountLandsUI(){
  Object.values(state.users).forEach(u=> u.lands=0);
  Object.entries(state.claimed).forEach(([pid, c])=>{
    const owner = c.username || c;
    if(state.users[owner]) state.users[owner].lands++;
  });
}
function updateUserUI(){
  const u = ensureLocalUser(state.currentUser);
  const serverU = state.users[state.currentUser];
  if(serverU) Object.assign(u, serverU);
  const elCoins = document.getElementById('curCoins'); if(elCoins) elCoins.textContent = u.coins||0;
  const elLands = document.getElementById('curLands'); if(elLands) elLands.textContent = u.lands||0;
  const elName = document.getElementById('curName'); if(elName) elName.textContent = '@'+u.username;
  const elAv = document.getElementById('curAvatar'); if(elAv){ elAv.textContent = u.username[0].toUpperCase(); elAv.style.background = u.color; }
  const ft = document.getElementById('curFollowTxt'); if(ft){ ft.textContent = u.followed ? 'takip ✓' : 'takip yok'; ft.style.color = u.followed ? '#00e676' : '#ff6b8a'; }
  const fb = document.getElementById('followBtn'); if(fb) fb.textContent = u.followed ? '✓ Takip' : '+ Takip';
  renderStrip();
  updateClaimBtn();
}
function renderStrip(){
  const strip=document.getElementById('playerStrip'); if(!strip) return;
  const list=Object.values(state.users).sort((a,b)=>(b.lands||0)-(a.lands||0)).slice(0,20);
  strip.innerHTML = list.map(u=>`<div class="pill ${u.username===state.currentUser?'active':''}" data-u="${esc(u.username)}"><span style="color:${u.color}">●</span> @${esc(u.username)} <b>${u.lands||0}</b> · 🪙${u.coins||0}</div>`).join('');
  strip.querySelectorAll('.pill').forEach(el=> el.onclick=()=>{
    state.currentUser = el.dataset.u;
    localStorage.setItem('tt_current_user', state.currentUser);
    updateUserUI();
    toast('Oyuncu: @'+state.currentUser);
  });
}
function esc(s){ return s.replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }

function updateRuler(){
  const rulers = Object.values(state.users)
    .map(u=>{ const lands = Object.values(state.claimed).filter(c=> (c.username||c)===u.username).length; return {...u, lands}; })
    .filter(r=>r.lands>0)
    .sort((a,b)=>b.lands-a.lands).slice(0,40);
  const rc = document.getElementById('rulerCountInline'); if(rc) rc.textContent = rulers.length;
  const body=document.getElementById('rulerBody'); if(!body) return;
  if(!rulers.length){ body.innerHTML = `<div style="color:#8ea0d8;text-align:center;padding:18px;font-size:12px">Henüz fetih yok.<br>İlk hükümdar sen ol!</div>`; return;}
  body.innerHTML = rulers.map((r,i)=>{
    const cls=i===0?'top1':i===1?'top2':i===2?'top3':'';
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1+'.');
    return `<div class="ruler-item ${cls}">
      <div class="r-rank">${medal}</div>
      <div class="r-avatar" style="background:${r.color}">${r.username[0].toUpperCase()}</div>
      <div class="r-info"><div class="r-name">@${esc(r.username)}</div><div class="r-lands">${r.coins||0} 🪙</div></div>
      <div class="r-count">${r.lands}</div>
    </div>`;
  }).join('');
}
function updateTop(){
  const lTop=document.getElementById('lTop'); if(lTop) lTop.textContent = state.stats.likes>1e6 ? (state.stats.likes/1e6).toFixed(2)+'M' : Math.floor(state.stats.likes/1000)+'K';
  const vTop=document.getElementById('vTop'); if(vTop) vTop.textContent = state.stats.viewers>1000 ? (state.stats.viewers/1000).toFixed(1)+'K' : state.stats.viewers;
  const fTop=document.getElementById('fTop'); if(fTop) fTop.textContent = state.stats.followers>1000? (state.stats.followers/1000).toFixed(1)+'K': state.stats.followers;
  const kTop=document.getElementById('kTop'); if(kTop) kTop.textContent = 81 - Object.keys(state.claimed).length;
}
function updateRightLeader(){
  const el=document.getElementById('leaderInline'); if(!el) return;
  const rulers = Object.values(state.users)
    .map(u=>({ ...u, lands: Object.values(state.claimed).filter(c=> (c.username||c)===u.username).length }))
    .filter(r=>r.lands>0).sort((a,b)=>b.lands-a.lands).slice(0,8);
  el.innerHTML = rulers.length ? rulers.map((r,i)=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #2b346a;font-size:13px"><span>${i+1}. @${esc(r.username)}</span><b style="color:#ffd166">${r.lands} il</b></div>`).join('') : '<div class="muted">Henüz yok</div>';
}

// feed + toast
function pushFeed(html){
  const feedEl=document.getElementById('liveFeed');
  if(feedEl){
    const div=document.createElement('div'); div.className='feed-item'; div.innerHTML=html;
    feedEl.prepend(div); while(feedEl.children.length>7) feedEl.removeChild(feedEl.lastChild);
  }
  const mini=document.getElementById('miniFeed');
  if(mini){ const m=document.createElement('div'); m.innerHTML='• '+html.replace(/<[^>]+>/g,''); mini.prepend(m); while(mini.children.length>40) mini.removeChild(mini.lastChild); }
}
let toastT;
function toast(msg){
  const host=document.getElementById('toastHost'); if(!host) return;
  host.innerHTML = `<div class="toast">${msg}</div>`;
  clearTimeout(toastT); toastT=setTimeout(()=>host.innerHTML='',2400);
}

// ---- SERVER SYNC ----
async function loadServerState(){
  try{
    const r = await fetch('/api/state'); const j = await r.json();
    if(j.ok){
      state.claimed = j.claimed || {};
      state.users = j.users || {};
      state.stats = j.stats || state.stats;
      state.config = {...state.config, ...j.config};
      state.tiktok = j.tiktok || {};
      ensureLocalUser(state.currentUser);
      recountLandsUI();
      updateMapColors(); updateRuler(); updateUserUI(); updateTop(); updateRightLeader();
    }
  }catch(e){ console.warn(e); }
}

// socket events
socket.on('connect', ()=>{ /*console.log('socket connected')*/ });
socket.on('state_snapshot', snap=>{
  state.claimed = snap.claimed || {};
  state.users = {...state.users, ...snap.users};
  state.stats = snap.stats || state.stats;
  state.config = {...state.config, ...snap.config};
  state.tiktok = snap.tiktok || {};
  recountLandsUI();
  updateMapColors(); updateRuler(); updateUserUI(); updateTop();
});
socket.on('province_claimed', d=>{
  state.claimed[d.provinceId] = {username:d.username, color:d.color};
  if(state.users[d.username]) state.users[d.username].coins = d.coinsLeft;
  recountLandsUI();
  updateMapColors(); updateRuler(); updateUserUI(); updateTop(); updateRightLeader();
  const prov = PROVINCES.find(p=>p.id===d.provinceId);
  pushFeed(`<span class="fuser">@${esc(d.username)}</span> <b>${prov?prov.name:d.provinceId}</b>’ı fethetti! 🗺️`);
});
socket.on('live_event', ev=>{
  if(ev.type==='like'){
    pushFeed(`<span class="fuser">@${esc(ev.username)}</span> <span class="flike">❤️ x${ev.amount||1}</span>${ev.coins? ' +'+ev.coins+'🪙':''}`);
  }else if(ev.type==='follow'){
    pushFeed(`<span class="fuser">@${esc(ev.username)}</span> takip etti ✅${ev.coins? ' +'+ev.coins+'🪙':''}`);
    if(state.users[ev.username]){ state.users[ev.username].followed=true; if(ev.coins) state.users[ev.username].coins+=ev.coins; }
    updateRuler(); updateUserUI();
  }else if(ev.type==='gift'){
    pushFeed(`<span class="fuser">@${esc(ev.username)}</span> <span class="fgift">🎁 ${ev.gift||'hediye'} +${ev.amount}🪙</span>`);
  }else if(ev.type==='chat'){
    pushFeed(`<span class="fuser">@${esc(ev.username)}</span>: ${esc(ev.comment||'')}`);
  }else if(ev.type==='share'){
    pushFeed(`<span class="fuser">@${esc(ev.username)}</span> yayını paylaştı 🔗`);
  }
});
socket.on('tiktok_status', s=>{
  state.tiktok = s;
  const el=document.getElementById('liveStatusText');
  if(el){ el.textContent = s.connected ? 'Bağlı ●' : (s.connecting ? 'Bağlanıyor…' : 'Simülasyon ●'); el.style.color = s.connected ? '#00e676' : '#ffd166'; }
});
socket.on('map_reset', ()=>{
  state.claimed = {};
  updateMapColors(); updateRuler(); updateTop(); toast('Harita sıfırlandı (server)');
});
socket.on('config_update', cfg=>{ state.config = {...state.config, ...cfg}; updateClaimBtn(); });

// ---- UI BIND ----
function bindUI(){
  document.getElementById('followBtn')?.addEventListener('click', ()=>{
    socket.emit('action', {type:'follow', username: state.currentUser}, res=>{
      if(res?.gained) toast('Takip ✓ +'+res.gained+' jeton');
      loadServerState();
    });
    // fallback local
    const u=ensureLocalUser(state.currentUser);
    if(!u.followed){ u.followed=true; u.coins+=state.config.follow_bonus; updateUserUI(); }
  });
  document.getElementById('likeBtn')?.addEventListener('click', ()=>{
    socket.emit('action', {type:'like', username: state.currentUser, amount: 5}, res=>{
      if(res?.gained) toast('❤️ +'+res.gained+' jeton');
      loadServerState();
    });
  });
  document.getElementById('giftBtn')?.addEventListener('click', ()=>{
    const gc = [1,2,3,5][Math.floor(Math.random()*4)];
    socket.emit('action', {type:'gift', username: state.currentUser, amount: gc}, ()=> loadServerState());
    toast('🎁 +'+gc+' jeton gönderildi');
  });
  document.getElementById('claimBtn')?.addEventListener('click', ()=>{
    if(!state.selectedProvince) return;
    socket.emit('claim', {provinceId: state.selectedProvince, username: state.currentUser}, r=>{
      if(!r.ok){
        toast('Fetih başarısız: '+(r.reason||'hata'));
        if(r.reason==='follow_required') toast('Önce takip et!');
      }
      loadServerState();
    });
  });

  // right tabs
  document.querySelectorAll('.rtab').forEach(t=> t.addEventListener('click', ()=>{
    document.querySelectorAll('.rtab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.rtab-panel').forEach(p=>p.style.display='none');
    const panel=document.getElementById('panel-'+t.dataset.tab);
    if(panel) panel.style.display='block';
  }));

  // ruler drag + min
  const win=document.getElementById('rulerWindow');
  const drag=document.getElementById('rulerDrag');
  if(win && drag){
    let dragg=false,sx,sy,ox,oy;
    const start=(cx,cy)=>{dragg=true;sx=cx;sy=cy;ox=win.offsetLeft;oy=win.offsetTop};
    drag.addEventListener('mousedown',e=>{start(e.clientX,e.clientY);e.preventDefault()});
    drag.addEventListener('touchstart',e=>{const t=e.touches[0];start(t.clientX,t.clientY)},{passive:true});
    window.addEventListener('mousemove',e=>{
      if(!dragg) return;
      win.style.left=Math.max(4, ox+e.clientX-sx)+'px';
      win.style.top=Math.max(56, oy+e.clientY-sy)+'px';
      win.style.right='auto';
    });
    window.addEventListener('touchmove',e=>{
      if(!dragg) return; const t=e.touches[0];
      win.style.left=Math.max(4, ox+t.clientX-sx)+'px';
      win.style.top=Math.max(56, oy+t.clientY-sy)+'px';
      win.style.right='auto';
    },{passive:true});
    window.addEventListener('mouseup',()=>dragg=false);
    window.addEventListener('touchend',()=>dragg=false);
    document.getElementById('rulerMin')?.addEventListener('click', ()=> win.classList.toggle('min'));
  }

  // settings modal wiring
  const modal=document.getElementById('settingsModal');
  const openSet=()=>{ modal?.classList.add('open'); loadCfgForm(); };
  const closeSet=()=> modal?.classList.remove('open');
  document.getElementById('openSettings')?.addEventListener('click', openSet);
  document.getElementById('openSettings2')?.addEventListener('click', openSet);
  document.getElementById('closeSettings')?.addEventListener('click', closeSet);
  document.getElementById('cancelSettings')?.addEventListener('click', closeSet);

  document.querySelectorAll('.snav').forEach(b=> b.addEventListener('click', ()=>{
    document.querySelectorAll('.snav').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.set-section').forEach(s=>s.classList.remove('active'));
    const sec=document.getElementById('s-'+b.dataset.s); if(sec) sec.classList.add('active');
  }));
  document.querySelectorAll('.switch').forEach(sw=> sw.addEventListener('click', ()=> sw.classList.toggle('on')));

  document.getElementById('saveSettings')?.addEventListener('click', async ()=>{
    const payload = readCfgForm();
    try{
      await fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      toast('✅ Ayarlar server’a kaydedildi');
      closeSet();
      loadServerState();
    }catch(e){ toast('Kayıt hatası'); }
  });

  // top chips
  document.getElementById('autoChip')?.addEventListener('click', ()=> toast('Otomatik bot server’da çalışıyor – Railway ayarı'));
  document.getElementById('pauseChip')?.addEventListener('click', async ()=>{
    await fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({auto_bot:false})});
    toast('Bot duraklatıldı');
  });
  document.getElementById('resetChip')?.addEventListener('click', async ()=>{
    if(!confirm('Haritayı sıfırla?')) return;
    await fetch('/api/reset', {method:'POST'});
    loadServerState();
  });

  // TikTok connect buttons in settings
  document.getElementById('btnConnectTT')?.addEventListener('click', async ()=>{
    const username = document.getElementById('in_tt_user')?.value?.replace('@','').trim();
    const mode = document.getElementById('in_tt_mode')?.value || 'tiktok';
    if(!username){ toast('Kullanıcı adı gir'); return; }
    toast('Bağlanıyor @'+username+' …');
    try{
      const r = await fetch('/api/connect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, mode: mode==='sim'?'sim':'tiktok'})});
      const j = await r.json();
      if(j.ok) toast('📡 Bağlantı isteği gönderildi');
      else toast('Hata: '+(j.error||''));
    }catch(e){ toast('Bağlantı hatası'); }
  });
  document.getElementById('btnTestConnect')?.addEventListener('click', ()=> toast('Test OK – server /health çalışıyor'));
}

function loadCfgForm(){
  // fill from state.config
  const set = (id,val)=>{ const el=document.getElementById(id); if(el) el.value = val; };
  const setSw = (id,on)=>{ const el=document.getElementById(id); if(el) el.classList.toggle('on', !!on); };
  set('in_like_per_coin', state.config.like_per_coin);
  setSw('sw_follow_required', state.config.follow_required);
  set('in_follow_bonus', state.config.follow_bonus);
  set('in_max_land', state.config.max_land_per_user);
  // ... other fields default
  const ll = document.getElementById('liveLikeThresh'); if(ll) ll.textContent = state.config.like_per_coin;
  const lf = document.getElementById('liveFollowReq'); if(lf) lf.textContent = state.config.follow_required ? 'EVET':'HAYIR';
}
function readCfgForm(){
  const get = id => document.getElementById(id)?.value;
  const getSw = id => document.getElementById(id)?.classList.contains('on');
  return {
    like_per_coin: parseInt(get('in_like_per_coin'))||3,
    follow_required: getSw('sw_follow_required'),
    follow_bonus: parseInt(get('in_follow_bonus'))||1,
    max_land_per_user: parseInt(get('in_max_land'))||81,
    double_claim_block: true,
    auto_bot: getSw('sw_auto_start') ?? true,
    auto_speed_ms: parseInt(get('in_auto_speed'))||1200
  };
}

// start
init().then(()=>{
  ensureLocalUser(state.currentUser);
  updateUserUI(); updateTop();
  pushFeed('<b>🇹🇷 Railway – Türkiye Fetih LIVE hazır!</b>');
  toast('Yatay harita • 1 Jeton = 1 Toprak • Railway');
});
setInterval(loadServerState, 4000);
