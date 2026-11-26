// GLSL for the globe. All materials are hand-written ShaderMaterials.
import * as THREE from 'three';

/** Sub-solar point for a date — drives the real day/night terminator. */
export function sunDirection(date = new Date()): THREE.Vector3 {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 864e5;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lon = -(hours - 12) * 15;
  const phi = (90 - decl) * (Math.PI / 180), theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).normalize();
}

const noise3 = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.02; a*=.5; } return s; }
`;

const sphereVert = /* glsl */ `
varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
void main(){
  vUv=uv; vNormalW=normalize(mat3(modelMatrix)*normal);
  vec4 wp=modelMatrix*vec4(position,1.); vPosW=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

/** Earth: land rendered as an equal-area dot lattice, real terminator, ocean glint, coastline glow. */
export function earthMaterial(mask: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { uMask: { value: mask }, uSun: { value: sunDirection() }, uTime: { value: 0 } },
    vertexShader: sphereVert,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask; uniform vec3 uSun; uniform float uTime;
      varying vec2 vUv; varying vec3 vNormalW; varying vec3 vPosW;
      void main(){
        vec3 N=normalize(vNormalW); vec3 V=normalize(cameraPosition-vPosW); vec3 L=normalize(uSun);
        float ndl=dot(N,L);
        float day=smoothstep(-0.18,0.32,ndl);
        float lat=vUv.y*180.-90.; float lon=vUv.x*360.-180.;
        // equal-area dot lattice
        float sp=0.62;
        float rowF=(lat+90.)/sp; float row=floor(rowF)+.5; float latC=row*sp-90.;
        float cl=max(cos(radians(latC)),.04); float lonSp=sp/cl;
        float colF=(lon+180.)/lonSp; float col=floor(colF)+.5; float lonC=col*lonSp-180.;
        vec2 d=vec2((fract(colF)-.5)*lonSp*cl,(fract(rowF)-.5)*sp)/sp;
        float r=length(d); float aa=fwidth(r)*1.2;
        float landAtDot=texture2D(uMask,vec2((lonC+180.)/360.,(latC+90.)/180.)).r;
        float landHere=texture2D(uMask,vUv).r;
        float coast=texture2D(uMask,vUv).g;
        float dotM=(1.-smoothstep(.30-aa,.30+aa,r))*step(.5,landAtDot);
        float far=smoothstep(.18,.55,aa);              // when dots alias, fade to a soft fill
        float landM=mix(dotM,landHere*.55,far);
        // palette
        vec3 oceanDeep=vec3(.010,.020,.040), oceanLit=vec3(.020,.055,.100);
        vec3 landDay=vec3(.45,.68,.92), landNight=vec3(.10,.17,.28);
        float fres=pow(1.-max(dot(N,V),0.),2.5);
        vec3 col3=mix(oceanDeep,oceanLit,day*.9+fres*.4);
        col3=mix(col3,mix(landNight,landDay,day),landM*(.55+.45*day));
        col3+=vec3(.25,.55,.95)*coast*(.18+.32*day);    // coastline/border hairlines
        // ocean glint
        vec3 R=reflect(-L,N); float spec=pow(max(dot(R,V),0.),60.)*day*(1.-landHere);
        col3+=vec3(.55,.75,1.)*spec*.7;
        // inner rim light
        col3+=vec3(.20,.45,.95)*fres*(.25+.55*day)*.6;
        // twilight band
        col3+=vec3(.9,.45,.2)*exp(-pow(ndl*7.,2.))*.06;
        gl_FragColor=vec4(col3,1.);
      }`,
  });
}

/** Procedural drifting cloud shell, lit by the sun. */
export function cloudMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSun: { value: sunDirection() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vNormalW; varying vec3 vPosW;
      void main(){ vP=position; vNormalW=normalize(mat3(modelMatrix)*normal); vec4 wp=modelMatrix*vec4(position,1.); vPosW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: noise3 + /* glsl */ `
      uniform vec3 uSun; uniform float uTime; varying vec3 vP; varying vec3 vNormalW; varying vec3 vPosW;
      void main(){
        vec3 p=vP*2.4+vec3(uTime*.006,0.,uTime*.004);
        float n=fbm(p+fbm(p*.7)*.6);
        float c=smoothstep(.18,.62,n);
        float day=smoothstep(-.1,.4,dot(normalize(vNormalW),normalize(uSun)));
        vec3 V=normalize(cameraPosition-vPosW); float edge=smoothstep(0.,.35,dot(normalize(vNormalW),V));
        gl_FragColor=vec4(vec3(.75,.85,1.)*(.25+.75*day),c*.16*(.25+.75*day)*edge);
      }`,
  });
}

/** Atmospheric scattering shell — brighter on the sunlit limb. */
export function atmosphereMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sunDirection() } },
    vertexShader: sphereVert,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying vec3 vNormalW; varying vec3 vPosW;
      void main(){
        vec3 N=normalize(vNormalW); vec3 V=normalize(cameraPosition-vPosW);
        float rim=pow(clamp(1.-abs(dot(N,V))*1.05,0.,1.),5.);
        float limb=pow(clamp(dot(N,V)+.55,0.,1.),2.);
        float sun=.35+.65*smoothstep(-.4,.6,dot(N,normalize(uSun)));
        vec3 c=mix(vec3(.10,.35,1.),vec3(.45,.75,1.),sun);
        gl_FragColor=vec4(c*rim*limb*sun*2.4,1.);
      }`,
  });
}

