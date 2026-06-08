# FORM · Body Lab

私人健美数据助手 · PWA · v4.3

---

## 文件结构

```
/
├── index.html          ← 主文件（原名 nutrition-ui.js，内容是完整HTML）
├── db.js               ← 数据层（Supabase 操作）
├── sync-store.js       ← 营养计算、队列锚点、补剂、档案
├── macros.js           ← 暂未使用（保留）
├── ai-provider.js      ← AI调用、训练草稿（未上传，保留原版）
├── icon-192.svg        ← PWA图标
├── icon-512.svg        ← PWA图标
├── manifest.json       ← PWA Manifest
├── vercel.json         ← Vercel部署配置（cron时间表）
└── api/
    └── notify.js       ← Telegram推送 Edge Function
```

> ⚠️ 注意文件名陷阱：上传的文件中 `index.html` 实际包含 `db.js` 内容，`nutrition-ui.js` 实际是主HTML文件。部署时以**文件内容**为准，不要被文件名误导。

---

## 快速部署

### 1. Supabase

新建项目后在 SQL Editor 执行：

```sql
CREATE TABLE IF NOT EXISTS memories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL, tier text NOT NULL CHECK (tier IN ('perm','mid','short','day')),
  expires_at timestamptz, created_at timestamptz DEFAULT now()
);
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON memories FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS food_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text, protein_g numeric, carbs_g numeric, fat_g numeric, kcal numeric,
  time_tag text, from_photo boolean DEFAULT false, logged_at timestamptz DEFAULT now()
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
  exercise_name text NOT NULL, weight_kg numeric, reps integer, sets integer, e1rm numeric,
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
  weight_kg numeric, muscle_kg numeric, fat_pct numeric,
  arm_cm numeric, waist_cm numeric, chest_cm numeric, thigh_cm numeric,
  recorded_at timestamptz DEFAULT now()
);
ALTER TABLE body_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON body_stats FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS macro_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text, goal text, duration_weeks integer,
  weekly_targets_json text, phase_json text, created_at timestamptz DEFAULT now()
);
ALTER TABLE macro_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON macro_plans FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS session_comparisons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_session_json text, actual_session_json text,
  divergence_pct integer, notes text, date timestamptz DEFAULT now()
);
ALTER TABLE session_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON session_comparisons FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS user_settings (
  id text PRIMARY KEY DEFAULT 'default',
  profile_json text, supps_json text, updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_settings' AND policyname='allow all') THEN
    CREATE POLICY "allow all" ON user_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

记下：**Project URL** 和 **anon key**

### 2. GitHub

新建仓库 `form-bodylab`，上传所有文件（保持根目录结构）。

### 3. Vercel

- New Project → 选仓库 → **Root Directory 选整个仓库根目录**（不要选 public 子目录）
- 添加环境变量：

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_KEY` | Supabase anon key |
| `TELEGRAM_BOT_TOKEN` | BotFather 给的 token |
| `TELEGRAM_CHAT_ID` | 你的 Telegram chat ID |
| `CRON_SECRET` | 自定义随机字符串（如 `abc123xyz`） |

- Deploy

### 4. iPhone 添加到主屏幕

Safari 打开 Vercel 域名 → 分享按钮 → 添加到主屏幕

> 主屏幕 App 和 Safari 的 `localStorage` **完全独立**。补剂打卡、队列锚点等存在 localStorage 的数据不跨端共享。云端数据（Supabase）两端都能看到。建议固定用主屏幕 App 打开。

---

## Telegram 推送时间表（北京时间）

| 时间 | 内容 | 触发条件 |
|------|------|---------|
| 07:55 | 起床提醒 | 仅有氧日 |
| 09:30 | 晨间简报 + 体重提醒 | 每天 |
| 12:30 | 午餐蛋白检查 + 补剂提醒 | 每天 |
| 19:30 | 练前餐提醒 | 仅力量日 |
| 22:30 | 训练后补给提醒 | 仅力量日 |
| 23:30 | 睡前收尾 + 睡前补剂提醒 | 每天 |
| 周日 22:00 | 本周复盘 | 每周 |

---

## 版本更新记录

### v4.3（当前）
- **[fix]** `foodId` 改用 `Date.now()+random()`，彻底解决刷新后 id 重置导致删除错误食物的 bug
- **[fix]** 概况页今日状态卡改用锚点推算训练类型（与计划页、Telegram 三端一致）
- **[fix]** 切换训练肌群前，若有已完成的组则弹出确认，防止误覆盖训练数据
- **[fix]** 补剂打卡每日自动重置（凌晨/跨夜解锁均触发），解决状态残留问题
- **[feat]** 时间感知提示覆盖全天所有时段（力量日/有氧日/休息日分别处理，含明日预告）
- **[feat]** 复盘页打开自动运行（当天只运行一次，不重复消耗 API）
- **[feat]** 常用食物长按弹出份量选择器（×0.5 / ×1 / ×1.5 / ×2，实时显示蛋白质和热量）

