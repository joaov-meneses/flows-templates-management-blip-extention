import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { themeBootstrap } from "../src/lib/theme.ts";
import { postJson } from "../src/lib/api.ts";

for (const { saved, systemDark, blocked, expected } of [
  { saved: "light", systemDark: true, expected: "light" },
  { saved: "dark", systemDark: false, expected: "dark" },
  { saved: null, systemDark: true, expected: "dark" },
  { saved: "invalid", systemDark: false, expected: "light" },
  { blocked: true, systemDark: true, expected: "dark" },
]) {
  test(`theme before hydration: ${JSON.stringify({ saved, systemDark, blocked })}`, () => {
    const root = { dataset: {}, style: {} };
    let writes = 0;
    vm.runInNewContext(themeBootstrap, {
      document: { documentElement: root },
      localStorage: {
        getItem() {
          if (blocked) throw new Error("SecurityError");
          return saved;
        },
        setItem() {
          writes++;
        },
      },
      window: { matchMedia: () => ({ matches: systemDark }) },
    });
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
    assert.equal(writes, 0, "reading the preference must not overwrite it during hydration");
  });
}

test("transport preserves JSON success", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ total: 0, flows: [] }));
  assert.deepEqual(await postJson("/api/flows/search", {}), { total: 0, flows: [] });
});
test("HTML proxy errors are readable", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
  );
  await assert.rejects(postJson("/api/flows/search", {}), /temporariamente indisponível/);
});
test("invalid successful responses cannot crash the collection", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>login</html>"));
  await assert.rejects(postJson("/api/flows/search", {}), /resposta inesperada/);
});
test("network failures do not encourage repeating an unconfirmed mutation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(postJson("/api/flows/create", {}), /conferir o resultado antes de repetir/);
});
test("permission failures provide a recovery path", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 403 }));
  await assert.rejects(postJson("/api/flows/search", {}), /Confira o acesso ao router/);
});
test("missing collections return feedback rather than crashing React", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ total: 1 }));
  await assert.rejects(
    postJson("/api/flows/search", {}),
    /lista recebida do servidor está incompleta/,
  );
});
