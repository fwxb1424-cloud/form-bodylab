/**
 * FORM · Body Lab — 每日推送
 * Vercel Cron Function: api/notify.js
 * 每晚 21:00 (UTC+8) 自动触发
 *
 * 需要在 Vercel 环境变量里设置：
 * SUPABASE_URL       = 你的 Supabase Project URL
 * SUPABASE_KEY       = 你的 Supabase service_role key（注意：这里用 service_role，不是 anon）
 * TELEGRAM_BOT_TOKEN = 你的 Telegram Bot Token
 * TELEGRAM_CHAT_ID   = 你的 Telegram Chat ID
 */

export const config = { runtime: 'edge' };

const PROTEIN_TARGET = 170;

export default async function handler(req) {
  // 验证是 Vercel Cron 触发（防止外部随意调用）
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const report = await buildDailyReport();
    await sendTelegram(report);
    return new Response(JSON.stringify({ ok: true, sent: report.slice(0, 80) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Notify error:', e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}

async function buildDailyReport() {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_KEY;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // 今日饮食
  const foodRes = await fetch(
    `${SB_URL}/rest/v1/food_logs?logged_at=gte.${todayISO}&select=protein_g,carbs_g,fat_g,kcal`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const foods = await foodRes.json();
  const protein = foods.reduce((a, f) => a + (f.protein_g || 0), 0);
  const kcal = foods.reduce((a, f) => a + (f.kcal || 0), 0);
  const gap = Math.max(0, PROTEIN_TARGET - protein);

  // 今日训练
  const sessRes = await fetch(
    `${SB_URL}/rest/v1/sessions?trained_at=gte.${todayISO}&select=volume,session_title&order=trained_at.desc&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const sessions = await sessRes.json();
  const session = sessions[0] || null;

  // 昨晚睡眠
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const sleepRes = await fetch(
    `${SB_URL}/rest/v1/sleep_logs?logged_at=gte.${yesterday.toISOString()}&logged_at=lt.${todayISO}&select=duration_h,quality&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const sleeps = await sleepRes.json();
  const sleep = sleeps[0] || null;

  // 体成分最新
  const bodyRes = await fetch(
    `${SB_URL}/rest/v1/body_stats?select=muscle_kg,fat_pct&order=recorded_at.desc&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const bodyStats = await bodyRes.json();
  const body = bodyStats[0] || { muscle_kg: 40.4, fat_pct: 17.8 };

  // 构建消息
  const hour = new Date().getHours();
  const lines = [];

  lines.push(`*FORM · 21:00 日报*`);
  lines.push(`📅 ${today.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}`);
  lines.push('');

  // 蛋白质状态
  if (gap <= 0) {
    lines.push(`✅ *蛋白质已达标* ${Math.round(protein)}g / ${PROTEIN_TARGET}g`);
  } else {
    lines.push(`⚠️ *蛋白质缺口 ${Math.round(gap)}g*`);
    lines.push(`   还差：${(gap / 30).toFixed(1)} 勺蛋白粉 或 ${Math.round(gap / 0.27)}g 瘦牛肉`);
  }

  lines.push(`🔥 热量：${Math.round(kcal)} kcal`);

  if (session) {
    lines.push(`💪 训练：${session.session_title} · 容量 ${Math.round(session.volume || 0)} kg·r`);
  } else {
    lines.push(`😴 今日未记录训练`);
  }

  if (sleep) {
    const qLabel = ['', '差', '一般', '良好', '极佳'];
    lines.push(`🛌 昨晚睡眠：${sleep.duration_h}h · ${qLabel[sleep.quality] || ''}`);
  }

  lines.push('');
  lines.push(`📊 肌肉量 ${body.muscle_kg}kg · 体脂 ${body.fat_pct}%`);

  // 补强建议
  if (gap > 0) {
    lines.push('');
    lines.push(`💡 *补强建议*：摄入 ${(gap / 30).toFixed(1)} 勺乳清蛋白（${Math.round(gap)}g 蛋白质）`);
  }

  return lines.join('\n');
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Telegram error: ${err.description}`);
  }
}
