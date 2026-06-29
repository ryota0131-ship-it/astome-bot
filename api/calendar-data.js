// api/calendar-data.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const r = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['GET', `user:${userId}`]),
    });

    const json = await r.json();

    // result → parse → { value: "..." } → .value → parse → 実際のデータ
    let raw = json.result ?? null;
    if (!raw) return res.status(200).json({ userName: null, futureEvents: [], seeds: [], harvestedSeeds: [], futureBalanceHistory: [], daily: null });

    // 1回目のparse
    if (typeof raw === 'string') raw = JSON.parse(raw);
    // { value: "..." } 形式の場合
    if (raw && typeof raw === 'object' && raw.value !== undefined) raw = raw.value;
    // 2回目のparse
    if (typeof raw === 'string') raw = JSON.parse(raw);

    return res.status(200).json({
      userName: raw.userName || null,
      futureEvents: raw.futureEvents || [],
      seeds: raw.seeds || [],
      harvestedSeeds: raw.harvestedSeeds || [],
      futureBalanceHistory: raw.futureBalanceHistory || [],
      daily: raw.daily || null,
    });
  } catch (e) {
    console.error('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
