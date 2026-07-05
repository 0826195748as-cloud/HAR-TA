require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- OYUN STATE ----
let game = {
  claimed: {}, // provinceId -> {username, ts, color}
  users: {},   // username -> {coins, lands, followed, likesGiven, color, lastSeen}
  config: {
    coin_cost: 1,
    like_per_coin: parseInt(process.env.LIKE_PER_COIN || '3'),
    follow_required: (process.env.FOLLOW_REQUIRED || 'true') === 'true',
    follow_bonus: parseInt(process.env.FOLLOW_BONUS || '1'),
    max_land_per_user: parseInt(process.env.MAX_LAND || '81'),
    double_claim_block: true,
    auto_bot: (process.env.AUTO_BOT || 'true') === 'true',
    auto_speed_ms: parseInt(process.env.AUTO_SPEED || '1200')
  },
  stats: {
    likes: 2481302,
    viewers: 14720,
    followers: 8204,
    startedAt: Date.now()
  },
  tiktok: {
    connected: false,
    username: null,
    mode: 'sim'
  }
};

// renk havuzu
const COLORS = ['#fe2c55','#25f4ee','#ffd166','#7c5cff','#00e676','#ff7ab6','#4cc9f0','#fca311','#ff595e','#8ac926','#ffca3a','#6a4c93','#00bbf9','#f15bb5','#9b5de5','#00f5d4','#ff9f1c','#2ec4b6','#e71d36','#06d6a0','#118ab2','#ef476f','#ffd60a','#fb5607'];
function userColor(u){ let h=0; for(let i=0;i<u.length;i++) h=(h*31+u.charCodeAt(i))>>>0; return COLORS[h % COLORS.length]; }

