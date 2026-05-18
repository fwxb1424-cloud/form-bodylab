/**
 * FORM · Body Lab — AI Provider v3
 * 路由：DeepSeek V3（主力）+ Gemini Flash（視覺/免費）
 * DeepSeek  → 飲食文字解析、訓練計劃、長線計劃、月度復盤
 * Gemini    → 拍照識別（免費額度）
 * Fallback  → DeepSeek Mini（任何主力失敗時降級）
 */

// ── MODELS ────────────────────────────────────────────
const MODELS = {
  // 主力：DeepSeek V3，邏輯強、中文好、便宜
  deepseek: {
    id: 'deepseek-chat',
    label: 'DeepSeek V3',
    provider: 'deepseek',
    maxTokens: 2000,
    timeoutMs: 40000,
    cPer1kIn:  0.00027,   // USD（約 0.002 人民幣/千 token）
    cPer1kOut: 0.00110,
  },
  // 視覺：Gemini 1.5 Flash，免費額度每天 1500 次
  gemini: {
    id: 'gemini-1.5-flash',
    label: 'Gemini Flash',
    provider: 'gemini',
    maxTokens: 1000,
    timeoutMs: 20000,
    cPer1kIn:  0,          // 免費層
    cPer1kOut: 0,
  },
  // 長上下文復盤：DeepSeek V3 支援 64K context
  deepseek_long: {
    id: 'deepseek-chat',
    label: 'DeepSeek V3↑',
    provider: 'deepseek',
    maxTokens: 4000,
    timeoutMs: 90000,
    cPer1kIn:  0.00027,
    cPer1kOut: 0.00110,
  },
  // Fallback
  fallback: {
    id: 'deepseek-chat',
    label: 'DeepSeek↓',
    provider: 'deepseek',
    maxTokens: 800,
    timeoutMs: 20000,
    cPer1kIn:  0.00027,
    cPer1kOut: 0.00110,
  },
};

// 場景 → 模型映射
const SCENE_MAP = {
  diet:     'deepseek',      // 飲食文字解析
  photo:    'gemini',        // 拍照識別（免費）
  workout:  'deepseek',      // 訓練計劃
  plan:     'deepseek',      // 長線計劃
  analysis: 'deepseek_long', // 月度復盤
  chat:     'deepseek',      // 一般問答
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
    const cost = (inputTokens / 1000 * m.cPer1kIn) + (outputTokens / 1000 * m.cPer1kOut);
    const entry = {
      ts: Date.now(), scene,
      model: m.label,
      inputTokens, outputTokens,
      cost: parseFloat(cost.toFixed(6)),
    };
    this.sessions.push(entry);
    if (this.sessions.length > 300) this.sessions.shift();
    this.totalCost = parseFloat((this.totalCost + cost).toFixed(6));
    this._save();
    return entry;
  }

  todayCost() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return this.sessions.filter(s => s.ts > t.getTime())
      .reduce((a, s) => a + s.cost, 0).toFixed(4);
  }
  todayCostCNY() {
    return (parseFloat(this.todayCost()) * 7.2).toFixed(3);
  }
  monthlyCost() {
    return this.sessions.filter(s => s.ts > Date.now() - 30 * 86400000)
      .reduce((a, s) => a + s.cost, 0).toFixed(4);
  }
  monthlyCostCNY() {
    return (parseFloat(this.monthlyCost()) * 7.2).toFixed(2);
  }
  lastN(n = 1) { return this.sessions.slice(-n).reverse(); }

  _save() {
    try { localStorage.setItem('form_tok', JSON.stringify({ sessions: this.sessions, totalCost: this.totalCost })); } catch(e) {}
  }
  _load() {
    try { return JSON.parse(localStorage.getItem('form_tok') || '{}'); } catch(e) { return {}; }
  }
}

// ── RESPONSE CACHE ────────────────────────────────────
class ResponseCache {
  constructor(ttl = 24 * 3600000) {
    this.ttl = ttl;
    this._load();
  }
  _key(scene, input) {
    return `${scene}:${(input || '').slice(0, 80).toLowerCase().replace(/\s+/g, ' ')}`;
  }
  get(scene, input) {
    const k = this._key(scene, input), e = this.store[k];
    if (!e || Date.now() - e.ts > this.ttl) { delete this.store[k]; return null; }
    return e.data;
  }
  set(scene, input, data) {
    const k = this._key(scene, input);
    this.store[k] = { ts: Date.now(), data };
    const keys = Object.keys(this.store);
    if (keys.length > 120) delete this.store[keys[0]];
    this._persist();
  }
  _persist() { try { localStorage.setItem('form_cache', JSON.stringify(this.store)); } catch(e) {} }
  _load() { try { this.store = JSON.parse(localStorage.getItem('form_cache') || '{}'); } catch(e) { this.store = {}; } }
}

