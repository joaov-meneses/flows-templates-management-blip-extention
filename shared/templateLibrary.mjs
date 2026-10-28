import { newTemplateDraft, variableNames } from "./templateCreation.mjs";

export const templateIdentity = (template) => `${template.name}|${template.language}`;
export const normalizeTemplateName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase();
export function templateComponents(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((c) => c && typeof c === "object" && typeof c.type === "string")
    : [];
}
export function publicMediaUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function componentSamples(component, field) {
  const prefix = field === "body" ? "body_text" : "header_text";
  const named = component?.example?.[`${prefix}_named_params`];
  if (Array.isArray(named))
    return Object.fromEntries(
      named
        .filter((p) => p && typeof p.param_name === "string" && typeof p.example === "string")
        .map((p) => [p.param_name, p.example]),
    );
  const values = component?.example?.[prefix];
  const row = field === "body" ? values?.[0] : values;
  return Object.fromEntries(
    variableNames(component?.text).map((name, index) => [name, row?.[index] || ""]),
  );
}
export function renderComponentText(component, useExamples) {
  const text = typeof component?.text === "string" ? component.text : "";
  if (!useExamples) return text;
  const samples = componentSamples(component, component.type === "HEADER" ? "headerText" : "body");
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, name) => samples[name] || match);
}
export function duplicateTemplate(template) {
  const draft = newTemplateDraft();
  draft.name = `${template.name}_copy`;
  draft.category = template.category;
  draft.language = template.language;
  const components = structuredClone(templateComponents(template.components));
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttons = components.find((c) => c.type === "BUTTONS")?.buttons || [];
  draft.parameterFormat =
    template.parameter_format ||
    (components.some(
      (c) => c.example?.body_text_named_params || c.example?.header_text_named_params,
    )
      ? "NAMED"
      : "POSITIONAL");
  draft.messageSendTtl =
    template.message_send_ttl_seconds == null ? "" : String(template.message_send_ttl_seconds);
  if (template.category === "AUTHENTICATION") {
    const button = buttons[0] || {};
    let mode = button.otp_type;
    if (!mode && button.url) {
      try {
        const url = new URL(button.url);
        if (url.hostname === "www.whatsapp.com" && url.pathname === "/otp/code/")
          mode = url.searchParams.get("otp_type");
      } catch {
        /* Keep a canonical copy-code draft when no OTP URL is available. */
      }
    }
    draft.authentication = {
      ...draft.authentication,
      mode: mode || "COPY_CODE",
      addSecurityRecommendation: Boolean(body?.add_security_recommendation),
      codeExpirationMinutes:
        footer?.code_expiration_minutes == null ? "" : String(footer.code_expiration_minutes),
      ttlSeconds:
        template.message_send_ttl_seconds == null ? "" : String(template.message_send_ttl_seconds),
      copyText: button.text || "",
      autofillText: button.autofill_text || "",
      supportedApps: (button.supported_apps?.length ? button.supported_apps : [{}]).map(
        (app, i) => ({
          id: `copied-app-${i}`,
          packageName: app.package_name || "",
          signatureHash: app.signature_hash || "",
        }),
      ),
      zeroTapTermsAccepted: false,
    };
    return draft;
  }
  draft.headerFormat = header?.format || "NONE";
  draft.headerText = header?.text || "";
  const media = header?.example?.header_handle?.[0] || "";
  draft.mediaUrl = publicMediaUrl(media) ? media : "";
  draft.mediaHandle = draft.mediaUrl ? "" : media;
  draft.body = body?.text || "";
  draft.footer = footer?.text || "";
  for (const [field, component] of [
    ["body", body],
    ["headerText", header],
  ]) {
    for (const [name, sample] of Object.entries(componentSamples(component, field)))
      draft.examples[`${field}:${name}`] = sample;
  }
  draft.buttons = buttons.map((button, index) => {
    let sample = Array.isArray(button.example) ? button.example[0] || "" : button.example || "";
    const prefix = String(button.url || "").replace(/\{\{[^{}]+\}\}$/, "");
    if (variableNames(button.url).length && sample.startsWith(prefix))
      sample = sample.slice(prefix.length);
    return {
      id: `copied-button-${index}`,
      type: button.type,
      text: button.text || "",
      url: button.url || "",
      phoneNumber: button.phone_number || "",
      example: sample,
    };
  });
  // Complex formats stay fully editable without dropping cards, new button types or component fields.
  const knownFields = {
    HEADER: ["type", "format", "text", "example"],
    BODY: ["type", "text", "example"],
    FOOTER: ["type", "text"],
    BUTTONS: ["type", "buttons"],
  };
  const buttonFields = ["type", "text", "url", "phone_number", "example"];
  if (
    components.some(
      (c) => !knownFields[c.type] || Object.keys(c).some((k) => !knownFields[c.type].includes(k)),
    ) ||
    buttons.some(
      (b) =>
        !["URL", "PHONE_NUMBER", "COPY_CODE", "QUICK_REPLY"].includes(b.type) ||
        Object.keys(b).some((k) => !buttonFields.includes(k)),
    )
  ) {
    draft.advancedComponents = true;
    draft.componentsJson = JSON.stringify(components, null, 2);
  }
  return draft;
}

/** One in-memory catalog per router, independent of list filters and selected language. */
export class TemplateCatalogCache {
  entries = new Map();
  entry(scope) {
    if (!this.entries.has(scope))
      this.entries.set(scope, {
        templates: [],
        names: new Set(),
        created: new Map(),
        loaded: false,
        pending: null,
        error: "",
      });
    return this.entries.get(scope);
  }
  async load(scope, fetchCatalog, refresh = false) {
    const entry = this.entry(scope);
    if (entry.pending) return entry.pending;
    if (entry.loaded && !refresh) return entry.templates;
    entry.error = "";
    entry.pending = (async () => {
      try {
        const data = await fetchCatalog();
        if (!Array.isArray(data.templates) || data.complete !== true)
          throw new Error("O catálogo de nomes está incompleto. Atualize antes de criar.");
        const byKey = new Map(data.templates.map((t) => [templateIdentity(t), t]));
        for (const [key, value] of entry.created) if (!byKey.has(key)) byKey.set(key, value);
        entry.templates = [...byKey.values()];
        entry.names = new Set(entry.templates.map((t) => normalizeTemplateName(t.name)));
        entry.loaded = true;
        return entry.templates;
      } catch (error) {
        entry.error =
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os nomes de templates.";
        throw error;
      } finally {
        entry.pending = null;
      }
    })();
    return entry.pending;
  }
  register(scope, template) {
    const entry = this.entry(scope);
    const key = templateIdentity(template);
    entry.created.set(key, template);
    entry.templates = [...entry.templates.filter((t) => templateIdentity(t) !== key), template];
    entry.names = new Set([...entry.names, normalizeTemplateName(template.name)]);
  }
}
