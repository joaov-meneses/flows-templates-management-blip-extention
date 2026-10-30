import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import service from "../server/deskQueueService.cjs";

const bot = "desk-test";
const key = `Key ${Buffer.from(`${bot}:fake-secret`).toString("base64")}`;
const params = { builderShortName: bot, builderKey: key, tenantId: "test-contract" };
const queue = {
  id: "queue-a",
  uniqueId: "queue-a",
  name: "Fila A",
  ownerIdentity: `${bot}@msging.net`,
  isActive: false,
  Priority: 2,
  attendanceHourId: "horario-a",
  storageDate: "2026-01-01T00:00:00.000Z",
};
const other = { ...queue, id: "queue-b", uniqueId: "queue-b", name: "Fila B" };
const rule = {
  id: "rule-a",
  ownerIdentity: queue.ownerIdentity,
  title: "Regra A",
  team: queue.name,
  queueId: queue.id,
  isActive: true,
  priority: 1,
  conditions: [{ property: "Contact.Extras.fila", relation: "Equals", values: ["valor-original"] }],
  operator: "Or",
  relation: "Contains",
  storageDate: queue.storageDate,
};
const priorityRule = {
  id: "priority-a",
  ownerIdentity: queue.ownerIdentity,
  queueId: queue.id,
  title: "VIP",
  urgency: 3000,
  applyConditions: false,
  conditions: [],
  operator: 0,
  priority: 1,
  isActive: false,
  storageDate: queue.storageDate,
};
const agent = {
  identity: "pessoa%40example.com@blip.ai",
  email: "pessoa@example.com",
  fullName: "Pessoa",
  teams: ["Fila A", "Fila B"],
  agentSlots: 7,
  isEnabled: true,
  status: "Online",
  lastServiceDate: queue.storageDate,
};

function fake(t, options = {}) {
  const state = structuredClone({
    queues: [queue, other],
    rules: [rule, { ...rule, id: "rule-b", queueId: other.id, team: other.name, priority: 2 }],
    priorities: [priorityRule],
    attendants: [agent],
    tags: { "queue-a": [{ id: "tag-a", tag: "vip" }], "queue-b": [] },
    settings: { "Fila A": { IsAutomaticClosed: true, MaxClientMinutesDowntime: "30" } },
  });
  const before = structuredClone(state);
  const calls = [];
  const paths = {
    "/attendance-queues": "queues",
    "/rules": "rules",
    "/priority-rules": "priorities",
    "/attendants": "attendants",
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://test-contract.http.msging.net/commands");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, key);
    const c = JSON.parse(init.body);
    assert.equal(c.to, "postmaster@desk.msging.net");
    calls.push(c);
    const intercepted = await options.before?.(c, state, calls);
    if (intercepted) return intercepted;
    const [pathname, query = ""] = c.uri.split("?");
    const qs = new URLSearchParams(query);
    let resource;
    if (c.method === "get") {
      if (pathname === "/tickets") resource = { items: options.active ? [{ id: "ticket-a" }] : [] };
      else if (pathname.startsWith("/owner-team-configurations/"))
        resource = state.settings[decodeURIComponent(pathname.split("/").at(-1))] || {};
      else {
        const tagId = pathname.match(/^\/attendance-queues\/([^/]+)\/tags$/)?.[1];
        const list = tagId ? state.tags[tagId] || [] : state[paths[pathname]];
        assert(list, `GET inesperado: ${c.uri}`);
        const skip = Number(qs.get("$skip") || 0);
        const take = Number(qs.get("$take") || 100);
        resource = { total: list.length, items: list.slice(skip, skip + take) };
      }
    } else if (c.method === "delete") {
      const name = paths[`/${pathname.split("/")[1]}`];
      assert(name, `DELETE inesperado: ${c.uri}`);
      const id = decodeURIComponent(pathname.split("/").at(-1));
      state[name] = state[name].filter((item) => item.id !== id);
      if (name === "queues") delete state.tags[id];
    } else if (c.method === "set") {
      const tagId = pathname.match(/^\/attendance-queues\/([^/]+)\/tags$/)?.[1];
      if (tagId)
        state.tags[tagId] = c.resource.items.map((item) => ({ id: randomUUID(), ...item }));
      else if (pathname.startsWith("/owner-team-configurations/"))
        state.settings[decodeURIComponent(pathname.split("/").at(-1))] = structuredClone(
          c.resource,
        );
      else {
        const name = paths[pathname];
        assert(name, `SET inesperado: ${c.uri}`);
        const value = structuredClone(c.resource);
        const field = name === "attendants" ? "identity" : "id";
        const existing = state[name].find((item) => item[field] === value[field]);
        if (name === "queues" && !value.id)
          Object.assign(value, { id: randomUUID(), storageDate: new Date().toISOString() });
        if (name === "queues" && !value.uniqueId) value.uniqueId = value.id;
        if (name === "attendants")
          assert(!Object.hasOwn(value, "status"), "não alterar presença para alterar fila");
        if (existing) Object.assign(existing, value);
        else state[name].push(value);
      }
    } else assert.fail(`Método inesperado ${c.method}`);
    await options.after?.(c, state, calls);
    return Response.json({
      id: c.id,
      to: `${bot}@msging.net/test`,
      status: "success",
      ...(resource === undefined ? {} : { resource: structuredClone(resource) }),
    });
  });
  return { state, before, calls, writes: () => calls.filter((c) => c.method !== "get") };
}
const details = (action = "rename") => ({
  ...params,
  queueId: queue.id,
  action,
  name: "Fila Nova",
});
async function prepare(action = "rename") {
  const input = details(action);
  const preview = await service.previewDeskQueue(input);
  return { ...input, revision: preview.revision, operationId: randomUUID() };
}

