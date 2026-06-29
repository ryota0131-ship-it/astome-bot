// lib/generate-daily.js
// ユーザーデータを受け取り、今日のdailyメッセージを生成して返す
// 軽量モデル（Haiku）で生成し、コストを最小化

export async function generateDaily(userData) {
  const today = new Date().toISOString().slice(0, 10);

  // すでに今日のdailyがあればスキップ
  if (userData.daily && userData.daily.date === today) {
    return null; // 変更なし
  }

  // 未来イベントと種のサマリーを作成
  const events = (userData.futureEvents || [])
    .filter(e => e.status !== 'harvest')
    .slice(0, 5)
    .map(e => `・${e.title}（${e.status}）${e.closingMessage ? ' → ' + e.closingMessage : ''}`)
    .join('\n');

  const seeds = (userData.seeds || [])
    .filter(s => s.stage !== 'harvested')
    .slice(0, 5)
    .map(s => `・${s.name}（${s.stage}）${s.astoMessage ? ' → ' + s.astoMessage : ''}`)
    .join('\n');

  if (!events && !seeds) return null;

  const name = userData.userName || 'あなた';

  const prompt = `あなたはASTOというシャチのキャラクターで、${name}さんの未来の相棒です。
${name}さんの今の状況：

【育ててる未来】
${events || 'なし'}

【育ててる種】
${seeds || 'なし'}

以下をJSON形式で返してください。他の文字は一切不要。

{
  "heroMessage": "未来全体を見渡した上で、今日だけの一言。2〜3文。${name}さんに語りかける口調。楽しみや前向きな気持ちを引き出す言葉。",
  "futureCardMessages": {
    "<futureEventのtitle>": "その未来だけへの今日の一言。10〜20文字。毎日少し違う角度から。"
  }
}

条件：
- heroMessageは未来を全体的に眺めた感想。特定の未来だけに絞らない。
- futureCardMessagesは各未来ごとに、今日だけの視点で一言。昨日と違う角度から。
- 絵文字を1つだけ末尾に使う。
- 「〜ですね」「〜ましょう」より「〜だね」「〜してるね」の話し言葉で。`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 軽量モデルで生成
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = await res.json();
    const text = json.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      date: today,
      heroMessage: parsed.heroMessage || null,
      futureCardMessages: parsed.futureCardMessages || {},
    };
  } catch (e) {
    console.error('generateDaily error:', e);
    return null;
  }
}
