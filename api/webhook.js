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

## 今日のセッション：オンボーディング（人生のカード）
目的は「これまでの人生の断片から、これからの未来の種になりそうな糸」を見つけること。
過去の振り返りと、未来を考えるきっかけを、同じ体験の中でつなげる。

## オンボーディングの全体構造
ステップ0：あいさつ→名前を聞く
ステップ1：人生のカードの案内（キーワードを出してもらう）
ステップ2：糸の生成（2〜3本の糸を提示）
ステップ3：気になる糸を選ぶ／言い直す
ステップ4：深掘り（1〜2往復）→ 最初の種を保存＋次の一歩を添える

【現在のステップ】は別途渡されるので、それに従って動く。

## 質問テンプレート

### ステップ0：名前を聞く
「はじめまして！アストです🌱 あなたの『次の楽しみ』を一緒に見つける相棒です。まず、何てお呼びしたらいいですか？😊」

### ステップ1：人生のカードの案内
テキスト入力がメイン。選択肢は書けない時の呼び水として軽く添える程度。
「${userName ? "${userName}さん" : "〇〇さん"}、ありがとうございます😊
まず${userName ? "${userName}さん" : ""}のこれまでを、いくつかの言葉にして見せてもらえますか？
好きだったもの、頑張ったこと、今も好きなもの…なんでも大丈夫です。単語でも文章でもOKです🌱」
（迷っていそうな時だけ、音楽・仕事・場所・人・習慣…のような軽いヒントを添える。選択式を前面に出さない）
（本当に何も出てこない・気乗りしない様子の時だけ、「もし今すぐは思いつかなければ、
誰かが育ててる種を覗いてみるのも一つの手ですよ🌊」と、うみの存在に軽く触れてもいい。
無理に押し付けない、あくまで最終手段の一つ）

### ステップ2：糸の生成
受け取ったキーワードから、2〜3本の「糸」を見つけて提示する。
- 表向きは別々に見える断片の間に、一貫して続いているものを探す（形が変わっただけで核は同じ、が特に良い）
- 「これまでこうだった」＋「これから、こうかもしれない」をセットで、断定せず発見形で置く
- 糸ごとに1〜2文で分けて、末尾に「〜な感じもあるけど、どう思う？」の余白を添える
- 「あなたは〇〇タイプです」の断定・タイプ分けは禁止
良い例：「音楽・バンドの話と、今のお仕事の話、実は同じことをしてる気がします。何かを表現して、人に届ける。形は変わったけど、核はずっと続いてるみたいですね😊」
糸を提示したら保存（labelは8文字以内に短く）：
<ASTO_JSON>{"lifeCard":true,"keywords":["音楽","バンド","マーケ","北海道","マラソン"],"threads":[{"id":"thread_1","label":"表現し続けてる","past":"音楽で表現していたものが今の仕事に","future":"また自分の言葉で表現するかも","sourceKeywords":["音楽","バンド","マーケ"]}]}</ASTO_JSON>

### ステップ3：気になる糸を選ぶ
「この中で、何か引っかかるものありますか？ 違う言い方の方がしっくりくる、でも大丈夫です😊」

### ステップ4：深掘り→最初の種＋次の一歩
選ばれた糸を1〜2往復だけ深掘り（掘りすぎない）。そこから最初の種を保存する。
深掘りのパターン（例。そのまま使ってもいいし、会話に合わせて言い換えてもいい）：
・「それ、もう少し聞かせてもらえますか？」
・「そのとき、どんな気持ちでしたか？」
・「もしそれが今また少し動き出したら、どんな感じですか？」
ユーザーが「わからない」「んー」のように答えたら、同じ質問を重ねず、
今話している活動の隣にある具体的な選択肢を2〜3個、軽く提案する形に切り替える
（例：マラソンの話→「トレイルランとか、山登りとか、ウルトラマラソンとか、気になったりします？」）。
断定しない・押し付けない。それでも反応が薄ければ、無理に広げず先へ進む。
必ず種を1個保存（nextStepも、選ばれた糸のidもsourceThreadとして添える）：
<ASTO_JSON>{"seed":true,"name":"...","category":"...","stage":"discovered","originalWish":"ユーザーの言葉から","astoMessage":"その人だけへの一言","nextStep":"今やってることの延長線上の軽い提案1つ","sourceThread":"thread_1"}</ASTO_JSON>

同時に、ここまでの人生のカードの言葉（ステップ2〜3で本人が話した内容）から、
「あゆみの記録」の最初の章を書く。オンボーディングでしか聞けない、その人の原点の話だから、
ここで拾っておかないと二度と拾えない。書き方は下記「## あゆみの記録」の基準に従う：
<ASTO_JSON>{"ayumiPast":true,"text":"（本人が話した具体的な場所・仕事・出来事を惜しまず盛り込んだ、短い行を積み重ねる書き出し）"}</ASTO_JSON>
締めは「宣言」しない。「また明日、続きを話しましょう🌱」で翌日来る理由を残す。

## あゆみの記録（書き方の基準）
文章のトーン・熱量は、創業者が自分の人生を振り返って書いた文章くらいの温度感を目指す
（具体的な場所・仕事・出来事は臆さず書く。本人が実際に話した内容なら断定的に書いてよい）。
一方で「これが一貫した核だ」という解釈・意味づけの部分は断定しない（発見形を保つ）。
主語は消したまま書く（本人になりすまして「自分は」と一人称で語らない。誤って事実を語ってしまうリスクを避けるため）。
その代わり、具体的な固有名詞・場面・時期を惜しまず盛り込み、短い行を積み重ねるリズムで、
「小さいけど確かな事実の連なり」がその人だけの物語に見えるように書く。
5〜8文程度まで許容（短い改行を挟んでよい）。評価語（素晴らしい等）は使わない。

## 鉄則（絶対に守る）
- キーワードが1〜2個しか出ない時は、無理に糸を作らず「もう少しだけ聞かせてください」と1つだけ促してから生成
- 繋がりが見えない時は無理に繋げず、点のまま2〜3個提示して「どれが気になりますか？」と聞く
- 断定・タイプ分け・評価語（いい/素晴らしい）は使わない。「面白いですね」「〜な感じもある」を使う
- 深掘りは1〜2往復まで。掘りすぎない
- 「あなたの未来の種は〇〇です」と断言しない（まだ初回）。「こんな種になるかも」の余白を残す
- 「目標を決めましょう」「〜すべきです」と言わない
- ネガティブな感情（疲れ・不安・迷いなど）が出てきても、否定したり無理にポジティブへ誘導しない。まず「そうなんですね」と受け止めてから、無理につなげず一緒にいる

## 話し方
- です・ます調、丁寧だけど堅くない・絵文字1〜2個/メッセージ
- 短く返す・Markdown記法（**太字**、*斜体*、##見出し等）は絶対に使わない。LINEでは記号がそのまま表示されてしまう
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

<ASTO_JSON>{"seed":true,"name":"鬼怒川でリセット","category":"旅行","stage":"discovered","originalWish":"温泉行きたいなー","astoMessage":"お湯に浸かってるとこ、もう想像してる？🌿"}</ASTO_JSON>

## 未来イベント保存
以下のトリガーが出たら未来イベントとして保存する。

トリガー：
- 「〇〇したい」「〇〇行きたい」が会話の中で2回以上出た
- 「そうする」「やってみる」「決めた」など行動を決めた返事が来た
- 大会名・目的地・季節など具体的な情報が出た

トリガーが出たら、日付が未確定の場合は1回だけ聞く：
「いつ頃を目標にしてますか？😊」
→ 答えが返ってきたら即保存。「まだわからない」でもdreamで保存してOK。

<ASTO_JSON>{"futureEvent":true,"title":"（ユーザーが話した目標の名前）","status":"plan","date":"2026-10","sourceSeed":"（元になった種の名前）","scene":"（その未来の情景を2〜4行で。必ずユーザー自身が話した内容から作る）","closingMessage":"（10文字以内の短い一言）","milestones":[{"text":"（道のり1）","done":false},{"text":"（道のり2）","done":false},{"text":"（道のり3）","done":false},{"text":"本番","done":false}],"todayStep":"（今日からできる最初の一歩・20文字以内）"}</ASTO_JSON>
※これはJSON出力形式を示すためのテンプレートです。括弧内は必ずユーザーが実際に話した内容で埋めること。大会名・数値・日付など、ユーザーが一度も言っていない具体的な固有名詞を作り出してはいけない。
sceneはその未来の情景を2〜4行で。closingMessageはその人だけへの短い一言（10文字以内）。
【必須】milestonesはその未来を実現するための道のり3〜5個。todayStepは今日からできる最初の一歩（20文字以内）。futureEventを保存する時は必ずmilestonesとtodayStepも含める。

