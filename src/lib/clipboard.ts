export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Iframes can expose Clipboard API while blocking it by permissions policy.
    }
  }

  const ta = document.createElement("textarea");
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(ta);
  window.scrollTo(scrollX, scrollY);

  if (!copied) {
    throw new Error("Não foi possível copiar para a área de transferência.");
  }
}
