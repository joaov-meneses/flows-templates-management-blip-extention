export interface AuthenticationApp {
  id: string;
  packageName: string;
  signatureHash: string;
}
export interface AuthenticationDraft {
  mode: "COPY_CODE" | "ONE_TAP" | "ZERO_TAP";
  addSecurityRecommendation: boolean;
  codeExpirationMinutes: string;
  ttlSeconds: string;
  copyText: string;
  autofillText: string;
  supportedApps: AuthenticationApp[];
  zeroTapTermsAccepted: boolean;
}
export function newAuthenticationDraft(): AuthenticationDraft;
export function compileAuthenticationDraft(
  auth: unknown,
  identity: { name: string; language: string },
): {
  errors: { field: string; message: string }[];
  warnings: string[];
  template: {
    name: string;
    language: string;
    category: string;
    components: any[];
    message_send_ttl_seconds?: number;
  };
};
export function authenticationPreview(
  auth: AuthenticationDraft,
  language: string,
  useExamples?: boolean,
  scenario?: string,
): { body: string; footer: string; button: string | null; caption: string };
