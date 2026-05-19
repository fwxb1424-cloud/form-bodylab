# FORM · Body Lab v3 — 部署指南

## Supabase SQL（全部貼入 SQL Editor 一次執行）

```sql
CREATE TABLE IF NOT EXISTS memories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('perm','mid','short','day')),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON memories FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS food_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text, protein_g numeric, carbs_g numeric, fat_g numeric, kcal numeric,
  time_tag text, from_photo boolean DEFAULT false,
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON food_logs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_title text, muscle_groups text, intensity text,
  volume numeric, exercises_json text, notes text, rpe integer,
  trained_at timestamptz DEFAULT now()
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON sessions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS strength_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  exercise_name text NOT NULL,
  weight_kg numeric, reps integer, sets integer, e1rm numeric,
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE strength_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON strength_logs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS sleep_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  duration_h numeric, quality integer CHECK (quality BETWEEN 1 AND 4), notes text,
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON sleep_logs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS body_stats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  muscle_kg numeric, fat_pct numeric,
  arm_cm numeric, waist_cm numeric, chest_cm numeric, thigh_cm numeric,
  recorded_at timestamptz DEFAULT now()
);
ALTER TABLE body_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON body_stats FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS macro_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text, goal text, duration_weeks integer,
  weekly_targets_json text, phase_json text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE macro_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON macro_plans FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS session_comparisons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_session_json text, actual_session_json text,
  divergence_pct integer, notes text,
  date timestamptz DEFAULT now()
);
ALTER TABLE session_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON session_comparisons FOR ALL USING (true) WITH CHECK (true);
```

## 部署步驟

1. **Supabase**：supabase.com → New Project → SQL Editor → 執行以上全部 SQL → 記下 Project URL + anon key
2. **GitHub**：新建 repo `form-bodylab` → 上傳 `public/` 資料夾 + `vercel.json`
3. **Vercel**：vercel.com → New Project → **根目录选整个 `form-bodylab` 文件夹**（不要只选 public，否则 `api/notify` 无效）→ Deploy
4. **iPhone**：Safari 打開 Vercel 網址 → 分享 → 加入主畫面

## 功能模組 v3

| 模組 | 新增功能 | AI |
|------|---------|-----|
| 飲食 | 依身高體重體脂自動算 P/F/C/熱量 · 今日飲食安排 · 碳水循環 | DeepSeek |
| 計劃 | 身體檔案（身高體重）· 長線周期 · 里程碑 · 訓練對比 | DeepSeek |
| 訓練 | 每個動作記錄實際重量/組數/次數 · 計劃 vs 實際容量對比 | DeepSeek |
| 形體 | 力量趨勢 E1RM 折線圖 · 睡眠記錄 · 睡眠 vs 表現圖 | — |
| 復盤 | 睡眠關聯分析 · 力量停滯預警 | Sonnet Long Context |
