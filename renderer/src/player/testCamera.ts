/**
 * Test-support: a camera double for `createPlayer` (records the pose the controller sets). Owner: PLY. Never imported by
 * app code.
 */
import type { PlayerCamera } from './controller.ts';

/** A vector-like the controller `set`s (starts at the origin). */
export interface FakeVec { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
export interface FakeCamera extends PlayerCamera { position: FakeVec; rotation: FakeVec }

export function fakeCamera(): FakeCamera {
  const vec = (): FakeVec => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  return { position: vec(), rotation: vec(), fov: 60, updateProjectionMatrix() {} };
}
