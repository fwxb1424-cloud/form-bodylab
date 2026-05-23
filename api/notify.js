/**
 * FORM · Body Lab — Telegram 推送 v4
 * Vercel Cron 时间（UTC）→ 北京时间（UTC+8）：
 *   0  UTC  → 08:00 BJ  晨间任务推送
 *   4  UTC  → 12:00 BJ  午间蛋白质检查
 *   7  UTC  → 15:00 BJ  训练日练前餐提醒
 *   12 UTC  → 20:00 BJ  今日收尾 + 睡眠提醒
 *   13 UTC  → 21:00 BJ  数据补录提醒（若有缺失）
 *   13 UTC 周日 → 21:00 BJ  本周执行率复盘
 */

export const config = { runtime: 'edge' };

// ── 计划常量 ─────────────────────────────────────────────
const PROTEIN_TARGET = 168;
const KCAL_TRAIN = 2220;
const KCAL_REST  = 1950;

// 今天是哪类训练日
const PLAN_BY_DOW = {
  1: { type:'push',     label:'推日（胸·侧束）' },
  2: { type:'pull',     label:'拉日（背·二头）' },
  3: { type:'cardio',   label:'有氧日' },
  4: { type:'legs',     label:'腿日' },
  5: { type:'shoulder', label:'肩日（三角肌）' },
  6: { type:'cardio',   label:'有氧日' },
  0: { type:'rest',     label:'休息日' },
};

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const hourUTC = parseInt(url.searchParams.get('hour') ?? new Date().getUTCHours());
  const bjHour  = (hourUTC + 8) % 24;
  const isWeeklyReview = bjHour === 21 && new Date().getDay() === 0; // 周日21点

  try {
    let msg;
    if      (bjHour === 8)  msg = await buildMorning();
    else if (bjHour === 12) msg = await buildNoon();
    else if (bjHour === 15) msg = await buildPreWorkout();
    else if (bjHour === 20) msg = await buildEvening();
    else if (isWeeklyReview) msg = await buildWeeklyReview();
    else if (bjHour === 21) msg = await buildBackfillReminder();
    else return new Response(JSON.stringify({ ok:true, skipped:true }), { headers:{'Content-Type':'application/json'} });

    await sendTG(msg);
    return new Response(JSON.stringify({ ok:true, bjHour, preview:msg.slice(0,80) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch(e) {
    return new Response(JSON.stringify({ ok:false, error:e.message }), { status:500 });
  }
}

// ── Supabase helpers ─────────────────────────────────────
const SB = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY });

async function sbGet(table, query='') {
  const { url, key } = SB();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey:key, Authorization:`Bearer ${key}` },
  });
  return res.ok ? res.json() : [];
}

async function getTodayFood() {
  const bj = new Date(Date.now() + 8*3600000);
  const dateStr = bj.toISOString().slice(0,10);
  const rows = await sbGet('food_logs', `logged_at=gte.${dateStr}T00:00:00+08:00&logged_at=lte.${dateStr}T23:59:59+08:00&select=protein_g,carbs_g,fat_g,kcal`);
  return {
    protein: rows.reduce((a,r)=>a+(r.protein_g||0), 0),
    carbs:   rows.reduce((a,r)=>a+(r.carbs_g||0),   0),
    fat:     rows.reduce((a,r)=>a+(r.fat_g||0),     0),
    kcal:    rows.reduce((a,r)=>a+(r.kcal||0),      0),
    count:   rows.length,
  };
}

async function getTodaySession() {
  const bj = new Date(Date.now() + 8*3600000);
  const dateStr = bj.toISOString().slice(0,10);
  const rows = await sbGet('sessions', `trained_at=gte.${dateStr}T00:00:00+08:00&trained_at=lte.${dateStr}T23:59:59+08:00&select=session_title,volume,muscle_groups,rpe&order=trained_at.desc&limit=1`);
  return rows[0] || null;
}

// 获取过去N天每天是否有记录（检测漏录）
async function getMissingDays(days=3) {
  const missing = [];
  for(let i=1; i<=days; i++){
    const d = new Date(Date.now() + 8*3600000 - i*864e5);
    const dateStr = d.toISOString().slice(0,10);
    const dow = d.getDay();
    const plan = PLAN_BY_DOW[dow];
    const isTrainDay = plan.type !== 'rest' && plan.type !== 'cardio';
    if(!isTrainDay) continue;

    const sessions = await sbGet('sessions',
      `trained_at=gte.${dateStr}T00:00:00+08:00&trained_at=lte.${dateStr}T23:59:59+08:00&select=id`
    );
    const foods = await sbGet('food_logs',
      `logged_at=gte.${dateStr}T00:00:00+08:00&logged_at=lte.${dateStr}T23:59:59+08:00&select=id`
    );
    if(!sessions.length || !foods.length){
      missing.push({
        dateStr, dow,
        label: `${d.getMonth()+1}/${d.getDate()}（周${'日一二三四五六'[dow]}）${plan.label}`,
        missSession: !sessions.length,
        missFood: !foods.length,
      });
    }
  }
  return missing;
}

