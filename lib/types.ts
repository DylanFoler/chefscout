export type Seller = {
  id: string;
  handle: string;
  name: string;
  platform: "instagram" | "tiktok" | "other";
  followers: number | null; // null = unknown/unverified; never 0-as-unknown
  city: string;
  neighborhood: string;
  metro_area: string;
  what_they_sell: string;
  current_order_method: string;
  drop_cadence: string;
  notable_signals: string[];
  sample_post_caption?: string;
  website_or_linktree?: string;
};

export type ScoreResult = {
  score: number;
  tier: "Hobbyist" | "Emerging" | "High-Value" | "Established";
  switch_readiness: number;
  signal_breakdown: {
    signal: string;
    weight: "low" | "medium" | "high";
    explanation: string;
  }[];
  recommended_action: string;
};

export type OutreachResult = {
  channel: "instagram_dm" | "tiktok_dm" | "email";
  subject?: string;
  body: string;
  rationale: string;
};
