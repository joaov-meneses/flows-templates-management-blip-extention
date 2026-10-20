import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import exporter from "../server/builderExportService.cjs";
import { builderExportFile, createBuilderZip } from "../src/lib/builderDownload.ts";

const bot = "export-test";
const key = `Key ${Buffer.from(`${bot}:fake-secret`).toString("base64")}`;
const hub = "postmaster@msging.net";
const builder = "postmaster@builder.msging.net";
const ai = "postmaster@aiplatform.msging.net";
const prefix = "/buckets/blip_portal:builder_";
const flow = {
  onboarding: { id: "onboarding", $title: "Início" },
  "subflow:menu": { id: "subflow:menu", shortNameOfSubflow: "menu1" },
};
const inner = Object.fromEntries(["onboarding", "fallback", "end"].map((id) => [id, { id }]));
const subflow = { shortName: "menu1", flow: inner, configuration: {} };
const globalActions = { $enteringCustomActions: [{ type: "TrackEvent" }] };
const document = {
  flow,
  configuration: { greeting: "Olá" },
  globalActions,
  subflows: [subflow],
  extraNativeField: { preserve: true },
};
const publication = { index: 2, publishedAt: "2026-10-20T15:35:16.080Z", title: "Versão de teste" };
const index = {
  lastInsertedIndex: 2,
  publications: [
    { index: 10, publishedAt: "2026-01-01T00:00:00.000Z" },
    publication,
    { index: 2, publishedAt: "2025-12-01T00:00:00.000Z" },
  ],
};

function fail(code, description = "Recurso ausente") {
  return { failure: { code, description } };
}
function reads(t, overrides = {}, envelope = (data) => data) {
  const calls = [];
  const counts = new Map();
  const routes = {
    [`${builder} /flow`]: flow,
    [`${builder} /flow/global-actions`]: globalActions,
    [`${hub} ${prefix}working_flow`]: flow,
    [`${hub} ${prefix}working_global_actions`]: globalActions,
    [`${hub} ${prefix}latestpublications`]: index,
    [`${hub} ${prefix}latestpublications:2`]: document,
    [`${builder} /subflows/menu1/configurations/edited-flow`]: { document: JSON.stringify(inner) },
    [`${builder} /subflows/menu1/configurations/edited-configurations`]: { document: "{}" },
    ...overrides,
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://msging.net/commands");
    const command = JSON.parse(options.body);
    assert.equal(command.method, "get", "download nunca pode gravar/migrar/publicar");
    const route = `${command.to} ${command.uri}`;
    assert(Object.hasOwn(routes, route), `Leitura inesperada: ${route}`);
    calls.push(command);
    const count = (counts.get(route) ?? 0) + 1;
    counts.set(route, count);
    const value = typeof routes[route] === "function" ? routes[route](count) : routes[route];
    const body = {
      id: command.id,
      to: `${bot}@msging.net/test`,
      ...(value?.failure
        ? { status: "failure", reason: value.failure }
        : { status: "success", resource: structuredClone(value) }),
    };
    return Response.json(envelope(body));
  });
  return calls;
}
const run = (version = "working") =>
  exporter.exportBuilderFlow({ builderShortName: bot, builderKey: key, version });

test("rascunho preserva o formato nativo e inclui implementação/configuração dos internos", async (t) => {
  const calls = reads(t);
  const result = await run();
  assert.deepEqual(result.document, { flow, globalActions, subflows: [subflow] });
  assert(!Object.hasOwn(result.document, "configuration"));
  assert.equal(calls.filter((c) => c.uri.endsWith("/edited-flow")).length, 2);
  assert.equal(calls.filter((c) => c.uri.endsWith("/edited-configurations")).length, 2);
  assert(!JSON.stringify(result).includes("fake-secret"));
});

test("fonte legada usa buckets somente após erro conhecido, sem consultar configuração raiz", async (t) => {
  const calls = reads(t, { [`${builder} /flow`]: fail(61, "Invalid object name 'builder.Flows'") });
  assert.deepEqual((await run()).document, { flow, globalActions, subflows: [subflow] });
  assert(calls.some((c) => c.uri === prefix + "working_flow"));
  assert(!calls.some((c) => c.uri.endsWith("working_configuration")));
});

test("falha de permissão não é interpretada como fonte legada", async (t) => {
  const calls = reads(t, { [`${builder} /flow`]: fail(66, "Sem permissão") });
  await assert.rejects(run(), /Sem permissão/);
  assert.equal(calls.length, 1);
});

test("publicada preserva integralmente o arquivo do histórico e usa data/índice reutilizado", async (t) => {
  const calls = reads(t);
  const result = await run("published");
  assert.deepEqual(result.document, document);
  assert.deepEqual(result.publication, publication);
  assert.equal(calls.length, 3);
  assert(calls.every((c) => c.uri.startsWith(prefix + "latestpublications")));
  assert(!calls.some((c) => c.uri.includes("published_flow")));
});

test("sem publicação ou índice inconsistente não produz pacote de sucesso", async (t) => {
  reads(t, { [`${hub} ${prefix}latestpublications`]: { publications: [] } });
  await assert.rejects(run("published"), /não tem uma publicação/);
  t.mock.restoreAll();
  reads(t, { [`${hub} ${prefix}latestpublications`]: { ...index, lastInsertedIndex: 10 } });
  await assert.rejects(run("published"), /histórico mudou/);
});

test("nova publicação durante o download é detectada", async (t) => {
  reads(t, {
    [`${hub} ${prefix}latestpublications`]: (n) =>
      n === 1
        ? index
        : {
            lastInsertedIndex: 3,
            publications: [{ ...publication, index: 3, publishedAt: "2026-10-20T16:00:00Z" }],
          },
  });
  await assert.rejects(run("published"), /nova versão/);
});

