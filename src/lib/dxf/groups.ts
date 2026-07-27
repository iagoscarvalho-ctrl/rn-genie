// Low-level DXF group-code utilities.
// Everything is kept as raw (code, value) pairs so that table entries and
// template entities can be cloned verbatim instead of being rebuilt.

export interface Pair {
  code: number;
  value: string;
}

export function parsePairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] ?? "" });
  }
  return pairs;
}

export function serializePairs(pairs: Pair[]): string {
  const out: string[] = [];
  for (const p of pairs) {
    out.push(String(p.code));
    out.push(p.value);
  }
  return out.join("\r\n") + "\r\n";
}

export function clonePairs(pairs: Pair[]): Pair[] {
  return pairs.map((p) => ({ code: p.code, value: p.value }));
}

/** Index range of a SECTION: [indexOf(0/SECTION), indexOf(0/ENDSEC)] */
export function findSection(pairs: Pair[], name: string): [number, number] | null {
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === "SECTION") {
      const n = pairs[i + 1];
      if (n && n.code === 2 && n.value.trim() === name) {
        for (let j = i + 2; j < pairs.length; j++) {
          if (pairs[j].code === 0 && pairs[j].value.trim() === "ENDSEC") return [i, j];
        }
      }
    }
  }
  return null;
}

export interface RawEntity {
  type: string;
  pairs: Pair[]; // starts with (0, TYPE)
  start: number;
  end: number; // exclusive
}

/** Splits a pair range into 0-code delimited records. */
export function splitRecords(pairs: Pair[], from: number, to: number): RawEntity[] {
  const recs: RawEntity[] = [];
  let cur: RawEntity | null = null;
  for (let i = from; i < to; i++) {
    if (pairs[i].code === 0) {
      if (cur) {
        cur.end = i;
        cur.pairs = pairs.slice(cur.start, i);
        recs.push(cur);
      }
      cur = { type: pairs[i].value.trim(), pairs: [], start: i, end: to };
    }
  }
  if (cur) {
    cur.pairs = pairs.slice(cur.start, to);
    recs.push(cur);
  }
  return recs;
}

export function getEntities(pairs: Pair[]): RawEntity[] {
  const sec = findSection(pairs, "ENTITIES");
  if (!sec) return [];
  return splitRecords(pairs, sec[0] + 2, sec[1]);
}

export function val(e: { pairs: Pair[] }, code: number): string | undefined {
  const p = e.pairs.find((x) => x.code === code);
  return p?.value;
}

export function num(e: { pairs: Pair[] }, code: number): number | undefined {
  const v = val(e, code);
  if (v === undefined) return undefined;
  const n = parseFloat(v.trim());
  return Number.isNaN(n) ? undefined : n;
}

export function layerOf(e: { pairs: Pair[] }): string {
  return (val(e, 8) ?? "0").trim();
}

export interface TableInfo {
  name: string;
  /** index of the (0, ENDTAB) pair for this table */
  endtab: number;
  entries: RawEntity[];
}

export function findTable(pairs: Pair[], tableName: string): TableInfo | null {
  const sec = findSection(pairs, "TABLES");
  if (!sec) return null;
  for (let i = sec[0]; i < sec[1]; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === "TABLE") {
      const n = pairs[i + 1];
      if (n && n.code === 2 && n.value.trim() === tableName) {
        for (let j = i + 2; j < sec[1]; j++) {
          if (pairs[j].code === 0 && pairs[j].value.trim() === "ENDTAB") {
            return { name: tableName, endtab: j, entries: splitRecords(pairs, i + 2, j) };
          }
        }
      }
    }
  }
  return null;
}

export function tableEntry(pairs: Pair[], tableName: string, entryName: string): RawEntity | null {
  const t = findTable(pairs, tableName);
  if (!t) return null;
  const target = entryName.toUpperCase();
  return (
    t.entries.find((e) => e.type === tableName && (val(e, 2) ?? "").trim().toUpperCase() === target) ??
    null
  );
}

export function maxHandle(pairs: Pair[]): number {
  let max = 0;
  for (const p of pairs) {
    if (p.code === 5 || p.code === 105) {
      const n = parseInt(p.value.trim(), 16);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
}