import React, { useEffect, useRef, useState } from "react";

type Pending = { message: string; resolve: (value: boolean) => void };

export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("ems-confirm", { detail: { message, resolve } }));
  });
}

export default function ConfirmDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onConfirm(event: Event) {
      const detail = (event as CustomEvent<Pending>).detail;
      if (!detail?.message || typeof detail.resolve !== "function") return;
      setPending((current) => {
        if (current) current.resolve(false);
        return detail;
      });
    }
    window.addEventListener("ems-confirm", onConfirm);
    return () => window.removeEventListener("ems-confirm", onConfirm);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function finish(value: boolean) {
      setPending((current) => {
        current?.resolve(value);
        return null;
      });
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>("button");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [pending]);

  if (!pending) return null;

  function finish(value: boolean) {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }

  return (
    <div className="confirm-backdrop">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        ref={dialogRef}
      >
        <h2 id="confirm-title" className="card-title">
          Please confirm
        </h2>
        <p id="confirm-body">{pending.message}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-outline" onClick={() => finish(false)}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => finish(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
