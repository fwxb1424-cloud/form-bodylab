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

// ── 11周执行计划（6/12 → 8/27，缓冲至8/31）───────────────
/**
 * 这是 cut 阶段内的精细化计划：
 *   - 每周有目标体重检查点（7日均值对照）
 *   - 第6周是 diet break，宏量固定为 2900/180/320/100（训练日/休息日相同）
 *   - 支持 ±100kcal 的累积微调（周日复盘后应用），影响 cut 阶段的 train/rest kcal+carbs
 */
const PLAN_11WEEK = {
  startDate: '2026-06-12', // 第1周周一
  totalWeeks: 11,
  dietBreakWeek: 6,
  // 每周目标体重（7日均值，kg），index 0 = 第1周
  weeklyTargetWeights: [84.35, 83.70, 83.05, 82.40, 81.75, 81.75, 81.10, 80.45, 79.80, 79.15, 78.50],
  dietBreakMacros: { kcal: 2900, protein: 180, carbs: 320, fat: 100, label: 'Diet Break · 战略恢复周' },
  dietBreakOverGainKcal: 2700, // diet break期间体重涨>2kg时改用此值
  kcalStep: 100,
};

/** 当前处于11周计划的第几周、是否diet break、本周目标体重等 */
function getElevenWeekStatus() {
  const start = new Date(PLAN_11WEEK.startDate + 'T00:00:00');
  const diffDays = Math.floor((Date.now() - start.getTime()) / 86400000);
  let weekNum = Math.floor(diffDays / 7) + 1;
  const done = weekNum > PLAN_11WEEK.totalWeeks;
  if (done) weekNum = PLAN_11WEEK.totalWeeks;
  const idx = Math.max(0, Math.min(PLAN_11WEEK.totalWeeks - 1, weekNum - 1));
  const targetWeight = PLAN_11WEEK.weeklyTargetWeights[idx];
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() + (weekNum - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return {
    weekNum,
    done,
    isDietBreak: !done && weekNum === PLAN_11WEEK.dietBreakWeek,
    targetWeight,
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
    totalDays: PLAN_11WEEK.totalWeeks * 7,
    daysElapsed: Math.max(0, diffDays),
  };
}

/** 当前累积的kcal微调（周日复盘后用 applyKcalAdjustment 修改） */
function getKcalAdjustment() {
  return parseInt(localStorage.getItem('form_kcal_adjustment') || '0', 10) || 0;
}
function setKcalAdjustment(val) {
  localStorage.setItem('form_kcal_adjustment', String(val));
}
/** delta: +100 或 -100（按 PLAN_11WEEK.kcalStep 的倍数） */
function applyKcalAdjustment(delta) {
  const next = getKcalAdjustment() + delta;
  setKcalAdjustment(next);
  if (typeof toast === 'function') {
    toast(`✓ 全天热量已${delta > 0 ? '上调' : '下调'}${Math.abs(delta)}kcal（累计${next>0?'+':''}${next}）`);
  }
  return next;
}

/**
 * 周复盘：拉取最近7天体重，对比本周目标体重，给出调整建议
 * 调整规则：
 *   - 7日均值比目标重 >0.3kg，且上周也是 → 建议 -100kcal
 *   - 7日均值比目标重 >0.3kg，但上周不是 → 观察
 *   - 7日均值比目标轻 >0.4kg（脱速过快）→ 建议 +100kcal
 *   - 否则维持
 * diet break周（第6周）不做调整，但检测体重涨幅是否>2kg
 */
async function runWeeklyCheckpoint() {
  const status = getElevenWeekStatus();
  if (status.done) return { ...status, suggestion: { action: 'done', reason: '11周计划已完成，进入终测窗口' } };

  if (!window.db || typeof db.getWeightTrendDays !== 'function') {
    return { ...status, error: '无法读取体重历史（db未初始化）' };
  }
  const rows = await db.getWeightTrendDays(7).catch(() => []);
  if (rows.length < 5) {
    return { ...status, error: `体重记录不足（仅${rows.length}天），至少需要5天才能算7日均值` };
  }
  const avg = rows.reduce((a, r) => a + (r.weight_kg || 0), 0) / rows.length;
  const diff = avg - status.targetWeight;

  if (status.isDietBreak) {
    // diet break周：检查体重是否超涨
    const overGain = diff > 2;
    const suggestion = overGain
      ? { action: 'diet_break_reduce', reason: `本周体重涨幅超过2kg（实际${avg.toFixed(2)}kg vs 目标${status.targetWeight}kg），diet break改为${PLAN_11WEEK.dietBreakOverGainKcal}kcal` }
      : { action: 'diet_break_ok', reason: `本周体重涨幅在正常范围内（糖原+水分），无需调整` };
    return { ...status, avg: Math.round(avg * 100) / 100, diff: Math.round(diff * 100) / 100, suggestion };
  }

  // 记录本周checkpoint历史（用于判断"连续2周"）
  const hist = JSON.parse(localStorage.getItem('form_checkpoint_history') || '[]');
  const already = hist.find(h => h.week === status.weekNum);
  if (!already) {
    hist.push({ week: status.weekNum, avg, target: status.targetWeight, diff, ts: Date.now() });
    localStorage.setItem('form_checkpoint_history', JSON.stringify(hist.slice(-6)));
  }

  let suggestion = { action: 'hold', reason: `体重符合预期（${avg.toFixed(2)}kg vs 目标${status.targetWeight}kg），维持当前热量` };
  if (diff > 0.3) {
    const prev = hist.find(h => h.week === status.weekNum - 1);
    const consecutive = prev && prev.diff > 0.3;
    if (consecutive) {
      suggestion = { action: 'decrease', delta: -PLAN_11WEEK.kcalStep, reason: `连续2周高于目标体重（本周+${diff.toFixed(2)}kg），建议下调${PLAN_11WEEK.kcalStep}kcal` };
    } else {
      suggestion = { action: 'watch', reason: `本周高于目标体重 +${diff.toFixed(2)}kg，先观察一周` };
    }
  } else if (diff < -0.4) {
    suggestion = { action: 'increase', delta: PLAN_11WEEK.kcalStep, reason: `脱速过快（本周${diff.toFixed(2)}kg），建议上调${PLAN_11WEEK.kcalStep}kcal保护肌肉` };
  }

  return { ...status, avg: Math.round(avg * 100) / 100, diff: Math.round(diff * 100) / 100, suggestion };
}

// ── 云端同步：计划状态（供 Scriptable Widget 读取）────────────
/**
 * 把当前的队列锚点 + 阶段 + 11周计划微调状态写入 Supabase user_settings.profile_json
 * Widget 无法访问 PWA 的 localStorage，必须靠这份云端快照
 */
async function syncPlanStateToCloud() {
  if (!window.db || !db.settingsTableOk) return;
  try {
    const existing = await db.getSettings().catch(() => null);
    let profile = {};
    try { profile = JSON.parse(existing?.profile_json || '{}'); } catch (e) {}
    profile.queue_anchor = getQueueAnchor();
    profile.plan_phase = getActivePlanPhase();
    profile.cycle_start = localStorage.getItem('form_cycle_start');
    profile.kcal_adjustment = getKcalAdjustment();
    profile.diet_break_overgain = localStorage.getItem('form_diet_break_overgain') === '1';
    profile.plan_11week = PLAN_11WEEK; // 静态配置也存一份，Widget不用硬编码
    profile.updated_at = new Date().toISOString();
    await db.saveSettings({ profile_json: JSON.stringify(profile), supps_json: existing?.supps_json });
  } catch (e) {
    console.warn('[sync] syncPlanStateToCloud failed:', e);
  }
}
// 兼容旧调用名
async function syncQueueAnchor() { return syncPlanStateToCloud(); }

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

  // 正向反馈：新低体重
  try {
    const rows = await (db?.getWeightTrendDays ? db.getWeightTrendDays(7).catch(() => []) : []);
    if (rows.length >= 3) {
      const lowestIn7 = Math.min(...rows.map(r => r.weight_kg));
      if (weight_kg < lowestIn7 && typeof toast === 'function') {
        const drop = lowestIn7 - weight_kg;
        setTimeout(() => toast(`🎉 新低！比 7 日最低轻 ${drop.toFixed(1)}kg`), 500);
      }
    }
  } catch (e) {}
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
    let effectiveIsTrain = isTrain;
    let planLabel = plan.label;
    let elevenWeek = null;

    // 11周计划仅在 cut 阶段生效：
    // 计划里训练日/有氧日宏量相同(2220)，只有队列里的 rest(周日) 才是1950
    // 所以这里以队列类型为准，而不是 S.isTrain（S.isTrain 把 cardio 也算作非训练日）
    if (phase === 'cut' && typeof getTodayQueueType === 'function') {
      effectiveIsTrain = getTodayQueueType() !== 'rest';
    }

    let nums = effectiveIsTrain ? plan.train : plan.rest;
    const lbm = getLeanMass(p || loadProfile());
    const tdee = calcTDEE(p || loadProfile());

    if (phase === 'cut') {
      elevenWeek = getElevenWeekStatus();
      if (elevenWeek.isDietBreak) {
        // diet break周：训练日/休息日宏量统一，不受kcal微调影响
        const overGain = localStorage.getItem('form_diet_break_overgain') === '1';
        const dbm = overGain
          ? { ...PLAN_11WEEK.dietBreakMacros, kcal: PLAN_11WEEK.dietBreakOverGainKcal }
          : PLAN_11WEEK.dietBreakMacros;
        nums = { protein: dbm.protein, carbs: overGain ? Math.round((dbm.kcal - dbm.protein*4 - dbm.fat*9)/4) : dbm.carbs, fat: dbm.fat, kcal: dbm.kcal };
        planLabel = dbm.label;
      } else {
        // 应用累积kcal微调（碳水吸收变化，蛋白/脂肪不变）
        const adj = getKcalAdjustment();
        if (adj !== 0) {
          nums = {
            protein: nums.protein,
            fat: nums.fat,
            carbs: Math.max(0, nums.carbs + Math.round(adj / 4)),
            kcal: nums.kcal + adj,
          };
        }
      }
    }

    return {
      protein: nums.protein,
      fat: nums.fat,
      carbs: nums.carbs,
      kcal: nums.kcal,
      tdee,
      lbm: Math.round(lbm * 10) / 10,
      isTrain: effectiveIsTrain,
      goal: phase,
      planLabel,
      isPlanMode: true,
      elevenWeek,
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

// ── Dash 微复盘引擎 ──────────────────────────────────────────
/**
 * 在概况页加载时运行，返回需显示的提醒数组。
 * 每个提醒: { id, level, icon, title, description, action, actionLabel }
 * 非阻塞 — 所有 Promise 失败时静默处理，返回空数组。
 */
async function runDashAlerts() {
  if (!window.db) return [];
  try {
    const h = new Date().getHours();
    const S = window.S || {};
    const PT = typeof window.PT === 'function' ? window.PT : null;
    const proteinTarget = PT ? PT() : (S.proteinTarget || 168);

    const [
      weightTrendRows,
      latestBodyStat,
      todayFoodLogs,
      sleepLogs1,
      recentSessions7,
    ] = await Promise.all([
      window.db.getWeightTrendDays(8).catch(() => []),
      window.db.getLatestBodyStat().catch(() => null),
      window.db.getTodayFoodLogs().catch(() => []),
      window.db.getRecentSleepLogs(1).catch(() => []),
      window.db.getRecentSessions(7).catch(() => []),
    ]);

    const alerts = [];
    const elevenWeekStatus = typeof getElevenWeekStatus === 'function' ? getElevenWeekStatus() : null;

    // 1. 体重异常 — 单日 vs 7日均值偏差 >0.5kg
    if (weightTrendRows.length >= 2) {
      const weights = weightTrendRows.map(r => r.weight_kg);
      const avg7 = weights.reduce((a, v) => a + v, 0) / weights.length;
      const latestW = weights[weights.length - 1];
      const diff = latestW - avg7;
      if (Math.abs(diff) > 0.5) {
        const dir = diff > 0 ? '偏高' : '偏低';
        alerts.push({
          id: 'weight_spike',
          level: 'red',
          icon: '⚡',
          title: `今日体重${dir}`,
          description: `今早 ${latestW.toFixed(1)}kg vs 7日均值 ${avg7.toFixed(1)}kg (${diff > 0 ? '+' : ''}${diff.toFixed(2)}kg)，可能只是水分，明天再看`,
          action: "document.querySelector('[data-p=\"body\"]')?.click(); if(typeof goPage==='function') goPage('body')",
          actionLabel: '看形体',
        });
      }
    }

    // 2. 体重未录 — >=1 天
    const daysSince = typeof daysSinceLastWeight === 'function' ? daysSinceLastWeight() : 999;
    if (daysSince >= 1) {
      alerts.push({
        id: 'weight_missing',
        level: 'yellow',
        icon: '⚖️',
        title: '体重未记录',
        description: daysSince >= 999 ? '还未记录过体重，晨称是每周 checkpoint 的基准数据' : `${daysSince}天未称重，明早记得`,
        action: "document.querySelector('[data-p=\"body\"]')?.click(); if(typeof goPage==='function') goPage('body')",
        actionLabel: '去记录',
      });
    }

    // 3. 蛋白滞后 — >=14:00 且完成 <40%
    if (h >= 14) {
      const eaten = todayFoodLogs.reduce((a, r) => a + (r.protein_g || 0), 0);
      const pct = proteinTarget ? Math.round(eaten / proteinTarget * 100) : 0;
      if (pct < 40) {
        alerts.push({
          id: 'protein_behind',
          level: 'yellow',
          icon: '🥩',
          title: `蛋白质仅完成 ${pct}%`,
          description: `下午${h >= 18 ? '了' : '过半'}，已完成 ${Math.round(eaten)}g/${proteinTarget}g，晚餐需要 ${Math.round(proteinTarget * 0.6)}g`,
          action: "document.querySelector('[data-p=\"diet\"]')?.click(); if(typeof goPage==='function') goPage('diet')",
          actionLabel: '去饮食',
        });
      }
    }

    // 4. 睡眠差 — 昨晚 <6h
    if (sleepLogs1.length > 0) {
      const hrs = sleepLogs1[0].duration_h || 0;
      if (hrs > 0 && hrs < 6) {
        alerts.push({
          id: 'poor_sleep',
          level: 'yellow',
          icon: '🛌',
          title: `昨晚只睡 ${hrs.toFixed(1)}h`,
          description: '睡眠不足影响恢复和生长激素分泌，建议早睡补回来',
          action: "document.querySelector('[data-p=\"body\"]')?.click(); if(typeof goPage==='function') goPage('body')",
          actionLabel: '记录睡眠',
        });
      }
    }

    // 5. 训练脱节 — 连续3天非休息日未训练
    {
      let consecutiveMiss = 0;
      const now = new Date();
      for (let i = 1; i <= 3; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const qType = getQueueTypeForDate(dateStr);
        if (qType === 'rest') continue;
        const didTrain = recentSessions7.some(s => (s.trained_at || '').startsWith(dateStr));
        if (!didTrain) consecutiveMiss++;
        else break;
      }
      if (consecutiveMiss >= 3) {
        alerts.push({
          id: 'training_drift',
          level: 'red',
          icon: '💪',
          title: '连续 3 天缺练',
          description: '过去 3 个非休息日未记录训练，队列可能脱节，打开计划页更新锚点',
          action: "document.querySelector('[data-p=\"train\"]')?.click(); if(typeof goPage==='function') goPage('train')",
          actionLabel: '去训练',
        });
      }
    }

    // 6. Diet Break 监控 — 第6周 7日均值超目标 >0.5kg
    if (elevenWeekStatus && elevenWeekStatus.isDietBreak && weightTrendRows.length >= 2) {
      const avg7 = weightTrendRows.reduce((a, r) => a + r.weight_kg, 0) / weightTrendRows.length;
      const target = elevenWeekStatus.targetWeight;
      if (avg7 - target > 0.5) {
        alerts.push({
          id: 'diet_break_overgain',
          level: 'red',
          icon: '🍽️',
          title: 'Diet Break 体重超涨',
          description: `7日均值 ${avg7.toFixed(1)}kg vs 目标 ${target}kg (超出 ${(avg7 - target).toFixed(1)}kg)，可能需降回 2700kcal`,
          action: "document.querySelector('[data-p=\"plan\"]')?.click(); if(typeof goPage==='function') goPage('plan')",
          actionLabel: '看计划',
        });
      }
    }

    // 7. 连续周偏离 — 连续2周 >0.3kg 高于目标
    if (!(elevenWeekStatus && elevenWeekStatus.isDietBreak) && weightTrendRows.length >= 2) {
      try {
        const hist = JSON.parse(localStorage.getItem('form_checkpoint_history') || '[]');
        const sorted = hist.sort((a, b) => b.week - a.week).slice(0, 2);
        if (sorted.length === 2 && sorted[0].diff > 0.3 && sorted[1].diff > 0.3) {
          alerts.push({
            id: 'consecutive_deviation',
            level: 'red',
            icon: '📊',
            title: '连续 2 周高于目标',
            description: `第${sorted[1].week}周 +${sorted[1].diff.toFixed(2)}kg · 第${sorted[0].week}周 +${sorted[0].diff.toFixed(2)}kg，建议执行复盘下调 100kcal`,
            action: "if(typeof runWeeklyCheckpoint==='function'){runWeeklyCheckpoint().then(r=>{if(r.suggestion){if(typeof toast==='function') toast(r.suggestion.reason);if(typeof renderPlanCheckpoint==='function') renderPlanCheckpoint();}})}",
            actionLabel: '执行复盘',
          });
        }
      } catch (e) {}
    }

    return alerts;
  } catch (e) {
    console.warn('[dashAlerts]', e);
    return [];
  }
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
// 11周计划
window.PLAN_11WEEK = PLAN_11WEEK;
window.getElevenWeekStatus = getElevenWeekStatus;
window.getKcalAdjustment = getKcalAdjustment;
window.setKcalAdjustment = setKcalAdjustment;
window.applyKcalAdjustment = applyKcalAdjustment;
window.runWeeklyCheckpoint = runWeeklyCheckpoint;
window.syncPlanStateToCloud = syncPlanStateToCloud;
window.syncQueueAnchor = syncQueueAnchor;
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
// Dash 微复盘
window.runDashAlerts = runDashAlerts;
