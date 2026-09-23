/** Shared transport: reject proxy HTML and empty responses with actionable feedback. */
export async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
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
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "A sessão expirou. Abra novamente a extensão pelo Portal Blip.",
      403: "Você não tem permissão para esta ação. Confira o acesso ao router selecionado.",
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
    "/api/flows/search": "flows",
    "/api/plugins/search": "plugins",
  }[path];
  if (collection && (!Array.isArray(data[collection]) || typeof data.total !== "number")) {
    throw new Error("A lista recebida do servidor está incompleta. Tente buscar novamente.");
  }
  return data as TResponse;
}

export type OperationProgress = {
  processed: number;
  total: number;
  stage: string;
};

/** Read acknowledged item counts; never infer completion from elapsed time. */
export async function postJsonWithProgress<TResponse>(
  path: string,
  body: unknown,
  onProgress: (progress: OperationProgress) => void,
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
  if (!response.ok || !response.body) {
    throw new Error(`Não foi possível iniciar a operação (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TResponse | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error("O servidor enviou uma atualização de progresso inválida.");
    }
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
