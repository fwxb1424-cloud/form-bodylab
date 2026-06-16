/**
 * FORM · Body Lab — AI Provider v5
 * DeepSeek V3 主力 + Gemini Flash 视觉
 * temperature 0.2 — 更精准，更少废话
 */

const MODELS = {
  main:     { id:'deepseek-chat',      p:'ds', tok:2000, ms:40000, cIn:0.00027, cOut:0.00110 },
  vision:   { id:'gemini-1.5-flash',   p:'gm', tok:800,  ms:20000, cIn:0,       cOut:0       },
  long:     { id:'deepseek-chat',      p:'ds', tok:4000, ms:90000, cIn:0.00027, cOut:0.00110 },
  fallback: { id:'deepseek-chat',      p:'ds', tok:800,  ms:20000, cIn:0.00027, cOut:0.00110 },
};
const SCENE = {
  diet:'main', photo:'vision', workout:'main',
  plan:'main', analysis:'long', advice:'main', review:'main',
  coach:'long',
};
const SCENE_TEXT = new Set(['coach']); // 自然语言场景，不解析JSON

// ── Token Tracker ─────────────────────────────────────
class TokenTracker {
  constructor() { const s=this._load(); this.log=s.log||[]; this.total=s.total||0; }
  record({scene,mk,i,o}){
    const m=MODELS[mk]||MODELS.fallback;
    const c=i/1000*m.cIn+o/1000*m.cOut;
    this.log.push({ts:Date.now(),scene,mk,i,o,c:+c.toFixed(6)});
    if(this.log.length>400)this.log.shift();
    this.total=+(this.total+c).toFixed(6);
    this._save();
  }
  todayCNY(){ const t=new Date();t.setHours(0,0,0,0);return(this.log.filter(s=>s.ts>t.getTime()).reduce((a,s)=>a+s.c,0)*7.2).toFixed(3);}
  monthCNY(){ return(this.log.filter(s=>s.ts>Date.now()-30*864e5).reduce((a,s)=>a+s.c,0)*7.2).toFixed(2);}
  totalCNY(){ return(this.total*7.2).toFixed(2);}
  _save(){ try{localStorage.setItem('form_tok',JSON.stringify({log:this.log,total:this.total}));}catch(e){}}
  _load(){ try{return JSON.parse(localStorage.getItem('form_tok')||'{}');}catch(e){return {};}}
}

// ── Response Cache ────────────────────────────────────
class Cache {
  constructor(ttl=24*36e5){ this.ttl=ttl; try{this.s=JSON.parse(localStorage.getItem('form_cache')||'{}');}catch(e){this.s={};}}
  key(sc,inp){ return`${sc}:${(inp||'').slice(0,80).toLowerCase().replace(/\s+/g,' ')}`;}
  get(sc,inp){ const e=this.s[this.key(sc,inp)]; if(!e||Date.now()-e.t>this.ttl){delete this.s[this.key(sc,inp)];return null;} return e.d;}
  set(sc,inp,d){ this.s[this.key(sc,inp)]={t:Date.now(),d}; const k=Object.keys(this.s); if(k.length>100)delete this.s[k[0]]; try{localStorage.setItem('form_cache',JSON.stringify(this.s));}catch(e){}}
}

// ── AIProvider ────────────────────────────────────────
class AIProvider {
  constructor(dsKey,gmKey){ this.ds=dsKey; this.gm=gmKey; this.tracker=new TokenTracker(); this.cache=new Cache(); }

  async call(scene, {system, userMsg, imageBase64, useCache=false}={}) {
    if(useCache&&userMsg&&!imageBase64){
      const hit=this.cache.get(scene,userMsg);
      if(hit)return{...hit,_cached:true};
    }
    const mk=SCENE[scene]||'main';
    const model=MODELS[mk];
    let raw;
    try {
      raw = model.p==='gm'
        ? await this._gemini(model,system,userMsg,imageBase64)
        : await this._ds(model,system,userMsg);
    } catch(err) {
      console.warn('[AI] 降级:',err.message);
      try { raw=await this._ds(MODELS.fallback,system,userMsg); raw._fb=true; }
      catch(e2){ throw new Error('主力和降级都失败：'+e2.message); }
    }
    if(raw._u) this.tracker.record({scene,mk,i:raw._u.i||0,o:raw._u.o||0});
    // 自然语言场景（如教练对话）不解析JSON，直接返回原文
    if(SCENE_TEXT.has(scene)){
      return {_raw:raw._t||'',_err:false};
    }
    const parsed=this._json(raw._t||'');
    if(useCache&&userMsg&&!imageBase64&&!parsed._err) this.cache.set(scene,userMsg,parsed);
    return parsed;
  }

