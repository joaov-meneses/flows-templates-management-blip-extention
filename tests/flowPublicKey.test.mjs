import assert from "node:assert/strict";
import test from "node:test";
import flowService from "../server/flowService.cjs";
import { readFlowPublicKeyStatus, FLOW_PUBLIC_KEY_URI } from "../shared/flowPublicKey.mjs";
import { lookupFlowPublicKey } from "../src/lib/flowPublicKeys.ts";

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

test("consulta usa a autenticação de cada router sem criar envelope delegado pelo Portal", async (t) => {
  const calls = [];
  const resolved = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, key: options.headers.Authorization });
    if (url === "/api/flows/public-key") {
      return Response.json(await flowService.getFlowPublicKeyStatus(body));
    }
    assert.equal(url, "https://http.msging.net/commands");
    // Reproduce the gateway's code 26 for the old delegated envelope.
    if (body.from && !body.pp) {
      return Response.json({
        status: "failure",
        reason: {
          code: 26,
          description: "The 'pp' property must be specified when sending delegate envelopes",
        },
      });
    }
    return Response.json(options.headers.Authorization === "key-origin" ? present : absent);
  });
  const resolveKey = async (shortName) => {
    resolved.push(shortName);
    return { shortName, key: `key-${shortName}` };
  };
  assert.equal((await lookupFlowPublicKey({ shortName: "origin" }, resolveKey)).exists, true);
  assert.equal((await lookupFlowPublicKey({ shortName: "target" }, resolveKey)).exists, false);
  assert.deepEqual(resolved, ["origin", "target"]);
  const commands = calls.filter((call) => call.url.startsWith("https://"));
  assert.deepEqual(
    commands.map((call) => call.key),
    ["key-origin", "key-target"],
  );
  assert.equal(new Set(commands.map((call) => call.body.id)).size, 2);
  for (const { body } of commands) {
    assert.equal(body.method, "get");
    assert.equal(body.uri, FLOW_PUBLIC_KEY_URI);
    assert.equal(body.to, "postmaster@wa.gw.msging.net");
    assert.equal("from" in body, false);
    assert.equal("pp" in body, false);
  }
});

test("key já disponível é usada diretamente, inclusive fora do iframe", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/flows/public-key");
    assert.deepEqual(JSON.parse(options.body), { sourceRouterKey: "key-origin" });
    return Response.json({ exists: true, signatureStatus: "VALID" });
  });
  assert.deepEqual(
    await lookupFlowPublicKey({ shortName: "Router de origem", key: " key-origin " }, () => {
      throw new Error("Não deve resolver novamente a key");
    }),
    { exists: true, signatureStatus: "VALID" },
  );
});

test("falha ao resolver a key e resposta de outro router bloqueiam a consulta", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Não deve consultar com key inválida");
  });
  await assert.rejects(
    lookupFlowPublicKey({ shortName: "target" }, async () => {
      throw new Error("Sem acesso ao router");
    }),
    /Sem acesso/,
  );
  await assert.rejects(
    lookupFlowPublicKey({ shortName: "target" }, async () => ({
      shortName: "other",
      key: "key-other",
    })),
    /outro router/,
  );
  await assert.rejects(lookupFlowPublicKey({ shortName: "target" }), /obter a key/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("falha do backend ou resposta incompleta não são interpretadas como chave ausente", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { message: "Falha ao consultar o gateway" } }, { status: 500 }),
  );
  await assert.rejects(
    lookupFlowPublicKey({ shortName: "target", key: "key-target" }),
    /Falha ao consultar/,
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ signatureStatus: null }));
  await assert.rejects(
    lookupFlowPublicKey({ shortName: "target", key: "key-target" }),
    /dados incompletos/,
  );
});

test("resposta que identifica outro router é rejeitada", () => {
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
