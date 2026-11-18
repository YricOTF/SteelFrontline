"use strict";

/* ============ 传输层 ============ */
const SIGNALING_SERVERS = [
  { name: 'EMQX 主站',    url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'MQTTX 公共',   url: 'wss://broker.mqttx.io:8084/mqtt' },
  { name: 'Eclipse Paho', url: 'wss://mqtt.eclipseprojects.io:8083/mqtt' },
  { name: 'HiveMQ 备用',  url: 'wss://broker.hivemq.com:8884/mqtt' },
];
let mqttLoad = null;
function loadMqtt() {
  if (window.mqtt) return Promise.resolve();
  if (!mqttLoad) {
    mqttLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js';
      script.integrity = 'sha384-RMKqoX3sVDhA5/PQXeSYWbCkhmNzKD+mZljSl8p7OWJUs3CQbiH8TNWCA5pPf9fQ';
      script.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error('信令库加载超时，可改用手动 P2P'));
      }, 9000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error('信令库加载失败，可改用手动 P2P'));
      };
      document.head.append(script);
    }).catch(error => {
      mqttLoad = null;
      throw error;
    });
  }
  return mqttLoad;
}

let serverRank = [];
let probing = false;
async function probeServer(server, timeoutMs) {
  timeoutMs = timeoutMs || 2500;
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false, c = null;
    const finish = (ok) => {
      if (done) return; done = true;
      try { if (c) c.end(true); } catch (e) {}
      resolve(ok ? { latency: Date.now() - start } : null);
    };
    const timer = setTimeout(() => finish(false), timeoutMs + 500);
    try { c = mqtt.connect(server.url, {clean: true, connectTimeout: timeoutMs, reconnectPeriod: 0, clientId: 'sf_probe_' + Math.random().toString(16).slice(2, 10)}); }
    catch (e) { clearTimeout(timer); finish(false); return; }
    c.on('connect', () => { clearTimeout(timer); finish(true); });
    c.on('error', () => { clearTimeout(timer); finish(false); });
  });
}
async function probeAllServers() {
  if (probing) return serverRank;
  probing = true;
  const sigBadge = document.getElementById('sigBadge');
  if (sigBadge) sigBadge.textContent = '探测中…';
  const results = await Promise.all(SIGNALING_SERVERS.map((s, i) => probeServer(s).then(r => r ? { index: i, name: s.name, url: s.url, latency: r.latency } : null)));
  const ok = results.filter(Boolean).sort((a, b) => a.latency - b.latency);
  serverRank = ok.length ? ok : [{ index: 0, name: SIGNALING_SERVERS[0].name, url: SIGNALING_SERVERS[0].url, latency: -1 }];
  probing = false;
  if (sigBadge) {
    const p = serverRank[0];
    sigBadge.textContent = p.name + (p.latency >= 0 ? ' · ' + p.latency + 'ms' : '');
    if (serverRank.length > 1) sigBadge.textContent += ' (+' + (serverRank.length - 1) + ')';
  }
  return serverRank;
}
function getPrimaryServer() { return serverRank.length ? serverRank[0] : { index: 0, name: SIGNALING_SERVERS[0].name, url: SIGNALING_SERVERS[0].url, latency: -1 }; }
function getServerByIndex(idx) {
  if (idx >= 0 && idx < SIGNALING_SERVERS.length) {
    const s = SIGNALING_SERVERS[idx];
    const r = serverRank.find(x => x.index === idx);
    return { index: idx, name: s.name, url: s.url, latency: r ? r.latency : -1 };
  }
  return getPrimaryServer();
}
function generateRoomCode() {
  const p = getPrimaryServer();
  const idx = p.index % SIGNALING_SERVERS.length;
  const num = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return String(idx) + num;
}
function parseRoomCodeServer(code) {
  if (!/^[0-9]{6}$/.test(code)) return -1;
  const idx = parseInt(code[0], 10);
  if (idx < 0 || idx >= SIGNALING_SERVERS.length) return -1;
  return idx;
}
const TOPIC_PREFIX = 'steelfrontline/v24/';
function roomTopic(room, side) { return TOPIC_PREFIX + room + '/' + side; }
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

