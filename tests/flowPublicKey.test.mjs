import assert from "node:assert/strict";
import test from "node:test";
import flowService from "../server/flowService.cjs";
import {
  buildFlowPublicKeyCommand,
  readFlowPublicKeyStatus,
  FLOW_PUBLIC_KEY_URI,
} from "../shared/flowPublicKey.mjs";

const existingKey = "-----BEGIN PUBLIC KEY-----\nexisting-test-key\n-----END PUBLIC KEY-----";
const newKey = "-----BEGIN PUBLIC KEY-----\nnew-test-key\n-----END PUBLIC KEY-----";
const present = {
  status: "success",
  resource: {
    data: [{ business_public_key: existingKey, business_public_key_signature_status: "VALID" }],
  },
};
const absent = { status: "success", resource: { data: [] } };
const flowJson = { version: "7.3", screens: [] };

function mockGateway(t, states = {}, api = true) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!options) return Response.json(flowJson);
    const command = JSON.parse(options.body);
    const key = options.headers.Authorization;
    calls.push({ key, command, url });
    if (command.uri === FLOW_PUBLIC_KEY_URI) {
      assert.equal(url, "https://http.msging.net/commands");
      if (command.method === "get") {
        if (states[key] === "offline") throw new Error("Conexão indisponível");
        return Response.json(states[key] ?? absent);
      }
      states[key] = present;
      return Response.json({ status: "success" });
    }
    if (command.uri === "/whatsapp-flows/assets/source-flow")
      return Response.json({
        status: "success",
        resource: {
          data: [{ asset_type: "FLOW_JSON", download_url: "https://example.test/flow.json" }],
        },
      });
    if (command.uri === "/whatsapp-flows/source-flow")
      return Response.json({
        status: "success",
        resource: {
          id: "source-flow",
          name: "Flow de teste",
          categories: ["OTHER"],
          ...(api ? { endpoint_uri: "https://example.test/endpoint" } : {}),
        },
      });
    return Response.json({ status: "success", resource: { id: "new-flow" } });
  });
  return calls;
}
const createParams = {
  sourceRouterKey: "source",
  name: "Teste",
  isFlowApi: true,
  endpointUri: "https://example.test/endpoint",
  flowJson,
};
const replicateParams = {
  sourceRouterKey: "source",
  targetRouterKeys: ["has-key", "missing-key"],
  flows: [{ id: "source-flow", name: "Flow de teste" }],
};
const writes = (calls) => calls.filter((call) => call.command.method === "set");
const uploads = (calls) => writes(calls).filter((call) => call.command.uri === FLOW_PUBLIC_KEY_URI);

test("iframe consulta o proprietário selecionado, com ID único e sem credenciais no comando", () => {
  const command = buildFlowPublicKeyCommand("router_test", "unique-id");
  assert.deepEqual(command, {
    id: "unique-id",
    from: "router_test@msging.net",
    to: "postmaster@wa.gw.msging.net",
    method: "get",
    uri: `lime://router_test@msging.net${FLOW_PUBLIC_KEY_URI}`,
  });
  assert.throws(() => buildFlowPublicKeyCommand("invalid@owner", "id"));
  assert.throws(
    () =>
      readFlowPublicKeyStatus(
        {
          ...present,
          metadata: { "#command.uri": `lime://wrong@msging.net${FLOW_PUBLIC_KEY_URI}` },
        },
        "router_test",
      ),
    /outro router/,
  );
});

test("somente sucesso com dados válidos diferencia chave presente de ausente", () => {
  assert.deepEqual(readFlowPublicKeyStatus(present), { exists: true, signatureStatus: "VALID" });
  assert.deepEqual(readFlowPublicKeyStatus(absent), { exists: false, signatureStatus: null });
  assert.equal(
    readFlowPublicKeyStatus({
      status: "success",
      resource: { data: [{ business_public_key: "" }] },
    }).exists,
    false,
  );
  for (const response of [
    null,
    { status: "failure" },
    { status: "success", resource: {} },
    { status: "success", resource: { data: [{}] } },
  ])
    assert.throws(() => readFlowPublicKeyStatus(response));
  assert.equal(
    readFlowPublicKeyStatus({
      status: "success",
      resource: {
        data: [
          { business_public_key: existingKey, business_public_key_signature_status: "INVALID" },
        ],
      },
    }).exists,
    true,
  );
});

