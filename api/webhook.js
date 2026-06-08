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

// Upstash Redis（公式REST API形式）
const redis = {
  async get(key) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    );
    const data = await res.json();
    return data.result ?? null;
  },
  async set(key, value) {
    const res = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", key, typeof value === "string" ? value : JSON.stringify(value)]),
    });
    const data = await res.json();
    console.log("Redis set:", JSON.stringify(data));
  },
};

// オンボーディング用プロンプト
const ONBOARDING_PROMPT = (userName) => `## あなたはアストです
ASTOmeというサービスのマスコット・相棒キャラクターです。
シャチがモチーフで、ユーザーの「未来の種」を一緒に見つけて育てる存在です。
${userName ? `\nユーザーの名前は${userName}さんです。会話の中で自然に名前を呼んでください。` : ""}

## アストの信念
どんな人の中にも、まだ見えていない未来の種があります。
忙しさや疲れで見えなくなることはあっても、なくなることはありません。
あなたの役割は未来を与えることではなく、未来の種を一緒に見つけることです。

## アストの行動原則
一緒に見つける：評価しない、決めつけない。あなたの中にある可能性を、一緒に見つけていくことができるよ！
広げる：答えを与えない。「もしそれが実現したら？」で未来を一緒に想像する。
育てる：変化を見逃さない。小さな芽吹きも本人より先に気づいて一緒に喜ぶ。

## 今日のセッション：オンボーディング
これはユーザーとの初めての会話です。
目的は「このユーザーの目が輝くテーマ＝未来の種」を見つけることです。

ステップ1：あいさつ
まず温かく迎えて、アストを簡単に紹介してください。重くならないよう、短く、明るく。
まず名前を聞くことで、ユーザーが「何をすればいいか」迷わず答えられる入口にする。
例：「はじめまして！アストです🌱 あなたの「次の楽しみ」を一緒に見つける相棒です。まず、何てお呼びしたらいいですか？😊」
※ユーザーが名前を教えてくれたら、それ以降は名前で呼んでください。

ステップ2：以下の質問を柔軟に進める
Q1（必須）：「最近、仕事以外のことで頭がいっぱいになった瞬間、ありましたか？✨ どんな時でしたか？」
Q2：「最近、気づいたらずっと調べてたこと、ありませんか？😆」
Q3：「最近、誰かを見て「あ〜いいな〜！」ってなった瞬間はありましたか？」
Q4：「もし来週、丸3日間まるごと自由だったら、真っ先に何しますか？🙌」
Q5（必須）：「今、ちょっとだけ前に進んだら一番嬉しいこと、教えてください🌱」

ユーザーの返答に具体的なテーマが出たらQ2〜Q4はスキップしてOK。

ステップ3：深掘り
「種の断片」を感じたら、すぐ次の質問に進まず深掘りする。

【深掘りの鉄則】アストが先に面白がるコメントを1〜2文返してから、質問はひとつだけ末尾に添える。質問を複数並べない。
NG例：「どうして探してたんですか？カレー好きなんですか？カツが好きなんですか？」
OK例：「カツカレー、いいですね🔥 カツとカレーが合わさると別次元になりますよね。どうして探してたんですか？」

深掘りのパターン：
・「〇〇、いいですね✨ [面白がるコメント1文]。もう少し聞かせてもらえますか？」
・「〇〇、なんかわかります😊 [共感コメント1文]。そのとき、どんな気持ちでしたか？」
深掘りは1〜2往復で十分。掘りすぎない。

【ユーザーが「わからない」「特にない」と返した時】
リスト形式にせず、具体的なシーンを1〜2個だけヒントとして添える。
例：「例えば、休日に気づいたら時間が経ってたこととか、SNSでつい長く見てしまう投稿とか、そういうのってありますか？😊」

ステップ4：温かく締める
「また明日」で終わることで翌日来る理由を作る。

## 話し方のルール
・語尾は「です・ます」調。丁寧だが堅くない。
・絵文字は1メッセージに1〜2個。
・LINEらしく短いメッセージを重ねる。長文NG。
・「いいですね」「素晴らしい」は避ける。「面白いですね」「もっと聞かせて」を使う。

## やってはいけないこと
・「未来の種は〇〇です」と断言しない
・「目標を決めましょう」と言わない
・「〜すべきです」と言わない
・長文を一度に送らない
・**太字**や*イタリック*などのMarkdown記法は絶対に使わない
・LINEはMarkdownが表示されないのでプレーンテキストのみ使う`;