test("interno ausente ou configuração não obtida interrompe o bot", async (t) => {
  for (const status of ["edited-flow", "edited-configurations"]) {
    reads(t, {
      [`${builder} /subflows/menu1/configurations/${status}`]: fail(67, "Subfluxo ausente"),
    });
    await assert.rejects(run(), /Subfluxo ausente/);
    t.mock.restoreAll();
  }
});

test("ações globais não obtidas não são substituídas por objeto vazio", async (t) => {
  reads(t, { [`${builder} /flow/global-actions`]: fail(67, "Ações não obtidas") });
  await assert.rejects(run(), /Ações não obtidas/);
});

test("mudança concorrente do pai ou dos internos é detectada", async (t) => {
  reads(t, { [`${builder} /flow`]: (n) => (n === 1 ? flow : { ...flow, added: { id: "added" } }) });
  await assert.rejects(run(), /rascunho mudou/);
  t.mock.restoreAll();
  reads(t, {
    [`${builder} /subflows/menu1/configurations/edited-configurations`]: (n) => ({
      document: n === 1 ? "{}" : '{"changed":true}',
    }),
  });
  await assert.rejects(run(), /subfluxo mudou/);
});

test("pacote publicado com referências sem conteúdo é rejeitado", async (t) => {
  const incomplete = structuredClone(document);
  delete incomplete.subflows;
  reads(t, { [`${hub} ${prefix}latestpublications:2`]: incomplete });
  await assert.rejects(run("published"), /implementações dos subfluxos/);
});

test("frontend também rejeita pacote incompleto, duplicado e controle nativo ausente", () => {
  const exported = {
    builderShortName: bot,
    version: "working",
    document: structuredClone(document),
  };
  delete exported.document.subflows;
  assert.throws(() => builderExportFile(exported), /implementações/);
  exported.document.subflows = [subflow, subflow];
  assert.throws(() => builderExportFile(exported), /duplicado/);
  exported.document.subflows = [structuredClone(subflow)];
  delete exported.document.subflows[0].flow.end;
  assert.throws(() => builderExportFile(exported), /bloco nativo end/);
});

test("correlação/identidade da resposta é obrigatória", async (t) => {
  reads(t, {}, (body) => ({ ...body, id: "other-request" }));
  await assert.rejects(run(), /identidade/);
  t.mock.restoreAll();
  reads(t, {}, (body) => ({ ...body, to: "other-bot@msging.net" }));
  await assert.rejects(run(), /identidade/);
});

test("JSON inválido é rejeitado sem export vazio", async (t) => {
  reads(t, { [`${builder} /subflows/menu1/configurations/edited-flow`]: { document: "{invalid" } });
  await assert.rejects(run(), /JSON inválido/);
});

test("rascunho AI inclui catálogos/documentos e configurações da ferramenta", async (t) => {
  const aiFlow = {
    ...flow,
    "ai-agent:one": {
      id: "ai-agent:one",
      $localCustomActions: [{ $id: "tool1", type: "KnowledgeBaseConsult", settings: {} }],
    },
  };
  const base = "/knowledge-base/agent/ai-agent%3Aone";
  reads(t, {
    [`${builder} /flow`]: aiFlow,
    [`${ai} ${base}/environment/DEV/catalog`]: {
      total: 1,
      items: [{ id: "cat1", status: "active" }],
    },
    [`${ai} ${base}/environment/DEV/catalog/cat1/document`]: {
      items: [{ id: "doc1", catalog_id: "cat1", status: "inactive" }],
    },
    [`${ai} ${base}/tool/tool1/environment/DEV/setup`]: { prompt: "pergunte" },
    [`${ai} ${base}/tool/tool1/environment/DEV/filter`]: { top_k: 5 },
  });
  const result = await run();
  assert.deepEqual(result.document.flow["ai-agent:one"].$groundingConfig, [
    { id: "cat1", status: "active", excluded_documents: [{ id: "doc1", catalog_id: "cat1" }] },
  ]);
  assert.deepEqual(result.document.flow["ai-agent:one"].$localCustomActions[0].settings, {
    prompt: "pergunte",
    top_k: 5,
  });
});

test("ID/key e versão inválidos são rejeitados antes de consultar", async (t) => {
  const calls = reads(t);
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName: "other", builderKey: key }),
    /correspondentes/,
  );
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName: bot, builderKey: key, version: "../other" }),
    /versão/,
  );
  assert.equal(calls.length, 0);
});

test("JSON/ZIP preservam campos nativos, internos e identificação da publicação", async () => {
  const exports = [
    { builderShortName: bot, version: "working", document },
    { builderShortName: bot, version: "published", publication, document },
  ];
  const zip = unzipSync(await createBuilderZip(exports));
  const filenames = exports.map((value) => builderExportFile(value).name);
  assert.equal(filenames[0], "export-test.json");
  assert.equal(filenames[1], "Versão de teste_2026-10-20T15_35_16.080Z.json");
  assert.equal(Object.keys(zip).length, 2);
  for (const filename of filenames)
    assert.deepEqual(JSON.parse(strFromU8(zip[filename])), document);
  assert.throws(
    () => builderExportFile({ ...exports[0], builderShortName: "../escape" }),
    /ID inválido/,
  );
  assert.throws(() => builderExportFile({ ...exports[1], publication: undefined }), /publicação/);
  await assert.rejects(createBuilderZip([]), /Nenhum fluxo/);
  assert.throws(() => createBuilderZip([exports[0], exports[0]]), /duplicados/);
});
