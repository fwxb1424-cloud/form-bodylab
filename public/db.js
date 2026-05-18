/**
 * FORM · Body Lab — Data Layer v2
 */
class DB {
  constructor(url, key) { this.sb = supabase.createClient(url, key); }

  async init() {
    const { error } = await this.sb.from('memories').select('id').limit(1);
    if (error && error.code !== 'PGRST116') throw new Error('Supabase 連接失敗：' + error.message);
  }

  // ── MEMORIES ──────────────────────────────────────
  async getActiveMemories() {
    const { data, error } = await this.sb.from('memories').select('*')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });
    if (error) throw error; return data || [];
  }
  async addMemory(content, tier) {
    const { data, error } = await this.sb.from('memories')
      .insert({ content, tier, expires_at: this._tierExpiry(tier) }).select().single();
    if (error) throw error; return data;
  }
  async deleteMemory(id) { await this.sb.from('memories').delete().eq('id', id); }
  _tierExpiry(tier) {
    if (tier === 'perm') return null;
    const d = new Date();
    if (tier === 'mid')   d.setDate(d.getDate() + 28);
    if (tier === 'short') d.setDate(d.getDate() + 7);
    if (tier === 'day')   d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }

  // ── FOOD LOGS ─────────────────────────────────────
  async addFoodLog(e) {
    const { data, error } = await this.sb.from('food_logs')
      .insert({ ...e, logged_at: e.logged_at || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getTodayFoodLogs() {
    const today = new Date(); today.setHours(0,0,0,0);
    const { data, error } = await this.sb.from('food_logs').select('*')
      .gte('logged_at', today.toISOString()).order('logged_at', { ascending: false });
    if (error) throw error; return data || [];
  }
  async deleteFoodLog(id) { await this.sb.from('food_logs').delete().eq('id', id); }

  // ── SESSIONS ──────────────────────────────────────
  async addSession(s) {
    const { data, error } = await this.sb.from('sessions')
      .insert({ ...s, trained_at: s.trained_at || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getRecentSessions(days = 90) {
    const since = new Date(); since.setDate(since.getDate() - days);
    const { data, error } = await this.sb.from('sessions').select('*')
      .gte('trained_at', since.toISOString()).order('trained_at', { ascending: false });
    if (error) throw error; return data || [];
  }

  // ── STRENGTH LOGS ─────────────────────────────────
  async addStrengthLog(e) {
    const { data, error } = await this.sb.from('strength_logs')
      .insert({ ...e, logged_at: e.logged_at || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getStrengthHistory(name, limit = 16) {
    const { data, error } = await this.sb.from('strength_logs').select('*')
      .eq('exercise_name', name).order('logged_at', { ascending: false }).limit(limit);
    if (error) throw error; return (data || []).reverse();
  }
  async getStrengthExercises() {
    const { data } = await this.sb.from('strength_logs').select('exercise_name');
    return [...new Set((data || []).map(r => r.exercise_name))];
  }

  // ── SLEEP LOGS ────────────────────────────────────
  async addSleepLog(e) {
    const { data, error } = await this.sb.from('sleep_logs')
      .insert({ ...e, logged_at: e.logged_at || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getRecentSleepLogs(days = 30) {
    const since = new Date(); since.setDate(since.getDate() - days);
    const { data, error } = await this.sb.from('sleep_logs').select('*')
      .gte('logged_at', since.toISOString()).order('logged_at', { ascending: true });
    if (error) throw error; return data || [];
  }

  // ── BODY STATS ────────────────────────────────────
  async addBodyStat(s) {
    const { data, error } = await this.sb.from('body_stats')
      .insert({ ...s, recorded_at: s.recorded_at || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getBodyHistory(limit = 20) {
    const { data, error } = await this.sb.from('body_stats').select('*')
      .order('recorded_at', { ascending: false }).limit(limit);
    if (error) throw error; return (data || []).reverse();
  }

  // ── MACRO PLANS ───────────────────────────────────
  async savePlan(plan) {
    const { data, error } = await this.sb.from('macro_plans')
      .insert({ ...plan, created_at: new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getActivePlan() {
    const { data, error } = await this.sb.from('macro_plans').select('*')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error; return data;
  }

  // ── SESSION COMPARISONS ───────────────────────────
  async addComparison(e) {
    const { data, error } = await this.sb.from('session_comparisons')
      .insert({ ...e, date: e.date || new Date().toISOString() }).select().single();
    if (error) throw error; return data;
  }
  async getRecentComparisons(limit = 14) {
    const { data, error } = await this.sb.from('session_comparisons').select('*')
      .order('date', { ascending: false }).limit(limit);
    if (error) throw error; return (data || []).reverse();
  }

  // ── FULL EXPORT ───────────────────────────────────
  async exportForAnalysis(days = 90) {
    const iso = new Date(Date.now() - days * 86400000).toISOString();
    const [
      {data:foods},{data:sessions},{data:body},
      {data:strength},{data:sleep},{data:mems},{data:plans}
    ] = await Promise.all([
      this.sb.from('food_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('sessions').select('*').gte('trained_at',iso).order('trained_at'),
      this.sb.from('body_stats').select('*').gte('recorded_at',iso).order('recorded_at'),
      this.sb.from('strength_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('sleep_logs').select('*').gte('logged_at',iso).order('logged_at'),
      this.sb.from('memories').select('*').order('created_at',{ascending:false}).limit(30),
      this.sb.from('macro_plans').select('*').order('created_at',{ascending:false}).limit(1),
    ]);
    return {
      period_days: days, exported_at: new Date().toISOString(),
      food_logs: foods||[], sessions: sessions||[], body_stats: body||[],
      strength_logs: strength||[], sleep_logs: sleep||[],
      memories: mems||[], active_plan: plans?.[0]||null,
    };
  }
}
window.DB = DB;
