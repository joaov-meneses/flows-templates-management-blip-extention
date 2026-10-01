import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import exporter from "../server/builderExportService.cjs";
import { builderExportFile, createBuilderZip } from "../src/lib/builderDownload.ts";

const builderShortName = "export-test";
const builderKey = `Key ${Buffer.from(`${builderShortName}:fake-secret`).toString("base64")}`;
const document = {
  flow: {
    start: { id: "start", $title: "Início", $contentActions: [{ input: { expiration: "0:5" } }] },
  },
  configuration: { environment: "DEV", greeting: "Olá" },
  globalActions: { $enteringCustomActions: [{ type: "TrackEvent" }] },
};

function mockReads(t, overrides = {}) {
  const commands = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const command = JSON.parse(options.body);
    commands.push(command);
    assert.equal(command.method, "get", "a exportação não pode alterar nenhum documento");
    const field = command.uri.endsWith("_global_actions")
      ? "globalActions"
      : command.uri.endsWith("_configuration")
        ? "configuration"
        : "flow";
    return Response.json(
      overrides[field] || { status: "success", resource: JSON.stringify(document[field]) },
    );
  });
  return commands;
}

test("exporta o rascunho completo no documento do Builder usando somente leituras", async (t) => {
  const commands = mockReads(t);
  const result = await exporter.exportBuilderFlow({ builderShortName, builderKey });
  assert.deepEqual(result, { builderShortName, version: "working", document });
  assert.equal(commands.length, 3);
  assert.ok(
    commands.every((command) => command.uri.startsWith("/buckets/blip_portal:builder_working_")),
  );
  assert.equal(JSON.stringify(result).includes("fake-secret"), false);
});

test("a versão publicada consulta somente os documentos publicados", async (t) => {
  const commands = mockReads(t);
  await exporter.exportBuilderFlow({ builderShortName, builderKey, version: "published" });
  assert.ok(
    commands.every((command) => command.uri.startsWith("/buckets/blip_portal:builder_published_")),
  );
});

test("ausência opcional de configuração é tolerada; falha de acesso não é ocultada", async (t) => {
  mockReads(t, { configuration: { status: "failure", reason: { code: 67 } } });
  const result = await exporter.exportBuilderFlow({ builderShortName, builderKey });
  assert.deepEqual(result.document.configuration, {});
  t.mock.restoreAll();
  mockReads(t, {
    configuration: { status: "failure", reason: { code: 13, description: "Sem permissão" } },
  });
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName, builderKey }),
    /Sem permissão/,
  );
});

test("fluxo ausente ou inválido não gera uma exportação vazia", async (t) => {
  mockReads(t, {
    flow: { status: "failure", reason: { code: 67, description: "Não existe versão" } },
  });
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName, builderKey }),
    /Não existe versão/,
  );
  t.mock.restoreAll();
  mockReads(t, { flow: { status: "success", resource: "{invalid" } });
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName, builderKey }),
    /JSON inválido/,
  );
});

test("rejeita ID/key incompatíveis e versão inválida antes de consultar a Blip", async (t) => {
  const commands = mockReads(t);
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName: "other", builderKey }),
    /correspondentes/,
  );
  await assert.rejects(
    exporter.exportBuilderFlow({ builderShortName, builderKey, version: "../../other" }),
    /versão/,
  );
  assert.equal(commands.length, 0);
});

test("ZIP preserva JSON de cada Builder, nomes únicos e caracteres em português", async () => {
  const exports = [
    { builderShortName, version: "working", document },
    {
      builderShortName: "other-builder",
      version: "working",
      document: { ...document, configuration: {} },
    },
  ];
  const zip = unzipSync(await createBuilderZip(exports));
  assert.deepEqual(Object.keys(zip).sort(), ["export-test.json", "other-builder.json"]);
  assert.deepEqual(JSON.parse(strFromU8(zip["export-test.json"])), document);
  assert.deepEqual(JSON.parse(strFromU8(zip["other-builder.json"])), exports[1].document);
  assert.deepEqual(JSON.parse(builderExportFile(exports[0]).text), document);
  await assert.rejects(createBuilderZip([]), /Nenhum fluxo/);
  assert.throws(() => createBuilderZip([exports[0], exports[0]]), /duplicados/);
  assert.throws(
    () => builderExportFile({ ...exports[0], builderShortName: "../escape" }),
    /ID inválido/,
  );
});
