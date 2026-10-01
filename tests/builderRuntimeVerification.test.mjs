import assert from "node:assert/strict";
import test from "node:test";
import verification from "../server/builderRuntimeVerification.cjs";

const application = {
  identifier: "testbot",
  settings: { flow: { id: "flow", states: [{ id: "new" }] } },
};
const resource = (value) => ({ Template: "builder", Application: value });

test("confirma o conteúdo completo com JSON formatado ou objeto, sem depender da ordem das propriedades", async () => {
  for (const value of [
    JSON.stringify({ settings: application.settings, identifier: "testbot" }, null, 2),
    structuredClone(application),
  ]) {
    await verification.confirmBuilderRuntime(async () => resource(value), application);
  }
});

test("verificação só repete leituras e respeita as pausas até aparecer o runtime esperado", async () => {
  const reads = [
    undefined,
    resource("invalid-json"),
    resource({ ...application, identifier: "oldbot" }),
    resource(application),
  ];
  const pauses = [];
  let attempts = 0;
  await verification.confirmBuilderRuntime(async () => reads[attempts++], application, {
    delays: [0, 250, 750, 1500, 3000],
    pause: async (delay) => pauses.push(delay),
  });
  assert.equal(attempts, 4);
  assert.deepEqual(pauses, [250, 750, 1500]);
});

test("runtime diferente ou inválido permanece não confirmado ao esgotar as leituras", async () => {
  for (const observed of [
    undefined,
    resource("invalid-json"),
    { Template: "master", Application: application },
    resource({ ...application, identifier: "otherbot" }),
    resource({ ...application, settings: { flow: { id: "flow", states: [{ id: "old" }] } } }),
  ]) {
    let attempts = 0;
    await assert.rejects(
      verification.confirmBuilderRuntime(
        async () => {
          attempts++;
          return observed;
        },
        application,
        { delays: [0, 0, 0] },
      ),
      /comando pode ter sido aplicado/,
    );
    assert.equal(attempts, 3);
  }
});

test("erro de acesso não é convertido em confirmação nem provoca repetição de comandos", async () => {
  let attempts = 0;
  await assert.rejects(
    verification.confirmBuilderRuntime(async () => {
      attempts++;
      throw new Error("Acesso recusado");
    }, application),
    /Acesso recusado/,
  );
  assert.equal(attempts, 1);
});
