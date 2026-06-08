// api/remind.js
// Vercel Cron Jobから毎晩21時に呼ばれるエンドポイント

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

export default async function handler(req, res) {
  // Cron Jobからのリクエストのみ許可
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 全ユーザーのキーを取得
    const keys = await redis.keys("user:*");
    console.log(`リマインダー対象ユーザー数: ${keys.length}`);

    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    let sentCount = 0;

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;

      const userData = typeof raw === "string" ? JSON.parse(raw) : raw;

      // オンボーディング未完了のユーザーはスキップ
      if (userData.isFirstTime) continue;

      // 最後の会話から24時間以上経っているか確認
      const lastMessageAt = userData.lastMessageAt || 0;
      if (now - lastMessageAt < TWENTY_FOUR_HOURS) continue;

      // LINEユーザーIDをキーから取得（user:{userId}）
      const userId = key.replace("user:", "");

      // プッシュ通知送信
      const name = userData.userName ? `${userData.userName}さん、` : "";
      await client.pushMessage({
        to: userId,
        messages: [
          {
            type: "text",
            text: `${name}こんばんは😊 今日は何かに出会えましたか？`,
          },
        ],
      });

      sentCount++;
      console.log(`送信: ${userId}`);
    }

    res.status(200).json({ status: "ok", sent: sentCount });
  } catch (error) {
    console.error("リマインダーエラー:", error);
    res.status(500).json({ error: error.message });
  }
}