test("lista completa associa atendentes, regras e priorização sem gravar", async (t) => {
  const f = fake(t);
  for (let i = 0; i < 105; i++)
    f.state.attendants.push({ ...agent, identity: `p${i}%40example.com@blip.ai` });
  const result = await service.searchDeskQueues(params);
  assert.equal(result.total, 2);
  assert.equal(result.queues[0].attendantCount, 106);
  assert.equal(result.queues[0].priorityRuleCount, 1);
  assert(f.calls.some((c) => c.uri.includes("$skip=100")));
  assert.equal(f.writes().length, 0);
});

test("duplicação cria IDs novos, preserva origem, condições, horários, tags e configuração", async (t) => {
  const f = fake(t);
  const input = await prepare("duplicate");
  const result = await service.applyDeskQueue(input);
  assert.equal(result.status, "success", JSON.stringify(result));
  const target = f.state.queues.find((q) => q.name === "Fila Nova");
  assert.notEqual(target.id, queue.id);
  assert.equal(target.attendanceHourId, "horario-a");
  assert.equal(target.isActive, false);
  assert.deepEqual(
    f.state.queues.find((q) => q.id === queue.id),
    queue,
  );
  const copied = f.state.rules.find((r) => r.queueId === target.id);
  assert.notEqual(copied.id, rule.id);
  assert.deepEqual(copied.conditions, rule.conditions);
  assert.equal(copied.priority, 3, "cópias entram após regras existentes");
  assert.deepEqual(f.state.settings["Fila Nova"], f.before.settings["Fila A"]);
  assert.deepEqual(
    f.state.tags[target.id].map((r) => r.tag),
    ["vip"],
  );
  assert.deepEqual(f.state.attendants[0].teams, ["Fila A", "Fila B", "Fila Nova"]);
  assert.equal(f.state.attendants[0].agentSlots, 7);
  assert.equal(f.state.attendants[0].status, "Online");
  assert(!JSON.stringify(result).includes("fake-secret"));
});

