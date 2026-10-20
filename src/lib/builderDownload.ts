import { strToU8, zip } from "fflate";
import {
  builderExportFilename,
  validateBuilderExportDocument,
  type BuilderDocument,
  type BuilderPublication,
} from "../../shared/builderExport.mjs";

export type BuilderExport = {
  builderShortName: string;
  version: "working" | "published";
  publication?: BuilderPublication;
  document: BuilderDocument;
};

export function builderExportFile(exported: BuilderExport) {
  validateBuilderExportDocument(exported.document);
  return {
    name: builderExportFilename(exported),
    text: JSON.stringify(exported.document),
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
