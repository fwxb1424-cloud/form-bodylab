# FORM Body Lab — iOS 捷径配置指南

三个捷径全部在 **iOS 捷径 App** 里新建，不需要 Scriptable。

---

## 准备工作

你需要这三个 Key：

| Key | 在哪找 |
|-----|--------|
| Supabase URL | `https://urduzohozghrfgwsvamy.supabase.co` |
| Supabase Anon Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`（你的 JWT）|
| DeepSeek Key | DeepSeek 后台 → API Keys |
| Gemini Key | Google AI Studio → API Keys |

---

## ⚖️ 捷径一：体重快录

**用途**：点图标 → 输数字 → 体重写入 body_stats。3 秒完成。

### 步骤

| 序号 | 操作 | 参数 |
|------|------|------|
| 1 | 添加「**请求输入**」| 类型：**数字**，提示：`今日体重(kg)` |
| 2 | 添加「**获取 URL 内容**」| 见下方 |
| 3 | 添加「**显示通知**」| `✓ 体重已记录` |

**第 2 步详细：**
```
URL：
https://urduzohozghrfgwsvamy.supabase.co/rest/v1/body_stats

方法：POST

头部（每行一个）：
  apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZHV6b2hvemdocmZnd3N2YW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjcyMDQsImV4cCI6MjA5NDYwMzIwNH0.wSbZiY6rxd7jVrFD0EsaC0hIIbeP3UiacBlL7YFiZ50
  Content-Type: application/json
  Prefer: return=minimal

请求体（JSON）：
{"weight_kg": [输入]}
```

捷径详情 → 分享 → **添加到主屏幕** → 图标选 ⚖️

---

## 🍽️ 捷径二：文字快录

**用途**：说/打吃了什么 → DeepSeek 解析宏量 → 写入 food_logs。

### 步骤

| 序号 | 操作 | 参数 |
|------|------|------|
| 1 | 添加「**请求输入**」| 类型：文本，提示：`吃了什么？` |
| 2 | 添加「**获取 URL 内容**」→ 调用 DeepSeek | 见下方 |
| 3 | 添加「**从输入获取词典**」| 路径：`choices` → `第 1 项` → `message` → `content` |
| 4 | 添加「**替换文本**」| 查找：`` ```json `` 和 `` ``` ``（正则模式），替换为空 |
| 5 | 添加「**从输入获取词典**」| 得到 `name` `protein_g` `carbs_g` `fat_g` `kcal` |
| 6 | 添加「**显示提醒**」| 标题：`确认记录`，内容：`[name] · [protein_g]g蛋白 / [kcal]kcal`，加取消按钮 |
| 7 | 添加「**获取 URL 内容**」→ POST 到 Supabase | 见下方 |
| 8 | 添加「**显示通知**」| `✓ 已记录` |

**第 2 步详细（DeepSeek）：**
```
URL：https://api.deepseek.com/chat/completions
方法：POST
头部：
  Content-Type: application/json
  Authorization: Bearer <你的DeepSeek Key>

请求体（JSON）：
{
  "model": "deepseek-chat",
  "temperature": 0.2,
  "max_tokens": 300,
  "messages": [
    {"role": "system", "content": "你是运动营养解析引擎，只输出JSON不要markdown代码块。解析用户描述的食物，返回：{\"name\":\"食物名\",\"protein_g\":整数,\"carbs_g\":整数,\"fat_g\":整数,\"kcal\":整数}。去皮肉类脂肪明显低于带皮，要准确区分。只返回JSON。"},
    {"role": "user", "content": "[请求输入]"}
  ]
}
```

**第 7 步详细（写入 Supabase）：**
```
URL：https://urduzohozghrfgwsvamy.supabase.co/rest/v1/food_logs
方法：POST
头部：
  apikey: <同上>
  Authorization: Bearer <同上>
  Content-Type: application/json
  Prefer: return=minimal

请求体（JSON）：
{
  "name": "[name]",
  "protein_g": [protein_g],
  "carbs_g": [carbs_g],
  "fat_g": [fat_g],
  "kcal": [kcal],
  "time_tag": "quick_text"
}
```

添加到主屏 → 图标选 🍽️

---

## 📷 捷径三：拍照识别

**用途**：拍食物照片 → Gemini 视觉识别 → 写入 food_logs。

### 步骤

| 序号 | 操作 | 参数 |
|------|------|------|
| 1 | 添加「**拍照**」（或选取照片）| |
| 2 | 添加「**调整图像大小**」| 最长边 1024px |
| 3 | 添加「**Base64 编码**」| |
| 4 | 添加「**获取 URL 内容**」→ 调用 Gemini | 见下方 |
| 5 | 添加「**从输入获取词典**」| 路径：`candidates` → `第 1 项` → `content` → `parts` → `第 1 项` → `text` |
| 6 | 添加「**替换文本**」| 同文字快录，去代码块标记 |
| 7 | 添加「**从输入获取词典**」| 得到 `name` `protein_g` `carbs_g` `fat_g` `kcal` `confidence` |
| 8 | 添加「**显示提醒**」| 包含 confidence 确认 |
| 9 | 添加「**获取 URL 内容**」→ POST 到 Supabase | 同文字快录第 7 步，`time_tag` 写 `quick_photo` |
| 10 | 添加「**显示通知**」| `✓ 已记录` |

**第 4 步详细（Gemini）：**
```
URL：https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=<你的Gemini Key>
方法：POST
头部：Content-Type: application/json

请求体（JSON）：
{
  "contents": [{
    "parts": [
      {"inline_data": {"mime_type": "image/jpeg", "data": "[Base64编码]"} },
      {"text": "你是食物视觉识别引擎，只输出JSON不要markdown代码块。分析图片食物，返回：{\"name\":\"食物名\",\"protein_g\":整数,\"carbs_g\":整数,\"fat_g\":整数,\"kcal\":整数,\"confidence\":\"high/medium/low\"}"}
    ]
  }],
  "generationConfig": {"maxOutputTokens": 400, "temperature": 0.2}
}
```

添加到主屏 → 图标选 📷

---

## 主屏布局建议

```
┌──────────────────────────────┐
│                              │
│   ┌──────────────────────┐   │
│   │ 💪 推日 · 2220kcal    │   │  ← Scriptable 中号 Widget
│   │ 蛋白 ████░░ 134/168  │   │
│   │  85.2kg  7.2h  5/6   │   │
│   └──────────────────────┘   │
│                              │
│   ⚖️        🍽️        📷     │  ← 三个捷径图标
│  体重      文字       拍照    │
│                              │
│   [App 图标们...]             │
│                              │
└──────────────────────────────┘
```
