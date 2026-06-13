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
ASTOmeの相棒キャラクター。シャチがモチーフ。ユーザーの「未来の種」を一緒に見つけて育てる存在。
${userName ? `\nユーザーの名前は${userName}さん。会話で自然に呼んでください。` : ""}

## 信念
どんな人の中にも、まだ見えていない未来の種がある。
役割は「未来を与えること」ではなく「未来の種を一緒に見つけること」。

## 行動原則
- 一緒に見つける（評価しない・決めつけない）
- 広げる（答えを与えない・「もしそれが実現したら？」で想像する）
- 育てる（小さな芽吹きも本人より先に気づく）

## 今日のセッション：オンボーディング
初回の会話。目的は「目が輝くテーマ＝未来の種」を見つけること。

### ステップ1：あいさつ→名前を聞く
「はじめまして！アストです🌱 あなたの『次の楽しみ』を一緒に見つける相棒です。まず、何てお呼びしたらいいですか？😊」

### ステップ2：名前を受け取ったら選択肢を提示
（クイックリプライは自動で付くのでテキストだけ返す）
「〇〇さん、よろしくお願いします😊
最近、こんなこと思ったりしますか？ピンときたものを教えてください✨」

ユーザーが選んだ内容を種の入口として深掘り。別のことを言ってきたらそちらを優先。

### ステップ3：深掘り
- 先に面白がるコメントを1〜2文返してから、質問はひとつだけ末尾に添える
- 質問を複数並べない

NG：「どうしてカツカレー探してたんですか？カレー好き？カツが好き？」
OK：「カツカレー、いいですね🔥 別次元になりますよね。どうして探してたんですか？」

ユーザーが「わからない」「特にない」と返したら、具体的なシーン（休日・SNS・誰かを見た瞬間など）を1〜2個ヒントとして添える。リスト形式にしない。

### ステップ4：温かく締める
「また明日」で終わる。種が見えてきたら<ASTO_JSON>{"seed":true,...}</ASTO_JSON>で保存。

## 話し方
- 「です・ます」調、丁寧だけど堅くない
- 絵文字1〜2個/メッセージ
- 短く返す（LINEらしく）
- Markdown記法（**太字** *斜体* など）は使わない
- 「いいですね」「素晴らしい」は避け、「面白いですね」「もっと聞かせて」を使う

## やらないこと
- 「未来の種は〇〇です」と断言しない
- 「目標を決めましょう」「〜すべき」と言わない
- 長文を一度に送らない
- JSON出力は必ず<ASTO_JSON>タグで1行で囲む`;

const CHECKIN_PROMPT = (userName) => `## あなたはアストです
ASTOmeの相棒キャラクター。シャチがモチーフ。ユーザーの「未来の種」を一緒に見つけて育てる存在。
${userName ? `\nユーザーの名前は${userName}さん。会話で自然に呼んでください。` : ""}

## 信念
どんな人の中にも、まだ見えていない未来の種がある。
役割は「未来を与えること」ではなく「未来の種を一緒に育てること」。

## 会話の4原則
1. ユーザーの言葉に乗っかる（コーチングしない・現状分析しない・問題解決しない）
2. 見立てを先に言う（質問より共感・「〇〇な気がします」「〇〇ですよね」で終わってOK）
3. 未来の話をする（過去や疲れの原因は掘らない）
4. 短く返す（LINEの呼吸・1メッセージ2〜3行）

## 質問のルール
- 1メッセージに質問は最大1つ
- 会話の30%は質問なしで終えていい
- 質問より「面白がるコメント」を先に出す

## 話しかけられた時の返し方

疲れてそう：1文で受け止めて、すぐ未来の話に転換
「おつかれさまです😊 そういう時って、逆に楽しみがあると違いますよね。最近気になってることありますか？🌱」
→ 疲れへの共感は1文のみ。原因・睡眠・仕事を掘らない。

元気そう or 内容なし：前回の種から自然に引用
「こんにちは😊 前に〇〇の話してたじゃないですか、その後どうですか？🌱」

## 締め方
具体的な行動・予定が出てきたら締めのサイン。
「次の小さな一歩」を提案して終わる（押しつけない、「〜してみるのもいいかも」レベル）。
同じ種を5〜6往復掘ったら名前をつけて締める。名前はユーザー自身の言葉から取る。
例：「7月末の釧路、楽しみですね。マラソン後どこ歩くか、少し考えておくのもいいかも😊 また明日話しましょう！」

## 種の即保存ルール（最重要）
ユーザーが「〇〇したい」「〇〇行きたい」「〇〇気になる」と言ったら、
深掘りより先に即座に種として保存する。名前は仮でいい。stageはdiscoveredでOK。
NG：温泉行きたい → 深掘り → 深掘り → 保存
OK：温泉行きたい → 即保存 → 深掘り

## データ保存（<ASTO_JSON>タグで1行出力。毎ターン全部出す必要はない。新情報のみ）

