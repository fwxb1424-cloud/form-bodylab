/**
 * FORM · Body Lab — 营养 UI、档案表单、今日饮食加载
 */

function macroTargets() {
  const S = window.S;
  if (!S) return calcDailyTargets(loadProfile(), true, 'medium');
  return calcDailyTargets(mergeProfile(S), S.isTrain, 'medium');
}

function injectNutritionUI() {
  const diet = document.getElementById('pg-diet');
  if (!diet || document.getElementById('macro-targets')) return;

  const phSub = diet.querySelector('.ph-sub');
  if (phSub) {
    phSub.id = 'diet-macro-sub';
    phSub.textContent = '根据身体档案自动计算蛋白 / 脂肪 / 碳水';
  }

  const firstSec = diet.querySelector('.s');
  const block = document.createElement('div');
  block.className = 's';
  block.style.marginTop = '10px';
  block.innerHTML =
    '<div class="slbl">今日营养目标 <span id="diet-day-tag" style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ac)"></span></div>' +
    '<div class="macro-targets" id="macro-targets"></div>' +
    '<div class="meal-plan-card" id="meal-plan-wrap" style="margin-top:10px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-family:var(--f1);font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--t2);text-transform:uppercase">今日饮食安排</span>' +
    '<button type="button" class="slbl-act" id="meal-ai-btn" onclick="refreshMealPlanAI()">AI 优化</button>' +
    '</div><div id="meal-plan-body"></div></div>';
  block.innerHTML = block.innerHTML.split('motion').join('div');
  if (firstSec) diet.insertBefore(block, firstSec);
  else diet.appendChild(block);
}

function injectProfileCardOnPlan() {
  const plan = document.getElementById('pg-plan');
  if (!plan || document.getElementById('profile-card')) return;
  const p = loadProfile();
  const card = document.createElement('div');
  card.className = 's';
  card.style.marginTop = '12px';
  const inp =
    'width:100%;background:var(--s2);border:1px solid var(--ln2);border-radius:var(--r);padding:12px 13px;color:var(--t1);font-family:var(--f1);font-size:13px;outline:none';
  card.innerHTML =
    '<div class="slbl">身体档案 <span style="font-weight:400;text-transform:none;color:var(--t2)">用于计算每日营养</span></div>' +
    '<div class="profile-card" id="profile-card">' +
    '<div style="font-size:12px;color:var(--t2);line-height:1.55;margin-bottom:10px">在此填写；生成周期计划时会一并使用。体脂可在「形体」页更新。</div>' +
    '<div class="pf-grid">' +
    `<div class="sf" style="margin:0"><span class="sf-l">身高 cm</span><input type="number" id="pf-height" value="${p.height_cm}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">体重 kg</span><input type="number" step="0.1" id="pf-weight" value="${p.weight_kg}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">年龄</span><input type="number" id="pf-age" value="${p.age}" style="${inp}"></div>` +
    `<div class="sf" style="margin:0"><span class="sf-l">性别</span><select class="pf-sel" id="pf-sex"><option ${p.sex === '男' ? 'selected' : ''}>男</option><option ${p.sex === '女' ? 'selected' : ''}>女</option></select></div>` +
    '<div class="sf pf-full" style="margin:0"><span class="sf-l">活动量</span><select class="pf-sel" id="pf-activity">' +
    `<option value="light" ${p.activity === 'light' ? 'selected' : ''}>较少（久坐为主）</option>` +
    `<option value="moderate" ${p.activity === 'moderate' ? 'selected' : ''}>中等（每周练 4–5 次）</option>` +
    `<option value="active" ${p.activity === 'active' ? 'selected' : ''}>较高（几乎每天练）</option>` +
  '</select></div>' +
    `<div class="sf pf-full" style="margin:0"><span class="sf-l">体脂 %</span><input type="number" step="0.1" id="pf-fat" value="${p.fat_pct ?? 17.8}" style="${inp}"></div>` +
    '</div><button type="button" class="pf-save" onclick="saveProfileFromForm()">保存档案 · 更新营养目标</button></div>';
  card.innerHTML = card.innerHTML.split('motion').join('div');
  const anchor = plan.querySelector('.s');
  if (anchor) plan.insertBefore(card, anchor);
  else plan.prepend(card);
  syncGoalSelectFromProfile();
}

function syncGoalSelectFromProfile() {
  const p = loadProfile();
  const sel = document.getElementById('pf-goal');
  if (!sel || !p.goalLabel) return;
  for (const opt of sel.options) {
    if (opt.text === p.goalLabel) {
      opt.selected = true;
      break;
    }
  }
}

function readProfileForm() {
  const goalSel = document.getElementById('pf-goal');
  const goalLabel = goalSel?.options[goalSel.selectedIndex]?.text || loadProfile().goalLabel;
  return {
    height_cm: parseFloat(document.getElementById('pf-height')?.value) || 175,
    weight_kg: parseFloat(document.getElementById('pf-weight')?.value) || 75,
    age: parseInt(document.getElementById('pf-age')?.value, 10) || 28,
    sex: document.getElementById('pf-sex')?.value || '男',
    activity: document.getElementById('pf-activity')?.value || 'moderate',
    fat_pct: parseFloat(document.getElementById('pf-fat')?.value) || 17.8,
    goalLabel,
    goalKey: goalKeyFromLabel(goalLabel),
    muscle_kg: window.S?.muscle > 20 ? window.S.muscle : null,
  };
}

