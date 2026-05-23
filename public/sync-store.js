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
    if (typeof loadTrainDraftForMode === 'function') await loadTrainDraftForMode('today');
    setCloudStatus('ok', `饮食${S.foods.length}条 · 记忆${S.memories.length}条`);
  } catch (e) {
    console.error('loadAllFromCloud', e);
    setCloudStatus('err', e.message);
    loadTodayFoodFromLocal();
    toast('云端加载失败：' + e.message + '（已尝试恢复本机备份）');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    backupTodayFoods();
    backupTrainDraft();
  }
});
window.addEventListener('beforeunload', () => backupTrainDraft());

// ── 训练草稿 / 补录昨天 / 自动保存 ─────────────────────────────
// S_trainDate 现在存储两种值：
//   'today'       → 今天
//   数字（如 -1, -2, -3…）→ 往前N天（-1=昨天, -2=前天，以此类推）
window.S_trainDate = window.S_trainDate || 'today';

// 把模式转换成实际日期对象
function trainModeToDate(mode) {
  const d = new Date();
  if (mode === 'today' || mode === 0) return d;
  const offset = typeof mode === 'number' ? mode : (mode === 'yesterday' ? -1 : parseInt(mode) || 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function trainDateKey(mode) {
  const d = trainModeToDate(mode ?? window.S_trainDate);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `form_train_${yyyy}-${mm}-${dd}`;
}

function trainDayRange(mode) {
  const d = trainModeToDate(mode ?? window.S_trainDate);
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString(), label: d };
}

function getTrainLogTimestamp() {
  const mode = window.S_trainDate;
  if (mode === 'today') return new Date().toISOString();
  const d = trainModeToDate(mode);
  const now = new Date();
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return d.toISOString();
}

function isTrainToday() {
  return window.S_trainDate === 'today' || window.S_trainDate === 0;
}

function readTrainDraftEl(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function serializeTrainDraft() {
  if (!window.S) return null;
  return {
    todayMuscle: S.todayMuscle,
    isTrain: S.isTrain,
    rpe: S.rpe,
    volume: S.volume,
    workout: S.workout,
    cloudSessionId: S.trainCloudSessionId || null,
    sessionTitle: document.getElementById('sh-title')?.textContent || '',
    sessionNotes: readTrainDraftEl('session-notes'),
    customReq: readTrainDraftEl('custom-req'),
    savedAt: Date.now(),
  };
}

function trainHasSaveableContent() {
  if (!window.S || S.todayMuscle === 'rest') return false;
  if (!S.workout?.length) return false;
  return S.workout.some(
    (ex) =>
      ex.done ||
      ex.name?.trim() ||
      (ex.sets_data?.length &&
        ex.sets_data.some((s) => (parseFloat(s.w) || 0) > 0 || (parseFloat(s.r) || 0) > 0)),
  );
}

function applyTrainDraft(d) {
  if (!d || !window.S) return false;
  S.todayMuscle = d.todayMuscle || '';
  if (typeof d.isTrain === 'boolean') S.isTrain = d.isTrain;
  S.rpe = d.rpe || 5;
  S.volume = d.volume || 0;
  S.workout = Array.isArray(d.workout) ? d.workout : [];
  S.trainCloudSessionId = d.cloudSessionId || null;
  const notes = document.getElementById('session-notes');
  if (notes) notes.value = d.sessionNotes || '';
  const req = document.getElementById('custom-req');
  if (req) req.value = d.customReq || '';
  const title = document.getElementById('sh-title');
  if (title && d.sessionTitle) title.textContent = d.sessionTitle;
  if (typeof renderMuscleSelector === 'function') renderMuscleSelector();
  if (typeof renderRPE === 'function') renderRPE();
  const total = document.getElementById('total-cnt');
  const done = document.getElementById('done-cnt');
  if (total) total.textContent = S.workout.length;
  if (done) done.textContent = S.workout.filter((e) => e.done).length;
  if (typeof recalcVol === 'function') recalcVol();
  else {
    const vol = document.getElementById('vol-val');
    if (vol) vol.innerHTML = Math.round(S.volume) + '<span class="vi-u"> kg·r</span>';
  }
  if (typeof renderExercises === 'function') renderExercises();
  if (typeof renderCmpList === 'function') renderCmpList();
  if (isTrainToday() && typeof renderDash === 'function') renderDash();
  return true;
}

function backupTrainDraft() {
  if (!window.S) return;
  if (!trainHasSaveableContent()) return;
  try {
    localStorage.setItem(trainDateKey(), JSON.stringify(serializeTrainDraft()));
    updateTrainAutosaveHint('draft');
  } catch (e) {
    console.warn('backupTrainDraft', e);
  }
}

function loadTrainDraftFromLocal(mode) {
  if (!window.S) return false;
  try {
    const raw = localStorage.getItem(trainDateKey(mode));
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d.workout?.length && !d.todayMuscle) return false;
    return applyTrainDraft(d);
  } catch (e) {
    return false;
  }
}

function clearTrainDraft(mode) {
  try {
    localStorage.removeItem(trainDateKey(mode));
  } catch (e) {
    /* ignore */
  }
  if (window.S) S.trainCloudSessionId = null;
}

async function loadTrainFromCloudForDay(mode) {
  if (!window.db) return false;
  const { start, end } = trainDayRange(mode);
  try {
    const row = await db.getLatestSessionOnDay(start, end);
    if (!row?.exercises_json) return false;
    let workout = [];
    try {
      workout = JSON.parse(row.exercises_json);
    } catch (e) {
      return false;
    }
    applyTrainDraft({
      todayMuscle: row.muscle_groups || S.todayMuscle,
      rpe: row.rpe || 5,
      volume: row.volume || 0,
      workout,
      cloudSessionId: row.id,
      sessionTitle: row.session_title || '',
      sessionNotes: row.notes || '',
      customReq: '',
      savedAt: Date.now(),
    });
    backupTrainDraft();
    return true;
  } catch (e) {
    console.warn('loadTrainFromCloudForDay', e);
    return false;
  }
}

async function loadTrainDraftForMode(mode) {
  window.S_trainDate = mode;
  if (loadTrainDraftFromLocal(mode)) {
    updateTrainAutosaveHint('restored');
    return;
  }
  if (await loadTrainFromCloudForDay(mode)) {
    updateTrainAutosaveHint('cloud');
    if (!isTrainToday() && typeof toast === 'function')
      toast('已从云端载入该日训练，可继续补全');
    return;
  }
  if (mode === 'today') {
    S.workout = [];
    S.volume = 0;
    S.trainCloudSessionId = null;
    if (typeof renderExercises === 'function') {
      const list = document.getElementById('ex-list');
      if (list && !S.todayMuscle)
        list.innerHTML =
          '<div class="think"><div class="dots"><span></span><span></span><span></span></div><span class="think-txt">选择肌群后生成动作方案</span></div>';
    }
  }
  updateTrainAutosaveHint('empty');
}

let _trainAutosaveTimer = null;
let _trainCloudSyncTimer = null;

function updateTrainAutosaveHint(state) {
  const el = document.getElementById('train-autosave-hint');
  if (!el) return;
  const map = {
    draft: '草稿已自动保存到本机',
    cloud: '已同步云端（可随时补全）',
    syncing: '正在同步云端…',
    restored: '已恢复未完成的训练草稿',
    empty: isTrainToday() ? '填写动作、重量后会自动保存草稿' : '补录模式：填写动作后会自动保存',
    err: '本机已保存，云端同步失败',
  };
  el.textContent = map[state] || map.empty;
}

function scheduleTrainAutosave() {
  clearTimeout(_trainAutosaveTimer);
  _trainAutosaveTimer = setTimeout(() => {
    if (!trainHasSaveableContent()) return;
    backupTrainDraft();
    clearTimeout(_trainCloudSyncTimer);
    _trainCloudSyncTimer = setTimeout(() => autoSyncTrainToCloud(), 2200);
  }, 400);
}

function buildSessionPayload() {
  const notes = readTrainDraftEl('session-notes');
  const title = document.getElementById('sh-title')?.textContent || '训练记录';
  const intensity =
    S.workout.filter((e) => e.done).length >= S.workout.length * 0.8 ? 'High' : 'Medium';
  return {
    session_title: title,
    muscle_groups: S.todayMuscle,
    intensity,
    volume: S.volume,
    exercises_json: JSON.stringify(S.workout),
    notes,
    rpe: S.rpe,
    trained_at: getTrainLogTimestamp(),
  };
}

async function autoSyncTrainToCloud() {
  if (!window.db || !trainHasSaveableContent()) return;
  updateTrainAutosaveHint('syncing');
  const payload = buildSessionPayload();
  try {
    let row;
    if (S.trainCloudSessionId) {
      row = await dbOp('训练自动保存', () => db.updateSession(S.trainCloudSessionId, payload));
    } else {
      row = await dbOp('训练自动保存', () => db.addSession(payload));
      if (row?.id) S.trainCloudSessionId = row.id;
    }
    if (row?.id) S.trainCloudSessionId = row.id;
    backupTrainDraft();
    updateTrainAutosaveHint('cloud');
    if (isTrainToday() && typeof renderDash === 'function') renderDash();
  } catch (e) {
    updateTrainAutosaveHint('err');
  }
}

function updateTrainDateUI() {
  const bar = document.getElementById('train-backfill-bar');
  const todayBtn = document.getElementById('ts-today');
  const backBtn = document.getElementById('ts-backfill'); // 新的"补录"按钮
  const title = document.getElementById('train-page-title');
  const saveBtn = document.getElementById('train-save-btn');
  const sub = document.getElementById('train-date');
  const isToday = isTrainToday();
  const { label } = trainDayRange();

  bar?.classList.toggle('hidden', isToday);
  todayBtn?.classList.toggle('on', isToday);
  backBtn?.classList.toggle('on', !isToday);

  if (isToday) {
    if (title) title.textContent = '今日训练';
    if (saveBtn) saveBtn.textContent = '记录今日训练 ✓';
    if (sub && typeof todayStr === 'function') sub.textContent = todayStr();
  } else {
    const dow = ['日','一','二','三','四','五','六'][label.getDay()];
    const dateStr = `${label.getMonth()+1}/${label.getDate()}（周${dow}）`;
    if (title) title.textContent = `补录 ${dateStr}`;
    if (saveBtn) saveBtn.textContent = `记录 ${dateStr} 训练 ✓`;
    if (sub) sub.textContent = dateStr;
    const bfDate = document.getElementById('train-bf-date-label');
    if (bfDate) bfDate.textContent = `${dateStr} · 自动保存写入该日时间戳`;
  }

  // 更新autosave hint
  updateTrainAutosaveHint('empty');
}

// mode: 'today' | -1 | -2 | -3 … (负数=往前N天)
window.switchTrainDate = async function switchTrainDate(mode) {
  if (mode === S_trainDate) return;
  backupTrainDraft();
  window.S_trainDate = mode;
  updateTrainDateUI();
  await loadTrainDraftForMode(mode);
  if (isTrainToday()) {
    toast('已切回今日训练');
  } else {
    const { label } = trainDayRange();
    const dow = ['日','一','二','三','四','五','六'][label.getDay()];
    toast(`补录模式：${label.getMonth()+1}/${label.getDate()}（周${dow}）`);
  }
};

function saveAppStateLocally() {
  backupTodayFoods();
  backupTrainDraft();
}

function loadAppStateLocally() {
  loadTrainDraftFromLocal('today');
}

window.getTrainLogTimestamp = getTrainLogTimestamp;
window.scheduleTrainAutosave = scheduleTrainAutosave;
window.backupTrainDraft = backupTrainDraft;
window.loadTrainDraftFromLocal = loadTrainDraftFromLocal;
window.loadTrainDraftForMode = loadTrainDraftForMode;
window.clearTrainDraft = clearTrainDraft;
window.saveAppStateLocally = saveAppStateLocally;
window.loadAppStateLocally = loadAppStateLocally;
window.trainHasSaveableContent = trainHasSaveableContent;
window.updateTrainDateUI = updateTrainDateUI;
window.isTrainToday = isTrainToday;
window.trainModeToDate = trainModeToDate;
window.trainDayRange = trainDayRange;

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
