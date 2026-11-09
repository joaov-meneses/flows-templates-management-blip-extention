import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import bulk from "../server/deskBulkService.cjs";
import desk from "../server/deskQueueService.cjs";

const bot = "bulk-test";
const access = {
  builderShortName: bot,
  builderKey: `Key ${Buffer.from(`${bot}:test-secret`).toString("base64")}`,
  tenantId: "test",
};
const now = Date.now();
const ago = (hours) => new Date(now - hours * 3600000).toISOString();
const queues = ["A", "B"].map((name) => ({
  id: `queue-${name}`,
  uniqueId: `queue-${name}`,
  name: `Fila ${name}`,
  ownerIdentity: `${bot}@msging.net`,
}));
const ticket = (id, values = {}) => ({
  id,
  sequentialId: Number(id.replace(/\D/g, "")) || 1,
  ownerIdentity: `${bot}@msging.net`,
  team: "Fila A",
  agentIdentity: "pessoa%40example.com@blip.ai",
  status: "Open",
  storageDate: ago(48),
  closed: false,
  tags: ["Existente"],
  ...values,
});
const message = (id, hours, values = {}) => ({
  id,
  direction: "received",
  type: "text/plain",
  date: ago(hours),
  ...values,
});
function fake(t, options = {}) {
  const state = {
    queues: structuredClone(queues),
    tickets: [ticket("t1")],
    activeTags: ["Administrativo"],
    messages: {},
    writes: [],
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://test.http.msging.net/commands");
    assert.equal(init.headers.Authorization, access.builderKey);
    const c = JSON.parse(init.body);
    assert.equal(c.to, "postmaster@desk.msging.net");
    calls.push(c);
    const intercepted = await options.before?.(c, state);
    if (intercepted) return intercepted;
    const [path, query = ""] = c.uri.split("?");
    const qs = new URLSearchParams(query);
    let resource;
    const slice = (items) => {
      const page = items.slice(
        Number(qs.get("$skip") || 0),
        Number(qs.get("$skip") || 0) + Number(qs.get("$take") || 100),
      );
      return { total: options.pageTotals ? page.length : items.length, items: page };
    };
    if (c.method === "get") {
      if (path === "/attendance-queues") resource = slice(state.queues);
      else if (path === "/tags/active") resource = slice(state.activeTags);
      else if (/^\/attendance-queues\/[^/]+\/tags$/.test(path)) resource = slice([]);
      else if (path === "/tickets") {
        let items = state.tickets.filter((t) => !t.closed);
        const filter = qs.get("$filter") || "";
        const team = filter.match(/team eq '([^']+)'/)?.[1];
        const status = filter.match(/status eq '([^']+)'/)?.[1];
        if (!options.ignoreServerFilter)
          items = items.filter(
            (t) => (!team || t.team === team) && (!status || t.status === status),
          );
        resource = slice(items);
      } else if (path.startsWith("/ticket/"))
        resource = state.tickets.find((t) => t.id === decodeURIComponent(path.split("/").at(-1)));
      else if (/^\/tickets\/[^/]+\/messages$/.test(path)) {
        const id = decodeURIComponent(path.split("/")[2]);
        assert.equal(qs.get("$ascending"), "false");
        assert.equal(qs.get("getFromOwnerIfTunnel"), "true");
        resource = slice(
          [...(state.messages[id] || [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
        );
      } else assert.fail(`GET inesperado ${c.uri}`);
    } else {
      assert.equal(c.method, "set");
      assert.equal(path, "/tickets/change-status");
      assert.equal(c.resource.status, "ClosedClient");
      assert(c.resource.tags.length);
      state.writes.push(c);
      const current = state.tickets.find((t) => t.id === c.resource.id);
      Object.assign(current, { closed: false, status: "ClosedClient", tags: c.resource.tags });
    }
    await options.after?.(c, state);
    return Response.json({
      id: c.id,
      to: `${bot}@msging.net/test`,
      status: "success",
      ...(resource === undefined ? {} : { resource: structuredClone(resource) }),
    });
  });
  return { state, calls };
}
async function done(job) {
  for (let i = 0; i < 200; i++) {
    const value = bulk.bulkStatus({ ...access, jobId: job.jobId });
    if (value.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("A operação não terminou.");
}
async function preview(filters = {}, limit = 100) {
  const job = await done(bulk.startBulkPreview({ ...access, filters, limit }));
  assert.equal(job.status, "ready", job.error);
  return job;
}
async function finalize(review, values = {}) {
  return done(
    bulk.startBulkFinalize({
      ...access,
      previewJobId: review.jobId,
      operationId: randomUUID(),
      ...values,
    }),
  );
}
const denied = (c) =>
  Response.json({
    id: c.id,
    to: `${bot}@msging.net`,
    status: "failure",
    reason: { description: "Sem permissão" },
  });

test("opções e prévia não gravam, não expõem credenciais e retornam tickets ativos", async (t) => {
  const f = fake(t);
  f.state.tickets.push(ticket("closed", { closed: true }), ticket("none", { status: "None" }));
  assert.equal((await bulk.bulkOptions(access)).queues.length, 2);
  const result = await preview();
  assert.equal(result.preview.tickets.length, 1);
  assert.equal(f.state.writes.length, 0);
  assert(!JSON.stringify(result).includes("test-secret"));
  assert(!JSON.stringify(result).includes(access.builderKey));
});
test("filtros combinam fila, situação, ausência de atendente, intervalo e idade", async (t) => {
  const f = fake(t, { ignoreServerFilter: true });
  f.state.tickets = [
    ticket("match", { status: "Waiting", agentIdentity: undefined }),
    ticket("assigned", { status: "Waiting" }),
    ticket("other", { team: "Fila B", status: "Waiting", agentIdentity: "" }),
    ticket("new", { status: "Waiting", agentIdentity: "", storageDate: ago(2) }),
  ];
  const result = await preview({
    queueId: "queue-A",
    status: "Waiting",
    assignment: "unassigned",
    createdFrom: ago(72),
    createdTo: ago(24),
    minimumAgeHours: 24,
  });
  assert.deepEqual(
    result.preview.tickets.map((t) => t.id),
    ["match"],
  );
});
test("paginação de tickets continua quando total é apenas o tamanho da página", async (t) => {
  const f = fake(t, { pageTotals: true });
  f.state.tickets = Array.from({ length: 105 }, (_, i) => ticket(`t${i}`));
  const result = await preview({}, 500);
  assert.equal(result.preview.tickets.length, 105);
  assert(f.calls.some((c) => c.uri.startsWith("/tickets?") && c.uri.includes("$skip=100")));
});
test("última mensagem ignora envios, ticket técnico e digitando", async (t) => {
  const f = fake(t);
  f.state.messages.t1 = [
    message("technical", 1, { type: "application/vnd.iris.ticket+json" }),
    message("typing", 2, { type: "application/vnd.lime.chatstate+json" }),
    message("sent", 3, { direction: "sent" }),
    message("real", 30),
  ];
  const result = await preview({
    minimumInactivityHours: 24,
    lastInputFrom: ago(40),
    lastInputTo: ago(25),
  });
  assert.equal(result.preview.tickets[0].lastInputAt, ago(30));
});
test("histórico percorre páginas sem tratar total da página como fim", async (t) => {
  const f = fake(t, { pageTotals: true });
  f.state.messages.t1 = Array.from({ length: 100 }, (_, i) =>
    message(`s${i}`, i / 100, { direction: "sent" }),
  );
  f.state.messages.t1.push(message("input", 1));
  const result = await preview({ minimumInactivityHours: 0 });
  assert.equal(result.preview.tickets[0].lastInputAt, ago(1));
});
test("histórico inacessível ou sem input verificável exclui o ticket", async (t) => {
  fake(t, {
    before(c) {
      if (c.uri.includes("/messages?")) return denied(c);
    },
  });
  const result = await preview({ lastInputTo: ago(0) });
  assert.equal(result.preview.tickets.length, 0);
  assert.equal(result.preview.excludedHistory, 1);
});
test("datas inválidas, intervalos invertidos, situação encerrada e lote excessivo são rejeitados", (t) => {
  const f = fake(t);
  for (const filters of [
    { createdFrom: "2026-01-01" },
    { createdFrom: ago(1), createdTo: ago(2) },
    { status: "ClosedAttendant" },
    { status: "ClosedClient" },
    { minimumAgeHours: -1 },
    { assignment: "bad" },
    { queueId: 0 },
    { status: false },
    { assignment: false },
  ])
    assert.throws(() => bulk.startBulkPreview({ ...access, filters }));
  assert.throws(() => bulk.startBulkPreview({ ...access, limit: 501 }));
  assert.equal(f.calls.length, 0);
});
test("limite informa que há mais candidatos e restringe o conjunto finalizado", async (t) => {
  const f = fake(t);
  f.state.tickets = Array.from({ length: 5 }, (_, i) => ticket(`t${i}`));
  const review = await preview({}, 2);
  assert.equal(review.preview.tickets.length, 2);
  assert.equal(review.preview.hasMore, true);
  const result = await finalize(review);
  assert.equal(result.result.finalized, 2);
  assert.equal(f.state.writes.length, 2);
});
test("novos tickets não entram no lote já revisado e tags existentes são preservadas", async (t) => {
  const f = fake(t);
  f.state.tickets[0].tags = ["Primeira", "Segunda"];
  const review = await preview();
  f.state.tickets.push(ticket("new"));
  const result = await finalize(review);
  assert.equal(result.result.finalized, 1);
  assert.equal(f.state.tickets[1].closed, false);
  assert.deepEqual(f.state.writes[0].resource.tags, ["Primeira", "Segunda"]);
  const nextReview = await preview();
  assert.deepEqual(nextReview.preview.tickets.map((item) => item.id), ["new"]);
});
test("tickets sem tag exigem escolha, usando-a somente onde necessário", async (t) => {
  const f = fake(t);
  f.state.tickets.push(ticket("t2", { tags: [] }));
  const review = await preview();
  assert.throws(
    () =>
      bulk.startBulkFinalize({ ...access, previewJobId: review.jobId, operationId: randomUUID() }),
    /Selecione uma tag/,
  );
  assert.equal(f.state.writes.length, 0);
  const result = await finalize(review, { finalizationTag: "Administrativo" });
  assert.equal(result.result.finalized, 2);
  assert.deepEqual(f.state.tickets[0].tags, ["Existente"]);
  assert.deepEqual(f.state.tickets[1].tags, ["Administrativo"]);
});
test("transferência ou atribuição posterior à prévia é ignorada", async (t) => {
  const f = fake(t);
  f.state.tickets.push(ticket("t2"));
  const review = await preview();
  f.state.tickets[0].team = "Fila B";
  f.state.tickets[1].agentIdentity = "novo@blip.ai";
  const result = await finalize(review);
  assert.equal(result.result.skipped, 2);
  assert.equal(f.state.writes.length, 0);
});
test("nova mensagem após prévia impede encerramento mesmo dentro do intervalo do filtro", async (t) => {
  const f = fake(t);
  f.state.messages.t1 = [message("old", 10)];
  const review = await preview({ minimumInactivityHours: 0 });
  f.state.messages.t1.unshift(message("new", 1));
  const result = await finalize(review);
  assert.equal(result.result.skipped, 1);
  assert.equal(f.state.writes.length, 0);
});
test("mesma confirmação recupera o mesmo job sem repetir gravações", async (t) => {
  const f = fake(t);
  const review = await preview();
  const input = { ...access, previewJobId: review.jobId, operationId: randomUUID() };
  const first = await done(bulk.startBulkFinalize(input));
  const second = bulk.startBulkFinalize(input);
  assert.equal(second.jobId, first.jobId);
  assert.equal(f.state.writes.length, 1);
  assert.throws(
    () => bulk.startBulkFinalize({ ...input, finalizationTag: "Administrativo" }),
    /outro lote/,
  );
  assert.throws(
    () => bulk.startBulkFinalize({ ...input, operationId: randomUUID() }),
    /nova prévia/,
  );
});
test("situação de um job não é acessível por outra credencial", async (t) => {
  fake(t);
  const job = await preview();
  assert.throws(
    () =>
      bulk.bulkStatus({
        ...access,
        builderKey: `Key ${Buffer.from(`${bot}:different`).toString("base64")}`,
        jobId: job.jobId,
      }),
    /expirou/,
  );
});
test("finalização respeita a trava compartilhada com renomeação de filas", async (t) => {
  fake(t);
  const review = await preview();
  desk._desk.locks.add(`${bot}@msging.net`);
  try {
    assert.throws(
      () =>
        bulk.startBulkFinalize({
          ...access,
          previewJobId: review.jobId,
          operationId: randomUUID(),
        }),
      /Outra alteração/,
    );
  } finally {
    desk._desk.locks.delete(`${bot}@msging.net`);
  }
});
test("cancelar prévia não grava e conclui como cancelada", async (t) => {
  const f = fake(t);
  const job = bulk.startBulkPreview({ ...access });
  bulk.cancelBulk({ ...access, jobId: job.jobId });
  assert.equal((await done(job)).status, "cancelled");
  assert.equal(f.state.writes.length, 0);
});
test("cancelar após um envio reconcilia o atual e deixa os demais intactos", async (t) => {
  let running;
  const f = fake(t, {
    before(c) {
      if (c.method === "set") bulk.cancelBulk({ ...access, jobId: running.jobId });
    },
  });
  f.state.tickets.push(ticket("t2"));
  const review = await preview();
  running = bulk.startBulkFinalize({
    ...access,
    previewJobId: review.jobId,
    operationId: randomUUID(),
  });
  const result = await done(running);
  assert.equal(result.status, "cancelled");
  assert.equal(result.result.finalized, 1);
  assert.equal(result.result.remaining, 1);
  assert.equal(f.state.writes.length, 1);
});
test("resposta perdida é reconciliada sem reenviar fechamento", async (t) => {
  const f = fake(t, {
    after(c) {
      if (c.method === "set") throw new Error("Timeout");
    },
  });
  const result = await finalize(await preview());
  assert.equal(result.result.finalized, 1);
  assert.equal(f.state.writes.length, 1);
});
test("falha definitiva interrompe lote com relatório do restante", async (t) => {
  const f = fake(t, {
    before(c) {
      if (c.method === "set") return denied(c);
    },
  });
  f.state.tickets.push(ticket("t2"));
  const result = await finalize(await preview());
  assert.equal(result.result.failed, 1);
  assert.equal(result.result.remaining, 1);
  assert.equal(f.state.writes.length, 0);
});
test("sem readback após envio relata incerteza e não segue aos próximos", async (t) => {
  let sent = false;
  const f = fake(t, {
    before(c) {
      if (sent && c.uri.startsWith("/ticket/")) throw new Error("Sem leitura");
    },
    after(c) {
      if (c.method === "set") sent = true;
    },
  });
  f.state.tickets.push(ticket("t2"));
  const result = await finalize(await preview());
  assert.equal(result.result.uncertain, 1);
  assert.equal(result.result.remaining, 1);
  assert.equal(f.state.writes.length, 1);
});
test("tag removida do catálogo impede início da finalização", async (t) => {
  const f = fake(t);
  f.state.tickets[0].tags = [];
  const review = await preview();
  f.state.activeTags = [];
  const result = await finalize(review, { finalizationTag: "Administrativo" });
  assert.equal(result.status, "failed");
  assert.equal(result.result.finalized, 0);
  assert.equal(f.state.writes.length, 0);
});

test("prévia expirada não autoriza uma nova finalização", async (t) => {
  const f = fake(t);
  const review = await preview();
  const later = Date.now() + 16 * 60000;
  t.mock.method(Date, "now", () => later);
  assert.throws(
    () =>
      bulk.startBulkFinalize({ ...access, previewJobId: review.jobId, operationId: randomUUID() }),
    /expirou/,
  );
  assert.equal(f.state.writes.length, 0);
});

test("encerramento confirmado com falha de tags não é apresentado como sucesso integral", async (t) => {
  const f = fake(t, {
    after(c, state) {
      if (c.method === "set") state.tickets[0].tags = [];
    },
  });
  const result = await finalize(await preview());
  assert.equal(result.result.finalized, 1);
  assert.equal(result.result.interrupted, true);
  assert.equal(result.result.remaining, 0);
  assert.match(result.result.items[0].message, /tags não foram confirmadas/);
  assert.match(result.progress.stage, /interrompido/);
  assert.equal(f.state.writes.length, 1);
});