async function getRecentSleep() {
  const since = new Date(Date.now() - 7*864e5).toISOString();
  const rows = await sbGet('sleep_logs', `logged_at=gte.${since}&select=duration_h,quality,notes`);
  if(!rows.length) return null;
  const avg = rows.reduce((a,r)=>a+(r.duration_h||7),0)/rows.length;
  const latest = rows[rows.length-1];
  const noteMatch = (latest.notes||'').match(/入睡(\d+:\d+)/);
  return { avg:avg.toFixed(1), count:rows.length, latestBedtime:noteMatch?.[1]||null, latestHours:latest.duration_h };
}

async function getWeekStats() {
  const bj = new Date(Date.now() + 8*3600000);
  const dow = bj.getDay();
  const mondayOffset = dow===0?6:dow-1;
  const monday = new Date(bj); monday.setDate(bj.getDate()-mondayOffset); monday.setHours(0,0,0,0);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6); sunday.setHours(23,59,59,999);

  const [sessions, foods, sleeps] = await Promise.all([
    sbGet('sessions', `trained_at=gte.${monday.toISOString()}&trained_at=lte.${sunday.toISOString()}&select=volume,session_title,muscle_groups,trained_at`),
    sbGet('food_logs', `logged_at=gte.${monday.toISOString()}&logged_at=lte.${sunday.toISOString()}&select=protein_g,kcal,logged_at`),
    sbGet('sleep_logs', `logged_at=gte.${monday.toISOString()}&logged_at=lte.${sunday.toISOString()}&select=duration_h,quality,notes`),
  ]);

  // 统计每天蛋白质
  const proteinByDay = {};
  foods.forEach(f=>{
    const day = new Date(f.logged_at).toISOString().slice(0,10);
    proteinByDay[day] = (proteinByDay[day]||0) + (f.protein_g||0);
  });
  const avgProtein = Object.values(proteinByDay).length
    ? Math.round(Object.values(proteinByDay).reduce((a,b)=>a+b,0)/Object.values(proteinByDay).length)
    : 0;

  const avgSleep = sleeps.length
    ? (sleeps.reduce((a,s)=>a+(s.duration_h||7),0)/sleeps.length).toFixed(1)
    : null;

  // 计划训练天数（周一到今天）
  let plannedTrainDays=0;
  for(let i=0; i<mondayOffset+1; i++){
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    if(d>bj) break;
    const plan = PLAN_BY_DOW[d.getDay()];
    if(plan.type!=='rest'&&plan.type!=='cardio') plannedTrainDays++;
  }
  // 实际训练天数
  const actualTrainDays = new Set(sessions.map(s=>new Date(s.trained_at).toISOString().slice(0,10))).size;
  const execRate = plannedTrainDays>0 ? Math.round(actualTrainDays/plannedTrainDays*100) : 100;
  const totalVol = sessions.reduce((a,s)=>a+(s.volume||0),0);

  return { sessions, avgProtein, avgSleep, actualTrainDays, plannedTrainDays, execRate, totalVol };
}

async function getLatestBody() {
  const rows = await sbGet('body_stats', `select=muscle_kg,fat_pct&order=recorded_at.desc&limit=1`);
  return rows[0] || { muscle_kg:40.4, fat_pct:17.8 };
}

