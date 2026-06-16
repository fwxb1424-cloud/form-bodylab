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

// ══ Zone 1: Local extraction (no AI) ══
var FOOD_DB = {
  '鸡胸肉':{p:31,c:0,f:3,k:150},'鸡胸':{p:31,c:0,f:3,k:150},
  '鸡腿肉':{p:25,c:0,f:10,k:190},'鸡腿':{p:25,c:0,f:10,k:190},
  '鸡翅':{p:18,c:0,f:16,k:220},'鸡翅根':{p:18,c:0,f:16,k:220},
  '去皮鸡腿':{p:28,c:0,f:5,k:160},'去皮鸡胸':{p:31,c:0,f:3,k:150},
  '牛肉':{p:26,c:0,f:15,k:240},'牛腩':{p:17,c:0,f:30,k:330},
  '牛排':{p:25,c:0,f:15,k:240},'牛腱':{p:27,c:0,f:8,k:180},
  '猪肉':{p:20,c:0,f:25,k:300},'排骨':{p:17,c:0,f:23,k:270},
  '羊肉':{p:19,c:0,f:19,k:250},
  '虾':{p:20,c:0,f:1,k:90},'虾仁':{p:20,c:0,f:1,k:90},
  '鱼':{p:20,c:0,f:5,k:125},'三文鱼':{p:20,c:0,f:13,k:208},
  '龙利鱼':{p:15,c:0,f:1,k:70},'鳕鱼':{p:18,c:0,f:1,k:80},
  '金枪鱼':{p:26,c:0,f:1,k:116},
  '鸡蛋':{p:13,c:1,f:9,k:140},'蛋清':{p:11,c:1,f:0,k:48},
  '蛋黄':{p:16,c:1,f:27,k:322},'茶叶蛋':{p:13,c:1,f:9,k:140},
  '鹌鹑蛋':{p:13,c:1,f:11,k:160},
  '蛋白粉':{p:80,c:5,f:2,k:370},'乳清蛋白':{p:80,c:5,f:2,k:370},
  '增肌粉':{p:30,c:55,f:5,k:380},
  '牛奶':{p:3,c:5,f:3,k:60},'脱脂牛奶':{p:3,c:5,f:0,k:35},
  '豆浆':{p:3,c:1,f:2,k:30},'无糖豆浆':{p:3,c:1,f:1,k:25},
  '酸奶':{p:5,c:10,f:3,k:80},'希腊酸奶':{p:10,c:4,f:0,k:56},
  '奶酪':{p:25,c:1,f:33,k:400},'芝士':{p:25,c:1,f:33,k:400},
  '米饭':{p:3,c:28,f:0,k:116},'糙米饭':{p:3,c:23,f:1,k:110},
  '馒头':{p:7,c:44,f:1,k:220},'花卷':{p:6,c:45,f:1,k:210},
  '面条':{p:4,c:25,f:0,k:110},'意面':{p:5,c:25,f:1,k:130},
  '面包':{p:9,c:49,f:3,k:265},'全麦面包':{p:9,c:43,f:4,k:240},
  '吐司':{p:9,c:49,f:3,k:265},'贝果':{p:10,c:52,f:2,k:270},
  '燕麦':{p:13,c:66,f:7,k:380},'燕麦片':{p:13,c:66,f:7,k:380},
  '红薯':{p:2,c:20,f:0,k:86},'紫薯':{p:2,c:22,f:0,k:92},
  '土豆':{p:2,c:17,f:0,k:76},'玉米':{p:4,c:22,f:1,k:110},
  '山药':{p:2,c:12,f:0,k:56},
  '香蕉':{p:1,c:23,f:0,k:89},'苹果':{p:0,c:14,f:0,k:52},
  '橙子':{p:1,c:12,f:0,k:48},'橘子':{p:1,c:13,f:0,k:53},
  '蓝莓':{p:1,c:15,f:0,k:57},'草莓':{p:1,c:8,f:0,k:32},
  '西瓜':{p:1,c:8,f:0,k:30},'葡萄':{p:1,c:18,f:0,k:70},
  '芒果':{p:1,c:15,f:0,k:60},
  '西兰花':{p:3,c:4,f:0,k:28},'花菜':{p:2,c:3,f:0,k:20},
  '菠菜':{p:3,c:1,f:0,k:20},'生菜':{p:1,c:1,f:0,k:12},
  '黄瓜':{p:1,c:2,f:0,k:12},'番茄':{p:1,c:4,f:0,k:18},
  '胡萝卜':{p:1,c:10,f:0,k:41},'芹菜':{p:1,c:2,f:0,k:12},
  '豆腐':{p:8,c:2,f:4,k:72},'豆皮':{p:30,c:5,f:18,k:300},
  '腐竹':{p:50,c:5,f:25,k:440},
  '坚果':{p:15,c:15,f:60,k:600},'核桃':{p:15,c:14,f:65,k:650},
  '杏仁':{p:21,c:20,f:50,k:580},'腰果':{p:18,c:30,f:44,k:580},
  '花生':{p:26,c:16,f:49,k:570},'花生酱':{p:25,c:20,f:50,k:590},
  '橄榄油':{p:0,c:0,f:100,k:900},'黄油':{p:1,c:0,f:82,k:740},
  '牛油果':{p:2,c:2,f:15,k:160},
  '蜂蜜':{p:0,c:80,f:0,k:320},'糖':{p:0,c:100,f:0,k:400},
  '黑巧克力':{p:5,c:45,f:30,k:500},
  '蛋白棒':{p:20,c:35,f:10,k:300},'能量棒':{p:10,c:55,f:15,k:380},
  '饺子':{p:8,c:25,f:10,k:220},'馄饨':{p:7,c:23,f:9,k:200},
  '包子':{p:8,c:28,f:10,k:230},'肉包子':{p:10,c:30,f:12,k:260},
  '寿司':{p:5,c:20,f:1,k:110},'饭团':{p:4,c:30,f:1,k:140},
  '披萨':{p:12,c:30,f:13,k:280},'汉堡':{p:15,c:30,f:15,k:310},
  '三明治':{p:12,c:30,f:10,k:250},
  '火锅':{p:30,c:40,f:35,k:600},'麻辣烫':{p:25,c:35,f:30,k:500},
  '烧烤':{p:35,c:20,f:40,k:580},'炸鸡':{p:20,c:15,f:25,k:370},
  '炒饭':{p:10,c:45,f:15,k:350},'炒面':{p:8,c:40,f:14,k:320},
  '咖喱':{p:20,c:18,f:22,k:340},'红烧肉':{p:17,c:8,f:45,k:500},
  '黄焖鸡':{p:25,c:9,f:12,k:240},'卤肉饭':{p:20,c:40,f:20,k:410},
  '盖浇饭':{p:18,c:45,f:15,k:380},'便当':{p:25,c:40,f:18,k:410},
  '麻辣香锅':{p:30,c:30,f:35,k:550},
};

