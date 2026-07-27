import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { scanDxf, type ScannedDxf } from "@/lib/dxf/scan";
import { extractTemplate, type CalloutTemplate } from "@/lib/dxf/template";
import { exportDxf } from "@/lib/dxf/generate";
import { readRnSpreadsheet, type RnRow } from "@/lib/spreadsheet";
import {
  processRns,
  toSpecs,
  type Classification,
  type RnResult,
  type Settings,
} from "@/lib/rn/process";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chamadas de RN em DXF | Automação topográfica" },
      {
        name: "description",
        content:
          "Automatize chamadas de Referências de Nível em plantas DXF georreferenciadas: classifica poste ou muro e exporta o DXF pronto.",
      },
      { property: "og:title", content: "Chamadas de RN em DXF | Automação topográfica" },
      {
        property: "og:description",
        content:
          "Cruze planilha de RNs com o DXF de trabalho, classifique poste/muro e gere as chamadas na layer ELEVACAO_19_TEXTO_RNS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MODEL_KEY = "rn-dxf-model";

const CLASS_STYLES: Record<Classification, string> = {
  POSTE: "border-poste/50 text-poste",
  MURO: "border-muro/50 text-muro",
  DIVISA: "border-divisa/50 text-divisa",
  REVISAO: "border-revisao/50 text-revisao",
};

function FileField({
  label,
  hint,
  accept,
  onFile,
  state,
}: {
  label: string;
  hint: string;
  accept: string;
  onFile: (f: File) => void;
  state?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className="rounded-md border border-border bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => ref.current?.click()}>
          Selecionar
        </Button>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {state && <p className="mt-3 font-display text-xs text-accent">{state}</p>}
    </div>
  );
}

function Index() {
  const [modelText, setModelText] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(MODEL_KEY);
  });
  const [modelName, setModelName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(MODEL_KEY + "-name");
  });
  const [template, setTemplate] = useState<CalloutTemplate | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [workText, setWorkText] = useState<string | null>(null);
  const [workName, setWorkName] = useState<string | null>(null);
  const [workDxf, setWorkDxf] = useState<ScannedDxf | null>(null);

  const [rows, setRows] = useState<RnRow[]>([]);
  const [sheetName, setSheetName] = useState<string | null>(null);

  const [radius, setRadius] = useState(5);
  const [posteLayers, setPosteLayers] = useState("POSTE, ILUMINACAO");
  const [muroLayers, setMuroLayers] = useState("MURO, DIVISA, EDIFICACAO");

  const [results, setResults] = useState<RnResult[]>([]);
  const [processed, setProcessed] = useState(false);

  // load model on mount (client only)
  useMemo(() => {
    if (modelText && !template) {
      try {
        setTemplate(extractTemplate(modelText));
        setTemplateError(null);
      } catch (e) {
        setTemplateError((e as Error).message);
      }
    }
  }, [modelText, template]);

  async function onModel(f: File) {
    const text = await f.text();
    try {
      const t = extractTemplate(text);
      setTemplate(t);
      setTemplateError(null);
      setModelText(text);
      setModelName(f.name);
      try {
        window.localStorage.setItem(MODEL_KEY, text);
        window.localStorage.setItem(MODEL_KEY + "-name", f.name);
      } catch {
        toast.info("Modelo carregado, mas grande demais para ficar salvo no navegador.");
      }
      toast.success(`Molde extraído: ${t.entities.length} entidades, texto ${t.textHeight}.`);
    } catch (e) {
      setTemplateError((e as Error).message);
      toast.error((e as Error).message);
    }
  }

  async function onWork(f: File) {
    const text = await f.text();
    const scan = scanDxf(text);
    setWorkText(text);
    setWorkName(f.name);
    setWorkDxf(scan);
    setProcessed(false);
    setResults([]);
    toast.success(`DXF de trabalho lido: ${scan.entities.length} entidades.`);
  }

  async function onSheet(f: File) {
    try {
      const r = await readRnSpreadsheet(f);
      setRows(r);
      setSheetName(f.name);
      setProcessed(false);
      toast.success(`${r.length} RNs carregadas da planilha.`);
    } catch (e) {
      toast.error("Não foi possível ler a planilha: " + (e as Error).message);
    }
  }

  const settings: Settings = {
    radius,
    posteLayers: posteLayers.split(","),
    muroLayers: muroLayers.split(","),
  };

  function process() {
    if (!workDxf) return toast.error("Envie o DXF de trabalho.");
    if (rows.length === 0) return toast.error("Envie a planilha de RNs.");
    const res = processRns(rows, workDxf, settings);
    setResults(res);
    setProcessed(true);
    const manual = res.filter((r) => r.manual).length;
    toast.success(`${res.length} chamadas analisadas · ${manual} para revisão manual.`);
  }

  function setClassification(key: string, value: Classification) {
    setResults((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, classification: value, manual: value === "REVISAO" } : r,
      ),
    );
  }

  function exportFile() {
    if (!workText || !modelText || !template) return toast.error("Faltam o DXF modelo ou de trabalho.");
    const specs = toSpecs(results);
    if (specs.length === 0) return toast.error("Nenhuma chamada classificada para exportar.");
    try {
      const out = exportDxf(workText, modelText, template, specs);
      out.warnings.forEach((w) => toast.warning(w));
      const blob = new Blob([out.dxf], { type: "application/dxf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (workName ?? "trabalho").replace(/\.dxf$/i, "") + "_RNs.dxf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${specs.length} chamadas inseridas na layer ELEVACAO_19_TEXTO_RNS.`);
    } catch (e) {
      toast.error("Falha ao exportar: " + (e as Error).message);
    }
  }

  const auto = results.filter((r) => !r.manual);
  const manual = results.filter((r) => r.manual);

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <Toaster position="top-right" />
      <header className="mb-8">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-accent">
          Topografia · UTM · DXF
        </p>
        <h1 className="mt-2 text-3xl font-bold">Automação de chamadas de RN</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Cruza a planilha de Referências de Nível com a planta georreferenciada, classifica cada RN
          como POSTE, MURO ou DIVISA e desenha as chamadas clonando o molde do DXF modelo — sem
          reconstruir nenhuma tabela do zero.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <FileField
          label="1 · DXF modelo"
          hint="Referência de estrutura (layers, estilo Roman e uma chamada pronta). Fica salvo no app."
          accept=".dxf"
          onFile={onModel}
          state={
            templateError
              ? `Erro: ${templateError}`
              : template
                ? `${modelName ?? "modelo"} · molde "${template.labelValue}" · altura ${template.textHeight}`
                : undefined
          }
        />
        <FileField
          label="2 · DXF de trabalho"
          hint="Planta com os pontos de RN, blocos de poste e polilinhas de muro/divisa."
          accept=".dxf"
          onFile={onWork}
          state={
            workDxf
              ? `${workName} · ${workDxf.entities.length} entidades · ${workDxf.points.length} pontos/blocos`
              : undefined
          }
        />
        <FileField
          label="3 · Planilha de RNs"
          hint="CSV ou XLSX com Nome, X, Y, Z e (opcional) GrupoChamada."
          accept=".csv,.xlsx,.xls"
          onFile={onSheet}
          state={rows.length ? `${sheetName} · ${rows.length} RNs` : undefined}
        />
      </section>

      <section className="mt-6 rounded-md border border-border bg-card/70 p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider">Parâmetros</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="raio">Raio de busca (m)</Label>
            <Input
              id="raio"
              type="number"
              step="0.5"
              min="0.1"
              value={radius}
              onChange={(e) => setRadius(parseFloat(e.target.value) || 0)}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="poste">Layers de poste</Label>
            <Input
              id="poste"
              value={posteLayers}
              onChange={(e) => setPosteLayers(e.target.value)}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="muro">Layers de muro / divisa</Label>
            <Input
              id="muro"
              value={muroLayers}
              onChange={(e) => setMuroLayers(e.target.value)}
              className="mt-2"
            />
          </div>
        </div>
        {workDxf && (
          <p className="mt-3 text-xs text-muted-foreground">
            Layers no DXF de trabalho: {workDxf.layers.slice(0, 25).join(", ")}
            {workDxf.layers.length > 25 ? "…" : ""}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={process}>Processar</Button>
          <Button variant="secondary" onClick={exportFile} disabled={!processed}>
            Exportar DXF
          </Button>
          <span className="self-center font-display text-xs text-muted-foreground">
            Saída na layer ELEVACAO_19_TEXTO_RNS
          </span>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-border bg-card/70 p-5">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider">Preview</h2>
        <div className="mt-4">
          <PreviewCanvas dxf={workDxf} results={results} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="text-poste">● POSTE</span>
          <span className="text-muro">● MURO</span>
          <span className="text-divisa">● DIVISA</span>
          <span className="text-revisao">● Revisão manual</span>
        </div>
      </section>

      {processed && (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-card/70 p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider">
              Classificadas ({auto.length})
            </h2>
            <Separator className="my-4" />
            <ul className="space-y-3">
              {auto.map((r) => (
                <li key={r.key} className="rounded border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-display text-sm">
                      {r.label}-{r.classification}
                    </span>
                    <Badge variant="outline" className={CLASS_STYLES[r.classification]}>
                      {r.elevation}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                </li>
              ))}
              {auto.length === 0 && (
                <li className="text-xs text-muted-foreground">Nada classificado ainda.</li>
              )}
            </ul>
          </div>

          <div className="rounded-md border border-revisao/40 bg-card/70 p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-revisao">
              Revisão manual ({manual.length})
            </h2>
            <Separator className="my-4" />
            <ul className="space-y-3">
              {manual.map((r) => (
                <li key={r.key} className="rounded border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-display text-sm">{r.label}</span>
                    {r.anchor ? (
                      <Select
                        value={r.classification}
                        onValueChange={(v) => setClassification(r.key, v as Classification)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="REVISAO">Definir…</SelectItem>
                          <SelectItem value="POSTE">POSTE</SelectItem>
                          <SelectItem value="MURO">MURO</SelectItem>
                          <SelectItem value="DIVISA">DIVISA</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={CLASS_STYLES.REVISAO}>
                        sem ponto
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                </li>
              ))}
              {manual.length === 0 && (
                <li className="text-xs text-muted-foreground">Nenhuma pendência. 🎉</li>
              )}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}