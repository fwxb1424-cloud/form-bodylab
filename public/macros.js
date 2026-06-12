/**
 * FORM · Body Lab — Macro Targets Helper
 * macroTargets() 是核心桥接函数，从 sync-store.js 的 calcDailyTargets 获取今日目标
 * index.html 里多处调用此函数，因此单独放在 macros.js（最早加载）
 */

/**
 * 今日宏量目标（含热量）
 * @returns {{ protein: number, carbs: number, fat: number, kcal: number }}
 */
function macroTargets() {
  // 依赖 sync-store.js 里的函数
  if (typeof calcDailyTargets === 'function' && typeof loadProfile === 'function') {
    const isTrain = window.S ? window.S.isTrain : true;
    const p = loadProfile();
    return calcDailyTargets(p, isTrain);
  }
  // fallback：返回 cut 阶段训练日默认值
  return { protein: 168, carbs: 220, fat: 75, kcal: 2220 };
}

window.macroTargets = macroTargets;