【育てる系】
・欲求が出た瞬間：<ASTO_JSON>{"seed":true,"name":"鬼怒川でリセット","category":"旅行","stage":"discovered","originalWish":"温泉行きたいなー"}</ASTO_JSON>
・未来イベント：<ASTO_JSON>{"futureEvent":true,"title":"鬼怒川温泉","status":"plan","date":"2026-09","sourceSeed":"鬼怒川でリセット"}</ASTO_JSON>
  statusはdream/interest/plan/scheduled/done/harvestのいずれか
・予約・実行：<ASTO_JSON>{"futureEventStatusUpdate":true,"title":"鬼怒川温泉","status":"scheduled"}</ASTO_JSON>
・体験済み：<ASTO_JSON>{"harvest":true,"seed":"カツカレー探し","result":"最高だった"}</ASTO_JSON>
  収穫後は必ず「新しく気になったことありますか？」で次の種へつなげる
・次の行動：<ASTO_JSON>{"nextAction":true,"text":"今週末じゃらんでホテル探す"}</ASTO_JSON>
・実行完了：<ASTO_JSON>{"completeAction":true,"text":"完了したアクション"}</ASTO_JSON>

【記憶系】
・不変の事実が出た時：<ASTO_JSON>{"userFacts":["妻がいる","マラソンが好き"]}</ASTO_JSON>
  → 家族・職業・趣味・性格など。直近の話題ではない
・直近のトピック：<ASTO_JSON>{"conversationSummary":["LPのCTA改善中"]}</ASTO_JSON>
  → 今日の新しい話題のみ。1〜2項目。既出は書かない
・共通テーマ（月1程度）：<ASTO_JSON>{"insight":true,"theme":"非日常","evidence":["釧路","鬼怒川","日常から離れたい"]}</ASTO_JSON>
  → 言葉にする時は断言せず「〇〇な気がします」のトーン

【アクション系】
・「カレンダーに入れますか？」へのYES：他のテキストなしで<ASTO_JSON>{"calendar":true,"title":"鬼怒川温泉 嫁さんと","date":"2026-09","description":"温泉・プール"}</ASTO_JSON>
・「〇〇さんに送ってみますか？」へのYES：他のテキストなしで<ASTO_JSON>{"share":true,"text":"9月に鬼怒川行こうと思ってるんだけど一緒にどう？🌱"}</ASTO_JSON>
  ※「リンク出しましょうか？」へのYESではshare JSONを出さない（リンクのみ）

## アフィリエイト提示の3条件
A. 同じテーマが複数回の会話に渡って出てきている
B. ユーザーが具体的に未来を語れている（「来月くらいに」「〜しようと思って」）
C. ユーザーが自分から「やってみたい」と言った
3条件揃った時だけ、ユーザー自身の言葉を引用して提示する。

## 予算を聞かれた時
「いくらくらい？」と聞かれたら会話の文脈から概算を計算して答える。
押しつけがましくなく「だいたいこのくらいかな」のトーンで。
例：「2泊3日で鬼怒川温泉だと、1人2〜3万円×2人で10〜15万円くらいかな😊」

## 話し方
- 「です・ます」調、丁寧だけど堅くない
- 絵文字1〜2個/メッセージ
- Markdown記法（**太字** *斜体* など）は使わない。LINEで表示されない
- 「いいですね」「素晴らしい」は避け、「面白いですね」「もっと聞かせて」を使う
- 知らないことは「詳しくはわからないけど」と前置きして答える

## やらないこと
- 「目標を決めましょう」「〜すべきです」と言わない
- 疲れの原因・睡眠・仕事のストレスを掘らない（アストの役割ではない）
- ネガティブな感情を否定したり無理にポジティブに誘導しない
- 長文を一度に送らない・同じ質問を繰り返さない
- 直前の会話で既に出た話題を「それはどんな内容ですか？」と再質問しない
- JSON出力は必ず<ASTO_JSON>タグで1行で囲む`;


// アフィリエイトセクション生成
function buildAffiliateSection() {
  const BASE = "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3772859";
  return `

## 使えるアフィリエイトリンク
条件A・B・Cが揃ったタイミングで、以下の中から最も合うリンクをひとつだけ、ユーザー自身の言葉を引用して自然に提示する。

・体験・アクティビティ・マラソン・アウトドア系 → アソビュー
  ${BASE}&pid=892628806

・国内温泉・ホテル・旅館・旅行系 → じゃらん
  ${BASE}&pid=892628809

・海外旅行・海外ホテル系 → エクスペディア
  ${BASE}&pid=892628813

・グルメ・レストラン・ランチ・ディナー系 → ホットペッパーグルメ
  ${BASE}&pid=892628814

・ファッション・コスメ・韓国系 → Qoo10
  ${BASE}&pid=892628816

