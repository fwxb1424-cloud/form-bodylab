/**
 * FORM · Body Lab — AI Provider v2
 * Model routing, caching, fallback, token tracking
 */

// ── MODELS ────────────────────────────────────────────
const MODELS = {
  vision:    { id:'claude-haiku-4-5-20251001',  label:'Haiku',   maxTokens:600,  timeoutMs:12000, cIn:0.00025, cOut:0.00125 },
  reasoning: { id:'claude-sonnet-4-6',           label:'Sonnet',  maxTokens:2000, timeoutMs:35000, cIn:0.003,   cOut:0.015   },
  analysis:  { id:'claude-sonnet-4-6',           label:'Sonnet↑', maxTokens:4000, timeoutMs:60000, cIn:0.003,   cOut:0.015   },
  fallback:  { id:'claude-haiku-4-5-20251001',  label:'Haiku↓',  maxTokens:800,  timeoutMs:15000, cIn:0.00025, cOut:0.00125 },
};
const SCENE_MAP = {
  diet:'vision', photo:'vision', workout:'reasoning',
  plan:'reasoning', analysis:'analysis', chat:'reasoning',
};

// ── TOKEN TRACKER ─────────────────────────────────────
class TokenTracker {
  constructor() {
    const s = this._load();
    this.sessions = s.sessions || [];
    this.totalCost = s.totalCost || 0;
  }
  record({ scene, modelKey, inputTokens, outputTokens }) {
    const m = MODELS[modelKey] || MODELS.fallback;
    const cost = inputTokens/1000*m.cIn + outputTokens/1000*m.cOut;
    const e = { ts:Date.now(), scene, model:m.label, inputTokens, outputTokens, cost:parseFloat(cost.toFixed(6)) };
    this.sessions.push(e);
    if (this.sessions.length > 300) this.sessions.shift();
    this.totalCost = parseFloat((this.totalCost + cost).toFixed(6));
    this._save();
    return e;
  }
  todayCost() {
    const t = new Date(); t.setHours(0,0,0,0);
    return this.sessions.filter(s=>s.ts>t.getTime()).reduce((a,s)=>a+s.cost,0).toFixed(4);
  }
  monthlyCost() {
    const t = Date.now() - 30*86400000;
    return this.sessions.filter(s=>s.ts>t).reduce((a,s)=>a+s.cost,0).toFixed(4);
  }
  lastN(n=1) { return this.sessions.slice(-n).reverse(); }
  _save() { try { localStorage.setItem('form_tok', JSON.stringify({sessions:this.sessions,totalCost:this.totalCost})); } catch(e){} }
  _load() { try { return JSON.parse(localStorage.getItem('form_tok')||'{}'); } catch(e){ return {}; } }
}

// ── RESPONSE CACHE ────────────────────────────────────
class ResponseCache {
  constructor(ttl = 24*3600000) { this.ttl = ttl; this._load(); }
  _key(scene, input) { return `${scene}:${(input||'').slice(0,80).toLowerCase().replace(/\s+/g,' ')}`; }
  get(scene, input) {
    const k = this._key(scene, input), e = this.store[k];
    if (!e || Date.now()-e.ts > this.ttl) { delete this.store[k]; return null; }
    return e.data;
  }
  set(scene, input, data) {
    const k = this._key(scene, input);
    this.store[k] = { ts:Date.now(), data };
    const keys = Object.keys(this.store);
    if (keys.length > 120) delete this.store[keys[0]];
    this._persist();
  }
  _persist() { try { localStorage.setItem('form_cache', JSON.stringify(this.store)); } catch(e){} }
  _load() { try { this.store = JSON.parse(localStorage.getItem('form_cache')||'{}'); } catch(e){ this.store={}; } }
}

