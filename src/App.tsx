import { useEffect, useState } from 'react';
import { GlobeScene } from './globe/GlobeScene';
import { LabelLayer, hudRef } from './globe/overlay';
import { sunDirection } from './globe/shaders';
import { TopBar } from './ui/TopBar';
import { LeftPanel } from './ui/LeftPanel';
import { RegionPanel } from './ui/RegionPanel';
import { LensBar } from './ui/LensBar';
import { ComparePanel } from './ui/ComparePanel';
import { FinderPanel } from './ui/FinderPanel';
import { Guide, guideSeen } from './ui/Guide';
import { useUrlState } from './ui/share';
import { useAtlas } from './store/useAtlas';
import { loadFx, loadManifest, loadRegions } from './data/loader';
import { withDisplayPositions } from './engine/geo';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const s = sunDirection(now);
  const lat = 90 - (Math.acos(s.y) * 180) / Math.PI;
  let lon = (Math.atan2(s.z, -s.x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
  return <><span>UTC <b>{now.toISOString().slice(11, 19)}</b></span><span>SUN <b>{Math.abs(lat).toFixed(1)}°{lat >= 0 ? 'N' : 'S'} {Math.abs(lon).toFixed(1)}°{lon >= 0 ? 'E' : 'W'}</b></span></>;
}

export default function App() {
  const leftOpen = useAtlas((s) => s.leftOpen), rightOpen = useAtlas((s) => s.rightOpen), selected = useAtlas((s) => s.selected), compareOpen = useAtlas((s) => s.compareOpen);
  const set = useAtlas((s) => s.set), finderOpen = useAtlas((s) => s.finderOpen), pickingOrigin = useAtlas((s) => s.pickingOrigin);
  useUrlState();
  useEffect(() => { if (!guideSeen() && !location.hash.includes('sel=')) set({ guideOpen: true }); }, [set]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const s = useAtlas.getState();
      if (e.key === 'f' || e.key === 'F') s.set({ finderOpen: !s.finderOpen, compareOpen: false });
      if (e.key === '?') s.set({ guideOpen: true });
      if (e.key === 'Escape' && s.pickingOrigin) s.set({ pickingOrigin: false });
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    loadRegions().then((regions) => set({ regions: withDisplayPositions(regions) }));
    loadManifest().then((manifest) => set({ manifest }));
    loadFx().then((d) => set({ fx: { USD: 1, ...d.rates } }));
  }, [set]);
  const L = leftOpen ? 296 : 0, R = selected && rightOpen ? 392 : 0;

  return (
    <div className={`relative w-full h-full ${pickingOrigin ? 'picking' : ''}`}>
      <div className="absolute inset-0"><GlobeScene /><LabelLayer /></div>

      {/* viewport frame: corner ticks + HUD, bounded by the open rails */}
      <div className="frame" style={{ left: L + 14, right: R + 14, top: 58, bottom: 14 }}>
        <i style={{ left: 0, top: 0, borderWidth: '1px 0 0 1px' }} /><i style={{ right: 0, top: 0, borderWidth: '1px 1px 0 0' }} />
        <i style={{ left: 0, bottom: 0, borderWidth: '0 0 1px 1px' }} /><i style={{ right: 0, bottom: 0, borderWidth: '0 1px 1px 0' }} />
        <div className="hud absolute left-5 top-2 flex gap-1.5">
          <span>LAT <b ref={hudRef('lat')}>—</b></span><span>LON <b ref={hudRef('lon')}>—</b></span><span>ALT <b ref={hudRef('alt')}>—</b></span>
        </div>
        <div className="hud absolute right-5 top-2 flex gap-1.5"><Clock /></div>
        {/* keyboard hints sit under the clock, clear of the lens dial at the bottom */}
        <div className="hud-hints absolute right-5 top-9 hidden xl:block text-right leading-relaxed">
          drag · orbit &nbsp; scroll · zoom &nbsp; 1–0 · lens &nbsp; F · finder &nbsp; / · search &nbsp; ? · help<br />
          <span className="text-[var(--ink-4)]">borders: natural earth · prices: aws, azure, gcp official apis</span>
        </div>
      </div>

      <TopBar />
      {leftOpen && <LeftPanel />}
      <button className="toggle" style={{ left: leftOpen ? 295 : 0, top: '50%' }} onClick={() => set({ leftOpen: !leftOpen })} title="Toggle left rail">{leftOpen ? '‹' : '›'}</button>
      {selected && rightOpen && <RegionPanel />}
      {selected && <button className="toggle" style={{ right: rightOpen ? 391 : 0, top: '50%' }} onClick={() => set({ rightOpen: !rightOpen })} title="Toggle region rail">{rightOpen ? '›' : '‹'}</button>}
      {compareOpen && <ComparePanel />}
      {finderOpen && <FinderPanel />}
      {pickingOrigin && (
        <div className="absolute top-[56px] left-1/2 -translate-x-1/2 z-50 panel px-3 py-2 flex items-center gap-3">
          <span className="sw animate-pulse" style={{ background: 'var(--accent)' }} />
          <span className="text-[11.5px] text-[var(--ink)]">Click anywhere on the globe to set where your users are</span>
          <button className="btn !h-6" onClick={() => set({ pickingOrigin: false })}>cancel</button>
        </div>
      )}
      <Guide />
      <LensBar />
    </div>
  );
}
