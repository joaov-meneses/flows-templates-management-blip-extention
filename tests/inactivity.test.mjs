import assert from "node:assert/strict";
import test from "node:test";
import service from "../server/inactivityService.cjs";
import {
  expirationGroup,
  expirationLabel,
  expirationMinutes,
  groupInactivity,
  validInactivityMinutes,
} from "../src/lib/inactivity.ts";

const builderKey = "Key test-only";
const uri = "/buckets/blip_portal:builder_working_flow";
const block = (id, expiration, bypass = false) => ({
  id,
  $title: `Bloco ${id}`,
  $contentActions: [
    { action: { type: "SendMessage", settings: { text: "Olá" } } },
    { input: { bypass, ...(expiration === undefined ? {} : { expiration }), variable: "answer" } },
  ],
  $defaultOutput: { stateId: "next" },
});
const fixture = () => ({
  onboarding: block("onboarding", "0:1"),
  fallback: block("fallback", "0:2"),
  error: block("error", "0:3"),
  bypass: block("bypass", "0:4", true),
  message: { id: "message", $contentActions: [{ action: { type: "SendMessage" } }] },
  empty: block("empty"),
  ten: block("ten", "0:10"),
  thirty: block("thirty", "0:30"),
  // Only the first input is checked, even if a later input would be eligible.
  firstBypass: {
    id: "firstBypass",
    $contentActions: [{ input: { bypass: true } }, { input: { bypass: false } }],
  },
  metadata: { version: 1 },
});

function mockDraft(
  t,
  initial = fixture(),
  { asString = false, rejectSet = false, corruptReadback = false } = {},
) {
  let draft = structuredClone(initial);
  const commands = [];
  let wrote = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://msging.net/commands");
    assert.equal(options.headers.Authorization, builderKey);
    const request = JSON.parse(options.body);
    commands.push(request);
    // Any call to runtime, published buckets, config or publication history fails.
    assert.equal(request.uri, uri);
    assert.ok(["get", "set"].includes(request.method));
    if (request.method === "set") {
      if (rejectSet)
        return Response.json({ status: "failure", reason: { description: "Sem permissão" } });
      assert.equal(request.type, "application/json");
      draft = structuredClone(request.resource);
      wrote = true;
    }
    const returned = corruptReadback && wrote ? fixture() : draft;
    return Response.json({
      status: "success",
      resource: asString ? JSON.stringify(returned) : returned,
    });
  });
  return {
    commands,
    read: () => draft,
    replace: (value) => {
      draft = value;
    },
  };
}

test("análise segue a regra atual do Addons, incluindo somente a primeira entrada", async (t) => {
  const store = mockDraft(t);
  const analysis = await service.analyzeInactivity({ builderKey });
  assert.deepEqual(
    analysis.blocks.map((item) => item.blockKey),
    ["empty", "ten", "thirty"],
  );
  assert.equal(analysis.totalBlocks, 9);
  assert.equal(analysis.eligibleBlocks, 3);
  assert.equal(analysis.configuredBlocks, 2);
  assert.equal(analysis.blocks[0].expiration, null);
  assert.equal(analysis.revision.length, 64);
  assert.equal(store.commands.length, 1);
});

test("global salva todos os blocos elegíveis, preserva o restante do JSON e verifica sem publicar", async (t) => {
  const before = fixture();
  const store = mockDraft(t, before, { asString: true });
  const analysis = await service.analyzeInactivity({ builderKey });
  const result = await service.applyInactivity({
    builderKey,
    revision: analysis.revision,
    minutes: 90,
    blockKeys: analysis.blocks.map((item) => item.blockKey),
  });
  const expected = structuredClone(before);
  for (const key of ["empty", "ten", "thirty"])
    expected[key].$contentActions[1].input.expiration = "1:30";
  assert.deepEqual(store.read(), expected);
  assert.equal(result.updated, 3);
  assert.equal(result.published, false);
  assert.deepEqual(
    store.commands.map((command) => command.method),
    ["get", "get", "set", "get"],
  );
});

test("seleção e tempo individual alteram somente os blocos selecionados e a primeira entrada", async (t) => {
  const before = fixture();
  before.ten.$contentActions.push({ input: { expiration: "2:0" } });
  const store = mockDraft(t, before);
  const analysis = await service.analyzeInactivity({ builderKey });
  await service.applyInactivity({
    builderKey,
    revision: analysis.revision,
    minutes: 5,
    blockKeys: ["empty", "ten"],
    overrides: { ten: 15 },
  });
  const expected = structuredClone(before);
  expected.empty.$contentActions[1].input.expiration = "0:5";
  expected.ten.$contentActions[1].input.expiration = "0:15";
  assert.deepEqual(store.read(), expected);
});

