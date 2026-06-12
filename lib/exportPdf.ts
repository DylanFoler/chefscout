import type { Seller, ScoreResult } from "@/lib/types";

export type PdfRow = { seller: Seller; score: ScoreResult | null };
export type PdfMeta = { region: string; search: string; count: number };

const INK: [number, number, number] = [27, 37, 64];
const CORAL: [number, number, number] = [225, 59, 59];
const MUTED: [number, number, number] = [110, 113, 128];
const SAND: [number, number, number] = [217, 211, 200];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Full-detail PDF of the currently shown scan results. jsPDF is dynamically
// imported so the (sizeable, client-only) library never bloats the initial load —
// it's pulled in only when the user actually clicks Download. Followers are
// printed only when known (never a fake "0").
export async function exportScanPdf(rows: PdfRow[], meta: PdfMeta): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const M = 44;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const RIGHT = W - M;
  const CONTENT = W - M * 2;
  let y = M;

  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const ensure = (need: number) => {
    if (y + need > H - M) {
      doc.addPage();
      y = M;
    }
  };

  // Wrapped paragraph.
  const para = (
    text: string,
    {
      size = 10,
      c = INK,
      bold = false,
      gap = 4,
      indent = 0,
    }: { size?: number; c?: [number, number, number]; bold?: boolean; gap?: number; indent?: number } = {}
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    color(c);
    const lines = doc.splitTextToSize(text, CONTENT - indent) as string[];
    for (const ln of lines) {
      ensure(size + 3);
      doc.text(ln, M + indent, y);
      y += size + 3;
    }
    y += gap;
  };

  // "Label:  value" with a hanging indent so wrapped value lines align.
  const field = (label: string, value: string | undefined | null) => {
    if (!value || !value.trim()) return;
    const lbl = `${label}:  `;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const lblW = doc.getTextWidth(lbl);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(value.trim(), CONTENT - lblW) as string[];
    ensure(13);
    doc.setFont("helvetica", "bold");
    color(MUTED);
    doc.text(lbl, M, y);
    doc.setFont("helvetica", "normal");
    color(INK);
    doc.text(lines[0], M + lblW, y);
    y += 13;
    for (let i = 1; i < lines.length; i++) {
      ensure(13);
      doc.text(lines[i], M + lblW, y);
      y += 13;
    }
    y += 2;
  };

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  color(INK);
  doc.text("ChefScout — Scan Results", M, y);
  y += 20;
  const date = new Date().toISOString().slice(0, 10);
  const bits: string[] = [];
  if (meta.region) bits.push(`Region: ${titleCase(meta.region)}`);
  if (meta.search) bits.push(`Filter: "${meta.search}"`);
  bits.push(`${meta.count} maker${meta.count !== 1 ? "s" : ""}`);
  bits.push(date);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  color(MUTED);
  doc.text(bits.join("   ·   "), M, y);
  y += 12;
  doc.setDrawColor(SAND[0], SAND[1], SAND[2]);
  doc.line(M, y, RIGHT, y);
  y += 20;

  // ---- One block per maker ----
  rows.forEach((row, idx) => {
    const { seller, score } = row;
    ensure(70);

    // Score + name header line.
    const scoreStr = score ? String(score.score) : "—";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    color(CORAL);
    doc.text(scoreStr, M, y);
    const scoreW = doc.getTextWidth(`${scoreStr}   `);
    color(INK);
    const nameLines = doc.splitTextToSize(seller.name, CONTENT - scoreW) as string[];
    doc.text(nameLines[0] ?? seller.name, M + scoreW, y);
    y += 17;
    for (let i = 1; i < nameLines.length; i++) {
      ensure(15);
      doc.text(nameLines[i], M + scoreW, y);
      y += 15;
    }

    // Sub-line: handle · platform · tier · switch readiness.
    const sub = [
      seller.handle,
      seller.platform,
      score?.tier,
      score ? `Switch readiness ${score.switch_readiness}` : null,
    ]
      .filter(Boolean)
      .join("   ·   ");
    para(sub, { size: 9, c: MUTED, gap: 5 });

    // Fields.
    const loc = [seller.neighborhood, seller.city].filter(Boolean).join(", ");
    field("Location", loc || seller.metro_area);
    if (seller.followers != null)
      field("Followers", seller.followers.toLocaleString());
    field("Sells", seller.what_they_sell);
    field("Orders via", seller.current_order_method);
    field("Cadence", seller.drop_cadence);
    if (seller.website_or_linktree) field("Link", seller.website_or_linktree);

    // Scored signal breakdown (or fall back to the discovery signals).
    if (score && score.signal_breakdown.length) {
      ensure(13);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      color(MUTED);
      doc.text("Signals:", M, y);
      y += 13;
      for (const sig of score.signal_breakdown) {
        para(`• [${sig.weight}] ${sig.signal} — ${sig.explanation}`, {
          size: 9,
          c: INK,
          gap: 1,
          indent: 10,
        });
      }
      y += 3;
    } else if (seller.notable_signals.length) {
      field("Signals", seller.notable_signals.join("; "));
    }

    if (score?.recommended_action) field("Action", score.recommended_action);

    // Separator (skip after the last).
    if (idx < rows.length - 1) {
      y += 4;
      ensure(14);
      doc.setDrawColor(SAND[0], SAND[1], SAND[2]);
      doc.line(M, y, RIGHT, y);
      y += 16;
    }
  });

  const regionSlug =
    (meta.region || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "all";
  doc.save(`chefscout-${regionSlug}-${date}.pdf`);
}