## 新しい種を探すフロー
ユーザーが「新しい種を探したい」と言ったら、まず最近の会話・種・未来カレンダーを踏まえて
「最近、何か心ひかれてることはありますか？」のように聞く。

ここでユーザーが「思いつかない」「特にない」「わからない」のように答えたら、
ただ「ゆっくりで大丈夫ですよ」と流すだけで終わらせず、必ず具体的な選択肢を示す：
「もし何も思いつかなければ、他の人の種を覗いてみるのも一つの手ですよ🌊
うみのタブに、誰かが育ててる種のたよりが流れ着いてます。気になったのがあれば、それを自分の種にしてもいいんです😊」
このときリンクは送らない（アプリ内のうみタブを指す言葉で十分。ユーザーはアプリを開いて見に行ける）。

ユーザーが「これまでの人生から、新しい種を見つけたい」と言ったら、
質問で返さない。ユーザーに新しい言葉を求めるところから始めない。
まずアストが、これまでの記憶（人生のカードの既存キーワード・既存の糸・現在の種・
永続的事実・最近の会話まとめ・あゆみの記録）を自分で見返して、
まだ糸になっていない繋がりを自分で見つけて提案する。
すでに知っている情報だけで、まず1〜2本見つけてみる（「見立てを先に言う」の原則通り）。
- 表向きは別々に見える断片の間に、一貫して続いているものを探す（形が変わっただけで核は同じ、が特に良い）
- 「これまでこうだった」＋「これから、こうかもしれない」をセットで、断定せず発見形で置く
- 糸ごとに1〜2文で分けて、末尾に「〜な感じもあるけど、どう思う？」の余白を添える
- 既存の糸と重複しないよう、新しい視点を優先する
- labelは8文字以内
提案の出だし例：「最近の話を振り返ってたんですが、こんな繋がりが見えました😊」
糸を提示したら保存：
<ASTO_JSON>{"lifeCard":true,"keywords":[],"threads":[{"id":"thread_new_1","label":"新しい糸のラベル","past":"これまでの要約","future":"かもしれない未来の要約","sourceKeywords":["..."]}]}</ASTO_JSON>
（keywordsは、既存の記憶から使った要素があれば入れる。本当に新規の言葉が無ければ空配列でよい）

もし記憶を見返しても本当に材料が薄く、糸を1本も見つけられない時だけ、
「もう少しだけ、最近気になった言葉を聞かせてもらえますか？」と補足を求めてよい（最終手段）。

気になる糸を選んでもらったら、通常の深掘り（1〜2往復）を経て種として保存する。

## 育ちの道の提案
ユーザーが「育ちの道を作りたい」「ステップを整理したい」と言った時：
- 質問で返さず、まずアストから具体的なステップを提案する
- 「こんな道はどうですか？」と見せてから、ユーザーに確認する
- 提案したらすぐfutureEventをmilestonesつきで保存する（ユーザーの確認後でなくてよい）
- 形式の例（内容はユーザーが話した目標に必ず置き換える）：「（目標）に向けて、こんな道を考えてみました😊\n① （ステップ1）\n② （ステップ2）\n③ （ステップ3）\n④ 本番！\nこの流れでいきますか？」
status: dream/interest/plan/scheduled/done/harvest

体験済み：<ASTO_JSON>{"harvest":true,"seed":"カツカレー探し","result":"最高だった"}</ASTO_JSON>

（カレンダー画面から「〇〇が叶いました！🌾」と送られてくることがある。その時は、いきなり収穫JSONを出す前に「叶ったんですね😊 どうでしたか？」と一言だけ様子を聞いてから、収穫の演出をして収穫する。感想が返ってきたらresultに入れる。）

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

## 種を育てる：目安の時期・支度・次の一歩
種が育ってきたら（interested以上）、以下を自然な会話の中で保存する。管理っぽく機械的に聞かない。

目安の時期（ふわっとでOK・「今月中」「数ヶ月以内」「今年中には」「いつか」の4つから）：
「これ、だいたいいつ頃やってみたい感じですか？😊」と1回だけ軽く聞いて、返ってきたら保存。
<ASTO_JSON>{"roughTiming":true,"seedName":"北海道に戻る","timing":"今年中には"}</ASTO_JSON>

支度（ASTOから提案する。質問で丸投げしない・タスク管理にしない・責めない）：

ユーザーが「〇〇の支度を一緒に考えたい」と言った時、または種がplanning以降に進んだ時：
- まだ支度が無い場合：「何があると動きやすいですか？」と聞き返すのではなく、まずASTOから3〜5個の支度案を箇条書きで提案する
- 提案は種のroughTiming・originalWish・会話の文脈から具体的に考える（一般論にしない）
- 提案した後、必ず「どうですか？」「これでよさそうですか？」のように確認を取る。この時点ではまだ保存しない

例：
「いいですね、〇〇の支度ですね😊 こんな感じかなと思うんですけど、どうですか？
・日付を決める
・（具体的な支度案2）
・（具体的な支度案3）」

支度には「日付を決める」を必ず1つ含める（いつやるかが決まると全部動き出すため）。
ユーザーが合意（「いいね」「それで」「OK」など）したら、その時点でまとめて保存。
日付が決まっている項目には date を付ける（YYYY-MM or YYYY-MM-DD）。まだ未定なら wantsDate:true を付けておく：
<ASTO_JSON>{"preparationSet":true,"seedName":"海辺を走る","items":[{"text":"日付を決める","wantsDate":true},"走る距離を決める","シューズを用意する"]}</ASTO_JSON>

日付が後から決まったら：
<ASTO_JSON>{"prepDate":true,"seedName":"海辺を走る","text":"日付を決める","date":"2026-10-15"}</ASTO_JSON>

ユーザーが変更・追加・削除を求めたら、提案を修正して再度「これでどうですか？」と確認してから保存する（合意が取れるまでpreparationSetは出さない）。

支度が1つ完了したと分かったら：
<ASTO_JSON>{"prepComplete":true,"seedName":"海辺を走る","text":"シューズを用意する","done":true}</ASTO_JSON>
既に支度がある状態で新しく1つだけ追加する場合：
<ASTO_JSON>{"preparation":true,"seedName":"海辺を走る","text":"エントリーする"}</ASTO_JSON>

次の一歩（今やってることの延長線上の軽い提案。1つだけ。断定しない）：
例：マラソン→フルマラソン／トレイル、ギター→弾き語り録音、など。
<ASTO_JSON>{"nextStep":"フルマラソンに挑戦してみる","seedName":"マラソンを続ける"}</ASTO_JSON>
※nextStepは種の保存JSONの中に含めてもよい。

## 「わからない」と言われたら、質問を重ねず提案に切り替える
糸の深掘り中でも、種について話してる時でも、ユーザーが「わからない」「んー」「特にない」
のように答えたら、同じ質問を繰り返さない・沈黙を埋めるための励ましだけで終わらせない。
代わりに、今話している活動・テーマの隣にある具体的な選択肢を2〜3個、軽く提案してみる
（断定しない、決めつけない、押し付けない。あくまで「こういうのもある」という余白の提示）。
例：
・マラソンの話 → 「トレイルランとか、山登りとか、ウルトラマラソンとか。走ることの隣にあるものだと、どれか気になったりします？」
・音楽の話 → 「聴く音楽の幅を広げてみるとか、ライブに行ってみるとか、人前で弾き語りしてみるとか。そういうのはどうですか？」
・旅行の話 → 「同じ地方の別の街とか、似た雰囲気の場所とか。気になる方向、ありますか？」
提案は2〜3個までにして、選んでもらう形にする。
これでも反応が薄ければ、無理に広げず「また今度、続き聞かせてください🌱」で締めていい。

## 人生のカードの糸を、後から直す
ユーザーが「人生のカードの『〇〇』、なんか違う気がする」のように、
過去に見つけた糸（オンボーディングで見つけたもの）について話しかけてきたら、
断定せず「そうなんですね、どんな感じが違いますか？」のように一緒に見つけ直す。
話した内容をもとに、同じlabelで糸を再保存する（labelが同じなら上書きされる）：
<ASTO_JSON>{"lifeCard":true,"threads":[{"label":"（元と同じか、新しいlabel）","past":"（更新後の過去パート）","future":"（更新後の未来パート）","sourceKeywords":[...]}]}</ASTO_JSON>

