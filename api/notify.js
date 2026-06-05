/**
 * FORM · Body Lab — Telegram 推送 v2
 * Vercel Cron Function
 *
 * 推送时间（UTC+8，996作息版）：
 *   07:55  有氧日起床提醒（仅有氧日）
 *   09:30  晨间简报（所有日）
 *   12:30  午餐蛋白质检查
 *   19:30  练前餐提醒（仅力量日）
 *   22:30  训练后补给提醒（仅力量日）
 *   23:30  睡前收尾复盘
 *   周日22:00  本周执行率复盘
 *
 * vercel.json cron 配置（UTC时间）：
 *   07:55 BJ = 23:55 UTC (前一天)  → "55 23 * * *"  + ?hour=7
 *   09:30 BJ = 01:30 UTC           → "30 1 * * *"   + ?hour=9
 *   12:30 BJ = 04:30 UTC           → "30 4 * * *"   + ?hour=12
 *   19:30 BJ = 11:30 UTC           → "30 11 * * *"  + ?hour=19
 *   22:30 BJ = 14:30 UTC           → "30 14 * * *"  + ?hour=22
 *   23:30 BJ = 15:30 UTC           → "30 15 * * *"  + ?hour=23
 *   周日22:00 BJ = 周日14:00 UTC   → "0 14 * * 0"   + ?hour=22&weekly=1
 */

export const config = { runtime: 'edge' };

const PT = 168;
const KCAL_TRAIN = 2220;
const KCAL_REST  = 1950;

// 队列顺序，用于推断今日训练类型
const PLAN_QUEUE = ['push', 'pull', 'cardio', 'legs', 'shoulder', 'cardio', 'rest'];
const TRAIN_LABEL = {
  push: '推日（胸·侧束·三头）',
  pull: '拉日（背·二头）',
  cardio: '有氧+核心日',
  legs: '腿日（股四·后链·臀）',
  shoulder: '肩日（三角肌）',
  rest: '休息日',
};

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const hourParam = url.searchParams.get('hour');
  const isWeekly = url.searchParams.get('weekly') === '1';
  const bjHour = hourParam
    ? parseInt(hourParam)
    : (new Date().getUTCHours() + 8) % 24;

  try {
    let msg;

    if (isWeekly && bjHour === 22) {
      msg = await buildWeeklyReview();
    } else if (bjHour === 7) {
      // 07:55 — 只在有氧日推送
      const today = await getTodayTrainType();
      if (today !== 'cardio') return new Response(JSON.stringify({ ok: true, skipped: 'not cardio day' }));
      msg = buildCardioWakeup();
    } else if (bjHour === 9) {
      msg = await buildMorningBrief();
    } else if (bjHour === 12) {
      msg = await buildNoonCheck();
    } else if (bjHour === 19) {
      const today = await getTodayTrainType();
      if (today === 'rest' || today === 'cardio') return new Response(JSON.stringify({ ok: true, skipped: 'not strength day' }));
      msg = await buildPreWorkout(today);
    } else if (bjHour === 22) {
      const today = await getTodayTrainType();
      if (today === 'rest' || today === 'cardio') return new Response(JSON.stringify({ ok: true, skipped: 'not strength day' }));
      msg = await buildPostWorkout();
    } else if (bjHour === 23) {
      msg = await buildNightSummary();
    } else {
      return new Response(JSON.stringify({ ok: true, skipped: `no task at bjHour=${bjHour}` }));
    }

    await sendTG(msg);
    return new Response(JSON.stringify({ ok: true, bjHour, preview: msg.slice(0, 80) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}

// ── 数据读取 ──────────────────────────────────────────
async function sbGet(table, query = '') {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return res.ok ? res.json() : [];
}

async function getTodayFood() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = await sbGet('food_logs',
    `logged_at=gte.${today.toISOString()}&select=protein,carbs,fat,kcal,protein_g,carbs_g,fat_g`
  );
  return {
    protein: rows.reduce((a, r) => a + (r.protein ?? r.protein_g ?? 0), 0),
    carbs:   rows.reduce((a, r) => a + (r.carbs   ?? r.carbs_g   ?? 0), 0),
    fat:     rows.reduce((a, r) => a + (r.fat     ?? r.fat_g     ?? 0), 0),
    kcal:    rows.reduce((a, r) => a + (r.kcal    ?? 0), 0),
    count:   rows.length,
  };
}

async function getTodaySession() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = await sbGet('sessions',
    `trained_at=gte.${today.toISOString()}&select=session_title,volume,muscle_groups,rpe&order=trained_at.desc&limit=1`
  );
  return rows[0] || null;
}

async function getLatestBody() {
  const rows = await sbGet('body_stats', `select=muscle_kg,fat_pct&order=recorded_at.desc&limit=1`);
  return rows[0] || { muscle_kg: 40.4, fat_pct: 17.8 };
}

async function getLastSleep() {
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const rows = await sbGet('sleep_logs',
    `logged_at=gte.${since}&select=duration_h,quality,notes&order=logged_at.desc&limit=1`
  );
  return rows[0] || null;
}

// 从 sessions 推断今日应该训练什么（读最近一条记录的 muscle_groups，然后取队列下一个）
async function getTodayTrainType() {
  const rows = await sbGet('sessions',
    `select=muscle_groups&order=trained_at.desc&limit=1`
  );
  const last = rows[0]?.muscle_groups || null;
  if (!last) return 'push';
  const idx = PLAN_QUEUE.indexOf(last);
  if (idx === -1) return 'push';
  return PLAN_QUEUE[(idx + 1) % PLAN_QUEUE.length];
}

async function getWeekSessions() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await sbGet('sessions',
    `trained_at=gte.${since}&select=volume,muscle_groups,session_title`
  );
  return {
    count: rows.length,
    totalVol: rows.reduce((a, r) => a + (r.volume || 0), 0),
    types: rows.map(r => r.muscle_groups),
  };
}

