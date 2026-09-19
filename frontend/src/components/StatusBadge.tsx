import React from "react";
import { TaskStatus } from "../types";

const LABELS: Record<TaskStatus, string> = {
  BLOCKED: "Blocked",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  PAUSED: "Paused",
  COMPLETED: "Completed",
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>{LABELS[status]}</span>
  );
}
