export interface PreviewButton {
  type: string;
  text?: string;
  url?: string;
  phone_number?: string;
  otp_type?: string;
}
export interface PreviewComponent {
  type: string;
  format?: string;
  text?: string;
  example?: { header_handle?: string[] };
  buttons?: PreviewButton[];
  cards?: { components: PreviewComponent[] }[];
  code_expiration_minutes?: number;
}
import type { TemplateDraft } from "./templateCreation.mjs";
export type CatalogTemplate = {
  name: string;
  language: string;
  category: string;
  status?: string;
  components: unknown;
  parameter_format?: string;
  message_send_ttl_seconds?: number;
  id?: string;
};
export function templateIdentity(template: Pick<CatalogTemplate, "name" | "language">): string;
export function normalizeTemplateName(name: string): string;
export function templateComponents(value: unknown): PreviewComponent[];
export function publicMediaUrl(value: unknown): string;
export function componentSamples(component: any, field: string): Record<string, string>;
export function renderComponentText(component: any, useExamples: boolean): string;
export function duplicateTemplate(template: CatalogTemplate): TemplateDraft;
export interface CatalogEntry {
  templates: CatalogTemplate[];
  names: Set<string>;
  created: Map<string, CatalogTemplate>;
  loaded: boolean;
  pending: Promise<CatalogTemplate[]> | null;
  error: string;
}
export class TemplateCatalogCache {
  entries: Map<string, CatalogEntry>;
  entry(scope: string): CatalogEntry;
  load(
    scope: string,
    fetchCatalog: () => Promise<{ templates: CatalogTemplate[]; complete: boolean }>,
    refresh?: boolean,
  ): Promise<CatalogTemplate[]>;
  register(scope: string, template: CatalogTemplate): void;
}
