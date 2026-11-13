import { sendSensitiveBlipCommand } from "./blipProxy.ts";

const KEY_URI = "/account/keys";
const PAGE_SIZE = 100;
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type UserAccessKey = {
  id: string;
  purpose?: string;
  creationDate?: string;
  expiration?: string;
  requirer?: string;
  temporary: boolean;
};

type KeyRequest = { purpose?: string; temporary?: boolean; ttl?: number };
type Command = {
  method: "get" | "set" | "delete";
  uri: string;
  type?: string;
  resource?: KeyRequest;
};

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function readKey(value: unknown): UserAccessKey {
  const row = readRecord(value);
  const id = readText(row?.id);
  if (!row || !id) throw new Error("O Portal retornou uma chave sem ID.");
  return {
    id,
    purpose: readText(row.purpose),
    creationDate: readText(row.creationDate),
    expiration: readText(row.expiration),
    requirer: readText(row.requirer),
    temporary: row.temporary === true,
  };
}

function readReasonCode(error: unknown): number | undefined {
  if (typeof error === "string") {
    try {
      return readReasonCode(JSON.parse(error));
    } catch {
      return;
    }
  }
  const value = readRecord(error);
  const code = value?.code ?? readRecord(value?.reason)?.code;
  return typeof code === "number" ? code : undefined;
}

class KeyCommandError extends Error {
  constructor(readonly code: number | undefined) {
    super(
      code
        ? `O Portal recusou a operação (código ${code}).`
        : "A resposta do Portal não confirmou a operação.",
    );
  }
}

async function command(request: Command) {
  try {
    const result = await sendSensitiveBlipCommand({
      id: crypto.randomUUID(),
      to: "postmaster@blip.ai",
      ...request,
    });
    const envelope = readRecord(result);
    if (envelope?.status === "failure") throw envelope;
    return envelope?.status === "success" ? envelope.resource : result;
  } catch (error) {
    throw new KeyCommandError(readReasonCode(error));
  }
}

export async function listUserAccessKeys(signal?: AbortSignal): Promise<UserAccessKey[]> {
  const keys = new Map<string, UserAccessKey>();
  let skip = 0;

  for (;;) {
    if (signal?.aborted) throw signal.reason;
    const resource = await command({
      method: "get",
      uri: `${KEY_URI}?$take=${PAGE_SIZE}&$skip=${skip}`,
    }).catch((error: KeyCommandError) => {
      if (error.code === 67) return { items: [] };
      throw error;
    });
    const collection = readRecord(resource);
    const items = collection?.items ?? collection?.data;
    if (!Array.isArray(items)) throw new Error("O Portal retornou uma lista de chaves inválida.");
    if (!items.length) break;

    const previousSize = keys.size;
    for (const item of items) {
      const key = readKey(item);
      keys.set(key.id, key);
    }
    if (keys.size === previousSize)
      throw new Error("O Portal repetiu uma página da lista de chaves.");

    skip += items.length;
    const total = collection?.total;
    if (typeof total === "number" && skip >= total) break;
    if (typeof total !== "number" && items.length < PAGE_SIZE) break;
  }

  return [...keys.values()];
}

export async function createUserAccessKey(request: KeyRequest) {
  const resource = await command({
    method: "set",
    uri: KEY_URI,
    type: "application/vnd.iris.keyRequest+json",
    resource: request,
  });
  const secret = readText(readRecord(resource)?.key);
  if (!secret) throw new Error("O Portal não retornou o valor da nova chave.");
  return { key: readKey(resource), secret };
}

export async function revokeUserAccessKey(id: string) {
  await command({ method: "delete", uri: `${KEY_URI}/${encodeURIComponent(id)}` });
}

export function keyTtlMilliseconds(hours: string) {
  if (!hours.trim()) return undefined;
  const ttl = Math.round(Number(hours) * 3_600_000);
  if (!Number.isSafeInteger(ttl) || ttl <= 0)
    throw new Error("Informe um prazo em horas maior que zero.");
  return ttl;
}

export function getKeyExpiration(expiration: string | undefined, now: number) {
  const expiresAt = expiration ? Date.parse(expiration) : NaN;
  if (expiresAt <= now) return "expired";
  if (expiresAt - now <= EXPIRING_SOON_MS) return "expiring-soon";
  return "active";
}
