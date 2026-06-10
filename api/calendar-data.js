// api/calendar-data.js
// GETリクエストでuserIdを受け取り、Redisからデータを返す

const redis = {
  async get(key) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    );
    const data = await res.json();
    return data.result ?? null;
  },
};

export default async function handler(req, res) {
  // CORS設定（LINEのWebViewから開く場合に必要）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const raw = await redis.get(`user:${userId}`);
    if (!raw) {
      return res.status(200).json({
        userName: null,
        futureEvents: [],
        seeds: [],
        harvestedSeeds: [],
        futureBalanceHistory: [],
      });
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    // 必要なデータだけ返す（messagesなどは除外）
    return res.status(200).json({
      userName: data.userName || null,
      futureEvents: data.futureEvents || [],
      seeds: data.seeds || [],
      harvestedSeeds: data.harvestedSeeds || [],
      futureBalanceHistory: data.futureBalanceHistory || [],
    });
  } catch (error) {
    console.error("calendar-data error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
