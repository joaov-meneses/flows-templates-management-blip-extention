import assert from "node:assert/strict";
import test from "node:test";
import authors from "../server/publicationAuthor.cjs";
import publication from "../server/builderPublicationService.cjs";
import inactivity from "../server/inactivityService.cjs";
import clones from "../server/botCloneService.cjs";

test("histórico usa o e-mail em autor e identidade, removendo apenas espaços externos", () => {
  assert.deepEqual(authors.requirePublicationAuthor(" Publisher@example.com "), {
    author: "Publisher@example.com",
    authorIdentity: "Publisher@example.com",
  });
});

test("e-mail ausente ou inválido bloqueia qualquer alteração nas três formas de publicação", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Não deve enviar comandos");
  });
  for (const publicationAuthor of [
    undefined,
    "",
    "Templates/Flows Manager",
    "test@example.com\nforged",
    "a".repeat(255) + "@example.com",
  ]) {
    const mass = () =>
      publication.publishBuilderDraft({
        builderShortName: "testbot",
        builderKey: `Key ${Buffer.from("testbot:secret").toString("base64")}`,
        publicationAuthor,
      });
    const save = () =>
      inactivity.applyInactivity({
        builderKey: "Key test-only",
        revision: "reviewed",
        minutes: 10,
        blockKeys: ["eligible"],
        publishAfterSave: true,
        publicationAuthor,
      });
    const clone = () =>
      clones.cloneBot({
        sourceRouterKey: "Key source",
        targetRouterKey: "Key target",
        options: { flow: true },
        activateBuilder: true,
        publishAfterClone: true,
        publicationAuthor,
      });
    for (const run of [mass, save, clone])
      await assert.rejects(
        run(),
        (error) => error.statusCode === 400 && /e-mail do usuário logado/.test(error.message),
      );
  }
  assert.equal(calls, 0);
});