// ── 08:00 晨间任务推送 ────────────────────────────────────
async function buildMorning() {
  const bj = new Date(Date.now() + 8*3600000);
  const dow = bj.getDay();
  const plan = PLAN_BY_DOW[dow];
  const isTrainDay = plan.type !== 'rest' && plan.type !== 'cardio';
  const sleep = await getRecentSleep();
  const body = await getLatestBody();
  const dayNames = ['日','一','二','三','四','五','六'];

  const lines = [
    `*FORM · 早安 ☀️*`,
    `📅 周${dayNames[dow]} · 今日：*${plan.label}*`,
    '',
  ];

  // 睡眠情况
  if(sleep){
    const bedWarn = sleep.latestBedtime && parseInt(sleep.latestBedtime.split(':')[0])>=23
      ? `（晚于23:00，注意GH分泌）` : '';
    lines.push(`🛌 昨晚 ${sleep.latestHours}h ${sleep.latestBedtime?`· 入睡${sleep.latestBedtime}${bedWarn}`:''}`);
    if(parseFloat(sleep.latestHours)<6.5) lines.push(`   ⚠️ 睡眠不足，建议今日降低训练强度`);
  }

  lines.push('');

  // 今日任务
  if(plan.type==='rest'){
    lines.push(`😴 今日休息日`);
    lines.push(`📌 任务：静态拉伸15–20分钟，蛋白质照常摄入168g`);
  } else if(plan.type==='cardio'){
    lines.push(`🚴 今日有氧日`);
    lines.push(`📌 任务：稳态有氧35分钟，心率130–140bpm`);
    lines.push(`🍽 今日热量目标：*${KCAL_REST} kcal*（休息日标准）`);
  } else {
    lines.push(`💪 今日：*${plan.label}*`);
    lines.push(`🍽 热量目标：*${KCAL_TRAIN} kcal* · 蛋白质：*${PROTEIN_TARGET}g*`);
    lines.push(`⏰ 训练提醒：下午15:00加餐（乳清蛋白+香蕉），训练前30min再补快碳`);
  }

  lines.push('');
  lines.push(`📊 体脂 ${body.fat_pct}% · 骨骼肌 ${body.muscle_kg}kg`);
  lines.push(`🔗 打开 FORM App 记录今日数据`);

  return lines.join('\n');
}

// ── 12:00 午间蛋白质检查 ─────────────────────────────────
async function buildNoon() {
  const food = await getTodayFood();
  const gap = Math.max(0, PROTEIN_TARGET - food.protein);
  const dow = new Date(Date.now() + 8*3600000).getDay();
  const isTrainDay = PLAN_BY_DOW[dow].type !== 'rest' && PLAN_BY_DOW[dow].type !== 'cardio';

  const lines = [`*FORM · 午间检查* 🥩`, ''];

  if(food.count === 0){
    lines.push(`⚠️ 今日尚未记录饮食`);
    lines.push(`提醒：打开 App 记录早餐和午餐摄入`);
  } else if(gap > 80){
    lines.push(`📊 截至现在：蛋白质 ${Math.round(food.protein)}g / ${PROTEIN_TARGET}g`);
    lines.push(`⚠️ 还差 *${Math.round(gap)}g*，午餐需要重点补足`);
    lines.push(`💡 建议：${(gap/0.27/2/100).toFixed(0)}00g 鸡胸肉 + ${(gap/30/2).toFixed(1)}勺蛋白粉`);
  } else if(gap > 20){
    lines.push(`✅ 进度良好：蛋白质 ${Math.round(food.protein)}g / ${PROTEIN_TARGET}g`);
    lines.push(`还差 ${Math.round(gap)}g，晚餐前补足即可`);
  } else {
    lines.push(`🎉 蛋白质接近达标！${Math.round(food.protein)}g / ${PROTEIN_TARGET}g`);
  }

  lines.push('');
  lines.push(`🔥 热量：${Math.round(food.kcal)} kcal / ${isTrainDay?KCAL_TRAIN:KCAL_REST} kcal`);

  return lines.join('\n');
}

// ── 15:00 训练日练前餐提醒 ───────────────────────────────
async function buildPreWorkout() {
  const dow = new Date(Date.now() + 8*3600000).getDay();
  const plan = PLAN_BY_DOW[dow];
  const isTrainDay = plan.type !== 'rest' && plan.type !== 'cardio';
  if(!isTrainDay) return null; // 非训练日不发

  const food = await getTodayFood();
  const lines = [
    `*FORM · 练前餐提醒* 💪`,
    '',
    `今日：*${plan.label}*`,
    `📍 距离训练还有约3小时`,
    '',
    `🍌 *现在要做：*`,
    `   乳清蛋白 1勺（约30g蛋白）`,
    `   + 香蕉 1根 或 燕麦 30g（快碳）`,
    `   这顿是 18:30 训练的燃料基础，不可省`,
    '',
    `📊 今日已摄入蛋白：${Math.round(food.protein)}g / ${PROTEIN_TARGET}g`,
    `⏰ 训练前30min（约18:00）再补香蕉半根`,
  ];
  return lines.join('\n');
}

