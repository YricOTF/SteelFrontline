"use strict";

/* ============ 工具 ============ */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const rnd=(a,b)=>a+Math.random()*(b-a);
const dist2=(x1,y1,x2,y2)=>{const dx=x1-x2,dy=y1-y2;return dx*dx+dy*dy;};
const dist=(x1,y1,x2,y2)=>Math.sqrt(dist2(x1,y1,x2,y2));
const opposingSide = side => side === 'atk' ? 'def' : 'atk';
const TEAM_COLORS = { atk: '#f19470', def: '#85c3df', neutral: '#b6b4a0' };
let _uid=1;const uid=()=>_uid++;
function hash2(x,y,s){let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(s|0,1274126177);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y);const xf=x-xi,yf=y-yi;const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const a=hash2(xi,yi,s),b=hash2(xi+1,yi,s),c=hash2(xi,yi+1,s),d=hash2(xi+1,yi+1,s);return a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+d*u*v;}
function fbm(x,y,s,oct){let v=0,amp=.5,f=1;for(let i=0;i<oct;i++){v+=vnoise(x*f,y*f,s+i*37)*amp;amp*=.5;f*=2;}return v;}
/* ============ 常量 ============ */
let MAP_W=80, MAP_H=56;
const CELL=32, TICK=1/30, GAME_LEN=1500, DAY_CYCLE=360;
const CP_MAX=500;
const UNIT_CAP={atk:80,def:80};
const DEPLOY_CAP_SLOTS={atk:16,def:12};
const UNIT_SLOTS={inf:2,scout:2,eng:2,arm:4,art:5};
const DEPLOY_RADIUS=100;
/* 防压家圈半径：固定 200 */
const DEF_FORBIDDEN_RADIUS=200;
const T_PLAIN=0,T_FOREST=1,T_MOUNT=2,T_WATER=3,T_ROAD=4,T_SAND=5,T_BUILDING=6,T_BRIDGE=7,T_RUBBLE=8,T_CRATER=9;
const TERRAIN=[
  {n:'平原',pass:1,spd:1.00,cover:0.00,c1:'#555f41',c2:'#717751'},
  {n:'森林',pass:1,spd:0.60,cover:0.30,c1:'#263e32',c2:'#3c5240'},
  {n:'山地',pass:0,spd:0,cover:0.00,c1:'#575750',c2:'#757368'},
  {n:'水域',pass:0,spd:0,cover:0.00,c1:'#1e3d48',c2:'#2c5760'},
  {n:'道路',pass:1,spd:1.38,cover:0.00,c1:'#827458',c2:'#958365'},
  {n:'滩涂',pass:1,spd:0.80,cover:0.05,c1:'#a89567',c2:'#c3af7d'},
  {n:'建筑',pass:0,spd:0,cover:0.00,c1:'#4d504c',c2:'#64655b'},
  {n:'桥梁',pass:1,spd:1.20,cover:0.00,c1:'#756852',c2:'#a29374'},
  {n:'瓦砾',pass:1,spd:0.55,cover:0.15,c1:'#514b41',c2:'#675e50'},
  {n:'弹坑',pass:1,spd:0.72,cover:0.22,c1:'#322d26',c2:'#484035'},
];
const UNITS={
  inf:  {n:'步兵班',cost:8, hp:110,spd:16.5,dmg:10,range:78, cd:0.85,vis:142,r:6, cap:1.0},
  scout:{n:'侦察班',cost:6, hp:70, spd:28.5,dmg:5, range:60, cd:1.0, vis:250,r:5, cap:0.6},
  eng:  {n:'工兵班',cost:10,hp:100,spd:15.0,dmg:4, range:46, cd:1.4, vis:132,r:6, cap:1.0,trench:1,repair:1},
  arm:  {n:'装甲连',cost:30,hp:300,spd:25.5,dmg:28,range:118,cd:1.55,vis:162,r:9, cap:1.0},
  art:  {n:'炮兵连',cost:32,hp:130,spd:12.1,dmg:60,range:252,cd:10, vis:122,r:8, splash:26,aim:2.4,cap:0.5,keepRange:1},
};
const TURRETS={
  mg:        {n:'机枪堡',  hp:805,  dmg:17, range:207, cd:0.39,r:10,vis:172},
  at:        {n:'反坦克炮',hp:1127, dmg:69, range:276, cd:2.09,r:11,vis:192},
  fort:      {n:'要塞炮',  hp:1610, dmg:105,range:391, cd:3.13,r:14,vis:232},
  bunker:    {n:'碉堡',    hp:978,  dmg:14, range:173, cd:0.52,r:11,vis:170},
  watchtower:{n:'哨塔',    hp:170,  dmg:10, range:150, cd:0.85,r:7, vis:280},
};
const SKILLS={
  recon:    {n:'侦察机',  cost:12,cd:30, radius:200,dur:16, maxRange:1000},
  barrage:  {n:'炮火覆盖',cost:39,cd:125,radius:46, dur:12,dps:82,neutral:true,maxRange:1000,friendlyRange:420},
  airstrike:{n:'空中打击',cost:59,cd:158,radius:60, dur:8, dps:82,neutral:true,maxRange:1000},
  emergency:{n:'紧急部署',costAtk:90,costDef:60,cd:120,dur:25},
  march:    {n:'急行军',  cd:90,dur:30},
  smoke:    {n:'烟幕支援',cost:16,cd:45,radius:72,dur:16,friendlyRange:330},
};
const DIFFS={
  easy:  {n:'新兵',interval:4.4,cpMul:0.76,skill:0.12,maxUnits:80,statMul:1.0},
  normal:{n:'老兵',interval:2.9,cpMul:1.00,skill:0.42,maxUnits:80,statMul:1.2},
  hard:  {n:'王牌',interval:2.0,cpMul:1.26,skill:0.78,maxUnits:80,statMul:1.5},
};
const SEASONS={
  spring:{n:'春',icon:'🌸',cpMul:1.15,dmgMul:1.00,spdMul:1.00,visMul:1.00,desc:'CP +15%'},
  summer:{n:'夏',icon:'☀',cpMul:1.00,dmgMul:1.10,spdMul:1.00,visMul:1.00,desc:'伤害 +10%'},
  autumn:{n:'秋',icon:'🍂',cpMul:1.00,dmgMul:1.00,spdMul:1.15,visMul:1.00,desc:'速度 +15%'},
  winter:{n:'冬',icon:'❄',cpMul:1.00,dmgMul:1.00,spdMul:0.90,visMul:0.90,desc:'速度 -10% 视野 -10%'},
};
function seasonMul(v){return 1+(v-1)*0.7;}
const SQUAD_COLORS=['#ff6b6b','#ffb84d','#ffe066','#7dff8a','#66e0ff','#6b8aff','#a76bff','#ff6bde','#ffffff'];
const DEF_DEPLOY_COST_MUL = 1.15;
const DEPLOY_HOTKEYS={z:'inf',x:'scout',c:'eng',v:'arm',b:'art',n:'trench'};
const OBSERVE_TIME=0.8;
const OBSERVE_GRACE=1.0;

