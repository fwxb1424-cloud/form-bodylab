// FORM · Body Lab — 提醒引擎
// Scriptable脚本，由多个「个人自动化」在固定时间调用，传入不同的 slot 参数
// 用法：iOS快捷指令「个人自动化」→ 时间 → 动作选「运行脚本」(Scriptable) →
//       脚本选本文件 → 「传入的输入」填对应的 slot 文本（见下方SLOT列表）
//
// ⚠️ 和 form-widget.js 一样，先填好下面两行
const SUPABASE_URL = "https://urduzohozghrfgwsvamy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50";

// ── 与 sync-store.js 保持一致的常量 ───────────────────────
const PLAN_QUEUE_DEF = ['push', 'pull', 'cardio', 'legs', 'shoulder', 'cardio', 'rest'];
const TRAIN_LABEL_MAP = {
  push: '推日', pull: '拉日', cardio: '有氧+核心日', legs: '腿日（缩短版60min）', shoulder: '肩日', rest: '休息日',
};
const COLE_PLAN_CUT = {
  train: { protein: 168, carbs: 220, fat: 75, kcal: 2220 },
  rest:  { protein: 168, carbs: 140, fat: 80, kcal: 1950 },
};

// ── 工具函数（与 form-widget.js 相同）─────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localMidnightISO(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function getQueueTypeForDate(dateStr, anchor) {
  const anchorDate = new Date(anchor.date + 'T00:00:00');
  const targetDate = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((targetDate - anchorDate) / 86400000);
  const len = PLAN_QUEUE_DEF.length;
  const idx = ((anchor.index + diffDays) % len + len) % len;
  return PLAN_QUEUE_DEF[idx];
}
function getElevenWeekStatus(plan11) {
  const start = new Date(plan11.startDate + 'T00:00:00');
  const diffDays = Math.floor((Date.now() - start.getTime()) / 86400000);
  let weekNum = Math.floor(diffDays / 7) + 1;
  const done = weekNum > plan11.totalWeeks;
  if (done) weekNum = plan11.totalWeeks;
  const idx = Math.max(0, Math.min(plan11.totalWeeks - 1, weekNum - 1));
  return {
    weekNum, done,
    isDietBreak: !done && weekNum === plan11.dietBreakWeek,
    targetWeight: plan11.weeklyTargetWeights[idx],
  };
}

async function sb(path) {
  const req = new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  req.headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  return await req.loadJSON();
}

async function getProfile() {
  const rows = await sb(`user_settings?id=eq.default&select=profile_json`);
  try { return JSON.parse(rows?.[0]?.profile_json || '{}'); } catch (e) { return {}; }
}

function calcTargets(profile) {
  const anchor = profile.queue_anchor || { date: localDateStr(), index: 0 };
  const todayType = getQueueTypeForDate(localDateStr(), anchor);
  const phase = profile.plan_phase || 'cut';
  const label = TRAIN_LABEL_MAP[todayType] || todayType;

  if (phase !== 'cut' || !profile.plan_11week) {
    const isTrain = todayType !== 'rest';
    const nums = isTrain ? COLE_PLAN_CUT.train : COLE_PLAN_CUT.rest;
    return { label, todayType, isTrain, isDietBreak: false, week: null, ...nums };
  }

  const plan11 = profile.plan_11week;
  const isTrain = todayType !== 'rest';
  let nums = isTrain ? COLE_PLAN_CUT.train : COLE_PLAN_CUT.rest;
  const week = getElevenWeekStatus(plan11);
  let isDietBreak = false;

  if (week.isDietBreak) {
    const overGain = !!profile.diet_break_overgain;
    const dbm = plan11.dietBreakMacros;
    const kcal = overGain ? plan11.dietBreakOverGainKcal : dbm.kcal;
    const carbs = overGain ? Math.round((kcal - dbm.protein * 4 - dbm.fat * 9) / 4) : dbm.carbs;
    nums = { protein: dbm.protein, carbs, fat: dbm.fat, kcal };
    isDietBreak = true;
  } else {
    const adj = profile.kcal_adjustment || 0;
    if (adj !== 0) {
      nums = { protein: nums.protein, fat: nums.fat, carbs: Math.max(0, nums.carbs + Math.round(adj / 4)), kcal: nums.kcal + adj };
    }
  }
  return { label, todayType, isTrain, isDietBreak, week, ...nums };
}

