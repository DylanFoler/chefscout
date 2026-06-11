import { Redis } from "@upstash/redis";
import type { Seller } from "@/lib/types";

// What we persist per region. `seen` is an array (not a Set) because the Redis
// backend JSON-serializes values — a Set would round-trip to `{}`. The route
// rebuilds a Set from it; the in-memory backend uses the same shape so both
// behave identically.
export type RegionEntry = { sellers: Seller[]; seen: string[] };

// Namespaced + versioned: avoids collisions on a shared Upstash DB and lets the
// stored shape evolve without reading stale keys. Bumped to v3 to abandon
// pre-fix cached entries (Hotplate-seller leaks, and makers cached with a fake
// followers:0); fresh scans repopulate with the current logic.
const keyFor = (region: string) => `chefscout:region:v3:${region}`;

// Regions go stale (makers come and go); expire cached discovery after 7 days.
const TTL_SECONDS = 60 * 60 * 24 * 7;

interface RegionStore {
  get(region: string): Promise<RegionEntry | null>;
  set(region: string, entry: RegionEntry): Promise<void>;
}

function createRedisStore(url: string, token: string): RegionStore {
  const redis = new Redis({ url, token });
  return {
    async get(region) {
      // Fail open: a Redis error (network/quota) is treated as a cache miss so
      // the scan still runs live instead of 500-ing.
      try {
        return (await redis.get<RegionEntry>(keyFor(region))) ?? null;
      } catch (err) {
        console.error("regionStore.get failed, treating as miss:", err);
        return null;
      }
    },
    async set(region, entry) {
      // Fail open: if the write fails we just don't persist this round.
      try {
        await redis.set(keyFor(region), entry, { ex: TTL_SECONDS });
      } catch (err) {
        console.error("regionStore.set failed, skipping persist:", err);
      }
    },
  };
}

function createMemoryStore(): RegionStore {
  const map = new Map<string, RegionEntry>();
  return {
    async get(region) {
      return map.get(region) ?? null;
    },
    async set(region, entry) {
      map.set(region, entry);
    },
  };
}

// Accept either naming convention: the native Upstash integration injects
// UPSTASH_REDIS_REST_*, while the Vercel KV-style product injects KV_REST_API_*.
const url = (
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
)?.trim();
const token = (
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
)?.trim();

// Upstash when both vars are present (Vercel prod with the integration);
// otherwise the original in-memory Map (local dev, unprovisioned deploys).
export const regionStore: RegionStore =
  url && token ? createRedisStore(url, token) : createMemoryStore();
