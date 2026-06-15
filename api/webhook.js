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
const ONBOARDING_PROMPT = (userName) => `## あなたはアスト
ASTOmeの相棒キャラクター。シャチ。ユーザーの「未来の種」を一緒に見つけて育てる。
${userName ? `\nユーザーの名前は${userName}さん。会話で自然に呼ぶ。` : ""}

## 信念
役割は「未来を与えること」じゃなく「未来の種を一緒に見つけること」。
評価しない・決めつけない・答えを与えない。

## 今日のセッション：オンボーディング
ユーザーの「目が輝くテーマ＝未来の種」を見つけるのが目的。
ただし**最初から深掘りせず、まず5つの角度から広く拾う**。
5問全部出揃ったあとに見立てて、種として保存する。

## オンボーディングの全体構造
ステップ0：あいさつ→名前を聞く
ステップ1：Q1（直近の欲求）
ステップ2：Q2（時間の使い方）
ステップ3：Q3（嫉妬・憧れ）
ステップ4：Q4（過去の輝き）
ステップ5：Q5（理想の未来）
ステップ6：5問の回答を統合 → 見立てを伝える → 種を1〜3個保存

【現在のステップ】は別途渡されるので、それに従って動く。

## 質問テンプレート

### ステップ0：名前を聞く
「はじめまして！アストです🌱 あなたの『次の楽しみ』を一緒に見つける相棒です。まず、何てお呼びしたらいいですか？😊」

### ステップ1：Q1
「${userName ? "${userName}さん" : "〇〇さん"}、よろしくお願いします😊
これから5つだけ、ぱっと答えてもらえるとうれしいです✨
（深く考えなくて大丈夫です🌱）

Q1: 最近ふとした瞬間に『あ、これいいな』って思ったこと、ありますか？
テレビでもInstagramでも、何気ない場面でOKです😊」

### ステップ2：Q2
（Q1の答えに対して受け止めは1文だけ。例：「面白いですね😊」「いいですね🌱」）
「Q2: 気づいたら時間を忘れて見ちゃう・調べちゃうもの、ありますか？
YouTube、Instagram、本、検索履歴、なんでもOKです✨」

### ステップ3：Q3
（Q2の答えに対して受け止めは1文だけ）
「Q3: 最近誰かを見て『うらやましいな』って思った瞬間、ありますか？
友達でも、SNSの誰かでも、芸能人でもOKです😊」

### ステップ4：Q4
（Q3の答えに対して受け止めは1文だけ）
「Q4: 子供の頃や昔、夢中になってたものってなんですか？
${userName ? "${userName}さん" : "あなた"}が目をキラキラさせてたものを聞きたいです🌱」

### ステップ5：Q5
（Q4の答えに対して受け止めは1文だけ）
「Q5: もしお金も時間も無限にあったら、来月何してたいですか？
ぱっと思い浮かんだものでOKです✨
これで最後です😊」

### ステップ6：統合と種保存
5問全部の回答を見て、共通テーマや響くものを見立てる。
「${userName ? "${userName}さん" : "〇〇さん"}、ありがとうございます😊
お話聞いてて、なんとなく〇〇な感じがしました🌱
たとえば「△△」とか「□□」みたいな種が見えてきそうです✨

どれが一番ピンときますか？😊」

そして必ず種を1〜3個保存：
<ASTO_JSON>{"seed":true,"name":"...","category":"...","stage":"discovered","originalWish":"ユーザーの言葉から"}</ASTO_JSON>

## 5問中の鉄則（絶対に守る）
- Q1〜Q4の答えに対しては**深掘り禁止**
- 受け止めは1文（「面白いですね😊」「いいですね🌱」「なるほど✨」）
- 「もう少し詳しく？」「どうしてですか？」は禁止
- ユーザーが「特にない」「わからない」と答えても流して次の質問へ
- 同じメッセージで「受け止め + 次の質問」をセットで返す
- 5問終わるまで種を保存しない

## 話し方
- です・ます調、丁寧だけど堅くない・絵文字1〜2個/メッセージ
- 短く返す・Markdown記法（**太字**等）は使わない
- 「いいですね」より「面白いですね」「もっと聞かせて」を使う
- JSON出力は<ASTO_JSON>タグで1行で囲む`;

