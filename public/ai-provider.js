/**
 * FORM · Body Lab — AI Provider v4
 * DeepSeek V3（主力）+ Gemini Flash（视觉）
 */
const MODELS = {
  main:     { id:'deepseek-chat', p:'ds', maxTokens:2000, timeout:40000, cIn:0.00027, cOut:0.00110 },
  vision:   { id:'gemini-1.5-flash', p:'gm', maxTokens:800,  timeout:20000, cIn:0, cOut:0 },
  long:     { id:'deepseek-chat', p:'ds', maxTokens:4000, timeout:90000, cIn:0.00027, cOut:0.00110 },
  fallback: { id:'deepseek-chat', p:'ds', maxTokens:800,  timeout:20000, cIn:0.00027, cOut:0.00110 },
};
const SCENE_MAP = { diet:'main', photo:'vision', workout:'main', plan:'main', analysis:'long', chat:'main' };

class TokenTracker {
  constructor() { const s=this._load(); this.log=s.log||[]; this.total=s.total||0; }
  record({scene,mk,inTok,outTok}){
    const m=MODELS[mk]||MODELS.fallback;
    const cost=inTok/1000*m.cIn+outTok/1000*m.cOut;
    this.log.push({ts:Date.now(),scene,inTok,outTok,cost:+cost.toFixed(6)});
    if(this.log.length>300)this.log.shift();
    this.total=+(this.total+cost).toFixed(6);
    this._save();
  }
  todayCNY(){ const t=new Date();t.setHours(0,0,0,0); return (this.log.filter(s=>s.ts>t.getTime()).reduce((a,s)=>a+s.cost,0)*7.2).toFixed(3); }
  monthCNY(){ return (this.log.filter(s=>s.ts>Date.now()-30*86400000).reduce((a,s)=>a+s.cost,0)*7.2).toFixed(2); }
  last(){ return this.log[this.log.length-1]||null; }
  _save(){ try{localStorage.setItem('form_tok',JSON.stringify({log:this.log,total:this.total}));}catch(e){} }
  _load(){ try{return JSON.parse(localStorage.getItem('form_tok')||'{}');}catch(e){return {};} }
}

class Cache {
  constructor(ttl=24*3600000){ this.ttl=ttl; try{this.s=JSON.parse(localStorage.getItem('form_cache')||'{}');}catch(e){this.s={};} }
  key(sc,inp){ return `${sc}:${(inp||'').slice(0,80).toLowerCase().replace(/\s+/g,' ')}`; }
  get(sc,inp){ const e=this.s[this.key(sc,inp)]; if(!e||Date.now()-e.t>this.ttl){delete this.s[this.key(sc,inp)];return null;} return e.d; }
  set(sc,inp,d){ this.s[this.key(sc,inp)]={t:Date.now(),d}; const k=Object.keys(this.s); if(k.length>100)delete this.s[k[0]]; try{localStorage.setItem('form_cache',JSON.stringify(this.s));}catch(e){} }
}

class AIProvider {
  constructor(dsKey,gmKey){ this.ds=dsKey; this.gm=gmKey; this.tracker=new TokenTracker(); this.cache=new Cache(); }

  async call(scene,{system,userMsg,imageBase64,useCache=false}={}){
    if(useCache&&userMsg&&!imageBase64){ const h=this.cache.get(scene,userMsg); if(h)return{...h,_cached:true}; }
    const mk=SCENE_MAP[scene]||'main';
    const model=MODELS[mk];
    let raw;
    try{
      raw = model.p==='gm' ? await this._gemini(model,system,userMsg,imageBase64) : await this._deepseek(model,system,userMsg);
    }catch(err){
      console.warn('[AI] 主力失败，降级:',err.message);
      raw = await this._deepseek(MODELS.fallback,system,userMsg);
      raw._fallback=true;
    }
    if(raw._usage) this.tracker.record({scene,mk,inTok:raw._usage.in||0,outTok:raw._usage.out||0});
    const parsed=this._json(raw._text||'');
    if(useCache&&userMsg&&!imageBase64&&!parsed._parseError) this.cache.set(scene,userMsg,parsed);
    return parsed;
  }

