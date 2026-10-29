export type TaskStatus = "BLOCKED" | "READY" | "IN_PROGRESS" | "PAUSED" | "COMPLETED";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface CompletionEvidence {
  source: string;
  externalId: string;
  summary: string;
  evidenceUrl: string;
  occurredAt: string | null;
}

export interface Task {
  _id: string;
  title: string;
  description: string;
  definitionOfDone: string;
  priority: Priority;
  estimatedHours: number;
  dueDate: string;
  department: string;
  assignedTo: { _id: string; name: string; email: string } | string;
  status: TaskStatus;
  dependsOn: { _id: string; title: string; status: TaskStatus }[];
  blockedReason?: { type: "WAITING_ON_OTHER" | "NOT_CONFIDENT"; note: string };
  pendingCompletionProposal?: {
    isPending: boolean;
    detectedSignal: string;
    confidence?: number;
    evidence?: CompletionEvidence;
  };
  overrunAlertFired: boolean;
  flagged?: boolean;
  flagNote?: string;
  reopenCount?: number;
  timeline?: TimelineEvent[];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface TimelineEvent {
  event: string;
  timestamp: string;
  actor?: string | null;
}
