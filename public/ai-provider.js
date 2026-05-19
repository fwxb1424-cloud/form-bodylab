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
};

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
function getTimeCtx(){
  const h=new Date().getHours();
  if(h>=5&&h<9)  return{label:'清晨',tag:'morning',hint:'晨间状态基准，空腹测量最准'};
  if(h>=9&&h<12) return{label:'上午',tag:'morning',hint:'上午记录'};
  if(h>=12&&h<14)return{label:'午间',tag:'noon',hint:'午餐时段'};
  if(h>=14&&h<18)return{label:'下午',tag:'afternoon',hint:'下午记录'};
  if(h>=18&&h<21)return{label:'傍晚',tag:'evening',hint:'训后黄金补给窗口（30-60min内）'};
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
  const tc = getTimeCtx();
  const activeMemories = S.memories.filter(m=>!m.expires_at||new Date(m.expires_at)>now);
  const memLines = activeMemories.map(m=>`[${{perm:'永久',mid:'中期',short:'短期',day:'当日'}[m.tier]}] ${m.content}`).join('\n');
  const p = typeof mergeProfile === 'function' ? mergeProfile(S) : {};
  const tgt = typeof calcDailyTargets === 'function'
    ? calcDailyTargets(p, S.isTrain, 'medium')
    : { protein: 170, fat: 70, carbs: 200, kcal: 2500, lbm: 0, tdee: 2500 };

  return `
=== 用户专属档案 ===
体格：身高 ${p.height_cm || '—'}cm · 体重 ${p.weight_kg || '—'}kg · 瘦体重约 ${tgt.lbm}kg · 肌肉量 ${S.muscle}kg · 体脂 ${S.fat_pct}%
营养目标（${S.isTrain ? '训练日' : '休息日'}）：蛋白 ${tgt.protein}g · 脂肪 ${tgt.fat}g · 碳水 ${tgt.carbs}g · 热量 ${tgt.kcal}kcal（TDEE约${tgt.tdee}）
阶段目标：${p.goalLabel || '增肌减脂'}
训练偏好：胸背肩为主 · 手臂穿插 · 腿部每月约2次 · 偏好五练/周
当前时间：星期${dayNames[now.getDay()]} ${tc.label}（${tc.hint}）
今日类型：${S.isTrain?'训练日':'休息日'} · RPE ${S.rpe}/10
今日摄入：蛋白质${Math.round(S.protein)}g · 碳水${Math.round(S.carbs)}g · 脂肪${Math.round(S.fat)}g · 热量${Math.round(S.kcal)}kcal
今日训练容量：${Math.round(S.volume)}kg·r · 目标肌群：${S.todayMuscle||'未选择'}
${S.activePlan?.goal?`当前周期目标：${S.activePlan.goal}`:''}
${S.activePlan?.weekFocus?`本周重点：${S.activePlan.weekFocus}`:''}
${memLines?`\n个人记录：\n${memLines}`:''}
=== 档案结束 ===`.trim();
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
`你是顶级健美私人教练，科学严谨，零废话，不加免责声明。
${profile}

今日训练目标肌群：${muscleGroup}
${customRequest?`用户特别要求：${customRequest}`:''}

规则（严格执行）：
- RPE≥8：降容量20%，多加恢复性动作
- RPE≤4：可漸进超负荷
- 复合动作优先，孤立动作收尾
- 胸背肩训练：6-8个动作；腿部：5-7个动作；手臂：4-5个动作
- 动作要有明确的肌群针对性，不要泛泛的"全身"

只返回JSON：
{
  "session_title":"训练名称",
  "muscle_groups":"目标肌群（精确）",
  "intensity":"High/Medium/Low",
  "estimated_duration":"分钟数",
  "volume_note":"容量说明（结合RPE给出）",
  "carb_rec":整数,
  "exercises":[{
    "name":"动作中文名",
    "sets":整数,
    "reps":"8-12",
    "weight_kg":整数,
    "muscle":"针对肌群",
    "rpe_target":整数,
    "is_compound":true,
    "notes":"技术要点（15字内）"
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
};

window.AIProvider  = AIProvider;
window.PROMPTS     = PROMPTS;
window.buildProfile = buildProfile;
window.getTimeCtx  = getTimeCtx;
window.getCarbTarget = getCarbTarget;
window.calcE1RM    = calcE1RM;
window.compressImage = compressImage;
