/**
 * FORM · Body Lab — 营养目标与档案 v4.0
 *
 * 升级内容：
 *   1. 队列锚点（anchor）机制 — 不再靠最近一条 session 倒推，改用绝对日期+索引
 *   2. 体重快录辅助函数（供概况页直接调用）
 *   3. 补剂时间槽（早/练前/睡前），供 Telegram 和概况页精准提醒
 *   4. 阶段切换时自动记录切换日期，供进度条计算
 */

// ── 定制计划数字（与教练方案完全一致）─────────────────────
const COLE_PLAN = {
  cut: {
    train: { kcal: 2220, protein: 168, carbs: 220, fat: 75 },
    rest:  { kcal: 1950, protein: 168, carbs: 140, fat: 80 },
    label: '减脂保肌期',
    phase: 'cut',
    durationWeeks: 8,
  },
  recomp: {
    train: { kcal: 2620, protein: 168, carbs: 275, fat: 92 },
    rest:  { kcal: 2450, protein: 168, carbs: 210, fat: 92 },
    label: '精分重塑期',
    phase: 'recomp',
    durationWeeks: 8,
  },
  bulk: {
    train: { kcal: 2970, protein: 168, carbs: 335, fat: 100 },
    rest:  { kcal: 2650, protein: 168, carbs: 245, fat: 100 },
    label: '干净增肌期',
    phase: 'bulk',
    durationWeeks: 10,
  },
  deload: {
    train: { kcal: 2420, protein: 168, carbs: 255, fat: 90 },
    rest:  { kcal: 2420, protein: 168, carbs: 255, fat: 90 },
    label: 'Deload恢复周',
    phase: 'deload',
    durationWeeks: 1,
  },
};

// ── 队列定义（全局唯一，所有模块共用）─────────────────────
const PLAN_QUEUE_DEF = ['push', 'pull', 'cardio', 'legs', 'shoulder', 'cardio', 'rest'];
const TRAIN_LABEL_MAP = {
  push:     '推日（胸·侧束·三头）',
  pull:     '拉日（背·二头）',
  cardio:   '有氧+核心日',
  legs:     '腿日（股四·后链·臀）',
  shoulder: '肩日（三角肌）',
  rest:     '休息日',
};

// ── 队列锚点（解决漂移问题的核心）─────────────────────────
/**
 * 锚点结构：{ date: '2025-06-01', index: 0 }
 * date  = 某个已知的训练日期（ISO yyyy-mm-dd）
 * index = 该日期在 PLAN_QUEUE_DEF 中的索引
 *
 * 计算今日类型：从锚点日期数到今天，取模得到索引
 * 这样即使跳课/连续休息也不会漂移
 */
function getQueueAnchor() {
  try {
    const raw = localStorage.getItem('form_queue_anchor');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // 默认锚点：从今天开始，索引0（push）
  const anchor = {
    date: new Date().toISOString().slice(0, 10),
    index: 0,
  };
  localStorage.setItem('form_queue_anchor', JSON.stringify(anchor));
  return anchor;
}

function setQueueAnchor(dateStr, index) {
  const anchor = { date: dateStr, index };
  localStorage.setItem('form_queue_anchor', JSON.stringify(anchor));
}

/**
 * 根据锚点计算指定日期（yyyy-mm-dd）应该是哪种训练
 */
function getQueueTypeForDate(dateStr) {
  const anchor = getQueueAnchor();
  const anchorDate = new Date(anchor.date + 'T00:00:00');
  const targetDate = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((targetDate - anchorDate) / 86400000);
  const idx = ((anchor.index + diffDays) % PLAN_QUEUE_DEF.length + PLAN_QUEUE_DEF.length) % PLAN_QUEUE_DEF.length;
  return PLAN_QUEUE_DEF[idx];
}

/**
 * 今日应该训练什么
 */
function getTodayQueueType() {
  return getQueueTypeForDate(new Date().toISOString().slice(0, 10));
}

/**
 * 明日应该训练什么
 */
function getTomorrowQueueType() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return getQueueTypeForDate(tomorrow.toISOString().slice(0, 10));
}

/**
 * 手动将今天设定为指定队列类型（完成训练后可以调用）
 * 会自动重新设置锚点，之后的推算都基于此
 */
function markTodayAs(queueType) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const idx = PLAN_QUEUE_DEF.indexOf(queueType);
  if (idx !== -1) setQueueAnchor(todayStr, idx);
}

/**
 * 获取本周（周一到周日）各天的计划类型
 */
function getWeekQueuePlan() {
  const today = new Date();
  const dow = today.getDay(); // 0=日
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    return {
      date: dateStr,
      dow: i, // 0=周一
      type: getQueueTypeForDate(dateStr),
    };
  });
}

