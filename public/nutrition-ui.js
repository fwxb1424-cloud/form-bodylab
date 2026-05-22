/**
 * FORM · Body Lab — 营养 UI、档案表单、今日饮食加载 v3.1
 *
 * 修复：
 *   1. 档案表单永久记忆——第一次打开就有Cole的数据，保存后永久生效
 *   2. 营养目标数字来自定制计划（COLE_PLAN），不再动态算
 *   3. 训练日/休息日切换按钮，一键切换当日类型
 *   4. 阶段切换入口（减脂→精分→增肌），切换后数字自动更新
 */

// ── 工具：今日是否训练日（默认：周一/二/四/五为训练日）──────
function getDefaultIsTrainDay() {
  const d = new Date().getDay(); // 0=Sun
  return [1, 2, 4, 5].includes(d); // 周一推/周二拉/周四腿/周五肩
}

function macroTargets() {
  const S = window.S;
  const isTrain = S ? S.isTrain : getDefaultIsTrainDay();
  const p = S ? mergeProfile(S) : loadProfile();
  return calcDailyTargets(p, isTrain, 'medium');
}

// ── 注入饮食页营养目标区块 ──────────────────────────────────
function injectNutritionUI() {
  const diet = document.getElementById('pg-diet');
  if (!diet || document.getElementById('macro-targets')) return;

  const phSub = diet.querySelector('.ph-sub');
  if (phSub) {
    phSub.id = 'diet-macro-sub';
    phSub.textContent = '计划定制 · 精准宏量追踪';
  }

  const firstSec = diet.querySelector('.s');
  const block = document.createElement('div');
  block.className = 's';
  block.style.marginTop = '10px';
  block.innerHTML =
    '<div class="slbl" style="display:flex;align-items:center;justify-content:space-between">' +
    '<span>今日营养目标 <span id="diet-day-tag" style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ac)"></span></span>' +
    '<div style="display:flex;gap:5px">' +
    '<button type="button" id="btn-train-day" onclick="setTrainDay(true)" style="font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid var(--ln);background:var(--s2);color:var(--t2);cursor:pointer">训练日</button>' +
    '<button type="button" id="btn-rest-day" onclick="setTrainDay(false)" style="font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid var(--ln);background:var(--s2);color:var(--t2);cursor:pointer">休息日</button>' +
    '</div></div>' +
    '<div id="diet-plan-badge" style="font-size:10px;color:var(--t2);margin:4px 0 8px"></div>' +
    '<div class="macro-targets" id="macro-targets"></div>' +
    '<div class="meal-plan-card" id="meal-plan-wrap" style="margin-top:10px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-family:var(--f1);font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--t2);text-transform:uppercase">今日饮食安排</span>' +
    '<button type="button" class="slbl-act" id="meal-ai-btn" onclick="refreshMealPlanAI()">AI 优化</button>' +
    '</div><div id="meal-plan-body"></div></div>';
  if (firstSec) diet.insertBefore(block, firstSec);
  else diet.appendChild(block);
}

// 切换训练日/休息日
window.setTrainDay = function(isTrain) {
  if (window.S) S.isTrain = isTrain;
  localStorage.setItem('form_is_train', isTrain ? '1' : '0');
  applyNutritionUI();
  updateTrainDayBtns();
  if (typeof toast === 'function') {
    const t = macroTargets();
    toast(`已切换为${isTrain ? '训练' : '休息'}日 · 热量 ${t.kcal} kcal`);
  }
};

function updateTrainDayBtns() {
  const isTrain = window.S ? S.isTrain : getDefaultIsTrainDay();
  const btnTrain = document.getElementById('btn-train-day');
  const btnRest = document.getElementById('btn-rest-day');
  const acStyle = 'font-size:10px;padding:3px 9px;border-radius:12px;cursor:pointer;';
  const onStyle = acStyle + 'border:1px solid rgba(226,255,92,.4);background:rgba(226,255,92,.1);color:var(--ac);font-weight:600';
  const offStyle = acStyle + 'border:1px solid var(--ln);background:var(--s2);color:var(--t2)';
  if (btnTrain) btnTrain.style.cssText = isTrain ? onStyle : offStyle;
  if (btnRest) btnRest.style.cssText = isTrain ? offStyle : onStyle;
}