const Net = {
  role: 'none', backend: 'mqtt',
  myId: 'p' + Math.random().toString(36).slice(2, 10),
  roomCode: null, isHost: false, pc: null, dc: null,
  mqttClient: null, mqttTopic: null, playerList: [], mySide: 'atk',
  hostMapId: 'grand',
  onCommand: null, onState: null, onAssign: null, onPlayers: null, onStart: null, onHostLeave: null,
  _clientJoinResolve: null, _hostBusy: false, _pendingCandidates: [],

  _sendRaw(conn, msg) {
    try { conn.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); return true; }
    catch (e) { console.warn('[Net] send fail:', e); return false; }
  },
  async hostCreateMqtt(roomCode) {
    this.backend = 'mqtt'; this.role = 'host'; this.isHost = true;
    this.roomCode = roomCode;
    this.playerList = [{ id: this.myId, name: '房主', side: 'atk' }];
    const srv = getPrimaryServer();
    return new Promise((resolve, reject) => {
      if (typeof mqtt === 'undefined') { reject(new Error('MQTT 库未加载')); return; }
      let resolved = false;
      try { this.mqttClient = mqtt.connect(srv.url, {clean: true, connectTimeout: 10000, reconnectPeriod: 0, clientId: 'sf_h_' + roomCode + '_' + Math.random().toString(16).slice(2, 10)}); }
      catch (e) { reject(new Error('创建失败：' + e.message)); return; }
      this.mqttTopic = roomTopic(roomCode, 'host');
      this.mqttClient.on('connect', () => {
        this.mqttClient.subscribe(this.mqttTopic, { qos: 1 }, (err) => {
          if (err) { reject(new Error('订阅失败')); return; }
          resolved = true; resolve(this.myId);
        });
      });
      this.mqttClient.on('message', (topic, payload) => {
        let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (!msg || msg.from === this.myId) return;
        if (msg.type === 'hello') this._handleHello(msg.from, msg.name);
        else if (msg.type === 'answer' && msg.from === this._currentClient) this._handleAnswer(msg);
        else if (msg.type === 'ice' && msg.from === this._currentClient) this._handleIce(msg);
      });
      this.mqttClient.on('error', (err) => { if (!resolved) reject(new Error('EMQX 连接失败：' + (err.message || err))); });
      setTimeout(() => { if (!resolved) reject(new Error('连接超时')); }, 15000);
    });
  },
  _handleHello(clientId, name) {
    if (this._hostBusy || this.dc?.readyState === 'open') { this._mqttPublish({ to: clientId, type: 'full' }); return; }
    this._hostBusy = true;
    this._currentClient = clientId;
    const atkCount = this.playerList.filter(p => p.side === 'atk').length;
    const defCount = this.playerList.filter(p => p.side === 'def').length;
    const side = atkCount <= defCount ? 'atk' : 'def';
    if (typeof clientId !== 'string' || clientId.length > 30) { this._hostBusy = false; return; }
    const clientName = String(name || '玩家' + clientId.slice(-4)).slice(0, 16);
    this.playerList.push({ id: clientId, name: clientName, side });
    this._createHostOffer(clientId, side, clientName).catch(error => {
      this._hostBusy = false;
      this.playerList = this.playerList.filter(player => player.id !== clientId);
      console.warn('连接协商失败', error);
    });
  },
  async _createHostOffer(clientId, side, clientName) {
    if (this.pc) { try { this.pc.close(); } catch (e) {} this.pc = null; }
    this._pendingCandidates = [];
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) this._mqttPublish({ to: clientId, type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = () => { const st = pc.connectionState; if (st === 'failed' || st === 'closed') this._hostBusy = false; };
    const dc = pc.createDataChannel('game', { ordered: true });
    this.dc = dc;
    this._setupHostDataChannel(dc, pc, clientId, side, clientName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._mqttPublish({ to: clientId, type: 'offer', sdp: offer, side, name: clientName, mapId: this.hostMapId });
  },
  _handleAnswer(msg) {
    const pc = this.pc;
    if (!pc || pc.remoteDescription) return;
    pc.setRemoteDescription(msg.sdp).then(() => {
      for (const c of (this._pendingCandidates || [])) pc.addIceCandidate(c).catch(() => {});
      this._pendingCandidates = [];
    }).catch(e => console.warn('[Host] setRemoteDescription failed:', e));
  },
  _handleIce(msg) {
    const pc = this.pc;
    if (!pc) return;
    if (pc.remoteDescription) pc.addIceCandidate(msg.candidate).catch(() => {});
    else { this._pendingCandidates = this._pendingCandidates || []; this._pendingCandidates.push(msg.candidate); }
  },
  _setupHostDataChannel(dc, pc, clientId, side, clientName) {
    dc.onopen = () => {
      this._hostBusy = false;
      this._sendRaw(dc, {type: 'assign', side: this.playerList.find(player => player.id === clientId)?.side || side, mapId: this.hostMapId, players: this.playerList});
      this._broadcastPlayers();
      if (this.onPlayers) this.onPlayers(this.playerList);
      const statusEl = document.getElementById('hostStatus');
      if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ ' + clientName + ' 已连接'; }
      const startBtn = document.getElementById('hostStart');
      if (startBtn) startBtn.disabled = false;
      document.getElementById('manualStart').disabled = false;
      if (G?.mp?.isHost && G.state === 'playing') {
        const peer = this.playerList.find(player => player.id === clientId);
        this._sendRaw(dc, multiplayerStartMessage(G, peer?.side || side));
        netBroadcastState(true);
      }
    };
    dc.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg !== 'object') return;
      const player = this.playerList.find(entry => entry.id === clientId);
      if (msg.type === 'cmd' && player) this.onCommand?.(player.side, msg, clientId);
    };
    dc.onclose = () => {
      this._hostBusy = false;
      this.playerList = this.playerList.filter(p => p.id !== clientId);
      this._broadcastPlayers();
      if (this.onPlayers) this.onPlayers(this.playerList);
      const statusEl = document.getElementById('hostStatus');
      if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '玩家已断开，等待新玩家…'; }
      const startBtn = document.getElementById('hostStart');
      if (startBtn) startBtn.disabled = true;
      document.getElementById('manualStart').disabled = true;
      if (this.dc === dc) this.dc = null;
      if (this.pc === pc) { try { pc.close(); } catch (e) {} this.pc = null; }
    };
    dc.onerror = (e) => console.warn('[Host] dc error:', e);
  },
  _mqttPublish(obj) {
    if (!this.mqttClient || !this.mqttTopic) return;
    obj.from = this.myId;
    try { this.mqttClient.publish(this.mqttTopic, JSON.stringify(obj), { qos: 1 }); } catch (e) {}
  },
  _broadcastPlayers() {
    if (this.role !== 'host') return;
    const msg = JSON.stringify({ type: 'players', list: this.playerList, mapId: this.hostMapId, from: this.myId });
    if (this.mqttClient && this.mqttTopic) { try { this.mqttClient.publish(this.mqttTopic, msg, { qos: 1 }); } catch (e) {} }
    if (this.dc && this.dc.readyState === 'open') this._sendRaw(this.dc, { type: 'players', list: this.playerList, mapId: this.hostMapId });
  },
  async clientJoinMqtt(roomCode) {
    this.backend = 'mqtt'; this.role = 'client'; this.isHost = false;
    this.roomCode = roomCode;
    const srvIdx = parseRoomCodeServer(roomCode);
    const srv = srvIdx >= 0 ? getServerByIndex(srvIdx) : getPrimaryServer();
    return new Promise((resolve, reject) => {
      if (typeof mqtt === 'undefined') { reject(new Error('MQTT 库未加载')); return; }
      let resolved = false;
      try { this.mqttClient = mqtt.connect(srv.url, {clean: true, connectTimeout: 10000, reconnectPeriod: 0, clientId: 'sf_c_' + roomCode + '_' + Math.random().toString(16).slice(2, 10)}); }
      catch (e) { reject(new Error('加入失败：' + e.message)); return; }
      this.pc = new RTCPeerConnection(RTC_CONFIG);
      this._pendingCandidates = [];
      this.pc.onicecandidate = (e) => { if (e.candidate) this._mqttPublish({ to: 'host', type: 'ice', candidate: e.candidate }); };
      this.pc.ondatachannel = (e) => { this._setupClientDataChannel(e.channel); };
      this.pc.onconnectionstatechange = () => { if (this.pc.connectionState === 'failed' && this.onHostLeave) this.onHostLeave(); };
      this.mqttTopic = roomTopic(roomCode, 'host');
      this.mqttClient.on('connect', () => {
        this.mqttClient.subscribe(this.mqttTopic, { qos: 1 }, (err) => {
          if (err) { reject(new Error('订阅失败')); return; }
          this._mqttPublish({ type: 'hello', name: '玩家' + this.myId.slice(-4) });
        });
      });
      this.mqttClient.on('message', (topic, payload) => {
        let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.to && msg.to !== this.myId && msg.to !== 'all') return;
        if (msg.type === 'offer') {
          this.pc.setRemoteDescription(msg.sdp)
            .then(() => {
              for (const c of (this._pendingCandidates || [])) this.pc.addIceCandidate(c).catch(() => {});
              this._pendingCandidates = [];
              return this.pc.createAnswer();
            })
            .then(ans => this.pc.setLocalDescription(ans))
            .then(() => { this._mqttPublish({ to: 'host', type: 'answer', sdp: this.pc.localDescription }); })
            .catch(e => console.warn('[Client] negotiate failed:', e));
        } else if (msg.type === 'ice') {
          if (this.pc.remoteDescription) this.pc.addIceCandidate(msg.candidate).catch(() => {});
          else { this._pendingCandidates = this._pendingCandidates || []; this._pendingCandidates.push(msg.candidate); }
        } else if (msg.type === 'full') { reject(new Error('房间已满')); }
      });
      this.mqttClient.on('error', (err) => { if (!resolved) reject(new Error('EMQX 连接失败：' + (err.message || err))); });
      this._clientJoinResolve = () => { if (!resolved) { resolved = true; resolve(); } };
      setTimeout(() => { if (!resolved) reject(new Error('连接超时')); }, 20000);
    });
  },
  _setupClientDataChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      const statusEl = document.getElementById('joinStatus');
      if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ 已连接房主，等待开始'; }
      if (this._clientJoinResolve) this._clientJoinResolve();
    };
    dc.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'assign') {
        this.mySide = msg.side;
        this.hostMapId = msg.mapId || 'grand';
        this.playerList = msg.players || [];
        if (this.onPlayers) this.onPlayers(this.playerList);
        if (this.onAssign) this.onAssign(msg);
      } else if (msg.type === 'players') {
        this.playerList = msg.list || [];
        if (msg.mapId) this.hostMapId = msg.mapId;
        const me = this.playerList.find(p => p.name && p.name.indexOf('玩家'+this.myId.slice(-4))>=0);
        if (me) this.mySide = me.side;
        if (this.onPlayers) this.onPlayers(this.playerList);
      } else if (msg.type === 'state') { if (this.onState) this.onState(msg.s); }
      else if (msg.type === 'start') { if (this.onStart) this.onStart(msg); }
      else if (msg.type === 'notice' && typeof msg.text === 'string' && G?.mp) toast(G, msg.text.slice(0, 80), 'bad');
    };
    dc.onclose = () => { if (this.onHostLeave) this.onHostLeave(); };
    dc.onerror = (e) => console.warn('[Net] client dc error:', e);
  },
  broadcast(msg) {
    const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (this.dc && this.dc.readyState === 'open') { try { this.dc.send(str); } catch (e) {} }
  },
  broadcastState(s) {
    if (this.role !== 'host') return;
    const msg = JSON.stringify({ type: 'state', s, from: this.myId });
    if (this.dc?.readyState !== 'open') return false;
    return this._sendRaw(this.dc, msg);
  },
  sendToHost(cmd) {
    if (this.dc && this.dc.readyState === 'open') { try { this.dc.send(JSON.stringify(cmd)); } catch (e) {} }
  },
  close() {
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    if (this.dc) { try { this.dc.close(); } catch (e) {} }
    if (this.mqttClient) { try { this.mqttClient.end(true); } catch (e) {} }
    this.pc = null; this.dc = null; this.mqttClient = null; this.mqttTopic = null;
    this.role = 'none'; this.roomCode = null; this._hostBusy = false;
    this.playerList = []; this._pendingCandidates = [];
    this._clientJoinResolve = null;
  },
};

