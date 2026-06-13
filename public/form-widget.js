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

// ── 与 sync-store.js 保持一致的常量（改动后请双边都改）──
const PLAN_QUEUE_DEF = ['push', 'pull', 'cardio', 'legs', 'shoulder', 'cardio', 'rest'];
const TRAIN_LABEL_MAP = {
  push: '推日（胸·侧束·三头）', pull: '拉日（背·二头）', cardio: '有氧+核心日',
  legs: '腿日（股四·后链·臀）', shoulder: '肩日（三角肌）', rest: '休息日',
};
// 全阶段宏量（与 COLE_PLAN 一致），plan_11week 的动态部分从云端读取
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
const WEEKLY_TRAIN_TARGET = 6;

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
  const plan = COLE_PLAN[phase] || COLE_PLAN.cut;
  const isTrain = todayType !== 'rest';
  let nums = isTrain ? plan.train : plan.rest;
  let week = null;
  let isDietBreak = false;

  // cut 阶段有 11 周计划时，走动态逻辑（diet break / kcal 微调）
  if (phase === 'cut' && profile.plan_11week) {
    const plan11 = profile.plan_11week;
    week = getElevenWeekStatus(plan11);
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
  } else if (phase === 'cut') {
    // cut 但没有 11 周计划（计划结束后继续减脂）：继续用 cut + 累积调整
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
  w.backgroundColor = new Color("#08080c");
  w.setPadding(16, 18, 14, 18);

  const ACCENT = new Color("#7CFFB2");
  const WARN = new Color("#FFC857");
  const PURPLE = new Color("#B49AFF");
  const INFO = new Color("#6AACFF");
  const DIM = new Color("#ffffff", 0.45);
  const FAINT = new Color("#ffffff", 0.22);
  const WHITE = Color.white();

  let data;
  try { data = await fetchData(); }
  catch (e) {
    const t = w.addText(`数据加载失败\n${e.message || e}`);
    t.textColor = WARN; t.font = Font.systemFont(12);
    return w;
  }

  const tgt = calcTargets(data.profile);
  const proteinPct = tgt.protein ? data.food.protein / tgt.protein : 0;
  const kcalPct = tgt.kcal ? data.food.kcal / tgt.kcal : 0;
  const wd = ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];
  const icons = {push:'💪',pull:'🔙',cardio:'🚴',legs:'🦵',shoulder:'👆',rest:'😴'};
  const icon = icons[tgt.todayType] || '';

  // ══ 头部：图标 + 类型 + 日期 ══
  const hdr = w.addStack(); hdr.centerAlignContent();
  const hIcon = hdr.addText(icon + ' ');
  hIcon.font = Font.systemFont(17);
  const hLabel = hdr.addText(tgt.label);
  hLabel.font = Font.boldSystemFont(17);
  hLabel.textColor = WHITE;
  if (tgt.isDietBreak) {
    hdr.addSpacer(6);
    const db = hdr.addText('Diet Break');
    db.font = Font.boldSystemFont(10);
    db.textColor = PURPLE;
  }
  hdr.addSpacer();
  const hWD = hdr.addText(wd);
  hWD.font = Font.systemFont(13);
  hWD.textColor = DIM;

  // 副标题：热量目标
  w.addSpacer(3);
  const sub = w.addText(`${tgt.kcal}kcal · 蛋白${tgt.protein}g · 碳水${tgt.carbs}g · 脂肪${tgt.fat}g`);
  sub.font = Font.systemFont(10);
  sub.textColor = FAINT;

  w.addSpacer(14);

  // ══ 蛋白 + 热量 双进度条 ══
  const pRow = w.addStack(); pRow.centerAlignContent();
  const pLab = pRow.addText('蛋白 ');
  pLab.font = Font.systemFont(12); pLab.textColor = DIM;
  addProgressBar(pRow, proteinPct, 115, ACCENT);
  pRow.addSpacer(7);
  const pVal = pRow.addText(`${Math.round(data.food.protein)}/${tgt.protein}`);
  pVal.font = Font.mediumSystemFont(12); pVal.textColor = WHITE;

  w.addSpacer(5);

  const kRow = w.addStack(); kRow.centerAlignContent();
  const kLab = kRow.addText('热量 ');
  kLab.font = Font.systemFont(12); kLab.textColor = DIM;
  addProgressBar(kRow, kcalPct, 115, kcalPct > 1.05 ? WARN : ACCENT);
  kRow.addSpacer(7);
  const kVal = kRow.addText(`${Math.round(data.food.kcal)}/${tgt.kcal}`);
  kVal.font = Font.mediumSystemFont(12); kVal.textColor = WHITE;

  w.addSpacer(14);

  // 分割线
  const div = w.addStack(); div.size = new Size(0, 1);
  div.backgroundColor = new Color('#ffffff', 0.07);
  w.addSpacer(12);

  // ══ 底部三列：体重 / 睡眠 / 训练 ══
  const bot = w.addStack(); bot.centerAlignContent();
  // 体重
  const wCol = bot.addStack(); wCol.layoutHorizontally();
  const wLab = bot.addText(`体重\n`);
  wLab.font = Font.systemFont(10); wLab.textColor = DIM;
  const wVal = bot.addText(data.weight != null ? `${data.weight.toFixed(1)}` : '--');
  wVal.font = Font.boldSystemFont(16); wVal.textColor = WHITE;
  const wUnit = bot.addText(' kg');
  wUnit.font = Font.systemFont(9); wUnit.textColor = DIM;

  bot.addSpacer();

  // 睡眠
  const sCol = bot.addStack(); sCol.layoutHorizontally();
  const sLab = bot.addText(`睡眠\n`);
  sLab.font = Font.systemFont(10); sLab.textColor = DIM;
  const sH = data.sleepH;
  const sVal = bot.addText(sH != null ? `${sH.toFixed(1)}` : '--');
  sVal.font = Font.boldSystemFont(16);
  sVal.textColor = (sH != null && sH >= 7) ? ACCENT : (sH != null && sH >= 6) ? WARN : WHITE;
  const sUnit = bot.addText(' h');
  sUnit.font = Font.systemFont(9); sUnit.textColor = DIM;

  bot.addSpacer();

  // 训练
  const tCol = bot.addStack(); tCol.layoutHorizontally();
  const tLab = bot.addText(`近7天\n`);
  tLab.font = Font.systemFont(10); tLab.textColor = DIM;
  const tNum = data.trainedThisWeek;
  const tVal = bot.addText(`${tNum}/6`);
  tVal.font = Font.boldSystemFont(16);
  tVal.textColor = tNum >= 5 ? ACCENT : tNum >= 3 ? WARN : new Color('#E85858');
  const tUnit = bot.addText(' 训');
  tUnit.font = Font.systemFont(9); tUnit.textColor = DIM;

  // ══ 11周计划进度条 ══
  if (tgt.week && !tgt.week.done) {
    w.addSpacer(12);
    const pp = w.addStack(); pp.centerAlignContent();
    const ppLab = pp.addText(`W${tgt.week.weekNum}/11 `);
    ppLab.font = Font.systemFont(9); ppLab.textColor = DIM;
    addProgressBar(pp, tgt.week.weekNum / 11, 100, PURPLE);
    pp.addSpacer(6);
    const ppVal = pp.addText(`${tgt.week.targetWeight}kg`);
    ppVal.font = Font.systemFont(9); ppVal.textColor = FAINT;
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
