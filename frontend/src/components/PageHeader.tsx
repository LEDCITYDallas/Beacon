import React from "react";

// Shared page frame. Pages keep their own data and actions; this only
// places the title, description, and optional controls in one rhythm.
export default function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-head">
        <h1 className="page-title">
          {title}
          {meta}
        </h1>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {description ? <div className="page-sub">{description}</div> : null}
    </header>
  );
}
