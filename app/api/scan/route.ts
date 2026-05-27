import { readFileSync } from "fs";
import { join } from "path";
import { Seller } from "@/lib/types";

function getPool(): Seller[] {
  const file = join(process.cwd(), "data", "discovery_pool.json");
  return JSON.parse(readFileSync(file, "utf-8"));
}

export async function POST(req: Request) {
  const { excludeIds }: { excludeIds: string[] } = await req.json();

  const pool = getPool();
  const available = pool.filter((s) => !excludeIds.includes(s.id));

  // Surface 2 random picks from what hasn't been seen yet
  const shuffled = available.sort(() => Math.random() - 0.5);
  const found = shuffled.slice(0, 2);

  // Simulate scan latency so it feels like real work
  await new Promise((r) => setTimeout(r, 2200));

  return Response.json({ found });
}
