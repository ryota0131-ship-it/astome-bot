// api/calendar-data.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    // webhook.jsと同じPipeline形式でGET
    const r = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['GET', `user:${userId}`]),
    });

    const json = await r.json();
    console.log('Upstash response:', JSON.stringify(json).slice(0, 200));

    const raw = json.result ?? null;
    if (!raw) return res.status(200).json({ userName: null, futureEvents: [], seeds: [], harvestedSeeds: [], futureBalanceHistory: [], daily: null });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return res.status(200).json({
      userName: data.userName || null,
      futureEvents: data.futureEvents || [],
      seeds: data.seeds || [],
      harvestedSeeds: data.harvestedSeeds || [],
      futureBalanceHistory: data.futureBalanceHistory || [],
      daily: data.daily || null,
    });
  } catch (e) {
    console.error('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