function netBroadcastState(force = false) {
  const g = G;
  if (!g?.mp?.isHost || Net.role !== 'host' || Net.dc?.readyState !== 'open') return;
  const sideBit = side => side === 'atk' ? 0 : (side === 'def' ? 1 : 2);
  const state = {
    t: +g.time.toFixed(2), result: g.result, stats: g.stats,
    cp: [g.cp.atk, g.cp.def],
    cd: [g.cd.atk, g.cd.def],
    u: g.units.filter(unit => unit.alive).map(unit => [
      unit.id, sideBit(unit.side), unit.type, Math.round(unit.x), Math.round(unit.y),
      Math.round(unit.hp), Math.round(unit.facing * 100), unit.holdPost, unit._engaged ? 1 : 0,
    ]),
    p: g.posts.map(post => [
      sideBit(post.owner), Math.round(post.cap), +post.integrate.toFixed(2), post._disabled ? 1 : 0,
      post._atkP || 0, post._defP || 0,
    ]),
    tr: g.turrets.map(turret => [
      turret.type, Math.round(turret.x), Math.round(turret.y), Math.round(turret.hp), turret.maxHp,
      turret.discovered ? 1 : 0, sideBit(turret.owner), turret.ruin ? 1 : 0, turret.id,
    ]),
    tren: g.trenches.map(trench => [Math.round(trench.x), Math.round(trench.y), sideBit(trench.side)]),
    env: { season: g.season, dayTime: +g.dayTime.toFixed(3) },
    dep: g.deploying.map(deployment => [
      sideBit(deployment.side), deployment.type, Math.round(deployment.x), Math.round(deployment.y),
      +deployment.timeLeft.toFixed(2), +deployment.total.toFixed(2),
    ]),
    emg: [g._emergency.atk, g._emergency.def],
    march: [...g._marchUnits.keys()],
    marchUntil: [...g._marchUnits],
    oil: g._events.oilBoom ? [g._events.oilBoom.x, g._events.oilBoom.y, g._events.oilBoom.life] : null,
    tank: g._oilTanks.map(tank => [Math.round(tank.x), Math.round(tank.y), tank.alive ? 1 : 0]),
    burn: g._events.burnZones.map(zone => [zone.x, zone.y, zone.r, zone.born, zone.dps]),
    volcano: g._events.volcanoZone,
    recon: g.recon, strikes: g.strikes, shots: g.projectiles,
    fx: g.effects.filter(effect => effect.netId).slice(-38),
  };
  if (force || g._sentTerrain !== g.terrainRevision) state.terrain = encodeCells(g.terrain);
  if (Net.broadcastState(state) && state.terrain) g._sentTerrain = g.terrainRevision;
}

