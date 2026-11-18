"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquareWarning,
  Paperclip,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  COMPLAINT_STATUS_LABELS,
  type ComplaintAttachment,
  type ComplaintRecord,
  type ComplaintStatus,
} from "@/lib/complaints/types";
import {
  formatFileSize,
  isEvidenceImage,
  validateEvidenceFile,
} from "./EvidenceAttachments";

const INPUT =
  "w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2.5 text-sm text-[#17172F] placeholder:text-[#A7A9B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]";

const STATUS_STYLES: Record<ComplaintStatus, string> = {
  new: "bg-[#EEF0FF] text-[#4A3FB8]",
  in_progress: "bg-[#FFF4E0] text-[#8A5A00]",
  awaiting_staff: "bg-[#FDEEEE] text-[#B43A3A]",
  resolved: "bg-[#E8F7EE] text-[#177A3D]",
  reopened: "bg-[#F3E8FF] text-[#7A2FC4]",
};

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function StatusPill({ status }: { status: ComplaintStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[status]}`}>
      {COMPLAINT_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Staff-facing complaints: submit a new complaint and track replies/status on
 * their own complaints. Only config admins manage complaints.
 */
export function ComplaintButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "mine">("new");

  // New complaint form
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // My complaints
  const [mine, setMine] = useState<ComplaintRecord[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [loadingMine, setLoadingMine] = useState(false);
  const [selected, setSelected] = useState<ComplaintRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const refreshBadge = useCallback(async () => {
    try {
      const res = await fetch("/api/complaints?summary=1");
      const data = (await res.json().catch(() => null)) as { ok?: boolean; unread?: number } | null;
      if (res.ok && data?.ok) setUnreadTotal(data.unread ?? 0);
    } catch {
      // Badge is best-effort; ignore failures.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshBadge(), 0);
    const onFocus = () => void refreshBadge();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBadge();
    }, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(interval);
    };
  }, [refreshBadge]);

  const loadMine = useCallback(async () => {
    setLoadingMine(true);
    setMineError(null);
    try {
      const res = await fetch("/api/complaints");
      const data = (await res.json().catch(() => null)) as { ok?: boolean; complaints?: ComplaintRecord[]; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setMineError(data?.message ?? "Could not load your complaints.");
        setMine([]);
      } else {
        setMine(data.complaints ?? []);
      }
    } catch {
      setMineError("Could not load your complaints. Check your connection.");
      setMine([]);
    } finally {
      setLoadingMine(false);
    }
  }, []);

  function maybeLoadMine() {
    if (mine === null && !loadingMine) void loadMine();
  }

  function reset() {
    setSubject("");
    setDescription("");
    setFiles([]);
    setFilePreviews({});
    setError(null);
    setDone(null);
    setNotice(null);
    setSelected(null);
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const next = [...files];
    const previews = { ...filePreviews };
    for (const file of Array.from(list)) {
      const problem = validateEvidenceFile(file);
      if (problem) {
        setError(problem);
        continue;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
      if (isEvidenceImage({ fileName: file.name, mimeType: file.type })) {
        previews[file.name] = URL.createObjectURL(file);
      }
    }
    setFiles(next);
    setFilePreviews(previews);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    const file = files[index];
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (file && filePreviews[file.name]) {
      URL.revokeObjectURL(filePreviews[file.name]);
      setFilePreviews((prev) => {
        const copy = { ...prev };
        delete copy[file.name];
        return copy;
      });
    }
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let res: Response;
      if (files.length) {
        const form = new FormData();
        form.append("subject", subject);
        form.append("description", description);
        for (const file of files) form.append("files", file);
        res = await fetch("/api/complaints", { method: "POST", body: form });
      } else {
        res = await fetch("/api/complaints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, description }),
        });
      }
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        reference?: string;
        warning?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.message ?? "Could not submit the complaint. Try again.");
        return;
      }
      setDone(data.reference ?? "your complaint");
      if (data.warning) setNotice(data.warning);
      setMine(null); // refresh list next time the tab opens
    } catch {
      setError("Could not submit the complaint. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function openComplaint(record: ComplaintRecord) {
    setSelected(record);
    setNotice(null);
    if (record.unreadByStaff) {
      void fetch(`/api/complaints/${record.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "markRead" }),
      }).catch(() => undefined);
      setMine((prev) => prev?.map((c) => (c.id === record.id ? { ...c, unreadByStaff: false } : c)) ?? prev);
      setUnreadTotal((n) => Math.max(0, n - 1));
    }
  }

  /** Pull the latest shared conversation after a reply, reopen or status change. */
  async function refreshSelected(id: string) {
    try {
      const detail = await fetch(`/api/complaints/${id}`);
      const data = (await detail.json().catch(() => null)) as { ok?: boolean; complaint?: ComplaintRecord } | null;
      if (data?.ok && data.complaint) setSelected(data.complaint);
      await loadMine();
      void refreshBadge();
    } catch {
      // Keep the current view; the next focus/refresh will reconcile it.
    }
  }

  function handleWithdrawn() {
    setSelected(null);
    setMine(null);
    setNotice("Complaint withdrawn. It has been removed from your list.");
    setTab("mine");
    void loadMine();
    void refreshBadge();
  }

  const unreadCount = unreadTotal;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label="Complaints"
        className={compact
          ? "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-2 text-[11px] font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
          : "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#E7E6F0] bg-white px-3 text-xs font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] sm:text-sm"
        }
      >
        <MessageSquareWarning size={compact ? 14 : 15} aria-hidden="true" />
        {compact ? "Complaint" : "Complaints"}
        {unreadCount > 0 ? (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#B43A3A] px-1 text-[9px] font-bold text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-[#17172F]/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Complaints"
            className="flex max-h-[90dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#EEEAF2] px-4 py-3">
              <div>
                <h2 className="text-base font-bold text-[#17172F]">Complaints</h2>
                <p className="text-[11px] text-[#9A97AD]">Raised privately for the admin team to review.</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="grid h-9 w-9 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </header>

            {!selected && tab === "mine" ? (
              <MineView
                mine={mine}
                loading={loadingMine}
                error={mineError}
                notice={notice}
                onRetry={() => {
                  setMine(null);
                  void loadMine();
                }}
                onOpen={openComplaint}
                onNew={() => setTab("new")}
              />
            ) : !selected ? (
              <>
                <div className="flex shrink-0 gap-1 border-b border-[#EEEAF2] px-4 pt-2">
                  <TabButton active={tab === "new"} onClick={() => setTab("new")}>New complaint</TabButton>
                  <TabButton active={tab === "mine"} onClick={() => { setTab("mine"); maybeLoadMine(); }} badge={unreadCount}>My complaints</TabButton>
                </div>
                {done ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                    <CheckCircle2 size={40} className="text-[#16A34A]" aria-hidden="true" />
                    <h3 className="text-base font-bold text-[#17172F]">Complaint submitted</h3>
                    <p className="text-sm text-[#6B6880]">
                      Reference <span className="font-semibold text-[#39364F]">{done}</span> — the admin team will review it.
                    </p>
                    {notice ? (
                      <p role="status" className="rounded-lg bg-[#FFF8E8] px-3 py-2 text-xs text-[#8A5A00]">{notice}</p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDone(null);
                          reset();
                          setTab("mine");
                          maybeLoadMine();
                        }}
                        className="inline-flex min-h-11 items-center rounded-xl border border-[#E7E6F0] px-5 text-sm font-semibold text-[#4A4665] hover:bg-[#F7F7FC]"
                      >
                        View my complaints
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="inline-flex min-h-11 items-center rounded-xl bg-[#6C45F5] px-6 text-sm font-semibold text-white hover:bg-[#5935DE]"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                    <label className="block text-xs font-semibold text-[#53506B]">
                      Subject
                      <input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        maxLength={140}
                        placeholder="Brief summary of the issue"
                        className={`${INPUT} mt-1`}
                      />
                    </label>
                    <label className="block text-xs font-semibold text-[#53506B]">
                      Description
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        maxLength={2000}
                        placeholder="Describe what happened, when, and who was involved…"
                        className={`${INPUT} mt-1 resize-y`}
                      />
                    </label>
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                        onChange={(event) => addFiles(event.target.files)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#D9D4EC] bg-white px-4 py-3 text-sm font-semibold text-[#5A3ED0] transition hover:border-[#B8A8F8] hover:bg-[#FBFAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                      >
                        <Paperclip size={15} aria-hidden="true" />
                        Attach files (optional)
                      </button>
                      <p className="mt-1 text-center text-[10px] text-[#9A97AD]">
                        PDF, Office docs, CSV, TXT or images — up to 10 MB each.
                      </p>
                      {files.length ? (
                        <ul className="mt-2 space-y-1.5">
                          {files.map((file, index) => {
                            const preview = filePreviews[file.name];
                            return (
                              <li key={`${file.name}-${index}`} className="flex items-center gap-2.5 rounded-lg border border-[#EEEAF2] bg-white px-2.5 py-2">
                                {preview ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={preview} alt="" className="h-9 w-9 shrink-0 rounded-md border border-[#E7E6F0] object-cover" />
                                ) : (
                                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#F1F0F6] text-[#6B6880]">
                                    <FileText size={16} aria-hidden="true" />
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold text-[#39364F]">{file.name}</span>
                                  <span className="block text-[10px] text-[#9A97AD]">{formatFileSize(file.size)}</span>
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${file.name}`}
                                  onClick={() => removeFile(index)}
                                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#9A97AD] hover:bg-[#FDEEEE] hover:text-[#B43A3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                                >
                                  <X size={15} aria-hidden="true" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                    {error ? (
                      <p role="alert" className="rounded-lg bg-[#FDEEEE] px-3 py-2 text-xs text-[#B43A3A]">{error}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
                    >
                      {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                      {submitting ? "Submitting…" : "Submit complaint"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <ComplaintDetail
                key={selected.id}
                record={selected}
                onBack={() => {
                  setSelected(null);
                  setNotice(null);
                }}
                onChanged={() => void refreshSelected(selected.id)}
                onWithdrawn={handleWithdrawn}
              />
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function TabButton({ active, onClick, badge = 0, children }: { active: boolean; onClick: () => void; badge?: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
        active ? "border-[#6C45F5] text-[#5A3ED0]" : "border-transparent text-[#9A97AD] hover:text-[#53506B]"
      }`}
    >
      {children}
      {badge > 0 ? (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#B43A3A] px-1 text-[9px] font-bold text-white">{badge}</span>
      ) : null}
    </button>
  );
}

function MineView({
  mine,
  loading,
  error,
  notice,
  onRetry,
  onOpen,
  onNew,
}: {
  mine: ComplaintRecord[] | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  onRetry: () => void;
  onOpen: (record: ComplaintRecord) => void;
  onNew: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {notice ? (
        <p role="status" className="mb-3 rounded-lg bg-[#E8F7EE] px-3 py-2 text-xs font-medium text-[#177A3D]">{notice}</p>
      ) : null}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#9A97AD]">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[#B43A3A]">{error}</p>
          <button type="button" onClick={onRetry} className="mt-3 text-xs font-semibold text-[#5A3ED0] hover:underline">
            Try again
          </button>
        </div>
      ) : !mine?.length ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <MessageSquareWarning size={28} className="text-[#C9C5DC]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#53506B]">No complaints yet</p>
          <p className="text-xs text-[#9A97AD]">When you raise a complaint, its status and replies will appear here.</p>
          <button
            type="button"
            onClick={onNew}
            className="mt-2 inline-flex min-h-10 items-center rounded-xl bg-[#6C45F5] px-5 text-sm font-semibold text-white hover:bg-[#5935DE]"
          >
            Log a complaint
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {mine.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onOpen(record)}
                className="flex w-full items-start gap-3 rounded-xl border border-[#EEEAF2] bg-white px-3 py-2.5 text-left transition hover:border-[#CFC8F3] hover:bg-[#FBFAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[#17172F]">{record.subject}</span>
                    {record.unreadByStaff ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#B43A3A]" aria-label="Unread update" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#9A97AD]">
                    {record.reference}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[#9A97AD]">
                    {record.assignedTo ? `Assigned to ${record.assignedTo} · ` : ""}{formatDate(record.lastMessageAt)}
                  </span>
                </span>
                <StatusPill status={record.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PendingReplyAttachment = ComplaintAttachment & { uploading?: boolean; error?: string };

function ComplaintDetail({
  record,
  onBack,
  onChanged,
  onWithdrawn,
}: {
  record: ComplaintRecord;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onWithdrawn: () => void;
}) {
  const [reply, setReply] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [attachments, setAttachments] = useState<PendingReplyAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      const problem = validateEvidenceFile(file);
      if (problem) {
        setError(problem);
        continue;
      }
      const tempId = `tmp-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          kind: isEvidenceImage({ fileName: file.name, mimeType: file.type }) ? "image" : "document",
          uploading: true,
        },
      ]);
      try {
        const form = new FormData();
        form.set("complaintId", record.id);
        form.set("file", file);
        const res = await fetch("/api/complaints/attachments", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.message || "Upload failed");
        const uploaded = data.attachment as ComplaintAttachment;
        setAttachments((prev) => prev.map((a) => (a.id === tempId ? uploaded : a)));
      } catch (reason) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? { ...a, uploading: false, error: reason instanceof Error ? reason.message : "Upload failed" }
              : a
          )
        );
      }
    }
  }

  function attachmentsReady(): boolean {
    if (attachments.some((a) => a.uploading)) {
      setError("Wait for uploads to finish.");
      return false;
    }
    if (attachments.some((a) => a.error)) {
      setError("Remove failed attachments before sending.");
      return false;
    }
    return true;
  }

  async function postAction(type: "reply" | "reopen" | "withdraw", extra: Record<string, unknown> = {}) {
    setError(null);
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/complaints/${record.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.message || "The action could not be completed.");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if ((!reply.trim() && !attachments.length) || !attachmentsReady()) return;
    if (await postAction("reply", { body: reply, attachmentIds: attachments.map((a) => a.id) })) {
      setReply("");
      setAttachments([]);
      await onChanged();
    }
  }

  async function reopen() {
    if (reopenReason.trim().length < 5) {
      setError("Tell us why you are reopening this complaint.");
      return;
    }
    if (!attachmentsReady()) return;
    if (await postAction("reopen", { reason: reopenReason.trim(), attachmentIds: attachments.map((a) => a.id) })) {
      setReopenReason("");
      setAttachments([]);
      await onChanged();
    }
  }

  async function withdraw() {
    if (await postAction("withdraw")) onWithdrawn();
    else setConfirmWithdraw(false);
  }

  const resolved = record.status === "resolved";

  return (
    <>
      <div className="flex shrink-0 items-start gap-2 border-b border-[#EEEAF2] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to complaints"
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#17172F]">{record.subject}</p>
          <p className="text-[10px] text-[#9A97AD]">
            {record.reference}
            {record.assignedTo ? ` · Assigned to ${record.assignedTo}` : ""}
          </p>
        </div>
        <StatusPill status={record.status} />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {record.messages.map((message) => {
          if (message.senderType === "system") {
            return (
              <p key={message.id} className="text-center text-[10px] font-medium text-[#9A97AD]">
                {message.body}
              </p>
            );
          }
          const mine = message.senderType === "staff";
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? "bg-[#6C45F5] text-white" : "border border-[#EEEAF2] bg-[#F7F7FC] text-[#17172F]"}`}>
                <p className={`text-[10px] font-semibold ${mine ? "text-white/75" : "text-[#9A97AD]"}`}>
                  {message.senderName}{message.senderRole ? ` · ${message.senderRole}` : ""} · {formatDate(message.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{message.body}</p>
                {message.attachments.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {message.attachments.map((att) => (
                      <li key={att.id}>
                        <a
                          href={`/api/complaints/attachments/${att.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold underline-offset-2 hover:underline ${mine ? "bg-white/15 text-white" : "bg-white text-[#5A3ED0]"}`}
                        >
                          <FileText size={12} aria-hidden="true" />
                          {att.fileName} · {formatFileSize(att.sizeBytes)}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-[#EEEAF2] px-4 py-3">
        {resolved ? (
          <p className="mb-2 rounded-lg bg-[#E8F7EE] px-3 py-2 text-center text-[11px] font-semibold text-[#177A3D]">
            This complaint is resolved. If the issue continues, reopen it below.
          </p>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        {resolved ? (
          <label className="block text-xs font-semibold text-[#53506B]">
            Why are you reopening?
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Explain what is still unresolved…"
              className={`${INPUT} mt-1 resize-y`}
            />
          </label>
        ) : (
          <label className="block text-xs font-semibold text-[#53506B]">
            Reply
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Write a reply…"
              className={`${INPUT} mt-1 resize-y`}
            />
          </label>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#5A3ED0] hover:bg-[#F5F1FF]"
          >
            <Paperclip size={13} aria-hidden="true" /> Attach files
          </button>
          <button
            type="button"
            onClick={() => void (resolved ? reopen() : sendReply())}
            disabled={busy || attachments.some((a) => a.uploading) || (resolved ? reopenReason.trim().length < 5 : !reply.trim() && !attachments.length)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : resolved ? <RotateCcw size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
            {resolved ? "Reopen complaint" : "Send reply"}
          </button>
        </div>

        {attachments.length ? (
          <ul className="mt-2 space-y-1.5">
            {attachments.map((att) => (
              <li key={att.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#F7F7FC] px-2.5 py-1.5 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  {att.kind === "image" ? <ImageIcon size={13} className="shrink-0 text-[#6C45F5]" aria-hidden="true" /> : <FileText size={13} className="shrink-0 text-[#6C45F5]" aria-hidden="true" />}
                  <span className="truncate font-medium text-[#39364F]">{att.fileName}</span>
                  <span className="shrink-0 text-[#8B8B9A]">{att.uploading ? "Uploading…" : att.error ?? formatFileSize(att.sizeBytes)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${att.fileName}`}
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#777A91] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 rounded-lg bg-[#FDEEEE] px-3 py-2 text-xs text-[#B43A3A]">{error}</p>
        ) : null}

        <div className="mt-3 border-t border-[#F1F0F6] pt-2">
          {confirmWithdraw ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FDEEEE] px-3 py-2">
              <p className="text-[11px] font-medium text-[#B43A3A]">Withdraw this complaint? It will be hidden from your list and the admin inbox.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmWithdraw(false)}
                  className="min-h-8 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] hover:bg-white"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={() => void withdraw()}
                  disabled={busy}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#B43A3A] px-2.5 text-[11px] font-semibold text-white hover:bg-[#9E3030] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />}
                  Withdraw
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmWithdraw(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-[#9A97AD] hover:bg-[#FDEEEE] hover:text-[#B43A3A]"
            >
              <Trash2 size={12} aria-hidden="true" /> Withdraw complaint
            </button>
          )}
        </div>
      </div>
    </>
  );
}
