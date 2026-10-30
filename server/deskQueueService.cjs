const { randomUUID, createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const DESK = "postmaster@desk.msging.net";
const COLLECTION = "application/vnd.lime.collection+json";
const QUEUE = "application/vnd.iris.desk.attendancequeue+json";
const ATTENDANT = "application/vnd.iris.desk.attendant+json";
const RULE = "application/vnd.iris.desk.rule+json";
const PRIORITY = "application/vnd.iris.desk.priority-rules+json";
const TAG = "application/vnd.iris.desk.attendancequeuetag+json";
const locks = new Set();
const completed = new Map();
const normalize = (name) => String(name).normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
const clone = (value) => structuredClone(value);

class DeskInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function context(params) {
  const bot = params?.builderShortName;
  const key = params?.builderKey;
  if (typeof bot !== "string" || !/^[a-z0-9][a-z0-9_-]{1,99}$/i.test(bot))
    throw new DeskInputError("Selecione um Builder válido.");
  if (typeof key !== "string" || !/^Key [A-Za-z0-9+/]+=*$/.test(key))
    throw new DeskInputError("Não foi possível obter o acesso ao Builder selecionado.");
  const decoded = Buffer.from(key.slice(4), "base64").toString("utf8");
  if (decoded.slice(0, decoded.indexOf(":")) !== bot)
    throw new DeskInputError("A credencial não corresponde ao Builder selecionado.");
  const tenant = params.tenantId;
  if (tenant != null && (typeof tenant !== "string" || !/^[a-z0-9-]+$/i.test(tenant)))
    throw new DeskInputError("O contrato do Builder é inválido.");
  return {
    bot,
    identity: `${bot}@msging.net`,
    key,
    url: tenant ? `https://${tenant}.http.msging.net/commands` : "https://msging.net/commands",
  };
}

async function command(ctx, method, uri, type, resource) {
  const request = { id: randomUUID(), to: DESK, method, uri };
  if (resource !== undefined) Object.assign(request, { type, resource });
  const response = await fetch(ctx.url, {
    method: "POST",
    headers: { Authorization: ctx.key, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "success") {
    const error = new Error(
      data?.reason?.description || `Falha ao consultar o Desk (HTTP ${response.status}).`,
    );
    error.definite =
      (data?.status === "failure" && data.id === request.id) ||
      [401, 403].includes(response.status);
    throw error;
  }
  if (data.id !== request.id || data.to?.split("/")[0] !== ctx.identity)
    throw new Error("A Blip não confirmou a identidade da resposta do Builder.");
  return data.resource;
}

// Do not assume that a short page is complete when a larger total was declared.
async function all(ctx, uri) {
  const items = [];
  const seen = new Set();
  let total;
  for (let page = 0; page < 100; page++) {
    const resource = await command(
      ctx,
      "get",
      `${uri}${uri.includes("?") ? "&" : "?"}$skip=${items.length}&$take=100`,
    );
    if (!Array.isArray(resource?.items))
      throw new Error(`O Desk retornou uma lista inválida em ${uri}.`);
    if (resource.total != null) {
      if (
        !Number.isInteger(resource.total) ||
        resource.total < 0 ||
        (total != null && resource.total !== total)
      )
        throw new Error("A lista do Desk mudou durante a leitura. Atualize e tente novamente.");
      total = resource.total;
    }
    for (const item of resource.items) {
      const id = item.id || item.identity || item.tag;
      if (!id || seen.has(id)) throw new Error(`A leitura de ${uri} está incompleta ou repetida.`);
      seen.add(id);
      items.push(item);
    }
    if (total != null && items.length === total) return items;
    if (total != null && items.length > total) throw new Error(`Contagem inválida em ${uri}.`);
    if (!resource.items.length) {
      if (total != null && items.length !== total) throw new Error(`Leitura incompleta de ${uri}.`);
      return items;
    }
    if (total == null && resource.items.length < 100) return items;
  }
  throw new Error("A lista do Desk excedeu o limite de leitura. Nenhuma alteração foi iniciada.");
}

function attendantSettings(agent) {
  const { status, lastServiceDate, ticketsInService, ...settings } = agent;
  void status;
  void lastServiceDate;
  void ticketsInService;
  return settings;
}

async function base(ctx) {
  const [queues, rules, priorities, attendants] = await Promise.all([
    all(ctx, "/attendance-queues"),
    all(ctx, "/rules"),
    all(ctx, "/priority-rules"),
    all(ctx, "/attendants"),
  ]);
  const names = new Set();
  for (const queue of queues) {
    if (
      !queue.id ||
      !queue.uniqueId ||
      !queue.name ||
      queue.ownerIdentity !== ctx.identity ||
      names.has(normalize(queue.name))
    )
      throw new Error(
        "O Desk retornou filas ambíguas ou de outro proprietário. Nenhuma alteração foi iniciada.",
      );
    names.add(normalize(queue.name));
  }
  if (
    rules.some((r) => !r.id) ||
    priorities.some((r) => !r.id) ||
    attendants.some((a) => !a.identity || !Array.isArray(a.teams))
  )
    throw new Error("O cadastro do Desk está incompleto. Atualize antes de alterar uma fila.");
  return { queues, rules, priorities, attendants: attendants.map(attendantSettings) };
}

function belongs(rule, queue) {
  if (rule.queueId && rule.queueId !== queue.id && rule.queueId !== queue.uniqueId) {
    if (rule.team === queue.name)
      throw new Error("Uma regra referencia o nome e o ID de filas diferentes.");
    return false;
  }
  return rule.queueId === queue.id || rule.queueId === queue.uniqueId || rule.team === queue.name;
}

function summary(state, queue) {
  return {
    ...queue,
    attendantCount: state.attendants.filter((a) => a.teams.includes(queue.name)).length,
    ruleCount: state.rules.filter((r) => belongs(r, queue)).length,
    priorityRuleCount: state.priorities.filter((r) => belongs(r, queue)).length,
  };
}

async function searchDeskQueues(params) {
  const ctx = context(params);
  const state = await base(ctx);
  return {
    builderShortName: ctx.bot,
    total: state.queues.length,
    queues: state.queues.map((q) => summary(state, q)),
  };
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Configuração inválida: ${label}.`);
  return value;
}

function requestDetails(params, state) {
  if (!["rename", "duplicate"].includes(params.action))
    throw new DeskInputError("Escolha Renomear ou Duplicar.");
  const queue = state.queues.find((q) => q.id === params.queueId);
  if (!queue)
    throw new DeskInputError("A fila selecionada não existe mais. Atualize a lista.", 409);
  const name = typeof params.name === "string" ? params.name.trim() : "";
  if (name.length < 3 || !/^[\p{L}\p{N} _-]+$/u.test(name))
    throw new DeskInputError(
      "Use um nome com pelo menos 3 caracteres: letras, números, espaços, hifens ou sublinhados.",
    );
  if (
    ["default", "directtransfer"].includes(normalize(queue.name)) ||
    ["default", "directtransfer"].includes(normalize(name))
  )
    throw new DeskInputError("Esta fila é reservada pelo Desk e deve ser gerenciada pelo Portal.");
  if (normalize(name) === normalize(queue.name))
    throw new DeskInputError("Informe um nome diferente do atual.");
  if (state.queues.some((q) => normalize(q.name) === normalize(name)))
    throw new DeskInputError("Já existe uma fila com esse nome. Escolha outro nome.", 409);
  if (
    state.attendants.some((a) => a.teams.includes(name)) ||
    state.rules.some((r) => r.team === name)
  )
    throw new DeskInputError(
      "O novo nome ainda possui vínculos antigos no Desk. Escolha outro nome para não incorporá-los.",
      409,
    );
  return { queue, name, action: params.action };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
function revision(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
function ordered(state) {
  return Object.fromEntries(
    Object.entries(state).map(([k, items]) => [
      k,
      [...items].sort((a, b) =>
        String(a.id || a.identity).localeCompare(String(b.id || b.identity)),
      ),
    ]),
  );
}
const configUri = (name) => `/owner-team-configurations/${encodeURIComponent(name)}`;
const tagsUri = (queue) => `/attendance-queues/${encodeURIComponent(queue.uniqueId)}/tags`;

async function inspect(ctx, params) {
  const state = await base(ctx);
  const detail = requestDetails(params, state);
  const { queue, name } = detail;
  const [tags, settings, targetSettings] = await Promise.all([
    all(ctx, tagsUri(queue)),
    command(ctx, "get", configUri(queue.name)),
    command(ctx, "get", configUri(name)),
  ]);
  object(settings, "encerramento da fila");
  object(targetSettings, "configuração do nome novo");
  if (tags.some((t) => typeof t.tag !== "string"))
    throw new Error("As tags da fila estão incompletas.");
  if (Object.keys(targetSettings).length && !isDeepStrictEqual(targetSettings, settings))
    throw new DeskInputError(
      "O novo nome já possui configurações antigas no Desk. Escolha outro nome para não substituí-las.",
      409,
    );
  if (detail.action === "rename") {
    const filter = encodeURIComponent(
      `team eq '${queue.name.replaceAll("'", "''")}' and closed eq false`,
    );
    const active = await command(ctx, "get", `/tickets?$take=1&$filter=${filter}`);
    if (!Array.isArray(active?.items))
      throw new Error("Não foi possível conferir os atendimentos ativos desta fila.");
    if (active.items.length)
      throw new DeskInputError(
        "Esta fila tem atendimentos ativos. Finalize-os antes de renomear.",
        409,
      );
  }
  const backup = {
    queue: clone(queue),
    attendants: state.attendants.filter((a) => a.teams.includes(queue.name)),
    rules: state.rules.filter((r) => belongs(r, queue)),
    priorities: state.priorities.filter((r) => belongs(r, queue)),
    tags,
    settings,
  };
  return {
    state,
    ...detail,
    backup,
    targetSettings,
    revision: revision({ state: ordered(state), tags, settings, targetSettings }),
  };
}

function previewResult(ctx, plan) {
  return {
    builderShortName: ctx.bot,
    action: plan.action,
    name: plan.name,
    revision: plan.revision,
    queue: summary(plan.state, plan.queue),
    counts: {
      attendants: plan.backup.attendants.length,
      rules: plan.backup.rules.length,
      priorityRules: plan.backup.priorities.length,
      tags: plan.backup.tags.length,
    },
    backup: {
      version: 1,
      builderShortName: ctx.bot,
      capturedAt: new Date().toISOString(),
      ...plan.backup,
    },
  };
}

async function previewDeskQueue(params) {
  const ctx = context(params);
  return previewResult(ctx, await inspect(ctx, params));
}

// A lost write response is reconciled by GET; it is never retried blindly.
async function writeChecked(ctx, method, uri, type, resource, verify, requireAcknowledged = false) {
  let writeError;
  try {
    await command(ctx, method, uri, type, resource);
  } catch (error) {
    writeError = error;
  }
  if (writeError && (writeError.definite || requireAcknowledged)) throw writeError;
  let verified;
  try {
    verified = await verify();
  } catch (error) {
    throw new Error(`Não foi possível conferir a alteração: ${error.message}`);
  }
  if (!verified) throw writeError || new Error("A Blip não confirmou o efeito da alteração.");
  return verified;
}

async function setAgentTeams(ctx, identity, transform) {
  const agents = await all(ctx, "/attendants");
  const agent = agents.find((a) => a.identity === identity);
  if (!agent)
    throw new Error(
      "Um atendente deixou de estar cadastrado no Builder. Atualize o cadastro no Desk.",
    );
  const teams = transform(agent.teams);
  const resource = { ...attendantSettings(agent), teams };
  return writeChecked(ctx, "set", "/attendants", ATTENDANT, resource, async () => {
    const current = (await all(ctx, "/attendants")).find((a) => a.identity === identity);
    return current && isDeepStrictEqual(attendantSettings(current), resource);
  });
}

function sameRule(actual, expected) {
  return Object.entries(expected).every(
    ([k, v]) => k === "storageDate" || isDeepStrictEqual(actual[k], v),
  );
}

async function setRule(ctx, uri, mime, rule) {
  const existing = (await all(ctx, uri)).find((r) => r.id === rule.id);
  if (existing) {
    if (!sameRule(existing, rule))
      throw new Error(
        "Uma regra foi alterada por outra sessão. A recuperação não pode substituí-la.",
      );
    return existing;
  }
  return writeChecked(ctx, "set", uri, mime, rule, async () => {
    const found = (await all(ctx, uri)).find((r) => r.id === rule.id);
    return (
      found &&
      Object.entries(rule).every(([k, v]) => k === "storageDate" || isDeepStrictEqual(found[k], v))
    );
  });
}

async function deleteRule(ctx, uri, rule) {
  const existing = (await all(ctx, uri)).find((r) => r.id === rule.id);
  if (!existing) return true;
  if (!sameRule(existing, rule))
    throw new Error("Uma regra mudou durante a operação e não será excluída automaticamente.");
  return writeChecked(
    ctx,
    "delete",
    `${uri}/${encodeURIComponent(rule.id)}`,
    undefined,
    undefined,
    async () => !(await all(ctx, uri)).some((r) => r.id === rule.id),
  );
}

async function setQueue(ctx, resource) {
  return writeChecked(ctx, "set", "/attendance-queues", QUEUE, resource, async () => {
    const found = (await all(ctx, "/attendance-queues")).find((q) => q.id === resource.id);
    return (
      found &&
      Object.entries(resource).every(
        ([k, v]) => k === "storageDate" || isDeepStrictEqual(found[k], v),
      ) &&
      found
    );
  });
}

async function applyPlan(ctx, plan, progress) {
  const undo = [];
  const createdRules = [];
  const createdPriorities = [];
  let target = plan.queue;
  let settingsWritten = false;
  const { backup, name, action } = plan;
  const step = (message) => progress?.(message);
  try {
    if (action === "rename") {
      step("Preparando os vínculos da fila…");
      for (const [uri, mime, rules] of [
        ["/rules", RULE, backup.rules],
        ["/priority-rules", PRIORITY, backup.priorities],
      ]) {
        for (const rule of rules) {
          undo.push(async () => setRule(ctx, uri, mime, rule));
          await deleteRule(ctx, uri, rule);
        }
      }
      for (const agent of backup.attendants) {
        undo.push(async () =>
          setAgentTeams(ctx, agent.identity, (teams) => [
            ...agent.teams,
            ...teams.filter((t) => t !== name && !agent.teams.includes(t)),
          ]),
        );
        await setAgentTeams(ctx, agent.identity, (teams) =>
          teams.filter((t) => t !== backup.queue.name),
        );
      }
      step("Renomeando a fila…");
      undo.push(async () => {
        const current = (await all(ctx, "/attendance-queues")).find(
          (q) => q.id === backup.queue.id,
        );
        if (!current || ![backup.queue.name, name].includes(current.name))
          throw new Error(
            "A fila foi alterada por outra sessão e não será substituída na recuperação.",
          );
        const strip = ({ name: ignored, ...value }) => {
          void ignored;
          return value;
        };
        if (!isDeepStrictEqual(strip(current), strip(backup.queue)))
          throw new Error(
            "As propriedades da fila mudaram durante a operação. Confira a cópia de segurança.",
          );
        await setQueue(ctx, backup.queue);
      });
      target = await setQueue(ctx, { ...backup.queue, name });
    } else {
      step("Criando a cópia da fila…");
      const { id, uniqueId, storageDate, ...settings } = backup.queue;
      void id;
      void uniqueId;
      void storageDate;
      undo.push(async () => {
        const found =
          target.id !== backup.queue.id
            ? (await all(ctx, "/attendance-queues")).find(
                (q) => q.id === target.id && q.name === name,
              )
            : null;
        if (found)
          await writeChecked(
            ctx,
            "delete",
            `/attendance-queues/${encodeURIComponent(found.id)}`,
            undefined,
            undefined,
            async () => !(await all(ctx, "/attendance-queues")).some((q) => q.id === found.id),
          );
      });
      target = await writeChecked(
        ctx,
        "set",
        "/attendance-queues",
        QUEUE,
        { ...settings, name },
        async () => {
          const found = (await all(ctx, "/attendance-queues")).find((q) => q.name === name);
          return found && found.id !== backup.queue.id && found;
        },
        true,
      );
    }
    step("Restaurando regras e atendentes…");
    for (const [uri, mime, rules, created] of [
      ["/rules", RULE, backup.rules, createdRules],
      ["/priority-rules", PRIORITY, backup.priorities, createdPriorities],
    ]) {
      let priority = Math.max(
        0,
        ...plan.state[uri === "/rules" ? "rules" : "priorities"].map(
          (r) => Number(r.priority) || 0,
        ),
      );
      for (const original of rules) {
        const rule = {
          ...clone(original),
          id: randomUUID(),
          ownerIdentity: ctx.identity,
          queueId: target.id,
          storageDate: new Date().toISOString(),
        };
        if (uri === "/rules" || original.team !== undefined) rule.team = name;
        if (action === "duplicate") rule.priority = ++priority;
        undo.push(async () => deleteRule(ctx, uri, rule));
        await setRule(ctx, uri, mime, rule);
        created.push(rule);
      }
    }
    for (const agent of backup.attendants) {
      undo.push(async () =>
        setAgentTeams(ctx, agent.identity, (teams) => teams.filter((t) => t !== name)),
      );
      await setAgentTeams(ctx, agent.identity, (teams) => [...new Set([...teams, name])]);
    }
    step("Conferindo tags e configurações…");
    if (action === "duplicate" && backup.tags.length) {
      const items = backup.tags.map(({ tag }) => ({ tag }));
      await writeChecked(
        ctx,
        "set",
        tagsUri(target),
        COLLECTION,
        { itemType: TAG, items },
        async () =>
          isDeepStrictEqual(
            (await all(ctx, tagsUri(target))).map((t) => t.tag).sort(),
            items.map((t) => t.tag).sort(),
          ),
      );
    }
    if (Object.keys(backup.settings).length) {
      settingsWritten = true;
      await writeChecked(
        ctx,
        "set",
        configUri(name),
        "application/json",
        backup.settings,
        async () => isDeepStrictEqual(await command(ctx, "get", configUri(name)), backup.settings),
      );
    }
    const verified = await base(ctx);
    const expectedQueues =
      action === "rename"
        ? plan.state.queues.map((q) => (q.id === backup.queue.id ? { ...q, name } : q))
        : [...plan.state.queues, target];
    const expectedRules = [
      ...plan.state.rules.filter(
        (r) => action !== "rename" || !backup.rules.some((b) => b.id === r.id),
      ),
      ...createdRules,
    ];
    const expectedPriorities = [
      ...plan.state.priorities.filter(
        (r) => action !== "rename" || !backup.priorities.some((b) => b.id === r.id),
      ),
      ...createdPriorities,
    ];
    const expectedAgents = plan.state.attendants.map((a) =>
      backup.attendants.some((b) => b.identity === a.identity)
        ? {
            ...a,
            teams:
              action === "rename"
                ? [...a.teams.filter((t) => t !== backup.queue.name), name]
                : [...a.teams, name],
          }
        : a,
    );
    const withoutDates = (items) =>
      items.map(({ storageDate, ...value }) => {
        void storageDate;
        return value;
      });
    const comparable = (state) =>
      ordered({
        ...state,
        queues: withoutDates(state.queues),
        rules: withoutDates(state.rules),
        priorities: withoutDates(state.priorities),
        attendants: state.attendants.map((a) => ({ ...a, teams: [...a.teams].sort() })),
      });
    if (
      !isDeepStrictEqual(
        comparable(verified),
        comparable({
          queues: expectedQueues,
          rules: expectedRules,
          priorities: expectedPriorities,
          attendants: expectedAgents,
        }),
      )
    )
      throw new Error(
        "A conferência final encontrou uma diferença de configuração. Confira o resultado antes de repetir.",
      );
    const verifiedTags = await all(ctx, tagsUri(target));
    if (
      !isDeepStrictEqual(
        verifiedTags.map((t) => t.tag).sort(),
        backup.tags.map((t) => t.tag).sort(),
      )
    )
      throw new Error("As tags da fila não foram preservadas.");
    if (!isDeepStrictEqual(await command(ctx, "get", configUri(name)), backup.settings))
      throw new Error("As configurações de encerramento da fila não foram preservadas.");
    return {
      status: "success",
      builderShortName: ctx.bot,
      action,
      queue: summary(verified, target),
      counts: {
        attendants: backup.attendants.length,
        rules: createdRules.length,
        priorityRules: createdPriorities.length,
        tags: backup.tags.length,
      },
    };
  } catch (error) {
    step("Conferindo a recuperação da configuração anterior…");
    const recoveryErrors = [];
    for (const restore of undo.reverse()) {
      try {
        await restore();
      } catch (failure) {
        recoveryErrors.push(failure.message);
      }
    }
    if (settingsWritten) {
      try {
        await command(ctx, "set", configUri(name), "application/json", plan.targetSettings);
      } catch (failure) {
        recoveryErrors.push(failure.message);
      }
    }
    let restored = false;
    try {
      restored = isDeepStrictEqual(ordered(await base(ctx)), ordered(plan.state));
      if (
        settingsWritten &&
        !isDeepStrictEqual(await command(ctx, "get", configUri(name)), plan.targetSettings)
      )
        restored = false;
    } catch (failure) {
      recoveryErrors.push(failure.message);
    }
    return {
      status: restored ? "recovered" : "attention",
      builderShortName: ctx.bot,
      action,
      message: error.message,
      recoveryErrors,
      restored,
    };
  }
}

async function applyDeskQueue(params, onProgress) {
  const ctx = context(params);
  if (typeof params.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(params.operationId))
    throw new DeskInputError("A operação não foi identificada. Prepare a prévia novamente.");
  if (!/^[a-f0-9]{64}$/.test(params.revision || ""))
    throw new DeskInputError("Prepare a prévia antes de confirmar.");
  const job = `${ctx.identity}:${revision(ctx.key)}:${params.operationId}`;
  const fingerprint = revision({
    queueId: params.queueId,
    action: params.action,
    name: params.name,
    revision: params.revision,
  });
  const previous = completed.get(job);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new DeskInputError("Esta confirmação já foi usada para outra operação.", 409);
    return previous.result;
  }
  if (locks.has(ctx.identity))
    throw new DeskInputError(
      "Outra alteração de fila está em andamento neste Builder. Aguarde e atualize a lista.",
      409,
    );
  locks.add(ctx.identity);
  try {
    const plan = await inspect(ctx, params);
    if (plan.revision !== params.revision)
      throw new DeskInputError(
        "As configurações mudaram desde a prévia. Atualize e revise novamente.",
        409,
      );
    const result = await applyPlan(ctx, plan, onProgress);
    completed.set(job, { fingerprint, result });
    if (completed.size > 200) completed.delete(completed.keys().next().value);
    return result;
  } finally {
    locks.delete(ctx.identity);
  }
}

module.exports = { DeskInputError, searchDeskQueues, previewDeskQueue, applyDeskQueue };
