export type BulkFilters = {
  queueId: string | null;
  status: "active" | "Open" | "Waiting" | "Assigned";
  assignment: "any" | "assigned" | "unassigned";
  createdFrom: string | null;
  createdTo: string | null;
  minimumAgeHours: number | null;
  lastInputFrom: string | null;
  lastInputTo: string | null;
  minimumInactivityHours: number | null;
};
export type BulkTicket = {
  id: string;
  sequentialId?: number;
  team: string;
  status: string;
  hasAttendant: boolean;
  createdAt: string;
  ageHours: number;
  lastInputAt: string | null;
  lastInputChecked: boolean;
  tags: string[];
};
export type BulkPreview = {
  snapshotAt: string;
  filters: BulkFilters;
  limit: number;
  candidateCount: number;
  checkedCount: number;
  excludedHistory: number;
  hasMore: boolean;
  historyScanLimited: boolean;
  finalizationTags: string[];
  untaggedTicketCount: number;
  tickets: BulkTicket[];
};
export type BulkJob = {
  jobId: string;
  builderShortName: string;
  kind: "preview" | "finalize";
  status: "running" | "ready" | "completed" | "failed" | "cancelled";
  expiresAt: string;
  progress: { stage: string; checked: number; total: number };
  error?: string;
  preview?: BulkPreview;
  result?: {
    filters?: BulkFilters;
    snapshotAt?: string;
    finalizationTag?: string;
    interrupted?: boolean;
    finalized: number;
    skipped: number;
    failed: number;
    uncertain: number;
    remaining: number;
    items: {
      id: string;
      sequentialId?: number;
      team: string;
      outcome: "finalized" | "skipped" | "failed" | "uncertain";
      message?: string;
    }[];
  };
};