function netApplyState(state) {
  const g = G;
  if (!g?.mp || Net.role !== 'client' || !state || !Array.isArray(state.u) ||
      !Array.isArray(state.p) || !Array.isArray(state.tr) || !Array.isArray(state.cp) ||
      !Number.isFinite(state.t)) return;
  const sideFromBit = value => value === 0 ? 'atk' : (value === 1 ? 'def' : 'neutral');
  g.time = state.t;
  [g.cp.atk, g.cp.def] = state.cp;
  if (state.cd) [g.cd.atk, g.cd.def] = state.cd;
  if (state.env) {
    if (Object.hasOwn(SEASONS, state.env.season)) g.season = state.env.season;
    if (Number.isFinite(state.env.dayTime)) g.dayTime = state.env.dayTime;
    updateEnv(g, 0);
  }
  if (state.emg) [g._emergency.atk, g._emergency.def] = state.emg;
  if (state.marchUntil) g._marchUnits = new Map(state.marchUntil);
  else if (state.march) g._marchUnits = new Map(state.march.map(id => [id, g.time + SKILLS.march.dur]));

  if (state.stats) g.stats = state.stats;
  if (state.shots) g.projectiles = state.shots;
  if (state.recon) g.recon = state.recon;
  if (state.strikes) g.strikes = state.strikes;
  const terrain = decodeCells(state.terrain, g.terrain.length, TERRAIN.length - 1);
  if (terrain && terrain.some((value, i) => value !== g.terrain[i])) {
    g.terrain = terrain;
    invalidateTerrain(g);
    buildTerrainCanvas(g);
  }
  if (state.oil) {
    const [x, y, life = 2.4] = state.oil;
    g._events.oilBoom = { x, y, life, max: 2.4 };
  } else g._events.oilBoom = null;
  if (state.tank) {
    for (const [i, saved] of state.tank.entries()) {
      const tank = g._oilTanks[i];
      if (tank) { [tank.x, tank.y] = saved; tank.alive = Boolean(saved[2]); }
    }
  }
  if (state.burn) {
    g._events.burnZones = state.burn.map(([x, y, r, born = g.time, dps = 18]) =>
      ({ x, y, r, born, life: 1e9, max: 1e9, dps }));
  }
  g._events.volcanoZone = state.volcano || null;

  const existing = new Map(g.units.map(unit => [unit.id, unit]));
  g.units = state.u.filter(entry => Object.hasOwn(UNITS, entry[2])).map(entry => {
    const [id, sideBit, type, x, y, hp, facing, hold, fighting] = entry;
    const unit = existing.get(id) || { id, side: sideFromBit(sideBit), type, x, y, maxHp: UNITS[type].hp, alive: true };
    unit._netTarget = { x, y };
    unit.hp = hp;
    unit.facing = facing / 100;
    unit.holdPost = hold;
    unit._engaged = Boolean(fighting);
    return unit;
  });
  const units = new Map(g.units.map(unit => [unit.id, unit]));
  g.selection = g.selection.map(unit => units.get(unit.id)).filter(Boolean);
  if (g.radialTargets) g.radialTargets = g.radialTargets.map(unit => units.get(unit.id)).filter(Boolean);

  for (const [i, post] of g.posts.entries()) {
    const data = state.p[i];
    if (!data) continue;
    post.owner = sideFromBit(data[0]);
    post.cap = data[1];
    post.integrate = data[2];
    post._disabled = Boolean(data[3]);
    post._atkP = data[4] || 0;
    post._defP = data[5] || 0;
  }
  const knownTurrets = new Map(g.turrets.map(turret => [turret.id, turret]));
  g.turrets = state.tr.filter(entry => Object.hasOwn(TURRETS, entry[0])).map(entry => {
    const [type, x, y, hp, maxHp, , sideBit, ruin, id = type + '_' + x + '_' + y] = entry;
    const owner = sideFromBit(sideBit);
    return { type, id, x, y, hp, maxHp, owner, side: owner, ruin: Boolean(ruin),
      r: TURRETS[type].r, discovered: knownTurrets.get(id)?.discovered || false };
  });
  if (state.tren) g.trenches = state.tren.map(([x, y, side]) => ({ x, y, r: 34, side: sideFromBit(side) }));
  if (state.dep) {
    const wasDeploying = g.deploying.some(deployment => deployment.side === g.playerSide);
    g.deploying = state.dep.map(([side, type, x, y, timeLeft, total]) =>
      ({ side: sideFromBit(side), type, x, y, timeLeft, total }));
    if (wasDeploying && !g.deploying.some(deployment => deployment.side === g.playerSide)) Snd.deployDone();
  }
  recomputeVis(g, g.playerSide);
  updateDeployPoints(g);

  for (const effect of state.fx || []) {
    if (effect.netId <= (g._lastNetEffect || 0)) continue;
    g._lastNetEffect = effect.netId;
    g.effects.push(effect);
    if (effect.type === 'tracer') Snd.fire(g, effect.x1, effect.y1, effect.munition, effect.side);
    if (effect.type === 'boom') Snd.boom(g, effect.x, effect.y, effect.r > 32, effect.side);
  }
  g.tick++;
  if (!g._clientReady) {
    g._clientReady = true;
    show(el.syncOverlay, false);
    toast(g, '战场同步完成', 'good');
  }
  if ((state.result === 'atk' || state.result === 'def') && g.state !== 'over') {
    show(el.pause, false);
    show(el.settings, false);
    endGame(g, state.result);
  } else refreshHUD(g);
}

