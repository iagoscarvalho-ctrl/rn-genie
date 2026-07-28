import { useEffect, useRef } from "react";
import { boundsOf, type ScannedDxf } from "@/lib/dxf/scan";
import type { RnResult } from "@/lib/rn/process";

const COLORS: Record<string, string> = {
  POSTE: "#f5b544",
  MURO: "#3fc4d1",
  CERCA: "#4fc98a",
  REVISAO: "#f0644c",
};

export function PreviewCanvas({ dxf, results }: { dxf: ScannedDxf | null; results: RnResult[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = (canvas.width = canvas.clientWidth * 2);
    const h = (canvas.height = canvas.clientHeight * 2);
    ctx.clearRect(0, 0, w, h);
    if (!dxf || dxf.entities.length === 0) return;

    const b = boundsOf(dxf.entities);
    const spanX = Math.max(b.maxX - b.minX, 1);
    const spanY = Math.max(b.maxY - b.minY, 1);
    const pad = 30;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const tx = (x: number) => pad + (x - b.minX) * scale;
    const ty = (y: number) => h - pad - (y - b.minY) * scale;

    // geometry sketch
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(160,178,200,0.35)";
    for (const e of dxf.entities) {
      if (e.pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(tx(e.pts[0].x), ty(e.pts[0].y));
      for (let i = 1; i < e.pts.length; i++) ctx.lineTo(tx(e.pts[i].x), ty(e.pts[i].y));
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(160,178,200,0.5)";
    for (const e of dxf.entities) {
      if (e.type !== "INSERT") continue;
      ctx.fillRect(tx(e.pts[0].x) - 3, ty(e.pts[0].y) - 3, 6, 6);
    }

    // RN points
    ctx.font = "600 20px ui-monospace, monospace";
    for (const r of results) {
      if (!r.anchor) continue;
      const color = COLORS[r.classification] ?? COLORS.REVISAO;
      const pts = [r.anchor, ...r.branches];
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(tx(p.x), ty(p.y), 7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(15,20,28,0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fillText(r.label, tx(r.anchor.x) + 12, ty(r.anchor.y) - 10);
    }
  }, [dxf, results]);

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-md border border-border bg-background/70">
      <canvas ref={ref} className="h-full w-full" />
      {!dxf && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Envie o DXF de trabalho para ver o preview.
        </p>
      )}
    </div>
  );
}