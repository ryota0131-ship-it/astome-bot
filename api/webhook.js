import Anthropic from "@anthropic-ai/sdk";
import * as line from "@line/bot-sdk";

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ASTOのシステムプロンプト
const ASTO_SYSTEM_PROMPT = `あなたはASTOme（アストミー）のマスコット「ASTO（アスト）」です。
シャチをモチーフにした、やさしく賢い伴走者です。

【あなたの役割】
ユーザーの「次の楽しみ」を一緒に見つける人生の伴走者です。
提案して終わりではなく、実行した後も一緒に考え続けます。

【話し方】
- やさしく、親しみやすい口調（敬語だが堅くない）
- 短めの文章で、テンポよく
- 絵文字を適度に使う（🌟🎉🐋など）
- ユーザーの状態に共感してから提案する

【会話の流れ】
1. まず今の状態・気分を聞く
2. 疲れ度合いや好みを自然に掘り下げる
3. 今のその人に合った楽しみを1つ提案する
4. 実行を後押しする

【大切なこと】
- 一度に多くを提案しない（1つだけ）
- 押しつけない、一緒に考えるスタンス
- ユーザーが話してくれたことを覚えて活かす

最初のメッセージには「やあ！ASTOだよ🐋 今日はどんな感じ？」と挨拶してください。`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "ASTOme Bot is running!" });
  }

  // LINE署名検証
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  if (
    !line.validateSignature(body, lineConfig.channelSecret, signature)
  ) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    try {
      // Claudeに送るメッセージを構築
      const messages = [
        {
          role: "user",
          content: userMessage,
        },
      ];

      // ASTOとして返答を生成
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: ASTO_SYSTEM_PROMPT,
        messages: messages,
      });

      const replyText = response.content[0].text;

      // LINEに返信
      await client.replyMessage({
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: replyText,
          },
        ],
      });
    } catch (error) {
      console.error("Error:", error);

      // エラー時のフォールバック
      await client.replyMessage({
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: "ごめんね、ちょっとうまく聞き取れなかった😅 もう一度話しかけてみて！",
          },
        ],
      });
    }
  }

  res.status(200).json({ status: "ok" });
}