// ── 注入档案卡片到计划页 ────────────────────────────────────
function injectProfileCardOnPlan() {
  const plan = document.getElementById('pg-plan');
  if (!plan || document.getElementById('profile-card')) return;

  // 读取已保存的档案（第一次用Cole的默认值）
  const p = loadProfile();

  const card = document.createElement('div');
  card.className = 's';
  card.style.marginTop = '12px';
  const inp = 'width:100%;background:var(--s2);border:1px solid var(--ln2);border-radius:var(--r);padding:12px 13px;color:var(--t1);font-family:var(--f1);font-size:13px;outline:none';

  card.innerHTML =
    '<div class="slbl">身体档案 <span id="pf-saved-badge" style="font-weight:400;text-transform:none;color:var(--ac);font-size:10px"></span></div>' +
    '<div class="profile-card" id="profile-card">' +
    '<div style="font-size:11px;color:var(--t2);line-height:1.55;margin-bottom:10px">' +
    '体重 / 体脂更新后点「保存」即可永久生效，下次打开自动读取。体脂也可在「形体」页更新。</div>' +

    // 阶段切换（新增）
    '<div style="margin-bottom:10px">' +
    '<span style="font-family:var(--f1);font-size:10px;font-weight:600;letter-spacing:.1em;color:var(--t2);text-transform:uppercase">当前计划阶段</span>' +
    '<div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap" id="phase-btns">' +
    '<button type="button" onclick="switchPlanPhase(\'cut\')" id="pbtn-cut" class="phase-btn">减脂保肌</button>' +
    '<button type="button" onclick="switchPlanPhase(\'recomp\')" id="pbtn-recomp" class="phase-btn">精分重塑</button>' +
    '<button type="button" onclick="switchPlanPhase(\'bulk\')" id="pbtn-bulk" class="phase-btn">干净增肌</button>' +
    '<button type="button" onclick="switchPlanPhase(\'deload\')" id="pbtn-deload" class="phase-btn">Deload周</button>' +
    '</div></div>' +

    '<div class="pf-grid">' +
    `<div class="sf" style="margin:0"><span class="sf-l">身高 cm</span><input type="number" id="pf-height" value="${p.height_cm}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">体重 kg</span><input type="number" step="0.1" id="pf-weight" value="${p.weight_kg}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">年龄</span><input type="number" id="pf-age" value="${p.age}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">性别</span><select class="pf-sel" id="pf-sex">` +
    `<option ${p.sex === '男' ? 'selected' : ''}>男</option>` +
    `<option ${p.sex === '女' ? 'selected' : ''}>女</option></select></div>` +
    '<div class="sf pf-full" style="margin:0"><span class="sf-l">活动量</span><select class="pf-sel" id="pf-activity">' +
    `<option value="light" ${p.activity === 'light' ? 'selected' : ''}>较少（久坐为主）</option>` +
    `<option value="moderate" ${p.activity === 'moderate' ? 'selected' : ''}>中等（每周练4–5次）</option>` +
    `<option value="active" ${p.activity === 'active' ? 'selected' : ''}>较高（几乎每天练）</option>` +
    '</select></div>' +
    `<div class="sf pf-full" style="margin:0"><span class="sf-l">体脂 %</span>` +
    `<input type="number" step="0.1" id="pf-fat" value="${p.fat_pct ?? 17.8}" style="${inp}"></div>` +
    `<div class="sf pf-full" style="margin:0"><span class="sf-l">骨骼肌 kg</span>` +
    `<input type="number" step="0.1" id="pf-muscle" value="${p.muscle_kg ?? 40.4}" style="${inp}"></div>` +
    '</div>' +
    '<button type="button" class="pf-save" onclick="saveProfileFromForm()">保存档案 · 立即生效</button>' +
    '</div>';

  // 插入到「我的周期」板块之后（如果有），否则放最前
  const cycSection = plan.querySelector('.s');
  if (cycSection) plan.insertBefore(card, cycSection.nextSibling);
  else plan.prepend(card);

  // 更新阶段按钮高亮
  updatePhaseBtns();
  // 显示上次保存时间
  showSavedBadge();
}

