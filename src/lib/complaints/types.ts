export type ComplaintStatus =
  | "new"
  | "in_progress"
  | "awaiting_staff"
  | "resolved"
  | "reopened";

export type ComplaintCategory =
  | "payroll"
  | "workplace"
  | "scheduling"
  | "equipment"
  | "policy"
  | "other";

export type ComplaintSenderType = "staff" | "management" | "system";

export interface ComplaintAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Prototype-only preview URL or placeholder marker; production must use signed private storage URLs. */
  previewUrl?: string;
  kind: "image" | "document";
}

export interface ComplaintMessage {
  id: string;
  complaintId: string;
  senderType: ComplaintSenderType;
  senderName: string;
  senderRole?: string;
  body: string;
  createdAt: string;
  attachments: ComplaintAttachment[];
  /** For system messages such as status changes. */
  meta?: {
    type?: "status_change" | "resolution";
    fromStatus?: ComplaintStatus;
    toStatus?: ComplaintStatus;
  };
}

export interface ComplaintStatusHistoryEntry {
  id: string;
  complaintId: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  changedAt: string;
  changedByName: string;
  changedByRole: string;
  note?: string;
}

export interface ComplaintEmployee {
  id: string;
  name: string;
  employeeCode: string;
  team: string;
  organisation: string;
  workArrangement: "In-house" | "Client site" | "Hybrid";
}

export interface ComplaintRecord {
  id: string;
  reference: string;
  employee: ComplaintEmployee;
  category: ComplaintCategory;
  subject: string;
  description: string;
  submittedAt: string;
  lastMessageAt: string;
  status: ComplaintStatus;
  unreadByManagement: boolean;
  unreadByStaff: boolean;
  assignedTo?: string;
  messages: ComplaintMessage[];
  statusHistory: ComplaintStatusHistoryEntry[];
}

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  awaiting_staff: "Awaiting Staff",
  resolved: "Resolved",
  reopened: "Reopened",
};

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  payroll: "Payroll",
  workplace: "Workplace",
  scheduling: "Scheduling",
  equipment: "Equipment",
  policy: "Policy",
  other: "Other",
};

export const COMPLAINT_STATUS_ORDER: ComplaintStatus[] = [
  "new",
  "in_progress",
  "awaiting_staff",
  "resolved",
  "reopened",
];
