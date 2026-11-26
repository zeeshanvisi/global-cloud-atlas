// Shareable URL state (hash) + CSV export. The hash never contains anything but view state.
import { useEffect } from 'react';
import { useAtlas, ALL_SOVEREIGNTY } from '../store/useAtlas';
import { DEFAULT_WORKLOAD } from '../engine/compare';
import { LENSES, type LensId } from '../lenses/lenses';
import type { PricingModel, Sovereignty } from '../domain/types';

const num = (v: string | null) => (v == null || v === '' || isNaN(+v) ? null : +v);

/** Read the hash once on load, then keep it in sync with the store. */
export function useUrlState() {
  useEffect(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    const st = useAtlas.getState(), patch: Record<string, unknown> = {};
    const lens = p.get('lens'); if (lens && LENSES.some((l) => l.id === lens)) patch.lens = lens as LensId;
    const w = { ...st.workload };
    for (const k of ['computeConfig', 'arch', 'gpuModel', 'storageType', 'dbEngine', 'dbConfig', 'kind', 'pricingModel'] as const) { const v = p.get(k); if (v) (w as Record<string, unknown>)[k] = v; }
    const gc = num(p.get('gpuCount')); if (gc) w.gpuCount = gc;
    if (!['on-demand', 'spot', 'commit-1y'].includes(w.pricingModel)) w.pricingModel = 'on-demand' as PricingModel;
    patch.workload = w;
    const lat = num(p.get('olat')), lon = num(p.get('olon'));
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) patch.origin = { lat, lon, label: p.get('olabel') || `${lat.toFixed(1)}, ${lon.toFixed(1)}` };
    const t = p.get('tpl'); if (t) patch.finder = { ...st.finder, templateId: t };
    const sov = p.get('sov'); if (sov) patch.regionFilter = { ...st.regionFilter, sovereignty: sov.split(',').filter((x): x is Sovereignty => (ALL_SOVEREIGNTY as string[]).includes(x)) };
    const cc = p.get('cc'); if (cc && /^[A-Z]{2}$/.test(cc)) patch.regionFilter = { ...(patch.regionFilter as object ?? st.regionFilter), country: cc };
    if (p.get('finder') === '1') patch.finderOpen = true;
    if (p.get('cur')) patch.currency = p.get('cur')!;
    st.set(patch as never);
    const sel = p.get('sel'); if (sel) { const iv = setInterval(() => { if (useAtlas.getState().regions.length) { clearInterval(iv); useAtlas.getState().select(sel); } }, 100); setTimeout(() => clearInterval(iv), 8000); }

    let t0: number | undefined;
    const unsub = useAtlas.subscribe((s) => {
      clearTimeout(t0);
      t0 = window.setTimeout(() => {
        const q = new URLSearchParams();
        if (s.lens !== 'infrastructure') q.set('lens', s.lens);
        if (s.selected) q.set('sel', s.selected);
        for (const [k, v] of Object.entries(s.workload)) if ((DEFAULT_WORKLOAD as unknown as Record<string, unknown>)[k] !== v) q.set(k, String(v));
        if (s.origin) { q.set('olat', s.origin.lat.toFixed(3)); q.set('olon', s.origin.lon.toFixed(3)); q.set('olabel', s.origin.label); }
        if (s.finderOpen) { q.set('finder', '1'); q.set('tpl', s.finder.templateId); }
        if (s.regionFilter.sovereignty.length !== ALL_SOVEREIGNTY.length) q.set('sov', s.regionFilter.sovereignty.join(','));
        if (s.regionFilter.country) q.set('cc', s.regionFilter.country);
        if (s.currency !== 'USD') q.set('cur', s.currency);
        const h = q.toString();
        if (h !== location.hash.slice(1)) history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
      }, 250);
    });
    return () => { unsub(); clearTimeout(t0); };
  }, []);
}

export async function copyLink(): Promise<boolean> {
  try { await navigator.clipboard.writeText(location.href); return true; } catch { return false; }
}

/** Download rows as CSV (RFC 4180 quoting). */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
