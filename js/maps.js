"use strict";

/* ============ 地图辅助 ============ */
function isLand(t,x,y){const v=t[y*MAP_W+x];return v!==T_WATER&&v!==T_MOUNT&&v!==T_BUILDING;}
function placeOnLand(t,x,y){x=clamp(Math.round(x),1,MAP_W-2);y=clamp(Math.round(y),1,MAP_H-2);if(isLand(t,x,y))return{x,y};for(let r=1;r<24;r++){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=MAP_W||ny>=MAP_H)continue;if(isLand(t,nx,ny))return{x:nx,y:ny};}}return{x,y};}
function flatten(t,x,y,r){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=MAP_W||ny>=MAP_H)continue;if(dx*dx+dy*dy>r*r)continue;const v=t[ny*MAP_W+nx];if(v===T_MOUNT||v===T_WATER||v===T_BUILDING)t[ny*MAP_W+nx]=T_PLAIN;}}
function carveRoad(t,x1,y1,x2,y2,w){w=w||0;const steps=Math.ceil(dist(x1,y1,x2,y2)*2);for(let i=0;i<=steps;i++){const p=i/steps;const cx=Math.round(lerp(x1,x2,p)),cy=Math.round(lerp(y1,y2,p));for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=MAP_W||ny>=MAP_H)continue;const v=t[ny*MAP_W+nx];if(v===T_MOUNT||v===T_WATER||v===T_PLAIN||v===T_SAND||v===T_FOREST)t[ny*MAP_W+nx]=T_ROAD;}}}
function carvePath(t,x1,y1,x2,y2,w,terr){w=w||0;const steps=Math.ceil(dist(x1,y1,x2,y2)*2);for(let i=0;i<=steps;i++){const p=i/steps;const cx=Math.round(lerp(x1,x2,p)),cy=Math.round(lerp(y1,y2,p));for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=MAP_W||ny>=MAP_H)continue;t[ny*MAP_W+nx]=terr;}}}

