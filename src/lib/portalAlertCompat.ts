import { IframeMessageProxy } from "iframe-message-proxy";

// Compatibility for open tabs whose lazy blip-iframe chunk belonged to an older release.
// This entry is built in isolation, so it never imports a hashed application chunk.
let listening = false;

export const blip = {
  async showAlert(params: unknown) {
    try {
      if (!listening) {
        IframeMessageProxy.listen();
        listening = true;
      }
      const result = await IframeMessageProxy.sendMessage({
        action: "showAlert",
        content: params,
      });
      const response =
        result && typeof result === "object" && "response" in result ? result.response : undefined;
      if (typeof response !== "boolean")
        throw new Error("Resposta inválida da confirmação do Portal Blip.");
      return { success: true as const, data: response };
    } catch (error) {
      return {
        success: false as const,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível confirmar a ação no Portal Blip.",
        },
      };
    }
  },
};
