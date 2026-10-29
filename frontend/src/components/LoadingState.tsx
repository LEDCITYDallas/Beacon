import React from "react";

export default function LoadingState({ label }: { label: string }) {
  return (
    <div className="skeleton-block" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <span className="skeleton-line w-40" />
      <span className="skeleton-line" />
      <span className="skeleton-line w-70" />
    </div>
  );
}
