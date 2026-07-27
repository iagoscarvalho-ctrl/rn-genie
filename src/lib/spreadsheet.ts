import * as XLSX from "xlsx";

export interface RnRow {
  nome: string;
  x: number;
  y: number;
  z: number;
  grupo?: string;
}

const norm = (s: string) =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of Object.keys(obj)) {
    if (keys.includes(norm(k))) return obj[k];
  }
  return undefined;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  // handles "768,762" and "1.234.567,89"
  const cleaned = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return parseFloat(cleaned);
}

export async function readRnSpreadsheet(file: File): Promise<RnRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const rows: RnRow[] = [];
  for (const r of json) {
    const nome = String(pick(r, ["nome", "name", "rn", "ponto", "id"]) ?? "").trim();
    const x = toNum(pick(r, ["x", "este", "leste", "e", "utm_x", "coord_x"]));
    const y = toNum(pick(r, ["y", "norte", "n", "utm_y", "coord_y"]));
    const z = toNum(pick(r, ["z", "cota", "elevacao", "elevation", "altitude", "h"]));
    const grupo = String(
      pick(r, ["grupochamada", "grupo", "grupo_chamada", "callgroup", "group"]) ?? "",
    ).trim();
    if (!nome || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    rows.push({ nome, x, y, z: Number.isFinite(z) ? z : 0, grupo: grupo || undefined });
  }
  return rows;
}