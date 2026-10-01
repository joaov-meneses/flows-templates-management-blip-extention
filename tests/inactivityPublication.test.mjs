import assert from "node:assert/strict";
import test from "node:test";
import service from "../server/inactivityService.cjs";

const key = "Key test-only";
const prefix = "/buckets/blip_portal:builder_";
const runtimeUri = "lime://builder.hosting@msging.net/configuration";
function flow() {
  const block = (id, bypass = false) => ({
    id,
    $title: id,
    $contentActions: [
      { action: { type: "SendMessage", settings: { text: "Preservar" } } },
      { input: { bypass, expiration: "0:10", variable: "answer" } },
    ],
    $defaultOutput: { stateId: "next" },
  });
  return {
    onboarding: block("onboarding"),
    eligible: block("eligible"),
    bypass: block("bypass", true),
  };
}

function mockPublication(t, options = {}) {
  const draft = flow();
  const runtime = {
    identifier: "testbot",
    settingsType: "Settings",
    settings: {
      unrelated: "preserve",
      flow: {
        id: "flow-id",
        states: Object.values(draft).map((block) => ({
          id: block.id,
          input: structuredClone(block.$contentActions[1].input),
          inputActions: [
            { type: "SendMessage", settings: { metadata: { "#stateId": "{{state.id}}" } } },
          ],
          outputs: [block.$defaultOutput],
        })),
      },
    },
  };
  const resource = { Template: "builder", Application: JSON.stringify(runtime) };
  const store = new Map([
    [prefix + "working_flow", structuredClone(draft)],
    [prefix + "published_flow", structuredClone(draft)],
    [prefix + "working_configuration", { token: "keep", "builder:stateTrack": "true" }],
    [prefix + "published_configuration", { token: "keep", "builder:stateTrack": "true" }],
    [prefix + "working_global_actions", { $enteringCustomActions: [{ type: "TrackEvent" }] }],
    [prefix + "published_global_actions", { $enteringCustomActions: [{ type: "TrackEvent" }] }],
    [
      prefix + "latestpublications",
      { lastInsertedIndex: 6, publications: [6, 5, 4, 3, 2].map((index) => ({ index })) },
    ],
    [runtimeUri, resource],
  ]);
  const commands = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://msging.net/commands");
    assert.equal(init.headers.Authorization, key);
    const command = JSON.parse(init.body);
    commands.push(command);
    const uri = command.uri.split("?")[0];
    options.onCommand?.(command, store);
    if (options.reject?.(command))
      return Response.json({
        status: "failure",
        reason: { code: 50, description: "Falha simulada" },
      });
    if (command.method === "set") {
      if (uri === runtimeUri) {
        assert.equal(command.to, "postmaster@msging.net");
        assert.equal(new URL(command.uri).searchParams.get("caller"), "testbot@msging.net");
      }
      store.set(uri, structuredClone(command.resource));
    }
    if (!store.has(uri))
      return Response.json({
        status: "failure",
        reason: { code: 67, description: "Resource not found" },
      });
    const resource = options.readResource
      ? options.readResource(command, structuredClone(store.get(uri)))
      : store.get(uri);
    return Response.json({
      status: "success",
      resource: options.asString && uri.startsWith(prefix) ? JSON.stringify(resource) : resource,
    });
  });
  return { store, commands, runtime, draft };
}

async function apply(publishAfterSave = true) {
  const analysis = await service.analyzeInactivity({ builderKey: key });
  return service.applyInactivity({
    builderKey: key,
    revision: analysis.revision,
    minutes: 25,
    blockKeys: ["eligible"],
    publishAfterSave,
  });
}

test("publicação de inatividade confirma leitura atrasada e JSON reformatado sem ativar o runtime duas vezes", async (t) => {
  let previousRuntime;
  let written = false;
  let verificationReads = 0;
  const { commands, store } = mockPublication(t, {
    onCommand(command) {
      if (command.method === "set" && command.uri.startsWith(runtimeUri)) written = true;
    },
    readResource(command, resource) {
      if (written && command.method === "get" && command.uri === runtimeUri) {
        if (++verificationReads === 1) return previousRuntime;
        resource.Application = JSON.stringify(JSON.parse(resource.Application), null, 2);
      }
      return resource;
    },
  });
  previousRuntime = structuredClone(store.get(runtimeUri));
  const result = await apply();
  assert.equal(result.published, true);
  assert.equal(verificationReads, 2);
  assert.equal(
    commands.filter((command) => command.method === "set" && command.uri.startsWith(runtimeUri))
      .length,
    1,
  );
  assert.equal(store.get(prefix + "latestpublications").lastInsertedIndex, 7);
});

test("publicação automática atualiza runtime, documento e histórico, preservando ações e blocos excluídos", async (t) => {
  const { store, runtime, commands } = mockPublication(t, { asString: true });
  const result = await apply();
  assert.equal(result.published, true);
  assert.equal(result.publicationIndex, 7);
  assert.equal(result.publicationError, undefined);
  assert.equal(result.updated, 1);
  const expected = structuredClone(runtime);
  expected.settings.flow.states.find((state) => state.id === "eligible").input.expiration = "0:25";
  assert.deepEqual(JSON.parse(store.get(runtimeUri).Application), expected);
  assert.deepEqual(store.get(prefix + "published_flow"), store.get(prefix + "working_flow"));
  const latest = store.get(prefix + "latestpublications");
  assert.equal(latest.lastInsertedIndex, 7);
  assert.equal(latest.publications.length, 5);
  assert.equal(latest.isMoreOptionsActive, true);
  assert.equal(latest.publications[0].author, "Templates/Flows Manager");
  assert.deepEqual(
    store.get(prefix + "latestpublications:7").flow,
    store.get(prefix + "working_flow"),
  );
  assert.equal(
    commands.filter(
      (command) => command.method === "set" && command.uri.includes("working_configuration"),
    ).length,
    0,
  );
});

