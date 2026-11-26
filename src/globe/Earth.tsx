import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { countryAt, loadWorld } from '../data/world';
import { useAtlas } from '../store/useAtlas';
import { atmosphereMaterial, cloudMaterial, earthMaterial, sunDirection } from './shaders';

const W = 4096, H = 2048;

/** Data mask for the earth shader: R = land, G = coastlines + borders (Natural Earth 1:50m). */
function paintMask(rings: number[][][]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const X = (lon: number) => ((lon + 180) / 360) * W, Y = (lat: number) => ((90 - lat) / 180) * H;
  const trace = (ring: number[][], off: number) => {
    g.beginPath(); let prev = ring[0][0], acc = 0;
    ring.forEach(([lon, lat], i) => {
      if (i && Math.abs(lon - prev) > 180) acc += lon < prev ? 360 : -360; // unwrap antimeridian
      prev = lon; const x = X(lon + acc) + off, y = Y(lat);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
  };
  g.fillStyle = '#f00';
  for (const ring of rings) for (const off of [-W, 0, W]) { trace(ring, off); g.fill(); }
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgb(0,150,0)'; g.lineWidth = 1.4;
  for (const ring of rings) for (const off of [-W, 0, W]) { trace(ring, off); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** When the user is picking their users' location, a globe click sets it. */
function pickOrigin(p: THREE.Vector3) {
  const st = useAtlas.getState(); if (!st.pickingOrigin) return;
  const n = p.clone().normalize();
  const lat = 90 - (Math.acos(n.y) * 180) / Math.PI;
  let lon = (Math.atan2(n.z, -n.x) * 180) / Math.PI - 180; if (lon < -180) lon += 360;
  const coords = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  st.set({ origin: { lat, lon, label: coords }, pickingOrigin: false });
  countryAt(lat, lon).then((c) => { if (c && useAtlas.getState().origin?.lat === lat) useAtlas.getState().set({ origin: { lat, lon, label: `${c} · ${coords}` } }); });
}

export function Earth() {
  const [mask, setMask] = useState<THREE.Texture | null>(null);
  useEffect(() => { loadWorld().then((w) => setMask(paintMask(w.countries.flatMap((c) => c.rings)))); }, []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 192, 128), []);
  const earth = useMemo(() => (mask ? earthMaterial(mask) : null), [mask]);
  const clouds = useMemo(() => cloudMaterial(), []);
  const atmo = useMemo(() => atmosphereMaterial(), []);

  useFrame(({ clock }) => {
    const sun = sunDirection();
    if (earth) { earth.uniforms.uSun.value.copy(sun); earth.uniforms.uTime.value = clock.elapsedTime; }
    clouds.uniforms.uSun.value.copy(sun); clouds.uniforms.uTime.value = clock.elapsedTime;
    atmo.uniforms.uSun.value.copy(sun);
  });

  return (
    <group>
      {/* the Earth occludes pointer events so far-side markers can't be hovered through the globe */}
      <mesh geometry={sphere} material={earth ?? undefined} onPointerMove={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); pickOrigin(e.point); }}>{!earth && <meshBasicMaterial color="#03070e" />}</mesh>
      <mesh geometry={sphere} scale={1.012} material={clouds} raycast={() => null} />
      <mesh geometry={sphere} scale={1.14} material={atmo} raycast={() => null} />
    </group>
  );
}
