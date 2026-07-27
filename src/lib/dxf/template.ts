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
  /** arrow tip = point of the callout closest to the RN itself */
  anchor: Pt;
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
  const seed =
    texts.find((t) => !isNumericText(val(t.raw, 1) ?? "")) ?? texts[0];
  const height = num(seed.raw, 40) ?? 14;
  const radius = Math.max(height * 40, 1);
  const cluster = onLayer.filter((e) =>
    e.pts.some((p) => dist(p, textPos(seed)) <= radius),
  );

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