/** Instanced beacon: tangent quad that draws an expanding pulse ring + soft core. */
export function beaconMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aPhase; attribute float aStrength;
      varying vec2 vUv; varying vec3 vColor; varying float vPhase; varying float vStrength;
      void main(){ vUv=uv; 
        #ifdef USE_INSTANCING_COLOR
          vColor=instanceColor;
        #else
          vColor=vec3(1.);
        #endif
        vPhase=aPhase; vStrength=aStrength;
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vColor; varying float vPhase; varying float vStrength;
      void main(){
        float r=length(vUv-.5)*2.;
        float t=fract(uTime*.35+vPhase);
        float ring=smoothstep(.05,0.,abs(r-t))*(1.-t);
        float core=exp(-r*r*28.)*1.6;
        float halo=exp(-r*r*5.)*.25;
        float a=(ring*.9+core+halo)*vStrength;
        if(a<.002) discard;
        gl_FragColor=vec4(vColor*a*1.6,a);
      }`,
  });
}

/** Instanced light beam: open cylinder, gradient fade to the tip. */
export function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying float vY; varying vec3 vColor; varying float vFace;
      void main(){ vY=uv.y; 
        #ifdef USE_INSTANCING_COLOR
          vColor=instanceColor;
        #else
          vColor=vec3(1.);
        #endif
       
        vec3 base=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        vFace=smoothstep(.05,.35,dot(normalize(base),normalize(cameraPosition)));   // fade beams near the limb
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying float vY; varying vec3 vColor; varying float vFace;
      void main(){ float a=(pow(1.-vY,1.6)*.9 + smoothstep(.97,1.,vY)*.8)*vFace; if(a<.002) discard; float scan=.75+.25*sin(vY*40.-uTime*3.);
        gl_FragColor=vec4(vColor*a*scan*1.5,a); }`,
  });
}

/** Great-circle arc tube with a travelling pulse. */
export function arcMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: color }, uOffset: { value: Math.random() }, uDraw: { value: 0 } },
    vertexShader: /* glsl */ `varying float vT; void main(){ vT=uv.x; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uColor; uniform float uOffset; uniform float uDraw; varying float vT;
      void main(){
        if(vT>uDraw) discard;
        float head=fract(uTime*.45+uOffset);
        float pulse=smoothstep(.1,0.,abs(vT-head))*.75;
        float base=.07*smoothstep(0.,.06,vT)*smoothstep(1.,.94,vT);
        float a=base+pulse;
        gl_FragColor=vec4(uColor*a,a);
      }`,
  });
}

/** Twinkling starfield with a faint galactic band. */
export function starMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `attribute float aSize; attribute float aSeed; uniform float uTime; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vA=.45+.55*sin(uTime*(.6+aSeed)+aSeed*40.);
        gl_PointSize=aSize*(300./-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */ `varying float vA; void main(){ float r=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,r)*vA; gl_FragColor=vec4(vec3(.75,.85,1.)*a,a); }`,
  });
}
