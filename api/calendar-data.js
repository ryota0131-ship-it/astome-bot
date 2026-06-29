// api/calendar-data.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

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

    // 最大3回parseしてオブジェクトになるまで繰り返す
    for (let i = 0; i < 3; i++) {
      if (typeof raw === 'string') { raw = JSON.parse(raw); continue; }
      if (raw && typeof raw === 'object' && raw.value !== undefined) { raw = raw.value; continue; }
      break;
    }
    // まだstringなら最後にparse
    if (typeof raw === 'string') raw = JSON.parse(raw);

    console.log('raw type after parse:', typeof raw);
    console.log('raw keys:', raw && typeof raw === 'object' ? Object.keys(raw).slice(0,5) : 'not object');
    console.log('returning userName:', raw && raw.userName);
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
