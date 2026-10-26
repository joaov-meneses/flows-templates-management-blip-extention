import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  compileTemplateDraft,
  newTemplateDraft,
  countCharacters,
} from "../shared/templateCreation.mjs";
import service from "../server/templateCreationService.cjs";

function draft(overrides = {}) {
  return {
    ...newTemplateDraft(),
    name: "confirmacao_pedido",
    body: "Olá, {{1}}! Seu pedido {{2}} foi confirmado. Obrigado.",
    examples: { "body:1": "Ana", "body:2": "12345" },
    ...overrides,
  };
}
function button(type, overrides = {}) {
  return {
    id: randomUUID(),
    type,
    text: "Consultar",
    url: "https://example.com/pedido/{{1}}",
    phoneNumber: "5511999990000",
    example: "12345",
    ...overrides,
  };
}
const errors = (value) =>
  compileTemplateDraft(value)
    .errors.map((error) => error.message)
    .join(" ");

test("positional examples are ordered and nested as required by Meta", () => {
  const result = compileTemplateDraft(
    draft({
      headerFormat: "TEXT",
      headerText: "Pedido {{1}} confirmado",
      examples: { "body:1": "Ana", "body:2": "12345", "headerText:1": "12345" },
    }),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.template.parameter_format, "POSITIONAL");
  assert.deepEqual(result.template.components[0].example, { header_text: ["12345"] });
  assert.deepEqual(result.template.components[1].example, { body_text: [["Ana", "12345"]] });
});
test("named variables preserve names and examples including header underscores", () => {
  const result = compileTemplateDraft(
    draft({
      parameterFormat: "NAMED",
      headerFormat: "TEXT",
      headerText: "Pedido {{numero_pedido}} confirmado",
      body: "Olá, {{nome_cliente}}! Seu pedido foi confirmado.",
      examples: { "body:nome_cliente": "Ana", "headerText:numero_pedido": "12345" },
    }),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.template.components[0].example, {
    header_text_named_params: [{ param_name: "numero_pedido", example: "12345" }],
  });
  assert.deepEqual(result.template.components[1].example, {
    body_text_named_params: [{ param_name: "nome_cliente", example: "Ana" }],
  });
});
for (const [label, overrides, match] of [
  ["missing example", { examples: {} }, /exemplo/],
  ["unmatched braces", { body: "Olá, {1}}! Seu pedido foi confirmado." }, /incompleta/],
  ["sequence gaps", { body: "Olá, {{1}}! Pedido {{3}} confirmado." }, /sem saltos/],
  ["sequence order", { body: "Pedido {{2}} de {{1}} confirmado." }, /em ordem/],
  ["mixed variables", { body: "Olá, {{nome}}! Pedido {{2}} confirmado." }, /Numere/],
  [
    "named digits",
    { parameterFormat: "NAMED", body: "Olá, {{nome1}}! Pedido confirmado." },
    /minúsculas/,
  ],
  ["dangling start", { body: "{{1}}, seu pedido foi confirmado." }, /começar/],
  ["dangling end", { body: "Olá, seu pedido é {{1}}" }, /terminar/],
  ["adjacent", { body: "Olá, {{1}} {{2}}! Pedido confirmado." }, /Separe/],
  [
    "header multiple variables",
    { headerFormat: "TEXT", headerText: "Pedido {{1}} de {{2}} confirmado" },
    /no máximo 1/,
  ],
  ["header markdown", { headerFormat: "TEXT", headerText: "*Pedido confirmado*" }, /Markdown/],
  ["footer variables", { footer: "Pedido {{1}}" }, /rodapé/],
  ["invalid category", { category: "AUTHENTICATION" }, /Marketing/],
  ["invalid locale", { language: "pt-BR" }, /idioma/],
  ["invalid name", { name: "Confirmação pedido" }, /minúsculas/],
  ["name too long", { name: "a".repeat(513) }, /512/],
])
  test(`rejects ${label}`, () => assert.match(errors(draft(overrides)), match));