test("renomeação remove vínculos antes do nome, preserva identidade da fila e recria regras", async (t) => {
  const f = fake(t, {
    before(c, state) {
      if (c.method === "set" && c.uri === "/attendance-queues") {
        assert(!state.rules.some((r) => r.queueId === queue.id));
        assert(!state.priorities.some((r) => r.queueId === queue.id));
        assert(!state.attendants.some((a) => a.teams.includes(queue.name)));
      }
    },
  });
  const result = await service.applyDeskQueue(await prepare());
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(result.queue.id, queue.id);
  assert.equal(result.queue.uniqueId, queue.uniqueId);
  assert(!f.state.rules.some((r) => r.id === rule.id));
  assert(!f.state.priorities.some((r) => r.id === priorityRule.id));
  assert.deepEqual(f.state.rules.find((r) => r.team === "Fila Nova").conditions, rule.conditions);
  assert.equal(f.state.rules.find((r) => r.team === "Fila Nova").priority, rule.priority);
  assert.deepEqual(f.state.attendants[0].teams, ["Fila B", "Fila Nova"]);
  assert.deepEqual(f.state.tags[queue.id], f.before.tags[queue.id]);
});

test("prévia contém backup completo e nenhuma credencial", async (t) => {
  const f = fake(t);
  const result = await service.previewDeskQueue(details());
  assert.equal(result.counts.tags, 1);
  assert.equal(result.counts.priorityRules, 1);
  assert.deepEqual(result.backup.settings, f.before.settings["Fila A"]);
  assert.equal(result.backup.attendants[0].agentSlots, 7);
  assert(!JSON.stringify(result).includes(key));
  assert.equal(f.writes().length, 0);
});

