// lib/generate-weekend-suggest.js
// 木曜夜の「週末提案」プッシュメッセージを生成する
// 軽量モデル（Haiku）で生成し、コストを最小化（generate-daily.jsと同じ作法）

export async function generateWeekendSuggest(userData, candidateSeeds) {
  const name = userData.userName || 'あなた';
  const seeds = Array.isArray(candidateSeeds) ? candidateSeeds : [];
  if (seeds.length === 0) return null;

  const seedLines = seeds
    .map(s => `・${s.name}${s.originalWish ? `（本人の言葉：「${s.originalWish}」）` : ''}`)
    .join('\n');

  const prompt = `あなたはアスト。ASTOmeの相棒キャラクター（シャチ）。
これから${name}さんに木曜夜の「週末提案」プッシュメッセージを送ります。

## 信念
評価しない・決めつけない・答えを与えない・診断しない。

## 対象の種（discovered状態、直近のもの。最大2件）
${seedLines}

## 厳守ルール
- 全体で2〜3行のみ
- 質問は最後に1つだけ（Yes/Noか、番号選択で答えられる形）
- Markdown記号は使わない（LINEでそのまま表示されるため）
- 種が2件ある場合のみ①②の絵文字番号を使う（・や-などの記号は使わない）
- 「診断」に見える言い方は禁止。「〇〇さんに合いそう」ではなく、
  必ず本人の過去の発言（originalWish）を引用する形にする
- 前置き・挨拶は不要。本文のみを出力する

## 文言パターン（参考。丸写しせず、実際の種の内容に合わせて調整する）
1件の場合：
「${name}さん、そういえば前に『（originalWishの言葉）』って言ってましたよね🌱 今週末、まだ何もなければ行ってみません?」

2件の場合：
「今週末、どっちか気になりません? ①（種1） ②（種2） ピンとくる方だけ教えてください。」

以下のJSON形式で返してください。他の文字は一切不要。
{
  "message": "（本文のみ。上記ルールに従う）"
}`;

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
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = await res.json();
    const text = json.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return parsed.message || null;
  } catch (e) {
    console.error('generateWeekendSuggest error:', e);
    return null;
  }
}