// ── CONTEXT-AWARE TIMESTAMP ───────────────────────────
function getTimeContext() {
  const h = new Date().getHours();
  if (h >= 5  && h < 9)  return { label: '清晨', tag: 'morning_baseline', hint: '晨間狀態基準' };
  if (h >= 9  && h < 12) return { label: '上午', tag: 'morning',          hint: '上午記錄' };
  if (h >= 12 && h < 14) return { label: '午間', tag: 'noon',             hint: '午餐時段' };
  if (h >= 14 && h < 18) return { label: '下午', tag: 'afternoon',        hint: '下午記錄' };
  if (h >= 18 && h < 21) return { label: '傍晚', tag: 'evening_postwork', hint: '訓後補給窗口' };
  if (h >= 21 && h < 23) return { label: '夜間', tag: 'night_summary',    hint: '記錄為今日總結' };
  return                         { label: '深夜', tag: 'late_night',       hint: '深夜記錄，歸入今日總結' };
}

// ── CARB CYCLING ──────────────────────────────────────
function getCarbTarget(isTrainingDay, intensity = 'medium') {
  const t = { training: { high: 350, medium: 280, low: 220 }, rest: { high: 180, medium: 150, low: 120 } };
  return t[isTrainingDay ? 'training' : 'rest'][intensity] || 150;
}

// ── E1RM (Epley) ──────────────────────────────────────
function calcE1RM(weight, reps) {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// ── MAIN AI PROVIDER ──────────────────────────────────
class AIProvider {
  constructor(deepseekKey, geminiKey) {
    this.dsKey = deepseekKey;
    this.gmKey = geminiKey;
    this.tracker = new TokenTracker();
    this.cache = new ResponseCache();
  }

  async call(scene, opts = {}) {
    const { system, userMsg, imageBase64, useCache = false } = opts;

    // 快取命中（僅文字場景）
    if (useCache && userMsg && !imageBase64) {
      const hit = this.cache.get(scene, userMsg);
      if (hit) return { ...hit, _cached: true };
    }

    const modelKey = SCENE_MAP[scene] || 'deepseek';
    const model = MODELS[modelKey];

    let result;
    try {
      if (model.provider === 'gemini') {
        result = await this._callGemini(model, system, userMsg, imageBase64);
      } else {
        result = await this._callDeepSeek(model, system, userMsg);
      }
    } catch(err) {
      // 降級：任何失敗都切換到 DeepSeek Fallback
      console.warn(`[AI] ${model.label} 失敗 (${err.message})，降級中…`);
      try {
        result = await this._callDeepSeek(MODELS.fallback, system, userMsg);
        result._fallback = true;
      } catch(err2) {
        throw new Error(`主力和降級模型都失敗：${err2.message}`);
      }
    }

    // Token 記錄
    if (result._usage) {
      this.tracker.record({
        scene, modelKey,
        inputTokens: result._usage.input || 0,
        outputTokens: result._usage.output || 0,
      });
    }

    const parsed = this._parseJSON(result._text || '');
    if (useCache && userMsg && !imageBase64 && parsed && !parsed._parseError) {
      this.cache.set(scene, userMsg, parsed);
    }
    return parsed;
  }

  // ── DeepSeek 調用 ────────────────────────────────────
  async _callDeepSeek(model, system, userMsg) {
    if (!this.dsKey) throw new Error('DeepSeek Key 未設定');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), model.timeoutMs);
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.dsKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          max_tokens: model.maxTokens,
          temperature: 0.3,   // 低溫：更精準、更少廢話
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userMsg || '' },
          ],
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(`DeepSeek ${res.status}: ${e.error?.message || '未知錯誤'}`);
      }
      const data = await res.json();
      return {
        _text: data.choices?.[0]?.message?.content || '',
        _usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
      };
    } catch(e) { clearTimeout(timer); throw e; }
  }

  // ── Gemini 調用（視覺）───────────────────────────────
  async _callGemini(model, system, userMsg, imageBase64) {
    if (!this.gmKey) throw new Error('Gemini Key 未設定，拍照識別不可用');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), model.timeoutMs);

    // 組裝 parts
    const parts = [];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
    }
    parts.push({ text: (system ? system + '\n\n' : '') + (userMsg || '') });

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${this.gmKey}`;
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: model.maxTokens, temperature: 0.2 },
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(`Gemini ${res.status}: ${e.error?.message || '未知錯誤'}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return {
        _text: text,
        _usage: {
          input:  data.usageMetadata?.promptTokenCount || 0,
          output: data.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    } catch(e) { clearTimeout(timer); throw e; }
  }

  // ── JSON 解析（容錯）─────────────────────────────────
  _parseJSON(raw) {
    try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch(e2) {}
      return { _raw: raw, _parseError: true };
    }
  }
}