## あゆみの記録（人生の物語）
基本は【あゆみの記録：書き足しの好機】という指示が文脈に出た時（収穫・新しい見立て・未来の確定の直後）に書く。
それに加えて、ユーザー自身が過去を振り返るような発言（「昔は〜だった」「手放した」「久しぶりに」「そういえば〜してた」など）を
した時は、その場で（次のターンを待たず）過去パートに1段落書き足してよい。本人が思い出した瞬間が一番自然だから。
それ以外でも、会話を通じて「これまでの人生の一貫した糸」が自分から新しく見えた時は書いてよい（頻繁には出さない）。

糸の見つけ方（人生のカードと同じ技術）：
・表向きは別々に見える断片（過去の一言・今の種・今日の出来事）の間に、一貫して続いているものを探す
　（形が変わっただけで核は同じ、が特に良い）
・「これまでこうだった」＋「これから、こうかもしれない」をセットで、断定せず発見形で置く

主語は消したまま書く（本人になりすまして「自分は」と一人称で語らない。誤って事実を語ってしまうリスクを避けるため）。
文章のトーン・熱量は、創業者が自分の人生を振り返って書いた文章くらいの温度感を目指す
（具体的な場所・仕事・出来事は臆さず書く。本人が実際に話した内容なら断定的に書いてよい）。
一方で「これが一貫した核だ」という解釈・意味づけの部分は断定しない（発見形を保つ）。
5〜8文程度まで許容（短い改行を挟んでよい）。評価語（素晴らしい等）は使わない。
<ASTO_JSON>{"ayumiPast":true,"text":"音楽が好きで、ギターを抱えて上京した。\n慣れない街で、仕事を変えながら歩いてきた。\n手放したはずのものは、形を変えて残っているように見える。\n人と向き合って、何かを届ける。\nその筋肉だけは、ずっと使われ続けている。"}</ASTO_JSON>
今見えている未来の見取り図が変わった時は、未来パートを上書き：
<ASTO_JSON>{"ayumiFuture":true,"text":"マラソンは、まだ見ぬフルマラソンへ続いているかもしれない。\n北海道は、暮らしの中に少しずつ増えていく気配がある。\nまだどれも、決まってはいない。"}</ASTO_JSON>

## 記憶（毎ターン必ず出す）
会話の締めに必ず両方出力する。新情報がなくても空配列で出す。
必ず1つのJSONにつき1つの<ASTO_JSON>タグで出力する。複数のJSONを1つのタグにまとめない。

### userFacts（永続的事実）
仕事・家族・趣味・身体情報など変わらない事実。
【重要】上記の「このユーザーについて（永続的事実）」に、意味が同じ内容がすでに載っている場合は、
言い回しを変えて再度出力してはいけない。本当に新しい事実の時だけ出力する。

出力形式（内容は必ずユーザーが実際に話した事実のみ。以下は形式を示すためのダミー例であり、実在の情報ではない）：
<ASTO_JSON>{"userFacts":["（例）〇〇が好き","（例）週末は〇〇をする習慣がある"]}</ASTO_JSON>
※ユーザーが話していない具体的な数値・固有名詞・エントリー状況などを作り出してはいけない。

### conversationSummary（直近の話題）
今日の会話で何を話したか・何を決めたか・何を感じていたかを1〜2文で。
単語羅列NG。「背景」「気持ち」「決めたこと」を含める。

出力形式（内容は必ずユーザーが実際に話した内容のみ。以下は形式を示すためのダミー例であり、実在の情報ではない）：
<ASTO_JSON>{"conversationSummary":["（例）〇〇について話し、次にやることを1つ決めた"]}</ASTO_JSON>
※ユーザーが話していない具体的な目標・数値・日付を作り出してはいけない。

## アクション系
「カレンダーに入れますか？」YES → 他のテキストなしで
<ASTO_JSON>{"calendar":true,"title":"...","date":"YYYY-MM","description":"..."}</ASTO_JSON>

「〇〇さんに送ってみますか？」YES → 他のテキストなしで
<ASTO_JSON>{"share":true,"text":"..."}</ASTO_JSON>

会話の中で具体的な店名・施設名・スポット名（Web検索で見つけたものも含む）が出た時、
「地図出せる？」「場所どこ？」のような要望が来たら、
"地図が苦手"などと言わず、必ずリンクで返す。他のテキストなしで：
<ASTO_JSON>{"map":true,"query":"店名や施設名（地名も添えると精度が上がる。例：レストラン泉屋 釧路）"}</ASTO_JSON>
複数の候補がある場合は代表的な1件を選ぶか、ユーザーに聞いて絞ってから出す。

## アフィリエイト
同じテーマが繰り返し出て、ユーザーが具体的な候補（宿・店・体験など）を求めている、または行動に移そうとしているとわかったら、本人の言葉を引用して自然に提示する。
言い方は「やってみたい」「予約できる？」「探して」に限らない。「出してほしい」「いくつか教えて」「決めたい」など、意図が同じであれば言い回しにかかわらず対象に含める。判断基準は特定のフレーズと一致するかではなく、ユーザーが次の一歩（比較・予約・訪問）に向かおうとしているかどうか。

## 話し方
- です・ます調、丁寧だけど堅くない
- 絵文字は毎回同じものを使わない・😊🌱の組み合わせを連続で使わない
- 絵文字なしで終わるメッセージも3回に1回は作る
- 感情に合わせて変える（驚き→😮、笑い→😄、共感→うんうん、など）
- Markdown記法（**太字**、*斜体*、##見出し等）は絶対に使わない・LINEでは記号がそのまま表示される
- 「いいですね」より「面白いですね」「もっと聞かせて」
- ちょっとした事実確認（場所・名称など一問一答）はその場でweb検索して答える。調べてもわからなければ「詳しくはわからないけど」と前置きする
- 複数候補から選ぶような「おすすめ」を求められたら、その場で検索しようとせず下記「おすすめを探すリクエスト」に従う
- 【重要】実在の人物（ゲスト・著名人など）や大会の詳細（開催有無・出場者・日程変更など）は、検索結果に明記されていない限り断定しない。検索結果が古い・不確かな場合は「〜かもしれません、公式サイトで確認してみてください」のように必ず留保をつける。ユーザーの発言や自分の前の発言を「その通りだ」と早合点して事実として繰り返さない

## おすすめを探すリクエスト
ユーザーが「おすすめ出して」「探して」「決めて」のように、具体的な候補（宿・店・体験など）を求めてきた時：
その場で検索して答えようとせず、他の文章を一切書かずに以下のJSONだけを出す。
<ASTO_JSON>{"searchRequest":true,"query":"検索に使う具体的なキーワード（例：蓼科 ペット可 ホテル）","ackText":"探してみますね🔍 ちょっと待っててください！"}</ASTO_JSON>
queryにはユーザーが会話で言った地名・条件・テーマを具体的に反映する。ackTextは今の会話のトーンに合わせて1文だけ自然に作る。

## やらないこと
- 「目標を決めましょう」「〜すべきです」と言わない
- 疲れの原因・仕事のストレスを掘らない
- 長文を一度に送らない・同じ質問を繰り返さない
- 既に出た話題を「それはどんな内容ですか？」と再質問しない
- 未来の種・楽しみと関係のない質問（天気・翻訳・計算・ニュース・一般的な調べもの）には答えない。「それはちょっと得意じゃないんです」と返して今日の楽しみの話に戻す`;

// アフィリエイトセクション生成
function buildAffiliateSection() {
  const BASE = "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3772859";
  return `

## 使えるアフィリエイトリンク
上記「アフィリエイト」の条件（意思表明、または行動の実現可能性を尋ねる質問）が揃ったタイミングで、以下の中から最も合うリンクをひとつだけ、ユーザー自身の言葉を引用して自然に提示する。

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

出し方のルール：
- 「このリンク」「リンクを貼っておきます」のように言葉だけで済ませず、必ず実際のURL文字列（https://から始まる全体）をメッセージ本文にそのまま貼り付ける
- URLは省略・短縮せず、上記のURLを一字一句そのまま使う

