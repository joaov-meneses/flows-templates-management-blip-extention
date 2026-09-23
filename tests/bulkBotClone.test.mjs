import assert from "node:assert/strict";
import test from "node:test";
import service from "../server/botCloneService.cjs";

const sourceKey = "Key c291cmNl";
const targetKey = "Key dGFyZ2V0";

test("criação em massa ativa Builder, copia todos os JSONs e confirma o runtime publicado", async (t) => {
  const sourceBuckets = new Map([
    ["blip_portal:builder_working_flow", { onboarding: { id: "onboarding" } }],
    ["blip_portal:builder_working_configuration", { timezone: "America/Sao_Paulo" }],
    ["blip_portal:builder_working_global_actions", { id: "global-actions" }],
    ["blip_portal:builder_working_flow_id", "flow-source"],
    ["blip_portal:builder_published_flow", { onboarding: { id: "onboarding" } }],
    ["blip_portal:builder_published_configuration", { timezone: "America/Sao_Paulo" }],
    ["blip_portal:builder_published_global_actions", { id: "global-actions" }],
  ]);
  const targetBuckets = new Map();
  const sourceLatestPublications = {
    lastInsertedIndex: 3,
    isMoreOptionsActive: false,
    publications: [
      {
        authorIdentity: "author@example.com",
        author: "Autora de origem",
        publishedAt: "2026-09-23T12:00:00.000Z",
        index: 3,
      },
    ],
  };
  sourceBuckets.set("blip_portal:builder_latestpublications", sourceLatestPublications);
  const runtime = {
    identifier: "source",
    settingsType: "Settings",
    settings: { flow: { states: [{ id: "onboarding" }, { id: "welcome" }] } },
  };
  let targetRuntime;
  let attendanceActivated = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const key = options.headers.Authorization;
    const request = JSON.parse(options.body);
    const owner = key === sourceKey ? "source" : "target";
    let body;
    if (request.uri === "/replies") {
      body = { status: "success", to: `${owner}@msging.net/!server`, resource: { items: [] } };
    } else if (request.uri.startsWith("lime://builder.hosting@msging.net/configuration")) {
      if (request.method === "get") {
        body = {
          status: "success",
          resource: {
            Template: "builder",
            Application: key === sourceKey ? JSON.stringify(runtime) : targetRuntime,
          },
        };
      } else {
        targetRuntime = request.resource.Application;
        body = { status: "success" };
      }
    } else if (request.uri === "lime://postmaster@desk.msging.net/configuration") {
      attendanceActivated = request.resource?.["Lime.IsActive"] === true;
      body = { status: "success" };
    } else if (request.uri.startsWith("/buckets/")) {
      const bucket = decodeURIComponent(request.uri.slice("/buckets/".length));
      const store = key === sourceKey ? sourceBuckets : targetBuckets;
      if (request.method === "get") {
        body = store.has(bucket)
          ? { status: "success", resource: store.get(bucket) }
          : { status: "failure", reason: { code: 67, description: "Resource not found" } };
      } else {
        store.set(bucket, request.resource);
        body = { status: "success" };
      }
    } else {
      throw new Error(`Comando inesperado: ${request.method} ${request.uri}`);
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await service.cloneBot({
    sourceRouterKey: sourceKey,
    targetRouterKey: targetKey,
    options: { flow: true },
    activateBuilder: true,
    publishAfterClone: true,
  });

  assert.equal(result.totals.requested, 3);
  assert.equal(result.totals.succeeded, 3);
  assert.equal(targetBuckets.get("blip_portal:builder_enabled"), "True");
  assert.equal(attendanceActivated, true);
  assert.deepEqual(
    targetBuckets.get("blip_portal:builder_working_global_actions"),
    sourceBuckets.get("blip_portal:builder_working_global_actions"),
  );
  assert.deepEqual(
    targetBuckets.get("blip_portal:builder_published_flow"),
    sourceBuckets.get("blip_portal:builder_published_flow"),
  );
  assert.equal(JSON.parse(targetRuntime).identifier, "target");
  assert.equal(targetBuckets.get("blip_portal:builder_latestpublications").lastInsertedIndex, 1);
  assert.deepEqual(Object.keys(targetBuckets.get("blip_portal:builder_latestpublications:1")), [
    "flow",
    "configuration",
    "globalActions",
  ]);
  assert.equal(
    targetBuckets.get("blip_portal:builder_latestpublications").publications[0].author,
    "Autora de origem",
  );
  assert.equal(result.steps.at(-1).detail.verified, true);
  assert.equal(result.steps.at(-1).detail.publicationIndex, 1);
});
