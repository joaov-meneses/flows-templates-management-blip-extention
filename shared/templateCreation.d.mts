import type { AuthenticationDraft } from "./authenticationTemplates.mjs";
export interface TemplateButtonDraft {
  id: string;
  type: "URL" | "PHONE_NUMBER" | "QUICK_REPLY" | "COPY_CODE";
  text: string;
  url: string;
  phoneNumber: string;
  example: string;
}
export interface TemplateDraft {
  name: string;
  language: string;
  category: string;
  parameterFormat: string;
  headerFormat: string;
  headerText: string;
  mediaHandle: string;
  mediaUrl: string;
  componentsJson: string;
  advancedComponents: boolean;
  messageSendTtl: string;
  body: string;
  footer: string;
  examples: Record<string, string>;
  buttons: TemplateButtonDraft[];
  authentication: AuthenticationDraft;
}
export interface CompiledTemplate {
  name: string;
  language: string;
  category: string;
  parameter_format?: string;
  message_send_ttl_seconds?: number;
  components: any[];
}
export const TEMPLATE_LANGUAGES: readonly (readonly string[])[];
export function countCharacters(value: string): number;
export function variableNames(text: string): string[];
export function newTemplateDraft(): TemplateDraft;
export function compileTemplateDraft(draft: unknown): {
  errors: { field: string; message: string }[];
  warnings: string[];
  template: CompiledTemplate;
};