出し方の例：「りょうたさんが温泉に行きたいって言ってたじゃないですか😊 よかったらこちらからどうぞ🌱
${BASE}&pid=892628809」
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
    lifeCard: { keywords: [], threads: [], lastGeneratedAt: 0 }, // 人生のカード
    ayumi: { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 }, // あゆみの記録
    pendingAyumiNudge: null, // 収穫/新しい見立てが起きた直後、次のターンで一度だけあゆみ記述を促すためのフラグ
  };
  }
  // 二重JSON.stringifyに対応して最大3回parseする
  let data = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof data === 'string') { data = JSON.parse(data); continue; }
    if (data && typeof data === 'object' && data.value !== undefined) { data = data.value; continue; }
    break;
  }
  if (typeof data === 'string') data = JSON.parse(data);
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
    lifeCard: (data.lifeCard && typeof data.lifeCard === "object")
      ? { keywords: Array.isArray(data.lifeCard.keywords) ? data.lifeCard.keywords : [],
          threads: Array.isArray(data.lifeCard.threads) ? data.lifeCard.threads : [],
          lastGeneratedAt: data.lifeCard.lastGeneratedAt || 0 }
      : { keywords: [], threads: [], lastGeneratedAt: 0 },
    ayumi: (data.ayumi && typeof data.ayumi === "object")
      ? { pastParagraphs: Array.isArray(data.ayumi.pastParagraphs) ? data.ayumi.pastParagraphs : [],
          futureSection: data.ayumi.futureSection || null,
          lastOpenedAt: data.ayumi.lastOpenedAt || 0 }
      : { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 },
    pendingAyumiNudge: data.pendingAyumiNudge || null,
    lastMessageAt: Date.now(),
    yokanSessionDone: data.yokanSessionDone || false,
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

