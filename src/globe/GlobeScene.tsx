import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Earth } from './Earth';
import { Markers } from './Markers';
import { Arcs } from './Arcs';
import { Effects } from './Effects';
import { Projector, hudTick } from './overlay';
import { starMaterial } from './shaders';
import { filterRegions, useAtlas } from '../store/useAtlas';
import { OriginLayer } from './Origin';
import { buildMarkets, latLonToVec3 } from '../engine/geo';
import { compareMarket } from '../engine/compare';
import { PROVIDERS } from '../domain/types';

export const WINNER_COLORS = { aws: '#3ee08f', azure: '#4ea8ff', gcp: '#ffc845', none: '#4a5566' } as const;

function useVisibleRegions() {
  const regions = useAtlas((s) => s.regions), providers = useAtlas((s) => s.providers), regionFilter = useAtlas((s) => s.regionFilter);
  return useMemo(() => filterRegions({ regions, providers, regionFilter }), [regions, providers, regionFilter]);
}

const discMat = (color: string) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false,
  uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uWin: { value: color === WINNER_COLORS.none ? 0 : 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uWin; varying vec2 vUv;
    void main(){ vec2 p=vUv-.5; float r=length(p)*2.; float ang=atan(p.y,p.x);
      float edge=smoothstep(.04,0.,abs(r-.92));
      float ticks=step(.5,fract(ang*12./6.2831+uTime*.05))*smoothstep(.04,0.,abs(r-.78))*.6;
      float fill=smoothstep(1.,.0,r)*.28*uWin;
      float a=(edge*(.6+.4*uWin)+ticks*uWin+fill); if(a<.003) discard; gl_FragColor=vec4(uColor*.85,min(a,.9)); }`,
});

/** Price-comparison lens: a marked disc per geographic market coloured by the cheapest comparable provider. */
function MarketDiscs() {
  const visible = useVisibleRegions();
  const indexes = useAtlas((s) => s.indexes), workload = useAtlas((s) => s.workload);
  const markets = useMemo(() => buildMarkets(visible), [visible]);
  const items = useMemo(() => markets.map((m) => {
    const res = compareMarket(m.regions, indexes as any, workload);
    const p = latLonToVec3(m.lat, m.lon, 1.003);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize());
    return { m, p, q, mat: discMat(WINNER_COLORS[res.winner ?? 'none']) };
  }), [markets, indexes, workload]);
  useEffect(() => () => items.forEach((i) => i.mat.dispose()), [items]);
  useFrame(({ clock }) => items.forEach((i) => (i.mat.uniforms.uTime.value = clock.elapsedTime)));
  return (
    <group>
      {items.map(({ m, p, q, mat }) => (
        <mesh key={m.id} position={p} quaternion={q} material={mat} raycast={() => null}><planeGeometry args={[0.085, 0.085]} /></mesh>
      ))}
    </group>
  );
}

function Starfield() {
  const { geo, mat } = useMemo(() => {
    const N = 4000, pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection();
      // concentrate a share of stars into a tilted galactic band
      if (i % 3 === 0) { v.y *= 0.12; v.applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.1); v.normalize(); }
      v.multiplyScalar(40 + Math.random() * 20); pos.set([v.x, v.y, v.z], i * 3);
      size[i] = Math.random() < 0.03 ? 2.6 : 0.6 + Math.random() * 1.1; seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return { geo, mat: starMaterial() };
  }, []);
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime));
  return <points geometry={geo} material={mat} raycast={() => null} />;
}

/** Intro fly-in, then smooth focus transitions for search / selection. */
function CameraRig({ controls }: { controls: React.RefObject<any> }) {
  const focus = useAtlas((s) => s.focus);
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t0: number; dur: number; arc: number } | null>(null);
  useEffect(() => {
    // intro: start far out over the Atlantic and settle over Europe/Africa
    const to = latLonToVec3(22, 15).normalize();
    anim.current = { from: latLonToVec3(-10, -70).normalize(), to, d0: 12, d1: 3.4, t0: performance.now(), dur: 2800, arc: 0 };
  }, []);
  useEffect(() => {
    if (!focus) return;
    anim.current = { from: camera.position.clone().normalize(), to: latLonToVec3(focus.lat, focus.lon).normalize(), d0: camera.position.length(), d1: focus.distance, t0: performance.now(), dur: 1500, arc: 0.35 };
  }, [focus, camera]);
  useFrame(() => {
    hudTick(camera);
    const a = anim.current; if (!a) return;
    const t = Math.min(1, (performance.now() - a.t0) / a.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const ang = a.from.angleTo(a.to), s = Math.sin(ang);
    const dir = s > 1e-4 ? a.from.clone().multiplyScalar(Math.sin((1 - e) * ang) / s).add(a.to.clone().multiplyScalar(Math.sin(e * ang) / s)) : a.to.clone();
    const d = a.d0 + (a.d1 - a.d0) * e + Math.sin(Math.PI * e) * a.arc;
    camera.position.copy(dir.normalize().multiplyScalar(d)); camera.lookAt(0, 0, 0);
    controls.current?.update();
    if (t >= 1) anim.current = null;
  });
  return null;
}

/** Auto-rotate only after 10 s without interaction, and never while hovering or with a selection. */
function IdleRotate({ controls, lastTouch, paused }: { controls: React.RefObject<any>; lastTouch: React.RefObject<number>; paused: boolean }) {
  useFrame(() => { if (controls.current) controls.current.autoRotate = !paused && performance.now() - lastTouch.current! > 10000; });
  return null;
}

export function GlobeScene() {
  const visible = useVisibleRegions();
  const lens = useAtlas((s) => s.lens), selected = useAtlas((s) => s.selected), hovered = useAtlas((s) => s.hovered), select = useAtlas((s) => s.select);
  const controls = useRef<any>(null);
  const lastTouch = useRef(performance.now());
  return (
    <Canvas camera={{ position: [0, 0, 12], fov: 38, near: 0.01, far: 200 }} dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
      onPointerMissed={() => select(null, false)}>
      <color attach="background" args={['#020409']} />
      <Starfield />
      <Earth />
      {lens === 'compare' && <MarketDiscs />}
      <Markers visible={visible} />
      <Arcs />
      <OriginLayer />
      <OrbitControls ref={controls} enablePan={false} minDistance={1.22} maxDistance={7} rotateSpeed={0.42} zoomSpeed={0.65}
        enableDamping dampingFactor={0.07} autoRotateSpeed={0.18} onStart={() => (lastTouch.current = performance.now())} />
      <IdleRotate controls={controls} lastTouch={lastTouch} paused={!!selected || !!hovered} />
      <CameraRig controls={controls} />
      <Projector />
      <Effects />
    </Canvas>
  );
}
export { PROVIDERS };
