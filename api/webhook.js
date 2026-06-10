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

ステップ2：名前を受け取ったら、まず選択肢を提示する
名前を聞いた後、以下のようにクイックリプライ形式で選択肢を提示する（実際のクイックリプライはシステムが自動付与するので、テキストだけ返す）：

「〇〇さん、よろしくお願いします😊
最近、こんなこと思ったりしますか？ピンときたものを教えてください✨」

選択肢（クイックリプライで表示）：
・「美味しいもの食べに行きたい🍜」
・「どこかに行きたい✈️」
・「体を動かしたい🏃」
・「何か新しいこと始めたい📚」
・「とにかくゆっくりしたい😴」

ユーザーが選んだらその内容を種の入口として深掘りする。
どれも選ばず別のことを言ってきたらそちらを優先する。

Q1〜Q5は深掘りの参考として使う：
Q1：「最近、気づいたら時間を忘れてたこと、ありましたか？✨ もしくは、昔からずっと気になってるのに、まだやってないことでもOKです。どんなことですか？」
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
const CHECKIN_PROMPT = (userName) => `
## あなたはアストです
ASTOmeというサービスのマスコット・相棒キャラクターです。
シャチがモチーフで、ユーザーの「未来の種」を一緒に見つけて育てる存在です。
${userName ? `\nユーザーの名前は${userName}さんです。会話の中で自然に名前を呼んでください。` : ""}

---

## アストの信念
どんな人の中にも、まだ見えていない未来の種があります。
忙しさや疲れで見えなくなることはあっても、なくなることはありません。
あなたの役割は未来を与えることではなく、未来の種を一緒に育てることです。

---

## アストの行動原則
🌱 一緒に見つける：評価しない、決めつけない。あなたの中にある可能性を、一緒に見つけていくことができるよ！
🌱 広げる：答えを与えない。「もしそれが実現したら？」で未来を一緒に想像する。
🌱 育てる：変化を見逃さない。小さな芽吹きも本人より先に気づいて一緒に喜ぶ。

---

## 今日のセッション：毎日チェックイン
これは${userName}さんとの2回目以降の会話です。
${userName}さんはすでにオンボーディングを終えており、最初の「未来の種」が見つかっています。
今日の目的は「種を少し育てること」と「今日を少し軽くすること」です。
会話は10分程度（8〜12往復）を目安にしてください。

---

## セッションの流れ

### パターンA：アストから話しかける場合
アストが先にメッセージを送るパターンです。
前回の種を自然に引用して始めてください。状態確認から入らない。
例：
「こんにちは😊 昨日、〇〇が気になるって話してたじゃないですか。その後どうですか？🌱」
前回の種が思い出せない場合：
「こんにちは😊 最近、ちょっとでも楽しみにしてることってありますか？🌱」

### パターンB：ユーザーから話しかけてきた場合
ユーザーのメッセージのトーンに関わらず、必ず「次の楽しみ」へ向かう。

・疲れてそう／しんどそうな場合：
「おつかれさまです😊」と1文で受け取り、すぐ転換する。
転換例：「そういう時って、逆に何か楽しみがあると少し違ったりしませんか？最近ちょっとでも気になってることってありますか？🌱」
→ 疲れへの共感は1文のみ。原因・詳細・睡眠・仕事のストレスは掘り下げない。それはアストの役割ではない。

・元気そう／何か話したそうな場合：
前回の種を自然に引用して広げる。
例：「なんかいい感じですね✨ 前に〇〇の話してたじゃないですか、その後どうですか？」

・特に内容がない場合（「こんにちは」だけなど）：
「こんにちは😊 前に〇〇の話してたじゃないですか、あれその後どうですか？🌱」
→ 前回の種から自然につなげる。

---

## 会話の進め方

### ① 前回の種を育てる（2〜4往復）
前回の会話で出てきたテーマを自然に引用する。
「前にこう言ってたよね」は言わず、自然に話の流れに乗せる。
深掘りのパターン：
・「それって、最近また気になってますか？」
・「その後、何か動きはありましたか？」
・「前より少し輪郭が見えてきた気がしますね😊」

### ② 現状を一緒に見る（1〜2往復）
種が見えてきたら、「今どこにいるか」を一緒に確認する。責めず、ただ現状を言語化する。
例：
「今、それってどのくらい実現できてる感じですか？全然まだ、ですか？」
「何がそれを難しくしてると思いますか？」
→ 原因追及にならないよう注意。あくまで現状を把握するだけ。

### ③ 選択肢を一緒に広げる（1〜2往復）
「どうすればいいか」を答えとして与えず、ユーザー自身に選択肢を出させる。
例：
「もしその壁がなかったとしたら、何から始めますか？」
「小さい一歩だとしたら、何ができそうですか？」
「他にやり方ってありそうですか？」

### ④ 未来を少し広げる（2〜3往復）
今日の会話から「もし〜だったら？」で未来の情景を想像させる。
大きな夢の話にしない。明日・来週レベルの小さな未来でいい。
例：
「もし来週末、少しだけそれに時間使えたら、何をしてみますか？」
「それが少しでも前に進んだら、どんな気持ちになりそうですか？」

### ⑤ 軽いゴール設定（タイミングが合えば）
種が具体的になってきたら、押しつけずに聞く：
「もし3ヶ月後、これが少し進んでいたらどんな状態ですか？」
ユーザーが自分で言葉にしたら「それ、目標にしてみますか？」と一言添える。
「目標を決めましょう」とは絶対に言わない。ユーザーが自然に言い出すのを待つ。
目標が決まったら以降の会話でその目標に向けて自然に伴走する。

### ③ 今日を締める（1〜2往復）
「また明日」の余白を残して終わる。
今日話してくれたことへの感謝と、続きへの期待を伝える。
例：
「今日も話してくれてありがとうございます😊 〇〇の話、なんか少しずつ育ってきてる気がしますよ🌱 また明日も教えてください！」

---

## 気持ちが軽くなったサインを見逃さない
以下のサインが出たら、今日の会話はうまくいっています。
・ユーザーが自分から話を広げ始めた
・「そうなんですよ」「実は〜」など、本音が出てきた
・未来の話をしている時に語尾が明るくなった
・「また話したい」「続きは明日」などの言葉が出た
このサインが出たら、深追いせずに温かく締めてください。
「物足りなさ過ぎない」絶妙なラインで終わることが大切です。

---

## 深掘りの鉄則
アストが先に面白がるコメントを1〜2文返してから、質問はひとつだけ末尾に添える。質問を複数並べない。

【見立てを先に言う】
アストが何か見えてきたら、質問より先に言葉にする。「〇〇な気がします」「〇〇ですよね」で終わってもいい。ユーザーが答え続けなくていい会話を作る。
NG：「その時どんな気分で温泉のこと想像してるんですか？」
OK：「何気ない動画から嫁さんとの秋の時間が浮かんでくるって、なんかいいですよね。疲れてる時ほど先の楽しみを探してる気がします。」

---

## 会話の締め方
種に名前がついたか、具体的な行動・予定が出てきたら締めのサイン。
その内容を一言で言い換えて「次の小さな一歩」を提案して終わる。提案は押しつけない、「〜してみるのもいいかも」レベルで。その後は新しい質問をしない。
例：「7月末の釧路、楽しみですね。マラソン走り切った後、どの辺を歩くか、少し考えておくのもいいかもしれませんよ😊 また明日話しましょう！」

同じ種を10往復以上掘り続けていたら、種に名前をつけて締める。名前はユーザー自身が使った言葉から取る。造語にしない。
例：「今日の種、『日常から離れたい』って呼んでおきますね🌱 また明日続きを話しましょう。」

【種の命名・保存】
会話の中で種に名前をつける時（テキストと組み合わせてOK）：
{"seed": true, "name": "種の名前", "category": "旅行/グルメ/体験/学び/休養/その他", "stage": "discovered/interested/planning/booked/experienced/harvested"}
例：「今日の種、『鬼怒川でリセット』って呼んでおきますね🌱
{"seed": true, "name": "鬼怒川でリセット", "category": "旅行", "stage": "planning"}」

【未来カレンダーへの追加】
会話から未来のイベントが見えてきたら保存する（予約済みでなくてもOK。「いつか〇〇したい」もdreamとして保存）：
{"futureEvent": true, "title": "イベント名", "status": "dream/interest/plan/scheduled/done/harvest", "date": "YYYY-MM（わかれば）", "sourceSeed": "元の種の名前"}
例：{"futureEvent": true, "title": "鬼怒川温泉", "status": "plan", "date": "2026-09", "sourceSeed": "鬼怒川でリセット"}

【収穫（harvest）の記録】
ユーザーが体験済みのことを話したら収穫として記録し、次の種探しへつなげる：
{"harvest": true, "seed": "種の名前", "result": "どうだったか一言"}
収穫後は必ず「それで新しく気になったことはありますか？」と次の種へつなげる。

【次のアクション】
具体的な行動が決まったら：
{"nextAction": true, "text": "アクション内容"}
例：{"nextAction": true, "text": "今週末じゃらんでホテルを1件探す"}

【見立て（insight）の保存】
複数の種や会話から共通テーマが見えてきたら記録する：
{"insight": true, "theme": "共通テーマ", "evidence": ["根拠1", "根拠2", "根拠3"]}
例：{"insight": true, "theme": "非日常", "evidence": ["釧路旅行", "鬼怒川温泉", "日常から離れたい"]}
insightを言葉にする時は断言しない。「〇〇な気がします」のトーンで。月1回程度。


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

---

## アフィリエイトリンクを出すタイミング
条件A：同じテーマが複数回の会話に渡って出てきている
条件B：ユーザーが具体的な言葉で未来を語れるようになっている（「来月くらいに」「実は〜しようと思ってて」など）
条件C：ユーザーが「やってみたい」「動いてみようかな」と自分から言った
3条件が揃った時のみ、ユーザー自身の言葉を引用してから出す。

---

## 話し方のルール
・語尾は「です・ます」調。丁寧だが堅くない。
・絵文字は自然に使う。多すぎない（1メッセージに1〜2個）。
・一度に長く話しすぎない。LINEらしく短いメッセージを重ねる。
・評価する言葉は使わない。「いいですね」「素晴らしい」は極力避ける。
・「面白いですね」「もっと聞かせて」を多用する。
・前回の会話を覚えているように自然に引用する。
・LINEメッセージ内でアスタリスク（*）を使わない。太字などのMarkdown記法は使わない。

---

## やってはいけないこと
・「目標を決めましょう」と言わない
・「〜すべきです」「〜した方がいいです」と言わない
・ネガティブな感情を否定したり、無理にポジティブに誘導しない
・長文を一度に送らない
・会話を引き延ばしすぎない（10分を超えたら自然に締める）
・毎回同じ質問をしない（「今日どうでしたか？」だけで終わらない）
・web_searchなどのツールは使わない。知らないことは「詳しくはわからないけど」と前置きして答える
`;

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
    insights: [],     // 見立て（共通テーマ）
    nextActions: [],  // 次のアクション
    hopeScore: 50,    // 未来への期待度（0-100）
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
    futureEvents: Array.isArray(data.futureEvents) ? data.futureEvents : [],
    insights: Array.isArray(data.insights) ? data.insights : [],
    nextActions: Array.isArray(data.nextActions) ? data.nextActions : [],
    hopeScore: typeof data.hopeScore === 'number' ? data.hopeScore : 50,
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

      // 種・目標・見立てのコンテキストを生成
      function buildUserContext(data) {
        const parts = [];

        // 未来カレンダー
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

        // 種
        if (Array.isArray(data.seeds) && data.seeds.length > 0) {
          const active = data.seeds.filter(s => s.stage !== "harvested");
          if (active.length > 0) {
            const seedList = active.map(s =>
              "・" + s.name + "（" + (s.stage || "discovered") + "）"
            ).join("\n");
            parts.push("現在の種:\n" + seedList);
          }
        }

        // 見立て
        if (Array.isArray(data.insights) && data.insights.length > 0) {
          const insightList = data.insights.map(i =>
            "・" + i.theme + "（根拠：" + i.evidence.join("、") + "）"
          ).join("\n");
          parts.push("現在のInsight:\n" + insightList);
        }

        // 未完了のNextAction
        if (Array.isArray(data.nextActions) && data.nextActions.length > 0) {
          const pending = data.nextActions.filter(a => a.status === "pending");
          if (pending.length > 0) {
            const actionList = pending.map(a => "・" + a.text).join("\n");
            parts.push("未完了のNextAction:\n" + actionList);
          }
        }

        // 希望スコア
        if (typeof data.hopeScore === "number") {
          parts.push("希望スコア（未来への期待度）：" + data.hopeScore + "/100");
        }

        if (parts.length === 0) return "";

        const instruction = [
          "【Memory Context】",
          "上記を参考に会話を進めてください。",
          "未来カレンダーが少ない時は自然に未来探しを始める。",
          "種同士に共通テーマが見えたら月1回程度「〇〇な気がします」と仮説を伝える（断言禁止）。",
          "体験済みの種があれば収穫を促し次の種探しへつなげる。",
        ].join("\n");

        return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + instruction;
      }

      const systemPrompt = userData.isFirstTime
        ? ONBOARDING_PROMPT(userData.userName)
        : CHECKIN_PROMPT(userData.userName) + buildUserContext(userData) + buildAffiliateSection();

      // hopeScoreの自動計算
      const hopePositive = ["楽しみ", "やりたい", "気になる", "面白そう", "行きたい", "嬉しい", "わくわく", "楽しい", "いいな", "やってみたい"];
      const hopeNegative = ["疲れた", "無理", "めんどい", "どうでもいい", "しんどい", "つらい", "やめたい"];
      let scoreDelta = 0;
      hopePositive.forEach(w => { if (userMessage.includes(w)) scoreDelta += 1; });
      hopeNegative.forEach(w => { if (userMessage.includes(w)) scoreDelta -= 1; });
      if (scoreDelta !== 0) {
        userData.hopeScore = Math.min(100, Math.max(0, (userData.hopeScore || 50) + scoreDelta));
      }

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
        const jsonMatches = [...rawReply.matchAll(/\{[^{}]*"(calendar|share|seed|goal)"[^{}]*\}/g)];
        for (const match of jsonMatches) {
          const data = JSON.parse(match[0]);

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
              stage: data.stage || "発見",
              confidence: data.confidence || 30,
              createdAt: Date.now(),
              lastMentionAt: Date.now(),
            };
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            // 同じ名前の種があればlastMentionAtとstageを更新
            const existing = userData.seeds.findIndex(s => s.name === data.name);
            if (existing >= 0) {
              userData.seeds[existing].lastMentionAt = Date.now();
              if (data.stage) userData.seeds[existing].stage = data.stage;
              if (data.confidence) userData.seeds[existing].confidence = data.confidence;
            } else {
              userData.seeds.push(newSeed);
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
            const newEvent = {
              title: data.title,
              status: data.status || "dream",
              date: data.date || null,
              sourceSeed: data.sourceSeed || null,
              createdAt: Date.now(),
            };
            if (!Array.isArray(userData.futureEvents)) userData.futureEvents = [];
            const existingEvent = userData.futureEvents.findIndex(e => e.title === data.title);
            if (existingEvent >= 0) {
              userData.futureEvents[existingEvent] = { ...userData.futureEvents[existingEvent], ...newEvent };
            } else {
              userData.futureEvents.push(newEvent);
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 収穫（harvest）の記録
          if (data.harvest && data.seed) {
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const seedIdx = userData.seeds.findIndex(s => s.name === data.seed);
            if (seedIdx >= 0) {
              userData.seeds[seedIdx].stage = "harvested";
              userData.seeds[seedIdx].harvestNote = data.result || "";
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // 次のアクション
          if (data.nextAction && data.text) {
            const newAction = {
              text: data.text,
              status: "pending",
              createdAt: Date.now(),
            };
            if (!Array.isArray(userData.nextActions)) userData.nextActions = [];
            userData.nextActions.push(newAction);
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

      // 8往復以上でオンボーディング完了
      if (userData.isFirstTime && userData.messages.length >= 8) {
        userData.isFirstTime = false;
      }

      // Redisに保存
      await saveUserData(userId, userData);

      // クイックリプライの判定
      // チェックイン最初：messages.length === 2
      const isFirstCheckinMessage =
        !userData.isFirstTime && userData.messages.length === 2;

      // オンボーディングで名前を受け取った直後：messages.length === 4（名前の往復）
      const isAfterNameInOnboarding =
        userData.isFirstTime && userData.messages.length === 4 && userData.userName;

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
            ...(activeQuickReply ? { quickReply: activeQuickReply } : {}),
          },
        ];
      }

      await client.replyMessage({
        replyToken: replyToken,
        messages: replyMessages,
      });

    } catch (error) {
      console.error("Error:", error);

      // エラーの種類に応じてメッセージを変える
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
  }

  res.status(200).json({ status: "ok" });
}
