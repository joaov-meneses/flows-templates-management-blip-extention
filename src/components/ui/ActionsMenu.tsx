import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "./Button";

export type MenuAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
};

/** Native top-layer popover: never clipped by scrollable tables or modal bodies. */
export function ActionsMenu({
  label = "Mais ações",
  compact = false,
  disabled,
  actions,
}: {
  label?: string;
  compact?: boolean;
  disabled?: boolean;
  actions: MenuAction[];
}) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
  const close = (restore = true) => {
    menu.current?.hidePopover();
    if (restore) trigger.current?.querySelector("button")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      menu.current?.hidePopover();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function show() {
    if (open) {
      close();
      return;
    }
    const panel = menu.current;
    const anchor = trigger.current?.getBoundingClientRect();
    if (!panel || !anchor) return;
    panel.showPopover();
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, anchor.bottom + rect.height + 8 > window.innerHeight ? anchor.top - rect.height - 6 : anchor.bottom + 6)}px`;
    items()[0]?.focus();
  }

  return (
    <span className="actions-menu" ref={trigger}>
      <Button
        variant={compact ? "ghost" : "secondary"}
        size={compact ? "sm" : "md"}
        className={compact ? "icon-only" : ""}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open}
        disabled={disabled}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
        {!compact && label}
      </Button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        className="actions-popover"
        onToggle={(event) => setOpen(event.newState === "open")}
        onKeyDown={(event) => {
          const buttons = items();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            close();
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }
        }}
      >
        {actions
          .filter((action) => !action.hidden)
          .map((action) => (
            <button
              type="button"
              role="menuitem"
              key={action.label}
              disabled={action.disabled}
              className={action.danger ? "danger" : ""}
              onClick={() => {
                close();
                action.onSelect();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
      </div>
    </span>
  );
}
