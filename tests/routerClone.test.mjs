import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import service from "../server/routerCloneService.cjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceKey = "Key c291cmNl";
const targetKey = "Key dGFyZ2V0";

function makeApplication(identifier, children, extra) {
  return JSON.stringify({
    identifier,
    messageReceivers: [],
    notificationReceivers: [],
    settingsType: "MasterSettings",
    settings: { children },
    extra,
  });
}

function setupFetch() {
  const sourceChild = {
    identity: "first@msging.net",
    shortName: "first",
    longName: "Primeiro",
    isDefault: true,
    $id: 0,
  };
  const sourceExtra = {
    identity: "second@msging.net",
    shortName: "second",
    longName: "Segundo",
    isDefault: false,
    $id: 1,
  };
  let targetApplication = makeApplication(
    "target",
    [{ identity: "old@msging.net", isDefault: true }],
    "old",
  );
  const sourceApplication = makeApplication("source", [sourceChild, sourceExtra], "source");
  const writes = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const key = options.headers.Authorization;
    let body;
    if (request.method === "get") {
      body = {
        status: "success",
        resource: {
          Template: "master",
          Application: key === sourceKey ? sourceApplication : targetApplication,
        },
      };
    } else {
      writes.push({ key, request });
      targetApplication = request.resource.Application;
      body = { status: "success" };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return {
    sourceApplication,
    getTargetApplication: () => targetApplication,
    writes,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("prévia e clonagem do router preservam o ID do destino, conectam serviços e verificam por nova leitura", async () => {
  const fake = setupFetch();
  const originalCwd = process.cwd();
  const tmp = await mkdtemp(path.join(os.tmpdir(), "blip-router-clone-"));
  process.chdir(tmp);
  try {
    const preview = await service.previewRouterClone({
      sourceShortName: "source",
      targetShortName: "target",
      sourceRouterKey: sourceKey,
      targetRouterKey: targetKey,
    });
    assert.equal(preview.compatible, true);
    assert.equal(preview.source.services.length, 2);
    const result = await service.cloneRouter({
      sourceShortName: "source",
      targetShortName: "target",
      sourceRouterKey: sourceKey,
      targetRouterKey: targetKey,
      sourceHash: preview.source.applicationHash,
      targetHash: preview.target.applicationHash,
      selectedServiceIdentities: preview.source.services.map((item) => item.identity),
    });
    assert.equal(result.status, "success");
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.writes[0].request.to, "postmaster@msging.net");
    assert.equal(
      fake.writes[0].request.uri,
      "lime://master.hosting@msging.net/configuration?caller=target@msging.net",
    );
    const cloned = JSON.parse(fake.getTargetApplication());
    assert.equal(cloned.identifier, "target");
    assert.equal(cloned.extra, "source");
    assert.deepEqual(
      cloned.settings.children.map((child) => child.identity),
      ["first@msging.net", "second@msging.net"],
    );
    const backup = JSON.parse(
      await readFile(path.join(tmp, ".local", "router-clone-backups", result.backup), "utf8"),
    );
    assert.equal(JSON.parse(backup.resource.Application).identifier, "target");
  } finally {
    fake.restore();
    process.chdir(originalCwd);
    const backupDirectory = path.join(tmp, ".local", "router-clone-backups");
    for (const file of await readdir(backupDirectory))
      await unlink(path.join(backupDirectory, file));
    await rmdir(backupDirectory);
    await rmdir(path.join(tmp, ".local"));
    await rmdir(tmp);
  }
});

test("configuração alterada depois da prévia bloqueia a gravação", async () => {
  const fake = setupFetch();
  try {
    const preview = await service.previewRouterClone({
      sourceShortName: "source",
      targetShortName: "target",
      sourceRouterKey: sourceKey,
      targetRouterKey: targetKey,
    });
    await assert.rejects(
      service.cloneRouter({
        sourceShortName: "source",
        targetShortName: "target",
        sourceRouterKey: sourceKey,
        targetRouterKey: targetKey,
        sourceHash: hash("configuração antiga"),
        targetHash: preview.target.applicationHash,
        selectedServiceIdentities: ["first@msging.net"],
      }),
      /mudou desde a prévia/,
    );
    assert.equal(fake.writes.length, 0);
  } finally {
    fake.restore();
  }
});

test("router sem Application identifica a chave válida e bloqueia a clonagem com diagnóstico específico", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const body =
      request.uri === "/account"
        ? {
            status: "success",
            resource: { identity: "source@msging.net", extras: { template: "master" } },
          }
        : {
            status: "failure",
            reason: { code: 67, description: "The requested resource was not found" },
          };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    await assert.rejects(
      service.readRouterConfiguration(sourceKey, "source"),
      /Router source: a chave é válida, mas a Blip retornou código 67/,
    );
    assert.deepEqual(
      requests.map(({ method, uri }) => [method, uri]),
      [
        ["get", "lime://master.hosting@msging.net/configuration"],
        ["get", "lime://business.master.hosting@msging.net/configuration"],
        ["get", "lime://enterprise.master.hosting@msging.net/configuration"],
        ["get", "/account"],
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prévia encontra Application no host enterprise após código 67 nos hosts anteriores", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUris = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requestedUris.push(request.uri);
    const body = request.uri.startsWith("lime://enterprise.master.hosting@")
      ? {
          status: "success",
          resource: {
            Template: "master",
            Application: makeApplication("source", [
              { identity: "child@msging.net", isDefault: true },
            ]),
          },
        }
      : { status: "failure", reason: { code: 67, description: "Not found" } };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const config = await service.readRouterConfiguration(sourceKey, "source");
    assert.equal(config.host, "enterprise.master.hosting");
    assert.equal(config.services.length, 1);
    assert.deepEqual(requestedUris, [
      "lime://master.hosting@msging.net/configuration",
      "lime://business.master.hosting@msging.net/configuration",
      "lime://enterprise.master.hosting@msging.net/configuration",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
