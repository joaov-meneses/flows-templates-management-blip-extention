import { type RefObject, useEffect, useMemo } from "react";
import { BLIP_ACTIONS } from "../lib/blipActions";
import { notifyPortalMessage, startIframeMessageProxy } from "../lib/blipProxy";

const MIN_IFRAME_HEIGHT = 900;
const IFRAME_HEIGHT_OFFSET = 24;

function getExtensionContentHeight(element: HTMLElement) {
  return Math.ceil(
    Math.max(element.scrollHeight, element.offsetHeight, element.getBoundingClientRect().height),
  );
}

function getRequestedIframeHeight(element: HTMLElement) {
  return Math.max(MIN_IFRAME_HEIGHT, getExtensionContentHeight(element) + IFRAME_HEIGHT_OFFSET);
}

export function useIframeAutoHeight(shellRef: RefObject<HTMLElement | null>) {
  const isInsideIframe = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.parent !== window;
  }, []);

  useEffect(() => {
    if (!isInsideIframe) return;
    void startIframeMessageProxy();
  }, [isInsideIframe]);

  useEffect(() => {
    const shellElement = shellRef.current;
    if (!isInsideIframe || !shellElement) return undefined;

    shellElement.classList.add("ember-shell--embedded");

    let animationFrameId: number | null = null;
    let retryTimeoutId: number | null = null;
    let lastRequestedHeight = 0;

    function requestHeightChange() {
      animationFrameId = null;

      const height = getRequestedIframeHeight(shellElement);
      if (height === lastRequestedHeight) return;

      lastRequestedHeight = height;
      notifyPortalMessage(BLIP_ACTIONS.HEIGHT_CHANGE, height);
    }

    function scheduleHeightChange() {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(requestHeightChange);
    }

    scheduleHeightChange();
    retryTimeoutId = window.setTimeout(scheduleHeightChange, 300);

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleHeightChange);

    resizeObserver?.observe(shellElement);
    window.addEventListener("resize", scheduleHeightChange);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleHeightChange);
      shellElement.classList.remove("ember-shell--embedded");
    };
  }, [isInsideIframe, shellRef]);
}