// ── CONTEXT-AWARE TIMESTAMP ───────────────────────────
function getTimeContext() {
  const h = new Date().getHours();
  if (h >= 5  && h < 9)  return { label:'清晨', tag:'morning_baseline',  hint:'記錄為晨間狀態基準' };
  if (h >= 9  && h < 12) return { label:'上午', tag:'morning',           hint:'上午記錄' };
  if (h >= 12 && h < 14) return { label:'午間', tag:'noon',              hint:'午餐時段' };
  if (h >= 14 && h < 18) return { label:'下午', tag:'afternoon',         hint:'下午記錄' };
  if (h >= 18 && h < 21) return { label:'傍晚', tag:'evening_postwork',  hint:'訓後補給窗口' };
  if (h >= 21 && h < 23) return { label:'夜間', tag:'night_summary',     hint:'記錄為今日總結' };
  return                         { label:'深夜', tag:'late_night',        hint:'深夜記錄，歸入今日總結' };
}

// ── CARB CYCLING ──────────────────────────────────────
function getCarbTarget(isTrainingDay, intensity = 'medium') {
  const targets = {
    training: { high:350, medium:280, low:220 },
    rest:     { high:180, medium:150, low:120 },
  };
  const type = isTrainingDay ? 'training' : 'rest';
  return targets[type][intensity] || targets[type].medium;
}

// ── E1RM CALCULATOR (Epley formula) ──────────────────
function calcE1RM(weight, reps) {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// ── MAIN AI PROVIDER ─────────────────────────────────
class AIProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.tracker = new TokenTracker();
    this.cache = new ResponseCache();
  }

  async call(scene, opts = {}) {
    const { system, userMsg, imageBase64, useCache = false } = opts;
    if (useCache && userMsg) {
      const hit = this.cache.get(scene, userMsg);
      if (hit) return { ...hit, _cached: true };
    }
    const modelKey = SCENE_MAP[scene] || 'reasoning';
    const model = MODELS[modelKey];
    const messages = imageBase64
      ? [{ role:'user', content:[{ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:imageBase64 }},{ type:'text', text:userMsg||'' }]}]
      : [{ role:'user', content: userMsg||'' }];
    let result;
    try {
      result = await this._fetch(model, system, messages);
    } catch(err) {
      if (err.name==='TimeoutError' || (err.status&&err.status>=500)) {
        console.warn('[AI] 降級到 Fallback:', err.message);
        result = await this._fetch(MODELS.fallback, system, messages);
      } else throw err;
    }
    if (result.usage) this.tracker.record({ scene, modelKey, inputTokens:result.usage.input_tokens||0, outputTokens:result.usage.output_tokens||0 });
    const raw = result.content?.[0]?.text || '';
    const parsed = this._parseJSON(raw);
    if (useCache && userMsg && parsed && !parsed._parseError) this.cache.set(scene, userMsg, parsed);
    return parsed;
  }

  async _fetch(model, system, messages) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { const e=new Error('timeout'); e.name='TimeoutError'; ctrl.abort(e); }, model.timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', signal:ctrl.signal,
        headers:{ 'Content-Type':'application/json','x-api-key':this.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true' },
        body:JSON.stringify({ model:model.id, max_tokens:model.maxTokens, system:system||'', messages }),
      });
      clearTimeout(timer);
      if (!res.ok) { const e=new Error(`HTTP ${res.status}`); e.status=res.status; throw e; }
      return await res.json();
    } catch(e) { clearTimeout(timer); throw e; }
  }

  _parseJSON(raw) {
    try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/); if(m) try { return JSON.parse(m[0]); } catch(e2){}
      return { _raw:raw, _parseError:true };
    }
  }
}