function saveProfileFromForm() {
  const prof = readProfileForm();
  saveProfile(prof);
  if (window.S) {
    S.fat_pct = prof.fat_pct;
    ['fat-val', 'd-fat'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = S.fat_pct.toFixed(1);
    });
  }
  applyNutritionUI();
  if (typeof toast === 'function') {
    const t = macroTargets();
    toast(`✓ 档案已保存 · 蛋白 ${t.protein}g · 脂肪 ${t.fat}g · 碳水 ${t.carbs}g`);
  }
}

function applyNutritionUI() {
  renderMacroTargetsPanel();
  renderMealPlanPanel();
  if (typeof updateCarbBtn === 'function') updateCarbBtn();
  if (typeof updateBars === 'function') updateBars();
  if (typeof renderDash === 'function') renderDash();
  if (typeof updateGapRec === 'function') updateGapRec();
}

function renderMacroTargetsPanel() {
  const el = document.getElementById('macro-targets');
  if (!el) return;
  const t = macroTargets();
  const tag = document.getElementById('diet-day-tag');
  if (tag) tag.textContent = t.isTrain ? '· 训练日' : '· 休息日';
  const sub = document.getElementById('diet-macro-sub');
  if (sub) {
    const p = mergeProfile(window.S || {});
    sub.textContent = `瘦体重约 ${t.lbm}kg · TDEE约 ${t.tdee}kcal · ${p.goalLabel || ''}`;
  }
  el.innerHTML = [
    ['p', t.protein, '蛋白 g'],
    ['f', t.fat, '脂肪 g'],
    ['c', t.carbs, '碳水 g'],
    ['k', t.kcal, '热量'],
  ]
    .map(([cls, v, lbl]) => `<div class="mt-cell ${cls}"><div class="mt-v">${v}</div><div class="mt-l">${lbl}</div></div>`)
    .join('')
    .split('motion')
    .join('div');
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
    `<div style="font-size:11px;color:var(--t2);margin-bottom:10px">剩余 蛋白 ${Math.round(rem.p)}g · 碳水 ${Math.round(rem.c)}g · 脂肪 ${Math.round(rem.f)}g · ${Math.round(rem.k)} kcal</div>`;
  html += plan.meals
    .map(
      (m) =>
        `<div class="meal-row"><div class="meal-slot">${m.slot}</div><div class="meal-items">${m.items}</div><div class="meal-tip">${m.tip}</div></div>`,
    )
    .join('');
  body.innerHTML = html.split('motion').join('div');
}

async function refreshMealPlanAI() {
  const btn = document.getElementById('meal-ai-btn');
  const body = document.getElementById('meal-plan-body');
  if (!body || !window.AI?.ds) {
    if (typeof toast === 'function') toast('请先配置 DeepSeek Key');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  body.innerHTML =
    '<div class="think" style="margin:0"><div class="dots"><span></span><span></span><span></span></div><span class="think-txt">AI 生成今日饮食方案…</span></div>';
  try {
    const r = await AI.call('advice', {
      system:
        (typeof PROMPTS !== 'undefined' && typeof prof === 'function' ? PROMPTS.gapRec(prof()) : '') +
        '\n请输出今日分餐安排（早餐/午餐/练后/晚餐），结合剩余宏量，要具体食物和克数。',
      userMsg: '给我今日完整饮食安排与补强建议。',
    });
    if (r._err) throw new Error('format');
    const items = r.suggestions || [];
    body.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--ac);margin-bottom:8px">${r.headline || '今日饮食'}</div>`;
    if (items.length && items[0].food) {
      body.innerHTML += items
        .map(
          (s) =>
            `<div class="meal-row"><div class="meal-items">${s.food} ${s.amount || ''}</div><div class="meal-tip">${s.reason || ''}${s.protein ? ' · +' + s.protein + 'g 蛋白' : ''}</div></div>`,
        )
        .join('');
    } else if (Array.isArray(r.advice)) {
      body.innerHTML += r.advice.map((a) => `<div class="meal-row"><div class="meal-items">${a}</div></div>`).join('');
    }
    if (r.timing) body.innerHTML += `<div class="meal-tip" style="margin-top:8px">⏱ ${r.timing}</div>`;
    if (r.carb_note) body.innerHTML += `<div class="meal-tip">🍚 ${r.carb_note}</div>`;
    body.innerHTML = body.innerHTML.split('motion').join('div');
    if (typeof updateTokenUI === 'function') updateTokenUI();
  } catch (e) {
    renderMealPlanPanel();
    if (typeof toast === 'function') toast('AI 失败，已显示基础方案');
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'AI 优化';
  }
}

async function loadTodayFood() {
  if (!window.db || !window.S) return;
  try {
    const rows = await db.getTodayFoodLogs();
    S.foods = [];
    S.foodId = 0;
    S.protein = 0;
    S.carbs = 0;
    S.fat = 0;
    S.kcal = 0;
    rows.forEach((r) => {
      const e = {
        id: ++S.foodId,
        dbId: r.id,
        name: r.name,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
        kcal: r.kcal,
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
  } catch (e) {
    console.warn('loadTodayFood', e);
  }
}

function initNutritionModule() {
  injectNutritionUI();
  injectProfileCardOnPlan();
  syncGoalSelectFromProfile();
  applyNutritionUI();
}

window.macroTargets = macroTargets;
window.saveProfileFromForm = saveProfileFromForm;
window.readProfileForm = readProfileForm;
window.applyNutritionUI = applyNutritionUI;
window.renderMealPlanPanel = renderMealPlanPanel;
window.refreshMealPlanAI = refreshMealPlanAI;
window.loadTodayFood = loadTodayFood;
window.initNutritionModule = initNutritionModule;
