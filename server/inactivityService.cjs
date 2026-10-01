const { randomUUID, createHash } = require("node:crypto");

const WORKING_FLOW_URI = "/buckets/blip_portal:builder_working_flow";
const SKIP_BLOCKS = ["onboarding", "fallback", "error"];

class InactivityInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function validateMinutes(minutes) {
  // The Addons form accepts any numeric time strictly between 0 and 1380.
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0 || minutes >= 1380) {
    throw new InactivityInputError("Informe um tempo maior que zero e menor que 1380 minutos.");
  }
}

function convertToHours(minutes) {
  return `${Math.floor(minutes / 60)}:${minutes % 60}`;
}

function eligibleEntries(flow) {
  // Mirrors SetInactivity: Object.values(flow), block.id, first input, !bypass.
  return Object.entries(flow).flatMap(([blockKey, block]) => {
    if (!block || SKIP_BLOCKS.includes(block.id) || !Array.isArray(block.$contentActions))
      return [];
    const action = block.$contentActions.find((item) => item && item.input);
    if (!action || action.input.bypass) return [];
    return [{ blockKey, block, input: action.input }];
  });
}

function revisionOf(flow) {
  return createHash("sha256").update(JSON.stringify(flow)).digest("hex");
}

function describeFlow(flow) {
  const blocks = eligibleEntries(flow).map(({ blockKey, block, input }) => ({
    blockKey,
    id: block.id || blockKey,
    title: block.$title || block.id || blockKey,
    expiration: input.expiration || null,
  }));
  return {
    revision: revisionOf(flow),
    totalBlocks: Object.values(flow).filter(
      (block) => block && typeof block === "object" && Array.isArray(block.$contentActions),
    ).length,
    eligibleBlocks: blocks.length,
    configuredBlocks: blocks.filter((block) => block.expiration).length,
    blocks,
  };
}

async function command(builderKey, method, resource) {
  if (typeof builderKey !== "string" || !builderKey.trim()) {
    throw new InactivityInputError("Selecione um Builder com key válida.");
  }
  const response = await fetch("https://msging.net/commands", {
    method: "POST",
    headers: { Authorization: builderKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: randomUUID(),
      method,
      uri: WORKING_FLOW_URI,
      ...(method === "set" ? { type: "application/json", resource } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "success") {
    throw new Error(
      data?.reason?.description ||
        `Não foi possível ${method === "get" ? "ler" : "salvar"} o rascunho do Builder (HTTP ${response.status}).`,
    );
  }
  return data.resource;
}

async function readFlow(builderKey) {
  let flow = await command(builderKey, "get");
  if (typeof flow === "string") {
    try {
      flow = JSON.parse(flow);
    } catch {
      throw new Error("O rascunho do Builder contém um JSON inválido.");
    }
  }
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw new Error("O Builder não retornou um rascunho de fluxo válido.");
  }
  return flow;
}

async function analyzeInactivity({ builderKey } = {}) {
  return describeFlow(await readFlow(builderKey));
}

async function applyInactivity({
  builderKey,
  revision,
  minutes,
  blockKeys,
  overrides = {},
  keepExisting = false,
} = {}) {
  validateMinutes(minutes);
  if (
    typeof revision !== "string" ||
    !revision ||
    !Array.isArray(blockKeys) ||
    !blockKeys.length ||
    blockKeys.some((key) => typeof key !== "string")
  ) {
    throw new InactivityInputError("Analise o bot e selecione os blocos antes de aplicar.");
  }
  if (
    typeof keepExisting !== "boolean" ||
    !overrides ||
    typeof overrides !== "object" ||
    Array.isArray(overrides)
  ) {
    throw new InactivityInputError("Opções de inatividade inválidas.");
  }
  const selected = new Set(blockKeys);
  for (const [key, value] of Object.entries(overrides)) {
    if (!selected.has(key))
      throw new InactivityInputError("Há um tempo individual para um bloco não selecionado.");
    validateMinutes(value);
  }
  // Re-read the draft instead of trusting a client copy of the entire flow.
  const flow = await readFlow(builderKey);
  if (revisionOf(flow) !== revision) {
    throw new InactivityInputError(
      "O rascunho mudou desde a análise. Atualize este bot e revise os blocos antes de aplicar.",
      409,
    );
  }
  const entries = eligibleEntries(flow);
  if (blockKeys.some((key) => !entries.some((entry) => entry.blockKey === key))) {
    throw new InactivityInputError(
      "A seleção contém blocos fora da regra de inatividade do Addons.",
    );
  }
  let updated = 0;
  let kept = 0;
  for (const { blockKey, input } of entries) {
    if (!selected.has(blockKey)) continue;
    if (keepExisting && input.expiration) {
      kept++;
      continue;
    }
    const expiration = convertToHours(
      Object.hasOwn(overrides, blockKey) ? overrides[blockKey] : minutes,
    );
    if (input.expiration === expiration) continue;
    input.expiration = expiration;
    updated++;
  }
  if (updated) {
    await command(builderKey, "set", flow);
    const verified = await readFlow(builderKey);
    if (revisionOf(verified) !== revisionOf(flow)) {
      throw new Error(
        "A leitura após salvar não confirmou o rascunho. Atualize este bot para conferir o resultado antes de repetir.",
      );
    }
  }
  return { ...describeFlow(flow), updated, kept, published: false };
}

module.exports = {
  InactivityInputError,
  analyzeInactivity,
  applyInactivity,
  eligibleEntries,
  convertToHours,
};