function ensureUser(username){
  if(!game.users[username]){
    game.users[username] = {
      username,
      coins: 2,
      lands: 0,
      followed: false,
      likesGiven: 0,
      color: userColor(username),
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
  }
  game.users[username].lastSeen = Date.now();
  return game.users[username];
}

function recountLands(){
  Object.values(game.users).forEach(u=> u.lands = 0);
  Object.values(game.claimed).forEach(c=>{
    if(game.users[c.username]) game.users[c.username].lands++;
  });
}

// başlangıç botları
const STARTER_BOTS = (process.env.BOT_USERS || 'emirhan.exe,zeynep_23,burak Reis,Ayaz_34,elifsu,karadeniz61,mehmet_ank,pelin.q,gamerkurt,sultan_fatih,xXShadowXx,dilaraa,mertcan.06,busra_tiktok,efe_boss,nilay.ist').split(',');
if(game.config.auto_bot){
  STARTER_BOTS.forEach((u,i)=>{
    const user = ensureUser(u.trim());
    user.coins = 2 + Math.floor(Math.random()*5);
    user.followed = true;
  });
}

// ---- API ----
app.get('/api/state', (req,res)=>{
  recountLands();
  res.json({
    ok:true,
    claimed: game.claimed,
    users: game.users,
    stats: game.stats,
    config: game.config,
    tiktok: game.tiktok
  });
});

app.post('/api/claim', (req,res)=>{
  const { provinceId, username } = req.body || {};
  if(!provinceId || !username) return res.status(400).json({ok:false, error:'provinceId & username required'});
  const r = doClaim(Number(provinceId), String(username));
  res.json(r);
});

app.post('/api/action', (req,res)=>{
  const { type, username, amount } = req.body || {};
  if(!type || !username) return res.status(400).json({ok:false});
  const u = ensureUser(username);
  let gained = 0;
  if(type==='like'){
    game.stats.likes += amount || 1;
    u.likesGiven += amount || 1;
    if(u.likesGiven % game.config.like_per_coin === 0){ u.coins++; gained=1; }
    io.emit('live_event', {type:'like', username, amount: amount||1, coins:gained});
  }
  if(type==='follow'){
    if(!u.followed){
      u.followed = true;
      u.coins += game.config.follow_bonus;
      game.stats.followers++;
      gained = game.config.follow_bonus;
      io.emit('live_event', {type:'follow', username, coins:gained});
    }
  }
  if(type==='gift'){
    const coins = amount || 1;
    u.coins += coins;
    game.stats.likes += 150;
    io.emit('live_event', {type:'gift', username, amount:coins});
    gained = coins;
  }
  res.json({ok:true, user:u, gained});
});

app.post('/api/connect', async (req,res)=>{
  const { username, mode } = req.body || {};
  if(!username) return res.status(400).json({ok:false, error:'username required'});
  try{
    const r = await connectTikTok(username, mode || 'tiktok');
    res.json({ok:true, ...r});
  }catch(e){
    res.status(500).json({ok:false, error: e.message});
  }
});

app.post('/api/disconnect', (req,res)=>{
  disconnectTikTok();
  res.json({ok:true});
});

app.post('/api/reset', (req,res)=>{
  game.claimed = {};
  Object.values(game.users).forEach(u=>{ u.lands=0; u.coins = 2 + Math.floor(Math.random()*3); });
  io.emit('map_reset');
  res.json({ok:true});
});

app.post('/api/config', (req,res)=>{
  const cfg = req.body || {};
  // coin_cost kilitli 1
  game.config.like_per_coin = Math.max(1, parseInt(cfg.like_per_coin) || game.config.like_per_coin);
  game.config.follow_required = !!cfg.follow_required;
  game.config.follow_bonus = parseInt(cfg.follow_bonus) || game.config.follow_bonus;
  game.config.max_land_per_user = parseInt(cfg.max_land_per_user) || game.config.max_land_per_user;
  game.config.double_claim_block = cfg.double_claim_block !== false;
  game.config.auto_bot = !!cfg.auto_bot;
  game.config.auto_speed_ms = parseInt(cfg.auto_speed_ms) || game.config.auto_speed_ms;
  io.emit('config_update', game.config);
  res.json({ok:true, config: game.config});
});

app.get('/health', (req,res)=> res.json({ok:true, uptime: process.uptime(), provinces_claimed: Object.keys(game.claimed).length}));

// ---- CLAIM LOGIC ----
function doClaim(provinceId, username){
  const u = ensureUser(username);
  if(game.claimed[provinceId] && game.config.double_claim_block){
    return {ok:false, reason:'already_claimed', owner: game.claimed[provinceId].username };
  }
  if(game.config.follow_required && !u.followed){
    return {ok:false, reason:'follow_required'};
  }
  if(u.coins < game.config.coin_cost){
    return {ok:false, reason:'no_coins', need: game.config.coin_cost, have: u.coins};
  }
  if(u.lands >= game.config.max_land_per_user){
    return {ok:false, reason:'max_land'};
  }
  u.coins -= game.config.coin_cost;
  game.claimed[provinceId] = { username, ts: Date.now(), color: u.color };
  recountLands();
  io.emit('province_claimed', { provinceId, username, color: u.color, coinsLeft: u.coins });
  return {ok:true, provinceId, username};
}

// ---- TIKTOK LIVE ----
let tiktokConnection = null;

async function connectTikTok(tiktokUsername, mode='tiktok'){
  disconnectTikTok();
  if(mode === 'sim'){
    game.tiktok = { connected: true, username: tiktokUsername, mode: 'sim' };
    io.emit('tiktok_status', game.tiktok);
    return game.tiktok;
  }
  const clean = tiktokUsername.replace('@','').trim();
  const conn = new WebcastPushConnection(clean, {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 1200,
    // session cookie opsiyonel: process.env.TIKTOK_SESSIONID
  });

  conn.connect().then(state => {
    console.log(`[TikTok] Connected to @${clean} - room ${state.roomId}`);
    game.tiktok = { connected:true, username: clean, mode:'tiktok', roomId: state.roomId };
    io.emit('tiktok_status', game.tiktok);
  }).catch(err=>{
    console.error('[TikTok] connect failed', err.message);
    game.tiktok = { connected:false, username: clean, mode:'tiktok', error: err.message };
    io.emit('tiktok_status', game.tiktok);
  });

  conn.on('chat', data=>{
    const uname = data.uniqueId;
    ensureUser(uname);
    io.emit('live_event', {type:'chat', username: uname, comment: data.comment});
    // chatte "al 34" gibi komut varsa il fethet
    const m = data.comment.match(/\b(?:al|fetih|claim)\s+(\d{1,2})\b/i);
    if(m){
      const pid = parseInt(m[1]);
      if(pid>=1 && pid<=81){
        const r = doClaim(pid, uname);
        if(!r.ok && r.reason==='follow_required'){
          io.emit('live_event', {type:'need_follow', username: uname});
        }
      }
    }
  });

  conn.on('like', data=>{
    const uname = data.uniqueId;
    const u = ensureUser(uname);
    const count = data.likeCount || 1;
    game.stats.likes += count;
    u.likesGiven += count;
    let gained = 0;
    while(u.likesGiven >= game.config.like_per_coin){
      u.likesGiven -= game.config.like_per_coin;
      u.coins++;
      gained++;
    }
    io.emit('live_event', {type:'like', username: uname, amount: count, coins: gained, totalLikes: data.totalLikeCount});
  });

  conn.on('follow', data=>{
    const uname = data.uniqueId;
    const u = ensureUser(uname);
    if(!u.followed){
      u.followed = true;
      u.coins += game.config.follow_bonus;
      game.stats.followers++;
      io.emit('live_event', {type:'follow', username: uname, coins: game.config.follow_bonus});
    }
  });

  conn.on('share', data=>{
    io.emit('live_event', {type:'share', username: data.uniqueId});
  });

  conn.on('gift', data=>{
    if(data.giftType===1 && !data.repeatEnd) return; // skip streak intermediate
    const uname = data.uniqueId;
    const u = ensureUser(uname);
    // diamondCount -> coin çevir
    const coins = Math.max(1, Math.floor((data.diamondCount||1) / 5));
    u.coins += coins;
    io.emit('live_event', {type:'gift', username: uname, gift: data.giftName, amount: coins, repeat: data.repeatCount});
  });

  conn.on('roomUser', data=>{
    game.stats.viewers = data.viewerCount;
    io.emit('stats_update', { viewers: data.viewerCount });
  });

  conn.on('disconnected', ()=>{
    console.log('[TikTok] disconnected');
    game.tiktok.connected = false;
    io.emit('tiktok_status', game.tiktok);
  });

  tiktokConnection = conn;
  game.tiktok = { connected:false, username: clean, mode:'tiktok', connecting:true };
  return game.tiktok;
}

function disconnectTikTok(){
  if(tiktokConnection){
    try{ tiktokConnection.disconnect(); }catch{}
    tiktokConnection = null;
  }
  game.tiktok.connected = false;
}

// ---- SOCKET.IO ----
io.on('connection', socket=>{
  // console.log('client', socket.id);
  socket.emit('state_snapshot', {
    claimed: game.claimed,
    users: game.users,
    stats: game.stats,
    config: game.config,
    tiktok: game.tiktok
  });

  socket.on('claim', ({provinceId, username}, cb)=>{
    const r = doClaim(provinceId, username);
    if(cb) cb(r);
  });

  socket.on('action', ({type, username, amount}, cb)=>{
    const u = ensureUser(username);
    let out = {ok:true};
    if(type==='like'){
      game.stats.likes += amount||1;
      u.likesGiven += amount||1;
      if(u.likesGiven >= game.config.like_per_coin){
        const gain = Math.floor(u.likesGiven / game.config.like_per_coin);
        u.likesGiven %= game.config.like_per_coin;
        u.coins += gain;
        out.gained = gain;
      }
    }
    if(type==='follow' && !u.followed){
      u.followed=true; u.coins+=game.config.follow_bonus; game.stats.followers++;
      out.gained = game.config.follow_bonus;
    }
    if(type==='gift'){
      const c = amount||1; u.coins += c; out.gained=c;
    }
    io.emit('user_update', {username, user:u});
    if(cb) cb(out);
  });

  socket.on('get_state', cb=> cb && cb({claimed:game.claimed, users:game.users, stats:game.stats, config:game.config}));
});

// ---- AUTO BOT SIM ----
setInterval(()=>{
  if(!game.config.auto_bot) return;
  const pool = Object.values(game.users).filter(u=> game.config.follow_required ? u.followed : true);
  if(!pool.length) return;
  const u = pool[Math.floor(Math.random()*pool.length)];
  // 60% claim dene
  if(Math.random()<0.6 && u.coins >= game.config.coin_cost){
    const free = [];
    for(let i=1;i<=81;i++){ if(!game.claimed[i]) free.push(i); }
    if(free.length){
      doClaim(free[Math.floor(Math.random()*free.length)], u.username);
    }
  } else {
    // beğeni kazandır
    if(Math.random()<0.5){ u.coins++; }
    game.stats.likes += Math.floor(Math.random()*40);
  }
  game.stats.viewers += Math.floor(Math.random()*9-4);
}, game.config.auto_speed_ms);

// ---- START ----
server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`🇹🇷 Türkiye Fetih LIVE running on http://localhost:${PORT}`);
  console.log(`1 JETON = 1 TOPRAK | FOLLOW_REQUIRED=${game.config.follow_required}`);
  // otomatik TikTok bağlan env varsa
  if(process.env.TIKTOK_USERNAME){
    console.log(`Auto-connecting TikTok @${process.env.TIKTOK_USERNAME}...`);
    connectTikTok(process.env.TIKTOK_USERNAME, 'tiktok').catch(e=> console.error(e.message));
  }
});