  async _ds(model,system,msg){
    if(!this.ds)throw new Error('未设置DeepSeek Key');
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),model.ms);
    try{
      const r=await fetch('https://api.deepseek.com/chat/completions',{
        method:'POST',signal:ctrl.signal,
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.ds}`},
        body:JSON.stringify({
          model:model.id,max_tokens:model.tok,temperature:0.2,
          messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:msg||''}],
        }),
      });
      clearTimeout(t);
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(`DS ${r.status}: ${e.error?.message||'err'}`);}
      const d=await r.json();
      return{_t:d.choices?.[0]?.message?.content||'',_u:{i:d.usage?.prompt_tokens||0,o:d.usage?.completion_tokens||0}};
    }catch(e){clearTimeout(t);throw e;}
  }

  async _gemini(model,system,msg,b64){
    if(!this.gm)throw new Error('未设置Gemini Key');
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),model.ms);
    const parts=[];
    if(b64)parts.push({inline_data:{mime_type:'image/jpeg',data:b64}});
    parts.push({text:(system?system+'\n\n':'')+( msg||'')});
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${this.gm}`,{
        method:'POST',signal:ctrl.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:model.tok,temperature:0.2}}),
      });
      clearTimeout(t);
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(`Gemini ${r.status}: ${e.error?.message||'err'}`);}
      const d=await r.json();
      return{_t:d.candidates?.[0]?.content?.parts?.[0]?.text||'',_u:{i:d.usageMetadata?.promptTokenCount||0,o:d.usageMetadata?.candidatesTokenCount||0}};
    }catch(e){clearTimeout(t);throw e;}
  }

  _json(raw){
    try{return JSON.parse(raw.replace(/```json|```/g,'').trim());}catch(e){
      const m=raw.match(/\{[\s\S]*\}/);
      if(m)try{return JSON.parse(m[0]);}catch(e2){}
      return{_raw:raw,_err:true};
    }
  }
}

// ── Utils ─────────────────────────────────────────────
function getTimeCtx(isTrain){
  const h=new Date().getHours();
  if(h>=5&&h<9)  return{label:'清晨',tag:'morning',hint:isTrain?'晨间空腹状态，适合记录体重后训练':'晨间状态基准，空腹测量最准'};
  if(h>=9&&h<12) return{label:'上午',tag:'morning',hint:isTrain?'上午训练时段，注意训练前加餐':'上午记录'};
  if(h>=12&&h<14)return{label:'午间',tag:'noon',hint:isTrain?'午餐后1-2h可训练，注意消化':'午餐时段'};
  if(h>=14&&h<18)return{label:'下午',tag:'afternoon',hint:isTrain?'下午训练黄金时段，睾酮水平较高':'下午记录'};
  if(h>=18&&h<21)return{label:'傍晚',tag:'evening',hint:isTrain?'训后黄金补给窗口（30-60min内）':'傍晚休息时段，控制碳水摄入'};
  if(h>=21&&h<23)return{label:'夜间',tag:'night',hint:'今日总结，距离睡眠留1-2h'};
  return{label:'深夜',tag:'late',hint:'深夜记录，避免高GI碳水'};
}
function getCarbTarget(isTrain,intensity='medium'){
  return({training:{high:320,medium:260,low:200},rest:{high:160,medium:130,low:100}})[isTrain?'training':'rest'][intensity]||130;
}
function calcE1RM(w,r){return r===1?w:Math.round(w*(1+r/30));}
async function compressImage(file,maxPx=1024,q=0.82){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement('canvas');
        let[w,h]=[img.width,img.height];
        if(w>maxPx||h>maxPx){if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;}}
        c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
        res(c.toDataURL('image/jpeg',q).split(',')[1]);
      };
      img.onerror=rej;img.src=e.target.result;
    };
    reader.onerror=rej;reader.readAsDataURL(file);
  });
}

