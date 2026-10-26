import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  newAuthenticationDraft,
  authenticationPreview,
} from "../shared/authenticationTemplates.mjs";
import { newTemplateDraft, compileTemplateDraft } from "../shared/templateCreation.mjs";
import service from "../server/templateCreationService.cjs";

const app = { id: "synthetic-app", packageName: "com.example.auth", signatureHash: "K8a/AINcGX7" };
function draft(authentication = {}, overrides = {}) {
  return {
    ...newTemplateDraft(),
    name: "codigo_verificacao",
    category: "AUTHENTICATION",
    authentication: { ...newAuthenticationDraft(), ...authentication },
    ...overrides,
  };
}
const compile = (auth) => compileTemplateDraft(draft(auth));
const errors = (auth) =>
  compile(auth)
    .errors.map((item) => item.message)
    .join(" ");

test("copy-code authentication creates fixed Meta components without editable text, headers or examples", () => {
  const result = compileTemplateDraft(
    draft(
      {},
      {
        body: "Conteúdo de marketing preservado no rascunho",
        headerFormat: "IMAGE",
        mediaHandle: "4::sample",
        footer: "Rodapé livre",
        buttons: [{ type: "URL", url: "https://example.com" }],
        parameterFormat: "NAMED",
      },
    ),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.template, {
    name: "codigo_verificacao",
    language: "pt_BR",
    category: "AUTHENTICATION",
    message_send_ttl_seconds: 300,
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 5 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
    ],
  });
  assert.ok(!("parameter_format" in result.template));
  assert.ok(!JSON.stringify(result.template).includes("marketing preservado"));
});
test("optional expiration, TTL and button text are omitted when blank", () => {
  const result = compile({
    addSecurityRecommendation: false,
    codeExpirationMinutes: "",
    ttlSeconds: "",
    copyText: "",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.template.components.length, 2);
  assert.equal(result.template.components[0].add_security_recommendation, false);
  assert.ok(!("message_send_ttl_seconds" in result.template));
  assert.ok(!("text" in result.template.components.at(-1).buttons[0]));
});
test("one-tap defines supported apps and fallback labels using the current schema", () => {
  const result = compile({
    mode: "ONE_TAP",
    supportedApps: [app],
    copyText: "Copiar código",
    autofillText: "Preencher código",
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.template.components.at(-1).buttons, [
    {
      type: "OTP",
      otp_type: "ONE_TAP",
      text: "Copiar código",
      autofill_text: "Preencher código",
      supported_apps: [{ package_name: app.packageName, signature_hash: app.signatureHash }],
    },
  ]);
});
test("zero-tap requires a genuine boolean acceptance and sends it only for zero-tap", () => {
  assert.match(errors({ mode: "ZERO_TAP", supportedApps: [app] }), /precisa aceitar/);
  assert.match(
    errors({ mode: "ZERO_TAP", supportedApps: [app], zeroTapTermsAccepted: "true" }),
    /precisa aceitar/,
  );
  const result = compile({ mode: "ZERO_TAP", supportedApps: [app], zeroTapTermsAccepted: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.template.components.at(-1).buttons[0].zero_tap_terms_accepted, true);
  assert.ok(
    !(
      "zero_tap_terms_accepted" in
      compile({ zeroTapTermsAccepted: true }).template.components.at(-1).buttons[0]
    ),
  );
});
for (const [label, overrides, match] of [
  ["invalid mode", { mode: "CUSTOM" }, /modo/],
  ["invalid security flag", { addSecurityRecommendation: "true" }, /segurança/],
  ["expiration zero", { codeExpirationMinutes: "0" }, /1 e 90/],
  ["expiration above maximum", { codeExpirationMinutes: "91" }, /1 e 90/],
  ["fractional expiration", { codeExpirationMinutes: "1.5" }, /inteiro/],
  ["TTL too short", { ttlSeconds: "29" }, /30 a 900/],
  ["TTL too long", { ttlSeconds: "901" }, /30 a 900/],
  ["TTL zero", { ttlSeconds: "0" }, /30 a 900/],
  ["fractional TTL", { ttlSeconds: "30.5" }, /30 a 900/],
  ["long label", { copyText: "x".repeat(26) }, /25/],
  ["emoji label", { copyText: "Copiar 😀" }, /emojis/],
  ["variable label", { copyText: "Copiar {{1}}" }, /variáveis/],
  ["URL label", { copyText: "https://example.com" }, /URLs/],
  ["no apps", { mode: "ONE_TAP", supportedApps: [] }, /1 e 5/],
  ["six apps", { mode: "ONE_TAP", supportedApps: Array(6).fill(app) }, /1 e 5/],
  [
    "single package segment",
    { mode: "ONE_TAP", supportedApps: [{ ...app, packageName: "app" }] },
    /dois segmentos/,
  ],
  [
    "package segment starting in digit",
    { mode: "ONE_TAP", supportedApps: [{ ...app, packageName: "com.1app" }] },
    /iniciado por letra/,
  ],
  [
    "long package",
    { mode: "ONE_TAP", supportedApps: [{ ...app, packageName: `com.${"a".repeat(221)}` }] },
    /224/,
  ],
  [
    "short signature hash",
    { mode: "ONE_TAP", supportedApps: [{ ...app, signatureHash: "12345" }] },
    /11 caracteres/,
  ],
  [
    "invalid signature alphabet",
    { mode: "ONE_TAP", supportedApps: [{ ...app, signatureHash: "K8a_AINcGX7" }] },
    /11 caracteres/,
  ],
  [
    "duplicate package-hash pair",
    { mode: "ONE_TAP", supportedApps: [app, { ...app, id: "second" }] },
    /já foi cadastrado/,
  ],
])
  test(`rejects OTP ${label}`, () => assert.match(errors(overrides), match));

test("OTP boundary values, five app variants and 30-day TTL follow documented API limits", () => {
  for (const codeExpirationMinutes of ["1", "90"])
    assert.deepEqual(compile({ codeExpirationMinutes }).errors, []);
  for (const ttlSeconds of ["30", "900", "-1"])
    assert.deepEqual(compile({ ttlSeconds }).errors, []);
  const supportedApps = Array.from({ length: 5 }, (_, i) => ({
    ...app,
    id: `app-${i}`,
    packageName: `com.example.app${i}`,
  }));
  assert.deepEqual(
    compile({
      mode: "ONE_TAP",
      supportedApps,
      copyText: "x".repeat(25),
      autofillText: "y".repeat(25),
    }).errors,
    [],
  );
  assert.match(compile({ ttlSeconds: "-1" }).warnings.join(" "), /excede/);
  assert.match(
    compile({ codeExpirationMinutes: "1", ttlSeconds: "" }).warnings.join(" "),
    /excede/,
  );
});
test("authentication preview distinguishes Android automatic delivery and fallback buttons", () => {
  const value = { ...newAuthenticationDraft(), mode: "ZERO_TAP" };
  assert.equal(authenticationPreview(value, "pt_BR").button, null);
  assert.equal(authenticationPreview(value, "pt_BR", true, "one").button, "Preencher código");
  assert.equal(authenticationPreview(value, "pt_BR", true, "copy").button, "Copiar código");
  assert.match(authenticationPreview(value, "pt_BR").body, /123456.*segurança/);
  assert.match(authenticationPreview(value, "en_US", false).body, /\{\{1\}\}.*verification/);
  assert.match(authenticationPreview(value, "fr").caption, /ilustrativo em inglês/);
  assert.equal(
    authenticationPreview(
      { ...value, codeExpirationMinutes: "", addSecurityRecommendation: false },
      "pt_BR",
    ).footer,
    "",
  );
});
test("server rejects zero-tap without acceptance before contacting Blip", async (t) => {
  let called = false;
  t.mock.method(globalThis, "fetch", async () => {
    called = true;
    throw new Error();
  });
  await assert.rejects(
    service.createTemplate({
      sourceRouterKey: "Key synthetic-auth",
      requestId: randomUUID(),
      draft: draft({ mode: "ZERO_TAP", supportedApps: [app] }),
    }),
    /precisa aceitar/,
  );
  assert.equal(called, false);
});
test("server posts the authentication payload and TTL without transforming OTP into a URL button", async (t) => {
  let mutation;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command.method === "set") mutation = command;
    return Response.json({
      id: command.id,
      status: "success",
      resource:
        command.method === "get"
          ? { data: [] }
          : { id: "synthetic-otp-id", category: "AUTHENTICATION", status: "PENDING" },
    });
  });
  const value = draft({ mode: "ONE_TAP", supportedApps: [app] });
  const result = await service.createTemplate({
    sourceRouterKey: "Key synthetic-auth-payload",
    requestId: randomUUID(),
    draft: value,
  });
  assert.deepEqual(mutation.resource, compileTemplateDraft(value).template);
  assert.equal(mutation.resource.message_send_ttl_seconds, 300);
  assert.equal(mutation.resource.components.at(-1).buttons[0].type, "OTP");
  assert.equal(result.template.status, "PENDING");
  assert.ok(!JSON.stringify(mutation.resource).includes("123456"));
});
