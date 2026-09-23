import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPortalCreateShortName,
  buildBulkBotNamePlan,
  derivePortalShortName,
  extractEnvironmentTag,
  replaceEnvironmentName,
  replaceEnvironmentShortName,
  suggestTargetEnvironmentTag,
  validateBulkTargetShortName,
} from "../src/lib/bulkBotCreation.ts";

test("deriva o ID como o Portal e mantém o shortName provisório fora da interface", () => {
  assert.equal(derivePortalShortName("[VERIFYID] Auto ID 0923"), "verifyidautoid0923");
  assert.equal(derivePortalShortName("[HMG] Finalização"), "hmgfinalizacao");
  assert.equal(buildPortalCreateShortName("  [PRD] Menu Ajuda  "), "[prd] menu ajuda");
});

test("detecta e troca tags DEV/PRD no nome e no ID", () => {
  assert.equal(extractEnvironmentTag("[DEV] Captação"), "DEV");
  assert.equal(replaceEnvironmentName("[DEV] Captação", "prd"), "[PRD] Captação");
  assert.equal(
    replaceEnvironmentShortName("devcaptacao25", "[DEV] Captação", "PRD"),
    "prdcaptacao25",
  );
  assert.deepEqual(
    buildBulkBotNamePlan({ shortName: "prdmenuajuda", name: "[PRD] Menu ajuda" }, "DEV"),
    {
      sourceShortName: "prdmenuajuda",
      sourceName: "[PRD] Menu ajuda",
      sourceTag: "PRD",
      targetShortName: "devmenuajuda",
      targetName: "[DEV] Menu ajuda",
    },
  );
});

test("prefixa nomes sem tag e sugere o ambiente oposto", () => {
  assert.equal(replaceEnvironmentName("Finalização", "HMG"), "[HMG] Finalização");
  assert.equal(replaceEnvironmentShortName("finalizacao", "Finalização", "HMG"), "hmgfinalizacao");
  assert.equal(replaceEnvironmentName("[VIVO] Finalização", "PRD"), "[PRD] [VIVO] Finalização");
  assert.equal(replaceEnvironmentShortName("devops", "DevOps", "PRD"), "prddevops");
  assert.equal(suggestTargetEnvironmentTag(["[DEV] A", "[DEV] B", "Sem tag"]), "PRD");
  assert.equal(suggestTargetEnvironmentTag(["[PRD] A"]), "DEV");
});

test("valida IDs gerados antes de criar bots", () => {
  assert.equal(validateBulkTargetShortName("prdcaptacao25"), "");
  assert.match(validateBulkTargetShortName("[prd] captação"), /2 a 60/);
  assert.match(validateBulkTargetShortName("1bot"), /letra minúscula/);
});
