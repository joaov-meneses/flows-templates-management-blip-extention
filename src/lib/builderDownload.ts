import { strToU8, zip } from "fflate";

export type BuilderExport = {
  builderShortName: string;
  version: "working" | "published";
  document: {
    flow: Record<string, unknown>;
    configuration: Record<string, unknown>;
    globalActions: Record<string, unknown>;
  };
};

export function builderExportFile(exported: BuilderExport) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(exported.builderShortName))
    throw new Error("O Builder retornou um ID inválido para download.");
  return {
    name: `${exported.builderShortName}.json`,
    text: JSON.stringify(exported.document, null, 2),
  };
}

export function createBuilderZip(exports: BuilderExport[]): Promise<Uint8Array> {
  if (!exports.length) return Promise.reject(new Error("Nenhum fluxo disponível para baixar."));
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const exported of exports) {
    const file = builderExportFile(exported);
    if (files[file.name]) throw new Error("O lote contém Builders duplicados.");
    files[file.name] = strToU8(file.text);
  }
  return new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
