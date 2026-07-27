import { clonePairs, layerOf, num, val, type Pair, type RawEntity } from "./groups";
import { dist, scanDxf, type Pt, type ScannedEntity } from "./scan";

export const OUTPUT_LAYER = "ELEVACAO_19_TEXTO_RNS";

export interface CalloutTemplate {
  /** raw pairs of the model TEXT entity holding the RN label */
  labelText: RawEntity;
  labelPos: Pt;
  labelValue: string;
  /** raw pairs of the model TEXT entity holding the elevation */
  elevText: RawEntity | null;
  elevPos: Pt | null;
  /** underline LINE/LWPOLYLINE under the label */
  underline: RawEntity | null;
  /** the leader entity (touches the anchor) */
  leader: RawEntity | null;
  /** every entity of the model callout */
  entities: RawEntity[];
  /** arrow tip = point of the callout closest to the RN itself (snapped to the
   *  real RN point in the model when one is found nearby) */
  anchor: Pt;
  /** index, within t.leader.pairs, of the {xCode, xIndex, yIndex} pair that IS
   *  the anchor vertex. Used to force that exact vertex onto spec.anchor at
   *  generation time, instead of trusting the uniform dx/dy translation —
   *  this removes any residual drift left over from imprecise hand-drawn
   *  leaders in the model file. */
  anchorVertex: { xIndex: number; yIndex: number } | null;
  /** leader elbow (other end of the leader) */
  elbow: Pt | null;
  textHeight: number;
  /** approximated width of one character of the label, in drawing units */
  charWidth: number;
}

function centroid(pts: Pt[]): Pt {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

function textPos(e: ScannedEntity): Pt {
  return e.pts[0];
}

function isNumericText(s: string): boolean {
  return /^[+-]?\d+([.,]\d+)?$/.test(s.trim());
}

/** Finds the (xIndex, yIndex) of the vertex closest to `target` within an
 *  entity's raw pairs, trying the 10/20 pair sequence first and, for LINE
 *  entities, the 11/21 endpoint as a fallback. Matches by nearest value
 *  rather than exact equality, so it still works after the anchor gets
 *  snapped to a different (nearby) point. */
function locateNearestVertex(
  pairs: Pair[],
  target: Pt,
  codePairs: [number, number][] = [
    [10, 20],
    [11, 21],
  ],
): { xIndex: number; yIndex: number } | null {
  let best: { xIndex: number; yIndex: number } | null = null;
  let bestD = Infinity;
  for (const [xCode, yCode] of codePairs) {
    let pendingX: number | null = null;
    let pendingXi = -1;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (p.code === xCode) {
        pendingX = parseFloat(p.value);
        pendingXi = i;
      } else if (p.code === yCode && pendingX !== null) {
        const y = parseFloat(p.value);
        const d = Math.hypot(pendingX - target.x, y - target.y);
        if (d < bestD) {
          bestD = d;
          best = { xIndex: pendingXi, yIndex: i };
        }
        pendingX = null;
      }
    }
  }
  return best;
}

/** Smallest distance between any point of `a` and any point of `b`. */
function minEntityDist(a: ScannedEntity, b: ScannedEntity): number {
  let m = Infinity;
  for (const p of a.pts) {
    for (const q of b.pts) {
      const d = dist(p, q);
      if (d < m) m = d;
    }
  }
  return m;
}

/** Grows a cluster from `seed` by connectivity: an entity joins the cluster
 *  only if it's within `epsilon` of an entity already in it (leader touches
 *  underline, text sits close to underline/leader). This is what keeps two
 *  separate example callouts in the same model file from being merged into
 *  one — a fixed search radius can't tell "close" from "next callout over",
 *  but connectivity can, regardless of how far apart the callouts are. */
function clusterConnected(entities: ScannedEntity[], seed: ScannedEntity, epsilon: number): ScannedEntity[] {
  const visited = new Set<ScannedEntity>([seed]);
  const queue: ScannedEntity[] = [seed];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of entities) {
      if (visited.has(e)) continue;
      if (minEntityDist(cur, e) <= epsilon) {
        visited.add(e);
        queue.push(e);
      }
    }
  }
  return entities.filter((e) => visited.has(e));
}