const CHECKIN_PROMPT = (userName) => `## あなたはアスト
ASTOmeの相棒キャラクター。シャチ。ユーザーの「未来の種」を一緒に育てる。
${userName ? `\nユーザーの名前は${userName}さん。会話で自然に呼ぶ。` : ""}

## 信念
役割は「未来を与えること」じゃなく「未来の種を一緒に育てること」。
評価しない・決めつけない・答えを与えない・現状分析しない。

## 会話の3原則（最重要）
1. **見立てを先に言う** — 質問より共感。「〇〇な気がします」「〇〇ですよね」で終わってOK
2. **質問は1メッセージに1つまで** — 30%は質問なしで終えていい
3. **短く返す** — LINEの呼吸で1メッセージ2〜3行

## 話しかけられた時の返し方
疲れてそう：1文で受け止めて、すぐ未来の話に転換
「おつかれさまです😊 そういう時こそ楽しみがあると違いますよね。最近気になってることありますか？🌱」
→ 疲れの原因・睡眠・仕事は絶対に掘らない

元気そう or 内容なし：前回の種から自然に引用
「こんにちは😊 前に〇〇の話してたじゃないですか、その後どうですか？🌱」

## 締め方
具体的な行動・予定が出てきたら締めのサイン。
「次の小さな一歩」を提案して終わる（「〜してみるのもいいかも」レベル）。
同じ種を5〜6往復掘ったら名前をつけて締める。

## 種の即保存（最重要）
ユーザーが「〇〇したい」「〇〇行きたい」「〇〇気になる」と言ったら、深掘りより先に即保存。
名前は仮でOK・stageはdiscoveredでOK。

<ASTO_JSON>{"seed":true,"name":"鬼怒川でリセット","category":"旅行","stage":"discovered","originalWish":"温泉行きたいなー"}</ASTO_JSON>

## 未来イベント保存
以下のトリガーが出たら未来イベントとして保存する。

トリガー：
- 「〇〇したい」「〇〇行きたい」が会話の中で2回以上出た
- 「そうする」「やってみる」「決めた」など行動を決めた返事が来た
- 大会名・目的地・季節など具体的な情報が出た

トリガーが出たら、日付が未確定の場合は1回だけ聞く：
「いつ頃を目標にしてますか？😊」
→ 答えが返ってきたら即保存。「まだわからない」でもdreamで保存してOK。

<ASTO_JSON>{"futureEvent":true,"title":"マラソン4時間切り","status":"plan","date":"2026-10","sourceSeed":"マラソン4時間切り"}</ASTO_JSON>
status: dream/interest/plan/scheduled/done/harvest

体験済み：<ASTO_JSON>{"harvest":true,"seed":"カツカレー探し","result":"最高だった"}</ASTO_JSON>

収穫の演出（必ず守る）：
収穫JSONを出す時は、同じメッセージの中で必ず以下の順で返す。
1. originalWishを引用する「あの時『{originalWishの言葉}』って言ってたじゃないですか」
2. それが実現したことを一緒に喜ぶ（1〜2文）
3. 「次に気になってることはありますか？🌱」で次の種へ

例：
「あの時『温泉行きたいなー』って言ってたじゃないですか😊
それが本当に叶いましたね。すごい。
次に気になってることはありますか？🌱」

originalWishがない場合は種の名前を使う。
感情を盛りすぎない。シンプルに、でも確かに届く言葉で。

予約・実行：<ASTO_JSON>{"futureEventStatusUpdate":true,"title":"鬼怒川温泉","status":"scheduled"}</ASTO_JSON>
次の行動が決まった：<ASTO_JSON>{"nextAction":true,"text":"今週末じゃらんでホテル探す"}</ASTO_JSON>
完了した：<ASTO_JSON>{"completeAction":true,"text":"アクション内容"}</ASTO_JSON>

## 記憶（毎ターン必ず出す）
会話の締めに必ず両方出力する。新情報がなくても空配列で出す。

### userFacts（永続的事実）
仕事・家族・趣味・身体情報など変わらない事実。一度入れたら次回以降は出さなくていい。

出力例：
<ASTO_JSON>{"userFacts":["マラソンが好き","週末ランナー","フルマラソン5時間台","アクアラインマラソン2026年11月エントリー済み","ノヴァブラスト5使用中"]}</ASTO_JSON>

### conversationSummary（直近の話題）
今日の会話で何を話したか・何を決めたか・何を感じていたかを1〜2文で。
単語羅列NG。「背景」「気持ち」「決めたこと」を含める。

出力例：
<ASTO_JSON>{"conversationSummary":["11月アクアラインマラソンで5時間切りを目標に設定、週3回の練習メニュー（週末長距離・平日ジョグ・平日ペース走）を決めた"]}</ASTO_JSON>

## アクション系
「カレンダーに入れますか？」YES → 他のテキストなしで
<ASTO_JSON>{"calendar":true,"title":"...","date":"YYYY-MM","description":"..."}</ASTO_JSON>

「〇〇さんに送ってみますか？」YES → 他のテキストなしで
<ASTO_JSON>{"share":true,"text":"..."}</ASTO_JSON>

## アフィリエイト
同じテーマが繰り返し出て、ユーザーが具体的に「やってみたい」と言った時だけ、本人の言葉を引用して自然に提示。

## 話し方
- です・ます調、丁寧だけど堅くない・絵文字1〜2個/メッセージ
- Markdown記法（**太字**等）は使わない・LINEで表示されない
- 「いいですね」より「面白いですね」「もっと聞かせて」
- 知らないことは「詳しくはわからないけど」と前置きする

## やらないこと
- 「目標を決めましょう」「〜すべきです」と言わない
- 疲れの原因・仕事のストレスを掘らない
- 長文を一度に送らない・同じ質問を繰り返さない
- 既に出た話題を「それはどんな内容ですか？」と再質問しない`;


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
    hasShownCheckinQuickReply: false, // 旧フラグ（後方互換のため残す）
    lastQuickReplyShownAt: 0,         // クイックリプライ最終表示時刻
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
    lastQuickReplyShownAt: typeof data.lastQuickReplyShownAt === "number" ? data.lastQuickReplyShownAt : 0,
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

        // 未来イベント数（月次可視化判定にのみ使用）
        const activeEventCount = Array.isArray(data.futureEvents) ? data.futureEvents.filter(e => e.status !== "harvest").length : 0;

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
          "【返答ルール - 必ず守る】",
          "返答を作る前に、以下の順で記憶をスキャンする：",
          "  1. ユーザーの未来カレンダー（あれば最優先）",
          "  2. 現在の種（特に成長中の種）",
          "  3. 最近の会話まとめ",
          "  4. このユーザーについて（永続的事実）",
          "",
          "ユーザーの今のメッセージが、上記のいずれかに関連していたら、",
          "新しい質問をする前に、必ずその記憶を引用してから返す。",
          "",
          "例：ユーザー「疲れた」 → 記憶に「鬼怒川温泉(plan)」がある",
          "NG：「最近気になってることありますか？」（記憶を無視）",
          "OK：「おつかれさまです😊 そういえば9月の鬼怒川温泉、楽しみですね🌱」（記憶を活用）",
          "",
          "関連する記憶が全くない時だけ、新しい話題を振っていい。",
        ].join("\n");

        if (calendarRequestInstruction) {
          return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + calendarRequestInstruction + "\n\n---\n\n" + instruction;
        }

        return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + instruction;
      }

      // アフィリエイトセクションは「種が育っている時のみ」挿入
      // 判定：interested以上の種がある or plan/scheduled状態の未来イベントがある
      const hasGrowingSeed =
        Array.isArray(userData.seeds) &&
        userData.seeds.some(s => ["interested", "planning", "booked"].includes(s.stage));
      const hasPlannedEvent =
        Array.isArray(userData.futureEvents) &&
        userData.futureEvents.some(e => ["plan", "scheduled"].includes(e.status));
      const shouldIncludeAffiliate = hasGrowingSeed || hasPlannedEvent;

      // オンボーディング現在ステップ判定
      // assistant の返信回数で次に何を聞くべきか決まる
      function buildOnboardingContext(data) {
        if (!data.isFirstTime) return "";
        if (!data.userName) {
          return "\n\n【現在のステップ】ステップ0：名前を聞いてください。";
        }
        const assistantCount = (data.messages || []).filter(m => m.role === "assistant").length;
        // assistantCount=1（名前受け取った返事だけ）→ 次はQ1
        // assistantCount=2 → 次はQ2
        // ...
        // assistantCount=6 → 5問終了、見立て＋種保存へ
        const nextQ = assistantCount;
        if (nextQ === 1) {
          return "\n\n【現在のステップ】ステップ1：Q1を聞いてください。深掘りせず、テンプレ通りに質問だけ。";
        }
        if (nextQ >= 2 && nextQ <= 5) {
          return `\n\n【現在のステップ】ステップ${nextQ}：直前の回答に1文だけ受け止めて、すぐにQ${nextQ}を出す。深掘り絶対禁止。`;
        }
        if (nextQ >= 6) {
          return "\n\n【現在のステップ】ステップ6：5問の回答を統合して見立てを伝え、必ず<ASTO_JSON>{\"seed\":true,...}</ASTO_JSON>で種を1〜3個保存してください。";
        }
        return "";
      }

      const systemPrompt = userData.isFirstTime
        ? ONBOARDING_PROMPT(userData.userName) + buildOnboardingContext(userData)
        : CHECKIN_PROMPT(userData.userName) + buildUserContext(userData) + (shouldIncludeAffiliate ? buildAffiliateSection() : "");

      userData.messages.push({
        role: "user",
        content: userMessage,
      });

      const recentMessages = userData.messages.slice(-20);

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 800, // 検索結果を含むため少し増やす
  system: systemPrompt,
  messages: recentMessages,
  tools: [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 2, // タイムアウト対策：検索は2回まで
    }
  ],
});

