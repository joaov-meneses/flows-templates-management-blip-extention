import assert from "node:assert/strict";
import test from "node:test";
import publication from "../server/builderPublicationService.cjs";
import compiler from "../server/builderCompiler.cjs";

const builderShortName = "builder-test";
const builderKey = `Key ${Buffer.from(`${builderShortName}:test-secret`).toString("base64")}`;
const prefix = "/buckets/blip_portal:builder_";
const runtimeUri = "lime://take.builder.hosting@msging.net/configuration";
const message = (content) => ({ type: "SendMessage", settings: { type: "text/plain", content } });
function graph() {
  return {
    onboarding: {
      id: "onboarding",
      root: true,
      $title: "Início",
      $contentActions: [{ input: { bypass: false } }],
      $defaultOutput: { stateId: "question" },
    },
    question: {
      id: "question",
      $title: "Perguntar",
      $position: { x: 10, y: 20 },
      $enteringCustomActions: [
        { type: "SetVariable", settings: { variable: "test", value: "new" } },
      ],
      $contentActions: [
        { action: message("Mensagem nova do rascunho") },
        {
          input: {
            bypass: false,
            expiration: "0:15",
            variable: "answer",
            $cardContent: { test: true },
          },
        },
        { action: message("Resposta nova") },
      ],
      $leavingCustomActions: [
        { type: "TrackEvent", settings: { category: "new", action: "answer" } },
      ],
      $afterStateChangedActions: [
        { type: "SetVariable", settings: { variable: "after", value: "true" } },
      ],
      $conditionOutputs: [
        {
          stateId: "new-block",
          conditions: [{ source: "input", comparison: "equals", values: ["yes"] }],
          $id: "ui-only",
        },
      ],
      $defaultOutput: { stateId: "fallback" },
    },
    "new-block": {
      id: "new-block",
      $title: "Bloco novo",
      $contentActions: [{ action: message("Novo bloco") }],
      $defaultOutput: { stateId: "question" },
    },
    fallback: {
      id: "fallback",
      $title: "Fallback",
      $contentActions: [{ input: { bypass: false } }],
      $defaultOutput: { stateId: "question" },
    },
  };
}

function mockBuilder(t, options = {}) {
  const flow = graph();
  const originalRuntime = {
    identifier: builderShortName,
    settingsType: "Settings",
    commandReceivers: [{ type: "Keep" }],
    settings: {
      custom: "preserve",
      flow: {
        id: "main-flow",
        states: [
          {
            id: "obsolete-block",
            root: true,
            inputActions: [{ type: "TrackContactsJourney" }],
            input: { bypass: false },
          },
        ],
      },
    },
  };
  const store = new Map([
    ["lime://admin@msging.net/configuration", { Cluster: "take" }],
    [runtimeUri, { Template: "builder", Application: JSON.stringify(originalRuntime) }],
    [prefix + "working_flow", flow],
    [prefix + "working_configuration", { "builder:stateTrack": "true", newConfig: "new-value" }],
    [
      prefix + "working_global_actions",
      {
        id: "global-actions",
        $enteringCustomActions: [
          { type: "TrackEvent", settings: { category: "global", action: "enter" } },
        ],
        $leavingCustomActions: [
          { type: "SetVariable", settings: { variable: "global", value: "new" } },
        ],
      },
    ],
    [prefix + "working_flow_id", "draft-flow-id"],
    [prefix + "published_flow", { old: { id: "obsolete-block" } }],
    [prefix + "published_configuration", { oldConfig: "old-value" }],
    [prefix + "published_global_actions", {}],
    [
      prefix + "latestpublications",
      { lastInsertedIndex: 5, publications: [5, 4, 3, 2, 1].map((index) => ({ index })) },
    ],
    ["/templates/builder", { settingsType: "Settings", settings: { templateDefault: true } }],
  ]);
  const commands = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://msging.net/commands");
    assert.equal(init.headers.Authorization, builderKey);
    const request = JSON.parse(init.body);
    commands.push(request);
    const uri = request.uri.split("?")[0];
    options.onCommand?.(request, store);
    if (options.reject?.(request))
      return Response.json({
        status: "failure",
        reason: { code: 50, description: "Erro simulado" },
      });
    if (request.method === "set") {
      assert.ok(request.type);
      if (uri === runtimeUri) {
        assert.equal(request.to, "postmaster@configurations.msging.net");
        assert.equal(
          new URL(request.uri).searchParams.get("caller"),
          `${builderShortName}@msging.net`,
        );
      }
      store.set(uri, structuredClone(request.resource));
    }
    if (!store.has(uri))
      return Response.json({ status: "failure", reason: { code: 67, description: "Not found" } });
    const resource = store.get(uri);
    return Response.json({
      status: "success",
      resource:
        options.asString && typeof resource === "object" && uri.startsWith(prefix)
          ? JSON.stringify(resource)
          : resource,
    });
  });
  return { store, commands, originalRuntime, flow };
}
const publish = () => publication.publishBuilderDraft({ builderKey, builderShortName });

