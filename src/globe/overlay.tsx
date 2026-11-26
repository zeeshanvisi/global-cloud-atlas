// Lightweight DOM label layer: React renders labels outside the Canvas; a Projector inside
// the Canvas moves them every frame. Avoids per-label React roots and keeps rendering cheap.
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlas } from '../store/useAtlas';
import { latLonToVec3 } from '../engine/geo';
import { PROVIDERS } from '../domain/types';
import { kmForRtt, LATENCY_RINGS } from '../engine/latency';

interface Anchor { pos: THREE.Vector3; el: HTMLElement; minDot: number }
const anchors = new Map<string, Anchor>();
export function anchorRef(id: string, lat: number, lon: number, alt = 1.01, minDot = 0.3) {
  return (el: HTMLElement | null) => { if (el) anchors.set(id, { pos: latLonToVec3(lat, lon, alt), el, minDot }); else anchors.delete(id); };
}

/** HUD readout of the camera's sub-point — written directly to the DOM each frame (no React renders). */
const hudEls: { lat?: HTMLElement | null; lon?: HTMLElement | null; alt?: HTMLElement | null } = {};
export const hudRef = (k: keyof typeof hudEls) => (el: HTMLElement | null) => { hudEls[k] = el; };
let lastHud = 0;
export function hudTick(camera: THREE.Camera) {
  const now = performance.now(); if (now - lastHud < 80) return; lastHud = now;
  const p = camera.position, d = p.length();
  const lat = 90 - (Math.acos(p.y / d) * 180) / Math.PI;
  let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
  if (hudEls.lat) hudEls.lat.textContent = `${Math.abs(lat).toFixed(2).padStart(5, '0')}°${lat >= 0 ? 'N' : 'S'}`;
  if (hudEls.lon) hudEls.lon.textContent = `${Math.abs(lon).toFixed(2).padStart(6, '0')}°${lon >= 0 ? 'E' : 'W'}`;
  if (hudEls.alt) hudEls.alt.textContent = `${Math.round((d - 1) * 6371).toLocaleString()} km`;
}

const v = new THREE.Vector3(), cn = new THREE.Vector3();
export function Projector() {
  useFrame(({ camera, size }) => {
    cn.copy(camera.position).normalize();
    for (const a of anchors.values()) {
      const facing = a.pos.clone().normalize().dot(cn) > a.minDot;
      v.copy(a.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
      a.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      a.el.style.opacity = facing ? '1' : '0';
      a.el.style.pointerEvents = facing ? 'auto' : 'none';
    }
  });
  return null;
}

export function LabelLayer() {
  const clusters = useAtlas((s) => s.overlayClusters), show = useAtlas((s) => s.showClusters);
  const hovered = useAtlas((s) => s.hovered), regions = useAtlas((s) => s.regions), hoverText = useAtlas((s) => s.hoverText);
  const flyTo = useAtlas((s) => s.flyTo), origin = useAtlas((s) => s.origin), lens = useAtlas((s) => s.lens), finderOpen = useAtlas((s) => s.finderOpen);
  const showRings = !!origin && (lens === 'latency' || finderOpen);
  const hov = regions.find((r) => r.key === hovered);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {show && clusters.map((c) => {
        const counts: Record<string, number> = {};
        c.members.forEach((m) => (counts[m.provider] = (counts[m.provider] ?? 0) + 1));
        return (
          <div key={c.id} ref={anchorRef('c:' + c.id, c.lat, c.lon)} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
            <div className="cluster -translate-x-1/2 -translate-y-1/2" onClick={() => flyTo(c.lat, c.lon, 2.3)} title={c.members.map((m) => `${PROVIDERS[m.provider].label} ${m.id}`).join('\n')}>
              <span className="font-semibold">{c.members.length}</span>
              <span className="flex gap-[2px] items-center">{Object.entries(counts).map(([p, n]) => <i key={p} style={{ background: PROVIDERS[p as keyof typeof PROVIDERS].color, width: 3 + n * 1.5 }} />)}</span>
            </div>
          </div>
        );
      })}
      {origin && (
        <div key={`o${origin.lat},${origin.lon}`} ref={anchorRef('origin', origin.lat, origin.lon, 1.01, 0.1)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <div className="tooltip pointer-events-none !border-l-white"><span className="cond text-[9px] tracking-[0.16em] text-[var(--ink-3)]">YOUR USERS</span> <span className="mono">{origin.label}</span></div>
        </div>
      )}
      {origin && showRings && LATENCY_RINGS.map((ms) => {
        const lat = Math.min(85, origin.lat + kmForRtt(ms) / 111);
        return (
          <div key={`r${ms}${origin.lat},${origin.lon}`} ref={anchorRef('ring' + ms, lat, origin.lon, 1.004, 0.15)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
            <span className="mono text-[9px] text-[var(--accent)] -translate-x-1/2 -translate-y-1/2 inline-block px-1 bg-[rgba(2,4,9,0.7)]">~{ms} ms</span>
          </div>
        );
      })}
      {hov && (
        <div key={hov.key} ref={anchorRef('hover', hov.dlat ?? hov.lat, hov.dlon ?? hov.lon, 1.02, 0)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <div className="tooltip pointer-events-none">
            <div className="flex items-center gap-1.5"><span className="dot" style={{ background: PROVIDERS[hov.provider].color }} /><b>{PROVIDERS[hov.provider].label}</b> · {hov.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">{hov.id} · {hov.city}</div>
            {hoverText && <div className="text-[11px] mt-0.5 text-slate-200">{hoverText}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