function extractDataLocally(msg) {
  var actions = [];
  // Extract food: \"300g chicken\" or \"two eggs\"
  var fm = msg.match(/(\d+)\s*g\s*(.+)/);
  if (!fm) fm = msg.match(/([一二两三四五六七八九十]+)\s*(?:个|碗|杯|勺|份)\s*(.+)/);
  if (fm) {
    var grams = parseInt(fm[1]);
    if (isNaN(grams)) { var map={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}; grams = map[fm[1]]||1; }
    var name = fm[2].trim();
    var nut = matchFood(name, grams);
    if (nut) { actions.push({action:'log_food',data:nut}); }
  }
  // Simple: \"ate chicken\" / \"an egg\"
  if (!actions.length) {
    var sfm = msg.match(/^(.{2,15})(?:了|吧|啦|的)?$/);
    if (!sfm) sfm = msg.match(/([一二两三四五]\s*(?:个|碗|杯|勺)\s*.{2,10})/);
    if (sfm) {
      var n2 = (sfm[1]||'').replace(/了|吧|啦|的/g,'').trim();
      var nut2 = matchFood(n2, 200); // default 200g
      if (nut2) { nut2.estimated=true; actions.push({action:'log_food',data:nut2}); }
    }
  }
  // Sleep: \"slept 7 hours\" / \"7h\"
  var sm = msg.match(/(\d+\.?\d*)\s*(?:小时|h|H)/);
  if (sm) { var h = parseFloat(sm[1]); if (h>0&&h<24) actions.push({action:'log_sleep',data:{duration_h:h}}); }
  // Weight: \"85kg\" / \"weight 85\"
  var wm = msg.match(/体重\s*(\d+\.?\d*)|^(\d+\.?\d*)\s*kg$/);
  if (wm) { var w = parseFloat(wm[1]||wm[2]); if (w>30&&w<300) actions.push({action:'log_weight',data:{weight_kg:w}}); }
  // Training: \"bench 80kg 4x8\"
  var tm = msg.match(/(\S{2,6})\s+(\d+\.?\d*)\s*kg.*?(\d+).*?[xX×]\s*(\d+)/);
  if (tm) actions.push({action:'log_training_set',data:{exercise:tm[1],weight_kg:parseFloat(tm[2]),sets:parseInt(tm[3]),reps:tm[4],done:true}});
  return actions;
}
function matchFood(name, grams) {
  for (var key in FOOD_DB) {
    if (name.indexOf(key)>=0) {
      var v=FOOD_DB[key]; var r=grams>50?grams/100:grams;
      return {name:name,protein_g:Math.round(v.p*r),carbs_g:Math.round(v.c*r),fat_g:Math.round(v.f*r),kcal:Math.round(v.k*r),estimated:true};
    }
  }
  return null;
}