async function getTodayFood() {
  const rows = await sb(`food_logs?select=protein_g,kcal&logged_at=gte.${encodeURIComponent(localMidnightISO())}`);
  return (rows || []).reduce((a, r) => ({ protein: a.protein + (r.protein_g || 0), kcal: a.kcal + (r.kcal || 0) }), { protein: 0, kcal: 0 });
}

async function getDaysSinceWeight() {
  const rows = await sb(`body_stats?select=recorded_at&weight_kg=not.is.null&order=recorded_at.desc&limit=1`);
  if (!rows?.[0]) return 999;
  return Math.floor((Date.now() - new Date(rows[0].recorded_at).getTime()) / 86400000);
}

async function get7DayWeightAvg() {
  const since = new Date(); since.setDate(since.getDate() - 7); since.setHours(0, 0, 0, 0);
  const rows = await sb(`body_stats?select=weight_kg,recorded_at&weight_kg=not.is.null&order=recorded_at.asc&recorded_at=gte.${encodeURIComponent(since.toISOString())}`);
  const byDay = {};
  (rows || []).forEach(r => { byDay[r.recorded_at.slice(0, 10)] = r.weight_kg; });
  const vals = Object.values(byDay);
  if (vals.length < 5) return null;
  return { avg: vals.reduce((a, v) => a + v, 0) / vals.length, n: vals.length };
}

// ── 发送本地通知 ──────────────────────────────────────────
async function notify(title, body, sound = 'default') {
  const n = new Notification();
  n.title = title;
  n.body = body;
  n.sound = sound;
  await n.schedule();
}

