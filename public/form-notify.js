// FORM · Body Lab — 智能提醒引擎 v2
// 4 个有脑子的通知，每个都从 Supabase 拉实时数据。
//
// iOS 自动化设置：
//   07:35 → slot: morning
//   13:00 → slot: afternoon
//   21:30 → slot: evening
//   周日 21:00 → slot: weekly_review
//
// ⚠️ 填好下面两行（和 index.html 里一致）
const SUPABASE_URL = "https://urduzohozghrfgwsvamy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50";

// ── 常量 ──────────────────────────────────────────────────────
const PLAN_QUEUE_DEF = ['push','pull','cardio','legs','shoulder','cardio','rest'];
const TRAIN_LABEL_MAP = {
  push:'推日（胸·侧束·三头）',pull:'拉日（背·二头）',cardio:'有氧+核心日',
  legs:'腿日（股四·后链·臀）',shoulder:'肩日（三角肌）',rest:'休息日',
};
const STRENGTH_TYPES = ['push','pull','legs','shoulder'];
// 全阶段宏量（与 COLE_PLAN 一致）
const COLE_PLAN = {
  cut: {
    train: { protein: 168, carbs: 220, fat: 75, kcal: 2220 },
    rest:  { protein: 168, carbs: 140, fat: 80, kcal: 1950 },
  },
  recomp: {
    train: { protein: 168, carbs: 275, fat: 92, kcal: 2620 },
    rest:  { protein: 168, carbs: 210, fat: 92, kcal: 2450 },
  },
  bulk: {
    train: { protein: 168, carbs: 335, fat: 100, kcal: 2970 },
    rest:  { protein: 168, carbs: 245, fat: 100, kcal: 2650 },
  },
  deload: {
    train: { protein: 168, carbs: 255, fat: 90, kcal: 2420 },
    rest:  { protein: 168, carbs: 255, fat: 90, kcal: 2420 },
  },
};