// ── PROMPTS ───────────────────────────────────────────
const PROMPTS = {

  diet: (memCtx='', timeCtx) => `你是運動營養解析引擎。${memCtx}
當前時段：${timeCtx?.label||''}（${timeCtx?.hint||''}）
解析食物描述，只返回 JSON：
{"name":"食物名","protein_g":整數,"carbs_g":整數,"fat_g":整數,"kcal":整數,"time_tag":"${timeCtx?.tag||'meal'}"}
只返回 JSON。`,

  photo: (memCtx='') => `你是食物視覺識別引擎。${memCtx}
分析圖片食物，估算宏量素。只返回 JSON：
{"name":"食物名","protein_g":整數,"carbs_g":整數,"fat_g":整數,"kcal":整數,"confidence":"high/medium/low","notes":"估算說明"}
只返回 JSON。`,

  workout: (profile, memCtx='') => `你是頂級健美私人教練，科學嚴謹、零廢話。${memCtx}

用戶數據：肌肉量 ${profile.muscle}kg · 體脂 ${profile.fat_pct}% · RPE ${profile.rpe}/10
今日類型：${profile.isTrainingDay?'訓練日':'休息日/輕訓日'} · 星期${['日','一','二','三','四','五','六'][new Date().getDay()]}
本週已訓練：${profile.trainDays}天
${profile.planWeekFocus ? `本週計劃重點：${profile.planWeekFocus}` : ''}

RPE 調整規則：
- RPE ≥ 8：容量降低 20%，優先恢復動作
- RPE ≤ 4：可漸進超負荷，加重或加組
- RPE 5-7：正常訓練

只返回 JSON：
{"session_title":"訓練名稱","muscle_groups":"目標肌群","intensity":"High/Medium/Low",
"volume_note":"今日容量說明",
"carb_recommendation":碳水克數整數,
"exercises":[{"name":"動作名","sets":4,"reps":"8-12","weight_kg":80,"muscle":"目標肌群","rpe_target":7,"is_compound":true,"notes":"技巧要點"}]}
只返回 JSON。`,

  plan: (profile, memCtx='') => `你是健美週期規劃專家。${memCtx}

用戶當前數據：
- 肌肉量：${profile.muscle}kg · 體脂：${profile.fat_pct}%
- 目標：${profile.goal}
- 週期長度：${profile.weeks}週
- 每週可訓練天數：${profile.daysPerWeek}天
- 特殊限制：${profile.restrictions||'無'}

生成完整週期計劃。只返回 JSON：
{
  "title":"計劃名稱",
  "goal":"核心目標",
  "duration_weeks":${profile.weeks},
  "phases":[
    {"phase":1,"weeks":"1-4","focus":"增肌/減脂/力量","key_lifts":["臥推","深蹲"],"weekly_volume":"中等/高/低","notes":"這個階段的重點說明"}
  ],
  "weekly_structure":{
    "training_days":${profile.daysPerWeek},
    "split":"推拉腿/上下肢/全身",
    "day_plan":["週一：胸肩","週三：背二","週五：腿"]
  },
  "nutrition":{
    "protein_daily_g":170,
    "training_day_carbs":280,
    "rest_day_carbs":150,
    "notes":"飲食策略說明"
  },
  "milestones":[
    {"week":4,"muscle_target":${profile.muscle+0.5},"fat_target":${profile.fat_pct},"strength_notes":"預期力量進步"}
  ]
}
只返回 JSON。`,

  analysis: (memCtx='') => `你是運動科學數據分析師，擁有豐富的健美週期研究背景。${memCtx}
分析用戶過去數據，深度關聯分析。只返回 JSON：
{"summary":"核心結論100字","muscle_trend":"趨勢+原因","fat_trend":"趨勢+原因",
"sleep_vs_performance":"睡眠與訓練表現的相關性分析",
"training_insights":["洞察1","洞察2","洞察3"],
"nutrition_insights":["洞察1","洞察2"],
"strength_progress":{"best_lifts":["臥推進步X kg"],"stagnation_risk":"停滯風險評估"},
"recommendations":["建議1","建議2","建議3"],
"risk_flags":["風險1"]}
只返回 JSON。`,
};

// ── IMAGE COMPRESSION ─────────────────────────────────
async function compressImage(file, maxPx=1024, q=0.82) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let [w,h] = [img.width, img.height];
        if (w>maxPx||h>maxPx) { if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;} }
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        res(canvas.toDataURL('image/jpeg',q).split(',')[1]);
      };
      img.onerror=rej; img.src=e.target.result;
    };
    reader.onerror=rej; reader.readAsDataURL(file);
  });
}

window.AIProvider = AIProvider;
window.PROMPTS = PROMPTS;
window.MODELS = MODELS;
window.compressImage = compressImage;
window.getTimeContext = getTimeContext;
window.getCarbTarget = getCarbTarget;
window.calcE1RM = calcE1RM;
