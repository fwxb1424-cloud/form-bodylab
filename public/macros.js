/**
 * FORM · Body Lab — 营养目标与档案
 * 根据体重、体脂、目标、训练/休息日计算 P/F/C 与热量
 */

const GOAL_KEYS = {
  '增肌减脂（Recomp）': 'recomp',
  '纯增肌（Bulk）': 'bulk',
  '减脂保肌（Cut）': 'cut',
  '力量提升': 'strength',
};

const DEFAULT_PROFILE = {
  height_cm: 175,
  weight_kg: 75,
  age: 28,
  sex: '男',
  activity: 'moderate',
  goalLabel: '增肌减脂（Recomp）',
  goalKey: 'recomp',
  fat_pct: 17.8,
  muscle_kg: null,
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
  localStorage.setItem('form_profile', JSON.stringify(p));
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
  return GOAL_KEYS[label] || 'recomp';
}

function calcBMR(p) {
  const w = p.weight_kg;
  const h = p.height_cm;
  const a = p.age || 28;
  if (p.sex === '女') return 10 * w + 6.25 * h - 5 * a - 161;
  return 10 * w + 6.25 * h - 5 * a + 5;
}

function getLeanMass(p) {
  if (p.muscle_kg && p.muscle_kg > 20) return p.muscle_kg;
  const fat = p.fat_pct ?? 15;
  return p.weight_kg * (1 - fat / 100);
}

function calcTDEE(p) {
  const mult = { light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }[p.activity] || 1.55;
  let tdee = calcBMR(p) * mult;
  const g = p.goalKey || 'recomp';
  if (g === 'cut') tdee *= 0.86;
  else if (g === 'bulk') tdee *= 1.08;
  else if (g === 'recomp') tdee *= 0.96;
  else if (g === 'strength') tdee *= 1.02;
  return Math.round(tdee);
}

/**
 * @param {object} p 档案
 * @param {boolean} isTrain 训练日
 * @param {'high'|'medium'|'low'} intensity
 */
function calcDailyTargets(p, isTrain = true, intensity = 'medium') {
  const goal = p.goalKey || 'recomp';
  const lbm = getLeanMass(p);
  const tdee = calcTDEE(p);

  const proteinPerKg = { cut: 2.35, recomp: 2.15, bulk: 2.0, strength: 2.1 }[goal] || 2.1;
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
    protein,
    fat,
    carbs,
    kcal,
    tdee,
    lbm: Math.round(lbm * 10) / 10,
    isTrain,
    goal,
  };
}

/** 规则引擎：今日剩余怎么吃不靠 AI 也能看 */
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
      tip: isTrain ? '训练前 2–3h：瘦肉 + 米饭/土豆' : '午餐补足全天约 35% 蛋白',
    });
  }
  if (isTrain && h >= 14 && h < 20) {
    meals.push({
      slot: '练前/练后',
      items: `快碳 ${Math.round(Math.min(rem.c, 60))}g · 蛋白 ${Math.round(Math.min(rem.p, 40))}g`,
      tip: '练后 30–60 分钟内：乳清 + 香蕉/米饭',
    });
  }
  if (rem.p > 8) {
    meals.push({
      slot: '晚餐',
      items: `蛋白 ${Math.round(rem.p * 0.3)}g · 脂肪 ${Math.round(rem.f * 0.35)}g · 碳水 ${Math.round(rem.c * 0.25)}g`,
      tip: '晚餐脂肪可略高，碳水随休息日降低',
    });
  }
  if (rem.p > 20) {
    meals.push({
      slot: '补救',
      items: `${(rem.p / 30).toFixed(1)} 勺乳清 或 ${Math.round(rem.p / 0.27)}g 去皮鸡胸`,
      tip: `还差约 ${Math.round(rem.p)}g 蛋白质`,
    });
  }

  const pctP = targets.protein ? Math.round(((consumed.protein || 0) / targets.protein) * 100) : 0;
  let headline = pctP >= 100 ? '今日蛋白质已达标' : `蛋白质完成 ${pctP}% · 还差 ${Math.round(rem.p)}g`;
  if (!isTrain && rem.c > 80) headline += ' · 休息日注意控制碳水';

  return { headline, meals, remaining: rem };
}

window.loadProfile = loadProfile;
window.saveProfile = saveProfile;
window.mergeProfile = mergeProfile;
window.goalKeyFromLabel = goalKeyFromLabel;
window.calcDailyTargets = calcDailyTargets;
window.buildRuleMealPlan = buildRuleMealPlan;
window.DEFAULT_PROFILE = DEFAULT_PROFILE;