// 阶段切换
window.switchPlanPhase = function(phase) {
  setActivePlanPhase(phase);
  updatePhaseBtns();
  applyNutritionUI();
  // 同步更新「我的周期」进度Hero
  const eyebrow = document.querySelector('.cyc-eyebrow');
  const sub = document.querySelector('.cyc-hero .cyc-sub');
  const plan = window.COLE_PLAN?.[phase];
  if (eyebrow && plan) eyebrow.textContent = `阶段 · ${plan.label}`;
  if (typeof toast === 'function') {
    const t = macroTargets();
    toast(`已切换：${plan?.label || phase} · 训练日 ${t.kcal}kcal`);
  }
};

function updatePhaseBtns() {
  const active = getActivePlanPhase();
  ['cut','recomp','bulk','deload'].forEach(ph => {
    const btn = document.getElementById('pbtn-' + ph);
    if (!btn) return;
    if (ph === active) {
      btn.style.cssText = 'font-size:10px;padding:4px 10px;border-radius:12px;border:1px solid rgba(226,255,92,.4);background:rgba(226,255,92,.1);color:var(--ac);font-weight:600;cursor:pointer';
    } else {
      btn.style.cssText = 'font-size:10px;padding:4px 10px;border-radius:12px;border:1px solid var(--ln);background:var(--s2);color:var(--t2);cursor:pointer';
    }
  });
}

function showSavedBadge() {
  const badge = document.getElementById('pf-saved-badge');
  if (!badge) return;
  const raw = localStorage.getItem('form_profile');
  if (raw) {
    badge.textContent = '已保存 ✓';
  } else {
    badge.textContent = '使用默认数据';
  }
}

function syncGoalSelectFromProfile() {
  const p = loadProfile();
  const sel = document.getElementById('pf-goal');
  if (!sel || !p.goalLabel) return;
  for (const opt of sel.options) {
    if (opt.text === p.goalLabel) { opt.selected = true; break; }
  }
}

function readProfileForm() {
  const p = loadProfile(); // 读现有值作为fallback
  return {
    height_cm: parseFloat(document.getElementById('pf-height')?.value) || p.height_cm,
    weight_kg: parseFloat(document.getElementById('pf-weight')?.value) || p.weight_kg,
    age: parseInt(document.getElementById('pf-age')?.value, 10) || p.age,
    sex: document.getElementById('pf-sex')?.value || p.sex,
    activity: document.getElementById('pf-activity')?.value || p.activity,
    fat_pct: parseFloat(document.getElementById('pf-fat')?.value) || p.fat_pct,
    muscle_kg: parseFloat(document.getElementById('pf-muscle')?.value) || p.muscle_kg,
    goalLabel: p.goalLabel,
    goalKey: p.goalKey,
  };
}

function saveProfileFromForm() {
  const prof = readProfileForm();
  saveProfile(prof); // macros.js里的saveProfile现在会合并DEFAULT_PROFILE防止空值

  // 同步体脂/肌肉到S和形体页显示
  if (window.S) {
    if (prof.fat_pct > 0) S.fat_pct = prof.fat_pct;
    if (prof.muscle_kg > 20) S.muscle = prof.muscle_kg;
    ['fat-val', 'd-fat'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = S.fat_pct.toFixed(1);
    });
    ['muscle-val', 'd-muscle'].forEach(id => {
      const el = document.getElementById(id);
      if (el && S.muscle) el.textContent = S.muscle.toFixed(1);
    });
  }

  // 更新「我的周期」体脂数字
  const bfEl = document.getElementById('cyc-bf-now');
  if (bfEl) bfEl.innerHTML = prof.fat_pct.toFixed(1) + '<span style="font-size:10px;font-weight:400">%</span>';

  showSavedBadge();
  applyNutritionUI();

  if (typeof pushSettingsToCloud === 'function') pushSettingsToCloud();
  if (typeof saveAppStateLocally === 'function') saveAppStateLocally();
  if (typeof refreshAppStatus === 'function') refreshAppStatus();
  if (typeof toast === 'function') {
    const t = macroTargets();
    toast(`✓ 已保存 · 蛋白${t.protein}g · 碳水${t.carbs}g · 热量${t.kcal}kcal`);
  }
}