/* ============ 据点类型定义 ============ */
const POST_TYPES={
  hq:{n:'大本营',cap:100,integrate:10,deploySpeedMul:1.5,costMul:0.5,radius:150,value:0},
  branch:{n:'支部',cap:80,integrate:8,deploySpeedMul:0.6,costMul:0.8,radius:110,value:3},
  point:{n:'据点',cap:70,integrate:7,deploySpeedMul:1.0,costMul:1.0,radius:90,value:2},
};
/* ============ 配置 ============ */
function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const qualitySetting = readSetting('v24q');
const fpsSetting = Number(readSetting('v24f'));
const CFG = {
  quality: ['low', 'mid', 'high'].includes(qualitySetting) ? qualitySetting : 'mid',
  fps: [30, 45, 60].includes(fpsSetting) ? fpsSetting : 60,
  fx: readSetting('v24fx') !== '0',
  shake: readSetting('v24sh') !== '0',
  snd: readSetting('v24snd') !== '0',
  sndUi: readSetting('v24sndUi') !== '0',
  sndBattle: readSetting('v24sndB') !== '0',
  sndAmbient: readSetting('sfAmbient') !== '0',
  volume: clamp(Number(readSetting('sfVolume') ?? 70) || 0, 0, 100),
};
function saveCfg(){
  try{
    localStorage.v24q=CFG.quality;localStorage.v24f=CFG.fps;
    localStorage.v24fx=CFG.fx?'1':'0';localStorage.v24sh=CFG.shake?'1':'0';
    localStorage.v24snd=CFG.snd?'1':'0';localStorage.v24sndUi=CFG.sndUi?'1':'0';
    localStorage.v24sndB=CFG.sndBattle?'1':'0';
    localStorage.sfAmbient=CFG.sndAmbient?'1':'0';
    localStorage.sfVolume=CFG.volume;
  }catch(e){}
}

let G=null;

function encodeCells(cells) {
  return btoa(String.fromCharCode(...cells));
}

function decodeCells(encoded, length, maxValue) {
  if (typeof encoded !== 'string') return null;
  try {
    const text = atob(encoded);
    if (text.length !== length) return null;
    const cells = Uint8Array.from(text, char => char.charCodeAt(0));
    return cells.every(value => value <= maxValue) ? cells : null;
  } catch {
    return null;
  }
}
