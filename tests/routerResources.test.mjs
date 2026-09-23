import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import service from "../server/routerResourceService.cjs";

const sourceKey = "Key c291cmNl";
const targetKey = "Key dGFyZ2V0";

function setupFetch() {
  const stores = new Map([
    [
      sourceKey,
      new Map([
        [
          "router-config",
          {
            type: "text/plain",
            resource: "id={{router.id}};key={{router.key}};phone={{router.number}}",
          },
        ],
        ["menu", { type: "application/json", resource: { title: "Olá" } }],
      ]),
    ],
    [targetKey, new Map([["menu", { type: "application/json", resource: { title: "Antigo" } }]])],
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const store = stores.get(options.headers.Authorization);
    let body;
    if (request.uri.startsWith("/resources?")) {
      body = {
        status: "success",
        resource: { total: store.size, items: [...store.keys()] },
      };
    } else if (request.uri === "/configuration/gateways") {
      body = {
        status: "success",
        resource: {
          "postmaster@wa.gw.msging.net": {
            IsChannelActive: true,
            CountryCode: "55",
            PhoneNumber: "11999998888",
          },
        },
      };
    } else {
      const resourceKey = decodeURIComponent(request.uri.replace("/resources/", ""));
      if (request.method === "get") {
        const item = store.get(resourceKey);
        body = { status: "success", type: item.type, resource: item.resource };
      } else {
        store.set(resourceKey, { type: request.type, resource: request.resource });
        body = { status: "success" };
      }
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return {
    stores,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("audita recursos iguais, diferentes e ausentes por router de destino", async () => {
  const fake = setupFetch();
  try {
    const preview = await service.previewRouterResources({
      sourceShortName: "source",
      sourceRouterKey: sourceKey,
      targets: [{ shortName: "target", key: targetKey }],
    });
    assert.equal(preview.source.resources.length, 2);
    assert.deepEqual(
      Object.fromEntries(preview.targets[0].resources.map((item) => [item.key, item.status])),
      { "router-config": "missing", menu: "different" },
    );
  } finally {
    fake.restore();
  }
});

test("clona recursos, resolve variáveis do destino, cria backup e verifica por leitura", async () => {
  const fake = setupFetch();
  const originalCwd = process.cwd();
  const tmp = await mkdtemp(path.join(os.tmpdir(), "blip-router-resources-"));
  process.chdir(tmp);
  try {
    const result = await service.cloneRouterResources({
      targetShortName: "target",
      targetRouterKey: targetKey,
      resources: [
        {
          key: "router-config",
          type: "text/plain",
          format: "text",
          value: "id={{router.id}};key={{router.key}};phone={{router.number}}",
        },
      ],
    });
    assert.equal(result.copied, 1);
    assert.equal(
      fake.stores.get(targetKey).get("router-config").resource,
      `id=target;key=${targetKey};phone=5511999998888`,
    );
    const backup = JSON.parse(
      await readFile(path.join(tmp, ".local", "router-resource-backups", result.backup), "utf8"),
    );
    assert.equal(backup.resources[0].missing, true);
  } finally {
    fake.restore();
    process.chdir(originalCwd);
    const backupDirectory = path.join(tmp, ".local", "router-resource-backups");
    for (const file of await readdir(backupDirectory))
      await unlink(path.join(backupDirectory, file));
    await rmdir(backupDirectory);
    await rmdir(path.join(tmp, ".local"));
    await rmdir(tmp);
  }
});