// ── 主逻辑：按 slot 决定发什么 ────────────────────────────
async function run() {
  const slot = args.shortcutParameter || 'test';
  const profile = await getProfile();
  const tgt = calcTargets(profile);
  const isStrengthDay = ['push', 'pull', 'legs', 'shoulder'].includes(tgt.todayType);
  const isCardioDay = tgt.todayType === 'cardio';
  const isRestDay = tgt.todayType === 'rest';

  switch (slot) {

    // ── 力量日 07:35：起床+晨称+出门吃法 ──
    case 'morning_strength': {
      if (!isStrengthDay) return;
      const dietBreak = tgt.isDietBreak ? '（Diet Break周）' : '';
      await notify(
        `🌅 ${tgt.label} · 07:40起${dietBreak}`,
        `晨称(7日均值是checkpoint依据)→黑咖啡+半根香蕉→8:00训练。今日目标 蛋白${tgt.protein}g / ${tgt.kcal}kcal`
      );
      return;
    }

    // ── 有氧日 08:15：可以多睡，起床+晨称 ──
    case 'morning_cardio': {
      if (!isCardioDay) return;
      await notify(
        `🌅 ${tgt.label} · 比力量日多睡40min`,
        `晨称→09:00有氧+核心(30min)。今日目标 蛋白${tgt.protein}g / ${tgt.kcal}kcal`
      );
      return;
    }

    // ── 力量日 09:30：练后第一餐 ──
    case 'breakfast_strength': {
      if (!isStrengthDay) return;
      const food = await getTodayFood();
      await notify(
        `🍳 练后第一餐`,
        `目标蛋白28g+。当前进度 ${Math.round(food.protein)}/${tgt.protein}g`
      );
      return;
    }

    // ── 有氧日 09:50：早餐（更宽松） ──
    case 'breakfast_cardio': {
      if (!isCardioDay) return;
      const food = await getTodayFood();
      await notify(
        `🍳 早餐时间`,
        `今日 ${tgt.label}，当前蛋白进度 ${Math.round(food.protein)}/${tgt.protein}g`
      );
      return;
    }

    // ── 每天 12:30：午间进度 ──
    case 'midday': {
      const food = await getTodayFood();
      const proteinPct = Math.round(food.protein / tgt.protein * 100);
      await notify(
        `☀️ 午间进度 · ${tgt.label}`,
        `蛋白 ${Math.round(food.protein)}/${tgt.protein}g (${proteinPct}%) · 热量 ${Math.round(food.kcal)}/${tgt.kcal}`
      );
      return;
    }

    // ── 每天 21:00：下班/晚餐前 ──
    case 'evening': {
      const food = await getTodayFood();
      const proteinGap = Math.max(0, tgt.protein - Math.round(food.protein));
      const kcalLeft = Math.max(0, tgt.kcal - Math.round(food.kcal));
      await notify(
        `🌆 晚餐前 · ${tgt.label}`,
        proteinGap > 0
          ? `还差蛋白${proteinGap}g，剩余热量${kcalLeft}kcal，晚餐安排够量`
          : `蛋白已达标✓，剩余热量${kcalLeft}kcal，晚餐正常吃即可`
      );
      return;
    }

    // ── 每天 22:30：就寝准备 ──
    case 'bedtime': {
      const daysSinceWeight = await getDaysSinceWeight();
      const weightNote = daysSinceWeight >= 1 ? `\n⚠️ 体重已${daysSinceWeight >= 999 ? '未' : daysSinceWeight}天未录，明早记得晨称` : '';
      await notify(
        `🌙 准备就寝`,
        `目标23:00–23:30入睡，硬底线00:30。记录今日睡眠时间。${weightNote}`
      );
      return;
    }

    // ── 每天 23:00：蛋白达标检查（替代Telegram那条） ──
    case 'protein_check': {
      const food = await getTodayFood();
      const gap = tgt.protein - Math.round(food.protein);
      if (gap > 5) {
        await notify(
          `⚠️ 蛋白质未达标`,
          `今日还差${gap}g（${Math.round(food.protein)}/${tgt.protein}g），临睡前补一份乳清/即食鸡胸`,
          'alert'
        );
      }
      // 已达标则静默，不打扰
      return;
    }

    // ── 周日 21:00：周复盘提醒 ──
    case 'weekly_review': {
      if (tgt.week?.done) {
        await notify(`🎉 11周计划完成`, `进入8/28–8/31终测窗口，去App查看最终数据`);
        return;
      }
      if (tgt.week?.isDietBreak) {
        await notify(`🍽️ Diet Break周复盘`, `本周固定${tgt.kcal}kcal，去App查看体重涨幅是否在正常范围`);
        return;
      }
      const w = await get7DayWeightAvg();
      if (!w) {
        await notify(`📋 周复盘`, `本周体重记录不足5天，本周checkpoint可能不准确，去App看看`);
        return;
      }
      const diff = w.avg - (tgt.week?.targetWeight ?? 0);
      let msg = `7日均值${w.avg.toFixed(2)}kg，目标${tgt.week.targetWeight}kg，差值${diff > 0 ? '+' : ''}${diff.toFixed(2)}kg。`;
      if (diff > 0.3) msg += '可能需要下调100kcal';
      else if (diff < -0.4) msg += '脱速偏快，可能需要上调100kcal';
      else msg += '在正常范围，维持当前热量';
      await notify(`📋 第${tgt.week.weekNum}周复盘`, msg + ' — 去App应用调整');
      return;
    }

    default: {
      await notify('FORM 提醒引擎', `测试：今日 ${tgt.label}，蛋白目标${tgt.protein}g`);
      return;
    }
  }
}

await run();
Script.complete();
