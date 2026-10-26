import assert from "node:assert/strict";
import test from "node:test";
import { postJson, postJsonWithProgress } from "../src/lib/api.ts";
import {
  clearActivityLog,
  getActivityEntries,
  sanitizeActivityValue,
  setActivityView,
} from "../src/lib/activityLog.ts";

test("registra corpos completos da requisição/resposta em memória, com credenciais ocultas", async (t) => {
  clearActivityLog();
  setActivityView("templates");
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ total: 0, templates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  await postJson("/api/templates/search", { sourceRouterKey: "Key segredo" });
  assert.equal(getActivityEntries().length, 1);
  assert.equal(getActivityEntries()[0].view, "templates");
  assert.equal(getActivityEntries()[0].status, "success");
  assert.equal(getActivityEntries()[0].title, "POST /api/templates/search");
  assert.equal(getActivityEntries()[0].payload.request.body.sourceRouterKey, "[oculto]");
  assert.equal(getActivityEntries()[0].payload.response.status, 200);
  assert.deepEqual(getActivityEntries()[0].payload.response.body, { total: 0, templates: [] });

  clearActivityLog();
  assert.deepEqual(getActivityEntries(), []);
});

test("mantém texto, listas, objetos extensos e profundos sem truncar", async (t) => {
  clearActivityLog();
  const result = {
    total: 80,
    templates: Array.from({ length: 80 }, (_, i) => ({ id: i, text: "a".repeat(3000) })),
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(result));
  await postJson("/api/templates/search", { query: "teste" });
  assert.deepEqual(getActivityEntries()[0].payload.response.body, result);
  const deep = { a: { b: { c: { d: { e: { f: { g: "x".repeat(5000) } } } } } } };
  assert.deepEqual(sanitizeActivityValue(deep), deep);
  const large = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, i]));
  assert.deepEqual(sanitizeActivityValue(large), large);
});

test("falhas preservam corpo HTTP inclusive HTML e request enviado", async (t) => {
  clearActivityLog();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
  );
  await assert.rejects(postJson("/api/flows/search", { query: "x" }));
  const entry = getActivityEntries()[0];
  assert.equal(entry.status, "error");
  assert.equal(entry.payload.response.status, 502);
  assert.equal(entry.payload.response.body, "<html>Bad Gateway</html>");
  assert.equal(entry.payload.request.body.query, "x");
});

test("falha de rede mantém corpo e erro", async (t) => {
  clearActivityLog();
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(postJson("/api/flows/create", { name: "novo" }));
  const payload = getActivityEntries()[0].payload;
  assert.equal(payload.request.body.name, "novo");
  assert.equal(payload.response, undefined);
  assert.match(payload.error.message, /conexão/i);
});

test("stream preserva progresso e erro do servidor", async (t) => {
  clearActivityLog();
  const events = [
    { kind: "progress", processed: 1, total: 2, stage: "Copiando" },
    { kind: "error", message: "Falha de teste", context: { bot: "teste" } },
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n"),
  );
  await assert.rejects(
    postJsonWithProgress("/api/flows/replicate/progress", { ids: [1, 2] }, () => {}),
    /Falha de teste/,
  );
  assert.deepEqual(getActivityEntries()[0].payload.response.body, events);
});

test("oculta credenciais em strings JSON e trata ciclos", () => {
  assert.equal(
    sanitizeActivityValue(JSON.stringify({ builderKey: "segredo", message: "teste" })),
    JSON.stringify({ builderKey: "[oculto]", message: "teste" }),
  );
  const cycle = {};
  cycle.self = cycle;
  assert.equal(sanitizeActivityValue(cycle).self, "[referência circular]");
});

test("oculta credenciais nos resultados exibidos em Logs", () => {
  assert.deepEqual(
    sanitizeActivityValue({
      accessKey: "segredo",
      nested: { routerKey: "Key c2VncmVkbw==", status: "success" },
    }),
    { accessKey: "[oculto]", nested: { routerKey: "[oculto]", status: "success" } },
  );
});