export function extractTemplate(modelText: string, layer = OUTPUT_LAYER): CalloutTemplate {
  const scan = scanDxf(modelText);
  const want = layer.trim().toUpperCase();
  const onLayer = scan.entities.filter((e) => e.layer.toUpperCase() === want);
  if (onLayer.length === 0) {
    throw new Error(
      `O DXF modelo não contém entidades na layer ${layer}. Envie um modelo com uma chamada de RN pronta.`,
    );
  }
  const texts = onLayer.filter((e) => e.type === "TEXT" || e.type === "MTEXT");
  if (texts.length === 0) {
    throw new Error(`Nenhum texto encontrado na layer ${layer} do DXF modelo.`);
  }

  // pick the label text (non-numeric content) as the cluster seed
  const seed = texts.find((t) => !isNumericText(val(t.raw, 1) ?? "")) ?? texts[0];
  const height = num(seed.raw, 40) ?? 14;
  // Connectivity threshold: generous enough to bridge the small gaps between
  // a label and its underline, or an elevation text and its leader (typically
  // well under 2x the text height), but tight enough to not reach a
  // *different* callout drawn elsewhere in the model. height*5 was validated
  // against a real model file with two example callouts ~10-20 units apart.
  // If your model ever packs example callouts closer together than that,
  // keep only one example callout per model file.
  const epsilon = Math.max(height * 5, 2);
  const cluster = clusterConnected(onLayer, seed, epsilon);

  const clusterTexts = cluster.filter((e) => e.type === "TEXT" || e.type === "MTEXT");
  const label = seed;
  const elev =
    clusterTexts.find((t) => t !== label && isNumericText(val(t.raw, 1) ?? "")) ??
    clusterTexts.find((t) => t !== label) ??
    null;
  const lines = cluster.filter((e) => e.type === "LINE" || e.type === "LWPOLYLINE");

  const textCentroid = centroid(clusterTexts.map(textPos));

  // anchor = vertex farthest from the texts (that's where the arrow touches the RN)
  let anchor: Pt = textCentroid;
  let leaderEnt: ScannedEntity | null = null;
  let best = -1;
  for (const l of lines) {
    for (const p of l.pts) {
      const d = dist(p, textCentroid);
      if (d > best) {
        best = d;
        anchor = p;
        leaderEnt = l;
      }
    }
  }

  let elbow: Pt | null = null;
  if (leaderEnt) {
    let dmin = Infinity;
    for (const p of leaderEnt.pts) {
      if (p === anchor) continue;
      const d = dist(p, textCentroid);
      if (d < dmin) {
        dmin = d;
        elbow = p;
      }
    }
  }

  // Snap the anchor to the real RN point in the model (POINT/INSERT, any layer,
  // excluding the callout's own layer) instead of trusting the leader's drawn tip.
  // A hand-drawn leader may not land exactly on the point (missing osnap); if we
  // used its raw endpoint, that small drafting error would repeat, identical, on
  // every generated callout — showing up as a constant offset from the RN point.
  const snapTolerance = Math.max(height * 6, 0.5);
  let nearestPt: Pt | null = null;
  let nearestDist = Infinity;
  for (const p of scan.points) {
    if (p.layer.toUpperCase() === want) continue; // ignore markers drawn on the callout layer itself
    const d = dist(p.pts[0], anchor);
    if (d < nearestDist) {
      nearestDist = d;
      nearestPt = p.pts[0];
    }
  }
  if (nearestPt && nearestDist <= snapTolerance) anchor = nearestPt;

  const anchorVertex = leaderEnt ? locateNearestVertex(leaderEnt.raw.pairs, anchor) : null;

  // underline = horizontal line closest to the label, excluding the leader
  let underline: ScannedEntity | null = null;
  let ubest = Infinity;
  for (const l of lines) {
    if (l === leaderEnt) continue;
    if (l.pts.length < 2) continue;
    const horiz = Math.abs(l.pts[0].y - l.pts[l.pts.length - 1].y) < height * 0.35;
    if (!horiz) continue;
    const d = dist(centroid(l.pts), textPos(label));
    if (d < ubest) {
      ubest = d;
      underline = l;
    }
  }

  const labelValue = (val(label.raw, 1) ?? "").trim();
  let charWidth = height * 0.75;
  if (underline && labelValue.length > 0) {
    const w = Math.abs(underline.pts[underline.pts.length - 1].x - underline.pts[0].x);
    if (w > 0) charWidth = w / labelValue.length;
  }

  return {
    labelText: label.raw,
    labelPos: textPos(label),
    labelValue,
    elevText: elev?.raw ?? null,
    elevPos: elev ? textPos(elev) : null,
    underline: underline?.raw ?? null,
    leader: leaderEnt?.raw ?? null,
    entities: cluster.map((e) => e.raw),
    anchor,
    anchorVertex,
    elbow,
    textHeight: height,
    charWidth,
  };
}

/** Layer / style table entries that must be cloned from the model file. */
export function templateSummary(t: CalloutTemplate) {
  return {
    entities: t.entities.length,
    textHeight: t.textHeight,
    label: t.labelValue,
    hasUnderline: !!t.underline,
    hasLeader: !!t.leader,
    leaderLength: t.elbow ? dist(t.anchor, t.elbow) : 0,
  };
}

export function cloneEntity(e: RawEntity): Pair[] {
  return clonePairs(e.pairs);
}

export { layerOf };
