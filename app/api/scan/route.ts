import { readFileSync } from "fs";
import { join } from "path";
import { Seller } from "@/lib/types";
import { NextRequest } from "next/server";

function getPool(): Seller[] {
  const file = join(process.cwd(), "data", "discovery_pool.json");
  return JSON.parse(readFileSync(file, "utf-8"));
}

export async function POST(req: NextRequest) {
  const { excludeHandles }: { excludeHandles: string[] } = await req.json();

  const pool = getPool();
  const available = pool.filter((s) => !excludeHandles.includes(s.handle));

  if (available.length === 0) {
    return Response.json({ found: [] });
  }

  // Shuffle and return up to 2
  const shuffled = available.sort(() => Math.random() - 0.5);
  const found = shuffled.slice(0, 2);

  return Response.json({ found });
}
