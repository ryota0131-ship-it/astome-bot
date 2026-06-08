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

// アフィリエイトリンク
const BASE_URL = 'https://ck.jp.ap.valuecommerce.com/servlet/referral';
const SID = '3772859';

const AFFILIATE = {
  asoview: {
    pid: '892628806',
    label: 'アソビュー',
    searchUrl: 'https://www.asoview.com/search/?keyword=',
    keywords: ['体験', 'アクティビティ', 'マラソン', 'ハイキング', 'スポーツ', 'ツアー', 'ワークショップ', '料理教室', 'アウトドア', 'キャンプ'],
  },
  jalan: {
    pid: '892628809',
    label: 'じゃらん',
    searchUrl: 'https://www.jalan.net/rechercher/srv/hotel/defaultPage.do?screenId=OUW3701&keyword=',
    keywords: ['温泉', 'ホテル', '旅館', '宿', '旅行', '国内旅行', 'リゾート', '観光', '泊まり'],
  },
  expedia: {
    pid: '892628813',
    label: 'エクスペディア',
    searchUrl: 'https://www.expedia.co.jp/Hotel-Search?destination=',
    keywords: ['海外', '海外旅行', '国際', 'ハワイ', 'グアム', 'ヨーロッパ', 'アジア', '海外ホテル'],
  },
  hotpepper: {
    pid: '892628814',
    label: 'ホットペッパーグルメ',
    searchUrl: 'https://www.hotpepper.jp/SA/search/?freeword=',
    keywords: ['グルメ', 'レストラン', '食事', 'ディナー', 'ランチ', 'カフェ', '居酒屋', '焼肉', 'カレー', 'ラーメン', 'パスタ'],
  },
  qoo10: {
    pid: '892628816',
    label: 'Qoo10',
    searchUrl: 'https://www.qoo10.jp/gmkt.inc/Search/Search.aspx?keyword=',
    keywords: ['ショッピング', 'コスメ', 'ファッション', '韓国', 'スキンケア', 'メイク', 'トレンド'],
  },
};

// キーワードからアフィリエイトリンクを生成
function buildAffiliateLink(service, keyword) {
  const aff = AFFILIATE[service];
  if (!aff) return null;
  const encoded = encodeURIComponent(keyword);
  const targetUrl = encodeURIComponent(aff.searchUrl + encoded);
  return ;
}

// 会話からアフィリエイトを出すべきか判定
function detectAffiliate(messages) {
  // 直近10件のユーザー発言を取得
  const userMessages = messages
    .filter(m => m.role === 'user')
    .slice(-10)
    .map(m => m.content)
    .join(' ');

  for (const [service, config] of Object.entries(AFFILIATE)) {
    const matched = config.keywords.filter(kw => userMessages.includes(kw));
    if (matched.length >= 2) {
      // 同じジャンルのキーワードが2回以上出たらリンクを出す
      return { service, keyword: matched[0], label: config.label };
    }
  }
  return null;
}

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
Q1（必須）：「最近、気づいたら時間を忘れてたこと、ありましたか？✨ もしくは、昔からずっと気になってるのに、まだやってないことでもOKです。どんなことですか？」
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

【見立てを先に言う】
アストが何か見えてきたら、質問より先に言葉にする。「〇〇な気がします」「〇〇ですよね」で終わってもいい。ユーザーが答え続けなくていい会話を作る。
NG：「その時どんな気分で温泉のこと想像してるんですか？」
OK：「何気ない動画から嫁さんとの秋の時間が浮かんでくるって、なんかいいですよね。りょうたさん、疲れてる時ほど先の楽しみを探してる気がします。」

## 会話の締め方
種に名前がついたか、具体的な行動・予定が出てきたら締めのサイン。
その内容を一言で言い換えて「次の小さな一歩」を提案して終わる。提案は押しつけない、「〜してみるのもいいかも」レベルで。その後は新しい質問をしない。
例：「7月末の釧路、楽しみですね。マラソン走り切った後、どの辺を歩くか、少し考えておくのもいいかもしれませんよ😊 また明日話しましょう！」

同じ種を10往復以上掘り続けていたら、種に名前をつけて締める。名前はユーザー自身が使った言葉から取る。造語にしない。
例：「今日の種、『日常から離れたい』って呼んでおきますね🌱 また明日続きを話しましょう。」

【カレンダー提案】
会話の中で具体的な予定（月・場所・イベント名など）が出てきて、締めのタイミングになったら、以下のように聞く：
「カレンダーに入れてみますか？」
ユーザーが「うん」「はい」「お願い」などYESを返したら、以下のJSON形式だけを返す（他のテキストは一切含めない）：
{"calendar": true, "title": "予定のタイトル", "date": "YYYY-MM（日付が不明な場合は月まで）", "description": "簡単な説明"}
例：{"calendar": true, "title": "鬼怒川温泉 嫁さんと", "date": "2026-09", "description": "温泉・プール・食べ放題"}