/* ---- 手动 P2P ---- */
function encodeManualCode(obj) {
  try {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  } catch (e) { return ''; }
}
function decodeManualCode(str) {
  try {
    const clean = String(str).replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { return null; }
}
function waitForIce(pc, ms) {
  return new Promise(resolve => {
    if (!pc || pc.iceGatheringState === 'complete') return resolve();
    let done = false;
    const finish = () => { if (done) return; done = true; try { pc.removeEventListener('icegatheringstatechange', onChange); } catch (e) {} resolve(); };
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    try { pc.addEventListener('icegatheringstatechange', onChange); } catch (e) {}
    setTimeout(finish, ms || 2500);
  });
}
function verifyIceCandidates(pc) {
  if (!pc.localDescription?.sdp.includes('a=candidate:')) {
    throw new Error('浏览器未取得可用的 WebRTC 地址，请检查联网或浏览器权限');
  }
}

async function manualGenOffer() {
  Net.close();
  Net.backend = 'manual'; Net.role = 'host'; Net.isHost = true;
  Net.hostMapId = document.getElementById('manualMapOpts').value;
  Net.playerList = [
    { id: Net.myId, name: '房主', side: 'atk' },
    { id: 'manual-peer', name: '玩家', side: 'def' },
  ];
  document.getElementById('manualStart').disabled = true;
  const offerEl = document.getElementById('offerCode');
  const statusEl = document.getElementById('manualHostStatus');
  offerEl.value = '';
  if (statusEl) { statusEl.className = 'status-bar wait'; statusEl.textContent = '正在生成邀请码…'; }
  const pc = new RTCPeerConnection(RTC_CONFIG);
  Net.pc = pc;
  Net._pendingCandidates = [];
  pc.onicecandidate = (e) => { if (e.candidate) Net._pendingCandidates.push(e.candidate); };
  const dc = pc.createDataChannel('game', { ordered: true });
  Net.dc = dc;
  pc.onconnectionstatechange = () => {
    if (statusEl) {
      if (pc.connectionState === 'connected') { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ P2P 通道已连接'; }
      else if (pc.connectionState === 'failed') { statusEl.className = 'status-bar'; statusEl.textContent = '连接失败，请重新生成'; }
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc, 5500);
  verifyIceCandidates(pc);
  const packed = { v: 1, type: 'offer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, name: '房主', mapId: Net.hostMapId };
  if (offerEl) offerEl.value = encodeManualCode(packed);
  Net._setupHostDataChannel(dc, pc, 'manual-peer', 'def', '对手');
  if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ 邀请码已生成，请复制发给朋友'; }
}
async function manualAcceptAnswer() {
  const inputEl = document.getElementById('answerCode');
  const statusEl = document.getElementById('manualHostStatus');
  const pc = Net.pc;
  if (!inputEl || !pc) { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '请先点击「生成邀请码」'; } return; }
  const code = inputEl.value.trim();
  if (!code) { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '请粘贴应答码'; } return; }
  const data = decodeManualCode(code);
  if (!data || data.type !== 'answer') { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '应答码无效'; } return; }
  if (statusEl) { statusEl.className = 'status-bar wait'; statusEl.textContent = '正在建立连接…'; }
  try {
    await pc.setRemoteDescription(data.sdp);
    for (const c of (data.cand || [])) { try { await pc.addIceCandidate(c); } catch (e) {} }
    for (const c of (Net._pendingCandidates || [])) { try { await pc.addIceCandidate(c); } catch (e) {} }
    if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ 应答已接受，等待通道打开…'; }
  } catch (e) { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '连接失败：' + (e.message || e); } }
}
async function manualGenAnswer() {
  Net.close();
  Net.backend = 'manual'; Net.role = 'client'; Net.isHost = false;
  const inputEl = document.getElementById('offerInput');
  const answerEl = document.getElementById('myAnswerCode');
  const statusEl = document.getElementById('manualClientStatus');
  if (!inputEl) return;
  answerEl.value = '';
  const code = inputEl.value.trim();
  if (!code) { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '请粘贴邀请码'; } return; }
  const data = decodeManualCode(code);
  if (!data || data.type !== 'offer') { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '邀请码无效'; } return; }
  if (data.mapId) Net.hostMapId = data.mapId;
  if (statusEl) { statusEl.className = 'status-bar wait'; statusEl.textContent = '正在生成应答码…'; }
  if (!window.RTCPeerConnection) {
    statusEl.textContent = '此浏览器无法使用 WebRTC';
    return;
  }
  const pc = new RTCPeerConnection(RTC_CONFIG);
  Net.pc = pc;
  Net._pendingCandidates = [];
  pc.onicecandidate = (e) => { if (e.candidate) Net._pendingCandidates.push(e.candidate); };
  pc.ondatachannel = (e) => { Net._setupClientDataChannel(e.channel); };
  pc.onconnectionstatechange = () => {
    if (statusEl) {
      if (pc.connectionState === 'connected') { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ P2P 通道已连接'; }
      else if (pc.connectionState === 'failed') { statusEl.className = 'status-bar'; statusEl.textContent = '连接失败'; }
    }
  };
  try {
    await pc.setRemoteDescription(data.sdp);
    for (const c of (data.cand || [])) { try { await pc.addIceCandidate(c); } catch (e) {} }
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitForIce(pc, 5500);
    verifyIceCandidates(pc);
    const packed = { v: 1, type: 'answer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, cand: [], name: '玩家' };
    if (answerEl) answerEl.value = encodeManualCode(packed);
    if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ 应答码已生成，请复制发回给房主'; }
  } catch (e) { if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '生成失败：' + (e.message || e); } }
}