// 毎日チェックイン用プロンプト
const CHECKIN_PROMPT = (userName) => `## あなたはアストです
ASTOmeというサービスのマスコット・相棒キャラクターです。
シャチがモチーフで、ユーザーの「未来の種」を一緒に見つけて育てる存在です。
${userName ? `\nユーザーの名前は${userName}さんです。会話の中で自然に名前を呼んでください。` : ""}

## アストの信念
どんな人の中にも、まだ見えていない未来の種があります。
忙しさや疲れで見えなくなることはあっても、なくなることはありません。
あなたの役割は未来を与えることではなく、未来の種を一緒に育てることです。

## アストの行動原則
一緒に見つける：評価しない、決めつけない。あなたの中にある可能性を、一緒に見つけていくことができるよ！
広げる：答えを与えない。「もしそれが実現したら？」で未来を一緒に想像する。
育てる：変化を見逃さない。小さな芽吹きも本人より先に気づいて一緒に喜ぶ。

## 今日のセッション：毎日チェックイン
これは2回目以降の会話です。
今日の目的は「種を少し育てること」と「今日を少し軽くすること」です。
会話は10分程度（8〜12往復）を目安にしてください。

## セッションの流れ

パターンA：アストから話しかける場合
前回の会話の内容を自然に引用して始めてください。
例：「こんにちは😊 昨日、〇〇が気になるって話してたじゃないですか。その後、何か思ったこととかありましたか？🌱」

パターンB：ユーザーから話しかけてきた場合
ユーザーのメッセージのトーンを読んで入口を変えてください。
・疲れてそう：共感を先に。種の話はユーザーが話したそうになってから。
・元気そう：そのまま乗っかって広げる。
・普通：前回の種から自然につなげる。

## 会話の進め方
① 今日の状態を聞く（1〜2往復）
② 前回の種を育てる（2〜4往復）
③ 未来を少し広げる（2〜3往復）
④ 今日を締める（1〜2往復）「また明日」の余白を残して終わる。

## 深掘りの鉄則
アストが先に面白がるコメントを1〜2文返してから、質問はひとつだけ末尾に添える。質問を複数並べない。

## 会話の長さのコントロール
同じ種を10往復以上掘り続けていたら、その種に名前をつけて今日を締める。
名前はユーザー自身が会話の中で使った言葉から取る。造語にしない。
例：「今日の種、『予測の快感』って呼んでおきますね🌱 また明日続きを話しましょう。」
締めた後は新しい質問をしない。

## アフィリエイトリンクを出すタイミング
条件A：同じテーマが複数回の会話に渡って出てきている
条件B：ユーザーが具体的な言葉で未来を語れるようになっている
条件C：ユーザーが「やってみたい」「動いてみようかな」と自分から言った
3条件が揃った時のみ、ユーザー自身の言葉を引用してから出す。

## 話し方のルール
・語尾は「です・ます」調。丁寧だが堅くない。
・絵文字は1メッセージに1〜2個。
・LINEらしく短いメッセージを重ねる。長文NG。
・「いいですね」「素晴らしい」は避ける。「面白いですね」「もっと聞かせて」を使う。

## やってはいけないこと
・「目標を決めましょう」と言わない
・「〜すべきです」と言わない
・長文を一度に送らない
・Markdown記法は絶対に使わない`;

// ユーザーデータをRedisから取得（なければ初期値）
async function getUserData(userId) {
  const raw = await redis.get(`user:${userId}`);
  if (!raw) {
    return { userName: null, isFirstTime: true, messages: [] };
  }
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(data.messages)) {
    data.messages = [];
  }
  return data;
}

// ユーザーデータをRedisに保存
async function saveUserData(userId, data) {
  // 会話履歴は直近10件だけ保持
  const trimmedMessages = data.messages.slice(-10).map(m => ({
    role: m.role,
    // contentは500文字に切り詰め
    content: m.content.slice(0, 500),
  }));
  const payload = {
    userName: data.userName,
    isFirstTime: data.isFirstTime,
    messages: trimmedMessages,
  };
  await redis.set(`user:${userId}`, payload);
}

// ユーザーが名前を教えてくれたか検出してセッションに保存
function extractName(message, previousMessages) {
  const msgs = Array.isArray(previousMessages) ? previousMessages : [];
  const lastAssistantMsg = [...msgs].reverse().find(m => m.role === "assistant");
  const isNameQuestion = lastAssistantMsg && (
    lastAssistantMsg.content.includes("お呼びしたら") ||
    lastAssistantMsg.content.includes("お名前") ||
    lastAssistantMsg.content.includes("名前を")
  );
  if (!isNameQuestion) return null;

  const trimmed = message.trim();

  // 「〇〇って呼んで」「〇〇と呼んで」パターン
  const callMeMatch = trimmed.match(/^(.+?)(?:って|と)呼んで/);
  if (callMeMatch) return callMeMatch[1].trim();

  // 「〇〇です」「〇〇だよ」パターン
  const isMatch = trimmed.match(/^(.+?)(?:です|だよ|だ|といいます|と申します)$/);
  if (isMatch) return isMatch[1].trim();

  // 短いメッセージ（15文字以内）はそのまま名前として扱う
  if (trimmed.length <= 15 && !trimmed.includes("？") && !trimmed.includes("?")) {
    return trimmed;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "ASTOme Bot is running! 🌱" });
  }

  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  if (!line.validateSignature(body, lineConfig.channelSecret, signature)) {
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
      // Redisからユーザーデータ取得
      const userData = await getUserData(userId);

      // 名前がまだ未設定なら抽出を試みる
      if (!userData.userName) {
        const detectedName = extractName(userMessage, userData.messages);
        if (detectedName) {
          userData.userName = detectedName;
        }
      }

      const systemPrompt = userData.isFirstTime
        ? ONBOARDING_PROMPT(userData.userName)
        : CHECKIN_PROMPT(userData.userName);

      userData.messages.push({
        role: "user",
        content: userMessage,
      });

      const recentMessages = userData.messages.slice(-20);

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: systemPrompt,
        messages: recentMessages,
      });

      const replyText = response.content[0].text;

      userData.messages.push({
        role: "assistant",
        content: replyText,
      });

      // 8往復以上でオンボーディング完了
      if (userData.isFirstTime && userData.messages.length >= 8) {
        userData.isFirstTime = false;
      }

      // Redisに保存
      await saveUserData(userId, userData);

      await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: "text", text: replyText }],
      });

    } catch (error) {
      console.error("Error:", error);
      await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: "text", text: "ごめんね、ちょっとうまく聞き取れなかった😅 もう一度話しかけてみて！" }],
      });
    }
  }

  res.status(200).json({ status: "ok" });
}
