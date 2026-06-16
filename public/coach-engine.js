/**
 * FORM Coach V2 - Action Engine
 * Parses [ACTION:xxx] blocks from AI replies and executes them
 */

// Session State
window.__session = {
  active: null,
  training_muscle: null,
  current_exercise: null,
  current_set: 0,
  meal_type: null,
  history: [],
  max_history: 20,
};

// Parse [ACTION:name]...[/ACTION] blocks from AI reply
function parseActions(reply) {
  var text = reply;
  var actions = [];
  var regex = /\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/g;
  var match;
  while ((match = regex.exec(reply)) !== null) {
    var actionName = match[1];
    var dataStr = match[2];
    var data = {};
    var lines = dataStr.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        var key = line.substring(0, eqIdx).trim();
        var val = line.substring(eqIdx + 1).trim();
        var num = parseFloat(val);
        if (!isNaN(num) && String(num) === val) val = num;
        if (val === 'true') val = true;
        if (val === 'false') val = false;
        data[key] = val;
      }
    }
    actions.push({ action: actionName, data: data });
    text = text.replace(match[0], '');
  }
  return { text: text.trim(), actions: actions };
}

// Execute a parsed action against S and Supabase
function executeAction(action) {
  var s = window.__session;
  var data = action.data || {};
  var WS = window.S || {};

  try {
    switch (action.action) {

      case 'log_sleep':
        if (!data.duration_h && data.bedtime && data.waketime) {
          var b = new Date('2000-01-01T' + data.bedtime + ':00');
          var w = new Date('2000-01-01T' + data.waketime + ':00');
          var h = (w - b) / 3600000;
          if (h < 0) h += 24;
          data.duration_h = Math.round(h * 10) / 10;
        }
        if (!data.duration_h) return { ok: false, msg: 'Need sleep duration' };
        if (window.db) window.db.addSleepLog(data).catch(function(){});
        localStorage.setItem('form_last_sleep', JSON.stringify({
          duration_h: data.duration_h, bedtime: data.bedtime || '', ts: Date.now()
        }));
        s.history.push({ ts: Date.now(), action: 'log_sleep', data: data });
        return { ok: true, msg: 'Sleep ' + data.duration_h + 'h logged' };

      case 'log_weight':
        if (!data.weight_kg) return { ok: false, msg: 'Need weight' };
        WS.weight_kg = data.weight_kg;
        if (window.db) window.db.addBodyStat({
          weight_kg: data.weight_kg, muscle_kg: WS.muscle, fat_pct: WS.fat_pct
        }).catch(function(){});
        localStorage.setItem('form_last_weight', JSON.stringify({
          weight_kg: data.weight_kg, ts: Date.now()
        }));
        s.history.push({ ts: Date.now(), action: 'log_weight', data: data });
        return { ok: true, msg: 'Weight ' + data.weight_kg + 'kg logged' };

      case 'log_food':
        if (!data.name) return { ok: false, msg: 'Need food name' };
        var food = {
          name: data.name,
          protein_g: data.protein_g || 0,
          carbs_g: data.carbs_g || 0,
          fat_g: data.fat_g || 0,
          kcal: data.kcal || (data.protein_g || 0) * 4 + (data.carbs_g || 0) * 4 + (data.fat_g || 0) * 9,
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          meal_type: s.meal_type || 'meal',
          logged_at: new Date().toISOString()
        };
        WS.foods = WS.foods || [];
        WS.foods.push(food);
        WS.protein = (WS.protein || 0) + food.protein_g;
        WS.carbs = (WS.carbs || 0) + food.carbs_g;
        WS.fat = (WS.fat || 0) + food.fat_g;
        WS.kcal = (WS.kcal || 0) + food.kcal;
        if (window.db) window.db.addFoodLog({
          name: food.name, protein_g: food.protein_g, carbs_g: food.carbs_g,
          fat_g: food.fat_g, kcal: food.kcal, time_tag: food.meal_type, logged_at: food.logged_at
        }).catch(function(){});
        s.history.push({ ts: Date.now(), action: 'log_food', data: food });
        return { ok: true, msg: '+' + food.protein_g + 'g protein' };

      case 'log_training_set':
        var exName = data.exercise || s.current_exercise;
        if (!exName) return { ok: false, msg: 'Which exercise?' };
        WS.workout = WS.workout || [];
        var found = null;
        for (var i = 0; i < WS.workout.length; i++) {
          if (WS.workout[i].name === exName) { found = WS.workout[i]; break; }
        }
        if (!found) {
          found = {
            name: exName, sets: data.sets || 4, reps: data.reps || '8-12',
            weight_kg: data.weight_kg || 0, muscle: s.training_muscle || '',
            done: false, sets_data: [], _collapsed: false
          };
          WS.workout.push(found);
        }
        if (data.weight_kg) found.weight_kg = data.weight_kg;
        found.sets_data = found.sets_data || [];
        found.sets_data.push({
          w: data.weight_kg || found.weight_kg || 0,
          r: parseInt(data.reps) || 8,
          done: true
        });
        if (data.done) found.done = true;
        s.current_exercise = exName;
        s.current_set = found.sets_data.length;
        if (!s.active) s.active = 'training';
        s.history.push({ ts: Date.now(), action: 'log_training_set', data: data });
        return { ok: true, msg: exName + ' set ' + found.sets_data.length + ' done' };

      case 'log_plan':
        // 记住训练方案（通过对话输入）
        if (!data.muscle) return { ok: false, msg: 'Which muscle group?' };
        var exList = [];
        if (data.exercises) {
          if (typeof data.exercises === 'string') {
            exList = data.exercises.split(',').map(function(e){ var parts=e.trim().split(/\s+/); return {name:parts[0]||'', sets:parseInt(parts[1])||4, reps:parts[2]||'8-12', weight_kg:parseFloat(parts[3])||0}; });
          } else { exList = data.exercises; }
        }
        s.pending_exercises = exList;
        try { localStorage.setItem('coach_plan_' + data.muscle, JSON.stringify(exList)); } catch(e) {}
        return { ok: true, msg: 'Plan saved: ' + exList.length + ' exercises for ' + data.muscle };

      case 'start_training':
        s.active = 'training';
        s.training_muscle = data.muscle || WS.todayMuscle || '';
        s.current_exercise = null;
        s.current_set = 0;
        // 加载方案
        var loadPlan = null;
        try { loadPlan = JSON.parse(localStorage.getItem('coach_plan_' + s.training_muscle) || 'null'); } catch(e) {}
        if (loadPlan && loadPlan.length) { s.pending_exercises = loadPlan; }
        return { ok: true, msg: 'Training: ' + s.training_muscle + (loadPlan && loadPlan.length ? ' (' + loadPlan.length + ' exercises loaded)' : '') };

      case 'end_training':
        s.active = null;
        s.current_exercise = null;
        return { ok: true, msg: 'Training ended' };

      case 'log_plan':
        if (!data.muscle || !data.exercises) return { ok: false, msg: 'Need muscle and exercises' };
        var exs = typeof data.exercises === 'string' ? JSON.parse(data.exercises) : data.exercises;
        if (typeof savePlanTemplate === 'function') savePlanTemplate(data.muscle, exs);
        return { ok: true, msg: data.muscle + ' plan saved' };

      case 'correct':
        s.history.pop();
        return { ok: true, msg: 'Undone' };

      default:
        return { ok: false, msg: 'Unknown action: ' + action.action };
    }
  } catch (e) {
    return { ok: false, msg: 'Action error: ' + e.message };
  }
}