// ── 阶段管理 ───────────────────────────────────────────────
function getActivePlanPhase() {
  return localStorage.getItem('form_plan_phase') || 'cut';
}

function setActivePlanPhase(phase) {
  const prev = getActivePlanPhase();
  if (prev === phase) return;
  localStorage.setItem('form_plan_phase', phase);
  // 切换阶段时记录新的开始日期
  localStorage.setItem('form_cycle_start', new Date().toISOString());
  // 触发 UI 通知（如果有的话）
  if (typeof toast === 'function') {
    const plan = COLE_PLAN[phase];
    toast(`✓ 已切换到：${plan?.label || phase}`);
  }
}

/** 当前阶段已经过了几周 */
function getCurrentPhaseWeek() {
  const start = localStorage.getItem('form_cycle_start');
  if (!start) return 1;
  const elapsed = Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
  return Math.max(1, Math.floor(elapsed / 7) + 1);
}

/** 阶段进度百分比（0–100） */
function getPhaseProgress() {
  const phase = getActivePlanPhase();
  const plan = COLE_PLAN[phase];
  const totalWeeks = plan?.durationWeeks || 8;
  const week = getCurrentPhaseWeek();
  return Math.min(100, Math.round((week - 1) / totalWeeks * 100));
}

/** 是否接近阶段结束（最后一周触发切换提示） */
function isNearPhaseEnd() {
  const phase = getActivePlanPhase();
  const plan = COLE_PLAN[phase];
  if (!plan) return false;
  const week = getCurrentPhaseWeek();
  return week >= plan.durationWeeks;
}

function isPlanMode() {
  return localStorage.getItem('form_plan_mode') !== '0';
}

// ── 档案管理 ───────────────────────────────────────────────
const GOAL_KEYS = {
  '增肌减脂（Recomp）': 'recomp',
  '纯增肌（Bulk）': 'bulk',
  '减脂保肌（Cut）': 'cut',
  '力量提升': 'strength',
};

const DEFAULT_PROFILE = {
  height_cm: 186,
  weight_kg: 85,
  age: 22,
  sex: '男',
  activity: 'moderate',
  goalLabel: '减脂保肌（Cut）',
  goalKey: 'cut',
  fat_pct: 17.8,
  muscle_kg: 40.4,
};

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('form_profile') || 'null');
    return { ...DEFAULT_PROFILE, ...(p || {}) };
  } catch (e) {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p) {
  const merged = { ...DEFAULT_PROFILE, ...p };
  localStorage.setItem('form_profile', JSON.stringify(merged));
}

function mergeProfile(S) {
  const p = loadProfile();
  if (S?.muscle > 20) p.muscle_kg = S.muscle;
  if (S?.fat_pct > 0) p.fat_pct = S.fat_pct;
  if (!p.weight_kg || p.weight_kg < 40) p.weight_kg = DEFAULT_PROFILE.weight_kg;
  return p;
}

function goalKeyFromLabel(label) {
  return GOAL_KEYS[label] || 'cut';
}

// ── 体重快录辅助 ───────────────────────────────────────────
/**
 * 保存今日体重（轻量版，只写 weight_kg，其余字段沿用最近 body_stats）
 * 调用方负责传入 db 实例
 */
async function saveQuickWeight(weight_kg, db) {
  if (!weight_kg || weight_kg < 40 || weight_kg > 200) return;

  // 更新本地档案
  const p = loadProfile();
  p.weight_kg = weight_kg;
  saveProfile(p);

  // 写入 Supabase（复用最近的肌肉/体脂数据，只更新体重估算）
  if (db) {
    const latest = await db.getLatestBodyStat().catch(() => null);
    const muscle_kg = latest?.muscle_kg || p.muscle_kg || DEFAULT_PROFILE.muscle_kg;
    // 根据最新体脂率估算新的肌肉量（体重变了，保持体脂率不变用于估算）
    const fat_pct = latest?.fat_pct || p.fat_pct || DEFAULT_PROFILE.fat_pct;
    await db.addBodyStat({ weight_kg, muscle_kg, fat_pct });
  }

  // 缓存时间戳
  localStorage.setItem('form_last_weight', JSON.stringify({
    weight_kg,
    ts: Date.now(),
    date: new Date().toISOString().slice(0, 10),
  }));
  localStorage.setItem('form_last_stat_ts', Date.now().toString());
}

