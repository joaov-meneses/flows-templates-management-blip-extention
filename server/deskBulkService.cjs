const { randomUUID } = require("node:crypto");
const { _desk, DeskInputError } = require("./deskQueueService.cjs");
const {
  context,
  command,
  all,
  revision,
  locks,
  checkTicket,
  ticketTags,
  activeTagName,
  closeTicketChecked,
  readActiveTickets,
} = _desk;

const jobs = new Map();
const operations = new Map();
const TTL = 15 * 60 * 1000;
const LIVE = new Set(["Waiting", "Open", "Assigned"]);
const owner = (ctx) => revision({ identity: ctx.identity, url: ctx.url, key: ctx.key });
const failure = (message, status = 400) => new DeskInputError(message, status);
const iso = (value) => new Date(value).toISOString();

function date(value, label) {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw failure(`Informe uma data e hora válidas para ${label}, com fuso horário.`);
  return iso(value);
}
function hours(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 87600)
    throw failure(`Informe um número entre 0 e 87600 para ${label}.`);
  return value;
}
function filters(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw failure("Confira os filtros.");
  const result = {
    queueId: input.queueId == null || input.queueId === "" ? null : input.queueId,
    status: input.status ?? "active",
    assignment: input.assignment ?? "any",
    createdFrom: date(input.createdFrom, "a criação inicial"),
    createdTo: date(input.createdTo, "a criação final"),
    minimumAgeHours: hours(input.minimumAgeHours, "a idade mínima"),
    lastInputFrom: date(input.lastInputFrom, "a última mensagem inicial"),
    lastInputTo: date(input.lastInputTo, "a última mensagem final"),
    minimumInactivityHours: hours(input.minimumInactivityHours, "o tempo sem mensagem do cliente"),
  };
  if (result.queueId != null && typeof result.queueId !== "string")
    throw failure("Escolha uma fila válida.");
  if (!["active", ...LIVE].includes(result.status))
    throw failure("Escolha uma situação ativa de atendimento.");
  if (!["any", "assigned", "unassigned"].includes(result.assignment))
    throw failure("Confira o filtro de atendente.");
  for (const [from, to] of [
    [result.createdFrom, result.createdTo],
    [result.lastInputFrom, result.lastInputTo],
  ])
    if (from && to && from > to) throw failure("A data inicial deve ser anterior à data final.");
  return result;
}
const usesHistory = (f) =>
  Boolean(f.lastInputFrom || f.lastInputTo || f.minimumInactivityHours != null);
