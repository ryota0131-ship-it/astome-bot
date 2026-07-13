// api/lifecard-edit.js
// 人生のカードの「糸」をユーザー本人が直接編集するためのエンドポイント。
// AIによる再生成は行わない（本人の言葉をそのまま反映する、静かな直し）。
// ASTOと会話して直したい場合は webhook.js 側のチェックイン会話（lifeCard再保存）を使う。
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { userId, threadId, label, past, future } = req.body || {};
  if (!userId || !threadId) {
    return res.status(400).json({ error: 'userId and threadId are required' });
  }

  try {
    // 現在のユーザーデータを取得（calendar-data.jsと同じ読み方）
    const r = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['GET', `user:${userId}`]),
    });
    const json = await r.json();
    let raw = json.result ?? null;
    if (!raw) return res.status(404).json({ error: 'user not found' });

    for (let i = 0; i < 3; i++) {
      if (typeof raw === 'string') { raw = JSON.parse(raw); continue; }
      if (raw && typeof raw === 'object' && raw.value !== undefined) { raw = raw.value; continue; }
      break;
    }
    if (typeof raw === 'string') raw = JSON.parse(raw);

    if (!raw.lifeCard || !Array.isArray(raw.lifeCard.threads)) {
      return res.status(404).json({ error: 'lifeCard not found' });
    }
    const idx = raw.lifeCard.threads.findIndex(t => t.id === threadId);
    if (idx < 0) return res.status(404).json({ error: 'thread not found' });

    // 本人の直接入力だけを反映する（未指定のフィールドは変更しない）
    if (typeof label === 'string' && label.trim()) raw.lifeCard.threads[idx].label = label.trim().slice(0, 60);
    if (typeof past === 'string') raw.lifeCard.threads[idx].past = past.trim().slice(0, 300);
    if (typeof future === 'string') raw.lifeCard.threads[idx].future = future.trim().slice(0, 300);
    raw.lifeCard.threads[idx].editedByUser = true;
    raw.lifeCard.lastGeneratedAt = Date.now();

    const setRes = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', `user:${userId}`, JSON.stringify(raw)]),
    });
    if (!setRes.ok) throw new Error('failed to save to redis');

    return res.status(200).json({ ok: true, thread: raw.lifeCard.threads[idx] });
  } catch (e) {
    console.error('lifecard-edit error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