/* ============ 多人 UI ============ */
let multiBackend = 'mqtt';
function buildBackendOpts() {
  const bo = document.getElementById('backendOpts');
  if (!bo) return;
  bo.innerHTML = '';
  [
    { k: 'mqtt', n: '公共服务器', d: '通过公共 MQTT 中转信令，自动选延迟最低的服务器' },
    { k: 'manual', n: '手动 P2P', d: '微信/QQ 交换邀请码，无需信令服务器' },
  ].forEach(b => {
    const d = document.createElement('div');
    d.className = 'opt' + (multiBackend === b.k ? ' active' : '');
    d.innerHTML = '<div class="on">' + b.n + '</div><div class="od">' + b.d + '</div>';
    d.onclick = () => { multiBackend = b.k; buildBackendOpts(); };
    bo.appendChild(d);
  });
}
function buildHostMapOpts() {
  const ho=document.getElementById('hostMapOpts');
  if(!ho)return;
  ho.innerHTML='';
  MAPS.filter(m=>!m.tutorial).forEach(m=>{
    const d=document.createElement('div');
    d.className='opt'+(Net.hostMapId===m.id?' active':'');
    d.innerHTML='<div class="on">'+m.n+'</div><div class="od">'+m.tag+'</div>';
    d.onclick=()=>{Net.hostMapId=m.id;buildHostMapOpts();Net._broadcastPlayers();};
    ho.appendChild(d);
  });
}
function showMultiView(view) {
  ['multiHome', 'multiHost', 'multiJoin', 'multiManual'].forEach(v => {
    const e = document.getElementById(v);
    if (e) e.classList.toggle('hidden', v !== view);
  });
}
document.getElementById('mMulti').onclick = () => {
  Snd.ensure();
  Snd.click();
  show(el.menu, false); show(el.multi, true); showMultiView('multiHome'); buildBackendOpts();
  if (location.protocol === 'file:') { const fw = document.getElementById('fileWarn'); if (fw) fw.classList.remove('hidden'); }
};
document.getElementById('mmBack').onclick = () => { Net.close(); show(el.multi, false); show(el.menu, true); };
document.getElementById('mmHost').onclick = async () => {
  if (multiBackend === 'manual') { showManualLobby(); return; }
  showMultiView('multiHost');
  Net.hostMapId = 'grand';
  buildHostMapOpts();
  const codeEl = document.getElementById('hostRoomCode');
  if (codeEl) codeEl.textContent = '------';
  const statusEl = document.getElementById('hostStatus');
  if (statusEl) { statusEl.className = 'status-bar wait'; statusEl.textContent = '正在连接信令服务器…'; }
  try {
    await loadMqtt();
    if (!serverRank.length) await probeAllServers();
    if (el.multi.classList.contains('hidden') || document.getElementById('multiHost').classList.contains('hidden')) return;
    const code = generateRoomCode();
    codeEl.textContent = code;
    await Net.hostCreateMqtt(code);
    if (statusEl) { statusEl.className = 'status-bar ok'; statusEl.textContent = '✓ 房间已创建，等待玩家加入…'; }
    if (Net.onPlayers) Net.onPlayers(Net.playerList);
  } catch (e) {
    if (statusEl) { statusEl.className = 'status-bar'; statusEl.textContent = '创建失败：' + (e.message || e); }
    Net.close();
  }
};
document.getElementById('mmJoin').onclick = () => {
  showMultiView('multiJoin');
  const inp = document.getElementById('joinRoomCode');
  if (inp) { inp.value = ''; inp.focus(); }
  const st = document.getElementById('joinStatus');
  if (st) { st.className = 'status-bar'; st.textContent = '等待输入房间号'; }
};
function showManualLobby() {
  showMultiView('multiManual');
  const select = document.getElementById('manualMapOpts');
  if (!select.options.length) {
    for (const map of MAPS.filter(map => !map.tutorial)) select.add(new Option(map.n, map.id));
    select.value = 'grand';
  }
}
document.getElementById('mmManual').onclick = showManualLobby;
document.getElementById('manualBack').onclick = () => { Net.close(); showMultiView('multiHome'); };
document.getElementById('hostRoomCode').onclick = () => {
  const code = document.getElementById('hostRoomCode').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => alert('房间码已复制：' + code));
  else alert('房间码：' + code);
};
function multiplayerStartMessage(g, side) {
  return {
    type: 'start', mapId: g.cfg.mapId, diff: g.cfg.diff, side,
    season: g.season, dayTime: g.dayTime, seed: g.cfg.seed,
  };
}

