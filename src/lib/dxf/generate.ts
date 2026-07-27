import {
  clonePairs,
  findSection,
  fmt,
  maxHandle,
  parsePairs,
  serializePairs,
  tableEntry,
  findTable,
  val,
  type Pair,
  type RawEntity,
} from "./groups";
import type { Pt } from "./scan";
import { OUTPUT_LAYER, type CalloutTemplate } from "./template";

const X_CODES = new Set([10, 11, 12, 13]);
const Y_CODES = new Set([20, 21, 22, 23]);

export interface CalloutSpec {
  /** arrow tip: the RN point in the working drawing */
  anchor: Pt;
  /** additional RN points sharing this callout (Y branch) */
  branches: Pt[];
  label: string;
  elevation: string;
}

interface Ctx {
  nextHandle: () => string;
  owner?: string;
}

function applyHandles(pairs: Pair[], ctx: Ctx): Pair[] {
  return pairs.map((p) => {
    if (p.code === 5) return { code: 5, value: ctx.nextHandle() };
    if (p.code === 330 && ctx.owner) return { code: 330, value: ctx.owner };
    return p;
  });
}

function transform(
  pairs: Pair[],
  dx: number,
  dy: number,
  scale?: { originX: number; factor: number },
): Pair[] {
  return pairs.map((p) => {
    if (X_CODES.has(p.code)) {
      let x = parseFloat(p.value);
      if (!Number.isFinite(x)) return p;
      if (scale) x = scale.originX + (x - scale.originX) * scale.factor;
      return { code: p.code, value: fmt(x + dx) };
    }
    if (Y_CODES.has(p.code)) {
      const y = parseFloat(p.value);
      if (!Number.isFinite(y)) return p;
      return { code: p.code, value: fmt(y + dy) };
    }
    return p;
  });
}

function setText(pairs: Pair[], text: string): Pair[] {
  return pairs.map((p) => (p.code === 1 ? { code: 1, value: text } : p));
}

/** Builds all cloned entities for one callout. */
export function buildCallout(t: CalloutTemplate, spec: CalloutSpec, ctx: Ctx): Pair[] {
  const dx = spec.anchor.x - t.anchor.x;
  const dy = spec.anchor.y - t.anchor.y;
  const out: Pair[] = [];

  const widthFactor =
    t.labelValue.length > 0 ? spec.label.length / t.labelValue.length : 1;

  for (const e of t.entities) {
    let pairs = clonePairs(e.pairs);
    const isLabel = e === t.labelText;
    const isElev = e === t.elevText;
    const isUnderline = e === t.underline;

    if (isLabel) pairs = setText(pairs, spec.label);
    if (isElev) pairs = setText(pairs, spec.elevation);

    if (isUnderline && t.underline) {
      const originX = parseFloat(val(t.underline, 10) ?? "0");
      pairs = transform(pairs, dx, dy, { originX, factor: widthFactor });
    } else {
      pairs = transform(pairs, dx, dy);
    }
    out.push(...applyHandles(pairs, ctx));
  }

  // Y branch: extra leader segments from the other RN points to the elbow
  if (spec.branches.length > 0 && t.leader && t.leader.type === "LINE" && t.elbow) {
    const elbow = { x: t.elbow.x + dx, y: t.elbow.y + dy };
    for (const b of spec.branches) {
      const base = clonePairs(t.leader.pairs).map((p) => {
        if (p.code === 10) return { code: 10, value: fmt(b.x) };
        if (p.code === 20) return { code: 20, value: fmt(b.y) };
        if (p.code === 11) return { code: 11, value: fmt(elbow.x) };
        if (p.code === 21) return { code: 21, value: fmt(elbow.y) };
        if (p.code === 30 || p.code === 31) return { code: p.code, value: "0.0" };
        return p;
      });
      out.push(...applyHandles(base, ctx));
    }
  }
  return out;
}

function insertPairs(pairs: Pair[], at: number, extra: Pair[]): Pair[] {
  return [...pairs.slice(0, at), ...extra, ...pairs.slice(at)];
}

/** Clones a table entry (LAYER / STYLE) from the model into the working file if missing. */
function ensureTableEntry(
  workPairs: Pair[],
  modelPairs: Pair[],
  tableName: string,
  entryName: string,
  ctx: Ctx,
  warnings: string[],
): Pair[] {
  if (tableEntry(workPairs, tableName, entryName)) return workPairs;
  const src = tableEntry(modelPairs, tableName, entryName);
  if (!src) {
    warnings.push(
      `A entrada ${tableName} "${entryName}" não existe no DXF modelo nem no DXF de trabalho.`,
    );
    return workPairs;
  }
  const table = findTable(workPairs, tableName);
  if (!table) {
    warnings.push(`O DXF de trabalho não possui tabela ${tableName}.`);
    return workPairs;
  }
  const cloned = applyHandles(clonePairs(src.pairs), ctx);
  return insertPairs(workPairs, table.endtab, cloned);
}

export interface ExportResult {
  dxf: string;
  warnings: string[];
  entityCount: number;
}

export function exportDxf(
  workText: string,
  modelText: string,
  template: CalloutTemplate,
  specs: CalloutSpec[],
  textStyleName?: string,
): ExportResult {
  const warnings: string[] = [];
  let work = parsePairs(workText);
  const model = parsePairs(modelText);

  let handle = Math.max(maxHandle(work), maxHandle(model)) + 0x100;
  const ctx: Ctx = {
    nextHandle: () => (++handle).toString(16).toUpperCase(),
  };

  // owner handle for new entities: reuse the owner of an existing entity
  const entSec = findSection(work, "ENTITIES");
  if (!entSec) throw new Error("O DXF de trabalho não possui seção ENTITIES.");
  for (let i = entSec[0]; i < entSec[1]; i++) {
    if (work[i].code === 330) {
      ctx.owner = work[i].value;
      break;
    }
  }

  // 1) clone table entries (never rebuilt by hand -> keeps codes 370/390 intact)
  work = ensureTableEntry(work, model, "LAYER", OUTPUT_LAYER, ctx, warnings);
  const style = textStyleName ?? (val(template.labelText, 7) ?? "").trim();
  if (style && style !== "STANDARD") {
    work = ensureTableEntry(work, model, "STYLE", style, ctx, warnings);
  }

  // 2) append cloned callout entities right before ENDSEC of ENTITIES
  const sec = findSection(work, "ENTITIES")!;
  const newPairs: Pair[] = [];
  for (const spec of specs) newPairs.push(...buildCallout(template, spec, ctx));
  work = insertPairs(work, sec[1], newPairs);

  // 3) bump $HANDSEED so AutoCAD keeps issuing fresh handles
  for (let i = 0; i < work.length - 2; i++) {
    if (work[i].code === 9 && work[i].value.trim() === "$HANDSEED") {
      work[i + 1] = { code: work[i + 1].code, value: (handle + 0x100).toString(16).toUpperCase() };
      break;
    }
  }

  return { dxf: serializePairs(work), warnings, entityCount: specs.length };
}

export type { RawEntity };