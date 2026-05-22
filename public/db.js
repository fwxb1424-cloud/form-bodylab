/**
 * FORM · Body Lab — Data Layer v3
 */
class DB {
  constructor(url,key){ this.sb=supabase.createClient(url,key); }
  async init(){
    const required=['memories','food_logs','sessions'];
    for(const t of required){
      const{error}=await this.sb.from(t).select('id').limit(1);
      if(error&&error.code!=='PGRST116')throw new Error('Supabase连接失败('+t+'): '+error.message);
    }
    const{error:usErr}=await this.sb.from('user_settings').select('id').limit(1);
    this.settingsTableOk=!usErr;
    if(usErr)console.warn('[db] user_settings 表未创建，档案仅存本机。请在 Supabase 执行 README 里「仅补 user_settings」那段 SQL。');
  }

  // USER SETTINGS（档案、补剂 — 换主屏幕/Safari 后仍能恢复）
  async getSettings(){
    const{data,error}=await this.sb.from('user_settings').select('*').eq('id','default').maybeSingle();
    if(error)throw error;
    return data;
  }
  async saveSettings(row){
    const{data,error}=await this.sb.from('user_settings').upsert({...row,id:'default',updated_at:new Date().toISOString()}).select().single();
    if(error)throw error;
    return data;
  }

