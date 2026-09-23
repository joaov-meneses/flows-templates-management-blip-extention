const KNOWN_ENVIRONMENT_PREFIXES = [
  "development",
  "homolog",
  "staging",
  "production",
  "prod",
  "prd",
  "dev",
  "hmg",
  "hml",
  "lab",
  "qa",
  "uat",
  "sandbox",
];

export type BulkBotNamePlan = {
  sourceShortName: string;
  sourceName: string;
  sourceTag: string | null;
  targetShortName: string;
  targetName: string;
};

export function normalizeEnvironmentTag(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function formatEnvironmentTag(value: string) {
  const normalized = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .trim();
  return normalized ? `[${normalized.toUpperCase()}]` : "";
}

export function extractEnvironmentTag(name: string) {
  const match = name.trim().match(/^\[([^\]]+)\]\s*/);
  const tag = match?.[1]?.trim();
  return tag && KNOWN_ENVIRONMENT_PREFIXES.includes(normalizeEnvironmentTag(tag)) ? tag : null;
}

export function replaceEnvironmentName(sourceName: string, targetTag: string) {
  const formattedTag = formatEnvironmentTag(targetTag);
  const sourceTag = extractEnvironmentTag(sourceName);
  const baseName = sourceTag
    ? sourceName
        .trim()
        .replace(/^\[[^\]]+\]\s*/, "")
        .trim()
    : sourceName.trim();
  return formattedTag ? `${formattedTag} ${baseName || sourceName.trim()}` : baseName;
}

function detectShortNamePrefix(shortName: string, sourceTag: string | null) {
  const normalizedSourceTag = normalizeEnvironmentTag(sourceTag || "");
  if (normalizedSourceTag && shortName.startsWith(normalizedSourceTag)) {
    return normalizedSourceTag;
  }
  return "";
}

export function replaceEnvironmentShortName(
  sourceShortName: string,
  sourceName: string,
  targetTag: string,
) {
  const targetPrefix = normalizeEnvironmentTag(targetTag);
  const normalizedSource = sourceShortName.trim().toLowerCase();
  if (!targetPrefix) return normalizedSource;

  const sourcePrefix = detectShortNamePrefix(normalizedSource, extractEnvironmentTag(sourceName));
  const suffix = sourcePrefix ? normalizedSource.slice(sourcePrefix.length) : normalizedSource;
  return `${targetPrefix}${suffix}`;
}

export function buildBulkBotNamePlan(
  source: { shortName: string; name: string },
  targetTag: string,
): BulkBotNamePlan {
  return {
    sourceShortName: source.shortName,
    sourceName: source.name,
    sourceTag: extractEnvironmentTag(source.name),
    targetShortName: replaceEnvironmentShortName(source.shortName, source.name, targetTag),
    targetName: replaceEnvironmentName(source.name, targetTag),
  };
}

export function suggestTargetEnvironmentTag(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) {
    const tag = extractEnvironmentTag(name);
    if (!tag) continue;
    const normalized = normalizeEnvironmentTag(tag);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant === "dev" || dominant === "development") return "PRD";
  if (dominant === "prd" || dominant === "prod" || dominant === "production") return "DEV";
  if (dominant === "hmg" || dominant === "homolog" || dominant === "staging") return "PRD";
  return "";
}

export function validateBulkTargetShortName(value: string) {
  if (!/^[a-z][a-z0-9-]{1,59}$/.test(value)) {
    return "Use de 2 a 60 caracteres: letra minúscula no início, letras, números ou hífen.";
  }
  return "";
}
