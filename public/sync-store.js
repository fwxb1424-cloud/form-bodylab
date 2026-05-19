/**
 * FORM · Body Lab — 云端同步、本地备份、连接状态
 * 云端：Supabase（饮食/训练/记忆/体测）
 * 本机：localStorage（API Key + 档案 + 当日饮食备份）
 */

const SETTINGS_ID = 'default';

function foodBackupKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `form_food_${d.getFullYear()}-${mm}-${dd}`;
}

function backupTodayFoods() {
  if (!window.S) return;
  try {
    localStorage.setItem(
      foodBackupKey(),
      JSON.stringify({
        foods: S.foods,
        protein: S.protein,
        carbs: S.carbs,
        fat: S.fat,
        kcal: S.kcal,
        foodId: S.foodId,
        savedAt: Date.now(),
      }),
    );
  } catch (e) {
    console.warn('backupTodayFoods', e);
  }
}

function loadTodayFoodFromLocal() {
  if (!window.S) return false;
  try {
    const raw = localStorage.getItem(foodBackupKey());
    if (!raw) return false;
    const b = JSON.parse(raw);
    if (!b.foods?.length) return false;
    S.foods = b.foods;
    S.foodId = b.foodId || b.foods.length;
    S.protein = b.protein || 0;
    S.carbs = b.carbs || 0;
    S.fat = b.fat || 0;
    S.kcal = b.kcal || 0;
    if (typeof renderFoodList === 'function') renderFoodList();
    if (typeof updateBars === 'function') updateBars();
    if (typeof renderDash === 'function') renderDash();
    if (typeof applyNutritionUI === 'function') applyNutritionUI();
    return true;
  } catch (e) {
    return false;
  }
}

function restoreLocalProfileOnBoot() {
  if (typeof loadProfile !== 'function' || typeof applyProfileToUI !== 'function') return;
  applyProfileToUI(loadProfile());
}

function openSetupScreen() {
  const setup = document.getElementById('setup');
  const app = document.getElementById('app');
  if (setup) setup.classList.remove('off');
  if (app) app.classList.add('off');
  if (typeof toast === 'function') toast('请填写 DeepSeek + Supabase，再点「开始使用」');
}

function onStatusCloudClick() {
  if (window.db) {
    if (typeof toast === 'function') toast('云端数据库已连接');
    return;
  }
  openSetupScreen();
}

function onStatusAiClick() {
  if (window.AI?.ds) {
    if (typeof toast === 'function') toast('DeepSeek 已配置，可使用 AI 解析');
    return;
  }
  openSetupScreen();
}

async function dbOp(label, fn) {
  if (!window.db) {
    toast('未连接云端 — 记录仅在本页内存。请点顶部「云端·去设置」填写 Supabase');
    setCloudStatus('off', '未连接');
    refreshAppStatus();
    return null;
  }
  try {
    const result = await fn();
    setCloudStatus('ok', '已同步');
    localStorage.setItem('form_cloud_ok', String(Date.now()));
    refreshAppStatus();
    return result;
  } catch (e) {
    console.error('[db]', label, e);
    setCloudStatus('err', e.message);
    toast(`${label}失败：${e.message}`);
    refreshAppStatus();
    return null;
  }
}

function injectCloudStatusBar() {
  if (document.getElementById('cloud-status')) return;
  const ph = document.querySelector('#pg-dash .ph');
  if (!ph) return;
  const bar = document.createElement('div');
  bar.id = 'cloud-status';
  bar.className = 'cloud-bar';
  bar.innerHTML = '<span class="cloud-dot" style="background:var(--t2)"></span><span>检查云端…</span>';
  ph.insertAdjacentElement('afterend', bar);
}

function injectAppStatusBar() {
  if (document.getElementById('app-status-bar')) return;
  const app = document.getElementById('app');
  if (!app) return;
  const bar = document.createElement('div');
  bar.id = 'app-status-bar';
  bar.className = 'app-status';
  bar.innerHTML =
    '<button type="button" class="status-pill st-bad" id="st-cloud" onclick="onStatusCloudClick()">云端 · 去设置</button>' +
    '<button type="button" class="status-pill st-bad" id="st-ai" onclick="onStatusAiClick()">AI · 去设置</button>' +
    '<span class="status-pill status-info" id="st-food">饮食 0 条</span>';
  const pages = app.querySelector('.pages');
  if (pages) pages.insertAdjacentElement('beforebegin', bar);
}

function refreshAppStatus() {
  injectAppStatusBar();
  const cloud = document.getElementById('st-cloud');
  const ai = document.getElementById('st-ai');
  const food = document.getElementById('st-food');
  if (cloud) {
    if (window.db) {
      cloud.textContent = '云端 · 已连接';
      cloud.className = 'status-pill st-ok';
    } else {
      cloud.textContent = '云端 · 去设置';
      cloud.className = 'status-pill st-bad';
    }
  }
  if (ai) {
    if (window.AI?.ds) {
      ai.textContent = 'DeepSeek · 已配置';
      ai.className = 'status-pill st-ok';
    } else {
      ai.textContent = 'DeepSeek · 去设置';
      ai.className = 'status-pill st-bad';
    }
  }
  if (food && window.S) {
    food.textContent = `今日饮食 ${S.foods.length} 条`;
  }
}