function applyNutritionUI() {
  renderMacroTargetsPanel();
  renderMealPlanPanel();
  updateTrainDayBtns();
  if (typeof updateCarbBtn === 'function') updateCarbBtn();
  if (typeof updateBars === 'function') updateBars();
  if (typeof renderDash === 'function') renderDash();
  if (typeof updateGapRec === 'function') updateGapRec();
}

function renderMacroTargetsPanel() {
  const el = document.getElementById('macro-targets');
  if (!el) return;
  const t = macroTargets();

  // 训练日/休息日标签
  const tag = document.getElementById('diet-day-tag');
  if (tag) tag.textContent = t.isTrain ? '· 训练日' : '· 休息日';

  // 副标题：显示计划阶段名
  const sub = document.getElementById('diet-macro-sub');
  if (sub) {
    const phase = getActivePlanPhase();
    const plan = window.COLE_PLAN?.[phase];
    sub.textContent = plan
      ? `${plan.label} · 瘦体重约${t.lbm}kg`
      : `瘦体重约${t.lbm}kg · TDEE约${t.tdee}kcal`;
  }

  // 计划模式标识
  const planBadge = document.getElementById('diet-plan-badge');
  if (planBadge) {
    planBadge.textContent = t.isPlanMode
      ? `定制计划 · ${window.COLE_PLAN?.[getActivePlanPhase()]?.label || ''}`
      : '通用计算模式';
  }

  el.innerHTML = [
    ['p', t.protein, '蛋白 g'],
    ['f', t.fat, '脂肪 g'],
    ['c', t.carbs, '碳水 g'],
    ['k', t.kcal, '热量'],
  ]
    .map(([cls, v, lbl]) =>
      `<div class="mt-cell ${cls}"><div class="mt-v">${v}</div><div class="mt-l">${lbl}</div></div>`)
    .join('');

  // 同步概况页目标数字
  const ptgt = document.getElementById('dash-ptgt');
  const ktgt = document.getElementById('dash-kcal-tgt');
  if (ptgt) ptgt.textContent = t.protein;
  if (ktgt) ktgt.textContent = t.kcal;
}

function renderMealPlanPanel() {
  const body = document.getElementById('meal-plan-body');
  if (!body || !window.S) return;
  const t = macroTargets();
  const consumed = { protein: S.protein, carbs: S.carbs, fat: S.fat, kcal: S.kcal };
  const plan = buildRuleMealPlan(t, consumed, S.isTrain);
  const rem = plan.remaining;
  let html =
    `<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ac)">${plan.headline}</div>` +
    `<div style="font-size:11px;color:var(--t2);margin-bottom:10px">` +
    `剩余 蛋白 ${Math.round(rem.p)}g · 碳水 ${Math.round(rem.c)}g · 脂肪 ${Math.round(rem.f)}g · ${Math.round(rem.k)} kcal</div>`;
  html += plan.meals
    .map(m =>
      `<div class="meal-row"><div class="meal-slot">${m.slot}</div>` +
      `<div class="meal-items">${m.items}</div>` +
      `<div class="meal-tip">${m.tip}</div></div>`)
    .join('');
  body.innerHTML = html;
}