【予算計算】
会話の中で「いくらくらい？」「予算どのくらい？」「高い？」などのキーワードが出たら、会話の文脈から概算を計算して答える。
計算の根拠も簡単に添える。押しつけがましくなく「だいたいこのくらいかな」のトーンで。
例：「2泊3日で鬼怒川温泉だと、宿が1人1泊2〜3万円くらいなので2人で10〜15万円くらいかな。交通費を足すと合計15〜20万円くらいのイメージです😊」
予算が高いと感じた場合は「じゃらんのタイムセールとか使うと結構変わりますよ」くらいのフォローも自然に添える。

【LINEシェア提案】
一緒に行く人（嫁さん・友達など）が会話に出てきて、具体的な計画が見えてきたら、以下のステップで進める。

ステップ1：まずじゃらんで候補を探すことを提案する
「じゃらんでホテルの候補を探してみませんか？」→アフィリエイトリンク（じゃらん）を出す

ステップ2：ユーザーがホテルを決めたら教えてもらう
「気になるホテル見つかりましたか？決まったら教えてください😊」

ステップ3：ホテル名が出たらシェアメッセージを生成してLINEシェアを提案
「〇〇に決めたんですね！嫁さんに送ってみますか？」
【重要】シェアのJSONは「嫁さんに送ってみますか？」「誰かに共有してみますか？」への返答がYESの時だけ返す。「おすすめ出しましょうか？」「リンク出しましょうか？」への返答はリンクを出すだけでシェアJSONは返さない。
ユーザーがYESを返したら、以下のJSON形式だけを返す（他のテキストは一切含めない）：
{"share": true, "text": "共有するメッセージ内容（ホテル名を含めた自然な文章）"}
例：{"share": true, "text": "9月に鬼怒川温泉の〇〇ホテル行こうと思ってるんだけど、温泉もプールも食べ放題もあって良さそう！一緒にどう？🌱"}

過程を楽しんでもらうことが大事。じゃらんで探す→決める→シェアの流れ自体が楽しみになるように自然に進める。

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

// アフィリエイトリンクをプロンプト用に生成
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
リンクを出す前に「おすすめ出しましょうか？」と一言添えてから出す。ユーザーが「うん」「お願い」と返したらリンクを出す。ただし会話の流れで自然なら直接出してもいい。
リンクを出した後は押しつけない。「もし気が向いたら」のトーンで。
`;
}

// ユーザーデータをRedisから取得（なければ初期値）
async function getUserData(userId) {
  const raw = await redis.get(`user:${userId}`);
  if (!raw) {
    return { userName: null, isFirstTime: true, messages: [], seeds: [] };
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
    seeds: Array.isArray(data.seeds) ? data.seeds : [],
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

    if (event.message.type !== "text") {
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
        : CHECKIN_PROMPT(userData.userName) + buildAffiliateSection();

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

      const rawReply = response.content[0].text;

      // カレンダー・シェアJSONの検知
      let replyText = rawReply;
      let calendarUrl = null;
      let shareUrl = null;
      try {
        const jsonMatch = rawReply.match(/\{[\s\S]*?("calendar"|"share")[\s\S]*?\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);

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
            replyText = "カレンダーリンクを作りました😊 タップして追加してみてください🌱";
          }

          // LINEシェア
          if (data.share) {
            const text = encodeURIComponent(data.text || "");
            shareUrl = `https://social-plugins.line.me/lineit/share?text=${text}`;
            replyText = "シェア用のメッセージを作りました😊 タップして送ってみてください🌱";
          }
        }
      } catch (e) {
        // JSON解析失敗はそのままテキストとして扱う
      }

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

      // チェックインの最初のメッセージにクイックリプライを付ける
      // messages.lengthが2 = ユーザー1発目 + アスト返答1回目のタイミング
      const isFirstCheckinMessage =
        !userData.isFirstTime && userData.messages.length === 2;

      const quickReply = isFirstCheckinMessage
        ? {
            items: [
              {
                type: "action",
                action: {
                  type: "message",
                  label: "昨日の続きを育てる",
                  text: "昨日の続きを育てたい",
                },
              },
              {
                type: "action",
                action: {
                  type: "message",
                  label: "今の種を見てみる",
                  text: "今の種を見てみたい",
                },
              },
              {
                type: "action",
                action: {
                  type: "message",
                  label: "新しい種を探す",
                  text: "新しい種を探したい",
                },
              },
            ],
          }
        : undefined;

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
            ...(quickReply ? { quickReply } : {}),
          },
        ];
      }

      await client.replyMessage({
        replyToken: replyToken,
        messages: replyMessages,
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
