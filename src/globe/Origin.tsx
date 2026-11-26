import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAtlas } from '../store/useAtlas';
import { latLonToVec3 } from '../engine/geo';
import { kmForRtt, LATENCY_RINGS } from '../engine/latency';
import { arcMaterial } from './shaders';

/** Small circle on the sphere: all points `km` from the origin (great-circle distance). */
function ringPoints(lat: number, lon: number, km: number) {
  const c = latLonToVec3(lat, lon).normalize(), ang = km / 6371;
  const up = Math.abs(c.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(c, up).normalize(), t2 = new THREE.Vector3().crossVectors(c, t1);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const dir = t1.clone().multiplyScalar(Math.cos(a)).add(t2.clone().multiplyScalar(Math.sin(a)));
    pts.push(c.clone().multiplyScalar(Math.cos(ang)).add(dir.multiplyScalar(Math.sin(ang))).normalize().multiplyScalar(1.0035));
  }
  return pts;
}

function arcTube(a: THREE.Vector3, b: THREE.Vector3) {
  const angle = a.angleTo(b), lift = 0.02 + angle * 0.16, s = Math.sin(angle), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = s > 1e-4 ? a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).add(b.clone().multiplyScalar(Math.sin(t * angle) / s)) : a.clone();
    pts.push(p.normalize().multiplyScalar(1.003 + Math.sin(Math.PI * t) * lift));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.0013, 4, false);
}

/** Users' location: pin, estimated-latency rings, and arcs to the Region Finder's top picks. */
export function OriginLayer() {
  const origin = useAtlas((s) => s.origin), top = useAtlas((s) => s.finderTop), regions = useAtlas((s) => s.regions);
  const pin = useRef<THREE.Mesh>(null), halo = useRef<THREE.Mesh>(null);
  const rings = useMemo(() => !origin ? [] : LATENCY_RINGS.map((ms) => ({ ms, geo: new THREE.BufferGeometry().setFromPoints(ringPoints(origin.lat, origin.lon, kmForRtt(ms))) })), [origin]);
  const arcs = useMemo(() => {
    if (!origin) return [];
    const a = latLonToVec3(origin.lat, origin.lon).normalize();
    return top.slice(0, 3).map((k, i) => {
      const r = regions.find((x) => x.key === k); if (!r) return null;
      const mat = arcMaterial(new THREE.Color(i === 0 ? '#ffffff' : '#9fd8ff'));
      return { k, geo: arcTube(a, latLonToVec3(r.dlat ?? r.lat, r.dlon ?? r.lon).normalize()), mat };
    }).filter(Boolean) as { k: string; geo: THREE.TubeGeometry; mat: THREE.ShaderMaterial }[];
  }, [origin, top, regions]);
  useEffect(() => () => arcs.forEach((x) => { x.geo.dispose(); x.mat.dispose(); }), [arcs]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    arcs.forEach((x) => { x.mat.uniforms.uTime.value = t; x.mat.uniforms.uDraw.value = 1; });
    if (halo.current) { const k = 1 + (t * 0.8) % 1 * 2.5; halo.current.scale.setScalar(0.012 * k); (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ((t * 0.8) % 1)); }
  });
  if (!origin) return null;
  const p = latLonToVec3(origin.lat, origin.lon, 1.004), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize());
  return (
    <group>
      {rings.map(({ ms, geo }) => (
        <lineLoop key={ms} geometry={geo} raycast={() => null} ref={(l) => { l?.computeLineDistances(); }}>
          <lineDashedMaterial color="#9fd8ff" transparent opacity={0.35} dashSize={0.01} gapSize={0.008} />
        </lineLoop>
      ))}
      <mesh ref={pin} position={p} raycast={() => null}><sphereGeometry args={[0.006, 16, 12]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
      <mesh ref={halo} position={p} quaternion={q} raycast={() => null}><ringGeometry args={[0.8, 1, 48]} /><meshBasicMaterial color="#9fd8ff" transparent depthWrite={false} toneMapped={false} /></mesh>
      {arcs.map((x) => <mesh key={x.k} geometry={x.geo} material={x.mat} raycast={() => null} />)}
    </group>
  );
}