test("padrão salva somente o rascunho; valores não booleanos são rejeitados antes de gravar", async (t) => {
  const { commands } = mockPublication(t);
  assert.equal((await apply(false)).published, false);
  assert.ok(commands.every((command) => command.uri === prefix + "working_flow"));
  await assert.rejects(apply("true"), /Opções de inatividade inválidas/);
  assert.equal(commands.filter((command) => command.method === "set").length, 1);
});

test("outras mudanças pendentes mantêm rascunho salvo e impedem publicação de runtime antigo", async (t) => {
  for (const name of ["working_flow", "working_configuration", "working_global_actions"]) {
    await t.test(name, async (t) => {
      const { store, commands } = mockPublication(t);
      const value = store.get(prefix + name);
      if (name === "working_flow") value.eligible.$defaultOutput.stateId = "new-destination";
      else value.pending = "not compiled";
      const result = await apply();
      assert.equal(result.published, false);
      assert.equal(result.updated, 1);
      assert.match(result.publicationError, /outras alterações pendentes/);
      assert.equal(
        store.get(prefix + "working_flow").eligible.$contentActions[1].input.expiration,
        "0:25",
      );
      assert.ok(
        commands
          .filter((command) => command.method === "set")
          .every((command) => command.uri === prefix + "working_flow"),
      );
    });
  }
});

test("fluxo sem publicação anterior ou entrada incompatível não altera runtime", async (t) => {
  for (const mode of ["unpublished", "missing-input", "duplicate-id"]) {
    await t.test(mode, async (t) => {
      const { store, commands } = mockPublication(t);
      if (mode === "unpublished") store.delete(runtimeUri);
      else {
        const resource = store.get(runtimeUri);
        const runtime = JSON.parse(resource.Application);
        if (mode === "missing-input") delete runtime.settings.flow.states[1].input;
        else runtime.settings.flow.states.push(runtime.settings.flow.states[1]);
        resource.Application = JSON.stringify(runtime);
      }
      const result = await apply();
      assert.equal(result.published, false);
      assert.ok(result.publicationError);
      assert.ok(
        commands.every(
          (command) => command.method !== "set" || command.uri === prefix + "working_flow",
        ),
      );
    });
  }
});

test("mudança concorrente no Builder bloqueia a publicação antes do set de runtime", async (t) => {
  let reads = 0;
  const { commands } = mockPublication(t, {
    onCommand(command, store) {
      if (
        command.uri === prefix + "working_configuration" &&
        command.method === "get" &&
        ++reads === 2
      )
        store.get(command.uri).concurrent = true;
    },
  });
  const result = await apply();
  assert.equal(result.published, false);
  assert.match(result.publicationError, /mudou durante/);
  assert.ok(
    commands.every(
      (command) => command.method !== "set" || command.uri === prefix + "working_flow",
    ),
  );
});

test("falha ou leitura incerta de runtime nunca é informada como publicação confirmada", async (t) => {
  await t.test("set recusado", async (t) => {
    mockPublication(t, {
      reject: (command) => command.method === "set" && command.uri.startsWith(runtimeUri),
    });
    const result = await apply();
    assert.equal(result.published, false);
    assert.match(result.publicationError, /Rascunho salvo; publicação não confirmada/);
  });
  await t.test("readback divergente", async (t) => {
    let runtimeWritten = false;
    const { store } = mockPublication(t, {
      onCommand(command, store) {
        if (command.method === "set" && command.uri.startsWith(runtimeUri)) runtimeWritten = true;
        if (runtimeWritten && command.method === "get" && command.uri === runtimeUri)
          store.get(runtimeUri).Application = JSON.stringify({ changed: true });
      },
    });
    const result = await apply();
    assert.equal(result.published, false);
    assert.match(result.publicationError, /comando pode ter sido aplicado/);
    assert.equal(store.get(prefix + "latestpublications").lastInsertedIndex, 6);
  });
});

test("falha no histórico informa fluxo ativo confirmado e aviso separado", async (t) => {
  mockPublication(t, {
    reject: (command) => command.method === "set" && command.uri === prefix + "latestpublications",
  });
  const result = await apply();
  assert.equal(result.published, true);
  assert.match(result.publicationError, /Fluxo ativo confirmado, mas houve falha ao registrar/);
});

test("publica inatividade já salva no rascunho mesmo sem novas alterações", async (t) => {
  const { store } = mockPublication(t);
  store.get(prefix + "working_flow").eligible.$contentActions[1].input.expiration = "0:25";
  const result = await apply();
  assert.equal(result.updated, 0);
  assert.equal(result.published, true);
  assert.equal(
    JSON.parse(store.get(runtimeUri).Application).settings.flow.states[1].input.expiration,
    "0:25",
  );
});
