// @pure
/**
 * The farmers' road network: a waypoint graph built from the valley's PATHS polylines, plus the square as an open
 * junction, and a router that gets from anywhere to anywhere via plot gates. Pure (no three), tested in node.
 *
 * Farmers walk on roads between places and cut straight across only for the last few metres (inside a field, from a
 * road to a hangout), so the valley reads like villagers commuting rather than particles.
 */
import type { PathLine, Site, XZ } from '../../world/map.ts';
import { siteToWorld, inSite } from '../../world/map.ts';

export interface RoadGraph {
  nodes: XZ[];
  adj: number[][];
}

const d = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

/** Square bounds (open area where any two points connect directly). */
export interface Square { x: number; z: number; hw: number; hd: number }

export function buildRoads(paths: readonly PathLine[], square: Square): RoadGraph {
  const nodes: XZ[] = [];
  const adj: number[][] = [];
  const add = (p: XZ): number => {
    for (let i = 0; i < nodes.length; i++) if (d(nodes[i], p) < 0.6) return i;
    nodes.push({ x: p.x, z: p.z });
    adj.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b || adj[a].includes(b)) return;
    adj[a].push(b);
    adj[b].push(a);
  };
  const lines: number[][] = paths.map((p) => p.points.map(add));
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) link(l[i], l[i + 1]);
  // junctions: a road that starts in the middle of another joins its nearest segment (both ends)
  for (let li = 0; li < lines.length; li++) {
    for (const end of [lines[li][0], lines[li][lines[li].length - 1]]) {
      const p = nodes[end];
      let best = Infinity, ba = -1, bb = -1;
      for (let lj = 0; lj < lines.length; lj++) {
        if (lj === li) continue;
        const l = lines[lj];
        for (let i = 0; i + 1 < l.length; i++) {
          const a = nodes[l[i]], b = nodes[l[i + 1]];
          const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
          const e = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
          if (e < best) { best = e; ba = l[i]; bb = l[i + 1]; }
        }
      }
      if (best < 6 && ba >= 0) { link(end, ba); link(end, bb); }
    }
  }
  // the square: everything inside it (and just around its edge) is mutually reachable through a centre node
  const c = add({ x: square.x, z: square.z });
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    if (i !== c && Math.abs(p.x - square.x) <= square.hw + 1.5 && Math.abs(p.z - square.z) <= square.hd + 1.5) link(i, c);
  }
  return { nodes, adj };
}

export function nearestNode(g: RoadGraph, x: number, z: number): number {
  let best = Infinity, bi = 0;
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i];
    const e = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (e < best && g.adj[i].length) { best = e; bi = i; }
  }
  return bi;
}

/** A* over the graph; node indices start → goal (inclusive), or null. */
export function astarNodes(g: RoadGraph, s: number, t: number): number[] | null {
  const n = g.nodes.length;
  const gs = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = [s];
  const f = new Float64Array(n).fill(Infinity);
  gs[s] = 0;
  f[s] = d(g.nodes[s], g.nodes[t]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const u = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (u === t) {
      const out = [u];
      let k = u;
      while (came[k] >= 0) { k = came[k]; out.push(k); }
      return out.reverse();
    }
    if (closed[u]) continue;
    closed[u] = 1;
    for (const v of g.adj[u]) {
      if (closed[v]) continue;
      const ng = gs[u] + d(g.nodes[u], g.nodes[v]);
      if (ng < gs[v]) {
        gs[v] = ng;
        came[v] = u;
        f[v] = ng + d(g.nodes[v], g.nodes[t]);
        open.push(v);
      }
    }
  }
  return null;
}

/** Local waypoints of a site's entrance: just inside the gate, then the gate on the road. */
export function gateway(site: Site): [XZ, XZ] {
  return [siteToWorld(site, 0, site.d / 2 - 1.2), site.gate];
}

export function siteOf(sites: readonly Site[], p: XZ, margin = 0.3): Site | null {
  for (const s of sites) if (inSite(s, p.x, p.z, margin)) return s;
  return null;
}

/**
 * Route from `from` to `to` (world XZ): leave the current field through its gate, follow the roads, enter the target
 * field through its gate. Short hops in the open go direct. The start point is not included.
 */
export function route(g: RoadGraph, sites: readonly Site[], from: XZ, to: XZ): XZ[] {
  const fs = siteOf(sites, from), ts = siteOf(sites, to);
  if (fs && fs === ts) return [{ x: to.x, z: to.z }];
  if (!fs && !ts && d(from, to) < 9) return [{ x: to.x, z: to.z }];
  const head: XZ[] = [];
  const tail: XZ[] = [];
  let a: XZ = from, b: XZ = to;
  if (fs) { const [inner, gate] = gateway(fs); head.push(inner, gate); a = gate; }
  if (ts) { const [inner, gate] = gateway(ts); tail.push(gate, inner); b = gate; }
  const out: XZ[] = [...head];
  if (d(a, b) > 6) {
    const s = nearestNode(g, a.x, a.z), t = nearestNode(g, b.x, b.z);
    const ns = astarNodes(g, s, t) ?? [];
    const pts = ns.map((i) => g.nodes[i]);
    // skip a first road node that lies behind us, and a last one past the destination
    if (pts.length >= 2 && d(a, pts[1]) < d(pts[0], pts[1])) pts.shift();
    if (pts.length >= 2 && d(b, pts[pts.length - 2]) < d(pts[pts.length - 1], pts[pts.length - 2])) pts.pop();
    for (const p of pts) if (!out.length || d(out[out.length - 1], p) > 0.4) out.push({ x: p.x, z: p.z });
  }
  for (const p of tail) if (!out.length || d(out[out.length - 1], p) > 0.4) out.push(p);
  out.push({ x: to.x, z: to.z });
  return out;
}

export function pathLength(from: XZ, pts: readonly XZ[]): number {
  let l = 0, p = from;
  for (const q of pts) { l += d(p, q); p = q; }
  return l;
}
