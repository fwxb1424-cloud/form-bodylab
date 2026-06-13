// FORM · Body Lab — 状态面板 Widget
// Scriptable Widget. 中号(Medium)效果最佳。
//
// ⚠️ 首次使用前：
//   1. 把下面 SUPABASE_URL / SUPABASE_ANON_KEY 改成你自己的（和index.html里一致）
//   2. 长按主屏 → 添加Widget → Scriptable → 选择中号
//   3. 编辑Widget → 选择此脚本 → 刷新模式选「不刷新」（iOS会按系统节奏刷新，约15分钟）
//   4. 想立即刷新：点一下Widget会触发系统刷新（不保证立即生效）

const SUPABASE_URL = "https://urduzohozghrfgwsvamy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50";

// ── 与 sync-store.js 保持一致的常量（手动同步，改动后请双边都改）──
const PLAN_QUEUE_DEF = ['push', 'pull', 'cardio', 'legs', 'shoulder', 'cardio', 'rest'];
const TRAIN_LABEL_MAP = {
  push: '推日', pull: '拉日', cardio: '有氧+核心', legs: '腿日', shoulder: '肩日', rest: '休息日',
};
// cut 阶段基础宏量（与 COLE_PLAN.cut 一致），plan_11week 的动态部分从云端读取
const COLE_PLAN_CUT = {
  train: { protein: 168, carbs: 220, fat: 75, kcal: 2220 },
  rest:  { protein: 168, carbs: 140, fat: 80, kcal: 1950 },
};
const WEEKLY_TRAIN_TARGET = 6; // 11周计划：每周6练（周一至周六）

// ── 工具函数 ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localMidnightISO(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function rollingWindowISO(days, d = new Date()) {
  // 用于训练次数统计：滚动窗口而非自然周，匹配循环制训练
  const x = new Date(d);
  x.setDate(x.getDate() - (days - 1));
  x.setHours(0, 0, 0, 0);
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

// ── Supabase REST 请求 ────────────────────────────────────
async function sb(path) {
  const req = new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  req.headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  return await req.loadJSON();
}

// ── 拉取所有数据 ──────────────────────────────────────────
async function fetchData() {
  const todayStart = localMidnightISO();
  const trainWindowStart = rollingWindowISO(7);

  const [settingsRows, foodRows, bodyRows, sleepRows, sessionRows] = await Promise.all([
    sb(`user_settings?id=eq.default&select=profile_json`),
    sb(`food_logs?select=protein_g,carbs_g,fat_g,kcal&logged_at=gte.${encodeURIComponent(todayStart)}`),
    sb(`body_stats?select=weight_kg,recorded_at&weight_kg=not.is.null&order=recorded_at.desc&limit=1`),
    sb(`sleep_logs?select=duration_h,logged_at&order=logged_at.desc&limit=1`),
    sb(`sessions?select=trained_at&trained_at=gte.${encodeURIComponent(trainWindowStart)}`),
  ]);

  let profile = {};
  try { profile = JSON.parse(settingsRows?.[0]?.profile_json || '{}'); } catch (e) {}

  const food = (foodRows || []).reduce((a, r) => ({
    protein: a.protein + (r.protein_g || 0),
    kcal: a.kcal + (r.kcal || 0),
  }), { protein: 0, kcal: 0 });

  const lastWeight = bodyRows?.[0] || null;
  let daysSinceWeight = 999;
  if (lastWeight?.recorded_at) {
    daysSinceWeight = Math.floor((Date.now() - new Date(lastWeight.recorded_at).getTime()) / 86400000);
  }

  const lastSleep = sleepRows?.[0] || null;

  return {
    profile,
    food,
    weight: lastWeight?.weight_kg ?? null,
    daysSinceWeight,
    sleepH: lastSleep?.duration_h ?? null,
    trainedThisWeek: (sessionRows || []).length,
  };
}

// ── 根据 profile 计算今日宏量目标 ─────────────────────────
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
      nums = {
        protein: nums.protein,
        fat: nums.fat,
        carbs: Math.max(0, nums.carbs + Math.round(adj / 4)),
        kcal: nums.kcal + adj,
      };
    }
  }
  return { label, todayType, isTrain, isDietBreak, week, ...nums };
}

// ── 渲染 ──────────────────────────────────────────────────
function addProgressBar(parent, pct, widthPt, color) {
  const track = parent.addStack();
  track.size = new Size(widthPt, 8);
  track.backgroundColor = new Color("#ffffff", 0.10);
  track.cornerRadius = 4;
  const fillW = Math.max(3, Math.min(widthPt, widthPt * Math.max(0, pct)));
  const fill = track.addStack();
  fill.size = new Size(fillW, 8);
  fill.backgroundColor = color;
  fill.cornerRadius = 4;
  track.addSpacer();
}

