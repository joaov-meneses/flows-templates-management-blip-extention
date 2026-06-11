declare module "iframe-message-proxy" {
  export interface IMessagePayload {
    action: string;
    content?: unknown;
    caller?: string;
    fireAndForget?: boolean;
  }

  export interface IframeMessageProxyInstance {
    listen(): void;
    stopListen(): void;
    sendMessage(payload: IMessagePayload): Promise<unknown>;
  }

  export const IframeMessageProxy: IframeMessageProxyInstance;
}
