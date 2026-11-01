import { nowSec } from "./env";
import { HttpError } from "./http";

/** Fixed window counter in D1. Throws 429 once `limit` hits inside `windowSec`. */
export async function rateLimit(db: D1Database, bucket: string, limit: number, windowSec: number): Promise<void> {
  const now = nowSec();
  const start = now - (now % windowSec);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`
    )
    .bind(bucket, start)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    throw new HttpError(429, "rate_limited", { retry_after: start + windowSec - now });
  }
}
