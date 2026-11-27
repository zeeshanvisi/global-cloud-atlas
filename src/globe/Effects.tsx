import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Film finish: vignette + fine grain + faint chromatic fringe toward the edges. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c=vUv-.5; float d=length(c);
      vec2 off=c*d*.004;
      vec3 col=vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
      col*=smoothstep(.95,.25,d)*.55+.45;
      col+=(hash(vUv*1000.+uTime)-.5)*.006;
      gl_FragColor=vec4(col,1.);
    }`,
};

/** Post-processing chain built directly on three.js passes; takes over rendering (priority 1). */
export function Effects() {
  const { gl, scene, camera, size } = useThree();
  const { composer, finish, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.8, 0.5, 0.85);
    composer.addPass(bloom);
    const finish = new ShaderPass(FinishShader);
    composer.addPass(finish);
    composer.addPass(new OutputPass());
    return { composer, finish, bloom };
  }, [gl, scene, camera]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio()); composer.setSize(size.width, size.height); bloom.setSize(size.width, size.height);
  }, [composer, bloom, gl, size]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame(({ clock }, dt) => { finish.uniforms.uTime.value = clock.elapsedTime; composer.render(dt); }, 1);
  return null;
}