  // MEMORIES
  async getActiveMemories(){ const{data,error}=await this.sb.from('memories').select('*').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at',{ascending:false}); if(error)throw error; return data||[]; }
  async addMemory(content,tier){ const{data,error}=await this.sb.from('memories').insert({content,tier,expires_at:this._exp(tier)}).select().single(); if(error)throw error; return data; }
  async deleteMemory(id){ await this.sb.from('memories').delete().eq('id',id); }
  _exp(tier){ if(tier==='perm')return null; const d=new Date(); if(tier==='mid')d.setDate(d.getDate()+28); if(tier==='short')d.setDate(d.getDate()+7); if(tier==='day')d.setHours(23,59,59,999); return d.toISOString(); }

  // FOOD LOGS
  async addFoodLog(e){ const{data,error}=await this.sb.from('food_logs').insert({...e,logged_at:e.logged_at||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getTodayFoodLogs(){ const t=new Date();t.setHours(0,0,0,0); const{data,error}=await this.sb.from('food_logs').select('*').gte('logged_at',t.toISOString()).order('logged_at',{ascending:false}); if(error)throw error; return data||[]; }
  async deleteFoodLog(id){ const{error}=await this.sb.from('food_logs').delete().eq('id',id); if(error)throw error; }
  async getFoodLogsByRange(from,to){ const{data,error}=await this.sb.from('food_logs').select('*').gte('logged_at',from).lte('logged_at',to).order('logged_at'); if(error)throw error; return data||[]; }

  // SESSIONS
  async addSession(s){ const{data,error}=await this.sb.from('sessions').insert({...s,trained_at:s.trained_at||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async updateSession(id,patch){ const{data,error}=await this.sb.from('sessions').update(patch).eq('id',id).select().single(); if(error)throw error; return data; }
  async getRecentSessions(days=90){ const since=new Date();since.setDate(since.getDate()-days); const{data,error}=await this.sb.from('sessions').select('*').gte('trained_at',since.toISOString()).order('trained_at',{ascending:false}); if(error)throw error; return data||[]; }
  async getSessionsByRange(from,to){ const{data,error}=await this.sb.from('sessions').select('*').gte('trained_at',from).lte('trained_at',to).order('trained_at'); if(error)throw error; return data||[]; }
  async getLatestSessionOnDay(fromISO,toISO){ const{data,error}=await this.sb.from('sessions').select('*').gte('trained_at',fromISO).lte('trained_at',toISO).order('trained_at',{ascending:false}).limit(1).maybeSingle(); if(error)throw error; return data; }

  // STRENGTH
  async addStrengthLog(e){ const{data,error}=await this.sb.from('strength_logs').insert({...e,logged_at:e.logged_at||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getStrengthHistory(name,limit=16){ const{data,error}=await this.sb.from('strength_logs').select('*').eq('exercise_name',name).order('logged_at',{ascending:false}).limit(limit); if(error)throw error; return(data||[]).reverse(); }

  // SLEEP
  async addSleepLog(e){ const{data,error}=await this.sb.from('sleep_logs').insert({...e,logged_at:e.logged_at||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getRecentSleepLogs(days=14){ const since=new Date();since.setDate(since.getDate()-days); const{data,error}=await this.sb.from('sleep_logs').select('*').gte('logged_at',since.toISOString()).order('logged_at',{ascending:true}); if(error)throw error; return data||[]; }
  async getSleepByRange(from,to){ const{data,error}=await this.sb.from('sleep_logs').select('*').gte('logged_at',from).lte('logged_at',to).order('logged_at'); if(error)throw error; return data||[]; }

  // BODY STATS
  async addBodyStat(s){ const{data,error}=await this.sb.from('body_stats').insert({...s,recorded_at:s.recorded_at||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getBodyHistory(limit=20){ const{data,error}=await this.sb.from('body_stats').select('*').order('recorded_at',{ascending:false}).limit(limit); if(error)throw error; return(data||[]).reverse(); }
  async getLatestBodyStat(){
    const{data,error}=await this.sb.from('body_stats').select('*').order('recorded_at',{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    return data;
  }

  // MACRO PLANS
  async savePlan(plan){ const{data,error}=await this.sb.from('macro_plans').insert({...plan,created_at:new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getActivePlan(){ const{data,error}=await this.sb.from('macro_plans').select('*').order('created_at',{ascending:false}).limit(1).maybeSingle(); if(error)throw error; return data; }

  // SESSION COMPARISONS
  async addComparison(e){ const{data,error}=await this.sb.from('session_comparisons').insert({...e,date:e.date||new Date().toISOString()}).select().single(); if(error)throw error; return data; }
  async getRecentComparisons(limit=14){ const{data,error}=await this.sb.from('session_comparisons').select('*').order('date',{ascending:false}).limit(limit); if(error)throw error; return(data||[]).reverse(); }

  // FULL EXPORT
  async exportForAnalysis(days=90){
    const iso=new Date(Date.now()-days*864e5).toISOString();
    const[{data:f},{data:s},{data:b},{data:st},{data:sl},{data:m},{data:p}]=await Promise.all([
      this.sb.from('food_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('sessions').select('*').gte('trained_at',iso).order('trained_at'),
      this.sb.from('body_stats').select('*').gte('recorded_at',iso).order('recorded_at'),
      this.sb.from('strength_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('sleep_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('memories').select('*').order('created_at',{ascending:false}).limit(30),
      this.sb.from('macro_plans').select('*').order('created_at',{ascending:false}).limit(1),
    ]);
    return{period_days:days,exported_at:new Date().toISOString(),food_logs:f||[],sessions:s||[],body_stats:b||[],strength_logs:st||[],sleep_logs:sl||[],memories:m||[],active_plan:p?.[0]||null};
  }

  // RANGE EXPORT FOR SHORT REVIEW
  async exportRange(fromISO, toISO){
    const[{data:f},{data:s},{data:sl},{data:b}]=await Promise.all([
      this.sb.from('food_logs').select('*').gte('logged_at',fromISO).lte('logged_at',toISO).order('logged_at'),
      this.sb.from('sessions').select('*').gte('trained_at',fromISO).lte('trained_at',toISO).order('trained_at'),
      this.sb.from('sleep_logs').select('*').gte('logged_at',fromISO).lte('logged_at',toISO).order('logged_at'),
      this.sb.from('body_stats').select('*').gte('recorded_at',fromISO).lte('recorded_at',toISO).order('recorded_at'),
    ]);
    return{food_logs:f||[],sessions:s||[],sleep_logs:sl||[],body_stats:b||[]};
  }
}
window.DB = DB;
