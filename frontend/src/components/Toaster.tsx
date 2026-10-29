import React, { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "warning" | "info";

type ToastItem = { id: number; kind: ToastKind; message: string; leaving?: boolean };

export function notify(kind: ToastKind, message: string) {
  window.dispatchEvent(new CustomEvent("ems-toast", { detail: { kind, message } }));
}

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ kind?: ToastKind; message?: string }>).detail;
      const message = String(detail?.message || "").trim();
      if (!message) return;
      const kind = detail?.kind || "info";
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((current) => [...current.slice(-3), { id, kind, message }]);
      const life = kind === "error" ? 6500 : 4200;
      window.setTimeout(() => {
        setItems((current) => current.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      }, life);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, life + 180);
    }
    window.addEventListener("ems-toast", onToast);
    return () => window.removeEventListener("ems-toast", onToast);
  }, []);

  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <p
          key={item.id}
          className={`toast toast-${item.kind}${item.leaving ? " is-leaving" : ""}`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          {item.message}
        </p>
      ))}
    </div>
  );
}