test("manter tempos preserva preenchidos inclusive com override individual", async (t) => {
  const store = mockDraft(t);
  const analysis = await service.analyzeInactivity({ builderKey });
  const result = await service.applyInactivity({
    builderKey,
    revision: analysis.revision,
    minutes: 5.5,
    blockKeys: ["empty", "ten", "thirty"],
    keepExisting: true,
    overrides: { ten: 20 },
  });
  assert.equal(result.updated, 1);
  assert.equal(result.kept, 2);
  assert.equal(store.read().ten.$contentActions[1].input.expiration, "0:10");
  assert.equal(store.read().empty.$contentActions[1].input.expiration, "0:5.5");
});

test("rascunho alterado após análise resulta em conflito sem nenhuma escrita", async (t) => {
  const store = mockDraft(t);
  const analysis = await service.analyzeInactivity({ builderKey });
  const changed = fixture();
  changed.ten.$title = "Editado no Builder";
  store.replace(changed);
  await assert.rejects(
    service.applyInactivity({
      builderKey,
      revision: analysis.revision,
      minutes: 5,
      blockKeys: ["ten"],
    }),
    (error) => error.statusCode === 409,
  );
  assert.ok(store.commands.every((command) => command.method === "get"));
  assert.deepEqual(store.read(), changed);
});

test("blocos excluídos e overrides fora da seleção são rejeitados sem escrita", async (t) => {
  const store = mockDraft(t);
  const { revision } = await service.analyzeInactivity({ builderKey });
  for (const key of [
    "onboarding",
    "fallback",
    "error",
    "bypass",
    "message",
    "firstBypass",
    "missing",
  ]) {
    await assert.rejects(
      service.applyInactivity({ builderKey, revision, minutes: 5, blockKeys: [key] }),
    );
  }
  await assert.rejects(
    service.applyInactivity({
      builderKey,
      revision,
      minutes: 5,
      blockKeys: ["ten"],
      overrides: { empty: 10 },
    }),
  );
  assert.ok(store.commands.every((command) => command.method === "get"));
});

test("limites de tempo iguais ao formulário do plugin são validados antes da API", async (t) => {
  const store = mockDraft(t);
  for (const minutes of [0, -1, 1380, Infinity, NaN, "5", null]) {
    await assert.rejects(
      service.applyInactivity({ builderKey, revision: "test", minutes, blockKeys: ["ten"] }),
    );
  }
  assert.equal(store.commands.length, 0);
  assert.equal(service.convertToHours(60), "1:0");
  assert.equal(service.convertToHours(1379), "22:59");
  assert.equal(validInactivityMinutes("5.5"), true);
  for (const value of ["", " ", "0", "1380", "abc"])
    assert.equal(validInactivityMinutes(value), false);
});

test("não repete escrita quando o tempo selecionado já coincide", async (t) => {
  const store = mockDraft(t);
  const { revision } = await service.analyzeInactivity({ builderKey });
  const result = await service.applyInactivity({
    builderKey,
    revision,
    minutes: 10,
    blockKeys: ["ten"],
  });
  assert.equal(result.updated, 0);
  assert.ok(store.commands.every((command) => command.method === "get"));
});

test("falha de gravação e divergência na leitura de confirmação não reportam sucesso", async (t) => {
  for (const options of [{ rejectSet: true }, { corruptReadback: true }]) {
    await t.test(JSON.stringify(options), async (subtest) => {
      mockDraft(subtest, fixture(), options);
      const { revision } = await service.analyzeInactivity({ builderKey });
      await assert.rejects(
        service.applyInactivity({ builderKey, revision, minutes: 5, blockKeys: ["ten"] }),
      );
    });
  }
});

test("resposta de fluxo inválida ou falha Blip não é contabilizada como zero blocos", async (t) => {
  for (const resource of [null, "invalid-json", []]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ status: "success", resource }));
    await assert.rejects(service.analyzeInactivity({ builderKey }));
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ status: "failure", reason: { description: "Resource not found" } }),
  );
  await assert.rejects(service.analyzeInactivity({ builderKey }), /Resource not found/);
});

test("distribuição normaliza formatos de tempo e conta bots distintos por grupo", () => {
  const bots = [
    { blocks: [{ expiration: "0:10" }, { expiration: "00:10:00" }, { expiration: null }] },
    { blocks: [{ expiration: "0:10" }, { expiration: "1:0" }, { expiration: "{{config.time}}" }] },
  ];
  const groups = groupInactivity(bots);
  assert.deepEqual(
    groups.find((group) => group.key === "minutes:10"),
    { key: "minutes:10", expiration: "0:10", blocks: 3, bots: 2 },
  );
  assert.equal(expirationMinutes("01:30:30"), 90.5);
  assert.equal(expirationGroup("{{config.time}}"), "raw:{{config.time}}");
  assert.equal(expirationLabel(null), "Sem inatividade");
  assert.equal(expirationLabel("0:10"), "10 min");
});
