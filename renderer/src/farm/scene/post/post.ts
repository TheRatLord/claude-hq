/**
 * Post-processing ('post' service). The scene renders once into a half-float target with a float depth texture;
 * then: a tiny dual-filter bloom chain at ≤ half res (emissives only: high, time-of-day threshold), one combined
 * full-screen pass (depth ink outlines, valley mist, cloud shadows, bloom, grade, tone map, vignette, dither), and
 * FXAA to the canvas. Quality 'low' drops bloom, FXAA (composite straight to the canvas) and god rays.
 * Weather moments: low-lying mist banks are ray-marched in the composite against the valley-floor heightmap
 * (`groundTexture()`, weather/surfaces.ts); god rays are one quarter-res radial pass toward the sun, only while the sun
 * is in front of the camera and `atmo.rays` is up.
 */
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { SystemFactory } from '../context.ts';
import type { PostService } from '../engine.ts';
import { atmoOf } from '../sky/atmo.ts';
import { compositeFrag, downFrag, fullscreenVert, prefilterFrag, raysFrag, upFrag } from './shaders.ts';
import { GROUND_HALF, groundTexture } from '../weather/surfaces.ts';
import { WORLD } from '../../world/map.ts';

const LEVELS = 5;

export const postSystem: SystemFactory = (ctx) => {
  const { renderer, scene, camera } = ctx;
  const a = atmoOf(ctx);
  const low = ctx.quality === 'low';
  const useBloom = !low, useFxaa = !low, useRays = !low;

  const depth = new THREE.DepthTexture(4, 4, THREE.FloatType);
  const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: depth, depthBuffer: true, samples: 0 });
  sceneRT.texture.generateMipmaps = false;
  const ldrRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
  const raysRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
  const down: THREE.WebGLRenderTarget[] = [], up: THREE.WebGLRenderTarget[] = [];
  for (let i = 0; i < LEVELS; i++) {
    down.push(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    up.push(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
  }

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
    new THREE.ShaderMaterial({ vertexShader: fullscreenVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

  const prefilter = mk(prefilterFrag, { tSrc: { value: sceneRT.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 }, uKnee: { value: 0.4 } });
  const downM = mk(downFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upM = mk(upFrag, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMixBase: { value: 1 } });
  const cu = {
    tColor: { value: sceneRT.texture }, tDepth: { value: depth }, tBloom: { value: up[0].texture },
    uTexel: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 },
    uInk: { value: new THREE.Color() }, uInkStrength: { value: 0.8 }, uOutlinePx: { value: 1 },
    uFogColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uMist: { value: 0 }, uMistHeight: { value: 4 }, uHaze: { value: 0 }, uHazeColor: { value: new THREE.Color() },
    uCloudShadow: { value: 0 }, uCloudCover: { value: 0 }, uCloudOffset: { value: new THREE.Vector2() },
    uBloom: { value: 0.6 }, uExposure: { value: 1 }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.2 },
    uFlash: { value: 0 }, uNight: { value: 0 }, uUseBloom: { value: useBloom ? 1 : 0 },
    uGain: { value: new THREE.Color(1, 1, 1) }, uShadowTint: { value: new THREE.Color(0, 0, 0) },
    tGround: { value: groundTexture() }, tRays: { value: raysRT.texture }, uBanks: { value: 0 }, uWater: { value: WORLD.water },
    uGroundHalf: { value: GROUND_HALF }, uRays: { value: 0 }, uBankDrift: { value: new THREE.Vector2() },
    uBankColor: { value: new THREE.Color() }, uRaysColor: { value: new THREE.Color() },
  };
  const raysM = mk(raysFrag, { tDepth: { value: depth }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
  const sunNdc = new THREE.Vector3(), camFwd = new THREE.Vector3();
  const composite = mk(compositeFrag, cu);
  const fxaa = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: FXAAShader.fragmentShader, depthTest: false, depthWrite: false,
    uniforms: { tDiffuse: { value: ldrRT.texture }, resolution: { value: new THREE.Vector2() } },
  });

  let w = 4, h = 4;
  const pass = (m: THREE.Material, target: THREE.WebGLRenderTarget | null) => {
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  };

  const service: PostService = {
    setSize(cw, ch, pr) {
      w = Math.max(1, Math.round(cw * pr)); h = Math.max(1, Math.round(ch * pr));
      sceneRT.setSize(w, h);
      ldrRT.setSize(w, h);
      raysRT.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
      raysM.uniforms.uAspect.value = w / h;
      let lw = w, lh = h;
      for (let i = 0; i < LEVELS; i++) {
        lw = Math.max(1, Math.round(lw / 2)); lh = Math.max(1, Math.round(lh / 2));
        down[i].setSize(lw, lh); up[i].setSize(lw, lh);
      }
      cu.uTexel.value.set(1 / w, 1 / h);
      cu.uOutlinePx.value = Math.max(1, Math.min(1.5, h / 900));
      fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
    },
    render() {
      const info = renderer.info;
      info.autoReset = false;
      info.reset();
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);

      const g = a.grade;
      if (useBloom) {
        prefilter.uniforms.uTexel.value.set(1 / w, 1 / h);
        prefilter.uniforms.uThreshold.value = g.bloomThreshold;
        pass(prefilter, down[0]);
        for (let i = 1; i < LEVELS; i++) {
          downM.uniforms.tSrc.value = down[i - 1].texture;
          downM.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
          pass(downM, down[i]);
        }
        // up: up[L-2] = up(down[L-1]) + down[L-2] … up[0]
        let src = down[LEVELS - 1];
        for (let i = LEVELS - 2; i >= 0; i--) {
          upM.uniforms.tSrc.value = src.texture;
          upM.uniforms.tBase.value = down[i].texture;
          upM.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
          pass(upM, up[i]);
          src = up[i];
        }
      }

      camera.updateMatrixWorld();
      cu.uNear.value = camera.near; cu.uFar.value = camera.far;
      cu.uInvProj.value.copy(camera.projectionMatrixInverse);
      cu.uCamWorld.value.copy(camera.matrixWorld);
      camera.getWorldPosition(cu.uCamPos.value);
      cu.uTime.value = a.time;
      cu.uInk.value.copy(g.ink);
      cu.uInkStrength.value = g.inkStrength;
      cu.uFogColor.value.copy(ctx.lighting.fogColor);
      cu.uSunDir.value.copy(a.sun);
      cu.uSunColor.value.copy(ctx.lighting.sunColor).multiplyScalar(Math.max(0, a.sunElev > -0.05 ? 1 : 0) * (1 - a.overcast * 0.7));
      cu.uMist.value = a.mist;
      cu.uMistHeight.value = 4 + a.fog * 9;
      cu.uHaze.value = 0.42;
      cu.uHazeColor.value.copy(ctx.lighting.fogColor).lerp(a.zenith, 0.3);
      cu.uCloudShadow.value = a.cloudShadow;
      cu.uCloudCover.value = a.cover;
      cu.uCloudOffset.value.copy(a.cloudOffset);
      cu.uBloom.value = g.bloomStrength;
      cu.uExposure.value = g.exposure;
      cu.uSaturation.value = g.saturation;
      cu.uContrast.value = g.contrast;
      cu.uVignette.value = g.vignette;
      cu.uFlash.value = a.flash;
      cu.uNight.value = a.night;
      cu.uGain.value.copy(g.gain);
      // mist banks: lit by the sky, warmed by a low sun; drift slowly downwind
      cu.uBanks.value = a.banks;
      if (a.banks > 0.001) {
        cu.uBankDrift.value.set(a.cloudOffset.x * 0.004 + a.time * 0.004, a.cloudOffset.y * 0.004 + a.time * 0.003);
        cu.uBankColor.value.copy(ctx.lighting.fogColor).lerp(a.horizon, 0.3).multiplyScalar(1.08 + 0.1 * (1 - a.night));
      }
      // god rays: only when the sun is in front of the camera
      let rays = 0;
      if (useRays && a.rays > 0.01) {
        camera.getWorldDirection(camFwd);
        const facing = camFwd.dot(a.sun);
        if (facing > 0.05) {
          sunNdc.copy(a.sun).multiplyScalar(400).add(cu.uCamPos.value).project(camera);
          const su = sunNdc.x * 0.5 + 0.5, sv = sunNdc.y * 0.5 + 0.5;
          const off = Math.max(Math.abs(su - 0.5), Math.abs(sv - 0.5));
          rays = a.rays * Math.min(1, facing * 3) * (1 - Math.min(1, Math.max(0, (off - 0.7) / 0.6)));
          if (rays > 0.005) {
            raysM.uniforms.uSunUv.value.set(su, sv);
            pass(raysM, raysRT);
            cu.uRaysColor.value.copy(ctx.lighting.sunColor).multiplyScalar(0.55 * (1 - a.overcast * 0.5));
          }
        }
      }
      cu.uRays.value = rays > 0.005 ? rays : 0;
      cu.uShadowTint.value.copy(g.shadowTint);
      pass(composite, useFxaa ? ldrRT : null);
      if (useFxaa) pass(fxaa, null);
    },
  };
  ctx.services.set('post', service);
  // the engine sizes us on start(); cover the case where it already started
  const size = new THREE.Vector2();
  renderer.getSize(size);
  service.setSize(size.x, size.y, renderer.getPixelRatio());

  return {
    name: 'post',
    update() {},
    stats: () => ({ w, h, bloom: useBloom ? 1 : 0 }),
    dispose() {
      ctx.services.delete('post');
      renderer.info.autoReset = true;
      for (const t of [sceneRT, ldrRT, raysRT, ...down, ...up]) t.dispose();
      depth.dispose();
      for (const m of [prefilter, downM, upM, composite, fxaa, raysM]) m.dispose();
      tri.dispose();
    },
  };
};
