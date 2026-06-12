import { BLIP_ACTIONS } from "./blipActions";

type IframeMessageProxyModule = typeof import("iframe-message-proxy");

type PortalMessageOptions = {
  caller?: string;
  responseTimeout?: number;
};

type BlipCommandOptions = {
  destination?: string;
  responseTimeout?: number;
  timeout?: number;
};

type BlipAlertParams = {
  variant: string;
  icon: string;
  title: string;
  body: string;
  buttons: {
    cancel?: string;
    confirm: string;
  };
};

export interface GetAccountResponse {
  fullName: string;
  alternativeAccount: string;
  identity: string;
  email: string;
  phoneNumber: string;
  photoUri: string;
  timeZoneName: string;
  culture: string;
  creationDate: string;
}

let proxyModulePromise: Promise<IframeMessageProxyModule> | null = null;
let started = false;

function canUseIframeProxy() {
  return typeof window !== "undefined" && window.parent !== window;
}

async function getIframeMessageProxy() {
  if (!canUseIframeProxy()) return null;

  proxyModulePromise ??= import("iframe-message-proxy");
  const { IframeMessageProxy } = await proxyModulePromise;

  if (!started) {
    IframeMessageProxy.listen();
    started = true;
  }

  return IframeMessageProxy;
}

export async function startIframeMessageProxy() {
  await getIframeMessageProxy();
}

function withResponseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  action: string,
) {
  if (!timeoutMs) return promise;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Tempo esgotado aguardando resposta do Portal BLiP para ${action}.`));
    }, timeoutMs);

    promise.then(
      (result) => {
        window.clearTimeout(timeoutId);
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function unwrapPortalResponse(result: unknown) {
  if (result && typeof result === "object" && "response" in result) {
    return (result as { response: unknown }).response;
  }

  return result;
}

export async function sendPortalMessage(
  action: string,
  content: unknown = null,
  options: PortalMessageOptions = {},
) {
  const iframeMessageProxy = await getIframeMessageProxy();
  if (!iframeMessageProxy) {
    throw new Error("Comandos do Portal BLiP só estão disponíveis dentro do iframe.");
  }

  const { responseTimeout, ...messageOptions } = options;
  const result = await withResponseTimeout(
    iframeMessageProxy.sendMessage({
      action,
      content,
      ...messageOptions,
    }),
    responseTimeout,
    action,
  );

  return unwrapPortalResponse(result);
}

export function notifyPortalMessage(action: string, content: unknown) {
  void getIframeMessageProxy().then((iframeMessageProxy) => {
    iframeMessageProxy?.sendMessage({
      action,
      content,
      fireAndForget: true,
    });
  });
}

export function getAccount() {
  return sendPortalMessage(BLIP_ACTIONS.GET_ACCOUNT, null, {
    responseTimeout: 10000,
  }) as Promise<GetAccountResponse>;
}

export function getCurrentApplication() {
  return sendPortalMessage(BLIP_ACTIONS.GET_APPLICATION, null, {
    responseTimeout: 10000,
  });
}

export async function showBlipAlert(params: BlipAlertParams) {
  if (!canUseIframeProxy()) {
    return window.confirm(`${params.title}\n\n${params.body}`);
  }

  const { blip } = await import("blip-iframe");
  const response = await blip.showAlert(params);

  if (!response.success) {
    throw new Error(response.error?.message || "Erro ao exibir alerta do Portal BLiP.");
  }

  return Boolean(response.data);
}

export function sendBlipCommand(command: unknown, options: BlipCommandOptions = {}) {
  const timeout = options.timeout ?? 30000;

  return sendPortalMessage(
    BLIP_ACTIONS.SEND_COMMAND,
    {
      command,
      destination: options.destination,
      timeout,
    },
    { responseTimeout: options.responseTimeout ?? timeout },
  );
}