/** 获取最近一次体重记录（含日期） */
function getLastWeightRecord() {
  try {
    const raw = localStorage.getItem('form_last_weight');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/** 距上次体重记录几天 */
function daysSinceLastWeight() {
  const rec = getLastWeightRecord();
  if (!rec) return 999;
  return Math.floor((Date.now() - rec.ts) / 86400000);
}

// ── 补剂时间槽管理 ─────────────────────────────────────────
/**
 * 补剂结构升级：每个补剂新增 time_slot 字段
 * time_slot: 'morning' | 'pre_workout' | 'bedtime' | 'anytime'
 *
 * 默认补剂（含时间槽）
 */
const DEFAULT_SUPPS = [
  { key: 'cr',   name: '肌酸',     dose: '5g',   on: false, time_slot: 'morning' },
  { key: 'vit',  name: '综合维生素', dose: '1粒',  on: false, time_slot: 'morning' },
  { key: 'om3',  name: 'Omega-3',  dose: '2粒',  on: false, time_slot: 'bedtime' },
];

const SUPP_SLOT_LABELS = {
  morning:     '早上',
  pre_workout: '练前',
  bedtime:     '睡前',
  anytime:     '任意',
};

function loadSupps() {
  try {
    const raw = localStorage.getItem('form_supps');
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SUPPS));
    const arr = JSON.parse(raw);
    // 迁移旧数据：补充 time_slot 字段
    return arr.map(s => ({
      time_slot: 'morning',
      ...s,
    }));
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_SUPPS));
  }
}

function saveSuppsData(arr) {
  localStorage.setItem('form_supps', JSON.stringify(arr));
}

/**
 * 获取指定时间槽的补剂
 * slot: 'morning' | 'pre_workout' | 'bedtime'
 */
function getSuppsBySlot(slot) {
  return loadSupps().filter(s => s.time_slot === slot || (slot === 'morning' && !s.time_slot));
}

/** 获取今日未打卡的补剂（按时间槽分组） */
function getUncompletedSuppsBySlot() {
  const supps = loadSupps();
  const result = { morning: [], pre_workout: [], bedtime: [], anytime: [] };
  supps.forEach(s => {
    if (!s.on) {
      const slot = s.time_slot || 'morning';
      result[slot] = result[slot] || [];
      result[slot].push(s);
    }
  });
  return result;
}

// ── BMR / TDEE ─────────────────────────────────────────────
function calcBMR(p) {
  const w = p.weight_kg;
  const h = p.height_cm;
  const a = p.age || 22;
  if (p.sex === '女') return 10 * w + 6.25 * h - 5 * a - 161;
  return 10 * w + 6.25 * h - 5 * a + 5;
}

function getLeanMass(p) {
  if (p.muscle_kg && p.muscle_kg > 20) return p.muscle_kg;
  const fat = p.fat_pct ?? 17.8;
  return p.weight_kg * (1 - fat / 100);
}

function calcTDEE(p) {
  const mult = { light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }[p.activity] || 1.55;
  return Math.round(calcBMR(p) * mult);
}

/**
 * 核心函数：返回今日营养目标
 */
function calcDailyTargets(p, isTrain = true, intensity = 'medium') {
  if (isPlanMode()) {
    const phase = getActivePlanPhase();
    const plan = COLE_PLAN[phase] || COLE_PLAN.cut;
    const nums = isTrain ? plan.train : plan.rest;
    const lbm = getLeanMass(p || loadProfile());
    const tdee = calcTDEE(p || loadProfile());
    return {
      protein: nums.protein,
      fat: nums.fat,
      carbs: nums.carbs,
      kcal: nums.kcal,
      tdee,
      lbm: Math.round(lbm * 10) / 10,
      isTrain,
      goal: phase,
      planLabel: plan.label,
      isPlanMode: true,
    };
  }

  // 通用模式
  const goal = p.goalKey || 'cut';
  const lbm = getLeanMass(p);
  const tdee = calcTDEE(p);
  const proteinPerKg = { cut: 2.4, recomp: 2.15, bulk: 2.0, strength: 2.1 }[goal] || 2.4;
  let protein = Math.round(lbm * proteinPerKg);
  protein = Math.max(130, Math.min(240, protein));
  let fat = Math.round(Math.max(p.weight_kg * 0.85, (tdee * (goal === 'cut' ? 0.26 : 0.28)) / 9));
  fat = Math.max(45, Math.min(120, fat));
  const im = { high: 1.12, medium: 1, low: 0.92 }[intensity] || 1;
  let kcal = tdee;
  if (!isTrain) kcal = Math.round(tdee * (goal === 'bulk' ? 0.92 : 0.88));
  else kcal = Math.round(tdee * (goal === 'bulk' ? 1.06 : 1) * im);
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  const restCarbs = Math.round((Math.round(tdee * 0.88) - protein * 4 - fat * 9) / 4);
  const trainBump = { cut: 35, recomp: 55, bulk: 75, strength: 50 }[goal] || 50;
  if (isTrain) carbs = Math.max(carbs, restCarbs + trainBump);
  else carbs = Math.max(70, Math.min(carbs, restCarbs + 15));
  carbs = Math.max(60, Math.min(420, carbs));
  kcal = protein * 4 + carbs * 4 + fat * 9;
  return {
    protein, fat, carbs, kcal, tdee,
    lbm: Math.round(lbm * 10) / 10,
    isTrain, goal,
    planLabel: null,
    isPlanMode: false,
  };
}

