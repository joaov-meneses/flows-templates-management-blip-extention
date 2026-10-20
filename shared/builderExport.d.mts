export type BuilderDocument = {
  flow: Record<string, unknown>;
  globalActions: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  subflows?: Array<{
    shortName: string;
    flow: Record<string, unknown>;
    configuration: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};
export type BuilderPublication = { index: number; publishedAt: string; title?: string };
export function isRecord(value: unknown): value is Record<string, unknown>;
export function subflowNames(flow: Record<string, unknown>): string[];
export function validateBuilderExportDocument(
  document: unknown,
): asserts document is BuilderDocument;
export function builderExportFilename(exported: {
  builderShortName: string;
  version: "working" | "published";
  publication?: BuilderPublication;
}): string;