// ── 07:55 有氧日起床提醒 ──────────────────────────────
function buildCardioWakeup() {
  return [
    `*FORM · 起床了* ⏰`,
    ``,
    `今天是 *有氧+核心日*，现在该起了`,
    ``,
    `📍 时间规划：`,
    `   08:00 起床洗漱`,
    `   08:15 出门`,
    `   08:25 到健身房`,
    `   08:25–09:00 稳态有氧 35min（心率 130–140）`,
    `   09:00–09:15 核心训练 8组`,
    `   09:15–09:25 洗澡`,
    `   09:45 打卡 ✅`,
    ``,
    `今日休息日热量：*${KCAL_REST} kcal* · 蛋白 *${PT}g*`,
  ].join('\n');
}

// ── 09:30 晨间简报 ────────────────────────────────────
async function buildMorningBrief() {
  const today = await getTodayTrainType();
  const body = await getLatestBody();
  const sleep = await getLastSleep();
  const week = await getWeekSessions();
  const label = TRAIN_LABEL[today] || today;
  const isStrength = !['rest', 'cardio'].includes(today);
  const isCardio = today === 'cardio';
  const kcal = isStrength ? KCAL_TRAIN : KCAL_REST;
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const d = new Date();

  const lines = [
    `*FORM · 早安 Cole* ☀️`,
    `星期${dayNames[d.getDay()]} ${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`,
    ``,
  ];

  // 今日类型
  if (today === 'rest') {
    lines.push(`📌 今日：*休息日* — 好好恢复`);
  } else {
    lines.push(`📌 今日：*${label}*`);
    if (isStrength) lines.push(`   💡 下班后训练，19:30 记得吃练前餐`);
    if (isCardio) lines.push(`   ✅ 早上已完成（看到这条说明你训练过了）`);
  }

  lines.push(`🎯 今日热量目标：*${kcal} kcal* · 蛋白 *${PT}g*`);
  lines.push(``);

  // 睡眠
  if (sleep) {
    const hrs = sleep.duration_h || 0;
    const warn = hrs < 6.5 ? ' ⚠️ 偏少，今日注意恢复' : hrs >= 8 ? ' 👍' : '';
    lines.push(`🛌 昨晚睡眠：${hrs}h${warn}`);
  } else {
    lines.push(`🛌 昨晚睡眠：未记录（形体页补录）`);
  }

  // 本周进度
  const doneInQueue = week.types.filter(t => t !== 'rest').length;
  lines.push(`💪 本周已完成 ${week.count} 次训练（${doneInQueue} 次力量/有氧）`);

  // 体成分
  lines.push(``);
  lines.push(`📊 当前：肌肉 ${body.muscle_kg}kg · 体脂 ${body.fat_pct}%`);

  return lines.join('\n');
}

