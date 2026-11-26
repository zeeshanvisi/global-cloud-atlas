import { useEffect, useState } from 'react';
import { useAtlas } from '../store/useAtlas';

const KEY = 'gca.guide.v1';
export const guideSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable — fine */ } };

const STEPS = [
  { t: 'Explore the globe', b: 'Every beacon is a real AWS, Azure or Google Cloud region. Drag to orbit, scroll to zoom, hover for a summary, click for the full region dossier — prices, GPUs, services and nearby competitors.', k: 'drag · scroll · click' },
  { t: 'Switch lenses', b: 'The dial at the bottom (keys 1–0) re-maps the globe: compute, GPU, storage, network and database prices, estimated latency, carbon, and a price-compare view that colours each market by its cheapest provider.', k: '1 – 0' },
  { t: 'Let it pick for you', b: 'Open the Region Finder, say where your users are and what you run. It ranks every region on monthly cost, estimated latency and carbon — with your residency rules applied — and draws the top picks on the globe.', k: 'F' },
  { t: 'Share what you see', b: 'The link always captures your current view — lens, region, workload, pricing model and location. Use “share” to copy it, and export any comparison to CSV.', k: 'share · csv' },
];

export function Guide() {
  const open = useAtlas((s) => s.guideOpen), set = useAtlas((s) => s.set);
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);
  if (!open) return null;
  const close = () => { markSeen(); set({ guideOpen: false }); };
  const s = STEPS[i];
  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(2,4,9,0.55)]" onClick={close}>
      <div className="panel w-[440px] max-w-[calc(100vw-32px)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Getting started">
        <div className="flex items-center px-5 pt-4">
          <span className="cond text-[10px] tracking-[0.2em] text-[var(--accent)]">GETTING STARTED · {i + 1}/{STEPS.length}</span>
          <button className="ml-auto link mono text-[10px]" onClick={close}>skip</button>
        </div>
        <div className="px-5 pt-3 pb-4">
          <div className="text-[18px] font-light text-[var(--ink)]">{s.t}</div>
          <p className="text-[12px] leading-relaxed text-[var(--ink-2)] mt-2">{s.b}</p>
          <div className="mono text-[10px] text-[var(--ink-3)] mt-3 border-t border-[var(--line)] pt-2">{s.k}</div>
        </div>
        <div className="flex items-center gap-1.5 px-5 pb-4">
          {STEPS.map((_, j) => <span key={j} className="h-[2px] w-6" style={{ background: j <= i ? 'var(--accent)' : 'var(--line-2)' }} />)}
          <div className="ml-auto flex gap-1.5">
            {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>back</button>}
            {i < STEPS.length - 1 ? <button className="btn on" onClick={() => setI(i + 1)}>next</button>
              : <button className="btn on" onClick={() => { close(); set({ finderOpen: true }); }}>open region finder</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
