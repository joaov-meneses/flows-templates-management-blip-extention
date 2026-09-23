import assert from "node:assert/strict";
import test from "node:test";
import service from "../server/pluginService.cjs";

test("router sem bucket de plugins é tratado como lista vazia", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      Response.json({
        status: "failure",
        reason: { code: 67, description: "Resource not found" },
      }),
  );

  const result = await service.searchPlugins({ sourceRouterKey: "Key c291cmNl" });

  assert.equal(result.total, 0);
  assert.deepEqual(result.plugins, []);
});
