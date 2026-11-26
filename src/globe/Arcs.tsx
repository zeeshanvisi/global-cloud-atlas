import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlas } from '../store/useAtlas';
import { PROVIDERS } from '../domain/types';
import { latLonToVec3 } from '../engine/geo';
import { arcMaterial } from './shaders';

/** Great-circle arc lifted above the surface proportionally to its length. */
function arcGeometry(a: THREE.Vector3, b: THREE.Vector3) {
  const angle = a.angleTo(b), lift = 0.02 + angle * 0.14, pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = new THREE.Vector3().copy(a).lerp(b, t).normalize();
    // slerp for accuracy on long arcs
    const s = Math.sin(angle);
    if (s > 1e-4) p.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).add(b.clone().multiplyScalar(Math.sin(t * angle) / s)).normalize();
    pts.push(p.multiplyScalar(1.002 + Math.sin(Math.PI * t) * lift));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 72, 0.0008, 4, false);
}

/**
 * Schematic transfer routes from the selected region to the provider's other regions.
 * These are not physical cable paths — the panel labels them as such.
 */
export function Arcs() {
  const selected = useAtlas((s) => s.selected), regions = useAtlas((s) => s.regions), providers = useAtlas((s) => s.providers);
  const arcs = useMemo(() => {
    const src = regions.find((r) => r.key === selected);
    if (!src || !providers[src.provider]) return [];
    const a = latLonToVec3(src.dlat ?? src.lat, src.dlon ?? src.lon).normalize();
    return regions.filter((r) => r.provider === src.provider && r.key !== src.key).map((r) => {
      const mat = arcMaterial(new THREE.Color(PROVIDERS[src.provider].color));
      return { key: r.key, geo: arcGeometry(a, latLonToVec3(r.dlat ?? r.lat, r.dlon ?? r.lon).normalize()), mat };
    });
  }, [selected, regions, providers]);
  const t0 = useRef(0);
  useEffect(() => { t0.current = performance.now(); return () => arcs.forEach((x) => { x.geo.dispose(); x.mat.dispose(); }); }, [arcs]);
  useFrame(({ clock }) => {
    const draw = Math.min(1, (performance.now() - t0.current) / 1600);
    const e = 1 - Math.pow(1 - draw, 3);
    for (const x of arcs) { x.mat.uniforms.uTime.value = clock.elapsedTime; x.mat.uniforms.uDraw.value = e; }
  });
  return <group>{arcs.map((x) => <mesh key={x.key} geometry={x.geo} material={x.mat} raycast={() => null} />)}</group>;
}
