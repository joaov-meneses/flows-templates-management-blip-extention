import assert from "node:assert/strict";
import test from "node:test";
import {
  getBotPeople,
  summarizeBotAccess,
  loadBotAccess,
  loadBotMetadata,
} from "../src/lib/botDetails.ts";

test("metadata preserves reported owner and rejects another bot", async () => {
  const data = {
    shortName: "bot1",
    emailOwner: "owner@example.test",
    created: "2026-01-01",
    custom: { flag: true },
  };
  assert.deepEqual(
    await loadBotMetadata("bot1", async (uri) => {
      assert.equal(uri, "/applications/bot1@msging.net");
      return { status: "success", resource: data };
    }),
    data,
  );
  await assert.rejects(
    loadBotMetadata("bot1", async () => ({ resource: { shortName: "other" } })),
    /outro bot/,
  );
});

test("all permission pages are read and grouped by user", async () => {
  const uris = [];
  const entries = Array.from({ length: 102 }, (_, i) => ({
    userIdentity: i % 2 ? "a@example.test" : "b@example.test",
    permissionId: `area${i}`,
    actions: ["read"],
  }));
  const people = await loadBotAccess("bot1", async (uri) => {
    uris.push(uri);
    const skip = Number(new URL(uri, "https://example.test").searchParams.get("$skip"));
    return { status: "success", resource: { total: 102, items: entries.slice(skip, skip + 100) } };
  });
  assert.equal(uris.length, 2);
  assert.match(uris[1], /\$skip=100/);
  assert.equal(people.length, 2);
  assert.equal(people[0].identity, "a@example.test");
  assert.equal(people[0].permissions.length, 51);
});

test("denied access never becomes an empty team", async () => {
  await assert.rejects(
    loadBotAccess("bot1", async () => ({ status: "failure", reason: { code: 66 } })),
    /não tem permissão/,
  );
  assert.deepEqual(
    await loadBotAccess("bot1", async () => ({ resource: { total: 0, items: [] } })),
    [],
  );
});

test("incomplete and repeated pages do not claim a complete team", async () => {
  await assert.rejects(
    loadBotAccess("bot1", async () => ({ resource: { total: 2, items: [] } })),
    /incompleta/,
  );
  await assert.rejects(
    loadBotAccess("bot1", async () => ({
      resource: {
        total: 3,
        items: [{ userIdentity: "a", permissionId: "builder", actions: ["read"] }],
      },
    })),
    /incompleta/,
  );
  await assert.rejects(
    loadBotAccess("bot1", async () => ({ resource: { items: [] } })),
    /lista completa/,
  );
});

test("access labels distinguish team administration, reading, editing and mixed permissions", () => {
  const person = (permissions, roleId) => ({ identity: "user@example.test", permissions, roleId });
  assert.equal(summarizeBotAccess(person([{ area: "team", actions: ["read", "write"] }])), "Admin");
  assert.equal(
    summarizeBotAccess(
      person([
        { area: "builder", actions: ["read"] },
        { area: "channels", actions: ["read"] },
      ]),
    ),
    "Leitura",
  );
  assert.equal(
    summarizeBotAccess(person([{ area: "builder", actions: ["write", "read"] }])),
    "Editor",
  );
  assert.equal(
    summarizeBotAccess(
      person([
        { area: "builder", actions: ["read", "write"] },
        { area: "channels", actions: ["read"] },
      ]),
    ),
    "Personalizado",
  );
  assert.equal(summarizeBotAccess(person([], "admin")), "Admin");
  assert.equal(summarizeBotAccess(person([])), "Personalizado");
});

test("owner remains visible without team access and is deduplicated against an encoded Portal identity", () => {
  assert.deepEqual(getBotPeople(null, "owner@example.test"), [
    { identity: "owner@example.test", isOwner: true },
  ]);
  const people = getBotPeople(
    [
      {
        identity: "Owner%40example.test@blip.ai",
        permissions: [{ area: "builder", actions: ["read"] }],
      },
      {
        identity: "reader%40example.test@blip.ai",
        permissions: [{ area: "builder", actions: ["read"] }],
      },
    ],
    "owner@example.test",
  );
  assert.equal(people.length, 2);
  assert.equal(people[0].isOwner, true);
  assert.equal(people[1].identity, "reader@example.test");
  assert.equal(people[1].role, "Leitura");
  assert.deepEqual(getBotPeople(null, ""), []);
});