// ── 20:00 今日收尾 ───────────────────────────────────────
async function buildEvening() {
  const [food, session, body] = await Promise.all([getTodayFood(), getTodaySession(), getLatestBody()]);
  const dow = new Date(Date.now() + 8*3600000).getDay();
  const plan = PLAN_BY_DOW[dow];
  const isTrainDay = plan.type !== 'rest' && plan.type !== 'cardio';
  const gap = Math.max(0, PROTEIN_TARGET - food.protein);

  const lines = [`*FORM · 今日收尾* 📋`, ''];

  // 蛋白质
  if(gap <= 5){
    lines.push(`✅ *蛋白质达标* ${Math.round(food.protein)}g / ${PROTEIN_TARGET}g`);
  } else {
    lines.push(`⚠️ *蛋白质缺口 ${Math.round(gap)}g*`);
    lines.push(`   补救：${(gap/30).toFixed(1)}勺乳清 或 ${Math.round(gap/0.27)}g 去皮鸡胸`);
    lines.push(`   168g 是保住骨骼肌的底线，睡前务必补足`);
  }

  lines.push(`🔥 热量：${Math.round(food.kcal)} kcal / ${isTrainDay?KCAL_TRAIN:KCAL_REST} kcal`);
  lines.push('');

  // 训练
  if(isTrainDay){
    if(session){
      lines.push(`💪 *${plan.label}已完成*`);
      lines.push(`   ${session.session_title||plan.label} · 容量 ${Math.round(session.volume||0)} kg·r · RPE ${session.rpe||'—'}`);
    } else {
      lines.push(`❌ *${plan.label}未记录*`);
      lines.push(`   如已训练请在 App 中补录，若未练请明日调整`);
    }
  } else if(plan.type==='cardio'){
    lines.push(session ? `✅ 有氧日已记录` : `📌 有氧日：35min稳态，记得在App记录`);
  } else {
    lines.push(`😴 今日休息日，恢复充分`);
  }

  lines.push('');
  lines.push(`📊 体脂 ${body.fat_pct}% · 骨骼肌 ${body.muscle_kg}kg`);
  lines.push(`🌙 建议23:00前入睡（GH分泌黄金窗口），明日 ${PLAN_BY_DOW[(dow+1)%7].label}`);

  return lines.join('\n');
}

// ── 21:00 数据补录提醒（若有漏录）────────────────────────
async function buildBackfillReminder() {
  const missing = await getMissingDays(3);
  if(!missing.length) return null; // 全部完整则不发

  const lines = [`*FORM · 数据补录提醒* 📝`, ''];
  lines.push(`检测到以下训练日数据缺失，建议补录：`);
  missing.forEach(m=>{
    const items=[];
    if(m.missSession) items.push('训练记录');
    if(m.missFood)    items.push('饮食记录');
    lines.push(`📅 ${m.label}：缺少${items.join('、')}`);
  });
  lines.push('');
  lines.push(`打开 App → 饮食/训练页 → 顶部「补录」选择日期`);
  return lines.join('\n');
}

// ── 周日21:00 本周执行率复盘 ─────────────────────────────
async function buildWeeklyReview() {
  const [stats, body] = await Promise.all([getWeekStats(), getLatestBody()]);
  const { execRate, actualTrainDays, plannedTrainDays, avgProtein, avgSleep, totalVol } = stats;

  const lines = [`*FORM · 本周执行复盘* 📊`, `${new Date().toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',weekday:'long'})}`, ''];

  lines.push(`💪 训练执行率：*${execRate}%*（${actualTrainDays}/${plannedTrainDays}天）`);
  lines.push(`🏋 本周总容量：${Math.round(totalVol/1000)}k kg·r`);
  lines.push(`🥩 均蛋白质：*${avgProtein}g / ${PROTEIN_TARGET}g*${avgProtein>=PROTEIN_TARGET?'  ✅':'  ⚠️ 偏低'}`);
  if(avgSleep) lines.push(`🛌 均睡眠：*${avgSleep}h*${parseFloat(avgSleep)>=7?' ✅':' ⚠️ 建议>7h'}`);
  lines.push(`📊 体脂 ${body.fat_pct}% · 骨骼肌 ${body.muscle_kg}kg`);

  lines.push('');
  // 自动评语
  if(execRate===100 && avgProtein>=PROTEIN_TARGET){
    lines.push(`⭐ 本周执行完美！坚持这个节奏，减脂效果会在2–3周内明显显现。`);
  } else if(execRate<60){
    lines.push(`⚠️ 本周执行率偏低，减脂进度可能滞后。找出卡点：是时间问题、动力问题还是恢复问题？`);
  } else if(avgProtein<150){
    lines.push(`⚠️ 蛋白质摄入不足是本周主要问题，骨骼肌流失风险升高，下周必须优先解决。`);
  } else {
    lines.push(`👍 本周整体不错，${execRate<80?'训练执行再提升一点就更完美':'继续保持'}。`);
  }

  lines.push('');
  lines.push(`下周计划：减脂期照常执行，体脂继续下降中。`);

  return lines.join('\n');
}

// ── 发送 Telegram ─────────────────────────────────────────
async function sendTG(text) {
  if(!text) return; // null消息不发
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if(!token || !chatId) throw new Error('TG环境变量未设置');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown' }),
  });
  if(!res.ok){
    const e = await res.json().catch(()=>({}));
    throw new Error(`TG错误: ${e.description || res.status}`);
  }
}
