// api/remind.js
// Vercel Cron Jobから毎晩21時に呼ばれるエンドポイント

import * as line from "@line/bot-sdk";
import { generateDaily } from '../lib/generate-daily.js';
import { generateWeekendSuggest } from '../lib/generate-weekend-suggest.js';

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
  async set(key, value) {
    const res = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", key, typeof value === "string" ? value : JSON.stringify(value)]),
    });
    await res.json();
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

// 木曜20時JSTかどうか（Vercel Cronは21時JSTに毎日走るため、本来は20時台の別枠が理想だが
// Phase 0では既存の21時枠に相乗りする形で実装。時間を分けたくなったらcron側に新しいエントリを足す）
function isThursdayJST() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.getUTCDay() === 4; // 0=日, 4=木（UTC変換後のJST時刻として扱う）
}

// 次の土日（JST基準）に、日付まで確定した予定があるか
// 【重要】futureEvents.dateは実運用上ほぼ"YYYY-MM"（月単位）でしか入らないため、
// これを日付の厳密一致で判定すると常にfalseになってしまう（=判定が機能しない）。
// 日付まで入るのは主にseed.preparations[].date（"日付を決める"項目が確定した時）なので、
// そちらを優先して見る。futureEvents.dateは、稀に日付まで入っているケース（10文字）のみ対象にする。
function hasWeekendPlan(userData) {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = jstNow.getUTCDay();
  const daysUntilSat = (6 - dow + 7) % 7;
  const sat = new Date(jstNow);
  sat.setUTCDate(jstNow.getUTCDate() + daysUntilSat);
  const sun = new Date(sat);
  sun.setUTCDate(sat.getUTCDate() + 1);
  const satStr = sat.toISOString().slice(0, 10);
  const sunStr = sun.toISOString().slice(0, 10);
  const isWeekendDate = (d) => d === satStr || d === sunStr;

  const events = Array.isArray(userData.futureEvents) ? userData.futureEvents : [];
  const eventHit = events.some(e =>
    ["plan", "scheduled"].includes(e.status) &&
    typeof e.date === "string" && e.date.length === 10 && // "YYYY-MM"(7文字)は対象外、日付まで入っている時だけ
    isWeekendDate(e.date)
  );
  if (eventHit) return true;

  const seeds = Array.isArray(userData.seeds) ? userData.seeds : [];
  return seeds.some(s =>
    Array.isArray(s.preparations) &&
    s.preparations.some(p =>
      typeof p.date === "string" && p.date.length === 10 && isWeekendDate(p.date)
    )
  );
}

// discovered種のうち直近のものを最大2件取得
function getWeekendSuggestCandidates(userData) {
  const seeds = Array.isArray(userData.seeds) ? userData.seeds : [];
  return seeds
    .filter(s => s.stage === "discovered")
    .sort((a, b) => (b.lastMentionAt || b.createdAt || 0) - (a.lastMentionAt || a.createdAt || 0))
    .slice(0, 2);
  // TODO: フラグメントバンクをRedisにアップロード後、種が0件の場合の呼び水候補ロジックをここに追加する。
  // Phase 0では種がないユーザーはスキップする（無理に絞り出させない）。
}

export default async function handler(req, res) {
  // Cron Jobからのリクエストのみ許可
  const authHeader = req.headers["authorization"];
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  console.log("Auth failed. received:", authHeader, "expected:", `Bearer ${process.env.CRON_SECRET}`);
  return res.status(401).json({ error: "Unauthorized", received: authHeader });
}

  try {
    // 全ユーザーのキーを取得
    const keys = await redis.keys("user:*");
    console.log(`リマインダー対象ユーザー数: ${keys.length}`);

    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    let sentCount = 0;
    let weekendSuggestCount = 0;
    const isThursday = isThursdayJST();

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;

      const userData = typeof raw === "string" ? JSON.parse(raw) : raw;

      // オンボーディング未完了のユーザーはスキップ
      if (userData.isFirstTime) continue;

      // LINEユーザーIDをキーから取得（user:{userId}）
      const userId = key.replace("user:", "");

      // === 木曜のみ：週末提案フローを優先判定 ===
      // 対象者には通常のリマインダーと二重送信しないよう、ここでcontinueする
      if (isThursday && !hasWeekendPlan(userData)) {
        const candidates = getWeekendSuggestCandidates(userData);
        if (candidates.length > 0) {
          const message = await generateWeekendSuggest(userData, candidates);
          if (message) {
            await client.pushMessage({
              to: userId,
              messages: [{ type: "text", text: message }],
            });

            userData.weekendSuggestPending = true;
            userData.weekendSuggestSeeds = candidates.map(s => s.name);
            await redis.set(key, userData);

            weekendSuggestCount++;
            console.log(`週末提案送信: ${userId}`);
            continue; // 同じユーザーへの通常リマインダーはスキップ
          }
        }
      }

      // === 通常の毎晩リマインダー（24時間以上会話なし） ===
      const lastMessageAt = userData.lastMessageAt || 0;
      if (now - lastMessageAt < TWENTY_FOUR_HOURS) continue;

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

    res.status(200).json({ status: "ok", sent: sentCount, weekendSuggestSent: weekendSuggestCount });
  } catch (error) {
    console.error("リマインダーエラー:", error);
    res.status(500).json({ error: error.message });
  }
}