const assigned = (t) => typeof t.agentIdentity === "string" && Boolean(t.agentIdentity.trim());
function basicMatch(t, f, queue, at) {
  const created = Date.parse(t.storageDate);
  if (!Number.isFinite(created) || t.closed || !LIVE.has(t.status) || created > at) return false;
  if (queue && t.team !== queue.name) return false;
  if (f.status !== "active" && t.status !== f.status) return false;
  if (f.assignment === "assigned" && !assigned(t)) return false;
  if (f.assignment === "unassigned" && assigned(t)) return false;
  if (f.createdFrom && created < Date.parse(f.createdFrom)) return false;
  if (f.createdTo && created > Date.parse(f.createdTo)) return false;
  return f.minimumAgeHours == null || at - created >= f.minimumAgeHours * 3600000;
}
function historyMatch(value, f, at) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return (
    (!f.lastInputFrom || timestamp >= Date.parse(f.lastInputFrom)) &&
    (!f.lastInputTo || timestamp <= Date.parse(f.lastInputTo)) &&
    (f.minimumInactivityHours == null || at - timestamp >= f.minimumInactivityHours * 3600000)
  );
}
const INTERNAL_TYPES = new Set([
  "application/vnd.lime.chatstate+json",
  "application/vnd.lime.receipt+json",
  "application/vnd.lime.notification+json",
  "application/vnd.lime.redirect+json",
]);
async function lastCustomerInput(ctx, ticket, cancelled = () => {}) {
  const seen = new Set();
  let previousDate = Infinity;
  for (let page = 0; page < 20; page++) {
    cancelled();
    const resource = await command(
      ctx,
      "get",
      `/tickets/${encodeURIComponent(ticket.id)}/messages?$take=100&$skip=${page * 100}&$ascending=false&getFromOwnerIfTunnel=true`,
    );
    if (!Array.isArray(resource?.items)) throw new Error("Histórico não disponível.");
    for (const message of resource.items) {
      const time = Date.parse(message.date);
      if (!message.id || seen.has(message.id) || !Number.isFinite(time) || time > previousDate)
        throw new Error("A ordenação ou paginação do histórico não foi confirmada.");
      seen.add(message.id);
      previousDate = time;
      if (
        message.direction === "received" &&
        typeof message.type === "string" &&
        !message.type.startsWith("application/vnd.iris.") &&
        !INTERNAL_TYPES.has(message.type)
      )
        return iso(time);
    }
    if (resource.items.length < 100) return null;
  }
  throw new Error("Não foi possível localizar a última mensagem com segurança.");
}
async function queueList(ctx) {
  const queues = await all(ctx, "/attendance-queues");
  for (const queue of queues)
    if (
      !queue.id ||
      !queue.uniqueId ||
      typeof queue.name !== "string" ||
      queue.ownerIdentity !== ctx.identity
    )
      throw new Error("O Desk não confirmou as filas deste Builder.");
  return queues;
}
async function tagOptions(ctx, selected, queues) {
  const global = (await all(ctx, "/tags/active", activeTagName)).map(activeTagName);
  const names = new Set(selected.map((t) => t.team));
  for (const queue of queues.filter((q) => names.has(q.name))) {
    const tags = await all(ctx, `/attendance-queues/${encodeURIComponent(queue.uniqueId)}/tags`);
    for (const item of tags) {
      if (typeof item.tag !== "string" || !item.tag.trim())
        throw new Error("Tag de fila inválida.");
      global.push(item.tag);
    }
  }
  return [...new Set(global)].sort();
}
function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.status !== "running" && job.expires < now) jobs.delete(id);
  for (const [key, operation] of operations) if (!jobs.has(operation.jobId)) operations.delete(key);
}
function createJob(ctx, kind) {
  cleanup();
  if (jobs.size >= 200)
    throw failure("Há muitas consultas em andamento. Aguarde e tente novamente.", 409);
  const job = {
    jobId: randomUUID(),
    owner: owner(ctx),
    builderShortName: ctx.bot,
    kind,
    status: "running",
    progress: { stage: "Preparando…", checked: 0, total: 0 },
    expires: Date.now() + TTL,
    cancelRequested: false,
  };
  jobs.set(job.jobId, job);
  return job;
}
function cancelled(job) {
  if (job.cancelRequested) {
    const error = new Error("Operação interrompida pelo usuário.");
    error.cancelled = true;
    throw error;
  }
}
function publicJob(job) {
  return structuredClone({
    jobId: job.jobId,
    builderShortName: job.builderShortName,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    error: job.error,
    preview: job.preview,
    result: job.result,
    expiresAt: iso(job.expires),
  });
}
function findJob(ctx, params) {
  cleanup();
  let id = params.jobId;
  if (params.operationId) id = operations.get(`${owner(ctx)}:${params.operationId}`)?.jobId;
  const job = jobs.get(id);
  if (!job || job.owner !== owner(ctx))
    throw failure(
      "Esta operação expirou ou o serviço reiniciou. Confira o Desk antes de repetir uma finalização.",
      404,
    );
  return job;
}
async function bulkOptions(params) {
  const ctx = context(params);
  return {
    builderShortName: ctx.bot,
    queues: (await queueList(ctx)).map(({ id, name }) => ({ id, name })),
  };
}
function startBulkPreview(params) {
  const ctx = context(params);
  const f = filters(params.filters);
  const limit = params.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw failure("Use um lote entre 1 e 500 atendimentos.");
  const job = createJob(ctx, "preview");
  void (async () => {
    try {
      const at = Date.now();
      const queues = await queueList(ctx);
      const queue = f.queueId ? queues.find((q) => q.id === f.queueId) : null;
      if (f.queueId && !queue)
        throw new Error("A fila escolhida não existe mais. Atualize as filas.");
      job.progress.stage = "Consultando páginas de atendimentos ativos…";
      const createdTo = Math.min(
        at,
        f.createdTo ? Date.parse(f.createdTo) : at,
        f.minimumAgeHours != null ? at - f.minimumAgeHours * 3600000 : at,
      );
      const dateQuery = ` and storageDate le datetimeoffset'${iso(createdTo)}'${f.createdFrom ? ` and storageDate ge datetimeoffset'${f.createdFrom}'` : ""}`;
      const query = `closed eq false${queue ? ` and team eq '${queue.name.replaceAll("'", "''")}'` : ""}${f.status !== "active" ? ` and status eq '${f.status}'` : ""}${dateQuery}`;
      const tickets = await readActiveTickets(ctx, query, () => cancelled(job));
      const candidates = tickets
        .filter((t) => basicMatch(t, f, queue, at))
        .sort(
          (a, b) =>
            Date.parse(a.storageDate) - Date.parse(b.storageDate) || a.id.localeCompare(b.id),
        );
      const selected = [];
      let checked = 0;
      let excludedHistory = 0;
      let moreMatches = false;
      job.progress.total = candidates.length;
      const history = usesHistory(f);
      const maxChecks = history ? Math.min(candidates.length, 1000) : candidates.length;
      for (let offset = 0; offset < maxChecks && selected.length < limit; offset += 3) {
        cancelled(job);
        const batch = candidates.slice(offset, Math.min(offset + 3, maxChecks));
        const results = await Promise.all(
          batch.map(async (ticket) => {
            if (!history) return { ticket, lastInputAt: null };
            try {
              return {
                ticket,
                lastInputAt: await lastCustomerInput(ctx, ticket, () => cancelled(job)),
              };
            } catch (error) {
              if (error.cancelled) throw error;
              return { ticket, unknown: true };
            }
          }),
        );
        for (const result of results) {
          checked++;
          if (result.unknown || (history && !result.lastInputAt)) {
            excludedHistory++;
            continue;
          }
          if (history && !historyMatch(result.lastInputAt, f, at)) continue;
          if (selected.length < limit)
            selected.push({
              ticket: {
                id: result.ticket.id,
                sequentialId: result.ticket.sequentialId,
                ownerIdentity: result.ticket.ownerIdentity,
                team: result.ticket.team,
                status: result.ticket.status,
                storageDate: result.ticket.storageDate,
                agentIdentity: result.ticket.agentIdentity,
                closed: result.ticket.closed,
                tags: ticketTags(result.ticket),
              },
              lastInputAt: result.lastInputAt,
            });
          else moreMatches = true;
        }
        job.progress = {
          stage: history
            ? "Conferindo a última mensagem recebida do cliente…"
            : "Preparando o lote…",
          checked,
          total: candidates.length,
        };
      }
      cancelled(job);
      const finalizationTags = selected.length
        ? await tagOptions(
            ctx,
            selected.map((s) => s.ticket),
            queues,
          )
        : [];
      job.plan = { filters: f, queue, queues, at, selected, finalizationTags };
      job.preview = {
        snapshotAt: iso(at),
        filters: f,
        limit,
        candidateCount: candidates.length,
        checkedCount: checked,
        excludedHistory,
        hasMore: checked < candidates.length || moreMatches,
        historyScanLimited: history && checked >= 1000 && checked < candidates.length,
        finalizationTags,
        untaggedTicketCount: selected.filter((s) => !ticketTags(s.ticket).length).length,
        tickets: selected.map(({ ticket: t, lastInputAt }) => ({
          id: t.id,
          sequentialId: t.sequentialId,
          team: t.team,
          status: t.status,
          hasAttendant: assigned(t),
          createdAt: iso(t.storageDate),
          ageHours: Math.floor((at - Date.parse(t.storageDate)) / 3600000),
          lastInputAt,
          lastInputChecked: history,
          tags: ticketTags(t),
        })),
      };
      job.status = "ready";
      job.expires = Date.now() + TTL;
      job.progress.stage = "Prévia pronta. Nenhum atendimento foi finalizado.";
    } catch (error) {
      job.status = error.cancelled ? "cancelled" : "failed";
      job.error = error.message;
    }
  })();
  return publicJob(job);
}
function startBulkFinalize(params) {
  const ctx = context(params);
  if (typeof params.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(params.operationId))
    throw failure("A confirmação não foi identificada.");
  const tag = params.finalizationTag ?? "";
  if (typeof tag !== "string") throw failure("Selecione uma tag válida.");
  const key = `${owner(ctx)}:${params.operationId}`;
  const fingerprint = revision({ previewJobId: params.previewJobId, finalizationTag: tag });
  const previous = operations.get(key);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw failure("Esta confirmação já foi usada para outro lote.", 409);
    return publicJob(findJob(ctx, { jobId: previous.jobId }));
  }
  const review = findJob(ctx, { jobId: params.previewJobId });
  if (
    review.kind !== "preview" ||
    review.status !== "ready" ||
    review.consumed ||
    !review.plan.selected.length
  )
    throw failure("Prepare uma nova prévia antes de finalizar.", 409);
  if (review.preview.untaggedTicketCount && !tag)
    throw failure("Selecione uma tag para os atendimentos sem tag.");
  if (tag && !review.plan.finalizationTags.includes(tag))
    throw failure("A tag não pertence ao catálogo desta prévia.");
  if (locks.has(ctx.identity))
    throw failure("Outra alteração de atendimento está em andamento neste Builder. Aguarde.", 409);
  const job = createJob(ctx, "finalize");
  operations.set(key, { fingerprint, jobId: job.jobId });
  review.consumed = true;
  locks.add(ctx.identity);
  const plan = review.plan;
  job.result = {
    filters: plan.filters,
    snapshotAt: iso(plan.at),
    finalizationTag: tag,
    interrupted: false,
    finalized: 0,
    skipped: 0,
    failed: 0,
    uncertain: 0,
    remaining: plan.selected.length,
    items: [],
  };
  job.progress.total = plan.selected.length;
  void (async () => {
    try {
      if (tag) {
        const latestTags = await tagOptions(
          ctx,
          plan.selected.map((s) => s.ticket),
          await queueList(ctx),
        );
        if (!latestTags.includes(tag))
          throw new Error("A tag escolhida não está mais ativa. Prepare uma nova prévia.");
      }
      for (const reviewed of plan.selected) {
        cancelled(job);
        const before = reviewed.ticket;
        job.progress.stage = "Conferindo e finalizando o lote confirmado…";
        const item = { id: before.id, sequentialId: before.sequentialId, team: before.team };
        let stop = false;
        try {
          const current = checkTicket(
            ctx,
            await command(ctx, "get", `/ticket/${encodeURIComponent(before.id)}`),
            before.id,
          );
          if (
            current.team !== before.team ||
            current.status !== before.status ||
            (current.agentIdentity || "") !== (before.agentIdentity || "") ||
            current.storageDate !== before.storageDate ||
            !basicMatch(current, plan.filters, plan.queue, plan.at)
          ) {
            item.outcome = "skipped";
            item.message = "O atendimento mudou ou já foi encerrado depois da prévia.";
            job.result.skipped++;
          } else {
            if (usesHistory(plan.filters)) {
              const last = await lastCustomerInput(ctx, current, () => cancelled(job));
              if (last !== reviewed.lastInputAt || !historyMatch(last, plan.filters, plan.at)) {
                item.outcome = "skipped";
                item.message = "A última mensagem do cliente mudou depois da prévia.";
                job.result.skipped++;
              }
            }
            if (!item.outcome) {
              cancelled(job);
              await closeTicketChecked(ctx, current, tag);
              item.outcome = "finalized";
              job.result.finalized++;
            }
          }
        } catch (error) {
          if (error.cancelled) throw error;
          item.message = error.message;
          item.outcome = error.closedConfirmed
            ? "finalized"
            : error.uncertain
              ? "uncertain"
              : "failed";
          if (error.closedConfirmed) job.result.finalized++;
          else if (error.uncertain) job.result.uncertain++;
          else job.result.failed++;
          stop = true;
        }
        job.result.items.push(item);
        job.progress.checked++;
        job.result.remaining = plan.selected.length - job.progress.checked;
        if (stop) {
          job.result.interrupted = true;
          break;
        }
      }
      job.status = "completed";
      job.progress.stage =
        job.result.interrupted || job.result.remaining
          ? "Lote interrompido após falha. Confira o relatório antes de repetir."
          : "Lote concluído. Confira o resultado.";
    } catch (error) {
      job.status = error.cancelled ? "cancelled" : "failed";
      job.error = error.message;
    } finally {
      locks.delete(ctx.identity);
      job.expires = Date.now() + TTL;
    }
  })();
  return publicJob(job);
}
function bulkStatus(params) {
  return publicJob(findJob(context(params), params));
}
function cancelBulk(params) {
  const job = findJob(context(params), params);
  if (job.status === "running") {
    job.cancelRequested = true;
    job.progress.stage = "Interrupção solicitada. Aguardando a operação atual…";
  }
  return publicJob(job);
}
module.exports = { bulkOptions, startBulkPreview, startBulkFinalize, bulkStatus, cancelBulk };
