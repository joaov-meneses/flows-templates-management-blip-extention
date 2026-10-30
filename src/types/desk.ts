export type DeskQueue = {
  id: string;
  uniqueId: string;
  name: string;
  isActive: boolean;
  attendantCount: number;
  ruleCount: number;
  priorityRuleCount: number;
};
export type DeskAction = "rename" | "duplicate";
export type DeskPreview = {
  builderShortName: string;
  action: DeskAction;
  name: string;
  revision: string;
  forceFinalization: boolean;
  activeTicketCount: number;
  queue: DeskQueue;
  counts: { attendants: number; rules: number; priorityRules: number; tags: number };
  backup: Record<string, unknown>;
};
export type DeskResult = {
  status: "success" | "recovered" | "attention";
  builderShortName: string;
  action: DeskAction;
  queue?: DeskQueue;
  message?: string;
  restored?: boolean;
  recoveryErrors?: string[];
  finalizedTickets: number;
  finalizationUncertain: boolean;
  configurationUnchanged?: boolean;
};
