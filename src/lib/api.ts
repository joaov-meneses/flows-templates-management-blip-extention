import { finishActivity, startActivity } from "./activityLog.ts";

type RequestTrace = {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  error?: unknown;
};

function newTrace(path: string, body: unknown): RequestTrace {
  const serialized = JSON.stringify(body);
  return {
    request: {
      method: "POST",
      url: path,
      headers: { "Content-Type": "application/json" },
      body: serialized === undefined ? null : JSON.parse(serialized),
    },
  };
}

function traceResponse(trace: RequestTrace, response: Response) {
  trace.response = {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

async function readResponse(response: Response, trace: RequestTrace) {
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  trace.response!.body = data === null ? raw : data;
  return data;
}

/** Shared transport: reject proxy HTML and empty responses with actionable feedback. */
async function postJsonInternal<TResponse>(
  path: string,
  body: unknown,
  trace: RequestTrace,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "A conexão com o servidor foi interrompida. Verifique sua conexão. Se você enviou uma alteração, atualize a lista para conferir o resultado antes de repetir.",
    );
  }
  traceResponse(trace, response);
  const data = await readResponse(response, trace);
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "A sessão expirou. Abra novamente a extensão pelo Portal Blip.",
      403: `Você não tem permissão para esta ação. Confira o acesso ao ${path.startsWith("/api/builders/") ? "Builder" : "router"} selecionado.`,
      429: "Muitas solicitações em sequência. Aguarde alguns instantes antes de tentar novamente.",
      502: "O serviço está temporariamente indisponível. Aguarde e tente novamente.",
      503: "O serviço está temporariamente indisponível. Aguarde e tente novamente.",
      504: "O serviço demorou para responder. Confira o resultado na lista antes de repetir a operação.",
    };
    throw new Error(
      messages[response.status] ||
        data?.error?.message ||
        `Não foi possível concluir a solicitação (HTTP ${response.status}). Tente novamente em instantes.`,
    );
  }
  if (!data || typeof data !== "object")
    throw new Error(
      "O servidor retornou uma resposta inesperada. Atualize a lista para conferir o resultado antes de repetir a operação.",
    );
  const collection = {
    "/api/templates/search": "templates",
    "/api/templates/catalog": "templates",
    "/api/flows/search": "flows",
    "/api/plugins/search": "plugins",
  }[path];
  if (collection && (!Array.isArray(data[collection]) || typeof data.total !== "number")) {
    throw new Error("A lista recebida do servidor está incompleta. Tente buscar novamente.");
  }
  return data as TResponse;
}

export async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const trace = newTrace(path, body);
  const activityId = startActivity("request", `POST ${path}`, trace);
  try {
    const result = await postJsonInternal<TResponse>(path, body, trace);
    finishActivity(activityId, "success", "Resposta recebida", trace);
    return result;
  } catch (error) {
    finishActivity(
      activityId,
      "error",
      error instanceof Error ? error.message : "Falha na requisição",
      { ...trace, error },
    );
    throw error;
  }
}

export type OperationProgress = {
  processed: number;
  total: number;
  stage: string;
};

/** Read acknowledged item counts; never infer completion from elapsed time. */
async function postJsonWithProgressInternal<TResponse>(
  path: string,
  body: unknown,
  onProgress: (progress: OperationProgress) => void,
  trace: RequestTrace,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Conexão interrompida. Confira o resultado nos destinos antes de repetir.");
  }
  traceResponse(trace, response);
  if (!response.ok || !response.body) {
    await readResponse(response, trace);
    throw new Error(`Não foi possível iniciar a operação (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TResponse | undefined;
  const events: unknown[] = [];
  trace.response!.body = events;
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      events.push(line);
      throw new Error("O servidor enviou uma atualização de progresso inválida.");
    }
    events.push(event);
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("O servidor enviou uma atualização de progresso inválida.");
    }
    if (event.kind === "error") {
      throw new Error(typeof event.message === "string" ? event.message : "Operação interrompida.");
    }
    if (event.kind === "progress") {
      const processed = Number(event.processed);
      const total = Number(event.total);
      if (
        !Number.isInteger(processed) ||
        !Number.isInteger(total) ||
        processed < 0 ||
        total < 0 ||
        processed > total
      ) {
        throw new Error("O servidor enviou uma contagem de progresso inválida.");
      }
      onProgress({ processed, total, stage: String(event.stage ?? "Processando") });
    }
    if (event.kind === "result") result = event.data as TResponse;
  };

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new Error("Conexão interrompida. Confira o resultado nos destinos antes de repetir.");
      }
      const { value, done } = chunk;
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    consume(buffer);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Conexão interrompida. Confira o resultado nos destinos antes de repetir.");
  } finally {
    reader.releaseLock();
  }
  if (result === undefined) {
    throw new Error("A conexão terminou sem resultado. Confira os destinos antes de repetir.");
  }
  return result;
}

export async function postJsonWithProgress<TResponse>(
  path: string,
  body: unknown,
  onProgress: (progress: OperationProgress) => void,
): Promise<TResponse> {
  const trace = newTrace(path, body);
  const activityId = startActivity("request", `POST ${path}`, trace);
  try {
    const result = await postJsonWithProgressInternal<TResponse>(path, body, onProgress, trace);
    finishActivity(activityId, "success", "Operação concluída", trace);
    return result;
  } catch (error) {
    finishActivity(
      activityId,
      "error",
      error instanceof Error ? error.message : "Falha na operação",
      { ...trace, error },
    );
    throw error;
  }
}