// ══ 四区意图分类 ══
function classifyIntent(msg) {
  // 区3：计划调整（本地处理，不动AI）
  if (/^改|换成|改成|今天.*休|不想.*练|今天.*练(?!.*做|.*卧推|.*深蹲|.*kg)/.test(msg) && msg.length < 20) return 'plan';
  if (/晚上.*去|早上.*去|改为.*早|改为.*晚|训练.*时间|几点.*练/.test(msg) && msg.length < 15) return 'plan';
  if (/记住.*方案|保存.*计划|锁定.*方案/.test(msg)) return 'plan';

  // 区1：数据记录（需要AI提取结构化信息）
  if (/吃了|喝了|摄入|午饭|晚饭|早饭|早餐|午餐|晚餐|加餐|鸡胸|鸡腿|牛肉|虾|鱼|蛋|奶|豆浆|米饭|面包|香蕉|蛋白粉/.test(msg)) return 'log';
  if (/睡|起床|醒|失眠/.test(msg) && msg.length < 20) return 'log';
  if (/体重.*\d|kg.*\d|\d.*kg|称了/.test(msg) && msg.length < 20) return 'log';
  if (/卧推|深蹲|硬拉|划船|侧平|弯举|下拉|飞鸟|夹胸|臂屈伸|腿举|臀推|做完|做了.*组|完成/.test(msg)) return 'log';

  // 区2：查询（本地回答，不调AI）
  if (/今天.*干|今天.*怎么|今天.*什么|今天.*安排|日程|队列|做什么|干嘛|今天.*样/.test(msg)) return 'query';
  if (/多少|查|看.*多少|达标|还差|够不够/.test(msg) && msg.length < 20) return 'query';
  if (/今天.*蛋白|今天.*热量|今天.*碳水|今天.*体重|睡了.*多久|睡眠.*怎么/.test(msg)) return 'query';

  // 区4：分析（AI深度处理）
  if (/分析|复盘|趋势|建议|帮我.*看|什么.*问题|为什么|怎么.*改进/.test(msg) && msg.length > 10) return 'analyze';

  // 纠错 + 追加
  if (/不对|不是|错了|撤回|改成|更正/.test(msg) && msg.length < 30) return 'correct';
  if (/再加|也算|还有|另外|补充/.test(msg) && msg.length < 30) return 'correct';

  // 默认：聊天
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
  // 重置数据
  if (/重置.*数据|清除.*数据|删.*所有|重新.*开始|清空/.test(msg) && msg.length < 15) {
    if (/云端|supabase|数据库|线上/.test(msg)) return 'CONFIRM_CLOUD_RESET';
    return 'CONFIRM_RESET';
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