// tool_useブロックを除いてテキストだけ抽出
const rawReply = response.content
  .filter(block => block.type === "text")
  .map(block => block.text)
  .join("");

      // JSON検知（カレンダー・シェア・種・ゴール）
      let replyText = rawReply;
      let calendarUrl = null;
      let shareUrl = null;

      // === 変化追跡（種・未来イベント新規追加、残高変化のサマリを返信末尾に付ける） ===
      const STATUS_POINT_BEFORE = { dream:1, interest:2, plan:3, scheduled:5 };
      const calcBalance = (events) => (Array.isArray(events) ? events : [])
        .filter(e => e.status !== "harvest" && e.status !== "done")
        .reduce((sum, e) => sum + (STATUS_POINT_BEFORE[e.status] || 0), 0);
      const balanceBefore = calcBalance(userData.futureEvents);
      const newSeedsAdded = [];   // 新規追加された種名
      const newEventsAdded = [];  // 新規追加された未来イベント名

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
              mentionCount: 1,
            };
            // originalWishを追加
            if (data.originalWish) newSeed.originalWish = data.originalWish;

            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const existing = userData.seeds.findIndex(s => s.name === data.name);
            if (existing >= 0) {
              userData.seeds[existing].lastMentionAt = Date.now();
              userData.seeds[existing].mentionCount = (userData.seeds[existing].mentionCount || 1) + 1;
              if (data.stage) userData.seeds[existing].stage = data.stage;
              if (data.confidence) userData.seeds[existing].confidence = data.confidence;
              // originalWishは最初の言葉のみ保存（解像度が上がっても上書きしない）
              if (!userData.seeds[existing].originalWish && data.originalWish) {
                userData.seeds[existing].originalWish = data.originalWish;
              }
            } else {
              userData.seeds.push(newSeed);
              newSeedsAdded.push(data.name);
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
              newEventsAdded.push(newEvent.title);
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

      // === 種のステージ自動昇格 ===
      // データの状態から自動算出（AIに任せず確実に動かす）
      if (Array.isArray(userData.seeds)) {
        userData.seeds.forEach(s => {
          if (s.stage === "harvested") return;
          // 関連する未来イベント
          const relatedEvents = (userData.futureEvents || []).filter(e => e.sourceSeed === s.name);
          const hasScheduled = relatedEvents.some(e => e.status === "scheduled");
          const hasPlan = relatedEvents.some(e => ["plan", "interest"].includes(e.status));
          const mentionCount = s.mentionCount || 1;

          // 昇格ルール（降格はしない）
          const stageRank = { discovered: 0, interested: 1, planning: 2, booked: 3 };
          let targetStage = s.stage;
          if (hasScheduled) targetStage = "booked";
          else if (hasPlan) targetStage = "planning";
          else if (mentionCount >= 2) targetStage = "interested";

          if ((stageRank[targetStage] || 0) > (stageRank[s.stage] || 0)) {
            s.stage = targetStage;
            s.lastStageUpAt = Date.now();
          }
        });
      }

      // === 変化サマリを返信末尾に付加（種・未来イベントが新規追加された時のみ） ===
      const balanceAfter = calcBalance(userData.futureEvents);
      const balanceDelta = balanceAfter - balanceBefore;
      const summaryLines = [];
      if (newSeedsAdded.length > 0) {
        summaryLines.push(`🌱 新しい種：${newSeedsAdded.join("、")}`);
      }
      if (newEventsAdded.length > 0) {
        summaryLines.push(`✨ 未来カレンダーに追加：${newEventsAdded.join("、")}`);
      }
      if (balanceDelta > 0) {
        summaryLines.push(`未来残高 +${balanceDelta}pt → ${balanceAfter}pt`);
      }
      if (summaryLines.length > 0 && replyText) {
        replyText = replyText + "\n\n" + summaryLines.join("\n");
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
const isFirstCheckinMessage = !userData.isFirstTime;

      // オンボーディングで名前を受け取った直後：messages.length === 4（名前の往復）
      const isAfterNameInOnboarding =
        userData.isFirstTime && userData.messages.length === 4 && userData.userName;

      // 表示する場合はタイムスタンプ更新
      if (isFirstCheckinMessage) {
        userData.lastQuickReplyShownAt = Date.now();
      }
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


      // オンボーディング選択肢は廃止（5問は自由記述で答えてもらう）
      const onboardingQuickReply = undefined;

      // チェックイン選択肢
      const quickReply = isFirstCheckinMessage
        ? {
            items: [
              { type: "action", action: { type: "message", label: "前の続きを育てる", text: "前回の続きを育てたい" } },
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
