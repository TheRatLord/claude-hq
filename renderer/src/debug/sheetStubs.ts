/**
 * What the debug sheets (`?sheet=hero`, `?sheet=props`) stub so `installHq` and the probes run without a backend or a
 * player: the store slices `__hq.stats()` reads, a camera-driven player, and the reply of a store call that never
 * happens. Owner: CORE.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/ctx.ts';
import type { ReplyMsg } from '../../../shared/protocol.ts';

/**
 * A partial object standing in for a full interface (the sheets have no world, no socket, no input). The one cast of the
 * sheets: every member the sheet's ctx consumers read is supplied by the caller.
 */
export const stub = <T extends object>(part: Partial<T>): T => part as T;

/** A store with no entities, no connection and no herdr (`demo` false, so `__hq.demo` never calls the socket). */
export const sheetStore = (): Ctx['store'] => stub<Ctx['store']>({
  entities: new Map(),
  conn: { state: 'closed', since: 0, retryInMs: null, connects: 0 },
  herdr: { connected: false },
  demo: false,
  now: () => Date.now(),
  on: () => () => false,
});

/** A player that is just the camera: `setPose` / `getPose` move and read it (y = feet, `eye` above them). */
export const sheetPlayer = (camera: THREE.PerspectiveCamera, eye: number): Ctx['player'] => stub<Ctx['player']>({
  eyeHeight: eye,
  setPose(x, y, z, yaw, pitch) { camera.position.set(x, y + eye, z); camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld(); },
  getPose() { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); return [camera.position.x, camera.position.y - eye, camera.position.z, e.y, e.x]; },
});

/** `__hq` store call on a sheet: nobody answers. */
export const noReply: ReplyMsg = { t: 'reply', rid: null, ok: false, error: 'sheet' };