// ── USER PROFILE BUILDER ──────────────────────────────
// 把用户所有已知信息压缩成高密度context，每次AI调用都注入
function buildProfile(S) {
  const now = new Date();
  const dayNames = ['日','一','二','三','四','五','六'];
  const tc = getTimeCtx(S.isTrain);
  const activeMemories = S.memories.filter(m=>!m.expires_at||new Date(m.expires_at)>now);
  const memLines = activeMemories.map(m=>`[${{perm:'永久',mid:'中期',short:'短期',day:'当日'}[m.tier]}] ${m.content}`).join('\n');
  const p = typeof mergeProfile === 'function' ? mergeProfile(S) : {};
  const tgt = typeof calcDailyTargets === 'function'
    ? calcDailyTargets(p, S.isTrain, 'medium')
    : { protein: 168, fat: 75, carbs: 220, kcal: 2220, lbm: 69.9, tdee: 2720 };

  // 上次各训练类型的实际数据（从S.recentSessionsCache读取）
  const recentCtx = buildRecentTrainContext(S);
  // 上次力量数据
  const strengthCtx = buildStrengthContext(S);

  return `
=== 用户专属档案 ===
体格：身高186cm · 体重${S.weight_kg||p.weight_kg||85}kg · 骨骼肌${S.muscle||40.4}kg · 体脂${S.fat_pct||17.8}%
营养目标（${S.isTrain ? '训练日' : '休息日'}）：蛋白${tgt.protein}g · 碳水${tgt.carbs}g · 脂肪${tgt.fat}g · 热量${tgt.kcal}kcal
当前计划阶段：减脂保肌期（阶段一）· 目标体脂13.5%
特殊注意：左踝腓外侧韧带滑脱，禁大重量自由深蹲（用腿举/哈克/史密斯替代）
常用动作池（不分训练日，实际结构见下方最近训练数据）：杠铃卧推·蝴蝶机夹胸·宽窄下拉+划船·面拉·器械/史密斯肩推·侧平举·倒蹬+臀推+腿弯举
骨架特点：窄肩小骨架，优先视觉扩宽（侧束+背宽）。下胸和胸外延是薄弱点，推日需针对性加强。
当前时间：星期${dayNames[now.getDay()]} ${tc.label}（${tc.hint}）
今日训练：${S.todayMuscle||(typeof getTodayQueueType==='function'?getTodayQueueType():'未选择')}${S.isTrain?'（训练日）':'（休息日）'}。训练队列：${typeof PLAN_QUEUE!=='undefined'?PLAN_QUEUE.join('→'):'push→pull→cardio→legs→shoulder→cardio→rest'}
今日摄入：蛋白质${Math.round(S.protein)}g · 热量${Math.round(S.kcal)}kcal
${recentCtx}
${strengthCtx}
${memLines?`\n个人训练记忆：\n${memLines}`:''}
=== 档案结束 ===`.trim();
}