// ── 工具 ──────────────────────────────────────────────────────
function pad(n){return String(n).padStart(2,'0');}
function localDateStr(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function localMidnightISO(d=new Date()){const x=new Date(d);x.setHours(0,0,0,0);return x.toISOString();}
function weekAgoISO(){const d=new Date();d.setDate(d.getDate()-7);d.setHours(0,0,0,0);return d.toISOString();}
function getQueueTypeForDate(dateStr,anchor){
  const anchorDate=new Date(anchor.date+'T00:00:00');
  const targetDate=new Date(dateStr+'T00:00:00');
  const diffDays=Math.round((targetDate-anchorDate)/86400000);
  const len=PLAN_QUEUE_DEF.length;
  const idx=((anchor.index+diffDays)%len+len)%len;
  return PLAN_QUEUE_DEF[idx];
}
function getElevenWeekStatus(plan11){
  const start=new Date(plan11.startDate+'T00:00:00');
  const diffDays=Math.floor((Date.now()-start.getTime())/86400000);
  let wn=Math.floor(diffDays/7)+1;
  const done=wn>plan11.totalWeeks;
  if(done)wn=plan11.totalWeeks;
  const idx=Math.max(0,Math.min(plan11.totalWeeks-1,wn-1));
  return{weekNum:wn,done,isDietBreak:!done&&wn===plan11.dietBreakWeek,targetWeight:plan11.weeklyTargetWeights[idx]};
}

async function sb(path){
  const req=new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  req.headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`};
  return await req.loadJSON();
}
async function getProfile(){
  const rows=await sb('user_settings?id=eq.default&select=profile_json');
  try{return JSON.parse(rows?.[0]?.profile_json||'{}');}catch(e){return{};}
}

function calcTargets(profile){
  const anchor=profile.queue_anchor||{date:localDateStr(),index:0};
  const todayType=getQueueTypeForDate(localDateStr(),anchor);
  const label=TRAIN_LABEL_MAP[todayType]||todayType;
  const phase=profile.plan_phase||'cut';
  const plan=COLE_PLAN[phase]||COLE_PLAN.cut;
  const isTrain=todayType!=='rest';
  let nums=isTrain?plan.train:plan.rest;
  let week=null,isDietBreak=false;

  if(phase==='cut'&&profile.plan_11week){
    const plan11=profile.plan_11week;
    week=getElevenWeekStatus(plan11);
    if(week.isDietBreak){
      const overGain=!!profile.diet_break_overgain;
      const dbm=plan11.dietBreakMacros;
      const kcal=overGain?plan11.dietBreakOverGainKcal:dbm.kcal;
      nums={protein:dbm.protein,carbs:overGain?Math.round((kcal-dbm.protein*4-dbm.fat*9)/4):dbm.carbs,fat:dbm.fat,kcal};
      isDietBreak=true;
    }else{
      const adj=profile.kcal_adjustment||0;
      if(adj!==0)nums={protein:nums.protein,fat:nums.fat,carbs:Math.max(0,nums.carbs+Math.round(adj/4)),kcal:nums.kcal+adj};
    }
  }else if(phase==='cut'){
    const adj=profile.kcal_adjustment||0;
    if(adj!==0)nums={protein:nums.protein,fat:nums.fat,carbs:Math.max(0,nums.carbs+Math.round(adj/4)),kcal:nums.kcal+adj};
  }

  return{label,todayType,isTrain,isDietBreak,week,...nums};
}

async function getTodayFood(){
  const rows=await sb(`food_logs?select=protein_g,kcal&logged_at=gte.${encodeURIComponent(localMidnightISO())}`);
  return(rows||[]).reduce((a,r)=>({protein:a.protein+(r.protein_g||0),kcal:a.kcal+(r.kcal||0)}),{protein:0,kcal:0});
}
async function getTodaySessions(){
  const today=new Date().toISOString().slice(0,10);
  const rows=await sb(`sessions?select=trained_at,volume&trained_at=gte.${encodeURIComponent(today+'T00:00:00')}&trained_at=lte.${encodeURIComponent(today+'T23:59:59')}`);
  return rows||[];
}
async function getRecentSessions7(){
  const rows=await sb(`sessions?select=trained_at&trained_at=gte.${encodeURIComponent(weekAgoISO())}`);
  return rows||[];
}
async function getLatestWeight(){
  const rows=await sb('body_stats?select=weight_kg,recorded_at&weight_kg=not.is.null&order=recorded_at.desc&limit=1');
  return rows?.[0]||null;
}
async function get7DayWeightAvg(){
  const since=new Date();since.setDate(since.getDate()-7);since.setHours(0,0,0,0);
  const rows=await sb(`body_stats?select=weight_kg,recorded_at&weight_kg=not.is.null&order=recorded_at.asc&recorded_at=gte.${encodeURIComponent(since.toISOString())}`);
  const byDay={};
  (rows||[]).forEach(r=>{byDay[r.recorded_at.slice(0,10)]=r.weight_kg;});
  const vals=Object.values(byDay);
  if(vals.length<5)return null;
  return{avg:vals.reduce((a,v)=>a+v,0)/vals.length,n:vals.length};
}

async function notify(title,body,sound='default'){
  const n=new Notification();
  n.title=title;n.body=body;n.sound=sound;
  await n.schedule();
}

// ── 主逻辑 ────────────────────────────────────────────────────
async function run(){
  const slot=args.shortcutParameter||'test';
  const profile=await getProfile();

  // 检查提醒是否暂停
  const pausedUntil=profile.notify_paused_until;
  if(pausedUntil&&pausedUntil!=='0'&&Date.now()<new Date(pausedUntil).getTime()){
    // 静默退出，不打扰
    Script.complete();
    return;
  }

  const tgt=calcTargets(profile);
  const isStrength=STRENGTH_TYPES.includes(tgt.todayType);
  const isCardio=tgt.todayType==='cardio';
  const isRest=tgt.todayType==='rest';
  const tomorrowType=(()=>{
    const anchor=profile.queue_anchor||{date:localDateStr(),index:0};
    const t=new Date();t.setDate(t.getDate()+1);
    return getQueueTypeForDate(t.toISOString().slice(0,10),anchor);
  })();
  const tomorrowLabel=TRAIN_LABEL_MAP[tomorrowType]||tomorrowType;

  switch(slot){

    // ══ 早晨 07:35 — 今天是什么日子 / 目标 / 记得称 ══
    case 'morning':{
      if(isRest){
        await notify('😴 休息日',`今天不训练，保证蛋白${tgt.protein}g，碳水控在${tgt.carbs}g。晨称别忘了。`);
        return;
      }
      const lw=await getLatestWeight();
      const wStr=lw&&new Date(lw.recorded_at).toDateString()===new Date().toDateString()
        ?`✓ 已称 ${lw.weight_kg.toFixed(1)}kg`
        :'⚠ 还没称，现在去';
      const kg=tgt.isDietBreak?`🔥 Diet Break ${tgt.kcal}kcal`:`${tgt.kcal}kcal`;
      const slot=profile.training_slot||'morning';
      let preTrainNote='';
      if(slot==='evening'){
        preTrainNote=isStrength
          ?'下班后去健身房 → 练前餐18:30吃（乳清+香蕉）→ 19:00训练'
          :'下班后去 → 19:00有氧+核心(45min)';
      }else{
        preTrainNote=isStrength
          ?'出门前：黑咖啡+半根香蕉 → 07:55出门 → 08:10训练'
          :'出门前：黑咖啡 → 08:30出门 → 08:45有氧+核心(45min)';
      }
      const label=isStrength?`💪 ${tgt.label}`:`🚴 ${tgt.label}`;
      await notify(
        `${label} · ${kg}`,
        `${wStr} | 蛋白${tgt.protein}g · 碳水${tgt.carbs}g · 脂肪${tgt.fat}g\n${preTrainNote}`
      );
      return;
    }

    // ══ 午后 13:00 — 蛋白吃了多少 / 还差多少 / 晚上怎么补 ══
    case 'afternoon':{
      const food=await getTodayFood();
      const pct=Math.round(food.protein/tgt.protein*100);
      const gap=Math.max(0,tgt.protein-Math.round(food.protein));
      const kcalLeft=Math.max(0,tgt.kcal-Math.round(food.kcal));
      const dayLabel=isRest?'休息日':tgt.label;

      if(pct>=90){
        await notify(`✅ ${dayLabel} · 蛋白已近达标`,`已完成 ${Math.round(food.protein)}/${tgt.protein}g (${pct}%)，剩余热量${kcalLeft}kcal，正常吃就行`);
        return;
      }
      if(pct>=50){
        await notify(`📊 ${dayLabel} · 蛋白过半`,`已完成 ${Math.round(food.protein)}/${tgt.protein}g（${pct}%），还差${gap}g，剩余热量${kcalLeft}kcal。晚餐优先补蛋白`);
        return;
      }
      // <50% — 落后了
      await notify(
        `⚠️ ${dayLabel} · 蛋白落后`,
        `只完成 ${Math.round(food.protein)}/${tgt.protein}g（${pct}%），还差${gap}g。下午加餐一勺乳清或即食鸡胸，晚餐压力会小很多`
      );
      return;
    }

    // ══ 晚间 21:30 — 今天达标了吗 / 训练做了吗 / 明天是什么 ══
    case 'evening':{
      const food=await getTodayFood();
      const proteinHit=Math.round(food.protein)>=tgt.protein;
      const gap=Math.max(0,tgt.protein-Math.round(food.protein));
      const kcalLeft=Math.max(0,tgt.kcal-Math.round(food.kcal));

      // 查今天训练了没
      const todaySessions=await getTodaySessions();
      const trainedToday=todaySessions.length>0;
      const isTrainDay=!isRest&&!tgt.isDietBreak; // 今天本应训练吗

      let trainLine='';
      if(isTrainDay&&!trainedToday){
        trainLine=`⚠ 今天${tgt.label}还缺训练记录，现在补还来得及。`;
      }else if(trainedToday){
        const vol=todaySessions.reduce((a,s)=>a+(s.volume||0),0);
        trainLine=`✓ 今天已训练，容量${Math.round(vol)}kg·r。`;
      }else if(isRest){
        trainLine='休息日，明天'+tomorrowLabel+'。';
      }

      let proteinLine='';
      if(proteinHit){
        proteinLine=`✅ 蛋白达标 ${Math.round(food.protein)}/${tgt.protein}g`;
      }else{
        proteinLine=`蛋白还差${gap}g（${Math.round(food.protein)}/${tgt.protein}g），临睡前补一份乳清`;
      }

      const lw=await getLatestWeight();
      const wStr=lw&&new Date(lw.recorded_at).toDateString()===new Date().toDateString()
        ?''
        :'\n⚠ 今天还没称体重，现在去。';

      // 计算明天碳水目标
      const tomorrowPlan=COLE_PLAN[profile.plan_phase||'cut']||COLE_PLAN.cut;
      const tomorrowIsRest=tomorrowType==='rest';
      let tomorrowCarbs=tomorrowIsRest?tomorrowPlan.rest.carbs:tomorrowPlan.train.carbs;
      // 如果 cut 阶段有 kcal 微调，明天也适用
      if((profile.plan_phase||'cut')==='cut'){
        const adj=profile.kcal_adjustment||0;
        if(adj!==0)tomorrowCarbs=Math.max(0,tomorrowCarbs+Math.round(adj/4));
      }

      await notify(
        `🌙 今日收尾 · ${tgt.label}`,
        `${proteinLine}\n${trainLine}\n明天 ${tomorrowLabel}，碳水${tomorrowCarbs}g${wStr}`
      );
      return;
    }

    // ══ 周日 21:00 — 周复盘 ══
    case 'weekly_review':{
      if(tgt.week?.done){
        await notify('🎉 11周计划完成','进入终测窗口，去App查看最终数据。');
        return;
      }
      if(tgt.week?.isDietBreak){
        await notify('🍽️ Diet Break周复盘',`本周固定${tgt.kcal}kcal，去App查看体重涨幅是否正常。`);
        return;
      }
      const w=await get7DayWeightAvg();
      if(!w){
        await notify('📋 周复盘','本周体重记录不足5天，checkpoint可能不准确，去App看看。');
        return;
      }
      const target=tgt.week?.targetWeight??0;
      const diff=w.avg-target;
      let msg=`7日均值 ${w.avg.toFixed(2)}kg vs 目标 ${target}kg，差 ${diff>0?'+':''}${diff.toFixed(2)}kg。`;
      if(diff>0.3)msg+='连续2周超0.3→下调100kcal。';
      else if(diff<-0.4)msg+='脱速偏快→上调100kcal。';
      else msg+='在范围内，维持热量。';
      await notify(`📋 第${tgt.week.weekNum}周复盘`,msg+' — 去App执行调整');
      return;
    }

    default:{
      await notify('FORM','测试：'+tgt.label+' · 蛋白'+tgt.protein+'g');
      return;
    }
  }
}

await run();
Script.complete();
