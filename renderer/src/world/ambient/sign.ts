/**
 * Canvas lettering for the ambient cast's hand-held cards ("herdr offline"). UI/canvas text uses the system font stack
 * (§10 Assets); drawn once at boot, unlit (screen material ≤ 0.95, §5.0). Owner: AMB.
 */
import * as THREE from 'three';
import { getMaterial } from '../../render/materials/index.ts';
import { CORE, MISC, STATUS } from '../../../../shared/palette.ts';
import type { AmbScene } from './util.ts';

const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Ubuntu", "Cantarell", "DejaVu Sans", system-ui, sans-serif';

export function card(line1: string, line2: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 512, h = 300;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = MISC.whiteboard; g.fillRect(0, 0, w, h);
  // hand-drawn double border
  g.strokeStyle = CORE.ink; g.lineWidth = 10; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(14, 18); g.lineTo(w - 16, 12); g.lineTo(w - 12, h - 16); g.lineTo(18, h - 12); g.closePath(); g.stroke();
  // unplugged-plug doodle
  g.save(); g.translate(78, 150); g.rotate(-0.25);
  g.fillStyle = STATUS.blocked; g.beginPath(); g.roundRect(-34, -26, 52, 52, 10); g.fill();
  g.fillStyle = CORE.ink; g.fillRect(18, -14, 26, 8); g.fillRect(18, 6, 26, 8);
  g.strokeStyle = CORE.ink; g.lineWidth = 7; g.beginPath(); g.moveTo(-34, 0); g.bezierCurveTo(-60, 0, -50, 60, -70, 80); g.stroke();
  g.restore();
  g.fillStyle = CORE.ink; g.textBaseline = 'middle'; g.textAlign = 'left';
  const fit = (text: string, px: number) => { g.font = `800 ${px}px ${FONT}`; const m = g.measureText(text).width; if (m > w - 168) g.font = `800 ${Math.floor(px * (w - 168) / m)}px ${FONT}`; };
  fit(line1, 92); g.fillText(line1, 142, 108);
  g.fillStyle = STATUS.blocked;
  fit(line2, 84); g.fillText(line2, 142, 202);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A card quad (hidden until `show`). The caller writes `mesh.matrix` (matrixAutoUpdate off).
 * @param w width in metres
 */
export function createCard(parent: AmbScene, line1: string, line2: string, w = 0.5) {
  const tex = typeof document !== 'undefined' ? card(line1, line2) : null;
  // [RND fix r1, cross-owner AMB] count-1 InstancedMesh + instanced material: the one §5.4 screen program (a plain Mesh
  // compiled an off-matrix `hq|screen|` variant the first time the card showed)
  // getMaterial is typed to the base class; the 'screen' kind is always a MeshBasicMaterial (render/materials/screen.ts)
  const mat = getMaterial('screen', { color: '#FFFFFF', emissive: 0.72, strip: null, instanced: true, uniforms: {} }) as THREE.MeshBasicMaterial;
  if (tex) { mat.map = tex; mat.needsUpdate = true; }
  const mesh = new THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>(new THREE.PlaneGeometry(w, w * (300 / 512)), mat, 1);
  mesh.name = 'amb:card';
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}
