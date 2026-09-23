import assert from "node:assert/strict";
import test from "node:test";
import { postJson } from "../src/lib/api.ts";
import {
  clearActivityLog,
  getActivityEntries,
  sanitizeActivityValue,
  setActivityView,
} from "../src/lib/activityLog.ts";

test("registra requisições da área ativa somente em memória, sem corpo ou credenciais", async (t) => {
  clearActivityLog();
  setActivityView("templates");
  t.mock.method(globalThis, "fetch", async () =>
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
  assert.equal(getActivityEntries()[0].payload, undefined);

  clearActivityLog();
  assert.deepEqual(getActivityEntries(), []);
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
