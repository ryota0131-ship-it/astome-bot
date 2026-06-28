// api/remind.js
// cron-job.orgから毎晩21時に呼ばれるエンドポイント

import * as line from "@line/bot-sdk";

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const redis = {
  async get(key) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    );
    const data = await res.json();
    return data.result ?? null;
  },
  async keys(pattern) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/keys/${encodeURIComponent(pattern)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    );
    const data = await res.json();
    return data.result ?? [];
  },
};

// 経過日数・種データからメッセージを決定する
function buildReminderMessage(name, daysSince, seeds) {
  const n = name ? `${name}、` : "";

  // 種があれば使える種名を取得（harvested以外）
  const activeSeed = Array.isArray(seeds)
    ? seeds.find(s => s.stage !== "harvested")
    : null;
  const seedName = activeSeed ? activeSeed.name : null;

  // 1日
  if (daysSince <= 1) {
    return `${n}今日は新しい気づきありましたか？🌱`;
  }

  // 2〜3日
  if (daysSince <= 3) {
    return `${n}元気にしてますか？😊 少し時間があったら、明日のこと話しませんか？`;
  }

  // 4〜6日：種があれば引用
  if (daysSince <= 6) {
    if (seedName) {
      return `${n}「${seedName}」の種、育ってますか？🌱`;
    }
    return `${n}最近気になってることはありますか？🐋`;
  }

  // 7〜29日：複数パターンをローテーション
  if (daysSince <= 29) {
    const patterns = [
      `${n}しばらく話してないけど、元気にしてますか？😊`,
      `${n}明日を楽しみに生きていますか？🌱 アストはいつでもいますよ。`,
      seedName
        ? `${n}「${seedName}」のこと、なんとなく覚えてるよ🐋 また話せたら嬉しいな。`
        : `${n}最近どうですか。ふと気になりました😊`,
      `${n}最近どうですか。ふと気になりました😊`,
    ];
    // daysSinceを使ってローテーション（毎回同じにならないように）
    const index = Math.floor(daysSince / 2) % patterns.length;
    return patterns[index];
  }

  // 30日以上
  return `${n}気が向いたらまた話しましょう🌊 アストはここにいます。`;
}

// 今日送信すべきかどうかを判定
function shouldSendToday(daysSince) {
  // 1〜6日：毎日
  if (daysSince <= 6) return true;

  // 7〜29日：2日に1回
  if (daysSince <= 29) return daysSince % 2 === 0;

  // 30日以上：週1回（日曜）
  const dayOfWeek = new Date().getDay(); // 0=日曜
  return dayOfWeek === 0;
}

export default async function handler(req, res) {
  // 認証チェック
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log("Auth failed. received:", authHeader, "expected:", `Bearer ${process.env.CRON_SECRET}`);
    return res.status(401).json({ error: "Unauthorized", received: authHeader });
  }

  try {
    const keys = await redis.keys("user:*");
    console.log(`リマインダー対象ユーザー数: ${keys.length}`);

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let sentCount = 0;
    let skippedCount = 0;

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;

      const userData = typeof raw === "string" ? JSON.parse(raw) : raw;

      // オンボーディング未完了はスキップ
      if (userData.isFirstTime) continue;

      // 最後の会話から24時間未満はスキップ
      const lastMessageAt = userData.lastMessageAt || 0;
      const daysSince = Math.floor((now - lastMessageAt) / ONE_DAY);
      if (daysSince < 1) {
        skippedCount++;
        continue;
      }

      // 頻度判定：今日送るべきかチェック
      if (!shouldSendToday(daysSince)) {
        skippedCount++;
        continue;
      }

      const userId = key.replace("user:", "");
      const message = buildReminderMessage(userData.userName, daysSince, userData.seeds);

      await client.pushMessage({
        to: userId,
        messages: [{ type: "text", text: message }],
      });

      sentCount++;
      console.log(`送信: ${userId} (${daysSince}日経過) → ${message}`);
    }

    res.status(200).json({ status: "ok", sent: sentCount, skipped: skippedCount });
  } catch (error) {
    console.error("リマインダーエラー:", error);
    res.status(500).json({ error: error.message });
  }
}