test("consulta backend retorna apenas existência e assinatura, nunca a chave", async (t) => {
  const calls = mockGateway(t, { source: present });
  assert.deepEqual(await flowService.getFlowPublicKeyStatus({ sourceRouterKey: "source" }), {
    exists: true,
    signatureStatus: "VALID",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.method, "get");
});

test("cria Flow API sem solicitar ou sobrescrever chave já cadastrada", async (t) => {
  const calls = mockGateway(t, { source: present });
  const result = await flowService.createFlow({ ...createParams, businessPublicKey: newKey });
  assert.equal(result.publicKeyUpload, null);
  assert.equal(uploads(calls).length, 0);
  assert.equal(writes(calls).length, 2);
  t.mock.restoreAll();
  mockGateway(t, { source: present });
  assert.equal((await flowService.createFlow(createParams)).flow.id, "new-flow");
});

test("router sem chave exige preenchimento antes de qualquer escrita e faz upload uma vez", async (t) => {
  const calls = mockGateway(t);
  await assert.rejects(flowService.createFlow(createParams), /business_public_key/);
  assert.equal(writes(calls).length, 0);
  await flowService.createFlow({ ...createParams, businessPublicKey: newKey });
  assert.equal(uploads(calls).length, 1);
  assert.equal(uploads(calls)[0].command.resource.business_public_key, newKey);
});

test("falha, offline ou resposta malformada bloqueiam criação sem interpretar ausência", async (t) => {
  for (const state of [
    { status: "failure", reason: { code: 13 } },
    { status: "success", resource: {} },
    "offline",
  ]) {
    const calls = mockGateway(t, { source: state });
    await assert.rejects(flowService.createFlow({ ...createParams, businessPublicKey: newKey }));
    assert.equal(writes(calls).length, 0);
    t.mock.restoreAll();
  }
});

test("replicação mista preserva chave existente e envia somente aos destinos sem chave", async (t) => {
  const calls = mockGateway(t, { "has-key": present });
  const result = await flowService.replicateFlows({
    ...replicateParams,
    businessPublicKey: newKey,
  });
  assert.equal(result.totals.copied, 2);
  assert.equal(result.totals.publicKeyUploads, 1);
  assert.deepEqual(
    uploads(calls).map((call) => call.key),
    ["missing-key"],
  );
  const firstWrite = calls.findIndex((call) => call.command.method === "set");
  assert.equal(
    calls.slice(0, firstWrite).filter((call) => call.command.uri === FLOW_PUBLIC_KEY_URI).length,
    2,
  );
});

test("replicação sem chave manual funciona quando todos já possuem; ausência bloqueia antes das escritas", async (t) => {
  const calls = mockGateway(t, { "has-key": present, "missing-key": present });
  assert.equal((await flowService.replicateFlows(replicateParams)).totals.copied, 2);
  assert.equal(uploads(calls).length, 0);
  t.mock.restoreAll();
  const missingCalls = mockGateway(t, { "has-key": present });
  await assert.rejects(flowService.replicateFlows(replicateParams), /business_public_key/);
  assert.equal(writes(missingCalls).length, 0);
});

test("falha de consulta exclui o destino de Flow API sem upload, preservando os demais", async (t) => {
  const calls = mockGateway(t, {
    "has-key": present,
    "missing-key": { status: "failure", reason: { code: 13 } },
  });
  const result = await flowService.replicateFlows({
    ...replicateParams,
    businessPublicKey: newKey,
  });
  assert.equal(result.totals.copied, 1);
  assert.equal(result.errors[0].step, "check_public_key");
  assert.equal(result.errors[0].targetIndex, 1);
  assert.equal(
    writes(calls).some((call) => call.key === "missing-key"),
    false,
  );
});

test("flows comuns não consultam nem enviam public key", async (t) => {
  const calls = mockGateway(t, {}, false);
  await flowService.createFlow({ ...createParams, isFlowApi: false });
  const result = await flowService.replicateFlows(replicateParams);
  assert.equal(result.totals.copied, 2);
  assert.equal(
    calls.some((call) => call.command.uri === FLOW_PUBLIC_KEY_URI),
    false,
  );
});
