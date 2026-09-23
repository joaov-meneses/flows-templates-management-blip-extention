import assert from "node:assert/strict";
import test from "node:test";
import { cloneBuilderTargetsSequentially } from "../src/lib/builderCloneBatch.ts";

test("clona vários builders de destino e preserva o resultado individual após falha", async () => {
  const targets = ["builder-a", "builder-b", "builder-c"].map((shortName) => ({
    shortName,
    key: `${shortName}-key`,
    keyPreview: "oculta",
  }));
  const called = [];
  const progress = [];
  const results = await cloneBuilderTargetsSequentially(
    targets,
    async (target) => {
      called.push(target.shortName);
      if (target.shortName === "builder-b") throw new Error("Falha no destino B");
      return { totals: { requested: 1, succeeded: 1, partial: 0, failed: 0 }, steps: [] };
    },
    (items) => progress.push(items),
  );

  assert.deepEqual(called, ["builder-a", "builder-b", "builder-c"]);
  assert.deepEqual(
    progress.map((items) => items.length),
    [1, 2, 3],
  );
  assert.equal(results[0].response?.totals.succeeded, 1);
  assert.equal(results[1].error, "Falha no destino B");
  assert.equal(results[2].response?.totals.succeeded, 1);
});