// 构建最近训练历史context（按训练类型分类）
function buildRecentTrainContext(S) {
  if(!S.recentSessionsCache?.length) return '';
  const typeMap = {push:'推日',pull:'拉日',legs:'腿日',shoulder:'肩日',cardio:'有氧日',rest:'休息日'};
  // 找最近一次各类型训练
  const byType = {};
  for(const sess of S.recentSessionsCache){
    const t = sess.muscle_groups;
    if(!byType[t]) byType[t] = sess;
  }
  const lines = Object.entries(byType).slice(0,4).map(([type,sess])=>{
    const label = typeMap[type]||type;
    const exs = (() => { try{ return JSON.parse(sess.exercises_json||'[]'); }catch(e){return[];} })();
    const exSummary = exs.filter(e=>e.done||e.sets_data?.some(s=>s.done)).slice(0,5).map(e=>{
      const doneSets = (e.sets_data||[]).filter(s=>s.done);
      const actualVol = doneSets.length ? doneSets.reduce((a,s)=>a+s.w*s.r,0) : e.weight_kg*e.sets*parseInt((e.reps+'').split('-')[0]);
      const bestSet = doneSets.length ? doneSets.reduce((a,s)=>s.w>a.w?s:a,doneSets[0]) : null;
      return `    ${e.name}: ${bestSet?bestSet.w+'kg×'+bestSet.r+'次×'+doneSets.length+'组':e.weight_kg+'kg×'+e.reps+'×'+e.sets+'组（计划）'} | 容量${Math.round(actualVol)}`;
    }).join('\n');
    const date = new Date(sess.trained_at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
    return `  ${label}（${date}，容量${Math.round(sess.volume||0)}kg·r）：\n${exSummary}`;
  }).join('\n');
  return lines ? `\n最近各类型训练实际数据：\n${lines}` : '';
}

// 构建力量历史context（主要动作的E1RM趋势）
function buildStrengthContext(S) {
  if(!S.strengthCache||!Object.keys(S.strengthCache).length) return '';
  const lines = Object.entries(S.strengthCache).slice(0,5).map(([name,records])=>{
    if(!records.length) return '';
    const last = records[records.length-1];
    const prev = records.length>=2 ? records[records.length-2] : null;
    const trend = prev ? (last.e1rm>prev.e1rm?'↑':last.e1rm<prev.e1rm?'↓':'→') : '';
    return `  ${name}: E1RM ${last.e1rm||last.weight_kg}kg ${trend}（上次${last.weight_kg}kg×${last.reps}次，${new Date(last.logged_at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}）`;
  }).filter(Boolean).join('\n');
  return lines ? `\n主要动作力量记录：\n${lines}` : '';
}

// ── PROMPTS ───────────────────────────────────────────
const PROMPTS = {

  diet: (profile, tc) =>
`你是运动营养解析引擎，只输出JSON，不说多余的话。
${profile}
当前时段：${tc.label}（${tc.hint}）
解析用户描述的食物，返回：
{"name":"食物名","protein_g":整数,"carbs_g":整数,"fat_g":整数,"kcal":整数,"time_tag":"${tc.tag}"}
注意：去皮肉类脂肪含量明显低于带皮，要准确区分。只返回JSON。`,

  photo: (profile) =>
`你是食物视觉识别引擎，只输出JSON。
${profile}
分析图片食物，估算宏量素。返回：
{"name":"食物名","protein_g":整数,"carbs_g":整数,"fat_g":整数,"kcal":整数,"confidence":"high/medium/low","notes":"估算说明"}
只返回JSON。`,

  workout: (profile, muscleGroup, customRequest) =>
`你是顶级健美私人教练Cole的专属AI教练，科学严谨，零废话，不加免责声明。
${profile}

今日训练：${muscleGroup}
${customRequest?`用户特别要求：${customRequest}`:''}

【核心任务】基于上方「最近各类型训练实际数据」和「主要动作力量记录」生成今日专属方案：
- 每个动作的weight_kg必须基于上次实际使用的重量，参考线性渐进（+2.5~5kg或+1次），不能凭空给0或通用数字
- 如果上次某动作有记录，备注里要说明「上次${'{'}weight${'}'}kg×${'{'}reps${'}'}，本次目标+」，让用户知道进步方向
- 如果某动作上次记录了问题（左肩不适、力竭提前等），本次调整或替换
- 双杠臂屈伸：is_bodyweight=true，weight_kg写0，reps写目标次数，notes里说明「自重（85kg），如用辅助机写-辅助重量」
- 容量方向：减脂期控制在计划范围内（推日≤19组），不要无脑堆量
- 如果上次训练容量过高导致恢复不足，减1组或降5%重量；轻松完成则+2.5kg或+1次

计划动作顺序（${muscleGroup}）：
推日：杠铃卧推→史密斯上斜→双杠（或绳索下压）→蝴蝶机夹胸→哑铃侧平举→绳索三头下压
拉日：宽握下拉→窄握下拉→宽握划船→窄握划船→面拉→哑铃弯举→锤式弯举
肩日：器械/史密斯肩推→划船机侧平举→绳索侧平举→绳索前平举→俯身飞鸟
腿日：腿举→臀推→史密斯深蹲（左踝OK才做）→坐姿腿屈伸→俯卧腿弯举（共18组，核心已拆出）
有氧日：稳态有氧35min（心率130–140bpm）→ 加重卷腹3×15 → 悬挂举腿3×12 → 平板支撑2×45s

只返回JSON：
{
  "session_title":"训练名称（含日期特征如『W3推日』）",
  "muscle_groups":"目标肌群（精确）",
  "intensity":"High/Medium/Low",
  "estimated_duration":"分钟数",
  "volume_note":"本次容量策略说明（结合上次数据和恢复状态）",
  "next_session_hint":"下次训练的重点提示（一句话）",
  "exercises":[{
    "name":"动作中文名",
    "sets":整数,
    "reps":"8-12",
    "weight_kg":数字（基于历史，双杠写0）,
    "muscle":"针对肌群",
    "is_compound":true/false,
    "is_bodyweight":false,
    "notes":"技术要点+进步方向（20字内）"
  }]
}
只返回JSON。`,

  plan: (profile, goal, weeks, daysPerWeek, restrictions) =>
`你是健美周期规划专家，只输出JSON。
${profile}

用户目标：${goal} · ${weeks}周 · 每周${daysPerWeek}天训练
特殊限制：${restrictions||'无'}
训练偏好（必须遵守）：
- 胸、背、肩为主要训练重点
- 手臂（二头+三头）穿插在推/拉训练日
- 腿部每月约2次（不是每周）
- 五练制，每周固定训练日

生成完整周期计划，只返回JSON：
{
  "title":"计划名称",
  "goal":"核心目标",
  "duration_weeks":${weeks},
  "default_split":{
    "description":"分化说明",
    "week_template":[
      {"day":"周一","muscle":"胸+前三角+三头","type":"train"},
      {"day":"周二","muscle":"背+后三角+二头","type":"train"},
      {"day":"周三","muscle":"肩（中束为主）","type":"train"},
      {"day":"周四","muscle":"休息","type":"rest"},
      {"day":"周五","muscle":"胸+背（重量日）","type":"train"},
      {"day":"周六","muscle":"手臂+核心","type":"train"},
      {"day":"周日","muscle":"休息","type":"rest"}
    ]
  },
  "phases":[{
    "phase":1,
    "weeks":"1-4",
    "focus":"基础增肌",
    "key_lifts":["臥推","高位下拉","哑铃侧平举"],
    "volume":"中等",
    "notes":"建立训练基础，注重动作质量"
  }],
  "nutrition":{
    "protein_g":170,
    "train_carbs":260,
    "rest_carbs":130,
    "leg_day_carbs":300,
    "notes":"训练日增加碳水，腿日最高，休息日减少"
  },
  "milestones":[{
    "week":4,
    "muscle_target":${parseFloat((40.4+0.4).toFixed(1))},
    "fat_target":17.5,
    "strength_notes":"臥推增加2.5-5kg"
  }],
  "leg_frequency":"每月2次，安排在体力充沛的训练日",
  "coach_notes":"针对你偏好的个性化建议"
}
只返回JSON。`,

  // 智能补强建议：结合今日全部数据
  gapRec: (profile) =>
`你是运动营养顾问，根据用户今日完整数据给出补强建议。
${profile}

分析蛋白质缺口、碳水和脂肪比例是否合理、训练后恢复需求，给出今日剩余时间的具体饮食建议。
只返回JSON：
{
  "protein_gap":整数（今日还差多少g蛋白质，0表示已达标）,
  "status":"ok/warn/alert",
  "headline":"一句话总结（20字内）",
  "suggestions":[
    {"food":"具体食物","amount":"具体克数或份数","protein":整数,"reason":"为什么推荐（10字内）"},
    {"food":"备选食物","amount":"克数","protein":整数,"reason":"原因"}
  ],
  "timing":"建议在什么时间摄入（结合当前时段）",
  "carb_note":"碳水状态说明（一句话）"
}
只返回JSON。`,

  // 每日快速建议
  advice: (profile, question) =>
`你是顶级健美私人教练，给出精准建议，不废话，不免责。
${profile}
用户问题：${question}
给出2-3条具体可执行建议，每条不超过40字。
只返回JSON：{"advice":["建议1","建议2","建议3"],"priority":"优先执行哪条及原因（20字内）"}
只返回JSON。`,

  // 短期复盘（灵活时间段）
  review: (profile, data, period) =>
`你是运动科学数据分析师，根据真实数据分析，不假设。
${profile}
复盘周期：${period}
数据：${JSON.stringify(data)}
只返回JSON：
{
  "summary":"核心结论（60字内）",
  "highlights":["亮点1","亮点2"],
  "issues":["问题1","问题2"],
  "muscle_trend":"趋势说明",
  "fat_trend":"趋势说明",
  "nutrition_avg":{"protein_avg":整数,"carbs_avg":整数,"kcal_avg":整数},
  "sleep_avg":数字,
  "train_days":整数,
  "total_volume":整数,
  "recs":["明日/本周建议1","建议2","建议3"],
  "risk":"最需要注意的一件事（20字内）"
}
只返回JSON。`,

  analysis: (profile, exportData) =>
`你是运动科学数据分析师，根据真实数据分析，不假设，不废话。
${profile}
过去90天完整数据：${JSON.stringify(exportData)}
只返回JSON：
{
  "summary":"核心结论80字内",
  "muscle_trend":"趋势+原因",
  "fat_trend":"趋势+原因",
  "sleep_vs_perf":"睡眠与表现相关性（无数据则写暂无足够数据）",
  "train_insights":["洞察1","洞察2","洞察3"],
  "nutrition_insights":["洞察1","洞察2"],
  "strength_progress":{"lifts":["进步说明"],"stagnation":"停滞风险"},
  "recs":["具体建议1","具体建议2","具体建议3"],
  "risks":["风险1"]
}
只返回JSON。`,

  coach: (profile) =>
`你是 FORM Coach，Cole 的私人健美教练。

${profile}

【核心原则 —— 先做事，再说话】
看到用户说"吃了XX"、"睡了X小时"、"卧推XX"、"体重XX"，第一反应是记录数据，不是讲课。
回复顺序：1.确认操作（"记了"） 2.关键数据点（"蛋白还差XX"） 3.如果用户明确问分析，才展开。

【语气】
- 像真人教练发微信。短句。直接。不写论文。
- 日常操作回复控制在2-4句话。只有用户明确要求"分析"、"建议"、"帮我看看"时才展开。
- 用户情绪低落时先共情（一句），再给方向。不说教。
- 用"你"不用"您"。不讲"你应该"——说"试试"、"建议"。
- 好消息要开心（"新纪录！"），坏消息要有信心（"没事，一周不练不掉肉"）。

【行为规范】
- 数据优先：用户说的每一条信息都要记录——用 Action 块。
- 不确定就问：用户说"晚上练肩"，如果会影响明天计划，问一句"明天原计划是肩日，今天练了明天休息？"
- 不编数据：没有的数据就说没有，不要猜。
- 不替用户做决定："建议把碳水降到120g"而不是"你必须降到120g"。

【回复格式】
禁止markdown。禁止**加粗**、- 列表、# 标题。
用空行分段。重要数字换行显示。

【Action 块 —— 强制使用】
用户告诉你的每条信息都要用 Action 记录。不记录等于白说。
- 能确定的数据直接记录
- 不确定的加 estimated=true（如：protein_g=30 estimated=true）
- 完全不知道的食物诚实说"不确定"，让用户自己补充

格式（放在回复末尾）：
[ACTION:log_food]
name=茶叶蛋蛋清
protein_g=12
estimated=true
[/ACTION]

所有 Action：
- log_food: name protein_g carbs_g fat_g kcal estimated(可选)
- log_sleep: duration_h bedtime waketime
- log_weight: weight_kg
- log_training_set: exercise weight_kg sets reps done
- start_training: muscle
- log_plan: muscle exercises`,
};

window.AIProvider  = AIProvider;
window.PROMPTS     = PROMPTS;
window.buildProfile = buildProfile;
window.getTimeCtx  = getTimeCtx;
window.getCarbTarget = getCarbTarget;
window.calcE1RM    = calcE1RM;
window.compressImage = compressImage;
