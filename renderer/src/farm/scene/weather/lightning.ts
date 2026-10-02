/**
 * Storm lightning: a jagged, branching bolt far out over the valley (HDR white-violet so it blooms), a flash that
 * lights the whole scene (sky + hemisphere + post exposure read `atmo.flash`), and thunder through the audio service
 * after the sound's travel time.
 */
import * as THREE from 'three';
import type { AudioService, SceneCtx } from '../context.ts';
import { heightAt } from '../../world/map.ts';

const MAX_SEG = 90;

export interface Lightning {
  mesh: THREE.Mesh;
  /** returns the flash level 0..1 for this frame */
  update(dt: number, storm: number, camPos: THREE.Vector3, camYaw: number): number;
  /** trigger a strike now (dev) */
  strike(): void;
}

export function createLightning(ctx: SceneCtx): Lightning {
  const pos = new Float32Array(MAX_SEG * 6 * 3);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 7), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'lightning';
  let seed = 777;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  let t = 99, next = 4, thunderAt = -1, thunderVol = 1;
  let pulses: number[] = [];
  let nSeg = 0;
  const side = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();

  const addSeg = (p0: THREE.Vector3, p1: THREE.Vector3, w0: number, w1: number) => {
    if (nSeg >= MAX_SEG) return;
    const o = nSeg * 18;
    // ribbon in a plane facing the camera horizontally
    const q = [p0.x - side.x * w0, p0.y, p0.z - side.z * w0, p0.x + side.x * w0, p0.y, p0.z + side.z * w0, p1.x + side.x * w1, p1.y, p1.z + side.z * w1,
      p0.x - side.x * w0, p0.y, p0.z - side.z * w0, p1.x + side.x * w1, p1.y, p1.z + side.z * w1, p1.x - side.x * w1, p1.y, p1.z - side.z * w1];
    pos.set(q, o);
    nSeg++;
  };
  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, steps: number, w: number, depth: number, groundY: number) => {
    a.copy(start);
    const d = dir.clone();
    const p = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      p.copy(a);
      d.x = d.x * 0.3 + (rnd() - 0.5) * 1.8; d.z = d.z * 0.3 + (rnd() - 0.5) * 0.6; d.y = -1;
      d.normalize();
      b.copy(a).addScaledVector(d, len * (0.6 + rnd() * 0.8));
      if (b.y < groundY) b.y = groundY;
      const k = 1 - i / steps;
      addSeg(p, b, w * (0.4 + 0.6 * k), w * (0.4 + 0.6 * (k - 1 / steps)));
      if (depth < 2 && rnd() < 0.22) branch(b.clone(), new THREE.Vector3((rnd() - 0.5) * 2, -1, (rnd() - 0.5)), len * 0.7, Math.floor(steps * 0.4), w * 0.55, depth + 1, groundY);
      a.copy(b);
      if (b.y <= groundY) break;
    }
  };

  const strikeAt = (camPos: THREE.Vector3, yaw: number) => {
    // mostly in front of the player so it is seen, far out beyond the fields
    const ang = yaw + (rnd() - 0.5) * 2.2;
    const dist = 170 + rnd() * 160;
    const x = camPos.x - Math.sin(ang) * dist, z = camPos.z - Math.cos(ang) * dist;
    const gy = heightAt(x, z);
    side.set(Math.cos(ang), 0, -Math.sin(ang));
    nSeg = 0;
    branch(new THREE.Vector3(x, 170 + rnd() * 40, z), new THREE.Vector3(0, -1, 0), 10, 30, 2.6, 0, gy);
    attr.needsUpdate = true;
    geo.setDrawRange(0, nSeg * 6);
    t = 0;
    pulses = [0, 0.09 + rnd() * 0.05, 0.22 + rnd() * 0.12];
    if (rnd() < 0.4) pulses.push(0.4 + rnd() * 0.15);
    thunderAt = 0.4 + dist / 340;
    thunderVol = Math.min(1, 160 / dist);
  };

  let lastCam = new THREE.Vector3(), lastYaw = 0;
  return {
    mesh,
    strike() { strikeAt(lastCam, lastYaw); },
    update(dt, storm, camPos, camYaw) {
      lastCam = camPos; lastYaw = camYaw;
      t += dt;
      if (storm > 0.25) {
        next -= dt;
        if (next <= 0) { strikeAt(camPos, camYaw); next = (4 + rnd() * 12) / Math.max(0.4, storm); }
      } else next = Math.max(next, 2 + rnd() * 3);
      if (thunderAt > 0 && t >= thunderAt) {
        thunderAt = -1;
        (ctx.services.get('audio') as AudioService | undefined)?.play('thunder', { volume: thunderVol });
      }
      let flash = 0;
      for (let i = 0; i < pulses.length; i++) {
        const dtp = t - pulses[i];
        if (dtp >= 0) flash = Math.max(flash, Math.exp(-dtp * 16) * (i === 0 ? 1 : 0.75));
      }
      mesh.visible = t < (pulses[pulses.length - 1] ?? 0) + 0.12;
      mat.opacity = Math.min(1, flash * 1.6 + 0.15);
      return flash;
    },
  };
}
