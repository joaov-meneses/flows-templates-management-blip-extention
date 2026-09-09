import { useEffect, useRef } from "react";

/** One focus/scroll policy for all extension dialogs, including nested dialogs. */
export function useModalFocus(activeId: string | null, onClose: () => void) {
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef<string | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!activeId) {
      previous.current = null;
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
      return;
    }
    if (!previous.current)
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previous.current = activeId;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-modal-id="${activeId}"]`)
        ?.focus({ preventScroll: true }),
    );

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const modal = document.querySelector<HTMLElement>(`[data-modal-id="${activeId}"]`);
      if (!modal) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) => !element.hasAttribute("aria-hidden") && element.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        modal.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === modal)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeId]);
}