function startMultiplayerBattle() {
  if (Net.dc?.readyState !== 'open' || Net.role !== 'host') return;
  const mapId = Net.hostMapId || 'grand';
  const host = Net.playerList.find(player => player.id === Net.myId);
  const peer = Net.playerList.find(player => player.id !== Net.myId);
  Snd.ensure();
  G = makeGame({ mapId, side: host?.side || 'atk', diff: 'normal', multiplayer: true });
  G.mp = { isHost: true };
  G._clientReady = true;
  Net.broadcast(multiplayerStartMessage(G, peer?.side || 'def'));
  netBroadcastState(true);
  startPlaying();
}
document.getElementById('hostStart').onclick = startMultiplayerBattle;
document.getElementById('manualStart').onclick = startMultiplayerBattle;
document.getElementById('hostBack').onclick = () => { Net.close(); showMultiView('multiHome'); };
document.getElementById('doJoin').onclick = async () => {
  const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
  if (parseRoomCodeServer(code) < 0) { alert('请输入有效的 6 位房间码'); return; }
  const st = document.getElementById('joinStatus');
  if (st) { st.className = 'status-bar wait'; st.textContent = '正在连接 ' + code + ' …'; }
  try {
    Snd.ensure();
    await loadMqtt();
    if (el.multi.classList.contains('hidden') || document.getElementById('multiJoin').classList.contains('hidden')) return;
    await Net.clientJoinMqtt(code);
  } catch (error) {
    Net.close();
    st.className = 'status-bar';
    st.textContent = '连接失败：' + error.message;
  }
};
document.getElementById('joinBack').onclick = () => { Net.close(); showMultiView('multiHome'); };

Net.onAssign = (msg) => {
  const st = document.getElementById('joinStatus');
  if (st) { st.className = 'status-bar ok'; st.textContent = '已连接！你是' + (msg.side === 'atk' ? '攻方' : '守方') + ' · 等待房主开始…'; }
};
Net.onState = (s) => netApplyState(s);
Net.onStart = msg => {
  if (msg.side === 'atk' || msg.side === 'def') Net.mySide = msg.side;
  if (Net.mySide !== 'atk' && Net.mySide !== 'def') return;
  G = makeGame({
    mapId: msg.mapId || Net.hostMapId || 'grand', side: Net.mySide,
    diff: DIFFS[msg.diff] ? msg.diff : 'normal', season: msg.season, dayTime: msg.dayTime,
    seed: msg.seed, multiplayer: true,
  });
  G.mp = { isHost: false };
  G.units = [];
  G.turrets = [];
  G.trenches = [];
  G.deploying = [];
  G.projectiles = [];
  recomputeVis(G, G.playerSide);
  startPlaying();
  show(el.syncOverlay, true);
  Net.sendToHost({ type: 'cmd', cmd: 'reqState' });
};
Net.onHostLeave = () => { if (G?.mp && !G.mp.isHost && G.state === 'playing') {
    show(el.syncOverlay, false);
    toast(G, '与房主的连接已断开', 'bad');
  } };