/* ============ 地图生成器 ============ */
function genIsland(){
  MAP_W=80;MAP_H=56;
  const t=new Uint8Array(MAP_W*MAP_H);
  const cx0=MAP_W*.5, cy0=MAP_H*.44;
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    const dx=(x-cx0)/(MAP_W*.36),dy=(y-cy0)/(MAP_H*.38);
    let d=Math.sqrt(dx*dx+dy*dy)+(fbm(x*.08,y*.08,7,4)-.5)*.92;
    let v;if(d<.68)v=T_PLAIN;else if(d<.90)v=T_SAND;else v=T_WATER;
    if(v===T_PLAIN){
      const f=fbm(x*.145+77,y*.145+77,41,3);
      const mdx=(x-MAP_W*.5)/(MAP_W*.22), mdy=(y-MAP_H*.42)/(MAP_H*.26);
      const mdist=Math.sqrt(mdx*mdx+mdy*mdy);
      if(mdist<1.0 && fbm(x*.14,y*.14,23,3)>.42)v=T_MOUNT;
      else if(f>.575)v=T_FOREST;
    }
    t[y*MAP_W+x]=v;
  }
  carvePath(t,MAP_W*.5,MAP_H*.28,MAP_W*.5,MAP_H*.55,0,T_PLAIN);
  carvePath(t,MAP_W*.38,MAP_H*.42,MAP_W*.62,MAP_H*.42,0,T_PLAIN);
  carvePath(t,MAP_W*.5,MAP_H*.35,MAP_W*.66,MAP_H*.5,0,T_PLAIN);
  /* 恢复：hq + 4 支部 + 1 据点 */
  const posts=[
    {x:40,y:11,type:'hq',name:'守军大本营'},
    {x:13,y:24,type:'branch',name:'西港支部'},
    {x:67,y:24,type:'branch',name:'东岭支部'},
    {x:18,y:44,type:'branch',name:'南滩支部'},
    {x:62,y:44,type:'branch',name:'椰林支部'},
    {x:40,y:34,type:'point',name:'中部哨站'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,16,52),placeOnLand(t,64,52)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[0];
  for(let i=1;i<posts.length;i++)carveRoad(t,posts[0].x,posts[0].y,posts[i].x,posts[i].y,0);
  spawns.forEach(s=>carveRoad(t,posts[0].x,posts[0].y,s.x,s.y,0));
  const turrets=[{x:40,y:7,type:'fort'},{x:34,y:15,type:'mg'},{x:46,y:15,type:'mg'},{x:13,y:20,type:'at'},{x:67,y:20,type:'at'},{x:18,y:40,type:'mg'},{x:62,y:40,type:'mg'},{x:32,y:26,type:'bunker'},{x:48,y:26,type:'bunker'},{x:28,y:32,type:'watchtower'},{x:52,y:32,type:'watchtower'},{x:8,y:32,type:'watchtower'},{x:72,y:32,type:'watchtower'},{x:20,y:18,type:'watchtower'},{x:60,y:18,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  return {terrain:t,posts,spawn,spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'volcano'};
}
function genValley(random){
  MAP_W=72;MAP_H=56;
  const t=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    const cx=MAP_W*.5;
    let halfW=14+Math.sin(y*.16)*3.2+(fbm(x*.07,y*.07,5,3)-.5)*7;
    if(y>MAP_H*.75) halfW+=8;
    const dd=Math.abs(x-cx);let v;
    if(dd<halfW-3.5)v=T_PLAIN;else if(dd<halfW)v=T_SAND;else v=T_MOUNT;
    if(v===T_PLAIN){const f=fbm(x*.13+31,y*.13+31,61,3);if(f>.615)v=T_FOREST;}
    t[y*MAP_W+x]=v;
  }
  for(let i=0;i<8;i++){
    const y=8+i*6+lerp(-1,1,random());
    carvePath(t,MAP_W*.5,y,MAP_W*.15,y+lerp(-8,8,random()),0,T_PLAIN);
    carvePath(t,MAP_W*.5,y+3,MAP_W*.85,y+lerp(-8,8,random()),0,T_PLAIN);
  }
  /* 山地图：支部保持削减后的 2 个 */
  const posts=[
    {x:36,y:9,type:'hq',name:'守军大本营'},
    {x:22,y:24,type:'branch',name:'西谷口支部'},
    {x:50,y:24,type:'branch',name:'东谷口支部'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,22,52),placeOnLand(t,36,52),placeOnLand(t,50,52)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[1];
  carveRoad(t,posts[0].x,posts[0].y,posts[1].x,posts[1].y,1);
  carveRoad(t,posts[0].x,posts[0].y,posts[2].x,posts[2].y,1);
  carveRoad(t,36,9,spawn.x,spawn.y,1);
  const turrets=[{x:36,y:5,type:'fort'},{x:30,y:13,type:'mg'},{x:42,y:13,type:'mg'},{x:22,y:18,type:'at'},{x:50,y:18,type:'at'},{x:22,y:36,type:'mg'},{x:50,y:36,type:'mg'},{x:30,y:26,type:'bunker'},{x:42,y:26,type:'bunker'},{x:34,y:32,type:'watchtower'},{x:38,y:45,type:'watchtower'},{x:26,y:30,type:'watchtower'},{x:46,y:30,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  return {terrain:t,posts,spawn,spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'wildfire'};
}
function genPlain(){
  MAP_W=104;MAP_H=72;
  const t=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    const f=fbm(x*.06+5,y*.06+5,91,5);
    const f2=fbm(x*.18+55,y*.18+55,37,3);
    const m=fbm(x*.09+17,y*.09+17,101,3);
    let v=T_PLAIN;
    if(f>.38 || (f>.30 && f2>.44)) v=T_FOREST;
    if(m>.85 && f<.55)v=T_MOUNT;
    t[y*MAP_W+x]=v;
  }
  const riverY=[12,26,40,55];
  riverY.forEach((ry,i)=>{
    for(let x=2;x<MAP_W-2;x++){
      const wy=Math.round(ry+Math.sin(x*.09+i*1.7)*2.5+Math.sin(x*.29+i)*1.2);
      for(let d=-1;d<=1;d++){const ny=wy+d;if(ny>=0&&ny<MAP_H)t[ny*MAP_W+x]=T_WATER;}
    }
  });
  const hqX=52,hqY=14;
  for(let x=30;x<74;x++){
    const wy=hqY+7+Math.sin(x*.15)*1.5;
    for(let d=-1;d<=1;d++){const ny=Math.round(wy)+d;if(ny>=0&&ny<MAP_H)t[ny*MAP_W+x]=T_WATER;}
  }
  [20,52,84].forEach(bx=>{
    for(let x=bx-1;x<=bx+1;x++){
      for(let y=0;y<MAP_H;y++){
        if(t[y*MAP_W+x]===T_WATER)t[y*MAP_W+x]=T_BRIDGE;
      }
    }
  });
  /* 恢复：hq + 4 支部 + 1 据点 */
  const posts=[
    {x:hqX,y:hqY,type:'hq',name:'守军大本营'},
    {x:16,y:20,type:'branch',name:'林场支部'},
    {x:88,y:26,type:'branch',name:'铁路支部'},
    {x:24,y:54,type:'branch',name:'南村支部'},
    {x:80,y:58,type:'branch',name:'石桥支部'},
    {x:64,y:44,type:'point',name:'中央哨站'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,38,64),placeOnLand(t,52,64),placeOnLand(t,66,64)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[1];
  for(let i=1;i<posts.length;i++)carveRoad(t,posts[0].x,posts[0].y,posts[i].x,posts[i].y,0);
  carveRoad(t,posts[0].x,posts[0].y,spawn.x,spawn.y,0);
  const turrets=[{x:52,y:8,type:'fort'},{x:40,y:18,type:'mg'},{x:64,y:18,type:'mg'},{x:16,y:22,type:'at'},{x:88,y:22,type:'at'},{x:24,y:50,type:'mg'},{x:80,y:50,type:'mg'},{x:36,y:32,type:'bunker'},{x:68,y:32,type:'bunker'},{x:8,y:44,type:'watchtower'},{x:96,y:44,type:'watchtower'},{x:52,y:48,type:'watchtower'},{x:30,y:14,type:'watchtower'},{x:74,y:14,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  return {terrain:t,posts,spawn,spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'wildfire'};
}
function genCity(random){
  MAP_W=112;MAP_H=84;
  const t=new Uint8Array(MAP_W*MAP_H).fill(T_PLAIN);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    if(x<1||y<1||x>MAP_W-2||y>MAP_H-2)t[y*MAP_W+x]=T_MOUNT;
  }
  function cityBlock(cx,cy,w,h,density,roadSpacing){
    for(let y=cy-h;y<cy+h;y++)for(let x=cx-w;x<cx+w;x++){
      if(x<2||y<2||x>MAP_W-3||y>MAP_H-3)continue;
      const isRoad=((x-cx)%roadSpacing===0)||((y-cy)%roadSpacing===0);
      const isAvenue=((x-cx)%(roadSpacing*2)===0)||((y-cy)%(roadSpacing*2)===0);
      if(isRoad||isAvenue)t[y*MAP_W+x]=T_ROAD;
      else if(random()<density)t[y*MAP_W+x]=T_BUILDING;
    }
  }
  cityBlock(28,58,14,11,0.88,4);
  cityBlock(56,42,16,13,0.92,5);
  cityBlock(86,22,15,10,0.68,7);
  for(let y=40;y<64;y++)for(let x=36;x<56;x++){
    if((x-46)*(x-46)+(y-52)*(y-52)<80) t[y*MAP_W+x]=T_ROAD;
  }
  for(let y=2;y<MAP_H-2;y++)for(let x=2;x<MAP_W-2;x++){
    const idx=y*MAP_W+x;
    if(t[idx]!==T_PLAIN)continue;
    const dc=Math.min(dist(x,y,28,58),dist(x,y,56,42),dist(x,y,86,22));
    if(dc<30) continue;
    if(random()<0.05){
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy;
        if(nx<2||ny<2||nx>=MAP_W-2||ny>=MAP_H-2)continue;
        if(t[ny*MAP_W+nx]===T_PLAIN && random()<0.7)t[ny*MAP_W+nx]=T_FOREST;
      }
    }
  }
  for(let y=2;y<MAP_H-2;y++)for(let x=2;x<MAP_W-2;x++){
    const idx=y*MAP_W+x;
    if(t[idx]!==T_PLAIN)continue;
    const dc=Math.min(dist(x,y,28,58),dist(x,y,56,42),dist(x,y,86,22));
    if(dc<30 && random()<0.08) t[idx]=T_FOREST;
  }
  carveRoad(t,28,58,56,42,1);
  carveRoad(t,56,42,86,22,1);
  carveRoad(t,28,58,86,22,1);
  /* 恢复：hq + 4 支部 + 1 据点 */
  const posts=[
    {x:56,y:42,type:'hq',name:'市中央指挥部'},
    {x:28,y:58,type:'branch',name:'老城支部'},
    {x:86,y:22,type:'branch',name:'工业区支部'},
    {x:22,y:22,type:'branch',name:'西北郊支部'},
    {x:90,y:62,type:'branch',name:'东南郊支部'},
    {x:56,y:64,type:'point',name:'南广场哨站'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,44,76),placeOnLand(t,56,76),placeOnLand(t,68,76)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[1];
  const turrets=[{x:56,y:30,type:'fort'},{x:46,y:42,type:'mg'},{x:66,y:42,type:'mg'},{x:28,y:52,type:'at'},{x:86,y:16,type:'at'},{x:28,y:64,type:'mg'},{x:86,y:28,type:'mg'},{x:40,y:50,type:'bunker'},{x:70,y:34,type:'bunker'},{x:14,y:36,type:'watchtower'},{x:100,y:48,type:'watchtower'},{x:56,y:58,type:'watchtower'},{x:38,y:18,type:'watchtower'},{x:80,y:52,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  /* === 城市初始大弹坑（广场区域，遗迹） === */
  for(let y=44;y<=60;y++){
    for(let x=38;x<=54;x++){
      if(x<1||y<1||x>MAP_W-2||y>MAP_H-2)continue;
      const dd=dist(x,y,46,52);
      if(dd<5.5) t[y*MAP_W+x]=T_CRATER;
      else if(dd<7.0 && (t[y*MAP_W+x]===T_BUILDING||t[y*MAP_W+x]===T_FOREST)) t[y*MAP_W+x]=T_RUBBLE;
    }
  }
  /* === 工业区油罐（可视化实体） === */
  const oilTanks=[];
  [[82,17],[89,25],[78,28]].forEach(q=>{
    const p=placeOnLand(t,q[0],q[1]);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=p.x+dx,ny=p.y+dy;
      if(nx<1||ny<1||nx>=MAP_W-1||ny>=MAP_H-1)continue;
      const v=t[ny*MAP_W+nx];
      if(v===T_BUILDING||v===T_FOREST)t[ny*MAP_W+nx]=T_PLAIN;
    }
    oilTanks.push({x:p.x*CELL+CELL/2,y:p.y*CELL+CELL/2,r:22,alive:true});
  });
  return {terrain:t,posts,spawn,spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'oilfire',oilTanks};
}
function genRiver(){
  MAP_W=84;MAP_H=58;
  const t=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    let v=T_PLAIN;
    const f=fbm(x*.12+5,y*.12+5,141,3);if(f>.61)v=T_FOREST;
    const m=fbm(x*.085+99,y*.085+99,73,3);if(m>.79)v=T_MOUNT;
    t[y*MAP_W+x]=v;
  }
  const riverY=[];
  for(let x=0;x<MAP_W;x++){
    const ry=Math.round(26+Math.sin(x*0.16)*3.0+Math.sin(x*0.42)*1.3);
    riverY.push(ry);
    for(let d=-2;d<=2;d++){const ny=ry+d;if(ny>=0&&ny<MAP_H)t[ny*MAP_W+x]=T_WATER;}
  }
  const bridges=[14,42,70];
  bridges.forEach(bx=>{for(let x=bx-1;x<=bx+1;x++)for(let d=-3;d<=3;d++){const ny=riverY[clamp(x,0,MAP_W-1)]+d;if(ny>=0&&ny<MAP_H)t[ny*MAP_W+x]=T_BRIDGE;}});
  for(let x=0;x<MAP_W;x++){
    const ry=riverY[x];
    [ry-3,ry+3].forEach(ny=>{if(ny>=0&&ny<MAP_H){const v=t[ny*MAP_W+x];if(v===T_PLAIN||v===T_FOREST)t[ny*MAP_W+x]=T_SAND;}});
  }
  /* 恢复：hq + 4 支部 + 1 据点 */
  const posts=[
    {x:42,y:11,type:'hq',name:'守军大本营'},
    {x:14,y:22,type:'branch',name:'西桥头支部'},
    {x:70,y:22,type:'branch',name:'东桥头支部'},
    {x:20,y:46,type:'branch',name:'南岸支部'},
    {x:64,y:46,type:'branch',name:'河口支部'},
    {x:42,y:40,type:'point',name:'中流哨站'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,30,52),placeOnLand(t,54,52)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[0];
  bridges.forEach(bx=>carveRoad(t,bx,3,bx,MAP_H-4,0));
  const turrets=[{x:42,y:6,type:'fort'},{x:28,y:16,type:'mg'},{x:56,y:16,type:'mg'},{x:14,y:18,type:'at'},{x:70,y:18,type:'at'},{x:20,y:42,type:'mg'},{x:64,y:42,type:'mg'},{x:32,y:20,type:'bunker'},{x:52,y:20,type:'bunker'},{x:10,y:44,type:'watchtower'},{x:74,y:44,type:'watchtower'},{x:42,y:34,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  return {terrain:t,posts,spawn,spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'wildfire'};
}
function genTutorial(){
  MAP_W=72;MAP_H=50;
  const t=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    let v=T_PLAIN;
    if(x<22 && y<16 && fbm(x*.14,y*.14,3,3)>.55) v=T_FOREST;
    if(x>56 && y>8 && y<34 && fbm(x*.12+11,y*.12+11,9,3)>.68) v=T_MOUNT;
    t[y*MAP_W+x]=v;
  }
  const posts=[{x:14,y:34,type:'hq',name:'我方指挥部',owner:'atk'},{x:36,y:25,type:'branch',name:'中立支部',owner:'neutral'},{x:58,y:25,type:'branch',name:'敌方支部'},{x:58,y:11,type:'hq',name:'敌方指挥部'}];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[placeOnLand(t,10,42),placeOnLand(t,14,34),placeOnLand(t,18,42)];
  spawns.forEach(s=>flatten(t,s.x,s.y,2));
  const spawn=spawns[1];
  carveRoad(t,posts[0].x,posts[0].y,posts[1].x,posts[1].y,0);
  carveRoad(t,posts[1].x,posts[1].y,posts[3].x,posts[3].y,0);
  return {terrain:t,posts,spawn,spawns,turrets:[],mapW:MAP_W,mapH:MAP_H,eventType:null};
}
function genGrand(){
  MAP_W=128;MAP_H=80;
  const t=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    let v=T_PLAIN;
    const f=fbm(x*.075+7,y*.075+7,201,4);
    const m=fbm(x*.06+63,y*.06+63,101,4);
    if(m>.76)v=T_MOUNT;else if(f>.55)v=T_FOREST;
    const riverY=Math.round(40+Math.sin(x*.09)*5+Math.sin(x*.21)*2);
    if(Math.abs(y-riverY)<2)v=T_WATER;
    if(Math.abs(y-riverY)===2 && v===T_PLAIN)v=T_SAND;
    t[y*MAP_W+x]=v;
  }
  [20,44,64,84,108].forEach(bx=>{for(let x=bx-1;x<=bx+1;x++){if(x<0||x>=MAP_W)continue;const ry=Math.round(40+Math.sin(x*.09)*5+Math.sin(x*.21)*2);for(let d=-3;d<=3;d++){const ny=ry+d;if(ny>=0&&ny<MAP_H)t[ny*MAP_W+x]=T_BRIDGE;}}});
  /* 恢复 10 据点：2 hq + 4 支部 + 4 据点 */
  const posts=[
    {x:64,y:14,type:'hq',name:'北军指挥部'},
    {x:30,y:20,type:'branch',name:'西北支部'},
    {x:98,y:20,type:'branch',name:'东北支部'},
    {x:20,y:40,type:'point',name:'西岸据点'},
    {x:108,y:40,type:'point',name:'东岸据点'},
    {x:30,y:60,type:'point',name:'西南据点'},
    {x:98,y:60,type:'point',name:'东南据点'},
    {x:64,y:66,type:'hq',name:'南军指挥部'},
    {x:20,y:66,type:'point',name:'西南渡口'},
    {x:108,y:66,type:'point',name:'东南渡口'},
  ];
  posts.forEach(p=>{const q=placeOnLand(t,p.x,p.y);p.x=q.x;p.y=q.y;flatten(t,p.x,p.y,2);});
  const spawns=[{x:10,y:10},{x:118,y:10},{x:10,y:70},{x:118,y:70}].map(s=>{const q=placeOnLand(t,s.x,s.y);flatten(t,q.x,q.y,2);return q;});
  carveRoad(t,spawns[0].x,spawns[0].y,posts[0].x,posts[0].y,1);
  carveRoad(t,spawns[1].x,spawns[1].y,posts[0].x,posts[0].y,1);
  carveRoad(t,spawns[2].x,spawns[2].y,posts[7].x,posts[7].y,1);
  carveRoad(t,spawns[3].x,spawns[3].y,posts[7].x,posts[7].y,1);
  carveRoad(t,posts[0].x,posts[0].y,posts[3].x,posts[3].y,0);
  carveRoad(t,posts[0].x,posts[0].y,posts[4].x,posts[4].y,0);
  carveRoad(t,posts[7].x,posts[7].y,posts[3].x,posts[3].y,0);
  carveRoad(t,posts[7].x,posts[7].y,posts[4].x,posts[4].y,0);
  const turrets=[{x:64,y:7,type:'fort'},{x:50,y:14,type:'mg'},{x:78,y:14,type:'mg'},{x:20,y:32,type:'at'},{x:108,y:32,type:'at'},{x:30,y:56,type:'mg'},{x:98,y:56,type:'mg'},{x:64,y:73,type:'fort'},{x:50,y:66,type:'mg'},{x:78,y:66,type:'mg'},{x:40,y:26,type:'bunker'},{x:88,y:26,type:'bunker'},{x:40,y:54,type:'bunker'},{x:88,y:54,type:'bunker'},{x:14,y:20,type:'watchtower'},{x:114,y:20,type:'watchtower'},{x:14,y:60,type:'watchtower'},{x:114,y:60,type:'watchtower'},{x:20,y:14,type:'watchtower'},{x:108,y:14,type:'watchtower'},{x:20,y:74,type:'watchtower'},{x:108,y:74,type:'watchtower'}];
  turrets.forEach(q=>{const p=placeOnLand(t,q.x,q.y);q.x=p.x;q.y=p.y;});
  return {terrain:t,posts,spawn:spawns[0],spawns,turrets,mapW:MAP_W,mapH:MAP_H,eventType:'volcano',isGrand:true};
}
const MAPS=[
  {id:'island',n:'翡翠群岛',desc:'中央山脉，山中有小道。',gen:genIsland,tag:'海岛',maxPlayers:2,small:true},
  {id:'valley',n:'赤石山谷',desc:'两侧绝壁，山外平原进攻山口。',gen:genValley,tag:'山谷',maxPlayers:2,small:true},
  {id:'plain', n:'黑森林平原',desc:'60%密林+横贯河流。',gen:genPlain,tag:'平原+森林',maxPlayers:2,small:true},
  {id:'city',  n:'断壁残城',desc:'多中心城区+广场+大道，工业区有油罐。',gen:genCity,tag:'城市',maxPlayers:2,small:true},
  {id:'river', n:'怒涛渡口',desc:'横贯东西的大河。',gen:genRiver,tag:'河流',maxPlayers:2,small:true},
  {id:'grand', n:'大陆战场',desc:'开阔大陆，3个分散部署点。',gen:genGrand,tag:'大战场',maxPlayers:4,small:false},
  {id:'tutorial',n:'新兵训练',desc:'教学关卡。',gen:genTutorial,tag:'教程',tutorial:true,maxPlayers:1,small:true},
];

function generateMap(mapDef, seed) {
  const width = MAP_W;
  const height = MAP_H;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try {
    return mapDef.gen(random);
  } finally {
    MAP_W = width;
    MAP_H = height;
  }
}
