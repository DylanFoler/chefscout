type DiscoverySource = {
  source: string;
  method: string;
  signals_extracted: string[];
};

type Props = {
  sources: DiscoverySource[];
};

export default function ArchitecturePanel({ sources }: Props) {
  return (
    <div className="space-y-4">
      {sources.map((src, i) => (
        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-400 text-sm font-mono">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white">{src.source}</h3>
              <p className="text-sm text-zinc-400 mt-1">{src.method}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {src.signals_extracted.map((sig, j) => (
                  <span
                    key={j}
                    className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700"
                  >
                    {sig}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