// ── SYSTEM PROMPTS ────────────────────────────────────
const PROMPTS = {

  diet: (memCtx = '', timeCtx) =>
`你是運動營養解析引擎，只輸出 JSON，不說任何多餘的話。${memCtx}
當前時段：${timeCtx?.label || ''}（${timeCtx?.hint || ''}）
解析用戶描述的食物，返回：
{"name":"食物名（多種用/分隔）","protein_g":整數,"carbs_g":整數,"fat_g":整數,"kcal":整數,"time_tag":"${timeCtx?.tag || 'meal'}"}
只返回 JSON。`,

  photo: (memCtx = '') =>
`你是食物視覺識別引擎，只輸出 JSON。${memCtx}
分析圖片中的食物，估算宏量素。返回：
{"name":"食物名","protein_g":整數,"carbs_g":整數,"fat_g":整數,"kcal":整數,"confidence":"high/medium/low","notes":"估算說明"}
只返回 JSON。`,

  workout: (profile, memCtx = '') =>
`你是頂級健美私人教練，科學嚴謹，只說有用的，不說廢話和免責聲明。${memCtx}

用戶數據：肌肉量 ${profile.muscle}kg · 體脂 ${profile.fat_pct}% · RPE ${profile.rpe}/10
今日：${profile.isTrainingDay ? '訓練日' : '休息日'} · 星期${['日','一','二','三','四','五','六'][new Date().getDay()]}
${profile.planWeekFocus ? `本週計劃重點：${profile.planWeekFocus}` : ''}

RPE 調整規則（嚴格執行）：
- RPE ≥ 8：容量降低 20%，增加恢復性動作
- RPE ≤ 4：漸進超負荷，可加重或加組
- RPE 5-7：正常訓練

只返回 JSON：
{"session_title":"訓練名稱","muscle_groups":"目標肌群","intensity":"High/Medium/Low",
"volume_note":"今日容量調整說明","carb_recommendation":整數,
"exercises":[{"name":"動作中文名","sets":4,"reps":"8-12","weight_kg":80,"muscle":"目標肌群","rpe_target":7,"is_compound":true,"notes":"技術要點（10字內）"}]}
只返回 JSON。`,

  plan: (profile, memCtx = '') =>
`你是健美週期規劃專家，只輸出 JSON，不說廢話。${memCtx}

用戶：肌肉量 ${profile.muscle}kg · 體脂 ${profile.fat_pct}%
目標：${profile.goal} · ${profile.weeks}週 · 每週 ${profile.daysPerWeek} 訓練天
限制：${profile.restrictions || '無'}

只返回 JSON：
{"title":"計劃名稱","goal":"核心目標","duration_weeks":${profile.weeks},
"phases":[{"phase":1,"weeks":"1-4","focus":"增肌/減脂/力量","key_lifts":["臥推","深蹲"],"weekly_volume":"中/高/低","notes":"階段重點"}],
"weekly_structure":{"training_days":${profile.daysPerWeek},"split":"推拉腿/上下肢","day_plan":["週一：胸肩","週三：背二頭","週五：腿"]},
"nutrition":{"protein_daily_g":170,"training_day_carbs":280,"rest_day_carbs":150,"notes":"飲食策略"},
"milestones":[{"week":4,"muscle_target":${profile.muscle + 0.5},"fat_target":${profile.fat_pct},"strength_notes":"力量預期"}]}
只返回 JSON。`,

  analysis: (memCtx = '') =>
`你是運動科學數據分析師，根據真實數據分析，不要假設，不說廢話。${memCtx}
只返回 JSON：
{"summary":"核心結論100字以內","muscle_trend":"趨勢+原因","fat_trend":"趨勢+原因",
"sleep_vs_performance":"睡眠與訓練表現相關性（有數據才寫，無數據寫暫無足夠數據）",
"training_insights":["洞察1","洞察2","洞察3"],
"nutrition_insights":["洞察1","洞察2"],
"strength_progress":{"best_lifts":["進步說明"],"stagnation_risk":"停滯風險"},
"recommendations":["具體建議1","具體建議2","具體建議3"],
"risk_flags":["風險1"]}
只返回 JSON。`,
};

// ── IMAGE COMPRESSION ─────────────────────────────────
async function compressImage(file, maxPx = 1024, q = 0.82) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let [w, h] = [img.width, img.height];
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        res(canvas.toDataURL('image/jpeg', q).split(',')[1]);
      };
      img.onerror = rej;
      img.src = e.target.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

window.AIProvider  = AIProvider;
window.PROMPTS     = PROMPTS;
window.MODELS      = MODELS;
window.compressImage  = compressImage;
window.getTimeContext = getTimeContext;
window.getCarbTarget  = getCarbTarget;
window.calcE1RM       = calcE1RM;