// Intent classifier - runs locally, no AI call needed
function classifyIntent(msg) {
  if (/not right|wrong|correct|undo|撤回|不对|不是|错了/.test(msg)) return 'correct';
  if (/start.*train|begin.*workout|开始.*练|准备.*练/.test(msg)) return 'train_start';
  if (/end.*train|finish|done.*all|结束|练完|完成/.test(msg)) return 'train_end';
  if (/how many|how much|check|query|多少|查|看|达标/.test(msg) && msg.length < 20) return 'query';
  if (/sleep|slept|bed|wake|睡了|睡眠|失眠/.test(msg)) return 'log';
  if (/ate|eat|food|meal|chicken|rice|protein|吃了|摄入|吃了|鸡胸|米饭|蛋白/.test(msg)) return 'log';
  if (/bench|squat|deadlift|curl|press|卧推|深蹲|硬拉|划船|侧平|弯举|下拉|飞鸟/.test(msg)) return 'log';
  if (/weight.*kg|weigh|scale|体重.*\d|kg/.test(msg)) return 'log';
  if (/analyze|review|trend|summary|分析|复盘|趋势|总结/i.test(msg) && msg.length > 15) return 'analyze';
  return 'chat';
}

// Local query - answers simple questions without calling AI
function localQuery(msg) {
  var S = window.S || {};
  var tgt = typeof PT === 'function' ? PT() : 168;
  if (/今天.*干|今天.*怎么|今天.*什么|今天.*安排|日程|做什么|干嘛|今天.*样/i.test(msg)) {
    var S = window.S || {};
    var queueType = typeof getTodayQueueType === 'function' ? getTodayQueueType() : '';
    var labelMap = {push:'推日', pull:'拉日', legs:'腿日', shoulder:'肩日', cardio:'有氧日', rest:'休息日'};
    var todayLabel = labelMap[queueType] || '训练日';
    var isRest = queueType === 'rest';
    var isCardio = queueType === 'cardio';
    var dayNames = ['日','一','二','三','四','五','六'];
    var today = new Date();
    var dayStr = '周' + dayNames[today.getDay()];
    var h = today.getHours();
    var timeStr = h < 9 ? '早上' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';

    // 睡眠
    var sleepStr = '未记录';
    try { var sl = JSON.parse(localStorage.getItem('form_last_sleep') || 'null'); if (sl && sl.duration_h) sleepStr = sl.duration_h + 'h' + (sl.bedtime ? ' ' + sl.bedtime + '睡' : ''); } catch(e) {}

    // 体重
    var weightStr = S.weight_kg ? S.weight_kg + 'kg' : '未称';

    // 蛋白
    var tgt = typeof PT === 'function' ? PT() : 168;
    var proteinStr = Math.round(S.protein || 0) + '/' + tgt + 'g';

    // 方案
    var planStr = '';
    try { var sp = JSON.parse(localStorage.getItem('coach_plan_' + queueType) || 'null'); if (sp && sp.length) { planStr = '\n今日方案（' + sp.length + '个动作）：' + sp.map(function(e){return e.name + ' ' + e.sets + 'x' + e.reps + (e.weight_kg ? ' ' + e.weight_kg + 'kg' : '');}).join(' | '); } } catch(e) {}

    // 今日已吃
    var ateStr = '';
    var foods = S.foods || [];
    if (foods.length) { var recentFoods = foods.slice(-3).map(function(f){return f.name;}).join('、'); ateStr = '\n已吃：' + recentFoods; }

    var summary = timeStr + '好 Cole。今天是' + dayStr + '，' + todayLabel + '。\n睡眠：' + sleepStr + ' | 体重：' + weightStr + ' | 蛋白：' + proteinStr + ateStr;
    if (isRest) summary += '\n今天是休息日——轻度拉伸、多喝水、早睡。';
    else if (isCardio) summary += '\n有氧日——稳态有氧35min，心率130-140bpm。';
    else summary += planStr;

    return summary;
  }
  // 休息日切换
  if (/今天.*休|不想.*练|改.*休息|不.*练了|想.*休息/.test(msg) && msg.length < 15) {
    window.S.todayMuscle = 'rest';
    window.S.isTrain = false;
    localStorage.setItem('form_today_muscle', 'rest');
    localStorage.setItem('form_today_muscle_date', new Date().toDateString());
    try { if (typeof updateDashStatusBar === 'function') updateDashStatusBar(); } catch(e) {}
    return '好，今天休息。拉伸、多喝水、早点睡。';
  }
  // 恢复训练
  if (/今天.*练|恢复.*训练|不.*休|改成.*练/.test(msg) && msg.length < 15) {
    var qType = typeof getTodayQueueType === 'function' ? getTodayQueueType() : 'push';
    var lbl = {push:'推日', pull:'拉日', legs:'腿日', shoulder:'肩日', cardio:'有氧日', rest:'休息日'};
    window.S.todayMuscle = qType;
    window.S.isTrain = qType !== 'rest' && qType !== 'cardio';
    localStorage.setItem('form_today_muscle', qType);
    localStorage.setItem('form_today_muscle_date', new Date().toDateString());
    try { if (typeof updateDashStatusBar === 'function') updateDashStatusBar(); } catch(e) {}
    return '好，今天' + (lbl[qType] || qType) + '。';
  }
  // 训练时段
  if (/晚上.*练|下午.*练|早上.*练|改成.*早|改成.*晚|几点.*去|健身.*时间/.test(msg) && msg.length < 15) {
    var slot = /早/.test(msg) ? 'morning' : 'evening';
    localStorage.setItem('form_training_slot', slot);
    if (typeof setTrainingSlot === 'function') setTrainingSlot(slot);
    return '已设为' + (slot === 'morning' ? '早间训练（7-9点）' : '晚间训练（18-20点）') + '。';
  }
  if (/schedule|日程|队列/.test(msg)) {
    var queueType = typeof getTodayQueueType === 'function' ? getTodayQueueType() : '';
    var labelMap = {push:'推日', pull:'拉日', legs:'腿日', shoulder:'肩日', cardio:'有氧日', rest:'休息日'};
    var todayLabel = labelMap[queueType] || queueType || '未确定';
    // 尝试加载保存的方案
    var planStr = '';
    try { var savedPlan = JSON.parse(localStorage.getItem('coach_plan_' + queueType) || 'null'); if (savedPlan && savedPlan.length) { planStr = '。方案：' + savedPlan.map(function(e){return e.name + ' ' + e.sets + 'x' + e.reps + (e.weight_kg ? ' ' + e.weight_kg + 'kg' : '');}).join(' | '); } } catch(e) {}
    var queueList = (typeof PLAN_QUEUE !== 'undefined' ? PLAN_QUEUE : ['push','pull','cardio','legs','shoulder','cardio','rest']);
    var queueStr = queueList.map(function(t){return labelMap[t]||t;}).join(' → ');
    return '今天：' + todayLabel + planStr + '。队列：' + queueStr;
  }
  if (/protein|蛋白/.test(msg)) {
    var p = Math.round(S.protein || 0);
    return 'Protein ' + p + '/' + tgt + 'g. ' + (p >= tgt ? 'Target hit.' : 'Need ' + Math.round(tgt - p) + 'g more.');
  }
  if (/calorie|kcal|热量/.test(msg)) return 'Calories today: ' + Math.round(S.kcal || 0) + ' kcal';
  if (/weight|体重/.test(msg)) return 'Weight: ' + (S.weight_kg || 'not recorded') + 'kg';
  if (/sleep|睡眠/.test(msg)) {
    try {
      var sl = JSON.parse(localStorage.getItem('form_last_sleep') || 'null');
      if (sl && sl.duration_h) return 'Last night: ' + sl.duration_h + 'h' + (sl.bedtime ? ', bed at ' + sl.bedtime : '');
    } catch (e) {}
    return 'Sleep not recorded yet.';
  }
  return null;
}

window.CoachEngine = {
  parseActions: parseActions,
  executeAction: executeAction,
  classifyIntent: classifyIntent,
  localQuery: localQuery,
};
