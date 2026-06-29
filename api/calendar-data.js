// api/calendar-data.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const url = `${process.env.KV_REST_API_URL}/get/user:${encodeURIComponent(userId)}`;
    console.log('Fetching:', url);

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });

    const json = await r.json();
    console.log('Upstash response keys:', Object.keys(json));
    console.log('result type:', typeof json.result);
    console.log('result slice:', String(json.result).slice(0, 100));

    if (!json.result) {
      return res.status(200).json({ debug: 'no result', json });
    }

    const data = JSON.parse(json.result);
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
