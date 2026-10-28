import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  duplicateTemplate,
  TemplateCatalogCache,
  renderComponentText,
  publicMediaUrl,
} from "../shared/templateLibrary.mjs";
import { compileTemplateDraft } from "../shared/templateCreation.mjs";
import catalogService from "../server/templateCatalogService.cjs";
import creationService from "../server/templateCreationService.cjs";

const base = {
  name: "oferta",
  category: "MARKETING",
  language: "pt_BR",
  status: "APPROVED",
  id: "read-only-id",
};
const image = {
  type: "HEADER",
  format: "IMAGE",
  example: { header_handle: ["https://example.com/banner.png?signature=abc"] },
};
const body = {
  type: "BODY",
  text: "Olá, {{1}}! Conheça *nossa oferta*.",
  example: { body_text: [["Ana"]] },
};
const buttons = {
  type: "BUTTONS",
  buttons: [
    {
      type: "URL",
      text: "Acessar",
      url: "https://example.com/plano/{{1}}",
      example: ["https://example.com/plano/20?origem=bot"],
    },
  ],
};
test("duplicate preserves image URL, exact body formatting, dynamic URL suffix and examples without mutating source", () => {
  const original = { ...base, components: [image, body, buttons] };
  const snapshot = structuredClone(original);
  const draft = duplicateTemplate(original);
  assert.equal(draft.name, "oferta_copy");
  assert.equal(draft.mediaUrl, image.example.header_handle[0]);
  assert.equal(draft.mediaHandle, "");
  assert.equal(draft.body, body.text);
  assert.deepEqual(draft.examples, { "body:1": "Ana" });
  assert.equal(draft.buttons[0].example, "20?origem=bot");
  draft.body = "Editado";
  draft.buttons[0].url = "https://example.org/";
  assert.deepEqual(original, snapshot);
});
test("named examples and parameter format survive a duplicate and compile roundtrip", () => {
  const b = {
    type: "BODY",
    text: "Olá, {{nome_cliente}}! Pedido confirmado.",
    example: { body_text_named_params: [{ param_name: "nome_cliente", example: "João" }] },
  };
  const draft = duplicateTemplate({ ...base, components: [b], parameter_format: "NAMED" });
  const compiled = compileTemplateDraft(draft);
  assert.deepEqual(compiled.errors, []);
  assert.deepEqual(compiled.template.components, [b]);
  assert.equal(compiled.template.parameter_format, "NAMED");
  assert.equal(renderComponentText(b, true), "Olá, João! Pedido confirmado.");
  assert.equal(renderComponentText(b, false), b.text);
});
test("returned authentication URL becomes canonical OTP without inventing expiration, TTL or accepting terms", () => {
  const draft = duplicateTemplate({
    ...base,
    category: "AUTHENTICATION",
    components: [
      { ...body, add_security_recommendation: false },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Copiar código",
            url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}",
          },
        ],
      },
    ],
  });
  assert.equal(draft.authentication.mode, "COPY_CODE");
  assert.equal(draft.authentication.codeExpirationMinutes, "");
  assert.equal(draft.authentication.ttlSeconds, "");
  assert.equal(draft.authentication.addSecurityRecommendation, false);
  assert.equal(draft.authentication.zeroTapTermsAccepted, false);
  const { template, errors } = compileTemplateDraft(draft);
  assert.deepEqual(errors, []);
  assert.equal(template.components[1].buttons[0].type, "OTP");
  assert.equal(template.message_send_ttl_seconds, undefined);
  assert.equal(
    template.components.find((c) => c.type === "FOOTER"),
    undefined,
  );
});
test("carousel and unfamiliar button fields remain editable and survive roundtrip exactly", () => {
  const parts = [
    body,
    {
      type: "CAROUSEL",
      cards: [
        { components: [image, { type: "BODY", text: "\u00ad \u00ad" }, buttons] },
        { components: [image, body, buttons] },
      ],
    },
  ];
  const draft = duplicateTemplate({ ...base, components: parts });
  assert.equal(draft.advancedComponents, true);
  const result = compileTemplateDraft(draft);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.template.components, parts);
  draft.componentsJson = "";
  assert.ok(compileTemplateDraft(draft).errors.some((e) => e.field === "componentsJson"));
  draft.componentsJson = "[null]";
  assert.deepEqual(compileTemplateDraft(draft).template.components, []);
  const unusual = duplicateTemplate({
    ...base,
    components: [
      body,
      {
        type: "BUTTONS",
        buttons: [
          { type: "FLOW", text: "Abrir formulário", flow_id: "123", navigate_screen: "FIRST" },
        ],
      },
    ],
  });
  assert.equal(unusual.advancedComponents, true);
  assert.equal(JSON.parse(unusual.componentsJson)[1].buttons[0].flow_id, "123");
});
test("media URL uses an explicit source field; unsafe protocols and conflicting handles fail validation", () => {
  const draft = duplicateTemplate({ ...base, components: [image, body] });
  assert.deepEqual(compileTemplateDraft(draft).errors, []);
  assert.equal(publicMediaUrl("javascript:alert(1)"), "");
  draft.mediaUrl = "javascript:alert(1)";
  assert.ok(compileTemplateDraft(draft).errors.some((e) => e.field === "mediaUrl"));
  draft.mediaUrl = "https://example.com/image.png";
  draft.mediaHandle = "4::test";
  assert.ok(compileTemplateDraft(draft).errors.some((e) => e.field === "mediaHandle"));
});
test("catalog caches all names across languages and filters, isolates routers and retains newly created names through a stale reload", async () => {
  const cache = new TemplateCatalogCache();
  let reads = 0;
  const fetchCatalog = async () => {
    reads++;
    return {
      complete: true,
      templates: [
        { ...base, components: [body] },
        { ...base, name: "outro", language: "en_US", components: [body] },
      ],
    };
  };
  await Promise.all([cache.load("router-a", fetchCatalog), cache.load("router-a", fetchCatalog)]);
  assert.equal(reads, 1);
  assert.deepEqual([...cache.entry("router-a").names], ["oferta", "outro"]);
  assert.equal(cache.entry("router-b").names.size, 0);
  cache.register("router-a", { ...base, name: "novo", components: [body] });
  await cache.load("router-a", fetchCatalog, true);
  assert.ok(cache.entry("router-a").names.has("novo"));
  await assert.rejects(
    cache.load("router-b", async () => ({ templates: [], complete: false })),
    /incompleto/,
  );
  assert.equal(cache.entry("router-b").loaded, false);
});
test("late catalog response stays in its router and failed refresh cannot erase cached names", async () => {
  const cache = new TemplateCatalogCache();
  let resolve;
  const old = cache.load(
    "old",
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await cache.load("new", async () => ({
    complete: true,
    templates: [{ ...base, name: "new", components: [body] }],
  }));
  resolve({ complete: true, templates: [{ ...base, name: "old", components: [body] }] });
  await old;
  assert.deepEqual([...cache.entry("new").names], ["new"]);
  await assert.rejects(
    cache.load(
      "new",
      async () => {
        throw Error("offline");
      },
      true,
    ),
  );
  assert.ok(cache.entry("new").names.has("new"));
  assert.equal(cache.entry("new").error, "offline");
});
const response = (envelope, resource) =>
  new Response(JSON.stringify({ id: envelope.id, status: "success", resource }), { status: 200 });
test("catalog traverses next cursors on the fixed Blip host, deduplicates translations and does not follow a supplied next host", async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const envelope = JSON.parse(options.body);
    calls.push({ url, options, envelope });
    return response(
      envelope,
      calls.length === 1
        ? {
            data: [{ ...base, components: [body] }],
            paging: {
              next: "https://untrusted.example/steal?after=a%2Bb",
              cursors: { after: "a+b" },
            },
          }
        : {
            data: [
              { ...base, components: [body] },
              { ...base, language: "en_US", components: [body] },
            ],
            paging: { cursors: { after: "last" } },
          },
    );
  };
  try {
    const result = await catalogService.templateCatalog({ sourceRouterKey: "Key synthetic" });
    assert.equal(result.complete, true);
    assert.equal(result.total, 2);
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every((c) => c.url === "https://msging.net/commands" && c.envelope.method === "get"),
    );
    assert.equal(calls[1].envelope.uri, "/message-templates?after=a%2Bb");
  } finally {
    global.fetch = previous;
  }
});
test("repeated pagination cursor fails instead of claiming a complete catalog", async () => {
  const previous = global.fetch;
  global.fetch = async (_url, options) =>
    response(JSON.parse(options.body), {
      data: [{ ...base, components: [body] }],
      paging: { next: "https://example.com", cursors: { after: "repeat" } },
    });
  try {
    await assert.rejects(
      catalogService.templateCatalog({ sourceRouterKey: "Key synthetic" }),
      /paginação/,
    );
  } finally {
    global.fetch = previous;
  }
});
test("creation uploads carousel media once, substitutes real handles recursively and reuses idempotent result", async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push(command);
    return response(
      command,
      command.method === "get"
        ? { data: [] }
        : command.uri === "/message-templates-attachment"
          ? { fileHandle: "4::uploaded-handle" }
          : { id: "created", status: "PENDING" },
    );
  };
  try {
    const parts = [
      body,
      {
        type: "CAROUSEL",
        cards: [{ components: [image, body, buttons] }, { components: [image, body, buttons] }],
      },
    ];
    const draft = duplicateTemplate({ ...base, components: parts });
    const params = { sourceRouterKey: "Key media-synthetic", draft, requestId: randomUUID() };
    await creationService.createTemplate(params);
    await creationService.createTemplate(params);
    assert.equal(calls.filter((c) => c.uri === "/message-templates-attachment").length, 1);
    const created = calls.find((c) => c.uri === "/message-templates" && c.method === "set");
    assert.equal(
      created.resource.components[1].cards[0].components[0].example.header_handle[0],
      "4::uploaded-handle",
    );
    assert.equal(
      created.resource.components[1].cards[1].components[0].example.header_handle[0],
      "4::uploaded-handle",
    );
    assert.equal(created.resource.id, undefined);
    assert.equal(image.example.header_handle[0], "https://example.com/banner.png?signature=abc");
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = previous;
  }
});
test("server rejects an existing name in another language before upload or creation", async () => {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    return response(JSON.parse(options.body), {
      data: [{ ...base, name: "oferta_copy", language: "en_US", components: [body] }],
    });
  };
  try {
    await assert.rejects(
      creationService.createTemplate({
        sourceRouterKey: "Key duplicate-synthetic",
        draft: duplicateTemplate({ ...base, components: [image, body] }),
        requestId: randomUUID(),
      }),
      /Já existe/,
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = previous;
  }
});

test("malformed carousel edits fail compilation without leaving invalid preview data", () => {
  const draft = duplicateTemplate({
    ...base,
    components: [body, { type: "CAROUSEL", cards: [{ components: [image, body, buttons] }] }],
  });
  for (const components of [
    [body, { type: "CAROUSEL", cards: "invalid" }],
    [body, { type: "BUTTONS", buttons: {} }],
    [{ type: "BODY", text: { unexpected: true } }],
  ]) {
    draft.componentsJson = JSON.stringify(components);
    const result = compileTemplateDraft(draft);
    assert.ok(result.errors.some((e) => e.field === "componentsJson"));
    assert.deepEqual(result.template.components, []);
  }
});
