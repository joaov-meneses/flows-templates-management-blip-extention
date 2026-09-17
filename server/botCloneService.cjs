const { randomUUID } = require("node:crypto");

const MSGING_COMMANDS_URL = "https://msging.net/commands";
const DESK_TO = "postmaster@desk.msging.net";
const DESK_PAGE_SIZE = 500;
const DESK_WRITE_DELAY_MS = 120;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.statusCode = 400;
  }
}

function validateRouterKey(routerKey, fieldName) {
  if (!routerKey || typeof routerKey !== "string") {
    throw new InputError(`${fieldName} precisa ser uma string.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reasonOf(data) {
  return (
    (data && data.reason && data.reason.description) || (data && data.status) || "erro desconhecido"
  );
}

// A Blip responde "resource not found" (code 67) quando o bot nunca usou
// aquele recurso. Isso significa zero itens, não uma falha real.
function isEmptyResource(data) {
  if (!data || data.status !== "failure") return false;
  const code = data.reason && data.reason.code;
  const desc = (data.reason && data.reason.description) || "";
  return code === 67 || /not found/i.test(desc);
}

async function postCommand(routerKey, command) {
  const response = await fetch(MSGING_COMMANDS_URL, {
    method: "POST",
    headers: {
      Authorization: routerKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const responseText = await response.text();
  let responseBody;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = { raw: responseText };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Bot key inválida ou sem permissão. Confira se copiou a key correta.");
    }

    const description = responseBody?.reason?.description || responseBody?.description;
    throw new Error(
      description
        ? `A Blip recusou o comando: ${description}`
        : `Erro HTTP ${response.status} ao falar com a Blip.`,
    );
  }

  return responseBody;
}

async function sendBlipCommand(routerKey, command) {
  const responseBody = await postCommand(routerKey, command);

  if (responseBody && responseBody.status && responseBody.status !== "success") {
    throw new Error(reasonOf(responseBody));
  }

  return responseBody;
}

async function deskRequest(routerKey, command) {
  return postCommand(routerKey, { id: randomUUID(), to: DESK_TO, ...command });
}

function buildCommand({ to, method, uri, type, resource }) {
  const command = { id: randomUUID(), method, uri };
  if (to) command.to = to;
  if (resource !== undefined) {
    command.type = type || "application/json";
    command.resource = resource;
  }
  return command;
}

// Bucket que o bot nunca usou (fluxo nunca salvo, sem tags, sem variáveis)
// responde "resource not found" — isso é uma origem vazia, não uma falha.
async function getBucket(routerKey, key) {
  const data = await postCommand(
    routerKey,
    buildCommand({ method: "get", uri: `/buckets/${key}` }),
  );
  if (isEmptyResource(data)) return undefined;
  if (data && data.status && data.status !== "success") {
    throw new Error(reasonOf(data));
  }
  return data?.resource;
}

async function setBucket(routerKey, key, resource) {
  await sendBlipCommand(
    routerKey,
    buildCommand({ method: "set", uri: `/buckets/${key}`, resource }),
  );
}

/* ---------------- Fluxo ---------------- */

async function cloneFlow(sourceRouterKey, targetRouterKey) {
  const flow = await getBucket(sourceRouterKey, "blip_portal:builder_working_flow");
  if (flow === undefined) {
    return { status: "success", empty: true };
  }
  await setBucket(targetRouterKey, "blip_portal:builder_working_flow", flow);
  return { status: "success" };
}

/* ---------------- Variáveis de configuração ---------------- */

async function cloneConfigVariables(sourceRouterKey, targetRouterKey) {
  const variables = await getBucket(sourceRouterKey, "blip_portal:builder_working_configuration");
  if (variables === undefined) {
    return { status: "success", empty: true };
  }
  await setBucket(targetRouterKey, "blip_portal:builder_working_configuration", variables);
  return { status: "success" };
}

/* ---------------- Tags ---------------- */

async function cloneTags(sourceRouterKey, targetRouterKey) {
  const data = await postCommand(
    sourceRouterKey,
    buildCommand({ method: "get", uri: "/buckets/blip:desk:tags" }),
  );

  if (isEmptyResource(data)) {
    return { status: "success", tags: 0, empty: true };
  }
  if (data && data.status && data.status !== "success") {
    throw new Error(reasonOf(data));
  }
  if (data?.resource === undefined) {
    throw new Error("Nenhuma tag encontrada na origem.");
  }

  let tagsCount = 0;
  try {
    const parsed = typeof data.resource === "string" ? JSON.parse(data.resource) : data.resource;
    tagsCount = Array.isArray(parsed?.tags) ? parsed.tags.length : 0;
  } catch {
    // O resource é tratado como opaco: se não der para contar, seguimos mesmo assim.
  }

  await sendBlipCommand(
    targetRouterKey,
    buildCommand({
      method: "set",
      uri: "/buckets/blip:desk:tags",
      type: data.type,
      resource: data.resource,
    }),
  );

  return { status: "success", tags: tagsCount };
}

/* ---------------- Atendentes ---------------- */

async function cloneAttendants(sourceRouterKey, targetRouterKey) {
  const data = await sendBlipCommand(
    sourceRouterKey,
    buildCommand({ to: DESK_TO, method: "get", uri: "/attendants" }),
  );
  const attendants = Array.isArray(data?.resource?.items) ? data.resource.items : [];
  const errors = [];
  let cloned = 0;

  for (const attendant of attendants) {
    try {
      await sendBlipCommand(
        targetRouterKey,
        buildCommand({
          to: DESK_TO,
          method: "set",
          uri: "/attendants",
          type: "application/vnd.iris.desk.attendant+json",
          resource: {
            identity: attendant.identity,
            email: attendant.email,
            teams: Array.isArray(attendant.teams) ? attendant.teams : [],
          },
        }),
      );
      cloned += 1;
      await sleep(DESK_WRITE_DELAY_MS);
    } catch (error) {
      errors.push({ attendant: attendant.fullName || attendant.identity, message: error.message });
    }
  }

  return {
    status: errors.length > 0 ? "partial" : "success",
    total: attendants.length,
    cloned,
    errors,
  };
}

/* ---------------- Respostas prontas ---------------- */

async function cloneQuickReplies(sourceRouterKey, targetRouterKey) {
  const categoriesData = await sendBlipCommand(
    sourceRouterKey,
    buildCommand({ to: DESK_TO, method: "get", uri: "/replies/" }),
  );
  const categories = Array.isArray(categoriesData?.resource?.items)
    ? categoriesData.resource.items
    : [];
  const errors = [];
  let cloned = 0;

  for (const category of categories) {
    try {
      const detailsData = await sendBlipCommand(
        sourceRouterKey,
        buildCommand({ to: DESK_TO, method: "get", uri: `/replies/${category.id}` }),
      );
      const items = Array.isArray(detailsData?.resource?.items) ? detailsData.resource.items : [];
      if (items.length === 0) continue;

      await sendBlipCommand(
        targetRouterKey,
        buildCommand({
          to: DESK_TO,
          method: "set",
          uri: `/replies/${category.id}`,
          type: "application/vnd.lime.collection+json",
          resource: {
            itemType: "application/vnd.iris.desk.custom-reply+json",
            items: items.map((item) => ({
              id: item.id,
              category: item.category,
              name: item.name,
              document: item.document,
              type: item.type || "text/plain",
              isDynamicContent: item.isDynamicContent || false,
            })),
          },
        }),
      );
      cloned += 1;
      await sleep(DESK_WRITE_DELAY_MS);
    } catch (error) {
      errors.push({ category: category.category || category.id, message: error.message });
    }
  }

  return {
    status: errors.length > 0 ? "partial" : "success",
    total: categories.length,
    cloned,
    errors,
  };
}

/* ==================================================================
   ESPELHAMENTO IDEMPOTENTE (filas, regras de atendimento e de
   priorização)
   ------------------------------------------------------------------
   Rodar N vezes tem que dar sempre o mesmo resultado. A comparação
   nunca inclui campos gerados pelo servidor (id, ownerIdentity,
   queueId) nem campos que só existem no set (conditions[].id,
   extrasProperty, errorExtras, errorValues) — senão toda regra
   pareceria diferente e seria reescrita a cada rodada.
   ================================================================== */

function normalizeName(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function canonConditions(conditions) {
  const list = (Array.isArray(conditions) ? conditions : []).map((condition) => {
    const values = (Array.isArray(condition.values) ? condition.values : []).map(String).sort();
    return {
      property: String(condition.property || ""),
      relation: String(condition.relation || ""),
      values,
    };
  });
  list.sort((a, b) => {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return list;
}

// Diff de multiset: agrupa origem e destino por assinatura e casa por
// contagem. O que sobra na origem vira criação, o que sobra no destino vira
// remoção, empate não mexe.
function diffBySignature(sourceItems, targetItems, sourceSignature, targetSignature) {
  const bySourceSignature = new Map();
  const byTargetSignature = new Map();

  for (const item of sourceItems) {
    const signature = sourceSignature(item);
    if (!bySourceSignature.has(signature)) bySourceSignature.set(signature, []);
    bySourceSignature.get(signature).push(item);
  }
  for (const item of targetItems) {
    const signature = targetSignature(item);
    if (!byTargetSignature.has(signature)) byTargetSignature.set(signature, []);
    byTargetSignature.get(signature).push(item);
  }

  const toCreate = [];
  const toDelete = [];
  let unchanged = 0;

  for (const signature of new Set([...bySourceSignature.keys(), ...byTargetSignature.keys()])) {
    const sourceGroup = bySourceSignature.get(signature) || [];
    const targetGroup = (byTargetSignature.get(signature) || [])
      .slice()
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));

    unchanged += Math.min(sourceGroup.length, targetGroup.length);
    if (sourceGroup.length > targetGroup.length)
      toCreate.push(...sourceGroup.slice(targetGroup.length));
    if (targetGroup.length > sourceGroup.length)
      toDelete.push(...targetGroup.slice(sourceGroup.length));
  }

  return { toCreate, toDelete, unchanged };
}

// Casa uma criação com uma remoção que na verdade são a mesma regra alterada,
// transformando o par num update — assim o destino é corrigido no lugar em
// vez de perder o id da regra.
function pairIntoUpdates(toCreate, toDelete, sourceKeyFn, targetKeyFn) {
  const byTargetKey = new Map();
  for (const item of toDelete) {
    const key = targetKeyFn(item);
    if (!byTargetKey.has(key)) byTargetKey.set(key, []);
    byTargetKey.get(key).push(item);
  }
  for (const list of byTargetKey.values()) {
    list.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  }

  const toUpdate = [];
  const remainingCreate = [];
  const used = new Set();

  const sortedToCreate = [...toCreate].sort((a, b) => {
    const ka = sourceKeyFn(a);
    const kb = sourceKeyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  for (const item of sortedToCreate) {
    const candidates = byTargetKey.get(sourceKeyFn(item)) || [];
    const match = candidates.find((candidate) => !used.has(candidate.id));
    if (match) {
      used.add(match.id);
      toUpdate.push({ source: item, target: match });
    } else {
      remainingCreate.push(item);
    }
  }

  return {
    toUpdate,
    toCreate: remainingCreate,
    toDelete: toDelete.filter((item) => !used.has(item.id)),
  };
}

// Lê uma coleção do Desk inteira. Se não conseguir ler tudo, aborta: um
// espelho calculado em cima de leitura parcial apagaria dados bons do
// destino.
async function deskGetAll(routerKey, uri) {
  const items = [];
  let skip = 0;
  let total = null;

  for (let page = 0; page < 50; page += 1) {
    const separator = uri.indexOf("?") === -1 ? "?" : "&";
    const data = await deskRequest(routerKey, {
      method: "get",
      uri: `${uri}${separator}$skip=${skip}&$take=${DESK_PAGE_SIZE}`,
    });

    if (isEmptyResource(data)) return [];
    if (data.status !== "success") throw new Error(`${uri}: ${reasonOf(data)}`);

    const pageItems = (data.resource && data.resource.items) || [];
    if (total === null) {
      total =
        data.resource && typeof data.resource.total === "number"
          ? data.resource.total
          : pageItems.length;
    }
    items.push(...pageItems);
    if (pageItems.length === 0 || items.length >= total) break;
    skip += DESK_PAGE_SIZE;
  }

  if (total !== null && items.length !== total) {
    throw new Error(`${uri}: leitura incompleta (${items.length} de ${total}) - abortado.`);
  }

  return items;
}

async function getBotIdentity(routerKey) {
  const data = await deskRequest(routerKey, { method: "get", uri: "/replies" });
  if (!data || !data.to || typeof data.to !== "string") {
    throw new Error("Não foi possível identificar o bot (confira a router key).");
  }
  return `${data.to.split("/")[0].split("@")[0]}@msging.net`;
}

function buildQueueMap(queues, label) {
  const map = new Map();
  for (const queue of queues) {
    const key = normalizeName(queue.name);
    if (map.has(key)) {
      throw new Error(
        `o bot de ${label} tem duas filas que se confundem: "${map.get(key).name}" e "${queue.name}"`,
      );
    }
    map.set(key, queue);
  }
  return map;
}

// Cria no destino só as filas que faltam. Fila que já existe nunca é
// recriada nem apagada — excluir fila é destrutivo em cascata (desvincula
// atendentes e apaga as regras associadas).
async function ensureQueues(targetRouterKey, ownerTarget, neededQueues, targetMap) {
  let created = 0;

  for (const queue of neededQueues) {
    if (targetMap.has(normalizeName(queue.name))) continue;

    const data = await deskRequest(targetRouterKey, {
      method: "set",
      uri: "/attendance-queues",
      type: "application/vnd.iris.desk.attendancequeue+json",
      resource: {
        name: queue.name,
        isActive: queue.isActive !== false,
        ownerIdentity: ownerTarget,
        Priority: queue.Priority || 0,
      },
    });

    if (data.status !== "success") {
      throw new Error(`falha ao criar a fila "${queue.name}": ${reasonOf(data)}`);
    }
    created += 1;
    await sleep(DESK_WRITE_DELAY_MS);
  }

  return created;
}

/* ---------------- Filas ---------------- */

async function cloneQueues(sourceRouterKey, targetRouterKey) {
  const ownerTarget = await getBotIdentity(targetRouterKey);
  const sourceQueues = await deskGetAll(sourceRouterKey, "/attendance-queues");
  const targetQueues = await deskGetAll(targetRouterKey, "/attendance-queues");
  const targetMap = buildQueueMap(targetQueues, "destino");

  let created = 0;
  let existing = 0;
  const errors = [];

  for (const queue of sourceQueues) {
    if (targetMap.has(normalizeName(queue.name))) {
      existing += 1;
      continue;
    }

    try {
      const data = await deskRequest(targetRouterKey, {
        method: "set",
        uri: "/attendance-queues",
        type: "application/vnd.iris.desk.attendancequeue+json",
        resource: {
          name: queue.name,
          isActive: queue.isActive !== false,
          ownerIdentity: ownerTarget,
          Priority: queue.Priority || 0,
        },
      });

      if (data.status !== "success") throw new Error(reasonOf(data));
      created += 1;
      await sleep(DESK_WRITE_DELAY_MS);
    } catch (error) {
      errors.push({ queue: queue.name, message: error.message });
    }
  }

  return { status: errors.length > 0 ? "partial" : "success", created, existing, errors };
}

/* ---------------- Regras de atendimento ---------------- */

// A Blip mantém dois formatos em paralelo: conditions[] (novo) e
// property/relation/values na raiz (condição única, legado).
function attendanceRuleConditions(rule) {
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) return rule.conditions;
  if (rule.property)
    return [{ property: rule.property, relation: rule.relation, values: rule.values }];
  return [];
}

function attendanceRuleSignature(rule) {
  return JSON.stringify([
    normalizeName(rule.team),
    String(rule.title == null ? "" : rule.title),
    !!rule.isActive,
    String(rule.operator || "Or"),
    canonConditions(attendanceRuleConditions(rule)),
  ]);
}

function buildAttendanceRulePayload(rule, ownerTarget, targetId) {
  const conditions = attendanceRuleConditions(rule).map((condition) => ({
    property: String(condition.property || ""),
    relation: String(condition.relation || ""),
    values: (Array.isArray(condition.values) ? condition.values : []).map(String),
  }));

  const resource = {
    id: targetId || randomUUID(),
    ownerIdentity: ownerTarget,
    isActive: !!rule.isActive,
    title: String(rule.title == null ? "" : rule.title),
    team: String(rule.team || ""),
    operator: String(rule.operator || "Or"),
    conditions,
  };

  if (conditions.length === 1) {
    resource.property = conditions[0].property;
    resource.relation = conditions[0].relation;
    resource.values = conditions[0].values;
  }

  return resource;
}

async function cloneAttendanceRules(sourceRouterKey, targetRouterKey) {
  const ownerSource = await getBotIdentity(sourceRouterKey);
  const ownerTarget = await getBotIdentity(targetRouterKey);
  if (ownerSource === ownerTarget) {
    throw new Error("origem e destino são o mesmo bot - clonagem cancelada.");
  }

  const sourceRules = await deskGetAll(sourceRouterKey, "/rules");
  const targetRules = await deskGetAll(targetRouterKey, "/rules");
  const targetQueues = await deskGetAll(targetRouterKey, "/attendance-queues");
  const targetQueueNames = new Set(targetQueues.map((queue) => normalizeName(queue.name)));

  const keyOf = (rule) => `${normalizeName(rule.team)}||${normalizeName(rule.title)}`;
  const diff = diffBySignature(
    sourceRules,
    targetRules,
    attendanceRuleSignature,
    attendanceRuleSignature,
  );
  const plan = pairIntoUpdates(diff.toCreate, diff.toDelete, keyOf, keyOf);

  const errors = [];
  let removed = 0;
  let updated = 0;
  let created = 0;

  for (const rule of plan.toDelete) {
    try {
      const data = await deskRequest(targetRouterKey, {
        method: "delete",
        uri: `/rules/${rule.id}`,
      });
      if (data.status !== "success") throw new Error(reasonOf(data));
      removed += 1;
      await sleep(DESK_WRITE_DELAY_MS);
    } catch (error) {
      errors.push({ rule: rule.title, action: "delete", message: error.message });
    }
  }

  const write = async (sourceRule, targetId) => {
    if (!targetQueueNames.has(normalizeName(sourceRule.team))) {
      throw new Error(
        `a fila "${sourceRule.team}" não existe no destino (ligue também a opção Filas)`,
      );
    }
    const data = await deskRequest(targetRouterKey, {
      method: "set",
      uri: "/rules",
      type: "application/vnd.iris.desk.rule+json",
      resource: buildAttendanceRulePayload(sourceRule, ownerTarget, targetId),
    });
    if (data.status !== "success") throw new Error(reasonOf(data));
    await sleep(DESK_WRITE_DELAY_MS);
  };

  for (const pair of plan.toUpdate) {
    try {
      await write(pair.source, pair.target.id);
      updated += 1;
    } catch (error) {
      errors.push({ rule: pair.source.title, action: "update", message: error.message });
    }
  }

  for (const rule of plan.toCreate) {
    try {
      await write(rule, "");
      created += 1;
    } catch (error) {
      errors.push({ rule: rule.title, action: "create", message: error.message });
    }
  }

  return {
    status: errors.length > 0 ? "partial" : "success",
    created,
    updated,
    unchanged: diff.unchanged,
    removed,
    errors,
  };
}

/* ---------------- Regras de priorização ---------------- */

function priorityRuleSignature(rule, queueName) {
  return JSON.stringify([
    normalizeName(queueName),
    String(rule.title == null ? "" : rule.title),
    !!rule.isActive,
    Number(rule.urgency) || 0,
    rule.applyConditions !== false,
    String(rule.operator || "Or"),
    canonConditions(rule.conditions),
  ]);
}

function buildConditionsForSet(conditions) {
  return (Array.isArray(conditions) ? conditions : []).map((condition) => {
    const built = {
      id: randomUUID(),
      property: String(condition.property || ""),
      relation: String(condition.relation || ""),
      values: (Array.isArray(condition.values) ? condition.values : []).map(String),
      errorExtras: "false",
      errorValues: "false",
    };
    const extrasPrefix = "Contact.Extras.";
    if (built.property.indexOf(extrasPrefix) === 0) {
      built.extrasProperty = built.property.substring(extrasPrefix.length);
    }
    return built;
  });
}

function buildPriorityRulePayload(rule, targetQueueId, targetId) {
  return {
    id: targetId || "",
    queueId: targetQueueId,
    isActive: !!rule.isActive,
    urgency: Number(rule.urgency) || 0,
    applyConditions: rule.applyConditions !== false,
    title: String(rule.title == null ? "" : rule.title),
    conditions: buildConditionsForSet(rule.conditions),
    operator: String(rule.operator || "Or"),
  };
}

async function clonePriorityRules(sourceRouterKey, targetRouterKey) {
  const ownerSource = await getBotIdentity(sourceRouterKey);
  const ownerTarget = await getBotIdentity(targetRouterKey);
  if (ownerSource === ownerTarget) {
    throw new Error("origem e destino são o mesmo bot - clonagem cancelada.");
  }

  const sourceQueues = await deskGetAll(sourceRouterKey, "/attendance-queues");
  let targetQueues = await deskGetAll(targetRouterKey, "/attendance-queues");
  buildQueueMap(sourceQueues, "origem");
  let targetMap = buildQueueMap(targetQueues, "destino");
  const sourceQueueById = new Map(sourceQueues.map((queue) => [queue.id, queue]));

  const sourceRules = await deskGetAll(sourceRouterKey, "/priority-rules");
  const targetRules = await deskGetAll(targetRouterKey, "/priority-rules");

  // Regra cuja fila já não existe mais na origem não tem nome para resolver,
  // então fica de fora do diff.
  const validSourceRules = sourceRules.filter((rule) => sourceQueueById.has(rule.queueId));

  const neededQueues = [];
  const seen = new Set();
  for (const rule of validSourceRules) {
    const queue = sourceQueueById.get(rule.queueId);
    const key = normalizeName(queue.name);
    if (!seen.has(key)) {
      seen.add(key);
      neededQueues.push(queue);
    }
  }

  const queuesCreated = await ensureQueues(targetRouterKey, ownerTarget, neededQueues, targetMap);
  if (queuesCreated > 0) {
    targetQueues = await deskGetAll(targetRouterKey, "/attendance-queues");
    targetMap = buildQueueMap(targetQueues, "destino");
  }
  const targetQueueById = new Map(targetQueues.map((queue) => [queue.id, queue]));

  const sourceQueueName = (rule) => (sourceQueueById.get(rule.queueId) || {}).name || "";
  const targetQueueName = (rule) => (targetQueueById.get(rule.queueId) || {}).name || "";

  const diff = diffBySignature(
    validSourceRules,
    targetRules,
    (rule) => priorityRuleSignature(rule, sourceQueueName(rule)),
    (rule) => priorityRuleSignature(rule, targetQueueName(rule)),
  );
  const plan = pairIntoUpdates(
    diff.toCreate,
    diff.toDelete,
    (rule) => `${normalizeName(sourceQueueName(rule))}||${normalizeName(rule.title)}`,
    (rule) => `${normalizeName(targetQueueName(rule))}||${normalizeName(rule.title)}`,
  );

  const errors = [];
  let removed = 0;
  let updated = 0;
  let created = 0;

  for (const rule of plan.toDelete) {
    try {
      const data = await deskRequest(targetRouterKey, {
        method: "delete",
        uri: `/priority-rules/${rule.id}`,
      });
      if (data.status !== "success") throw new Error(reasonOf(data));
      removed += 1;
      await sleep(DESK_WRITE_DELAY_MS);
    } catch (error) {
      errors.push({ rule: rule.title, action: "delete", message: error.message });
    }
  }

  const write = async (sourceRule, targetId) => {
    const queue = targetMap.get(normalizeName(sourceQueueName(sourceRule)));
    if (!queue) {
      throw new Error(`fila "${sourceQueueName(sourceRule)}" não encontrada no destino`);
    }
    const data = await deskRequest(targetRouterKey, {
      method: "set",
      uri: "/priority-rules",
      type: "application/vnd.iris.desk.priority-rules+json",
      resource: buildPriorityRulePayload(sourceRule, queue.id, targetId),
    });
    if (data.status !== "success") throw new Error(reasonOf(data));
    await sleep(DESK_WRITE_DELAY_MS);
  };

  for (const pair of plan.toUpdate) {
    try {
      await write(pair.source, pair.target.id);
      updated += 1;
    } catch (error) {
      errors.push({ rule: pair.source.title, action: "update", message: error.message });
    }
  }

  for (const rule of plan.toCreate) {
    try {
      await write(rule, "");
      created += 1;
    } catch (error) {
      errors.push({ rule: rule.title, action: "create", message: error.message });
    }
  }

  return {
    status: errors.length > 0 ? "partial" : "success",
    queuesCreated,
    created,
    updated,
    unchanged: diff.unchanged,
    removed,
    errors,
  };
}

/* ---------------- Orquestração ---------------- */

const STEP_DEFINITIONS = [
  { key: "flow", label: "Fluxo", run: cloneFlow },
  { key: "queues", label: "Filas", run: cloneQueues },
  { key: "attendanceRules", label: "Regras de atendimento", run: cloneAttendanceRules },
  { key: "attendants", label: "Atendentes", run: cloneAttendants },
  { key: "quickReplies", label: "Respostas prontas", run: cloneQuickReplies },
  { key: "tags", label: "Tags", run: cloneTags },
  { key: "configVariables", label: "Variáveis de configuração", run: cloneConfigVariables },
  { key: "priorityRules", label: "Regras de priorização", run: clonePriorityRules },
];

async function cloneBot(params) {
  const { sourceRouterKey, targetRouterKey, options } = params || {};
  validateRouterKey(sourceRouterKey, "sourceRouterKey");
  validateRouterKey(targetRouterKey, "targetRouterKey");

  if (sourceRouterKey === targetRouterKey) {
    throw new InputError("Origem e destino não podem ser o mesmo router.");
  }

  const selectedSteps = STEP_DEFINITIONS.filter((step) => options && options[step.key]);
  if (selectedSteps.length === 0) {
    throw new InputError("Selecione pelo menos um item para clonar.");
  }

  const steps = [];
  for (const step of selectedSteps) {
    try {
      const detail = await step.run(sourceRouterKey, targetRouterKey);
      steps.push({ key: step.key, label: step.label, status: detail?.status || "success", detail });
    } catch (error) {
      steps.push({ key: step.key, label: step.label, status: "error", message: error.message });
    }
  }

  return {
    totals: {
      requested: steps.length,
      succeeded: steps.filter((step) => step.status === "success").length,
      partial: steps.filter((step) => step.status === "partial").length,
      failed: steps.filter((step) => step.status === "error").length,
    },
    steps,
  };
}

async function identifyBot(params) {
  const { routerKey } = params || {};
  validateRouterKey(routerKey, "routerKey");

  const identity = await getBotIdentity(routerKey);

  return { identity: identity.replace(/@msging\.net$/, "") };
}

module.exports = {
  InputError,
  cloneBot,
  identifyBot,
};