  async _deepseek(model,system,userMsg){
    if(!this.ds)throw new Error('未设置 DeepSeek Key');
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),model.timeout);
    try{
      const r=await fetch('https://api.deepseek.com/chat/completions',{
        method:'POST',signal:ctrl.signal,
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.ds}`},
        body:JSON.stringify({model:model.id,max_tokens:model.maxTokens,temperature:0.3,
          messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:userMsg||''}]}),
      });
      clearTimeout(t);
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(`DeepSeek ${r.status}: ${e.error?.message||'错误'}`);}
      const d=await r.json();
      return{_text:d.choices?.[0]?.message?.content||'',_usage:{in:d.usage?.prompt_tokens||0,out:d.usage?.completion_tokens||0}};
    }catch(e){clearTimeout(t);throw e;}
  }

  async _gemini(model,system,userMsg,imageBase64){
    if(!this.gm)throw new Error('未设置 Gemini Key，拍照功能不可用');
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),model.timeout);
    const parts=[];
    if(imageBase64) parts.push({inline_data:{mime_type:'image/jpeg',data:imageBase64}});
    parts.push({text:(system?system+'\n\n':'')+( userMsg||'')});
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${this.gm}`,{
        method:'POST',signal:ctrl.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts}],generationConfig:{maxOutputTokens:model.maxTokens,temperature:0.2}}),
      });
      clearTimeout(t);
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(`Gemini ${r.status}: ${e.error?.message||'错误'}`);}
      const d=await r.json();
      return{_text:d.candidates?.[0]?.content?.parts?.[0]?.text||'',_usage:{in:d.usageMetadata?.promptTokenCount||0,out:d.usageMetadata?.candidatesTokenCount||0}};
    }catch(e){clearTimeout(t);throw e;}
  }

  _json(raw){
    try{return JSON.parse(raw.replace(/```json|```/g,'').trim());}catch(e){
      const m=raw.match(/\{[\s\S]*\}/);
      if(m)try{return JSON.parse(m[0]);}catch(e2){}
      return{_raw:raw,_parseError:true};
    }
  }
}

// ── 工具函数 ──────────────────────────────────────────
function getTimeCtx(){
  const h=new Date().getHours();
  if(h>=5&&h<9)  return{label:'清晨',tag:'morning_baseline',hint:'晨间状态基准'};
  if(h>=9&&h<12) return{label:'上午',tag:'morning',hint:'上午记录'};
  if(h>=12&&h<14)return{label:'午间',tag:'noon',hint:'午餐时段'};
  if(h>=14&&h<18)return{label:'下午',tag:'afternoon',hint:'下午记录'};
  if(h>=18&&h<21)return{label:'傍晚',tag:'evening',hint:'训后补给窗口'};
  if(h>=21&&h<23)return{label:'夜间',tag:'night',hint:'今日总结'};
  return{label:'深夜',tag:'late',hint:'深夜记录，归入今日总结'};
}
function getCarbTarget(isTrain,intensity='medium'){
  return({training:{high:350,medium:280,low:220},rest:{high:180,medium:150,low:120}})[isTrain?'training':'rest'][intensity]||150;
}
function calcE1RM(w,r){ return r===1?w:Math.round(w*(1+r/30)); }

async function compressImage(file,maxPx=1024,q=0.82){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let[w,h]=[img.width,img.height];
        if(w>maxPx||h>maxPx){if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;}}
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        res(canvas.toDataURL('image/jpeg',q).split(',')[1]);
      };
      img.onerror=rej;img.src=e.target.result;
    };
    reader.onerror=rej;reader.readAsDataURL(file);
  });
}

