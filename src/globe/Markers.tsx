import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { PROVIDERS, type Region } from '../domain/types';
import { cluster, latLonToVec3 } from '../engine/geo';
import { useAtlas } from '../store/useAtlas';
import { lensById } from '../lenses/lenses';
import { beaconMaterial, beamMaterial } from './shaders';

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();
const DIM = new THREE.Color('#3a4656');
const WHITE = new THREE.Color('#ffffff');

/** Zoom band from camera distance: far → clusters, mid → regions, near → regions + AZ rings */
export function useZoomBand() {
  const camera = useThree((s) => s.camera);
  const [band, setBand] = useState<'far' | 'mid' | 'near'>('far');
  useFrame(() => {
    const d = camera.position.length();
    const b = d > 3.3 ? 'far' : d > 2.05 ? 'mid' : 'near';
    if (b !== band) setBand(b);
  });
  return band;
}

export function Markers({ visible }: { visible: Region[] }) {
  const lens = useAtlas((s) => s.lens), indexes = useAtlas((s) => s.indexes), workload = useAtlas((s) => s.workload);
  const selected = useAtlas((s) => s.selected), hovered = useAtlas((s) => s.hovered), highlight = useAtlas((s) => s.highlight);
  const set = useAtlas((s) => s.set), select = useAtlas((s) => s.select), origin = useAtlas((s) => s.origin), finderTop = useAtlas((s) => s.finderTop);
  const band = useZoomBand();
  const L = lensById(lens);

  // Spatial clustering when zoomed out (infrastructure lens only — data lenses keep every beam visible)
  const clusters = useMemo(() => cluster(visible, 650), [visible]);
  const dense = useMemo(() => clusters.filter((c) => c.members.length > 2), [clusters]);
  const far = band === 'far';
  const clusterOn = far && lens === 'infrastructure';
  const hiddenByCluster = useMemo(() => new Set(clusterOn ? dense.flatMap((c) => c.members.map((m) => m.key)) : []), [clusterOn, dense]);

  const values = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of visible) m.set(r.key, L.value ? L.value(r, indexes, workload, { origin }) : null);
    return m;
  }, [visible, L, indexes, workload, origin]);
  const max = Math.max(1e-9, ...[...values.values()].filter((v): v is number => v != null));

  const n = visible.length;
  const hits = useRef<THREE.InstancedMesh>(null!), cores = useRef<THREE.InstancedMesh>(null!), beacons = useRef<THREE.InstancedMesh>(null!), beams = useRef<THREE.InstancedMesh>(null!);
  const coreGeo = useMemo(() => new THREE.SphereGeometry(1, 14, 10), []);
  const quadGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1)).map(() => Math.random()), 1));
    g.setAttribute('aStrength', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1)).fill(1), 1));
    return g;
  }, [n]);
  const beamGeo = useMemo(() => { const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); g.translate(0, 0.5, 0); return g; }, []);
  const beaconMat = useMemo(() => beaconMaterial(), []), beamMat = useMemo(() => beamMaterial(), []);
  useFrame(({ clock }) => { beaconMat.uniforms.uTime.value = beamMat.uniforms.uTime.value = clock.elapsedTime; });

  useEffect(() => {
    if (!hits.current || !cores.current || !beacons.current || !beams.current) return;
    const hitR = band === 'far' ? 0.02 : band === 'mid' ? 0.012 : 0.006; // ~constant on-screen pick radius
    const strength = quadGeo.getAttribute('aStrength') as THREE.InstancedBufferAttribute;
    visible.forEach((r, i) => {
      const p = latLonToVec3(r.dlat ?? r.lat, r.dlon ?? r.lon, 1.0015), nrm = p.clone().normalize();
      const v = values.get(r.key);
      const isSel = r.key === selected, isHov = r.key === hovered;
      const inTop = finderTop.length ? finderTop.includes(r.key) : true;
      const dim = !inTop || (highlight && !highlight.keys.has(r.key)) || (lens !== 'infrastructure' && lens !== 'compare' && v == null);
      const hide = hiddenByCluster.has(r.key);
      tmpC.set(dim ? DIM : PROVIDERS[r.provider].color);
      if (isSel || isHov) tmpC.lerp(WHITE, 0.15);
      // core (pickable)
      const s = hide ? 0 : (isSel ? 0.0055 : isHov ? 0.005 : 0.0042) * (dim ? 0.75 : 1);
      dummy.position.copy(p); dummy.quaternion.identity(); dummy.scale.setScalar(s); dummy.updateMatrix();
      cores.current.setMatrixAt(i, dummy.matrix); cores.current.setColorAt(i, tmpC);
      dummy.scale.setScalar(hide ? 0 : hitR); dummy.updateMatrix(); hits.current.setMatrixAt(i, dummy.matrix);
      // pulse ring, tangent to surface
      const bs = hide ? 0 : isSel ? 0.075 : isHov ? 0.06 : 0.045;
      dummy.position.copy(nrm).multiplyScalar(1.0025); dummy.quaternion.setFromUnitVectors(Z, nrm); dummy.scale.setScalar(bs); dummy.updateMatrix();
      beacons.current.setMatrixAt(i, dummy.matrix); beacons.current.setColorAt(i, tmpC);
      strength.setX(i, hide ? 0 : dim ? 0.18 : isSel ? 0.9 : 0.8);
      // beam: lens value
      const h = hide || v == null || lens === 'compare' ? 0 : 0.012 + 0.15 * (lens === 'infrastructure' ? v / 6 : v / max);
      if (finderTop[0] === r.key) tmpC.lerp(WHITE, 0.2);
      const w = isSel ? 0.0026 : 0.0016;
      dummy.position.copy(p); dummy.quaternion.setFromUnitVectors(UP, nrm); dummy.scale.set(w, Math.max(h, 1e-5), w); dummy.updateMatrix();
      beams.current.setMatrixAt(i, dummy.matrix); beams.current.setColorAt(i, tmpC);
    });
    for (const m of [hits.current, cores.current, beacons.current, beams.current]) {
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere();
    }
    strength.needsUpdate = true;
  }, [visible, values, max, selected, hovered, highlight, lens, hiddenByCluster, n, quadGeo, band, finderTop]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); const r = visible[e.instanceId!];
    if (r && !hiddenByCluster.has(r.key)) { if (hovered !== r.key) set({ hovered: r.key }); document.body.style.cursor = 'pointer'; }
  };
  const onOut = () => { set({ hovered: null }); document.body.style.cursor = ''; };
  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const r = visible[e.instanceId!]; if (r && !hiddenByCluster.has(r.key)) select(r.key); };

  const fmtV = (v: number | null | undefined) =>
    lens === 'compare' ? '' : v == null ? (lens === 'latency' ? "set your users' location" : lens === 'carbon' ? 'carbon data not published' : 'no verified data')
      : L.format ? L.format(v) : `$${v < 0.1 ? v.toFixed(4) : v.toFixed(3)}${L.unit ?? ''}`;
  const hoverText = hovered ? fmtV(values.get(hovered)) : '';
  useEffect(() => { set({ overlayClusters: dense, showClusters: clusterOn }); }, [dense, clusterOn, set]);
  useEffect(() => { set({ hoverText }); }, [hoverText, set]);

  const cap = Math.max(n, 1);
  return (
    <group>
      {/* invisible, zoom-scaled pick targets (colorWrite off) — the visible cores are too small to hit reliably */}
      <instancedMesh key={`h${n}`} ref={hits} args={[coreGeo, undefined, cap]} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick}>
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
      </instancedMesh>
      <instancedMesh key={`c${n}`} ref={cores} args={[coreGeo, undefined, cap]} raycast={() => null}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh key={`b${n}`} ref={beacons} args={[quadGeo, beaconMat, cap]} raycast={() => null} />
      <instancedMesh key={`s${n}`} ref={beams} args={[beamGeo, beamMat, cap]} raycast={() => null} />
      {band === 'near' && visible.filter((r) => r.azs && !hiddenByCluster.has(r.key)).map((r) => <AzRing key={r.key} r={r} />)}
    </group>
  );
}

/** Providers do not publish AZ coordinates, so AZs are drawn schematically as satellites on an orbit ring. */
function AzRing({ r }: { r: Region }) {
  const { pts, ring } = useMemo(() => {
    const center = latLonToVec3(r.dlat ?? r.lat, r.dlon ?? r.lon, 1.0022), n = center.clone().normalize();
    const t1 = new THREE.Vector3().crossVectors(n, UP).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
    const at = (a: number, rad: number) => center.clone().addScaledVector(t1, Math.cos(a) * rad).addScaledVector(t2, Math.sin(a) * rad);
    const ring = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, i) => at((i / 64) * Math.PI * 2, 0.017)));
    return { pts: Array.from({ length: r.azs! }, (_, i) => at((i / r.azs!) * Math.PI * 2, 0.017)), ring };
  }, [r]);
  const color = PROVIDERS[r.provider].color;
  return (
    <group>
      <lineLoop geometry={ring} raycast={() => null}><lineBasicMaterial color={color} transparent opacity={0.35} /></lineLoop>
      {pts.map((p, i) => (
        <mesh key={i} position={p} scale={0.0022} raycast={() => null}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