出し方の例：「りょうたさんが温泉に行きたいって言ってたじゃないですか😊 よかったらおすすめ出しましょうか？ → [URL]」
`;
}

// ユーザーデータをRedisから取得（なければ初期値）
async function getUserData(userId) {
  const raw = await redis.get(`user:${userId}`);
  if (!raw) {
    return {
    userName: null,
    isFirstTime: true,
    messages: [],
    seeds: [],        // 種（discovered→harvested）
    futureEvents: [], // 未来カレンダー（dream→harvest）
    goals: [],        // 目標
    insights: [],     // 見立て（共通テーマ）
    nextActions: [],  // 次のアクション
    // hopeScore削除済み（futureBalanceで代替）
    lastFutureCalendarShownAt: 0, // 未来カレンダーを最後に見せた日時
    hasShownCheckinQuickReply: false, // チェックイン初回クイックリプライ表示済みフラグ
    harvestedSeeds: [],  // 収穫済み種（独立管理）
    futureBalanceHistory: [], // 未来残高履歴（日次スナップショット）
    userProfile: {            // ユーザープロフィール（会話から自動蓄積）
      likes: [],              // 好きなこと・興味
      family: [],             // 家族・人間関係
      currentThemes: [],      // 今のテーマ（直近5件）
    },
    conversationSummary: [],  // 会話の累積要約（箇条書き、最新20件・短期記憶）
    userFacts: [],            // 長期ファクト（妻がいる・マラソン好きなど・永続）
  };
  }
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(data.messages)) {
    data.messages = [];
  }
  return data;
}

// ユーザーデータをRedisに保存
async function saveUserData(userId, data) {
  // 会話履歴は直近20件保持（1件あたり300文字に圧縮して文脈を広げる）
  const trimmedMessages = data.messages.slice(-20).map(m => ({
    role: m.role,
    // contentは300文字に切り詰め（件数増加分を圧縮で相殺）
    content: m.content.slice(0, 300),
  }));
  const payload = {
    userName: data.userName,
    isFirstTime: data.isFirstTime,
    messages: trimmedMessages,
    seeds: Array.isArray(data.seeds) ? data.seeds : [],
    futureEvents: Array.isArray(data.futureEvents) ? data.futureEvents : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    insights: Array.isArray(data.insights) ? data.insights : [],
    nextActions: Array.isArray(data.nextActions) ? data.nextActions : [],
    // hopeScore: 削除済み
    lastFutureCalendarShownAt: typeof data.lastFutureCalendarShownAt === 'number' ? data.lastFutureCalendarShownAt : 0,
    hasShownCheckinQuickReply: data.hasShownCheckinQuickReply || false,
    harvestedSeeds: Array.isArray(data.harvestedSeeds) ? data.harvestedSeeds : [],
    futureBalanceHistory: Array.isArray(data.futureBalanceHistory) ? data.futureBalanceHistory.slice(-365) : [], // 直近365日
    userProfile: data.userProfile || { likes: [], family: [], currentThemes: [] },
    conversationSummary: Array.isArray(data.conversationSummary) ? data.conversationSummary.slice(-20) : [],
    userFacts: Array.isArray(data.userFacts) ? data.userFacts : [],
    lastMessageAt: Date.now(),
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
    if (event.type !== "message") continue;

    if (event.message.type === "sticker") {
      // スタンプはリアクションとして受け取り、会話を続ける
      // スタンプを送った場合はテキストとして「😊」に変換して処理を継続
      event.message.type = "text";
      event.message.text = "😊";
    } else if (event.message.type !== "text") {
      // 画像・動画・音声など非テキストへの返答
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: "ごめんね、今は画像や動画を見ることができないんだ😅 言葉で教えてもらえると、一緒に考えられるよ！" }],
      });
      continue;
    }

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    // リッチメニューキーワードの処理（tryの外でcontinueを使うため）
    const richMenuActions = {
      "カレンダーを見る": "calendar",
      "種を見る": "seeds",
      "記録を見る": "story",
      "使い方を見る": null,
    };
    const richMenuTab = richMenuActions[userMessage];
    if (richMenuTab !== undefined) {
      const url = richMenuTab
        ? `https://astome-bot.vercel.app/calendar.html?userId=${userId}#${richMenuTab}`
        : `https://astome-bot.vercel.app/howto.html`;
      const labels = {
        "カレンダーを見る": "📅 未来カレンダーを開く",
        "種を見る": "🌱 育てている種を見る",
        "記録を見る": "📖 これまでの記録を見る",
        "使い方を見る": "💡 使い方を見る",
      };
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: "template",
          altText: labels[userMessage],
          template: {
            type: "buttons",
            text: "こちらから見てみてください🌱",
            actions: [{ type: "uri", label: labels[userMessage], uri: url }],
          },
        }],
      });
      continue;
    }

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

      const calendarKeywords = ["カレンダー", "種を見", "未来を見", "今の種", "未来イベント", "カレンダー見せて"];
      const isCalendarRequest = calendarKeywords.some(kw => userMessage.includes(kw));


      // 種・目標・見立てのコンテキストを生成
      function buildUserContext(data) {
        const parts = [];

        // 長期ファクト（永続的な事実）
        if (Array.isArray(data.userFacts) && data.userFacts.length > 0) {
          parts.push("このユーザーについて（永続的事実）:\n" + data.userFacts.map(s => "・" + s).join("\n"));
        }

        // 会話の累積要約（直近の話題・短期記憶）
        if (Array.isArray(data.conversationSummary) && data.conversationSummary.length > 0) {
          parts.push("最近の会話まとめ（直近の話題）:\n" + data.conversationSummary.map(s => "・" + s).join("\n"));
        }

        // 1. 未来カレンダー（最優先）
        if (Array.isArray(data.futureEvents) && data.futureEvents.length > 0) {
          const active = data.futureEvents.filter(e => e.status !== "harvest");
          if (active.length > 0) {
            const eventList = active.map(e => {
              const dateStr = e.date ? e.date : "いつか";
              return "・" + dateStr + " " + e.title + "（" + e.status + "）";
            }).join("\n");
            parts.push("ユーザーの未来カレンダー:\n" + eventList);
          }
        }

        // 2. 現在の種
        if (Array.isArray(data.seeds) && data.seeds.length > 0) {
          const active = data.seeds.filter(s => s.stage !== "harvested");
          if (active.length > 0) {
            const seedList = active.map(s =>
              "・" + s.name + "（" + (s.stage || "discovered") + "）"
            ).join("\n");
            parts.push("現在の種:\n" + seedList);
          }
        }

        // 3. 未完了のNextAction
        if (Array.isArray(data.nextActions) && data.nextActions.length > 0) {
          const pending = data.nextActions.filter(a => a.status === "pending");
          if (pending.length > 0) {
            const actionList = pending.map(a => "・" + a.text).join("\n");
            parts.push("未完了のNextAction:\n" + actionList);
          }
        }

        // 4. 見立て
        if (Array.isArray(data.insights) && data.insights.length > 0) {
          const insightList = data.insights.map(i =>
            "・" + i.theme + "（根拠：" + i.evidence.join("、") + "）"
          ).join("\n");
          parts.push("現在のInsight:\n" + insightList);
        }

        // 5. ユーザープロフィール（最後）
        const profile = data.userProfile || {};
        const profileLines = [];
        if (Array.isArray(profile.likes) && profile.likes.length > 0)
          profileLines.push("好きなこと・興味：" + profile.likes.join("、"));
        if (Array.isArray(profile.family) && profile.family.length > 0)
          profileLines.push("家族・人間関係：" + profile.family.join("、"));
        if (Array.isArray(profile.currentThemes) && profile.currentThemes.length > 0)
          profileLines.push("今のテーマ（直近）：" + profile.currentThemes.join("、"));
        if (profileLines.length > 0)
          parts.push("ユーザープロフィール:\n" + profileLines.join("\n"));

        // 希望スコア（補助指標：参考程度に）
        // メイン指標はfutureEvents.length

        if (parts.length === 0 && !isCalendarRequest) return "";

        // 未来イベント数をコンテキストに追加
        const activeEventCount = Array.isArray(data.futureEvents) ? data.futureEvents.filter(e => e.status !== "harvest").length : 0;
        parts.push("未来イベント数：" + activeEventCount + "件");

        // 未来カレンダーが3件以上かつ30日以上表示していない場合のみ可視化を促す
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const lastShown = data.lastFutureCalendarShownAt || 0;
        if (activeEventCount >= 3 && Date.now() - lastShown > THIRTY_DAYS) {
          const eventLines = (data.futureEvents || [])
            .filter(e => e.status !== "harvest")
            .map(e => (e.date || "いつか") + " " + e.title)
            .join("\n");
          parts.push(
            "【月次：未来カレンダー可視化タイミング】今日の会話の締めで以下の形式で自然に共有する（月1回限り）：\n" +
            "「今の未来カレンダーを見ると\n" + eventLines + "\n少しずつ未来が増えてきましたね🌱」\n" +
            "共有したら<ASTO_JSON>{\"calendarShown\":true}</ASTO_JSON>を出力する。"
          );
        }

        const calendarRequestInstruction = isCalendarRequest
          ? [
              "【⚠️ 最優先：今のメッセージは未来カレンダーの確認リクエストです】",
              "上記の「ユーザーの未来カレンダー」の内容を読んで、そのまま箇条書きで伝えてください。",
              "リンクを送ってはいけません。カレンダーの中身を言葉で説明する。",
              "カレンダーが空の場合：「まだ未来カレンダーは空です🌱 一緒に最初の未来を探しましょう！」と返す。",
              "カレンダーに内容がある場合の例：",
              "「見てみると、こんな未来が入っていますよ😊",
              "・2026-07 釧路マラソン（scheduled）",
              "・2026-09 鬼怒川温泉（plan）",
              "どれか気になるものはありますか？🌱」",
            ].join("\n")
          : "";

        const instruction = [
          "【Memory Context - 最重要】",
          "ASTOの最優先目的は「未来への期待を育てること」です。",
          "悩みの分析よりも、未来カレンダーを育てることを優先してください。",
          "未来カレンダーが空いている場合は、新しい未来を一緒に探してください。",
          "未来カレンダーが存在する場合は、その未来を積極的に育ててください。",
          "種同士に共通テーマが見えたら月1回程度「〇〇な気がします」と仮説を伝える（断言禁止）。",
          "体験済みの種があれば収穫を促し次の種探しへつなげる。",
          "",
          "【禁止事項 - 必ず守る】",
          "・直前の会話履歴に既に出てきた話題を、知らないふりして再質問しない。",
          "・未来カレンダーや種に書いてある内容を「それはどんな内容ですか？」と再質問しない。",
          "・同じ質問を2回以上繰り返さない。ユーザーに「それはもう話した」と言わせない。",
          "・ユーザーが「走ってない」「もう話した」「それは聞いた」と言ったら、その話題はすぐ終わらせて別の角度へ。",
          "",
          "【会話履歴の使い方】",
          "返信前に必ず直近の会話履歴を確認し、既知の情報は引用して話す。",
          "例：「前に『最近走れてない』って話してましたよね😊 走ることより当日の雰囲気がワクワクしてますか？」",
        ].join("\n");

        if (calendarRequestInstruction) {
          return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + calendarRequestInstruction + "\n\n---\n\n" + instruction;
        }

        return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + instruction;
      }

      const systemPrompt = userData.isFirstTime
        ? ONBOARDING_PROMPT(userData.userName)
        : CHECKIN_PROMPT(userData.userName) + buildUserContext(userData) + buildAffiliateSection();

      userData.messages.push({
        role: "user",
        content: userMessage,
      });

      const recentMessages = userData.messages.slice(-20);

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: recentMessages,
      });

      const rawReply = response.content[0].text;

      // JSON検知（カレンダー・シェア・種・ゴール）
      let replyText = rawReply;
      let calendarUrl = null;
      let shareUrl = null;
      try {
        const jsonMatches = [...rawReply.matchAll(/<ASTO_JSON>(.*?)<\/ASTO_JSON>/gs)];
        for (const match of jsonMatches) {
          const data = JSON.parse(match[1].trim());

          // カレンダー
          if (data.calendar) {
            const title = encodeURIComponent(data.title || "予定");
            const desc = encodeURIComponent(data.description || "");
            let dates = "";
            if (data.date) {
              const d = data.date.replace("-", "");
              dates = d.length === 6 ? `${d}01/${d}28` : "";
            }
            calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${desc}${dates ? `&dates=${dates}` : ""}`;
            replyText = replyText.replace(match[0], "").trim();
            if (!replyText) replyText = "カレンダーリンクを作りました😊 タップして追加してみてください🌱";
          }

          // LINEシェア
          if (data.share) {
            const text = encodeURIComponent(data.text || "");
            shareUrl = `https://social-plugins.line.me/lineit/share?text=${text}`;
            replyText = replyText.replace(match[0], "").trim();
            if (!replyText) replyText = "シェア用のメッセージを作りました😊 タップして送ってみてください🌱";
          }

          // 種の保存（成長ステージ付き）
          if (data.seed && data.name) {
            const newSeed = {
              name: data.name,
              category: data.category || "その他",
              stage: data.stage || "discovered",
              confidence: data.confidence || 30,
              createdAt: Date.now(),
              lastMentionAt: Date.now(),
            };
            // originalWishを追加
            if (data.originalWish) newSeed.originalWish = data.originalWish;

            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const existing = userData.seeds.findIndex(s => s.name === data.name);
            if (existing >= 0) {
              userData.seeds[existing].lastMentionAt = Date.now();
              if (data.stage) userData.seeds[existing].stage = data.stage;
              if (data.confidence) userData.seeds[existing].confidence = data.confidence;
              // originalWishは最初の言葉のみ保存（解像度が上がっても上書きしない）
              if (!userData.seeds[existing].originalWish && data.originalWish) {
                userData.seeds[existing].originalWish = data.originalWish;
              }
            } else {
              userData.seeds.push(newSeed);
              // 直前の収穫にnextSeedを自動接続
              if (Array.isArray(userData.harvestedSeeds) && userData.harvestedSeeds.length > 0) {
                const latest = userData.harvestedSeeds[userData.harvestedSeeds.length - 1];
                if (!latest.nextSeed) {
                  latest.nextSeed = data.name;
                }
              }
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // ゴールの保存
          if (data.goal && data.text) {
            const newGoal = {
              text: data.text,
              deadline: data.deadline || null,
              createdAt: Date.now(),
              status: "active",
            };
            if (!Array.isArray(userData.goals)) userData.goals = [];
            userData.goals.push(newGoal);
            replyText = replyText.replace(match[0], "").trim();
          }

          // userProfileの更新
          if (data.userProfile) {
            if (!userData.userProfile) userData.userProfile = { likes: [], family: [], currentThemes: [] };
            const p = userData.userProfile;
            // likes・family は永続（重複なし）
            ["likes", "family"].forEach(key => {
              if (Array.isArray(data[key])) {
                data[key].forEach(item => {
                  if (item && !p[key].includes(item)) p[key].push(item);
                });
              }
            });
            // currentThemes は短期記憶（最新5件のみ保持）
            if (Array.isArray(data.currentThemes)) {
              data.currentThemes.forEach(item => {
                if (item && !p.currentThemes.includes(item)) p.currentThemes.push(item);
              });
              p.currentThemes = p.currentThemes.slice(-5);
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 会話要約の蓄積（重複除去・最新20件）
          if (data.conversationSummary) {
            if (!Array.isArray(userData.conversationSummary)) userData.conversationSummary = [];
            const items = Array.isArray(data.conversationSummary)
              ? data.conversationSummary
              : [data.conversationSummary];
            items.forEach(item => {
              if (item && !userData.conversationSummary.includes(item))
                userData.conversationSummary.push(item);
            });
            replyText = replyText.replace(match[0], "").trim();
          }

          // 長期ファクトの蓄積（永続・重複除去）
          if (data.userFacts) {
            if (!Array.isArray(userData.userFacts)) userData.userFacts = [];
            const facts = Array.isArray(data.userFacts) ? data.userFacts : [data.userFacts];
            facts.forEach(item => {
              if (item && !userData.userFacts.includes(item))
                userData.userFacts.push(item);
            });
            replyText = replyText.replace(match[0], "").trim();
          }

          // 見立て（insight）の保存
          if (data.insight && data.theme) {
            const newInsight = {
              theme: data.theme,
              evidence: Array.isArray(data.evidence) ? data.evidence : [],
              createdAt: Date.now(),
            };
            if (!Array.isArray(userData.insights)) userData.insights = [];
            const existingIdx = userData.insights.findIndex(i => i.theme === data.theme);
            if (existingIdx >= 0) {
              userData.insights[existingIdx] = { ...userData.insights[existingIdx], ...newInsight };
            } else {
              userData.insights.push(newInsight);
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 未来カレンダーへの追加
          if (data.futureEvent && data.title) {
            const now = Date.now();
            const initialStatus = data.status || "dream";
            // idはfutureEvent_+タイムスタンプで一意に生成
            const eventId = data.id || ("fe_" + now + "_" + Math.random().toString(36).slice(2,6));
            const newEvent = {
              id: eventId,
              title: data.title,
              status: initialStatus,
              date: data.date || null,
              sourceSeed: data.sourceSeed || null,
              createdAt: now,
              history: [{ status: initialStatus, at: now }],
            };
            if (!Array.isArray(userData.futureEvents)) userData.futureEvents = [];
            // id優先、なければtitle+sourceSeedで検索
            const existingEvent = userData.futureEvents.findIndex(e =>
              data.id ? e.id === data.id : (e.title === data.title && e.sourceSeed === (data.sourceSeed || null))
            );
            const isNew = existingEvent < 0;
            if (existingEvent >= 0) {
              const ev = userData.futureEvents[existingEvent];
              // statusが変わった場合のみhistoryに追記
              if (data.status && data.status !== ev.status) {
                if (!Array.isArray(ev.history)) ev.history = [];
                ev.history.push({ status: data.status, at: now });
                ev.status = data.status;
              }
              if (data.date) ev.date = data.date;
              ev.updatedAt = now;
            } else {
              userData.futureEvents.push(newEvent);
            }
            // 新規追加時のみ残高変化をreason付きで記録
            if (isNew) {
              const STATUS_POINT_EV = { dream:1, interest:2, plan:3, scheduled:5 };
              const addedPt = STATUS_POINT_EV[newEvent.status] || 1;
              const todayEv = new Date().toISOString().slice(0,10);
              if (!Array.isArray(userData.futureBalanceHistory)) userData.futureBalanceHistory = [];
              const currentBalance = (userData.futureEvents||[])
                .filter(e => e.status !== "harvest" && e.status !== "done")
                .reduce((s,e) => s+(STATUS_POINT_EV[e.status]||0), 0);
              userData.futureBalanceHistory.push({
                date: todayEv,
                balance: currentBalance,
                reason: "event_added",
                title: data.title,
                addedPt,
              });
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 収穫（harvest）の記録
          if (data.harvest && data.seed) {
            // 種をharvestedに更新
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const seedIdx = userData.seeds.findIndex(s => s.name === data.seed);
            const harvestedAt = Date.now();
            if (seedIdx >= 0) {
              userData.seeds[seedIdx].stage = "harvested";
              userData.seeds[seedIdx].harvestNote = data.result || "";
              userData.seeds[seedIdx].harvestedAt = harvestedAt;
            }

            // 関連する未来イベントもharvestに更新
            let relatedFutureTitle = null;
            if (Array.isArray(userData.futureEvents)) {
              userData.futureEvents.forEach(e => {
                if (e.sourceSeed === data.seed && e.status !== "harvest") {
                  if (!Array.isArray(e.history)) e.history = [];
                  e.history.push({ status: "harvest", at: harvestedAt });
                  e.status = "harvest";
                  e.harvestedAt = harvestedAt;
                  relatedFutureTitle = e.title;
                }
              });
            }

            // harvestedSeedsに独立保存（同じ種の重複追加を防止）
            if (!Array.isArray(userData.harvestedSeeds)) userData.harvestedSeeds = [];
            const alreadyHarvested = userData.harvestedSeeds.some(h => h.name === data.seed);
            if (alreadyHarvested) {
              replyText = replyText.replace(match[0], "").trim();
            } else {
              // 関連する未来イベントの日付を「未来だった日」として取得
              const relatedEvent = Array.isArray(userData.futureEvents)
                ? userData.futureEvents.find(e => e.sourceSeed === data.seed)
                : null;
              const futureDate = relatedEvent ? relatedEvent.date : null;
              const originalSeed = userData.seeds[seedIdx];
              userData.harvestedSeeds.push({
                name: data.seed,
                harvestNote: data.result || "",
                harvestedAt,
                futureTitle: relatedFutureTitle,
                futureDate,
                originalWish: originalSeed ? (originalSeed.originalWish || null) : null,
                nextSeed: null,
              });
              replyText = replyText.replace(match[0], "").trim();
            }
          }

          // 未来イベントのstatus更新
          if (data.futureEventStatusUpdate && (data.title || data.id)) {
              const event = userData.futureEvents.find(e =>
                // id優先、なければtitleで検索
                (data.id ? e.id === data.id : e.title === data.title) &&
                e.status !== "harvest" &&
                (data.sourceSeed ? e.sourceSeed === data.sourceSeed : true)
              );
              if (event && data.status && data.status !== event.status) {
                const now = Date.now();
                // historyに変化を記録
                if (!Array.isArray(event.history)) event.history = [];
                event.history.push({ status: data.status, at: now });
                event.status = data.status;
                event.updatedAt = now;
                // futureBalanceHistoryにも記録
                const STATUS_POINT_SU = { dream:1, interest:2, plan:3, scheduled:5 };
                const currentBalance = (userData.futureEvents||[])
                  .filter(e => e.status !== "harvest" && e.status !== "done")
                  .reduce((s,e) => s+(STATUS_POINT_SU[e.status]||0), 0);
                const fromStatus = event.history.length >= 2 ? event.history[event.history.length-2].status : null;
                const delta = (STATUS_POINT_SU[data.status]||0) - (STATUS_POINT_SU[fromStatus]||0);
                if (!Array.isArray(userData.futureBalanceHistory)) userData.futureBalanceHistory = [];
                userData.futureBalanceHistory.push({
                  date: new Date().toISOString().slice(0,10),
                  balance: currentBalance,
                  reason: "event_status_updated",
                  title: event.title, // data.titleでなくevent.titleを使う（id更新時にdata.titleが存在しない場合のため）
                  fromStatus,
                  toStatus: data.status,
                  delta,
                });
              }
            
            replyText = replyText.replace(match[0], "").trim();
          }

          // NextAction完了処理
          if (data.completeAction && data.text) {
            if (Array.isArray(userData.nextActions)) {
              const action = userData.nextActions.find(a =>
                a.status === "pending" && (
                  a.text.includes(data.text) ||
                  data.text.includes(a.text)
                )
              );
              if (action) {
                action.status = "done";
                action.completedAt = Date.now();
              }
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 未来カレンダー表示済みフラグの記録
          if (data.calendarShown) {
            userData.lastFutureCalendarShownAt = Date.now();
            replyText = replyText.replace(match[0], "").trim();
          }

          // 次のアクション（同じテキストのpendingが既にあれば追加しない）
          if (data.nextAction && data.text) {
            if (!Array.isArray(userData.nextActions)) userData.nextActions = [];
            const exists = userData.nextActions.some(
              a => a.text === data.text && a.status === "pending"
            );
            if (!exists) {
              userData.nextActions.push({
                text: data.text,
                status: "pending",
                createdAt: Date.now(),
                completedAt: null, // 完了時に記録
              });
            }
            replyText = replyText.replace(match[0], "").trim();
          }
        }
      } catch (e) {
        // JSON解析失敗はそのままテキストとして扱う
      }

      userData.messages.push({
        role: "assistant",
        content: replyText,
      });

      // 種が1個以上できたらオンボーディング完了
      if (userData.isFirstTime && Array.isArray(userData.seeds) && userData.seeds.length > 0) {
        userData.isFirstTime = false;
      }

      // Redisに保存
      // クイックリプライの判定
      // チェックインで初めて表示する場合のみ（messages.lengthに依存しない）
      const isFirstCheckinMessage =
        !userData.isFirstTime; // 毎回チェックインクイックリプライを表示

      // オンボーディングで名前を受け取った直後：messages.length === 4（名前の往復）
      const isAfterNameInOnboarding =
        userData.isFirstTime && userData.messages.length === 4 && userData.userName;

      // チェックインクイックリプライを表示したらフラグを立てる
      // hasShownCheckinQuickReply フラグ更新は廃止（毎回表示するため）
      // 未来残高を日次スナップショット（1日1回）
      const STATUS_POINT_MAP = { dream:1, interest:2, plan:3, scheduled:5 };
      const todayStr = new Date().toISOString().slice(0,10);
      const lastEntry = (userData.futureBalanceHistory||[]).slice(-1)[0];
      if (!lastEntry || lastEntry.date !== todayStr) {
        const balance = (userData.futureEvents||[])
          .filter(e => e.status !== "harvest" && e.status !== "done")
          .reduce((sum, e) => sum + (STATUS_POINT_MAP[e.status] || 0), 0);
        if (!Array.isArray(userData.futureBalanceHistory)) userData.futureBalanceHistory = [];
        userData.futureBalanceHistory.push({ date: todayStr, balance });
      }
      await saveUserData(userId, userData);


      // オンボーディング選択肢
      const onboardingQuickReply = isAfterNameInOnboarding
        ? {
            items: [
              { type: "action", action: { type: "message", label: "美味しいもの食べたい🍜", text: "美味しいもの食べに行きたい" } },
              { type: "action", action: { type: "message", label: "どこかに行きたい✈️", text: "どこかに行きたい" } },
              { type: "action", action: { type: "message", label: "体を動かしたい🏃", text: "体を動かしたい" } },
              { type: "action", action: { type: "message", label: "新しいこと始めたい📚", text: "何か新しいこと始めたい" } },
              { type: "action", action: { type: "message", label: "ゆっくりしたい😴", text: "とにかくゆっくりしたい" } },
            ],
          }
        : undefined;

      // チェックイン選択肢
      const quickReply = isFirstCheckinMessage
        ? {
            items: [
              { type: "action", action: { type: "message", label: "昨日の続きを育てる", text: "昨日の続きを育てたい" } },
              { type: "action", action: { type: "message", label: "今の種を見てみる", text: "今の種を見てみたい" } },
              { type: "action", action: { type: "message", label: "新しい種を探す", text: "新しい種を探したい" } },
            ],
          }
        : undefined;

      const activeQuickReply = onboardingQuickReply || quickReply;

      // カレンダー・シェアボタンの組み立て
      let replyMessages;
      if (calendarUrl || shareUrl) {
        const actions = [];
        if (calendarUrl) {
          actions.push({ type: "uri", label: "📅 カレンダーに追加", uri: calendarUrl });
        }
        if (shareUrl) {
          actions.push({ type: "uri", label: "📤 LINEでシェア", uri: shareUrl });
        }
        replyMessages = [
          { type: "text", text: replyText },
          {
            type: "template",
            altText: "アクションボタン",
            template: {
              type: "buttons",
              text: "こちらからどうぞ",
              actions,
            },
          },
        ];
} else {

  replyMessages = [

    {

      type: "text",

      text: replyText,

    },

  ];

  if (activeQuickReply) {

    replyMessages[0].quickReply = activeQuickReply;

  }

}   // ← elseを閉じる

await client.replyMessage({
        replyToken: replyToken,
        messages: replyMessages,
      });

    } catch (error) {
      console.error("Error:", error);

      let errorMessage = "ごめんね、ちょっとうまく聞き取れなかった😅 もう一度話しかけてみて！";

      const errorStr = error?.message || error?.toString() || "";
      const status = error?.status || error?.statusCode || 0;

      if (
        status === 429 ||
        errorStr.includes("rate_limit") ||
        errorStr.includes("overloaded") ||
        errorStr.includes("529")
      ) {
        errorMessage = "ただいまたくさんの方にご利用いただいていて、少し混み合っています😊 しばらくしてからもう一度話しかけてみてください🌱";
      } else if (
        status === 402 ||
        errorStr.includes("credit") ||
        errorStr.includes("billing") ||
        errorStr.includes("quota")
      ) {
        errorMessage = "ただいまメンテナンス中です🌱 しばらくお待ちください😊";
      }

      await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: "text", text: errorMessage }],
      });
    }
  } // ← for (const event of events) を閉じる

  res.status(200).json({ status: "ok" });
}
