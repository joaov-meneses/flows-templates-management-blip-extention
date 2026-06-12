import { type RefObject, useEffect, useState } from "react";
import { BLIP_ACTIONS } from "../lib/blipActions";
import { notifyPortalMessage, startIframeMessageProxy } from "../lib/blipProxy";

const MIN_IFRAME_HEIGHT = 900;
const IFRAME_HEIGHT_OFFSET = 24;
const HEIGHT_CHANGE_RETRY_DELAYS = [300, 1000, 2500];

function getExtensionContentHeight(element: HTMLElement) {
  return Math.ceil(
    Math.max(element.scrollHeight, element.offsetHeight, element.getBoundingClientRect().height),
  );
}

function getRequestedIframeHeight(element: HTMLElement) {
  return Math.max(MIN_IFRAME_HEIGHT, getExtensionContentHeight(element) + IFRAME_HEIGHT_OFFSET);
}

export function useIframeAutoHeight(shellRef: RefObject<HTMLElement | null>) {
  const [isInsideIframe, setIsInsideIframe] = useState(false);

  useEffect(() => {
    setIsInsideIframe(window.parent !== window);
  }, []);

  useEffect(() => {
    if (!isInsideIframe) return;
    void startIframeMessageProxy();
  }, [isInsideIframe]);

  useEffect(() => {
    const shellElement = shellRef.current;
    if (!isInsideIframe || !shellElement) return undefined;

    let animationFrameId: number | null = null;
    const retryTimeoutIds: number[] = [];
    let lastRequestedHeight = 0;

    function requestHeightChange(force = false) {
      animationFrameId = null;

      const height = getRequestedIframeHeight(shellElement);
      if (!force && height === lastRequestedHeight) return;

      lastRequestedHeight = height;
      notifyPortalMessage(BLIP_ACTIONS.HEIGHT_CHANGE, height);
    }

    function scheduleHeightChange(force = false) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => requestHeightChange(force));
    }

    scheduleHeightChange(true);
    retryTimeoutIds.push(
      ...HEIGHT_CHANGE_RETRY_DELAYS.map((delay) =>
        window.setTimeout(() => scheduleHeightChange(true), delay),
      ),
    );

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleHeightChange);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => scheduleHeightChange(true));

    resizeObserver?.observe(shellElement);
    mutationObserver?.observe(shellElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    window.addEventListener("resize", scheduleHeightChange);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      retryTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleHeightChange);
    };
  }, [isInsideIframe, shellRef]);

  return isInsideIframe;
}
