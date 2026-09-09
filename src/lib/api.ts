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
