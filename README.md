# FORM · Body Lab v3 — 部署指南

## Supabase SQL

### 第一次安装：整段贴入 SQL Editor 执行

若某张表已存在，可忽略；若报错 **`policy "allow all" already exists`**，说明旧表已建好，**不要重复跑整段**，改跑下面「仅补 user_settings」即可。

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

-- 个人设置（身高体重档案、补剂列表 — 主屏幕与 Safari 共用云端）
CREATE TABLE IF NOT EXISTS user_settings (
  id text PRIMARY KEY DEFAULT 'default',
  profile_json text,
  supps_json text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON user_settings FOR ALL USING (true) WITH CHECK (true);
```

### 若报错 policy already exists（只补新表）

旧表（memories、food_logs 等）已有策略时，**只执行这一段**：

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  id text PRIMARY KEY DEFAULT 'default',
  profile_json text,
  supps_json text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_settings' AND policyname = 'allow all'
  ) THEN
    CREATE POLICY "allow all" ON user_settings
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

执行成功后，在 Supabase → **Table Editor** 里应能看到 `user_settings` 表。

## 主屏幕（PWA）与数据说明

- **会丢的情况**：Safari 里打开的是本地文件或 A 网址，主屏幕添加的是 B 网址 — 不是同一个应用，本地 Key 和缓存不共享。
- **不会丢的情况**：Safari 与主屏幕都使用**同一个 https 部署地址**（如 `xxx.vercel.app`），并在主屏幕 App 里**再填一次 API Key**。饮食、训练、记忆、体测在 **Supabase 云端**，换入口后仍会拉回。
- 概况页顶部 **绿点「云端已连接」** 表示同步正常；红色请检查 Supabase SQL 是否全部执行。

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