// ── 12:30 午餐蛋白质检查 ─────────────────────────────
async function buildNoonCheck() {
  const food = await getTodayFood();
  const today = await getTodayTrainType();
  const isStrength = !['rest', 'cardio'].includes(today);
  const gap = Math.max(0, PT - food.protein);
  const pct = Math.min(100, Math.round(food.protein / PT * 100));

  const lines = [`*FORM · 午餐蛋白检查* 🥩`, ``];

  if (food.count === 0) {
    lines.push(`⚠️ 今日还没有饮食记录`);
    lines.push(`记得打开 App 补录早餐和午餐`);
  } else {
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    lines.push(`${bar} ${pct}%`);
    lines.push(`已摄入：蛋白 *${Math.round(food.protein)}g* / ${PT}g · 热量 ${Math.round(food.kcal)} kcal`);
    lines.push(``);

    if (gap <= 0) {
      lines.push(`✅ 蛋白质午间已达标，保持！`);
    } else if (gap > 80) {
      lines.push(`⚠️ 还差 *${Math.round(gap)}g*，午餐需要重点补足`);
      lines.push(`💡 午餐加：${Math.round(gap * 0.6 / 0.27)}g 鸡胸 + ${(gap * 0.4 / 30).toFixed(1)} 勺乳清`);
    } else {
      lines.push(`还差 *${Math.round(gap)}g*，下午加餐可以补上`);
      lines.push(`💡 一勺乳清（约25–30g蛋白质）就够了`);
    }
  }

  if (isStrength) {
    lines.push(``);
    lines.push(`⏰ 提醒：今晚力量训练，19:30 记得练前餐`);
  }

  return lines.join('\n');
}

// ── 19:30 练前餐提醒（仅力量日）─────────────────────
async function buildPreWorkout(trainType) {
  const food = await getTodayFood();
  const label = TRAIN_LABEL[trainType] || trainType;
  const gap = Math.max(0, PT - food.protein);
  const pct = Math.min(100, Math.round(food.protein / PT * 100));

  const lines = [
    `*FORM · 练前餐时间* 🍽`,
    ``,
    `准备下班了，今晚 *${label}*`,
    `距训练约 1.5h，现在吃练前餐正好`,
    ``,
    `📋 推荐搭配：`,
    `   乳清蛋白 1 勺（约 25g 蛋白）`,
    `   香蕉 1 根 或 米饭小碗（快碳）`,
    `   水 300–500ml`,
    ``,
    `📊 今日蛋白进度：${Math.round(food.protein)}g / ${PT}g（${pct}%）`,
  ];

  if (gap > 50) {
    lines.push(`⚠️ 还差 ${Math.round(gap)}g，练后餐要补足`);
  } else if (gap > 0) {
    lines.push(`还差 ${Math.round(gap)}g，练后乳清+碳水收尾`);
  } else {
    lines.push(`✅ 蛋白已达标，练前餐正常吃`);
  }

  lines.push(``);
  lines.push(`💪 21:15 见，组间休息 90s`);

  return lines.join('\n');
}

// ── 22:30 训练后补给提醒（仅力量日）─────────────────
async function buildPostWorkout() {
  const food = await getTodayFood();
  const session = await getTodaySession();
  const gap = Math.max(0, PT - food.protein);

  const lines = [`*FORM · 训练结束了吗？* 💪`, ``];

  if (session) {
    lines.push(`✅ 已记录：${session.session_title}`);
    lines.push(`   容量 ${Math.round(session.volume || 0)} kg·r · RPE ${session.rpe}`);
  } else {
    lines.push(`⚠️ 今日训练还没记录，记得打开 App 保存`);
  }

  lines.push(``);
  lines.push(`🍚 *30min 内补给窗口*`);

  if (gap > 0) {
    lines.push(`还差 *${Math.round(gap)}g* 蛋白质，练后必补：`);
    lines.push(`   乳清蛋白 ${(gap / 30).toFixed(1)} 勺 + 香蕉/米饭`);
  } else {
    lines.push(`✅ 蛋白已达标，补充碳水恢复即可`);
    lines.push(`   香蕉 1 根 或 米饭小碗`);
  }

  lines.push(``);
  lines.push(`🌙 记得记录睡眠，目标 23:30 前入睡（保证 8h）`);

  return lines.join('\n');
}

