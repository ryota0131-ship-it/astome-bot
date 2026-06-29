// api/calendar-data.js
import { generateDaily } from '../lib/generate-daily.js';

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
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: JSON.stringify(value) }),
      }
    );
    return res.ok;
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const raw = await redis.get(`user:${userId}`);
    if (!raw) {
      return res.status(200).json({
        userName: null, futureEvents: [], seeds: [],
        harvestedSeeds: [], futureBalanceHistory: [], daily: null,
      });
    }

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const today = new Date().toISOString().slice(0, 10);

    // dailyが今日分でなければ生成してから返す
    if (!data.daily || data.daily.date !== today) {
      try {
        const daily = await generateDaily(data);
        if (daily) {
          data.daily = daily;
          await redis.set(`user:${userId}`, data);
          console.log(`daily生成完了: ${userId}`);
        }
      } catch (e) {
        console.error('daily生成エラー:', e);
        // 失敗しても前回のdailyで続行
      }
    }

    return res.status(200).json({
      userName: data.userName || null,
      futureEvents: data.futureEvents || [],
      seeds: data.seeds || [],
      harvestedSeeds: data.harvestedSeeds || [],
      futureBalanceHistory: data.futureBalanceHistory || [],
      daily: data.daily || null,
    });
  } catch (error) {
    console.error('calendar-data error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
