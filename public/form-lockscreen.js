// FORM · Body Lab — 锁屏看板
// Scriptable 锁屏 Widget（矩形 / 内联 / 圆形）
//
// 安装：
//   1. 长按锁屏 → 自定义 → 添加 Widget → Scriptable
//   2. 选矩形区域 → 编辑 Widget → 选此脚本
//   3. 可同时添加内联（时钟上方文字）和圆形（时钟下方小圈）
//
// ⚠️ 填入你的 Supabase 信息（和 index.html 一致）
const SUPABASE_URL = "https://urduzohozghrfgwsvamy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50";

// ── 常量（与 sync-store.js 一致）─────────────────────────────
const PLAN_QUEUE_DEF = ['push','pull','cardio','legs','shoulder','cardio','rest'];
const TRAIN_LABEL = { push:'推日', pull:'拉日', cardio:'有氧日', legs:'腿日', shoulder:'肩日', rest:'休息日' };
const TRAIN_ICON = { push:'💪', pull:'🔙', cardio:'🚴', legs:'🦵', shoulder:'👆', rest:'😴' };
const COLE = {
  cut:{ train:{p:168,c:220,f:75,k:2220}, rest:{p:168,c:140,f:80,k:1950} },
  recomp:{ train:{p:168,c:275,f:92,k:2620}, rest:{p:168,c:210,f:92,k:2450} },
  bulk:{ train:{p:168,c:335,f:100,k:2970}, rest:{p:168,c:245,f:100,k:2650} },
  deload:{ train:{p:168,c:255,f:90,k:2420}, rest:{p:168,c:255,f:90,k:2420} },
};