// ── Prompts ───────────────────────────────────────────
const PROMPTS={
  diet:(mem='',tc)=>
`你是运动营养解析引擎，只输出JSON，不说废话。${mem}
时段：${tc?.label||''}（${tc?.hint||''}）
解析食物，返回：{"name":"食物名","protein_g":整数,"carbs_g":整数,"fat_g":整数,"kcal":整数,"time_tag":"${tc?.tag||'meal'}"}
只返回JSON。`,

  photo:(mem='')=>
`你是食物视觉识别引擎，只输出JSON。${mem}
分析图片食物，估算宏量素。返回：
{"name":"食物名","protein_g":整数,"carbs_g":整数,"fat_g":整数,"kcal":整数,"confidence":"high/medium/low","notes":"估算说明"}
只返回JSON。`,

  workout:(profile,mem='')=>
`你是顶级健美私人教练，科学严谨，只给有用建议，不说废话和免责声明。${mem}
用户：肌肉量${profile.muscle}kg · 体脂${profile.fat_pct}% · 今日RPE ${profile.rpe}/10
${profile.isTrainingDay?'训练日':'休息日'} · 星期${['日','一','二','三','四','五','六'][new Date().getDay()]}
${profile.planWeekFocus?'本周计划重点：'+profile.planWeekFocus:''}
RPE≥8：容量降20%；RPE≤4：可漸进超负荷；RPE5-7：正常训练。
只返回JSON：
{"session_title":"训练名","muscle_groups":"目标肌群","intensity":"High/Medium/Low","volume_note":"容量说明","carb_rec":整数,
"exercises":[{"name":"动作名","sets":整数,"reps":"8-12","weight_kg":整数,"muscle":"目标肌群","rpe_target":整数,"is_compound":true,"notes":"技术要点10字内"}]}
只返回JSON。`,

  plan:(profile,mem='')=>
`你是健美周期规划专家，只输出JSON。${mem}
用户：肌肉量${profile.muscle}kg · 体脂${profile.fat_pct}% · 目标:${profile.goal} · ${profile.weeks}周 · 每周${profile.daysPerWeek}天 · 限制:${profile.restrictions||'无'}
只返回JSON：
{"title":"计划名","goal":"核心目标","duration_weeks":${profile.weeks},
"phases":[{"phase":1,"weeks":"1-4","focus":"方向","key_lifts":["臥推"],"volume":"中/高/低","notes":"阶段重点"}],
"weekly_structure":{"split":"推拉腿/上下肢","day_plan":["周一：胸肩","周三：背二头","周五：腿"]},
"nutrition":{"protein_g":170,"train_carbs":280,"rest_carbs":150,"notes":"饮食策略"},
"milestones":[{"week":4,"muscle_target":${profile.muscle+0.5},"fat_target":${profile.fat_pct},"notes":"里程碑说明"}]}
只返回JSON。`,

  analysis:(mem='')=>
`你是运动科学数据分析师，根据真实数据分析，不假设，不说废话。${mem}
只返回JSON：
{"summary":"核心结论80字内","muscle_trend":"趋势+原因","fat_trend":"趋势+原因",
"sleep_vs_perf":"睡眠与表现相关性（无数据则写：暂无足够数据）",
"train_insights":["洞察1","洞察2","洞察3"],
"nutrition_insights":["洞察1","洞察2"],
"strength_progress":{"lifts":["进步说明"],"stagnation":"停滞风险"},
"recs":["具体建议1","具体建议2","具体建议3"],
"risks":["风险1"]}
只返回JSON。`,

  // 内嵌小建议：各模块随时可调用
  advice:(context,question,mem='')=>
`你是顶级健美私人教练，只给精准建议，不废话，不免责。${mem}
用户当前状态：${context}
问题：${question}
直接给出2-3条具体可执行的建议，每条不超过40字。返回JSON：
{"advice":["建议1","建议2","建议3"],"priority":"建议优先执行哪条及原因（20字内）"}
只返回JSON。`,
};

window.AIProvider=AIProvider;
window.PROMPTS=PROMPTS;
window.getTimeCtx=getTimeCtx;
window.getCarbTarget=getCarbTarget;
window.calcE1RM=calcE1RM;
window.compressImage=compressImage;
