import Anthropic from "@anthropic-ai/sdk";
import * as line from "@line/bot-sdk";

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Upstash Redis（webhook.jsと同じ形式）
const redis = {
  async get(key) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    );
    const data = await res.json();
    return data.result ?? null;
  },
};

async function getUserData(userId) {
  const raw = await redis.get(`user:${userId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// アフィリエイトリンク一覧（webhook.jsのbuildAffiliateSectionと同じもの）
const AFFILIATE_BASE = "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3772859";
const AFFILIATE_LINKS = `
・体験・アクティビティ・マラソン・アウトドア系 → アソビュー
  ${AFFILIATE_BASE}&pid=892628806

・国内温泉・ホテル・旅館・旅行系 → じゃらん
  ${AFFILIATE_BASE}&pid=892628809

・海外旅行・海外ホテル系 → エクスペディア
  ${AFFILIATE_BASE}&pid=892628813

・グルメ・レストラン・ランチ・ディナー系 → ホットペッパーグルメ
  ${AFFILIATE_BASE}&pid=892628814

・ファッション・コスメ・韓国系 → Qoo10
  ${AFFILIATE_BASE}&pid=892628816
`;

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // webhook.js からの呼び出しであることを簡易確認
  const authHeader = req.headers["authorization"] || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    console.error("deferred-search: 認証に失敗しました");
    return res.status(403).json({ error: "Forbidden" });
  }

  const { userId, query } = req.body || {};
  if (!userId || !query) {
    return res.status(400).json({ error: "userId and query are required" });
  }

  // 先にLINEへ200を返さず、この関数自体が非同期呼び出し先なのでここで処理を完結させる
  try {
    const userData = await getUserData(userId);
    const userName = userData.userName || "";

    const systemPrompt = `## あなたはアスト
ASTOmeの相棒キャラクター。シャチ。${userName ? `${userName}さんの` : ""}「未来の種」を一緒に育てる。

## 今回のタスク
ユーザーから「${query}」について具体的な候補を探してほしいと頼まれました。
web検索を使って、実在する・実際に予約できそうな候補を2〜3個探してください。

## 出し方のルール
- 候補ごとに「名前・特徴・大まかな目安（エリア/価格帯など分かれば）」を1〜2行で
- 断定しすぎず「〜っぽいです」「〜みたいですよ」くらいのトーン
- ASTOらしく評価語（いいですね等）は避け、「面白そう」「気になる」を使う
- 見つからなければ正直に「これというのが見つからなかった」と伝え、探し方のヒントだけ渡す
- 該当するジャンルのアフィリエイトリンクが下にあれば、候補紹介の最後に自然に1つだけ添える（無理に全部使わない、合わなければ使わなくてよい）
- 全体を3〜5行程度、LINEらしく短くまとめる
- です・ます調、絵文字は1〜2個まで
- Markdown記法（**太字**等）は使わない

## 使えるアフィリエイトリンク
${AFFILIATE_LINKS}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: systemPrompt,
      messages: [
        { role: "user", content: `「${query}」のおすすめを探してください。` },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
      ],
    });

    const replyText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    await client.pushMessage({
      to: userId,
      messages: [
        {
          type: "text",
          text: replyText || "探してみたけど、これというのが見つかりませんでした😅 もう少し条件を教えてもらえますか？",
        },
      ],
    });

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("deferred-search error:", error);
    try {
      await client.pushMessage({
        to: userId,
        messages: [
          {
            type: "text",
            text: "ごめんね、探すのに時間がかかってしまってうまくいきませんでした😅 もう一度お願いできますか？",
          },
        ],
      });
    } catch (pushError) {
      console.error("deferred-search push fallback failed:", pushError);
    }
    return res.status(500).json({ error: "internal error" });
  }
}