test("exact component limits allow boundary values and reject overflow", () => {
  const exact = draft({
    name: "a".repeat(512),
    body: "x".repeat(1024),
    headerFormat: "TEXT",
    headerText: "x".repeat(60),
    footer: "x".repeat(60),
  });
  assert.deepEqual(compileTemplateDraft(exact).errors, []);
  assert.match(errors({ ...exact, body: "x".repeat(1025) }), /1.024/);
  assert.match(errors({ ...exact, headerText: "x".repeat(61) }), /60/);
  assert.match(errors({ ...exact, footer: "x".repeat(61) }), /60/);
  assert.match(
    errors(draft({ examples: { "body:1": "x".repeat(1024), "body:2": "123" } })),
    /com os exemplos/,
  );
  assert.equal(countCharacters("✅😀"), 2);
});
test("ten buttons are accepted, grouped correctly and constrained by subtype", () => {
  const value = draft({
    buttons: [
      button("QUICK_REPLY", { text: "Confirmar" }),
      button("URL"),
      ...Array.from({ length: 8 }, (_, i) => button("QUICK_REPLY", { text: `Opção ${i}` })),
    ],
  });
  const result = compileTemplateDraft(value);
  assert.deepEqual(result.errors, []);
  const buttons = result.template.components.at(-1).buttons;
  assert.equal(buttons.length, 10);
  assert.equal(buttons[0].type, "URL");
  assert.deepEqual(buttons[0].example, ["12345"]);
  assert.match(
    errors({ ...value, buttons: [...value.buttons, button("QUICK_REPLY")] }),
    /10 botões/,
  );
  for (const [type, count] of [
    ["URL", 3],
    ["PHONE_NUMBER", 2],
    ["COPY_CODE", 2],
  ])
    assert.match(
      errors(
        draft({
          buttons: Array.from({ length: count }, (_, i) => button(type, { text: `Botão ${i}` })),
        }),
      ),
      /Limite/,
    );
});
test("URL validation accepts one suffix variable and rejects misplaced or unsafe destinations", () => {
  assert.match(
    errors(draft({ buttons: [button("URL", { url: "https://example.com/{{1}}/extra" })] })),
    /somente no final/,
  );
  assert.match(
    errors(draft({ buttons: [button("URL", { url: "javascript:alert(1)" })] })),
    /URL pública/,
  );
  assert.match(
    errors(draft({ buttons: [button("URL", { url: "https://user:secret@example.com/" })] })),
    /URL pública/,
  );
  assert.match(errors(draft({ buttons: [button("URL", { example: "" })] })), /sufixo/);
  assert.match(errors(draft({ buttons: [button("URL", { text: "a".repeat(26) })] })), /25/);
  assert.match(
    errors(draft({ buttons: [button("COPY_CODE", { example: "a".repeat(21) })] })),
    /20/,
  );
});
test("media handles are passed unchanged, never replaced with public URLs", () => {
  for (const headerFormat of ["IMAGE", "VIDEO", "DOCUMENT"]) {
    const result = compileTemplateDraft(
      draft({ headerFormat, mediaHandle: "4::fake-meta-handle" }),
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.template.components[0], {
      type: "HEADER",
      format: headerFormat,
      example: { header_handle: ["4::fake-meta-handle"] },
    });
    assert.match(
      errors(draft({ headerFormat, mediaHandle: "https://example.com/media.jpg" })),
      /não é um handle/,
    );
  }
  assert.deepEqual(
    compileTemplateDraft(draft({ headerFormat: "LOCATION" })).template.components[0],
    { type: "HEADER", format: "LOCATION" },
  );
});
test("malformed requests fail before remote reads or writes", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected");
  });
  for (const invalid of [null, {}, { buttons: [null] }, draft({ name: "INVALID" })])
    await assert.rejects(
      service.createTemplate({
        draft: invalid,
        sourceRouterKey: "Key fake",
        requestId: randomUUID(),
      }),
    );
  assert.equal(calls, 0);
});
test("creation checks duplicates, posts the validated resource, preserves Meta status and deduplicates retries", async (t) => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const envelope = JSON.parse(options.body);
    sent.push(envelope);
    assert.equal(url, "https://msging.net/commands");
    assert.equal(options.headers.Authorization, "Key synthetic-creation");
    return Response.json({
      id: envelope.id,
      status: "success",
      resource:
        envelope.method === "get"
          ? { data: [] }
          : { id: "meta-fixture-id", status: "PENDING", category: "MARKETING" },
    });
  });
  const params = {
    draft: draft(),
    sourceRouterKey: "Key synthetic-creation",
    requestId: randomUUID(),
  };
  const [result, repeated] = await Promise.all([
    service.createTemplate(params),
    service.createTemplate(params),
  ]);
  assert.deepEqual(result, repeated);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].method, "get");
  assert.equal(sent[1].method, "set");
  assert.equal(sent[1].to, "postmaster@wa.gw.msging.net");
  assert.equal(sent[1].uri, "/message-templates");
  assert.equal(sent[1].type, "application/json");
  assert.deepEqual(sent[1].resource, compileTemplateDraft(params.draft).template);
  assert.equal(result.template.status, "PENDING");
  assert.equal(result.template.category, "MARKETING");
  assert.ok(!JSON.stringify(result).includes("synthetic-creation"));
  await assert.rejects(
    service.createTemplate({ ...params, draft: draft({ body: "Outro texto fixo." }) }),
    /outro conteúdo/,
  );
});
test("existing name in the same language prevents creation", async (t) => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const envelope = JSON.parse(options.body);
    methods.push(envelope.method);
    return Response.json({
      id: envelope.id,
      status: "success",
      resource: { data: [{ name: "confirmacao_pedido", language: "pt_BR" }] },
    });
  });
  await assert.rejects(
    service.createTemplate({
      draft: draft(),
      sourceRouterKey: "Key duplicate",
      requestId: randomUUID(),
    }),
    /Já existe/,
  );
  assert.deepEqual(methods, ["get"]);
});
test("unconfirmed writes are not silently retried with the same request id", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const envelope = JSON.parse(options.body);
    calls++;
    if (envelope.method === "set") throw new Error("timeout");
    return Response.json({ id: envelope.id, status: "success", resource: { data: [] } });
  });
  const params = { draft: draft(), sourceRouterKey: "Key uncertain", requestId: randomUUID() };
  await assert.rejects(service.createTemplate(params), /sem confirmação/);
  await assert.rejects(service.createTemplate(params), /sem confirmação/);
  assert.equal(calls, 2);
});
test("mismatched command response cannot be reported as a successful creation", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const envelope = JSON.parse(options.body);
    return Response.json({
      id: envelope.method === "get" ? envelope.id : "different-id",
      status: "success",
      resource: { data: [] },
    });
  });
  await assert.rejects(
    service.createTemplate({
      draft: draft(),
      sourceRouterKey: "Key correlation",
      requestId: randomUUID(),
    }),
    /não confirmou/,
  );
});