function pad(n){return String(n).padStart(2,'0');}
function localDateStr(d){d=d||new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function localMidnightISO(){const d=new Date();d.setHours(0,0,0,0);return d.toISOString();}

async function sb(path){
  const r=new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  r.headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`};
  return await r.loadJSON();
}

async function getData(){
  const [profileRows,foodRows,sessionRows] = await Promise.all([
    sb('user_settings?id=eq.default&select=profile_json').catch(()=>[]),
    sb(`food_logs?select=protein_g,kcal&logged_at=gte.${encodeURIComponent(localMidnightISO())}`).catch(()=>[]),
    sb(`sessions?select=trained_at&trained_at=gte.${encodeURIComponent(new Date(Date.now()-7*864e5).toISOString())}`).catch(()=>[]),
  ]);

  let profile={};
  try{profile=JSON.parse(profileRows?.[0]?.profile_json||'{}');}catch(e){}

  const anchor=profile.queue_anchor||{date:localDateStr(),index:0};
  const today=localDateStr();
  const anchorDate=new Date(anchor.date+'T00:00:00');
  const targetDate=new Date(today+'T00:00:00');
  const diffDays=Math.round((targetDate-anchorDate)/86400000);
  const idx=((anchor.index+diffDays)%7+7)%7;
  const todayType=PLAN_QUEUE_DEF[idx];

  const phase=profile.plan_phase||'cut';
  const plan=COLE[phase]||COLE.cut;
  const isTrain=todayType!=='rest';
  let nums=isTrain?plan.train:plan.rest;

  // diet break / kcal 微调
  const plan11=profile.plan_11week;
  if(phase==='cut'&&plan11){
    const start=new Date(plan11.startDate+'T00:00:00');
    const dDays=Math.floor((Date.now()-start.getTime())/86400000);
    let wn=Math.floor(dDays/7)+1;
    if(wn>plan11.totalWeeks)wn=plan11.totalWeeks;
    const isDB=!((wn>plan11.totalWeeks)||wn!==plan11.dietBreakWeek);
    if(isDB){
      const dbm=plan11.dietBreakMacros;
      const over=!!profile.diet_break_overgain;
      const k=over?plan11.dietBreakOverGainKcal:dbm.kcal;
      nums={p:dbm.protein,c:over?Math.round((k-dbm.protein*4-dbm.fat*9)/4):dbm.carbs,f:dbm.fat,k};
    }else{
      const adj=profile.kcal_adjustment||0;
      if(adj!==0)nums={p:nums.p,f:nums.f,c:Math.max(0,nums.c+Math.round(adj/4)),k:nums.k+adj};
    }
  }

  const eatenProtein=(foodRows||[]).reduce((a,r)=>a+(r.protein_g||0),0);
  const eatenKcal=(foodRows||[]).reduce((a,r)=>a+(r.kcal||0),0);
  const trained7=(sessionRows||[]).filter(s=>Date.now()-new Date(s.trained_at).getTime()<7*864e5).length;

  return {
    todayType, label:TRAIN_LABEL[todayType]||todayType, icon:TRAIN_ICON[todayType]||'',
    protein:eatenProtein, kcal:eatenKcal,
    tProtein:nums.p, tKcal:nums.k,
    proteinPct:nums.p?Math.round(eatenProtein/nums.p*100):0,
    trained7,
  };
}

// ── 渲染 ──────────────────────────────────────────────────────
async function createWidget(){
  const d=await getData();
  const fam=config.widgetFamily||'accessoryRectangular';
  const w=new ListWidget();

  if(fam==='accessoryInline'){
    // 时钟上方一行字
    w.addText(`${d.icon}${d.label} · 蛋白${d.proteinPct}%`);
    Script.setWidget(w);
    return;
  }

  if(fam==='accessoryCircular'){
    // 时钟下方小圈
    const t=w.addText(`${d.proteinPct}`);
    t.font=Font.boldSystemFont(18);
    t.centerAlignText();
    const pct=d.tProtein?Math.min(1,d.protein/d.tProtein):0;
    t.textColor=pct>=1?new Color('#7CFFB2'):pct>=.5?new Color('#FFC857'):new Color('#E85858');
    Script.setWidget(w);
    return;
  }

  // ── 矩形（默认，最实用）─────────────────────────────────
  w.backgroundColor=new Color('#0d0d10');
  w.setPadding(10,14,10,14);

  const ACCENT=new Color('#7CFFB2');
  const WARN=new Color('#FFC857');
  const DIM=new Color('#ffffff',.45);

  // 第一行：图标 + 训练类型 + 训练次数
  const r1=w.addStack();
  r1.centerAlignContent();
  const icon=r1.addText(d.icon+' ');
  icon.font=Font.systemFont(14);
  const label=r1.addText(d.label);
  label.font=Font.boldSystemFont(14);
  label.textColor=Color.white();
  r1.addSpacer();
  const tr=r1.addText(`${d.trained7}/6`);
  tr.font=Font.systemFont(11);
  tr.textColor=d.trained7>=5?ACCENT:WARN;

  w.addSpacer(4);

  // 第二行：蛋白进度条
  const r2=w.addStack();
  r2.centerAlignContent();
  const pl=r2.addText('蛋白 ');
  pl.font=Font.systemFont(10);
  pl.textColor=DIM;
  const pBar=r2.addStack();
  pBar.size=new Size(80,5);
  pBar.backgroundColor=new Color('#ffffff',.1);
  pBar.cornerRadius=3;
  const pFill=r2.addStack();
  pFill.size=new Size(Math.max(2,80*Math.min(1,d.protein/d.tProtein)),5);
  pFill.backgroundColor=d.proteinPct>=100?ACCENT:d.proteinPct>=50?WARN:new Color('#E85858');
  pFill.cornerRadius=3;
  r2.addSpacer(80-Math.max(2,80*Math.min(1,d.protein/d.tProtein)));
  r2.addSpacer(6);
  const pv=r2.addText(`${Math.round(d.protein)}/${d.tProtein}`);
  pv.font=Font.systemFont(10);
  pv.textColor=Color.white();

  w.addSpacer(3);

  // 第三行：热量进度条
  const r3=w.addStack();
  r3.centerAlignContent();
  const kl=r3.addText('热量 ');
  kl.font=Font.systemFont(10);
  kl.textColor=DIM;
  const kBar=r3.addStack();
  kBar.size=new Size(80,5);
  kBar.backgroundColor=new Color('#ffffff',.1);
  kBar.cornerRadius=3;
  const kFill=r3.addStack();
  kFill.size=new Size(Math.max(2,80*Math.min(1,d.kcal/d.tKcal)),5);
  kFill.backgroundColor=new Color('#B49AFF');
  kFill.cornerRadius=3;
  r3.addSpacer(80-Math.max(2,80*Math.min(1,d.kcal/d.tKcal)));
  r3.addSpacer(6);
  const kv=r3.addText(`${Math.round(d.kcal)}/${d.tKcal}`);
  kv.font=Font.systemFont(10);
  kv.textColor=Color.white();

  Script.setWidget(w);
}

await createWidget();
Script.complete();