test("publica o rascunho completo, incluindo blocos e mensagens novos, sem reutilizar o fluxo publicado antigo", async (t) => {
  const { store, commands, flow, originalRuntime } = mockBuilder(t, { asString: true });
  const result = await publish();
  assert.equal(result.published, true);
  assert.equal(result.states, 4);
  assert.equal(result.publicationIndex, 6);
  const runtime = JSON.parse(store.get(runtimeUri).Application);
  assert.deepEqual(runtime.commandReceivers, originalRuntime.commandReceivers);
  assert.equal(runtime.settings.custom, "preserve");
  const compiled = runtime.settings.flow;
  assert.equal(compiled.id, "draft-flow-id");
  assert.deepEqual(
    compiled.states.map((state) => state.id),
    Object.keys(flow),
  );
  assert.ok(!compiled.states.some((state) => state.id === "obsolete-block"));
  const question = compiled.states.find((state) => state.id === "question");
  assert.equal(question.input.expiration, "0:15");
  assert.equal(
    question.inputActions.find((action) => action.type === "SendMessage").settings.content,
    "Mensagem nova do rascunho",
  );
  assert.equal(
    question.outputActions.find((action) => action.type === "SendMessage").settings.content,
    "Resposta nova",
  );
  assert.equal(question.afterStateChangedActions[0].settings.value, "true");
  assert.equal(question.outputs[0].stateId, "new-block");
  assert.deepEqual(question.outputs[0].conditions[0].values, ["yes"]);
  assert.equal(
    question.inputActions.filter((action) => action.type === "TrackContactsJourney").length,
    1,
  );
  assert.equal(question.inputActions.filter((action) => action.type === "TrackEvent").length, 1);
  assert.equal(
    question.inputActions.find((action) => action.type === "SendMessage").settings.metadata[
      "#stateId"
    ],
    "{{state.id}}",
  );
  assert.ok(!JSON.stringify(compiled).includes("$cardContent"));
  assert.ok(!JSON.stringify(compiled).includes("$position"));
  assert.equal(compiled.configuration.newConfig, "new-value");
  assert.equal(compiled.inputActions[0].settings.category, "global");
  assert.equal(compiled.outputActions[0].settings.value, "new");
  assert.deepEqual(store.get(prefix + "published_flow"), flow);
  assert.deepEqual(store.get(prefix + "latestpublications:6").flow, flow);
  assert.equal(store.get(prefix + "latestpublications").publications.length, 5);
  assert.ok(
    commands.every((command) => command.method !== "set" || !command.uri.includes("working_")),
  );
  assert.deepEqual(store.get(prefix + "working_flow"), flow);
});

test("primeira publicação usa o template oficial de hosting e registra um ID estável", async (t) => {
  const { store, commands } = mockBuilder(t);
  store.delete(runtimeUri);
  store.delete(prefix + "working_flow_id");
  const result = await publish();
  assert.equal(result.published, true);
  const runtime = JSON.parse(store.get(runtimeUri).Application);
  assert.equal(runtime.identifier, builderShortName);
  assert.equal(runtime.settings.templateDefault, true);
  assert.equal(store.get(prefix + "working_flow_id"), runtime.settings.flow.id);
  assert.ok(
    commands.some(
      (command) =>
        command.uri === "/templates/builder" && command.to === "take.builder.hosting@msging.net",
    ),
  );
});