async function refreshMealPlanAI() {
  const btn = document.getElementById('meal-ai-btn');
  const body = document.getElementById('meal-plan-body');
  if (!body || !window.AI?.ds) {
    if (typeof toast === 'function') toast('未配置 DeepSeek — 点顶部「DeepSeek · 去设置」');
    if (typeof openSetupScreen === 'function') openSetupScreen();
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  body.innerHTML =
    '<div class="think" style="margin:0"><div class="dots"><span></span><span></span><span></span></div>' +
    '<span class="think-txt">AI 生成今日饮食方案…</span></div>';
  try {
    const t = macroTargets();
    const phase = getActivePlanPhase();
    const sysExtra = `用户当前计划：${window.COLE_PLAN?.[phase]?.label || '减脂保肌期'}。` +
      `今日目标：蛋白${t.protein}g · 碳水${t.carbs}g · 脂肪${t.fat}g · 热量${t.kcal}kcal。` +
      `${t.isTrain ? '今天是训练日，18:30后训练。' : '今天是休息日。'}` +
      '\n请输出今日分餐安排（早/午/练前后/晚），要具体食物和克数，蛋白质来源优先鸡胸/乳清/鸡蛋。';
    const r = await AI.call('advice', {
      system: sysExtra,
      userMsg: '给我今日完整饮食安排。',
    });
    if (r._err) throw new Error('format');
    const items = r.suggestions || [];
    body.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--ac);margin-bottom:8px">${r.headline || '今日饮食'}</div>`;
    if (items.length && items[0].food) {
      body.innerHTML += items.map(s =>
        `<div class="meal-row"><div class="meal-items">${s.food} ${s.amount || ''}</div>` +
        `<div class="meal-tip">${s.reason || ''}${s.protein ? ' · +' + s.protein + 'g蛋白' : ''}</div></div>`
      ).join('');
    } else if (Array.isArray(r.advice)) {
      body.innerHTML += r.advice.map(a =>
        `<div class="meal-row"><div class="meal-items">${a}</div></div>`).join('');
    }
    if (r.timing) body.innerHTML += `<div class="meal-tip" style="margin-top:8px">⏱ ${r.timing}</div>`;
    if (r.carb_note) body.innerHTML += `<div class="meal-tip">🍚 ${r.carb_note}</div>`;
    if (typeof updateTokenUI === 'function') updateTokenUI();
  } catch (e) {
    renderMealPlanPanel();
    if (typeof toast === 'function') toast('AI 失败，已显示基础方案');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'AI 优化'; }
}

async function loadTodayFood() {
  if (!window.db || !window.S) return;
  try {
    const rows = await db.getTodayFoodLogs();
    S.foods = [];
    S.foodId = 0;
    S.protein = 0; S.carbs = 0; S.fat = 0; S.kcal = 0;
    rows.forEach(r => {
      const e = {
        id: ++S.foodId, dbId: r.id,
        name: r.name,
        protein_g: r.protein_g, carbs_g: r.carbs_g,
        fat_g: r.fat_g, kcal: r.kcal,
        time: r.time_tag || (typeof nt === 'function' ? nt() : ''),
      };
      S.foods.push(e);
      S.protein += e.protein_g || 0;
      S.carbs += e.carbs_g || 0;
      S.fat += e.fat_g || 0;
      S.kcal += e.kcal || 0;
    });
    if (typeof renderFoodList === 'function') renderFoodList();
    if (typeof updateBars === 'function') updateBars();
    if (typeof renderDash === 'function') renderDash();
    applyNutritionUI();
    if (typeof backupTodayFoods === 'function') backupTodayFoods();
    if (typeof refreshAppStatus === 'function') refreshAppStatus();
  } catch (e) {
    console.warn('loadTodayFood', e);
    if (typeof loadTodayFoodFromLocal === 'function') loadTodayFoodFromLocal();
  }
}

function initNutritionModule() {
  injectNutritionUI();
  injectProfileCardOnPlan();
  syncGoalSelectFromProfile();

  // 从localStorage恢复训练日/休息日状态
  // 优先读上次手动切换的值，否则按星期自动判断
  const stored = localStorage.getItem('form_is_train');
  if (window.S) {
    S.isTrain = stored !== null ? stored === '1' : getDefaultIsTrainDay();
  }

  applyNutritionUI();
  updatePhaseBtns();
}

window.macroTargets = macroTargets;
window.saveProfileFromForm = saveProfileFromForm;
window.readProfileForm = readProfileForm;
window.applyNutritionUI = applyNutritionUI;
window.renderMealPlanPanel = renderMealPlanPanel;
window.refreshMealPlanAI = refreshMealPlanAI;
window.loadTodayFood = loadTodayFood;
window.initNutritionModule = initNutritionModule;
window.updatePhaseBtns = updatePhaseBtns;
window.updateTrainDayBtns = updateTrainDayBtns;