Net.onPlayers = (list) => {
  const el_ = document.getElementById('hostPlayers');
  if (!el_) return;
  el_.innerHTML = '';
  list.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'side-pick';
    const isMe = (p.id === Net.myId);
    row.innerHTML = '<span class="sp-name"></span><div class="sp-btns"><button class="sp-btn atk'+(p.side==='atk'?' active':'')+'" data-idx="'+idx+'" data-side="atk">攻</button><button class="sp-btn def'+(p.side==='def'?' active':'')+'" data-idx="'+idx+'" data-side="def">守</button></div>';
    row.querySelector('.sp-name').textContent = p.name + (isMe ? '（我）' : '');
    el_.appendChild(row);
  });
  el_.querySelectorAll('.sp-btn').forEach(btn=>{
    btn.onclick=()=>{
      const idx=parseInt(btn.dataset.idx,10);
      const newSide=btn.dataset.side;
      if(!Net.playerList[idx])return;
      Net.playerList[idx].side=newSide;
      Net.onPlayers(Net.playerList);
      Net._broadcastPlayers();
    };
  });
  if (list.length <= 1 && el_.children.length === 0) {
    el_.innerHTML = '<div style="color:#4d5c6b;font-size:12px;text-align:center;padding:8px;">等待玩家加入…</div>';
  }
};
Net.onCommand = (side, message, peer) => {
  const g = G;
  if (!g?.mp?.isHost || (side !== 'atk' && side !== 'def')) return;
  if (message.cmd === 'reqState') { netBroadcastState(true); return; }
  if (g.state !== 'playing') return;
  const ids = new Set(Array.isArray(message.ids) ? message.ids.slice(0, UNIT_CAP[side]) : []);
  const units = g.units.filter(unit => unit.alive && unit.side === side && ids.has(unit.id));
  const rejected = text => Net.broadcast({ type: 'notice', text });
  switch (message.cmd) {
    case 'deploy':
      if (!startDeploy(g, side, message.unit, message.x, message.y)) rejected('此处无法部署，或指挥值及槽位不足');
      break;
    case 'move':
      orderMove(g, units, message.x, message.y);
      break;
    case 'plan':
      applyPeerPlan(g, side, peer, message, units);
      break;
    case 'skill': {
      const accepted = message.key === 'march'
        ? startMarch(g, side, units)
        : useSkill(g, side, message.key, message.x, message.y);
      if (!accepted) rejected('支援不可用，请检查目标范围、指挥值和冷却时间');
      break;
    }
    case 'attack': {
      const enemies = [...g.units, ...g.turrets].filter(enemy =>
        enemy.hp > 0 && enemy.side === opposingSide(side) && visible(g, side, enemy.x, enemy.y));
      for (const unit of units) {
        const target = message.target === undefined
          ? enemies.reduce((nearest, enemy) => !nearest ||
              dist2(unit.x, unit.y, enemy.x, enemy.y) < dist2(unit.x, unit.y, nearest.x, nearest.y) ? enemy : nearest, null)
          : enemies.find(enemy => enemy.id === message.target);
        if (target) attackUnits(g, [unit], target);
      }
      break;
    }
    case 'defend':
    case 'stop':
      for (const unit of units) {
        cancelMovement(unit);
        unit.tid = 0;
        unit.holdPost = message.cmd === 'defend' ? 1 : 0;
      }
      break;
    case 'trench':
      if (!digTrenches(g, side, units)) rejected('挖掘壕沟需要可用工兵和 5 CP');
      break;
    case 'recycle':
      for (const unit of units) recycleUnit(g, unit, side);
      break;
  }
};
document.getElementById('genOffer').onclick = async () => {
  Snd.ensure();
  try { await manualGenOffer(); }
  catch (error) {
    Net.close();
    document.getElementById('manualHostStatus').textContent = '无法生成邀请码：' + error.message;
  }
};
document.getElementById('acceptAnswer').onclick = manualAcceptAnswer;
document.getElementById('genAnswer').onclick = () => { Snd.ensure(); return manualGenAnswer(); };
document.getElementById('copyOffer').onclick = () => {
  const el_ = document.getElementById('offerCode'); el_.select(); document.execCommand('copy');
  const st = document.getElementById('manualHostStatus'); if (st) { st.textContent = '✓ 已复制'; setTimeout(() => st.textContent = '等待玩家接受应答', 1500); }
};
document.getElementById('copyAnswer').onclick = () => {
  const el_ = document.getElementById('myAnswerCode'); el_.select(); document.execCommand('copy');
  const st = document.getElementById('manualClientStatus'); if (st) { st.textContent = '✓ 已复制'; setTimeout(() => st.textContent = '等待通道打开…', 1500); }
};
document.getElementById('manualTabs').querySelectorAll('[data-mtab]').forEach(t => {
  t.onclick = () => {
    document.getElementById('manualTabs').querySelectorAll('[data-mtab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const isHost = t.dataset.mtab === 'host';
    show(document.getElementById('manualHost'), isHost);
    show(document.getElementById('manualClient'), !isHost);
  };
});