test("IDs e chaves incompatíveis são rejeitados antes de consultar ou gravar", async (t) => {
  const { commands } = mockBuilder(t);
  await assert.rejects(
    publication.publishBuilderDraft({ builderKey, builderShortName: "other" }),
    /correspondentes/,
  );
  assert.equal(commands.length, 0);
});

test("bloqueia runtime de router, rascunho inválido e mudanças concorrentes antes de publicar", async (t) => {
  for (const mode of [
    "router",
    "invalid-json",
    "missing-root",
    "duplicate-id",
    "invalid-output",
    "concurrent",
  ]) {
    await t.test(mode, async (t) => {
      let reads = 0;
      const { store, commands } = mockBuilder(t, {
        onCommand(command, store) {
          if (mode === "concurrent" && command.uri === prefix + "working_flow" && ++reads === 2)
            store.get(command.uri).question.$title = "Alterado durante a leitura";
        },
      });
      if (mode === "router") store.get(runtimeUri).Template = "master";
      if (mode === "invalid-json") store.set(prefix + "working_flow", "not-json");
      if (mode === "missing-root") store.get(prefix + "working_flow").onboarding.root = false;
      if (mode === "duplicate-id") store.get(prefix + "working_flow").fallback.id = "question";
      if (mode === "invalid-output")
        store.get(prefix + "working_flow").question.$defaultOutput.stateId = "missing";
      await assert.rejects(publish());
      assert.ok(commands.every((command) => command.method === "get"));
    });
  }
});

test("falha no set ou na verificação do runtime não é informada como sucesso", async (t) => {
  await t.test("set recusado", async (t) => {
    const { store } = mockBuilder(t, {
      reject: (command) => command.method === "set" && command.uri.startsWith(runtimeUri),
    });
    const result = await publish();
    assert.equal(result.published, false);
    assert.match(result.error, /Publicação não confirmada/);
    assert.equal(store.get(prefix + "latestpublications").lastInsertedIndex, 5);
  });
  await t.test("readback diferente", async (t) => {
    let wrote = false;
    const { commands } = mockBuilder(t, {
      onCommand(command, store) {
        if (command.method === "set" && command.uri.startsWith(runtimeUri)) wrote = true;
        if (wrote && command.method === "get" && command.uri === runtimeUri)
          store.get(runtimeUri).Application = JSON.stringify({ changed: true });
      },
    });
    const result = await publish();
    assert.equal(result.published, false);
    assert.match(result.error, /comando pode ter sido aplicado/);
    assert.equal(commands.filter((command) => command.method === "set").length, 1);
  });
});

test("falha de registro após ativação mantém status de publicado e informa aviso", async (t) => {
  mockBuilder(t, {
    reject: (command) => command.method === "set" && command.uri === prefix + "latestpublications",
  });
  const result = await publish();
  assert.equal(result.published, true);
  assert.match(result.error, /Fluxo ativo confirmado, mas houve falha/);
});

test("agente IA com configurações externas pendentes exige publicação nativa sem alterar runtime", async (t) => {
  const { store, commands } = mockBuilder(t);
  store.get(prefix + "working_flow").question.$groundingConfig = { pending: true };
  await assert.rejects(publish(), /mudanças que exigem publicação pelo Builder/);
  assert.ok(commands.every((command) => command.method === "get"));
});

test("compilação mantém ordem de ações, ferramentas locais e destinos por variável", () => {
  const flow = graph();
  flow.question.$localCustomActions = [
    {
      $id: "tool-id",
      $title: "Ferramenta",
      $description: "Descrição",
      type: "SetVariable",
      settings: { variable: "tool", value: "1" },
    },
  ];
  flow.question.$defaultOutput.stateId = "{{context.destination}}";
  const compiled = compiler.compileBuilderFlow({
    flow,
    configuration: {},
    globalActions: {},
    flowId: "flow-id",
  });
  const state = compiled.states[1];
  assert.deepEqual(
    state.inputActions.map((action) => action.type),
    ["SetVariable", "SendMessage"],
  );
  assert.deepEqual(
    state.outputActions.map((action) => action.type),
    ["SendMessage", "TrackEvent"],
  );
  assert.equal(state.outputs[1].stateId, "{{context.destination}}");
  assert.equal(state.localCustomActions[0].id, "tool-id");
  assert.equal(state.localCustomActions[0].description, "Descrição");
});
