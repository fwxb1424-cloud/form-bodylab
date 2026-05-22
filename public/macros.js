/**
 * FORM · Body Lab — 营养目标与档案 v3.1
 *
 * 双模式：
 *   PLAN_MODE = true  → 使用硬编码的定制计划数字（Cole减脂期）
 *   PLAN_MODE = false → 根据档案动态计算（通用模式，以后改目标时切换）
 *
 * 切换方式：在「计划」页的「我的周期」里有训练日/休息日切换，
 * 或手动改 localStorage 'form_plan_mode' 为 '0' 关闭。
 */

// ── 定制计划数字（与教练方案完全一致）─────────────────────
const COLE_PLAN = {
  // 阶段一：减脂保肌期 W1–W8
  cut: {
    train: { kcal: 2220, protein: 168, carbs: 220, fat: 75 },
    rest:  { kcal: 1950, protein: 168, carbs: 140, fat: 80 },
    label: '减脂保肌期',
    phase: 'cut',
  },
  // 阶段二：精分重塑期 W10–W17（以后切换）
  recomp: {
    train: { kcal: 2620, protein: 168, carbs: 275, fat: 92 },
    rest:  { kcal: 2450, protein: 168, carbs: 210, fat: 92 },
    label: '精分重塑期',
    phase: 'recomp',
  },
  // 阶段三：干净增肌期 W19–W28
  bulk: {
    train: { kcal: 2970, protein: 168, carbs: 335, fat: 100 },
    rest:  { kcal: 2650, protein: 168, carbs: 245, fat: 100 },
    label: '干净增肌期',
    phase: 'bulk',
  },
  // Deload周
  deload: {
    train: { kcal: 2420, protein: 168, carbs: 255, fat: 90 },
    rest:  { kcal: 2420, protein: 168, carbs: 255, fat: 90 },
    label: 'Deload恢复周',
    phase: 'deload',
  },
};

// 当前激活的计划阶段（存localStorage，方便以后切换）
function getActivePlanPhase() {
  return localStorage.getItem('form_plan_phase') || 'cut';
}
function setActivePlanPhase(phase) {
  localStorage.setItem('form_plan_phase', phase);
}

// 是否使用计划模式（默认true）
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

// Cole的默认档案——第一次打开就是这些值，不是空白
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
    // 合并：优先用已保存的值，缺失字段才用默认值
    return { ...DEFAULT_PROFILE, ...(p || {}) };
  } catch (e) {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p) {
  // 保存前确保所有字段都有值
  const merged = { ...DEFAULT_PROFILE, ...p };
  localStorage.setItem('form_profile', JSON.stringify(merged));
}

/** 合并档案 + 当日体成分（形体页更新会写入 S） */
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

// ── BMR / TDEE（通用模式备用）──────────────────────────────
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
 * 计划模式 → 直接用COLE_PLAN硬编码数字
 * 通用模式 → 动态计算（给其他用户用）
 */
function calcDailyTargets(p, isTrain = true, intensity = 'medium') {
  if (isPlanMode()) {
    // ── 计划模式：使用定制数字 ──
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

  // ── 通用模式：动态计算（为将来其他用户保留）──
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

/** 规则引擎：今日剩余怎么吃 */
function buildRuleMealPlan(targets, consumed, isTrain) {
  const rem = {
    p: Math.max(0, targets.protein - (consumed.protein || 0)),
    c: Math.max(0, targets.carbs - (consumed.carbs || 0)),
    f: Math.max(0, targets.fat - (consumed.fat || 0)),
    k: Math.max(0, targets.kcal - (consumed.kcal || 0)),
  };
  const h = new Date().getHours();
  const meals = [];

  if (h < 10 && rem.p > 15) {
    meals.push({
      slot: '早餐',
      items: `蛋白 ${Math.round(rem.p * 0.25)}g · 碳水 ${Math.round(rem.c * 0.2)}g`,
      tip: '优先蛋白质 + 适量慢碳（燕麦/全麦）',
    });
  }
  if (h < 14 && rem.p > 10) {
    meals.push({
      slot: '午餐',
      items: `蛋白 ${Math.round(rem.p * 0.35)}g · 碳水 ${Math.round(rem.c * 0.35)}g`,
      tip: isTrain ? '训练前2–3h：瘦肉+米饭' : '午餐补足全天约35%蛋白',
    });
  }
  if (isTrain && h >= 14 && h < 20) {
    meals.push({
      slot: '练前/练后',
      items: `快碳 ${Math.round(Math.min(rem.c * 0.25, 50))}g · 蛋白 ${Math.round(Math.min(rem.p * 0.25, 40))}g`,
      tip: '练后30–60分钟内：乳清蛋白+香蕉/米饭',
    });
  }
  if (rem.p > 8) {
    meals.push({
      slot: '晚餐',
      items: `蛋白 ${Math.round(rem.p * 0.3)}g · 脂肪 ${Math.round(rem.f * 0.35)}g · 碳水 ${Math.round(rem.c * 0.2)}g`,
      tip: isTrain ? '晚餐碳水适度，训练后已补充' : '休息日晚餐控碳水',
    });
  }
  if (rem.p > 20) {
    meals.push({
      slot: '蛋白补救',
      items: `${(rem.p / 30).toFixed(1)}勺乳清 或 ${Math.round(rem.p / 0.27)}g 去皮鸡胸`,
      tip: `⚠ 还差约${Math.round(rem.p)}g蛋白质，168g是底线`,
    });
  }

  const pctP = targets.protein ? Math.round(((consumed.protein || 0) / targets.protein) * 100) : 0;
  let headline = pctP >= 100
    ? '✅ 今日蛋白质已达标'
    : `蛋白质完成 ${pctP}% · 还差 ${Math.round(rem.p)}g`;
  if (!isTrain && rem.c > 60) headline += ' · 休息日控碳水';

  return { headline, meals, remaining: rem };
}

window.loadProfile = loadProfile;
window.saveProfile = saveProfile;
window.mergeProfile = mergeProfile;
window.goalKeyFromLabel = goalKeyFromLabel;
window.calcDailyTargets = calcDailyTargets;
window.buildRuleMealPlan = buildRuleMealPlan;
window.DEFAULT_PROFILE = DEFAULT_PROFILE;
window.COLE_PLAN = COLE_PLAN;
window.getActivePlanPhase = getActivePlanPhase;
window.setActivePlanPhase = setActivePlanPhase;
window.isPlanMode = isPlanMode;
