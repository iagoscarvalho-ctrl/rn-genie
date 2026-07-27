import { getEntities, layerOf, num, parsePairs, type Pair, type RawEntity } from "./groups";

export interface Pt {
  x: number;
  y: number;
}

export interface ScannedEntity {
  type: string;
  layer: string;
  /** representative points (insert point for INSERT/POINT, vertices for lines) */
  pts: Pt[];
  raw: RawEntity;
}

export interface ScannedDxf {
  pairs: Pair[];
  entities: ScannedEntity[];
  points: ScannedEntity[]; // POINT / INSERT candidates for RN markers
  layers: string[];
}

function vertices(e: RawEntity): Pt[] {
  const pts: Pt[] = [];
  let pendingX: number | null = null;
  for (const p of e.pairs) {
    if (p.code === 10) pendingX = parseFloat(p.value);
    else if (p.code === 20 && pendingX !== null) {
      pts.push({ x: pendingX, y: parseFloat(p.value) });
      pendingX = null;
    }
  }
  if (e.type === "LINE") {
    const x1 = num(e, 11);
    const y1 = num(e, 21);
    if (x1 !== undefined && y1 !== undefined) pts.push({ x: x1, y: y1 });
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function scanDxf(text: string): ScannedDxf {
  const pairs = parsePairs(text);
  const raw = getEntities(pairs);
  const entities: ScannedEntity[] = raw
    .filter((e) => e.type !== "ENDSEC" && e.type !== "SEQEND")
    .map((e) => ({ type: e.type, layer: layerOf(e), pts: vertices(e), raw: e }))
    .filter((e) => e.pts.length > 0);
  const points = entities.filter((e) => e.type === "POINT" || e.type === "INSERT");
  const layers = Array.from(new Set(entities.map((e) => e.layer))).sort();
  return { pairs, entities, points, layers };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToEntity(p: Pt, e: ScannedEntity): number {
  if (e.pts.length === 1) return dist(p, e.pts[0]);
  let min = Infinity;
  for (let i = 0; i + 1 < e.pts.length; i++) {
    min = Math.min(min, distToSegment(p, e.pts[i], e.pts[i + 1]));
  }
  return min;
}

export function boundsOf(entities: ScannedEntity[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const e of entities)
    for (const p of e.pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}