### v4.2
- **[feat]** 概况页周进展摘要卡：28天体重折线图（含线性趋势线）+ 三格数据看板（训练次数/蛋白达标天/平均睡眠）+ 自动评语
- **[feat]** 每个训练动作标题旁显示历史 PR badge（`PR 92.5kg`）
- **[feat]** 完成某组突破历史 PR 时：badge 变绿 + 手机振动 + toast 庆祝

### v4.1
- **[feat]** 完成一组自动弹出组间休息倒计时浮层（环形 SVG 倒计时，RPE≥8 给 120s，其余 90s）
- **[feat]** 概况页睡眠快录（填入/起床时间自动算时长，四表情质量快选，直接写 Supabase）
- **[feat]** 常用食物区块置顶到输入框正下方
- **[feat]** 今日打卡清单（睡眠/体重/补剂/训练/蛋白质，进度条，点击跳转对应操作）
- **[feat]** 执行看板今日格子可点击，弹出训练类型选择器，更新锚点并同步云端

### v4.0
- **[fix]** 队列锚点机制：不再靠 session 倒推训练类型（解决跳课漂移问题）
- **[fix]** `parseFood` AI 解析失败自动打开手动 fallback 表单
- **[fix]** `switchPlanPhase` 补全函数定义（之前只有调用没有实现）
- **[fix]** `checkStrengthStall` 改为动态检测所有有记录动作（替代硬编码3个名字）
- **[feat]** 训练完成后自动同步队列锚点到 Supabase（Telegram 服务端读此推算类型）
- **[feat]** boot 启动时从云端拉取锚点（跨设备一致性）
- **[feat]** 补剂新增 `time_slot` 字段（早/练前/睡前）
- **[feat]** `db.js` 新增 `getWeightTrendDays`、`getStallCandidates`、`saveQueueAnchor`

---

## 训练队列

```
push → pull → cardio → legs → shoulder → cardio → rest → (repeat)
推日   拉日   有氧+核心  腿日    肩日      有氧+核心  休息
```

队列锚点存于 `localStorage('form_queue_anchor')` 和 Supabase `user_settings.profile_json.queue_anchor`。

**手动调整今日**：计划页执行看板 → 点击今日格子 → 选择类型 → 自动更新锚点并云端同步。

---

## 营养计划（Cole · 减脂保肌期）

| 阶段 | 训练日 | 休息日 |
|------|--------|--------|
| Cut（W1–W8） | 2220kcal · P168 C220 F75 | 1950kcal · P168 C140 F80 |
| Recomp（W10–W17） | 2620kcal · P168 C275 F92 | 2450kcal · P168 C210 F92 |
| Bulk（W19–W28） | 2970kcal · P168 C335 F100 | 2650kcal · P168 C245 F100 |
| Deload | 2420kcal · P168 C255 F90 | 同训练日 |

切换阶段：计划页 → 阶段进度条右侧按钮，或 `localStorage.setItem('form_plan_phase', 'recomp')`

---

## localStorage 关键 Key

| Key | 说明 |
|-----|------|
| `form_queue_anchor` | 队列锚点 `{date, index}` |
| `form_plan_phase` | 当前阶段 `cut/recomp/bulk/deload` |
| `form_cycle_start` | 当前阶段开始时间 |
| `form_plan_mode` | `'0'` 关闭计划模式，使用动态计算 |
| `form_profile` | 身高体重等档案 |
| `form_supps` | 补剂列表 |
| `form_supps_date` | 补剂最后重置日期（每日重置用） |
| `form_last_weight` | 最近体重记录 `{weight_kg, ts, date}` |
| `form_last_sleep` | 最近睡眠记录 `{duration_h, bedtime, ts}` |
| `form_last_train_ts` | 最近训练完成时间戳 |
| `form_last_rev_run` | 复盘最后运行日期（防重复触发） |

---

## 常见问题

**概况页绿点变红**
→ Supabase 连接失败，检查 API Key 是否填写，或重新在设置页填入。

**Telegram 不推送**
→ 检查 Vercel 环境变量是否设置，`vercel.json` 是否正确（不含 `functions` 块、不含 `comment` 字段）。

**主屏幕 App 补剂/体重状态和 Safari 不一致**
→ 正常现象，localStorage 隔离。固定用一个入口。

**切换肌群后训练方案消失**
→ 正常，切换肌群会重新生成方案。如有未保存训练，会弹出确认提示。

**更新代码后新功能没出现**
→ 主屏幕 App 有缓存。Safari 打开同一地址 → 硬刷新（地址栏重新输入回车）→ 重新「添加到主屏幕」。
