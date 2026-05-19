/**
 * FORM · Body Lab — Telegram 推送
 * Vercel Cron Function
 * 推送时间（UTC+8）：
 *   08:00 → 晨间提醒
 *   13:00 → 午间蛋白质检查
 *   21:00 → 今日核算 + 补强建议
 */

export const config = { runtime: 'edge' };

const PT = 170;

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const hour = parseInt(url.searchParams.get('hour') || new Date().getUTCHours().toString());
  // UTC+8: 0=8点, 5=13点, 13=21点
  const bjHour = (hour + 8) % 24;

  try {
    let msg;
    if (bjHour === 8) {
      msg = await buildMorningMsg();
    } else if (bjHour === 13) {
      msg = await buildNoonMsg();
    } else {
      msg = await buildEveningMsg();
    }
    await sendTG(msg);
    return new Response(JSON.stringify({ ok: true, bjHour, preview: msg.slice(0, 60) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}

// ── 数据读取工具 ──────────────────────────────────────
const SB = () => ({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY,
});

async function sbGet(table, query = '') {
  const { url, key } = SB();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return res.ok ? res.json() : [];
}

async function getTodayFood() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = await sbGet('food_logs', `logged_at=gte.${today.toISOString()}&select=protein_g,carbs_g,fat_g,kcal`);
  return {
    protein: rows.reduce((a, r) => a + (r.protein_g || 0), 0),
    carbs:   rows.reduce((a, r) => a + (r.carbs_g  || 0), 0),
    fat:     rows.reduce((a, r) => a + (r.fat_g    || 0), 0),
    kcal:    rows.reduce((a, r) => a + (r.kcal     || 0), 0),
    count:   rows.length,
  };
}

async function getTodaySession() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = await sbGet('sessions', `trained_at=gte.${today.toISOString()}&select=session_title,volume,muscle_groups,rpe&order=trained_at.desc&limit=1`);
  return rows[0] || null;
}

async function getLatestBody() {
  const rows = await sbGet('body_stats', `select=muscle_kg,fat_pct&order=recorded_at.desc&limit=1`);
  return rows[0] || { muscle_kg: 40.4, fat_pct: 17.8 };
}

async function getRecentSleep() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await sbGet('sleep_logs', `logged_at=gte.${since}&select=duration_h,quality`);
  if (!rows.length) return null;
  const avg = rows.reduce((a, r) => a + (r.duration_h || 7), 0) / rows.length;
  return { avg: avg.toFixed(1), count: rows.length };
}

async function getWeekSessions() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await sbGet('sessions', `trained_at=gte.${since}&select=volume,session_title`);
  return {
    count: rows.length,
    totalVol: rows.reduce((a, r) => a + (r.volume || 0), 0),
  };
}

// ── 08:00 晨间提醒 ────────────────────────────────────
async function buildMorningMsg() {
  const body = await getLatestBody();
  const sleep = await getRecentSleep();
  const week = await getWeekSessions();
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();

  const lines = [];
  lines.push(`*FORM · 早安* ☀️`);
  lines.push(`📅 星期${dayNames[today.getDay()]} ${today.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`);
  lines.push('');
  lines.push(`📊 当前成分：肌肉量 ${body.muscle_kg}kg · 体脂 ${body.fat_pct}%`);
  if (sleep) {
    lines.push(`🛌 近7天睡眠均值：${sleep.avg}h`);
    if (parseFloat(sleep.avg) < 6.5) lines.push(`   ⚠️ 睡眠不足，今日建议降低训练强度`);
  }
  lines.push('');
  lines.push(`💪 本周已训练 ${week.count} 天 · 总容量 ${Math.round(week.totalVol / 1000)}k kg·r`);
  lines.push('');
  lines.push(`📌 今日目标：蛋白质 ≥ ${PT}g · 记录每餐摄入`);
  lines.push(`🔗 打开记录：打开 FORM App`);

  return lines.join('\n');
}

// ── 13:00 午间检查 ────────────────────────────────────
async function buildNoonMsg() {
  const food = await getTodayFood();
  const gap = Math.max(0, PT - food.protein);
  const lines = [];

  lines.push(`*FORM · 午间蛋白质检查* 🥩`);
  lines.push('');

  if (food.count === 0) {
    lines.push(`⚠️ 今日尚未记录任何饮食`);
    lines.push(`提醒：打开 App 记录午餐摄入`);
  } else if (gap > 80) {
    lines.push(`📊 截至现在：蛋白质 ${Math.round(food.protein)}g / ${PT}g`);
    lines.push(`⚠️ 还差 *${Math.round(gap)}g*，午餐需要重点补足`);
    lines.push(`💡 建议：${(gap / 2 / 30).toFixed(1)} 勺蛋白粉 + ${Math.round(gap / 2 / 0.27)}g 瘦肉`);
  } else if (gap > 0) {
    lines.push(`✅ 进度不错：蛋白质 ${Math.round(food.protein)}g / ${PT}g`);
    lines.push(`还差 ${Math.round(gap)}g，晚餐前补足即可`);
  } else {
    lines.push(`🎉 蛋白质已达标！${Math.round(food.protein)}g / ${PT}g`);
    lines.push(`热量：${Math.round(food.kcal)} kcal · 碳水：${Math.round(food.carbs)}g`);
  }

  return lines.join('\n');
}

// ── 21:00 今日核算 ────────────────────────────────────
async function buildEveningMsg() {
  const food = await getTodayFood();
  const session = await getTodaySession();
  const body = await getLatestBody();
  const gap = Math.max(0, PT - food.protein);

  const lines = [];
  lines.push(`*FORM · 21:00 今日核算* 📋`);
  lines.push(`${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}`);
  lines.push('');

  // 蛋白质
  if (gap <= 0) {
    lines.push(`✅ *蛋白质达标* ${Math.round(food.protein)}g / ${PT}g`);
  } else {
    lines.push(`⚠️ *蛋白质缺口 ${Math.round(gap)}g*`);
    lines.push(`   补救：${(gap / 30).toFixed(1)} 勺蛋白粉 或 ${Math.round(gap / 0.27)}g 瘦牛肉`);
  }

  lines.push(`🔥 热量：${Math.round(food.kcal)} kcal · 碳水：${Math.round(food.carbs)}g · 脂肪：${Math.round(food.fat)}g`);
  lines.push('');

  // 训练
  if (session) {
    lines.push(`💪 *今日训练完成*`);
    lines.push(`   ${session.session_title} · 容量 ${Math.round(session.volume || 0)} kg·r · RPE ${session.rpe}`);
  } else {
    lines.push(`😴 今日未记录训练`);
  }

  lines.push('');
  lines.push(`📊 当前：肌肉量 ${body.muscle_kg}kg · 体脂 ${body.fat_pct}%`);

  // 睡眠建议
  const now = new Date();
  const hoursToMidnight = 24 - now.getHours();
  if (hoursToMidnight <= 3) {
    lines.push('');
    lines.push(`🌙 建议 23:00 前入睡，保证 7-8h 睡眠`);
  }

  // 明日提示
  if (gap <= 0 && session) {
    lines.push('');
    lines.push(`⭐ 今日表现优秀，明日继续保持！`);
  }

  return lines.join('\n');
}

// ── 发送 Telegram ─────────────────────────────────────
async function sendTG(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TG环境变量未设置');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`TG错误: ${e.description || res.status}`);
  }
}
