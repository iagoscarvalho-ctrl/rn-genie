import type { CalloutSpec } from "@/lib/dxf/generate";
import { dist, distToEntity, type Pt, type ScannedDxf, type ScannedEntity } from "@/lib/dxf/scan";
import type { RnRow } from "@/lib/spreadsheet";

export type Classification = "POSTE" | "MURO" | "DIVISA" | "REVISAO";

export interface Settings {
  radius: number;
  posteLayers: string[];
  muroLayers: string[];
}

export interface RnResult {
  key: string; // group key
  rows: RnRow[];
  label: string; // e.g. RN35/37
  elevation: string; // e.g. 768.762
  anchor: Pt | null; // matched DXF point
  branches: Pt[];
  classification: Classification;
  manual: boolean;
  reason: string;
  nearest?: { type: string; layer: string; distance: number };
  runnerUp?: { type: string; layer: string; distance: number };
}

const up = (s: string) => s.trim().toUpperCase();

function inLayers(layer: string, list: string[]): boolean {
  const l = up(layer);
  return list.some((n) => n.trim() && l.includes(up(n)));
}

function matchPoint(row: RnRow, dxf: ScannedDxf, radius: number): ScannedEntity | null {
  let best: ScannedEntity | null = null;
  let bestD = radius;
  for (const p of dxf.points) {
    const d = dist({ x: row.x, y: row.y }, p.pts[0]);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function classify(
  anchor: Pt,
  self: ScannedEntity | null,
  dxf: ScannedDxf,
  s: Settings,
): Pick<RnResult, "classification" | "reason" | "nearest" | "runnerUp"> {
  const candidates: { e: ScannedEntity; d: number; kind: Classification }[] = [];
  for (const e of dxf.entities) {
    if (e === self) continue;
    let kind: Classification | null = null;
    if (e.type === "INSERT" && inLayers(e.layer, s.posteLayers)) kind = "POSTE";
    else if (
      (e.type === "LWPOLYLINE" || e.type === "LINE" || e.type === "POLYLINE") &&
      inLayers(e.layer, s.muroLayers)
    )
      kind = up(e.layer).includes("DIVISA") ? "DIVISA" : "MURO";
    if (!kind) continue;
    const d = distToEntity(anchor, e);
    if (d <= s.radius) candidates.push({ e, d, kind });
  }
  candidates.sort((a, b) => a.d - b.d);
  if (candidates.length === 0) {
    return {
      classification: "REVISAO",
      reason: "Nenhum poste ou muro encontrado dentro do raio de busca.",
    };
  }
  const first = candidates[0];
  const other = candidates.find((c) => c.kind !== first.kind);
  const nearest = { type: first.e.type, layer: first.e.layer, distance: first.d };
  if (other) {
    const runnerUp = { type: other.e.type, layer: other.e.layer, distance: other.d };
    const diff = first.d === 0 ? 0 : Math.abs(other.d - first.d) / Math.max(first.d, 1e-9);
    if (diff < 0.1) {
      return {
        classification: "REVISAO",
        reason: `Empate técnico entre ${first.kind} (${first.d.toFixed(2)} m) e ${other.kind} (${other.d.toFixed(2)} m).`,
        nearest,
        runnerUp,
      };
    }
    return {
      classification: first.kind,
      reason: `Elemento mais próximo: ${first.e.type} na layer ${first.e.layer} a ${first.d.toFixed(2)} m.`,
      nearest,
      runnerUp,
    };
  }
  return {
    classification: first.kind,
    reason: `Elemento mais próximo: ${first.e.type} na layer ${first.e.layer} a ${first.d.toFixed(2)} m.`,
    nearest,
  };
}

export function processRns(rows: RnRow[], dxf: ScannedDxf, s: Settings): RnResult[] {
  // group rows by GrupoChamada
  const groups = new Map<string, RnRow[]>();
  rows.forEach((r, i) => {
    const key = r.grupo ? `G:${r.grupo}` : `R:${r.nome}:${i}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  });

  const results: RnResult[] = [];
  for (const [key, groupRows] of groups) {
    const matched = groupRows.map((r) => ({ row: r, ent: matchPoint(r, dxf, s.radius) }));
    const found = matched.filter((m) => m.ent);
    const label = groupRows
      .map((r, i) => (i === 0 ? r.nome : r.nome.replace(/^\s*RN\s*/i, "")))
      .join("/");
    const elevation = (groupRows[0].z ?? 0).toFixed(3);

    if (found.length === 0) {
      results.push({
        key,
        rows: groupRows,
        label,
        elevation,
        anchor: null,
        branches: [],
        classification: "REVISAO",
        manual: true,
        reason: `Sem ponto correspondente no DXF de trabalho dentro de ${s.radius} m.`,
      });
      continue;
    }

    const anchorEnt = found[0].ent!;
    const anchor = anchorEnt.pts[0];
    const branches = found.slice(1).map((m) => m.ent!.pts[0]);
    const cls = classify(anchor, anchorEnt, dxf, s);
    const missing = matched.filter((m) => !m.ent).map((m) => m.row.nome);
    results.push({
      key,
      rows: groupRows,
      label,
      elevation,
      anchor,
      branches,
      ...cls,
      manual: cls.classification === "REVISAO",
      reason:
        missing.length > 0
          ? `${cls.reason} Sem ponto no DXF para: ${missing.join(", ")}.`
          : cls.reason,
    });
  }
  return results;
}

export function toSpecs(results: RnResult[]): CalloutSpec[] {
  return results
    .filter((r) => r.anchor && r.classification !== "REVISAO")
    .map((r) => ({
      anchor: r.anchor!,
      branches: r.branches,
      label: `${r.label}-${r.classification}`,
      elevation: r.elevation,
    }));
}