// ── 23:30 睡前收尾 ────────────────────────────────────
async function buildNightSummary() {
  const food = await getTodayFood();
  const session = await getTodaySession();
  const today = await getTodayTrainType();
  const gap = Math.max(0, PT - food.protein);
  const kcalTarget = !['rest', 'cardio'].includes(today) ? KCAL_TRAIN : KCAL_REST;
  const kcalDiff = food.kcal - kcalTarget;

  const lines = [
    `*FORM · 睡前收尾* 🌙`,
    ``,
  ];

  // 蛋白质
  if (gap <= 0) {
    lines.push(`✅ *蛋白质达标* ${Math.round(food.protein)}g / ${PT}g`);
  } else {
    lines.push(`❌ *蛋白质未达标* ${Math.round(food.protein)}g / ${PT}g，缺口 ${Math.round(gap)}g`);
  }

  // 热量
  const kcalStr = kcalDiff > 150
    ? `⚠️ 超出 ${Math.round(kcalDiff)} kcal`
    : kcalDiff < -300
    ? `⚠️ 不足 ${Math.round(Math.abs(kcalDiff))} kcal`
    : `✅ 达标`;
  lines.push(`🔥 热量：${Math.round(food.kcal)} / ${kcalTarget} kcal ${kcalStr}`);

  // 训练
  if (session) {
    lines.push(`💪 训练：${session.session_title} 已完成`);
  } else if (!['rest'].includes(today)) {
    lines.push(`⚠️ 今日训练未记录`);
  } else {
    lines.push(`😴 今日休息日`);
  }

  // 明日预告
  const tmrType = PLAN_QUEUE[(PLAN_QUEUE.indexOf(today) + 1) % PLAN_QUEUE.length];
  const tmrLabel = TRAIN_LABEL[tmrType] || tmrType;
  lines.push(``);
  lines.push(`📌 明日：*${tmrLabel}*`);
  if (!['rest', 'cardio'].includes(tmrType)) {
    lines.push(`   明天下班后训练，记得吃练前餐`);
  } else if (tmrType === 'cardio') {
    lines.push(`   明天有氧日，07:55 起床提醒会叫你`);
  }

  lines.push(``);
  lines.push(`🛌 现在该睡了，睡眠记得在 App 记录`);

  return lines.join('\n');
}

// ── 周日22:00 本周复盘 ────────────────────────────────
async function buildWeeklyReview() {
  const week = await getWeekSessions();
  const body = await getLatestBody();

  // 读取本周饮食均值
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const foodRows = await sbGet('food_logs',
    `logged_at=gte.${since}&select=protein,carbs,fat,kcal,protein_g,carbs_g,fat_g,logged_at`
  );

  // 按天统计蛋白质
  const dayMap = {};
  foodRows.forEach(r => {
    const day = r.logged_at?.slice(0, 10);
    if (!day) return;
    if (!dayMap[day]) dayMap[day] = 0;
    dayMap[day] += r.protein ?? r.protein_g ?? 0;
  });
  const days = Object.keys(dayMap);
  const proteinHitDays = days.filter(d => dayMap[d] >= PT).length;
  const avgProtein = days.length
    ? Math.round(days.reduce((a, d) => a + dayMap[d], 0) / days.length)
    : 0;

  // 训练完成情况
  const expectedPerWeek = 5; // 推+拉+有氧+腿+肩（有氧算一次）
  const execRate = Math.round(week.count / expectedPerWeek * 100);

  const lines = [
    `*FORM · 本周复盘* 📊`,
    ``,
    `*训练*`,
    `完成 ${week.count} / ${expectedPerWeek} 次 · 执行率 ${execRate}%`,
    `总容量：${Math.round(week.totalVol / 1000 * 10) / 10}k kg·r`,
    ``,
    `*营养*`,
    `蛋白达标天数：${proteinHitDays} / ${days.length} 天`,
    `日均蛋白：${avgProtein}g（目标 ${PT}g）`,
    ``,
    `*体成分*`,
    `当前：肌肉 ${body.muscle_kg}kg · 体脂 ${body.fat_pct}%`,
  ];

  // 评语
  lines.push(``);
  if (execRate >= 80 && proteinHitDays >= 5) {
    lines.push(`⭐ 本周执行优秀，继续保持节奏`);
  } else if (execRate < 60) {
    lines.push(`⚠️ 本周训练完成率偏低，下周注意坚持队列顺序`);
  } else if (proteinHitDays < 4) {
    lines.push(`⚠️ 蛋白质达标天数不足，减脂期保肌关键`);
  } else {
    lines.push(`👍 本周还不错，营养和训练继续稳住`);
  }

  lines.push(``);
  lines.push(`下周队列：推→拉→有氧+核心→腿→肩→有氧+核心→休息`);

  return lines.join('\n');
}

// ── 发送 Telegram ─────────────────────────────────────
async function sendTG(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TG环境变量未设置');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`TG错误: ${e.description || res.status}`);
  }
}