function buildRuleMealPlan(targets, consumed, isTrain) {
  const rem = {
    p: Math.max(0, targets.protein - (consumed.protein || 0)),
    c: Math.max(0, targets.carbs - (consumed.carbs || 0)),
    f: Math.max(0, targets.fat - (consumed.fat || 0)),
    k: Math.max(0, targets.kcal - (consumed.kcal || 0)),
  };
  const h = new Date().getHours();
  const meals = [];
  if (h < 10 && rem.p > 15) meals.push({ slot:'早餐', items:`蛋白 ${Math.round(rem.p*0.25)}g · 碳水 ${Math.round(rem.c*0.2)}g`, tip:'优先蛋白质 + 适量慢碳（燕麦/全麦）' });
  if (h < 14 && rem.p > 10) meals.push({ slot:'午餐', items:`蛋白 ${Math.round(rem.p*0.35)}g · 碳水 ${Math.round(rem.c*0.35)}g`, tip:isTrain?'训练前2–3h：瘦肉+米饭':'午餐补足全天约35%蛋白' });
  if (isTrain && h >= 14 && h < 20) meals.push({ slot:'练前/练后', items:`快碳 ${Math.round(Math.min(rem.c*0.25,50))}g · 蛋白 ${Math.round(Math.min(rem.p*0.25,40))}g`, tip:'练后30–60分钟内：乳清蛋白+香蕉/米饭' });
  if (rem.p > 8) meals.push({ slot:'晚餐', items:`蛋白 ${Math.round(rem.p*0.3)}g · 脂肪 ${Math.round(rem.f*0.35)}g · 碳水 ${Math.round(rem.c*0.2)}g`, tip:isTrain?'晚餐碳水适度，训练后已补充':'休息日晚餐控碳水' });
  if (rem.p > 20) meals.push({ slot:'蛋白补救', items:`${(rem.p/30).toFixed(1)}勺乳清 或 ${Math.round(rem.p/0.27)}g 去皮鸡胸`, tip:`⚠ 还差约${Math.round(rem.p)}g蛋白质，168g是底线` });
  const pctP = targets.protein ? Math.round(((consumed.protein||0)/targets.protein)*100) : 0;
  let headline = pctP >= 100 ? '✅ 今日蛋白质已达标' : `蛋白质完成 ${pctP}% · 还差 ${Math.round(rem.p)}g`;
  if (!isTrain && rem.c > 60) headline += ' · 休息日控碳水';
  return { headline, meals, remaining: rem };
}

// ── 导出到全局 ─────────────────────────────────────────────
window.loadProfile = loadProfile;
window.saveProfile = saveProfile;
window.mergeProfile = mergeProfile;
window.goalKeyFromLabel = goalKeyFromLabel;
window.calcDailyTargets = calcDailyTargets;
window.buildRuleMealPlan = buildRuleMealPlan;
window.DEFAULT_PROFILE = DEFAULT_PROFILE;
window.COLE_PLAN = COLE_PLAN;
window.PLAN_QUEUE_DEF = PLAN_QUEUE_DEF;
window.TRAIN_LABEL_MAP = TRAIN_LABEL_MAP;
window.getActivePlanPhase = getActivePlanPhase;
window.setActivePlanPhase = setActivePlanPhase;
window.isPlanMode = isPlanMode;
// 队列锚点 API
window.getQueueAnchor = getQueueAnchor;
window.setQueueAnchor = setQueueAnchor;
window.getTodayQueueType = getTodayQueueType;
window.getTomorrowQueueType = getTomorrowQueueType;
window.getQueueTypeForDate = getQueueTypeForDate;
window.getWeekQueuePlan = getWeekQueuePlan;
window.markTodayAs = markTodayAs;
// 阶段进度
window.getCurrentPhaseWeek = getCurrentPhaseWeek;
window.getPhaseProgress = getPhaseProgress;
window.isNearPhaseEnd = isNearPhaseEnd;
// 体重快录
window.saveQuickWeight = saveQuickWeight;
window.getLastWeightRecord = getLastWeightRecord;
window.daysSinceLastWeight = daysSinceLastWeight;
// 补剂
window.DEFAULT_SUPPS = DEFAULT_SUPPS;
window.SUPP_SLOT_LABELS = SUPP_SLOT_LABELS;
window.loadSupps = loadSupps;
window.saveSuppsData = saveSuppsData;
window.getSuppsBySlot = getSuppsBySlot;
window.getUncompletedSuppsBySlot = getUncompletedSuppsBySlot;