async function createWidget() {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0d0d10");
  w.setPadding(14, 16, 14, 16);

  const ACCENT = new Color("#7CFFB2");
  const WARN = new Color("#FFC857");
  const PURPLE = new Color("#B49AFF");
  const DIM = new Color("#ffffff", 0.5);
  const WHITE = Color.white();

  let data;
  try {
    data = await fetchData();
  } catch (e) {
    const errText = w.addText(`数据加载失败\n${e.message || e}`);
    errText.textColor = WARN;
    errText.font = Font.systemFont(12);
    return w;
  }

  const tgt = calcTargets(data.profile);
  const proteinPct = tgt.protein ? data.food.protein / tgt.protein : 0;
  const kcalPct = tgt.kcal ? data.food.kcal / tgt.kcal : 0;
  const weekday = ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];

  // ── 第一行：今日类型 + 星期 ──
  const row1 = w.addStack();
  row1.centerAlignContent();
  const dayLabel = row1.addText(`今日 · ${tgt.label}`);
  dayLabel.font = Font.boldSystemFont(15);
  dayLabel.textColor = WHITE;
  if (tgt.isDietBreak) {
    row1.addSpacer(6);
    const badge = row1.addText("Diet Break");
    badge.font = Font.boldSystemFont(10);
    badge.textColor = PURPLE;
  }
  row1.addSpacer();
  const wd = row1.addText(weekday);
  wd.font = Font.systemFont(13);
  wd.textColor = DIM;

  w.addSpacer(10);

  // ── 蛋白质 ──
  const proteinRow = w.addStack();
  proteinRow.centerAlignContent();
  const pLabel = proteinRow.addText("蛋白  ");
  pLabel.font = Font.systemFont(12);
  pLabel.textColor = DIM;
  addProgressBar(proteinRow, proteinPct, 110, ACCENT);
  proteinRow.addSpacer(8);
  const pVal = proteinRow.addText(`${Math.round(data.food.protein)}/${tgt.protein}g`);
  pVal.font = Font.mediumSystemFont(12);
  pVal.textColor = WHITE;

  w.addSpacer(6);

  // ── 热量 ──
  const kcalRow = w.addStack();
  kcalRow.centerAlignContent();
  const kLabel = kcalRow.addText("热量  ");
  kLabel.font = Font.systemFont(12);
  kLabel.textColor = DIM;
  addProgressBar(kcalRow, kcalPct, 110, kcalPct > 1.05 ? WARN : ACCENT);
  kcalRow.addSpacer(8);
  const kVal = kcalRow.addText(`${Math.round(data.food.kcal)}/${tgt.kcal}`);
  kVal.font = Font.mediumSystemFont(12);
  kVal.textColor = WHITE;

  w.addSpacer(12);

  // ── 分割线 ──
  const div1 = w.addStack();
  div1.size = new Size(0, 1);
  div1.backgroundColor = new Color("#ffffff", 0.08);
  w.addSpacer(10);

  // ── 睡眠 + 体重 ──
  const row3 = w.addStack();
  row3.centerAlignContent();
  const sleepLabel = row3.addText("睡眠  ");
  sleepLabel.font = Font.systemFont(12);
  sleepLabel.textColor = DIM;
  const sleepVal = row3.addText(data.sleepH != null ? `${Number(data.sleepH).toFixed(1)}h` : "--");
  sleepVal.font = Font.mediumSystemFont(13);
  sleepVal.textColor = (data.sleepH != null && data.sleepH >= 7) ? ACCENT : WHITE;
  row3.addSpacer();
  const weightLabel = row3.addText("体重  ");
  weightLabel.font = Font.systemFont(12);
  weightLabel.textColor = DIM;
  const weightVal = row3.addText(data.weight != null ? `${Number(data.weight).toFixed(1)}kg` : "--");
  weightVal.font = Font.mediumSystemFont(13);
  weightVal.textColor = WHITE;

  w.addSpacer(8);

  // ── 本周训练 ──
  const row4 = w.addStack();
  row4.centerAlignContent();
  const trainLabel = row4.addText("近7天训练  ");
  trainLabel.font = Font.systemFont(12);
  trainLabel.textColor = DIM;
  addProgressBar(row4, data.trainedThisWeek / WEEKLY_TRAIN_TARGET, 80, PURPLE);
  row4.addSpacer(8);
  const trainVal = row4.addText(`${data.trainedThisWeek}/${WEEKLY_TRAIN_TARGET}次`);
  trainVal.font = Font.mediumSystemFont(12);
  trainVal.textColor = WHITE;

  // ── 11周计划进度 ──
  if (tgt.week && !tgt.week.done) {
    w.addSpacer(6);
    const planRow = w.addStack();
    const planText = planRow.addText(`11周计划 第${tgt.week.weekNum}周 · 本周目标 ${tgt.week.targetWeight}kg`);
    planText.font = Font.systemFont(11);
    planText.textColor = DIM;
  }

  // ── 体重未录提醒 ──
  if (data.daysSinceWeight >= 1) {
    w.addSpacer(10);
    const warnRow = w.addStack();
    const warnText = warnRow.addText(
      data.daysSinceWeight >= 999 ? "⚠️ 尚无体重记录" : `⚠️ 体重已 ${data.daysSinceWeight} 天未录`
    );
    warnText.font = Font.systemFont(11);
    warnText.textColor = WARN;
  }

  return w;
}

const widget = await createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