function setCloudStatus(state, detail) {
  injectCloudStatusBar();
  const el = document.getElementById('cloud-status');
  if (!el) return;
  const map = {
    ok: { text: '云端数据库已连接', color: 'var(--ac)' },
    err: { text: '云端同步失败', color: 'var(--da)' },
    off: { text: '未连云端（关掉页面会丢记录）', color: 'var(--wa)' },
    load: { text: '从云端恢复中…', color: 'var(--t2)' },
  };
  const m = map[state] || map.off;
  el.innerHTML = `<span class="cloud-dot" style="background:${m.color}"></span><span>${m.text}</span>`;
  if (detail && state === 'err') el.title = detail;
  else el.removeAttribute('title');
  refreshAppStatus();
}

async function pushSettingsToCloud() {
  if (!window.db || !window.S) return;
  if (window.db.settingsTableOk === false) return;
  const profile = typeof loadProfile === 'function' ? loadProfile() : {};
  if (S.muscle > 20) profile.muscle_kg = S.muscle;
  if (S.fat_pct > 0) profile.fat_pct = S.fat_pct;
  await db
    .saveSettings({
      id: SETTINGS_ID,
      profile_json: JSON.stringify(profile),
      supps_json: JSON.stringify(S.supps || []),
    })
    .catch((e) => console.warn('pushSettings', e.message));
}

function applyProfileToUI(p) {
  if (!p || !window.S) return;
  if (p.fat_pct > 0) S.fat_pct = p.fat_pct;
  if (p.muscle_kg > 20) S.muscle = p.muscle_kg;
  ['muscle-val', 'd-muscle'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && S.muscle) el.textContent = S.muscle.toFixed(1);
  });
  ['fat-val', 'd-fat'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = S.fat_pct.toFixed(1);
  });
  if (typeof saveProfile === 'function') saveProfile(p);
  ['pf-height', 'pf-weight', 'pf-age', 'pf-fat'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'pf-height' && p.height_cm) el.value = p.height_cm;
    if (id === 'pf-weight' && p.weight_kg) el.value = p.weight_kg;
    if (id === 'pf-age' && p.age) el.value = p.age;
    if (id === 'pf-fat' && p.fat_pct) el.value = p.fat_pct;
  });
  const sexEl = document.getElementById('pf-sex');
  if (sexEl && p.sex) sexEl.value = p.sex;
  const actEl = document.getElementById('pf-activity');
  if (actEl && p.activity) actEl.value = p.activity;
  if (typeof syncGoalSelectFromProfile === 'function') syncGoalSelectFromProfile();
}

function applyBodyRow(row) {
  if (!row || !window.S) return;
  if (row.muscle_kg != null) S.muscle = +row.muscle_kg;
  if (row.fat_pct != null) S.fat_pct = +row.fat_pct;
  const keys = ['arm', 'waist', 'chest', 'thigh'];
  keys.forEach((k) => {
    const v = row[`${k}_cm`];
    if (v != null) S.measures[k] = +v;
  });
  applyProfileToUI(loadProfile());
}

function rebuildBodyHistory(rows) {
  if (!rows?.length || !window.S) return;
  S.history = rows.slice(-7).map((r) => {
    const d = new Date(r.recorded_at);
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      muscle: +(r.muscle_kg || S.muscle),
      fat: +(r.fat_pct || S.fat_pct),
    };
  });
  if (typeof renderChart === 'function') renderChart();
  if (typeof renderMeasures === 'function') renderMeasures();
}

async function loadAllFromCloud() {
  if (!window.db) {
    setCloudStatus('off');
    loadTodayFoodFromLocal();
    return;
  }
  setCloudStatus('load');
  try {
    const settings = await db.getSettings();
    if (settings?.profile_json) {
      try {
        applyProfileToUI(JSON.parse(settings.profile_json));
      } catch (e) {
        /* ignore */
      }
    }

    if (settings?.supps_json) {
      try {
        S.supps = JSON.parse(settings.supps_json);
        if (typeof saveSupps === 'function') saveSupps();
        if (typeof renderSupps === 'function') renderSupps();
      } catch (e) {
        /* ignore */
      }
    }

    const latest = await db.getLatestBodyStat();
    if (latest) applyBodyRow(latest);

    const hist = await db.getBodyHistory(12);
    if (hist.length) rebuildBodyHistory(hist);

    if (typeof loadTodayFood === 'function') await loadTodayFood();
    else loadTodayFoodFromLocal();

    if (typeof loadMemories === 'function') await loadMemories();
    if (typeof loadActivePlan === 'function') await loadActivePlan();
    if (typeof loadRecentCmp === 'function') await loadRecentCmp();
    if (typeof loadSleepLog === 'function') await loadSleepLog();
    if (typeof loadStrChart === 'function') await loadStrChart();
    if (typeof applyNutritionUI === 'function') applyNutritionUI();
    if (typeof renderDash === 'function') renderDash();

    backupTodayFoods();
    setCloudStatus('ok', `饮食${S.foods.length}条 · 记忆${S.memories.length}条`);
  } catch (e) {
    console.error('loadAllFromCloud', e);
    setCloudStatus('err', e.message);
    loadTodayFoodFromLocal();
    toast('云端加载失败：' + e.message + '（已尝试恢复本机备份）');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') backupTodayFoods();
});

window.dbOp = dbOp;
window.setCloudStatus = setCloudStatus;
window.pushSettingsToCloud = pushSettingsToCloud;
window.loadAllFromCloud = loadAllFromCloud;
window.backupTodayFoods = backupTodayFoods;
window.loadTodayFoodFromLocal = loadTodayFoodFromLocal;
window.restoreLocalProfileOnBoot = restoreLocalProfileOnBoot;
window.refreshAppStatus = refreshAppStatus;
window.openSetupScreen = openSetupScreen;
window.onStatusCloudClick = onStatusCloudClick;
window.onStatusAiClick = onStatusAiClick;