test("falha ao recriar regra restaura configuração original e não altera a outra fila", async (t) => {
  let failed = false;
  const f = fake(t, {
    before(c) {
      if (c.method === "set" && c.uri === "/rules" && c.resource.id !== rule.id && !failed) {
        failed = true;
        return Response.json({
          id: c.id,
          to: `${bot}@msging.net/test`,
          status: "failure",
          reason: { code: 61, description: "Falha de teste" },
        });
      }
    },
  });
  const result = await service.applyDeskQueue(await prepare());
  assert.equal(result.status, "recovered", JSON.stringify(result));
  assert.deepEqual(
    [...f.state.rules].sort((a, b) => a.id.localeCompare(b.id)),
    [...f.before.rules].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(f.state.attendants[0].teams, agent.teams);
  assert.deepEqual(f.state.queues, f.before.queues);
});

test("resposta perdida após gravação é reconciliada sem repetir o SET", async (t) => {
  let lost = false;
  const f = fake(t, {
    after(c) {
      if (c.uri === "/attendance-queues" && c.method === "set" && !lost) {
        lost = true;
        throw new Error("timeout simulado");
      }
    },
  });
  const result = await service.applyDeskQueue(await prepare("rename"));
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(f.writes().filter((c) => c.uri === "/attendance-queues").length, 1);
});

test("mesma operação confirmada retorna o resultado sem duplicar gravações", async (t) => {
  const f = fake(t);
  const input = await prepare("duplicate");
  const first = await service.applyDeskQueue(input);
  const count = f.writes().length;
  assert.deepEqual(await service.applyDeskQueue(input), first);
  assert.equal(f.writes().length, count);
  await assert.rejects(service.applyDeskQueue({ ...input, name: "Outro Nome" }), /já foi usada/);
});

test("mudança depois da prévia interrompe antes de qualquer gravação", async (t) => {
  const f = fake(t);
  const input = await prepare();
  f.state.attendants[0].agentSlots = 22;
  await assert.rejects(service.applyDeskQueue(input), /mudaram desde a prévia/);
  assert.equal(f.writes().length, 0);
});

test("presença não invalida prévia nem é sobrescrita", async (t) => {
  const f = fake(t);
  const input = await prepare();
  f.state.attendants[0].status = "Pause";
  assert.equal((await service.applyDeskQueue(input)).status, "success");
  assert.equal(f.state.attendants[0].status, "Pause");
});

test("tickets ativos impedem renomeação, mas não a consulta ou prévia de cópia", async (t) => {
  const f = fake(t, { active: true });
  await assert.rejects(service.previewDeskQueue(details()), /atendimentos ativos/);
  await service.previewDeskQueue(details("duplicate"));
  assert.equal(f.writes().length, 0);
});

test("nome repetido, fila reservada e credencial de outro bot são rejeitados", async (t) => {
  const f = fake(t);
  await assert.rejects(service.previewDeskQueue({ ...details(), name: " fila b " }), /Já existe/);
  await assert.rejects(service.previewDeskQueue({ ...details(), name: "Default" }), /reservada/);
  await assert.rejects(
    service.searchDeskQueues({ ...params, builderShortName: "other-bot" }),
    /credencial/,
  );
  assert.equal(f.writes().length, 0);
});

test("erro LIME, resposta sem correlação e lista parcial não são tratados como vazios", async (t) => {
  let mode = "failure";
  const f = fake(t, {
    before(c) {
      if (!c.uri.startsWith("/priority-rules?")) return;
      if (mode === "failure")
        return Response.json({
          id: c.id,
          to: `${bot}@msging.net/test`,
          status: "failure",
          reason: { code: 66, description: "Sem permissão" },
        });
      if (mode === "correlation")
        return Response.json({
          id: "wrong",
          to: `${bot}@msging.net/test`,
          status: "success",
          resource: { items: [] },
        });
      return Response.json({
        id: c.id,
        to: `${bot}@msging.net/test`,
        status: "success",
        resource: { total: 10, items: [] },
      });
    },
  });
  await assert.rejects(service.previewDeskQueue(details()), /Sem permissão/);
  mode = "correlation";
  await assert.rejects(service.previewDeskQueue(details()), /identidade/);
  mode = "partial";
  await assert.rejects(service.previewDeskQueue(details()), /incompleta/);
  assert.equal(f.writes().length, 0);
});

test("falha de recuperação informa atenção e não anuncia restauração", async (t) => {
  let renamed = false;
  const f = fake(t, {
    before(c) {
      if (c.method === "set" && c.uri === "/attendance-queues" && c.resource.name === "Fila Nova")
        renamed = true;
      if (
        renamed &&
        c.method === "set" &&
        ["/rules", "/attendance-queues"].includes(c.uri) &&
        c.resource.name !== "Fila Nova"
      )
        return Response.json({
          id: c.id,
          to: `${bot}@msging.net/test`,
          status: "failure",
          reason: { description: "Falha persistente" },
        });
    },
  });
  const result = await service.applyDeskQueue(await prepare());
  assert.equal(result.status, "attention", JSON.stringify(result));
  assert.equal(result.restored, false);
  assert(f.writes().length > 0);
});

test("criação sem resposta não exclui uma fila cuja autoria não foi confirmada", async (t) => {
  let lost = false;
  const f = fake(t, {
    after(c) {
      if (c.method === "set" && c.uri === "/attendance-queues" && !lost) {
        lost = true;
        throw new Error("resposta perdida na criação");
      }
    },
  });
  const result = await service.applyDeskQueue(await prepare("duplicate"));
  assert.equal(result.status, "attention");
  assert.equal(f.state.queues.filter((q) => q.name === "Fila Nova").length, 1);
  assert.equal(f.writes().filter((c) => c.method === "delete").length, 0);
  assert.deepEqual(f.state.attendants, f.before.attendants);
});

test("nome com vínculos órfãos não é incorporado à nova fila", async (t) => {
  const f = fake(t);
  f.state.attendants[0].teams.push("Fila Nova");
  await assert.rejects(service.previewDeskQueue(details("duplicate")), /vínculos antigos/);
  assert.equal(f.writes().length, 0);
});

test("uma regra alterada por outra sessão não é apagada nem sobrescrita na recuperação", async (t) => {
  let changed = false;
  const f = fake(t, {
    before(c, state) {
      if (
        !changed &&
        c.method === "get" &&
        c.uri.startsWith("/rules?") &&
        state.queues[0].name === "Fila Nova"
      ) {
        changed = true;
        state.rules.push({ ...rule, title: "Alteração externa" });
        return Response.json({
          id: c.id,
          to: `${bot}@msging.net/test`,
          status: "failure",
          reason: { description: "Falha de leitura" },
        });
      }
    },
  });
  const result = await service.applyDeskQueue(await prepare());
  assert.equal(result.status, "attention");
  assert.equal(f.state.rules.find((r) => r.id === rule.id).title, "Alteração externa");
  assert(result.recoveryErrors.some((m) => m.includes("outra sessão")));
});
