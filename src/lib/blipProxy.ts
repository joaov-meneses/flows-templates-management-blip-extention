type IframeMessageProxyModule = typeof import("iframe-message-proxy");

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

export function notifyPortalMessage(action: string, content: unknown) {
  void getIframeMessageProxy().then((iframeMessageProxy) => {
    iframeMessageProxy?.sendMessage({
      action,
      content,
      fireAndForget: true,
    });
  });
}