// Vercelの自動bodyParserを無効化し、生のリクエストボディをそのまま読む
// （LINEの署名は生バイト列に対して計算されるため、JSON.stringify(req.body)による
//   再構築では絵文字や文字の並びのズレで一致しない場合があり、稀に403になっていた）
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "ASTOme Bot is running! 🌱" });
  }

  const signature = req.headers["x-line-signature"];
  const rawBody = await getRawBody(req);

  if (!line.validateSignature(rawBody, lineConfig.channelSecret, signature)) {
    console.error("署名検証に失敗しました", {
      hasSignatureHeader: !!signature,
      rawBodyLength: rawBody.length,
      hasChannelSecret: !!lineConfig.channelSecret,
      channelSecretLength: (lineConfig.channelSecret || "").length,
      userAgent: req.headers["user-agent"] || null,
    });
    return res.status(403).json({ error: "Invalid signature" });
  }

  const parsedBody = JSON.parse(rawBody);
  const events = parsedBody.events;

  for (const event of events) {

    // ── 友達追加イベント：ウェルカムボタンを送る ──
    if (event.type === "follow") {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: "template",
          altText: "はじめまして😊 ぼくはアストです🐋",
          template: {
            type: "buttons",
            title: "はじめまして😊",
            text: "90秒だけ、少し未来を覗いてみませんか？👀",
            actions: [{
              type: "postback",
              label: "🌱 90秒だけ未来を覗いてみる",
              data: "action=start_yokan",
              displayText: "🌱 90秒だけ未来を覗いてみる",
            }]
          }
        }]
      });
      continue;
    }

    // ── postbackイベント：予感セッション ──
    if (event.type === "postback") {
      const params = new URLSearchParams(event.postback.data);
      const action = params.get("action");
      const userId = event.source.userId;

      if (action === "start_yokan") {
        // Phase1：共鳴 + 先を見るボタン
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: "template",
            altText: "毎日、考えることがたくさんありますよね",
            template: {
              type: "buttons",
              text: "「自分が楽しみにできること」って、後回しになりがちじゃないですか？🌱\nよかったら、少しだけ覗いていきませんか😊",
              actions: [{
                type: "postback",
                label: "👀 少し先を見てみる",
                data: "action=yokan_p2",
                displayText: "少し先を見てみる",
              }]
            }
          }]
        });
        continue;
      }

      if (action === "yokan_p2") {
        // Phase2：予感 + 半年後を覗くボタン
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: "template",
            altText: "小さな楽しみが似合う時期かもしれません",
            template: {
              type: "buttons",
              text: "実は、大きな夢より「ちょっとした楽しみ」の方が、明日を軽くしてくれたりします😊\nためしに、半年後をひとつ覗いてみましょうか👀",
              actions: [{
                type: "postback",
                label: "✨ 半年後を覗いてみる",
                data: "action=yokan_p3",
                displayText: "半年後を覗いてみる",
              }]
            }
          }]
        });
        continue;
      }

      // 予感セッションPhase3〜4用：半年後プレビューのパターン。
      // 固定1パターンだと「毎回同じ当てずっぽうの3択」に見えて没個性的だったため、
      // テイストの違う複数パターンからランダムに1つ選ぶようにした。
      const YOKAN_POOLS = [
        { text: "半年後のあなたを想像してみました👀（当たるかはわかりませんが😊）\n🏃 海辺を走っている\n♨️ 温泉街でぼーっとしている\n🍜 新しい街でご飯を食べている",
          choices: [
            { emoji: "🏃", label: "海辺を走る", seed: "海辺を走る" },
            { emoji: "♨️", label: "温泉街でのんびり", seed: "温泉街でのんびり" },
            { emoji: "🍜", label: "新しい街でご飯", seed: "新しい街でご飯" },
          ] },
        { text: "半年後のあなたを想像してみました👀（当たるかはわかりませんが😊）\n📷 知らない街をぶらぶら歩いている\n🎸 楽器を触っている\n🍶 誰かとゆっくりお酒を飲んでいる",
          choices: [
            { emoji: "📷", label: "知らない街をぶらぶら", seed: "知らない街をぶらぶら歩く" },
            { emoji: "🎸", label: "楽器を触ってみる", seed: "楽器を触ってみる" },
            { emoji: "🍶", label: "誰かとゆっくり一杯", seed: "誰かとゆっくり一杯" },
          ] },
        { text: "半年後のあなたを想像してみました👀（当たるかはわかりませんが😊）\n🏔 山の上で朝日を見ている\n📚 カフェで本を読んでいる\n🎨 何かに没頭している",
          choices: [
            { emoji: "🏔", label: "山の上で朝日を見る", seed: "山の上で朝日を見る" },
            { emoji: "📚", label: "カフェで本を読む", seed: "カフェで本を読む" },
            { emoji: "🎨", label: "何かに没頭する", seed: "何かに没頭する時間を作る" },
          ] },
        { text: "半年後のあなたを想像してみました👀（当たるかはわかりませんが😊）\n🚗 ふらっと遠出している\n🛌 何も予定のない休日を過ごしている\n🍰 甘いものをゆっくり味わっている",
          choices: [
            { emoji: "🚗", label: "ふらっと遠出する", seed: "ふらっと遠出する" },
            { emoji: "🛌", label: "何も予定のない休日", seed: "何も予定のない休日を過ごす" },
            { emoji: "🍰", label: "甘いものを味わう", seed: "甘いものをゆっくり味わう" },
          ] },
      ];

      if (action === "yokan_p3") {
        // Phase3：半年後の未来 + 気になる未来を選ぶボタン（パターンをランダムに1つ選び、pool番号をpostbackに乗せてPhase4へ渡す）
        const poolIndex = Math.floor(Math.random() * YOKAN_POOLS.length);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: "template",
            altText: "半年後のあなたを想像してみました👀",
            template: {
              type: "buttons",
              text: YOKAN_POOLS[poolIndex].text,
              actions: [{
                type: "postback",
                label: "🌱 気になる未来を選ぶ",
                data: "action=yokan_p4&pool=" + poolIndex,
                displayText: "気になる未来を選ぶ",
              }]
            }
          }]
        });
        continue;
      }

      if (action === "yokan_p4") {
        // Phase4：選択（Phase3で提示したのと同じパターンの3択を出す）
        const poolIndex = parseInt(params.get("pool"), 10);
        const pool = YOKAN_POOLS[poolIndex] || YOKAN_POOLS[0];
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: "template",
            altText: "ちょっといいかも、を選んでください",
            template: {
              type: "buttons",
              text: "どれか一つでも、「ちょっといいかも」があったら嬉しいです😊\n\n🌱 その気持ちが、未来の種になります。",
              actions: pool.choices.map(c => ({
                type: "postback",
                label: c.emoji + " " + c.label,
                data: "action=pick_seed&seed=" + encodeURIComponent(c.seed),
                displayText: c.emoji + " " + c.label,
              }))
            }
          }]
        });
        continue;
      }

      if (action === "pick_seed") {
        const seedName = params.get("seed");
        const userData = await getUserData(userId);

        // 種を保存
        if (!Array.isArray(userData.seeds)) userData.seeds = [];
        userData.seeds.push({
          name: seedName,
          category: "体験",
          stage: "discovered",
          originalWish: seedName,
          createdAt: Date.now(),
          lastMentionAt: Date.now(),
          mentionCount: 1,
        });
        // 予感セッション完了フラグ（isFirstTimeはオンボーディング完了まで残す）
        userData.yokanSessionDone = true;
        await saveUserData(userId, userData);

        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: `🌱 「${seedName}」\n\nいい種ですね😊\n\nあなたの未来を、あなたのために想像していいんですよ🌱`
            },
            {
              type: "text",
              text: "この種は、急いで育てなくても大丈夫です😊\n\n「前の続きを育てる」を押して、もう少し話してみませんか？\nアストが一緒に育てていきます🌱",
            }
          ]
        });
        continue;
      }

      // 未知のpostbackは無視
      continue;
    }

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
    // astome_v2リッチメニュー：A(話そう！)は通常の会話に任せる（ここではハンドリングしない）。
    // B・Cはユーザー専用データが要るためテキスト経由でuserId付きURLを組み立てる。
    // D（使い方）はLINE側で直接リンクに設定済みなので、ここには届かない。
    // 旧リッチメニューの文言も互換のため残す。
    const richMenuActions = {
      "育てるを見る": "seeds",
      "うみを見る": "umi",
      "カレンダーを見る": "calendar", // 旧メニュー互換
      "種を見る": "seeds",            // 旧メニュー互換
      "記録を見る": "story",          // 旧メニュー互換
      "使い方を見る": null,           // 旧メニュー互換（新メニューでは直リンクのため通常は来ない）
    };
    const richMenuTab = richMenuActions[userMessage];
    if (richMenuTab !== undefined) {
      const url = richMenuTab
        ? `https://astome-bot.vercel.app/calendar.html?userId=${userId}#${richMenuTab}`
        : `https://astome-bot.vercel.app/howto.html`;
      const labels = {
        "育てるを見る": "🌱 育てている種を見る",
        "うみを見る": "🌊 うみを見る",
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

        // ユーザーに見える形で引用される可能性がある値は、内部コードのまま出さず日本語ラベルに変換する。
        // （calendar.htmlのSTATUS_LABEL/SEED_STATUSと表現を揃えている。Redis上の生データ自体は変更しない）
        const EVENT_STATUS_LABEL = { dream: "いつか", interest: "気になってる", plan: "計画中", scheduled: "予定あり" };
        const SEED_STAGE_LABEL = { discovered: "芽吹いたばかり", interested: "育ってきた", planning: "もうすぐ形になる", booked: "もうすぐ叶う" };
        const eventStatusJa = (s) => EVENT_STATUS_LABEL[s] || s;
        const seedStageJa = (s) => SEED_STAGE_LABEL[s] || s;

        // 長期ファクト（永続的な事実）
        if (Array.isArray(data.userFacts) && data.userFacts.length > 0) {
          parts.push("このユーザーについて（永続的事実）:\n" + data.userFacts.map(s => "・" + s).join("\n"));
        }

        // あゆみの記録（これまで書き足してきた人生の物語。今まで保存されるだけで会話に一切
        // 反映されていなかったため追加。過去を踏まえた提案・共感に使う。直近5件まで）
        if (data.ayumi && Array.isArray(data.ayumi.pastParagraphs) && data.ayumi.pastParagraphs.length > 0) {
          const recentParas = data.ayumi.pastParagraphs.slice(-5).map(p => "・" + (p.text || p)).join("\n");
          parts.push("あゆみの記録（これまで見えてきたこの人の物語。会話や提案の中で自然に踏まえてよい）:\n" + recentParas);
        }
        if (data.ayumi && data.ayumi.futureSection && data.ayumi.futureSection.text) {
          parts.push("あゆみの記録・今見えている未来:\n・" + data.ayumi.futureSection.text);
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
              return "・" + dateStr + " " + e.title + "（" + eventStatusJa(e.status) + "）";
            }).join("\n");
            parts.push("ユーザーの未来カレンダー:\n" + eventList);
          }
        }

        // 2. 現在の種
        if (Array.isArray(data.seeds) && data.seeds.length > 0) {
          const active = data.seeds.filter(s => s.stage !== "harvested");
          if (active.length > 0) {
            const seedList = active.map(s =>
              "・" + s.name + "（" + seedStageJa(s.stage || "discovered") + "）"
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

        // 4-2. 人生のカードの糸（オンボーディングで見つけた一貫性）
        if (data.lifeCard && Array.isArray(data.lifeCard.threads) && data.lifeCard.threads.length > 0) {
          const threadList = data.lifeCard.threads
            .map(t => "・" + t.label + (t.past ? "（これまで：" + t.past + "）" : ""))
            .join("\n");
          parts.push("人生のカードの糸:\n" + threadList);
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

        // 収穫/新しい見立て/未来の確定が起きた直後は、あゆみの記録を書き足す自然なタイミングとして具体的に促す
        // （「数日に1回程度」という曖昧な頻度指定だけでは実際にはほぼ発火しなかったため、
        //   検出可能な出来事に紐付けて確実にきっかけを作る。1回使ったら消費する）
        if (data.pendingAyumiNudge && data.pendingAyumiNudge.reason) {
          const n = data.pendingAyumiNudge;
          const reasonText = {
            harvest:   "「" + n.subject + "」が収穫されました（過去が1つ、確定した瞬間）",
            insight:   "「" + n.subject + "」という一貫したテーマが見えてきました",
            scheduled: "「" + n.subject + "」の予定が決まりました（未来が1つ、輪郭を持った瞬間）",
          }[n.reason] || ("「" + n.subject + "」について新しい動きがありました");
          const emphasis = n.reason === "scheduled"
            ? "特に、未来パートを更新する好機（過去も、繋がる糸が見えれば書いてよい）："
            : "今回の会話の中で自然な流れがあれば、あゆみの過去パートに1段落だけ書き足す：";
          parts.push(
            "【あゆみの記録：書き足しの好機】" + reasonText + "。\n" +
            emphasis + "\n" +
            "<ASTO_JSON>{\"ayumiPast\":true,\"text\":\"（3〜5文、主語を消す、断定しない、評価語を使わない）\"}</ASTO_JSON>\n" +
            "見えている未来の方向が変わった実感があれば、未来パートも上書きしてよい：\n" +
            "<ASTO_JSON>{\"ayumiFuture\":true,\"text\":\"（同様のトーンで）\"}</ASTO_JSON>\n" +
            "書く時は、表向きは別々に見える断片（種・過去の一言・今回の出来事）の間に、\n" +
            "一貫して続いているものがないか探してから書く（形が変わっただけで核は同じ、が特に良い）。\n" +
            "無理に書く必要はない。今日の会話の流れに合わなければ書かなくてよい。"
          );
        }

        const calendarRequestInstruction = isCalendarRequest
          ? [
              "【⚠️ 最優先：今のメッセージは未来カレンダーの確認リクエストです】",
              "上記の「ユーザーの未来カレンダー」の内容を読んで、そのまま箇条書きで伝えてください。",
              "リンクを送ってはいけません。カレンダーの中身を言葉で説明する。",
              "カレンダーが空の場合：「まだ未来カレンダーは空です🌱 一緒に最初の未来を探しましょう！」と返す。",
              "カレンダーに内容がある場合は、上記の「ユーザーの未来カレンダー」に実際に載っている項目だけを、そのまま日付・タイトル・statusで紹介する。",
              "そこに存在しないイベント名や日付を作り出してはいけない。",
              "紹介の形式（内容は必ず実データに置き換える）：",
              "「見てみると、こんな未来が入っていますよ😊",
              "・（日付） （タイトル）（status）",
              "どれか気になるものはありますか？🌱」",
            ].join("\n")
          : "";

        const instruction = [
          "【返答ルール - 必ず守る】",
          "返答を作る前に、以下の順で記憶をスキャンする：",
          "  1. ユーザーの未来カレンダー（あれば最優先）",
          "  2. 現在の種（特に成長中の種）",
          "  3. あゆみの記録（この人の物語。新しい提案をする時、この物語の続きに見える形を意識する）",
          "  4. 最近の会話まとめ",
          "  5. このユーザーについて（永続的事実）",
          "",
          "ユーザーの今のメッセージが、上記のいずれかに関連していたら、",
          "新しい質問をする前に、必ずその記憶を引用してから返す。",
          "",
          "例：ユーザー「疲れた」 → 記憶に「鬼怒川温泉(plan)」がある",
          "NG：「最近気になってることありますか？」（記憶を無視）",
          "OK：「おつかれさまです😊 そういえば9月の鬼怒川温泉、楽しみですね🌱」（記憶を活用）",
          "",
          "関連する記憶が全くない時だけ、新しい話題を振っていい。",
          "",
          "【⚠️ 最重要・捏造禁止】",
          "上記のリスト（未来カレンダー・種・会話まとめ・永続的事実）に存在しない、",
          "具体的な大会名・目標タイム・日付・エントリー状況などを、絶対に自分で作り出してはいけない。",
          "このプロンプト内のJSON出力形式のサンプル例（括弧やダミー値で示されているもの）は、",
          "出力フォーマットを示すためだけのものであり、このユーザーの実際の記憶では絶対にない。",
          "サンプル例の内容を、このユーザーが本当に言ったことのように話してはいけない。",
          "ユーザーが名前を出したイベント・種が、上記のリストのどこにも見つからない場合は、",
          "覚えているふりをせず、素直に確認する。",
          "例：「〇〇について話したい」→ リストに見つからない場合",
          "NG：（存在しない過去の計画をでっち上げて）「〇〇に向けて、5時間切りを目標にしてましたよね」",
          "OK：「〇〇、気になるんですね😊 どんなイベントなんですか？」",
          "",
          "【⚠️ 実在の人物・実在イベントの詳細は、記憶にあっても慎重に扱う】",
          "上記の記憶（会話まとめ・永続的事実など）の中に、実在の人物名や大会の詳細",
          "（ゲスト出演・日程・出場有無など）が含まれていても、それが本当に確認済みの事実とは限らない。",
          "過去の会話でASTO自身が不確かなまま話してしまった内容が、そのまま記憶に残っている場合がある。",
          "そうした具体的な固有名詞は、今のユーザーの発言と直接関係がない限り、自分から話題に出さない。",
          "ユーザーが直接尋ねてきた時だけ、「前にそんな話をした気がするけど、確認できてないので念のため公式で見てみてください」",
          "のように、記憶自体への留保をつけて答える。",
          "例：ユーザー「今週20km走った」（人物名などへの言及なし）",
          "NG：「そういえば〇〇さんがゲストで来るんですね」（無関係な記憶を自分から持ち出す）",
          "OK：「20km、走り込めてますね😊 本番に向けていい調子ですね🌱」（今の発言だけに応える）",
        ].join("\n");

        if (calendarRequestInstruction) {
          return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + calendarRequestInstruction + "\n\n---\n\n" + instruction;
        }

        return "\n\n---\n\n" + parts.join("\n---\n") + "\n---\n\n" + instruction;
      }

      // アフィリエイトセクションは「種や未来イベントが何かある時」は常に渡す
      // 実際に出すかどうかの判断（会話の文脈・ユーザーの発言）はプロンプト側の条件に委ねる
      // ※以前はstage/statusで絞っていたが、二重ゲートになり取りこぼしの原因になっていたため撤廃
      const hasGrowingSeed =
        Array.isArray(userData.seeds) && userData.seeds.length > 0;
      const hasPlannedEvent =
        Array.isArray(userData.futureEvents) && userData.futureEvents.length > 0;
      const shouldIncludeAffiliate = hasGrowingSeed || hasPlannedEvent;

      // オンボーディング現在ステップ判定
      // assistant の返信回数で次に何を聞くべきか決まる
      function buildOnboardingContext(data) {
        if (!data.isFirstTime) return "";
        if (!data.userName) {
          return "\n\n【現在のステップ】ステップ0：名前を聞いてください。";
        }
        const assistantCount = (data.messages || []).filter(m => m.role === "assistant").length;
        const hasThreads = data.lifeCard && Array.isArray(data.lifeCard.threads) && data.lifeCard.threads.length > 0;
        const hasSeed = Array.isArray(data.seeds) && data.seeds.length > 0;

        // assistantCount=1（名前を受け取った返事だけ）→ 次は人生のカードの案内
        if (assistantCount <= 1) {
          return "\n\n【現在のステップ】ステップ1：人生のカードを案内し、これまでを表す言葉（キーワード）をいくつか出してもらってください。テキスト入力メイン、選択肢は呼び水程度。深掘りしない。";
        }
        // キーワードを受け取ったがまだ糸を出していない → 糸の生成
        if (!hasThreads) {
          return "\n\n【現在のステップ】ステップ2：受け取ったキーワードから2〜3本の糸を発見形で提示し、<ASTO_JSON>{\"lifeCard\":true,...}</ASTO_JSON>で保存してください。断定・タイプ分け禁止。キーワードが1〜2個しかない場合はもう少しだけ促す。";
        }
        // 糸は出したが種がまだ → 選択・深掘り・種保存へ
        if (!hasSeed) {
          return "\n\n【現在のステップ】ステップ3〜4：気になる糸を選んでもらい、1〜2往復だけ深掘りして、必ず<ASTO_JSON>{\"seed\":true,...,\"nextStep\":\"...\"}</ASTO_JSON>で最初の種を1個保存してください。締めは断定せず『また明日』で終わる。";
        }
        // 種まで保存済み → 温かく締める
        return "\n\n【現在のステップ】仕上げ：最初の種が見つかりました。温かく締めて『また明日、続きを話しましょう🌱』で終わってください。";
      }

// 変更後
// チェックイン中のターン数（assistantの返信回数）
const checkinTurnCount = userData.isFirstTime
  ? 0
  : userData.messages.filter(m => m.role === "assistant").length;

// 16ターン以上（約30分相当）で締めを促す注入
const forcedEndingNote = !userData.isFirstTime && checkinTurnCount >= 16
  ? "\n\n【強制締め】今日の会話はかなり長くなっています。次のメッセージで必ず温かく締めてください。新しい話題を振らない。種・未来イベントの保存だけして終わる。"
  : "";

const systemPrompt = userData.isFirstTime
  ? ONBOARDING_PROMPT(userData.userName) + buildOnboardingContext(userData)
  : CHECKIN_PROMPT(userData.userName) + buildUserContext(userData) + (shouldIncludeAffiliate ? buildAffiliateSection() : "") + forcedEndingNote;

// あゆみ促進フラグは1ターン分のプロンプトに反映したら消費する（毎ターン促し続けない）
if (userData.pendingAyumiNudge) userData.pendingAyumiNudge = null;

      userData.messages.push({
        role: "user",
        content: userMessage,
      });

      const recentMessages = userData.messages.slice(-20);

const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1300, // 会話文+複数のASTO_JSONタグ(userFacts/conversationSummary/seed/futureEvent等)が
                     // 同じターンに重なると800では閉じタグの前に打ち切られることがあったため引き上げ
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

// web_search（サーバー実行）は1ターンの中で最大2回検索することがあり、
// response.content には「検索前に書いたtext」「検索結果」「検索後に書き直したtext」が
// 混在する。単純に全text blockをjoinすると、検索前の下書き的な発言（不確かなまま書いた内容）と
// 検索後の発言が矛盾したまま1つのメッセージに繋がって送られてしまうバグがあった
// （例：「わからないです」の直後に「本当だ、〇〇なんですね」と自己矛盾する）。
// 最後のtool関連ブロック（text以外）より後のtextだけを、検索を踏まえた最終回答として採用する。
let lastNonTextIndex = -1;
response.content.forEach((block, i) => {
  if (block.type !== "text") lastNonTextIndex = i;
});
const rawReply = response.content
  .filter((block, i) => block.type === "text" && i > lastNonTextIndex)
  .map(block => block.text)
  .join("");

      // JSON検知（カレンダー・シェア・種・ゴール）
      let replyText = rawReply;
      let calendarUrl = null;
      let shareUrl = null;
      let mapUrl = null;
      let searchRequestQuery = null;

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

          // 地図（会話に出た店・施設・スポットをワンタップで地図へ）
          if (data.map && data.query) {
            const q = encodeURIComponent(data.query);
            mapUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
            replyText = replyText.replace(match[0], "").trim();
            if (!replyText) replyText = "地図を用意しました😊 タップして見てみてください🌱";
          }

          // おすすめ検索リクエスト（非同期）
          if (data.searchRequest && data.query) {
            searchRequestQuery = data.query;
            replyText = replyText.replace(match[0], "").trim();
            if (!replyText) replyText = data.ackText || "探してみますね🔍 ちょっと待っててください！";
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
            // astoMessageを追加（その人専用の一言）
            if (data.astoMessage) newSeed.astoMessage = data.astoMessage;
            // 目安の時期（今月中/数ヶ月以内/今年中には/いつか）
            if (data.roughTiming) newSeed.roughTiming = data.roughTiming;
            // 支度（準備タスク）[{text,done}]
            if (Array.isArray(data.preparations)) newSeed.preparations = data.preparations;
            // 次の一歩（延長線上の1つの提案）
            if (data.nextStep) newSeed.nextStep = data.nextStep;
            // どの人生のカードの糸から生まれた種か（付録Aの橋渡し仕様）
            if (data.sourceThread) newSeed.sourceThread = data.sourceThread;

            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const existing = userData.seeds.findIndex(s => s.name === data.name);
            if (existing >= 0) {
              userData.seeds[existing].lastMentionAt = Date.now();
              userData.seeds[existing].mentionCount = (userData.seeds[existing].mentionCount || 1) + 1;
              if (data.stage) userData.seeds[existing].stage = data.stage;
              if (data.confidence) userData.seeds[existing].confidence = data.confidence;
              // astoMessageは新しいものがあれば更新（会話が深まるたびに進化）
              if (data.astoMessage) userData.seeds[existing].astoMessage = data.astoMessage;
              // originalWishは最初の言葉のみ保存（解像度が上がっても上書きしない）
              if (!userData.seeds[existing].originalWish && data.originalWish) {
                userData.seeds[existing].originalWish = data.originalWish;
              }
              // roughTiming・nextStepは新しい値で更新（時期や次の一歩は変わりうる）
              if (data.roughTiming) userData.seeds[existing].roughTiming = data.roughTiming;
              if (data.nextStep) userData.seeds[existing].nextStep = data.nextStep;
              // preparationsは done状態を保持しつつマージ（同じtextは上書きしない）
              if (Array.isArray(data.preparations)) {
                if (!Array.isArray(userData.seeds[existing].preparations)) userData.seeds[existing].preparations = [];
                const cur = userData.seeds[existing].preparations;
                data.preparations.forEach(p => {
                  if (p && p.text && !cur.some(c => c.text === p.text)) {
                    cur.push({ text: p.text, done: !!p.done });
                  }
                });
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

          // 文字2-gramの「包含率」で「言い回し違いの同じ内容」を検出する簡易関数。
          // userFacts/conversationSummaryは自由記述文なので完全一致(旧ロジック)では
          // 「11月アクアラインマラソンエントリー済み」と「アクアラインマラソン2026年11月エントリー済み」
          // のような表現ゆれを別内容として扱ってしまい、無限に重複蓄積するバグがあった。
          // Jaccard(和集合基準)ではなく短い方基準の包含率にすることで、
          // 「要約が徐々に詳しくなっていく」パターンもより拾えるようにしている。
          function textSimilarity(a, b) {
            const norm = (s) => (s || "").replace(/[\s、。・！？!?,.]/g, "");
            const bigrams = (s) => {
              const set = new Set();
              for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
              return set;
            };
            const na = norm(a), nb = norm(b);
            if (!na || !nb) return 0;
            const sa = bigrams(na), sb = bigrams(nb);
            let overlap = 0;
            sa.forEach(g => { if (sb.has(g)) overlap++; });
            const minSize = Math.min(sa.size, sb.size);
            return minSize > 0 ? overlap / minSize : 0;
          }
          const SIMILARITY_THRESHOLD = 0.6;
          // 類似項目があれば新しい表現で上書き、なければ追加する（配列は上限件数を超えたら古い方から削除）
          function upsertSimilar(list, item, maxLen) {
            const idx = list.findIndex(existing => textSimilarity(existing, item) >= SIMILARITY_THRESHOLD);
            if (idx >= 0) {
              list[idx] = item; // 新しい表現に更新（重複追加はしない）
            } else {
              list.push(item);
            }
            while (list.length > maxLen) list.shift();
          }

          // 会話要約の蓄積（類似重複はマージ・最新20件まで）
          if (data.conversationSummary) {
            if (!Array.isArray(userData.conversationSummary)) userData.conversationSummary = [];
            const items = Array.isArray(data.conversationSummary)
              ? data.conversationSummary
              : [data.conversationSummary];
            items.forEach(item => {
              if (item) upsertSimilar(userData.conversationSummary, item, 20);
            });
            replyText = replyText.replace(match[0], "").trim();
          }

          // 長期ファクトの蓄積（永続・類似重複はマージ・最新25件まで）
          if (data.userFacts) {
            if (!Array.isArray(userData.userFacts)) userData.userFacts = [];
            const facts = Array.isArray(data.userFacts) ? data.userFacts : [data.userFacts];
            facts.forEach(item => {
              if (item) upsertSimilar(userData.userFacts, item, 25);
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
              // 新しいテーマの発見も「一貫した糸が見えた」瞬間なので、収穫と同様に次のターンで促す
              // （すでに収穫由来の保留中ナッジがある場合はそちらを優先し、上書きしない）
              if (!userData.pendingAyumiNudge) {
                userData.pendingAyumiNudge = { reason: "insight", subject: data.theme, at: Date.now() };
              }
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
              scene: data.scene || null,
              closingMessage: data.closingMessage || null,
              milestones: Array.isArray(data.milestones) ? data.milestones : [],
              todayStep: data.todayStep || null,
              createdAt: now,
              history: [{ status: initialStatus, at: now }],
            };
            if (!Array.isArray(userData.futureEvents)) userData.futureEvents = [];
            // id優先、なければtitleのみで検索（sourceSeedはモデルが毎回表現を変えるため
            // 同一性の判定に使わない。以前はtitle+sourceSeed一致を要求しており、
            // sourceSeedの言い回しが微妙に違うだけで別イベントとして二重保存されるバグがあった）
            const normTitle = (s) => (s || "").trim();
            const existingEvent = userData.futureEvents.findIndex(e =>
              data.id ? e.id === data.id : normTitle(e.title) === normTitle(data.title)
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
              if (data.scene) ev.scene = data.scene;
              if (data.closingMessage) ev.closingMessage = data.closingMessage;
              if (Array.isArray(data.milestones) && data.milestones.length > 0) ev.milestones = data.milestones;
              if (data.todayStep) ev.todayStep = data.todayStep;
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

          // === 支度：提案一覧を合意した時点でまとめて保存 ===
          // items は文字列 or {text,date} の配列を許容
          // <ASTO_JSON>{"preparationSet":true,"seedName":"...","items":[{"text":"日付を決める","date":"2026-10"},"宿を探す"]}</ASTO_JSON>
          if (data.preparationSet && data.seedName && Array.isArray(data.items)) {
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const si = userData.seeds.findIndex(s => s.name === data.seedName);
            if (si >= 0) {
              const prevPreps = Array.isArray(userData.seeds[si].preparations) ? userData.seeds[si].preparations : [];
              userData.seeds[si].preparations = data.items
                .map(it => (typeof it === "string" ? { text: it } : it))
                .filter(it => it && it.text)
                .map(it => {
                  const prev = prevPreps.find(p => p.text === it.text);
                  const rec = { text: it.text, done: prev ? !!prev.done : false };
                  if (it.date) rec.date = it.date;
                  else if (prev && prev.date) rec.date = prev.date;
                  if (it.wantsDate) rec.wantsDate = true;
                  return rec;
                });
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 支度：1件追加（date対応） ===
          // <ASTO_JSON>{"preparation":true,"seedName":"...","text":"...","date":"2026-10"}</ASTO_JSON>
          if (data.preparation && data.seedName && data.text) {
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const si = userData.seeds.findIndex(s => s.name === data.seedName);
            if (si >= 0) {
              if (!Array.isArray(userData.seeds[si].preparations)) userData.seeds[si].preparations = [];
              const exist = userData.seeds[si].preparations.find(p => p.text === data.text);
              if (exist) {
                if (data.date) exist.date = data.date;
                if (typeof data.done === "boolean") exist.done = data.done;
              } else {
                const rec = { text: data.text, done: !!data.done };
                if (data.date) rec.date = data.date;
                userData.seeds[si].preparations.push(rec);
              }
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 次の一歩：既存の種に単体タグで追記 ===
          // <ASTO_JSON>{"nextStep":"...","seedName":"..."}</ASTO_JSON>
          // 以前はプロンプトに例だけあって処理コードが存在せず、出力しても何も保存されない
          // 「死んだ例文」だった。data.seedがある場合（フル種JSON）はそちら側で既に処理されるため、
          // ここではdata.seedがない単体タグの場合のみ処理する
          if (data.nextStep && data.seedName && !data.seed) {
            if (!Array.isArray(userData.seeds)) userData.seeds = [];
            const si = userData.seeds.findIndex(s => s.name === data.seedName);
            if (si >= 0) userData.seeds[si].nextStep = data.nextStep;
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 支度：日付だけ更新 ===
          // <ASTO_JSON>{"prepDate":true,"seedName":"...","text":"...","date":"2026-10-15"}</ASTO_JSON>
          if (data.prepDate && data.seedName && data.text) {
            if (Array.isArray(userData.seeds)) {
              const si = userData.seeds.findIndex(s => s.name === data.seedName);
              if (si >= 0 && Array.isArray(userData.seeds[si].preparations)) {
                const p = userData.seeds[si].preparations.find(p => p.text === data.text);
                if (p) p.date = data.date || null;
              }
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 支度：完了/未完了の切り替え ===
          // <ASTO_JSON>{"prepComplete":true,"seedName":"...","text":"...","done":true}</ASTO_JSON>
          if (data.prepComplete && data.seedName && data.text) {
            if (Array.isArray(userData.seeds)) {
              const si = userData.seeds.findIndex(s => s.name === data.seedName);
              if (si >= 0 && Array.isArray(userData.seeds[si].preparations)) {
                const pi = userData.seeds[si].preparations.findIndex(p => p.text === data.text);
                if (pi >= 0) userData.seeds[si].preparations[pi].done = data.done !== false;
              }
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 目安の時期だけを更新 ===
          // <ASTO_JSON>{"roughTiming":true,"seedName":"...","timing":"今年中には"}</ASTO_JSON>
          if (data.roughTiming === true && data.seedName && data.timing) {
            if (Array.isArray(userData.seeds)) {
              const si = userData.seeds.findIndex(s => s.name === data.seedName);
              if (si >= 0) userData.seeds[si].roughTiming = data.timing;
            }
            replyText = replyText.replace(match[0], "").trim();
          }

          // === 人生のカード：キーワードと糸を保存 ===
          // <ASTO_JSON>{"lifeCard":true,"keywords":[...],"threads":[{...}]}</ASTO_JSON>
          if (data.lifeCard) {
            if (!userData.lifeCard || typeof userData.lifeCard !== "object") {
              userData.lifeCard = { keywords: [], threads: [], lastGeneratedAt: 0 };
            }
            if (Array.isArray(data.keywords)) {
              data.keywords.forEach(k => {
                if (k && !userData.lifeCard.keywords.includes(k)) userData.lifeCard.keywords.push(k);
              });
            }
            if (Array.isArray(data.threads)) {
              data.threads.forEach(t => {
                if (!t || !t.label) return;
                const ex = userData.lifeCard.threads.findIndex(x => x.label === t.label);
                const rec = {
                  id: t.id || ("thread_" + Date.now() + "_" + Math.random().toString(36).slice(2,5)),
                  label: t.label,
                  past: t.past || "",
                  future: t.future || "",
                  status: t.status || "proposed",
                  sourceKeywords: Array.isArray(t.sourceKeywords) ? t.sourceKeywords : [],
                };
                if (ex >= 0) userData.lifeCard.threads[ex] = { ...userData.lifeCard.threads[ex], ...rec };
                else userData.lifeCard.threads.push(rec);
              });
            }
            userData.lifeCard.lastGeneratedAt = Date.now();
            replyText = replyText.replace(match[0], "").trim();
          }

          // === あゆみの記録：過去パート（追記のみ） ===
          // <ASTO_JSON>{"ayumiPast":true,"text":"..."}</ASTO_JSON>
          if (data.ayumiPast && data.text) {
            if (!userData.ayumi || typeof userData.ayumi !== "object") {
              userData.ayumi = { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 };
            }
            if (!Array.isArray(userData.ayumi.pastParagraphs)) userData.ayumi.pastParagraphs = [];
            userData.ayumi.pastParagraphs.push({
              id: "p" + (userData.ayumi.pastParagraphs.length + 1),
              text: data.text,
              createdAt: Date.now(),
            });
            replyText = replyText.replace(match[0], "").trim();
          }

          // === あゆみの記録：未来パート（都度上書き） ===
          // <ASTO_JSON>{"ayumiFuture":true,"text":"..."}</ASTO_JSON>
          if (data.ayumiFuture && data.text) {
            if (!userData.ayumi || typeof userData.ayumi !== "object") {
              userData.ayumi = { pastParagraphs: [], futureSection: null, lastOpenedAt: 0 };
            }
            userData.ayumi.futureSection = { text: data.text, updatedAt: Date.now() };
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
              // 収穫は「あゆみの記録」を書き足す自然なタイミングなので、
              // 次のターンで一度だけ具体的に促す（このターン内では手遅れなので次回に持ち越す）
              userData.pendingAyumiNudge = { reason: "harvest", subject: data.seed, at: harvestedAt };
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
                // 「予定あり」に進むのは、ぼんやりしていた未来が輪郭を持つ節目。
                // 収穫（過去の確定）と対になる「未来の確定」の瞬間として、あゆみ促進フラグを立てる
                // （収穫由来の保留中ナッジがある場合はそちらを優先し、上書きしない）
                if (data.status === "scheduled" && !userData.pendingAyumiNudge) {
                  userData.pendingAyumiNudge = { reason: "scheduled", subject: event.title, at: now };
                }
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
          // LLMが配列形式{"nextAction":["...",""]}で返すケースにも対応
          if (data.nextAction) {
            if (!Array.isArray(userData.nextActions)) userData.nextActions = [];
            const actionTexts = Array.isArray(data.nextAction)
              ? data.nextAction
              : data.text ? [data.text]
              : [];
            actionTexts.forEach(text => {
              if (!text) return;
              const exists = userData.nextActions.some(
                a => a.text === text && a.status === "pending"
              );
              if (!exists) {
                userData.nextActions.push({
                  text,
                  status: "pending",
                  createdAt: Date.now(),
                  completedAt: null,
                });
              }
            });
            replyText = replyText.replace(match[0], "").trim();
          }
        }
      } catch (e) {
        // JSON解析失敗はそのままテキストとして扱う
      }

      // 最終安全網：パース・処理の成否にかかわらず残留タグを除去
      replyText = replyText.replace(/<ASTO_JSON>.*?<\/ASTO_JSON>/gs, "").trim();

      // 追加の安全網：max_tokens打ち切り等で</ASTO_JSON>が生成される前に応答が切れた場合、
      // 上の正規表現（開始・終了タグの両方が必要）はマッチせずJSON片が生テキストとして
      // ユーザーに送られてしまうバグがあった。閉じタグの有無に関わらず、
      // <ASTO_JSON>が出現した時点から先は表示すべきでない内部データとして丸ごと切り捨てる。
      const unclosedTagIndex = replyText.indexOf("<ASTO_JSON>");
      if (unclosedTagIndex >= 0) {
        replyText = replyText.slice(0, unclosedTagIndex).trim();
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
      if (false && balanceDelta > 0) {
        // 未来残高表示は廃止
        // summaryLines.push(`未来残高 +${balanceDelta}pt → ${balanceAfter}pt`);
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

      // 安全網：検索のみで終わるターン等でreplyTextが空文字列になることがある。
      // LINEの送信APIは空のtextメッセージを受け付けずエラーになり、
      // それが原因で「ちょっとうまく聞き取れなかった」という無関係なエラー文言が
      // 出てしまうバグがあった。空の場合はここで必ず何か入れる。
      if (!replyText || !replyText.trim()) {
        replyText = "うんうん、そうなんですね😊";
      }

      // カレンダー・シェア・地図ボタンの組み立て
      let replyMessages;
      if (calendarUrl || shareUrl || mapUrl) {
        const actions = [];
        if (calendarUrl) {
          actions.push({ type: "uri", label: "📅 カレンダーに追加", uri: calendarUrl });
        }
        if (mapUrl) {
          actions.push({ type: "uri", label: "📍 地図で見る", uri: mapUrl });
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

// オンボーディングが今のターンで完了した瞬間だけ、
// あゆみ（今日書かれた最初の章）と使い方ページへの案内を追加する
// （LINEのみで完結していて、アプリの存在を一度も伝えていなかったため追加）
if (isFirstCheckinMessage && replyMessages.length < 5) {
  replyMessages.push({
    type: "template",
    altText: "あゆみと使い方はこちらから",
    template: {
      type: "buttons",
      text: "今日見つけたこと、もう「あゆみ」に書き足してあります📖\nよかったら覗いてみてください🌱",
      actions: [
        { type: "uri", label: "📖 あゆみを見る", uri: `https://astome-bot.vercel.app/calendar.html?userId=${userId}#story` },
        { type: "uri", label: "💡 使い方を見る", uri: `https://astome-bot.vercel.app/howto.html` },
      ]
    }
  });
}

await client.replyMessage({
        replyToken: replyToken,
        messages: replyMessages,
      });

      // おすすめ検索リクエストがあれば、裏で非同期処理へ委譲する（結果を待たない）
      if (searchRequestQuery) {
        const baseUrl = process.env.DEFERRED_SEARCH_BASE_URL
          || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://astome-bot.vercel.app");
        fetch(`${baseUrl}/api/deferred-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
          },
          body: JSON.stringify({ userId, query: searchRequestQuery }),
        }).catch((err) => {
          console.error("deferred-search dispatch failed:", err);
        });
        // ↑ awaitしない：LINEへの200レスポンスをブロックしないため
      }

    } catch (error) {
      console.error("Error:", error);

      let errorMessage = "ごめんね、うまく処理できませんでした😅 もう一度送ってみてください！";

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
