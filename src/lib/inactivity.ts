import type { InactivityBlock } from "../types/inactivity.ts";

export function validInactivityMinutes(value: string) {
  return (
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0 &&
    Number(value) < 1380
  );
}

export function expirationMinutes(expiration: string | null): number | null {
  if (!expiration) return null;
  const match = /^(\d+):(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(expiration);
  if (!match || Number(match[2]) >= 60 || Number(match[3] || 0) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
}

export function expirationGroup(expiration: string | null) {
  if (!expiration) return "empty";
  const minutes = expirationMinutes(expiration);
  return minutes === null ? `raw:${expiration}` : `minutes:${minutes}`;
}

export function expirationLabel(expiration: string | null) {
  if (!expiration) return "Sem inatividade";
  const minutes = expirationMinutes(expiration);
  return minutes === null
    ? expiration
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(minutes)} min`;
}

export function groupInactivity(bots: Array<{ blocks: InactivityBlock[] }>) {
  const groups = new Map<
    string,
    { key: string; expiration: string | null; blocks: number; bots: number }
  >();
  for (const bot of bots) {
    const seen = new Set<string>();
    for (const block of bot.blocks) {
      const key = expirationGroup(block.expiration);
      const group = groups.get(key) || { key, expiration: block.expiration, blocks: 0, bots: 0 };
      group.blocks++;
      if (!seen.has(key)) group.bots++;
      seen.add(key);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      (expirationMinutes(a.expiration) ?? Infinity) - (expirationMinutes(b.expiration) ?? Infinity),
  );
}
