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

    const reqBody = JSON.stringify(['GET', `user:${userId}`]);
    console.log('Request body:', reqBody);
    const json = await r.json();
    console.log('Response result type:', typeof json.result, 'length:', String(json.result).length);

    // result → parse → { value: "..." } → .value → parse → 実際のデータ
    let raw = json.result ?? null;
    if (!raw) return res.status(200).json({ userName: null, futureEvents: [], seeds: [], harvestedSeeds: [], futureBalanceHistory: [], daily: null, lifeCard: { keywords: [], threads: [], lastGeneratedAt: 0 }, ayumi: { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 } });

    // 最大3回parseしてオブジェクトになるまで繰り返す
    for (let i = 0; i < 3; i++) {
      if (typeof raw === 'string') { raw = JSON.parse(raw); continue; }
      if (raw && typeof raw === 'object' && raw.value !== undefined) { raw = raw.value; continue; }
      break;
    }
    // まだstringなら最後にparse
    if (typeof raw === 'string') raw = JSON.parse(raw);

    // userNameがない場合はLINEプロフィールAPIから取得
    let userName = raw.userName || null;
    if (!userName && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
          headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          userName = profile.displayName || null;
        }
      } catch(e) { console.error('LINE profile error:', e.message); }
    }
    return res.status(200).json({
      userName: userName,
      futureEvents: raw.futureEvents || [],
      seeds: raw.seeds || [],
      harvestedSeeds: raw.harvestedSeeds || [],
      futureBalanceHistory: raw.futureBalanceHistory || [],
      daily: raw.daily || null,
      lifeCard: raw.lifeCard || { keywords: [], threads: [], lastGeneratedAt: 0 },
      ayumi: raw.ayumi || { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 },
    });
  } catch (e) {
    console.error('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
