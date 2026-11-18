"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Filter,
  Image as ImageIcon,
  MessageSquareWarning,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  UserRound,
  X,
} from "lucide-react";
import {
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_ORDER,
  type ComplaintAttachment,
  type ComplaintRecord,
  type ComplaintStatus,
} from "@/lib/complaints/types";

const STATUS_STYLES: Record<ComplaintStatus, string> = {
  new: "bg-[#EAF2FF] text-[#1D4ED8]",
  in_progress: "bg-[#FFF4DB] text-[#9A6200]",
  awaiting_staff: "bg-[#F3E8FF] text-[#7E22CE]",
  resolved: "bg-[#EAF8F0] text-[#15803D]",
  reopened: "bg-[#FDEEEE] text-[#B43A3A]",
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type PendingUpload = ComplaintAttachment & { uploading?: boolean; error?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export function ComplaintsAdmin({ actorName, actorRole }: { actorName: string; actorRole: string }) {
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | "all">("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [organisationFilter, setOrganisationFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const refresh = useCallback(async (keepSelected = true, silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await api<{ ok: true; complaints: ComplaintRecord[] }>("/api/complaints");
      setComplaints(data.complaints);
      setSelectedId((prev) => {
        if (keepSelected && prev && data.complaints.some((c) => c.id === prev)) return prev;
        return data.complaints[0]?.id ?? null;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load complaints.");
      setComplaints([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api<{ ok: true; complaints: ComplaintRecord[] }>("/api/complaints");
        if (cancelled) return;
        setComplaints(data.complaints);
        setSelectedId(data.complaints[0]?.id ?? null);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load complaints.");
        setComplaints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Keep the shared conversation fresh while staff reply from mobile.
    const timer = window.setInterval(() => {
      void refresh(true, true);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const employees = useMemo(() => [...new Map(complaints.map((c) => [c.employee.id, c.employee])).values()], [complaints]);
  const organisations = useMemo(() => [...new Set(complaints.map((c) => c.employee.organisation))].sort(), [complaints]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return complaints
      .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
      .filter((c) => (employeeFilter === "all" ? true : c.employee.id === employeeFilter))
      .filter((c) => (organisationFilter === "all" ? true : c.employee.organisation === organisationFilter))
      .filter((c) => (dateFilter ? c.submittedAt.slice(0, 10) === dateFilter : true))
      .filter((c) => {
        if (!q) return true;
        return [c.reference, c.subject, c.employee.name, c.employee.employeeCode, c.employee.team, c.employee.organisation]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [complaints, query, statusFilter, employeeFilter, organisationFilter, dateFilter]);

  const selected = complaints.find((c) => c.id === selectedId) ?? filtered[0] ?? complaints[0] ?? null;

  async function openComplaint(id: string) {
    setSelectedId(id);
    try {
      await api(`/api/complaints/${id}`, { method: "POST", body: JSON.stringify({ type: "markRead" }) });
      setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, unreadByManagement: false } : c)));
    } catch {}
  }

  return (
    <main className="min-h-dvh bg-[#F7F7FC] text-[#17172F]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#6C45F5] text-white">
              <MessageSquareWarning size={18} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Complaints</h1>
              <p className="text-xs text-[#777A91]">Central inbox · acting as {actorName} ({actorRole})</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void refresh()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] bg-white px-3 text-sm font-semibold text-[#4A4665] hover:bg-[#F5F1FF]">
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
            <Link href="/executive" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] bg-white px-3 text-sm font-semibold text-[#4A4665] hover:bg-[#F5F1FF]">
              <ArrowLeft size={15} aria-hidden="true" /> Executive board
            </Link>
            <Link href="/admin/teams" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] bg-white px-3 text-sm font-semibold text-[#4A4665] hover:bg-[#F5F1FF]">Admin</Link>
          </div>
        </header>

        {loadError ? (
          <p role="alert" className="mb-4 rounded-xl border border-[#F6C7C7] bg-[#FDEEEE] px-4 py-3 text-sm text-[#B43A3A]">
            {loadError} {loadError.includes("Storage") || loadError.includes("configured") ? "" : "Ensure the complaints migration (0014_complaints) is applied and the database is reachable."}
          </p>
        ) : null}

        <section className="mb-4 rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#8B8B9A]"><Filter size={13} aria-hidden="true" /> Filters</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block text-[11px] font-semibold text-[#53506B] lg:col-span-2">Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference, subject, employee, team…" className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] px-3 text-sm outline-none focus:border-[#6C45F5]" /></label>
            <label className="block text-[11px] font-semibold text-[#53506B]">Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ComplaintStatus | "all")} className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 text-sm"><option value="all">All statuses</option>{COMPLAINT_STATUS_ORDER.map((s) => <option key={s} value={s}>{COMPLAINT_STATUS_LABELS[s]}</option>)}</select></label>
            <label className="block text-[11px] font-semibold text-[#53506B]">Employee<select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 text-sm"><option value="all">All employees</option>{employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
            <label className="block text-[11px] font-semibold text-[#53506B]">Organisation<select value={organisationFilter} onChange={(e) => setOrganisationFilter(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 text-sm"><option value="all">All organisations</option>{organisations.map((org) => <option key={org} value={org}>{org}</option>)}</select></label>
            <label className="block text-[11px] font-semibold text-[#53506B] sm:col-span-2 lg:col-span-1">Submission date<input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 text-sm" /></label>
          </div>
          <p className="mt-2 text-[11px] text-[#8B8B9A]">Shared complaints backend. Chat and status changes persist; attachments use private Supabase Storage with signed, authorised downloads.</p>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <section className="min-h-0 overflow-hidden rounded-2xl border border-[#E7E6F0] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#F1F0F6] px-4 py-3">
              <h2 className="text-sm font-bold text-[#39364F]">Inbox</h2>
              <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">{filtered.length} shown</span>
            </div>
            <ul className="max-h-[70dvh] overflow-y-auto p-2">
              {loading ? <li className="px-3 py-10 text-center text-sm text-[#777A91]">Loading complaints…</li> : null}
              {!loading && filtered.map((complaint) => {
                const active = selected?.id === complaint.id;
                return (
                  <li key={complaint.id}>
                    <button type="button" onClick={() => void openComplaint(complaint.id)} className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-[#CFC8F3] bg-[#F5F1FF]" : "border-transparent hover:border-[#E7E6F0] hover:bg-[#FCFBFF]"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {complaint.unreadByManagement ? <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#6C45F5]" title="Unread" /> : null}
                            <span className="truncate text-xs font-bold text-[#17172F]">{complaint.reference} · {complaint.subject}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[#53506B]">{complaint.employee.name} ({complaint.employee.employeeCode}) · {complaint.employee.team}</p>
                          <p className="truncate text-[11px] text-[#8B8B9A]">{complaint.employee.organisation}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[complaint.status]}`}>{COMPLAINT_STATUS_LABELS[complaint.status]}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#8B8B9A]">
                        <span>Submitted {formatDate(complaint.submittedAt)}</span><span aria-hidden="true">·</span><span>Last message {formatDateTime(complaint.lastMessageAt)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
              {!loading && filtered.length === 0 ? <li className="px-3 py-10 text-center text-sm text-[#777A91]">No complaints found. When staff submit complaints (shared backend), they appear here.</li> : null}
            </ul>
          </section>

          {selected ? (
            <ComplaintDetail key={selected.id} complaint={selected} onChanged={() => void refresh()} />
          ) : (
            <section className="grid place-items-center rounded-2xl border border-dashed border-[#D8D3EC] bg-white p-8 text-center text-sm text-[#777A91]">
              {loading ? "Loading…" : "Select a complaint to review its details and conversation."}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function ComplaintDetail({ complaint, onChanged }: { complaint: ComplaintRecord; onChanged: () => void }) {
  const [draft, setDraft] = useState("");
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [nextStatus, setNextStatus] = useState<ComplaintStatus>(complaint.status);
  const [attachments, setAttachments] = useState<PendingUpload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    const form = new FormData();
    form.set("complaintId", complaint.id);
    form.set("file", file);
    const res = await fetch("/api/complaints/attachments", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.message || "Upload failed");
    return data.attachment as ComplaintAttachment;
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files);
    for (const file of picked) {
      const tempId = `tmp-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [...prev, { id: tempId, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, kind: file.type.startsWith("image/") ? "image" : "document", uploading: true }]);
      try {
        const uploaded = await uploadFile(file);
        setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...uploaded, uploading: false } : a)));
      } catch (e) {
        setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...a, uploading: false, error: e instanceof Error ? e.message : "Upload failed" } : a)));
      }
    }
  }

  function clearFeedback() { setNotice(null); setError(null); }

  async function sendReply(requestInfo = false) {
    clearFeedback();
    if (attachments.some((a) => a.uploading)) { setError("Wait for uploads to finish."); return; }
    if (attachments.some((a) => a.error)) { setError("Remove failed attachments before sending."); return; }
    setSending(true);
    try {
      await api(`/api/complaints/${complaint.id}`, {
        method: "POST",
        body: JSON.stringify({ type: "reply", body: draft, attachmentIds: attachments.map((a) => a.id), requestInfo }),
      });
      setDraft("");
      setAttachments([]);
      setNotice(requestInfo ? "Reply sent and staff asked for more information." : "Reply sent.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed.");
    } finally {
      setSending(false);
    }
  }

  async function applyStatus() {
    clearFeedback();
    setSending(true);
    try {
      await api(`/api/complaints/${complaint.id}`, {
        method: "POST",
        body: JSON.stringify({ type: "setStatus", toStatus: nextStatus, note: statusNote, resolutionBody: nextStatus === "resolved" ? resolutionDraft : undefined }),
      });
      if (nextStatus === "resolved") setResolutionDraft("");
      setStatusNote("");
      setNotice(`Status updated to ${COMPLAINT_STATUS_LABELS[nextStatus]}.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed.");
    } finally {
      setSending(false);
    }
  }

  const initial = complaint.messages[0];

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#E7E6F0] bg-white shadow-sm">
      <div className="border-b border-[#F1F0F6] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B8B9A]">{complaint.reference}</p>
            <h2 className="mt-0.5 text-base font-bold text-[#17172F]">{complaint.subject}</h2>
            <p className="mt-1 text-xs text-[#777A91]">Submitted {formatDateTime(complaint.submittedAt)} · Last message {formatDateTime(complaint.lastMessageAt)}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[complaint.status]}`}>{COMPLAINT_STATUS_LABELS[complaint.status]}</span>
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#F1F0F6] bg-[#FCFBFF] p-4 lg:grid-cols-2">
        <InfoCard title="Employee information" icon={<UserRound size={14} aria-hidden="true" />}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <InfoItem label="Name" value={complaint.employee.name} />
            <InfoItem label="Employee ID" value={complaint.employee.employeeCode} />
            <InfoItem label="Team" value={complaint.employee.team} />
            <InfoItem label="Organisation" value={complaint.employee.organisation} />
            <InfoItem label="Work arrangement" value={complaint.employee.workArrangement} />
          </dl>
        </InfoCard>
        <InfoCard title="Complaint details" icon={<AlertCircle size={14} aria-hidden="true" />}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <InfoItem label="Reference" value={complaint.reference} />
            <InfoItem label="Status" value={COMPLAINT_STATUS_LABELS[complaint.status]} />
            <InfoItem label="Assigned to" value={complaint.assignedTo ?? "Unassigned"} />
            <div className="col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">Initial description</dt><dd className="mt-0.5 whitespace-pre-wrap leading-5 text-[#39364F]">{complaint.description}</dd></div>
          </dl>
          {initial?.attachments.length ? <div className="mt-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">Initial attachments</p><AttachmentList attachments={initial.attachments} /></div> : null}
        </InfoCard>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h3 className="mb-3 text-sm font-bold text-[#39364F]">Conversation</h3>
        <ol className="space-y-3">
          {complaint.messages.map((message) => {
            if (message.senderType === "system") {
              return <li key={message.id} className="flex justify-center"><div className="max-w-[90%] rounded-full bg-[#F1F0F6] px-3 py-1.5 text-center text-[11px] font-medium text-[#6B6880]">{message.body} · {formatDateTime(message.createdAt)}</div></li>;
            }
            const mine = message.senderType === "management";
            return (
              <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <article className={`max-w-[88%] rounded-2xl border px-3.5 py-3 ${mine ? "border-[#D8D0F2] bg-[#F5F1FF]" : "border-[#E7E6F0] bg-white"}`}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="text-xs font-bold text-[#17172F]">{mine ? "Management" : "Employee"} · {message.senderName}{message.senderRole ? <span className="font-medium text-[#777A91]"> ({message.senderRole})</span> : null}</p>
                    <p className="text-[10px] text-[#8B8B9A]">{formatDateTime(message.createdAt)}</p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-[#39364F]">{message.body}</p>
                  {message.attachments.length ? <AttachmentList attachments={message.attachments} className="mt-2" /> : null}
                </article>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="border-t border-[#F1F0F6] bg-[#FCFBFF] p-4">
        {notice ? <p className="mb-3 rounded-lg bg-[#ECFDF5] px-3 py-2 text-xs font-medium text-[#047857]">{notice}</p> : null}
        {error ? <p className="mb-3 rounded-lg bg-[#FDEEEE] px-3 py-2 text-xs font-medium text-[#B43A3A]">{error}</p> : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="rounded-xl border border-[#E7E6F0] bg-white p-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">Reply to employee</h4>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">Message<textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Write a response visible in the employee's conversation…" className="mt-1 w-full rounded-lg border border-[#E7E6F0] px-3 py-2 text-sm outline-none focus:border-[#6C45F5]" /></label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.xlsx,.xls,.csv,.ppt,.pptx" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B] hover:bg-[#F7F7FC]"><Paperclip size={13} aria-hidden="true" /> Attach files</button>
              <button type="button" disabled={sending} onClick={() => void sendReply(false)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white hover:bg-[#5935DE] disabled:opacity-50"><Send size={13} aria-hidden="true" /> Send reply</button>
              <button type="button" disabled={sending} onClick={() => void sendReply(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#D8D0F2] bg-[#F5F1FF] px-3 text-xs font-semibold text-[#5A3ED0] hover:bg-[#EFEAFF] disabled:opacity-50"><Clock3 size={13} aria-hidden="true" /> Request info</button>
            </div>
            {attachments.length ? (
              <ul className="mt-2 space-y-1.5">
                {attachments.map((att) => (
                  <li key={att.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#F7F7FC] px-2.5 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">{att.kind === "image" ? <ImageIcon size={13} className="shrink-0 text-[#6C45F5]" /> : <FileText size={13} className="shrink-0 text-[#6C45F5]" />}<span className="truncate font-medium text-[#39364F]">{att.fileName}</span><span className="shrink-0 text-[#8B8B9A]">{att.uploading ? "Uploading…" : att.error ? att.error : formatBytes(att.sizeBytes)}</span></span>
                    <button type="button" aria-label={`Remove ${att.fileName}`} onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))} className="grid h-7 w-7 place-items-center rounded-md text-[#777A91] hover:bg-white"><X size={13} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-xl border border-[#E7E6F0] bg-white p-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">Status & resolution</h4>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">Change status<select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)} className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 text-sm">{COMPLAINT_STATUS_ORDER.map((s) => <option key={s} value={s}>{COMPLAINT_STATUS_LABELS[s]}</option>)}</select></label>
            <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">Status note (optional)<input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Recorded in status history" className="mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] px-3 text-sm" /></label>
            {nextStatus === "resolved" ? <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">Resolution response (required)<textarea value={resolutionDraft} onChange={(e) => setResolutionDraft(e.target.value)} rows={3} placeholder="Explain the outcome before closing the complaint." className="mt-1 w-full rounded-lg border border-[#E7E6F0] px-3 py-2 text-sm" /></label> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={sending} onClick={() => void applyStatus()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B] hover:bg-[#F7F7FC] disabled:opacity-50"><CheckCircle2 size={13} aria-hidden="true" /> Apply status</button>
              {complaint.status === "resolved" ? <button type="button" onClick={() => { setNextStatus("reopened"); setStatusNote("Reopened from admin conversation."); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#F6C7C7] bg-[#FDEEEE] px-3 text-xs font-semibold text-[#B43A3A] hover:bg-[#FCE4E4]"><RotateCcw size={13} aria-hidden="true" /> Prepare reopen</button> : null}
            </div>
            <div className="mt-3 rounded-lg bg-[#F7F7FC] p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">Status history</p>
              <ul className="mt-1.5 space-y-1.5">
                {complaint.statusHistory.map((entry) => (
                  <li key={entry.id} className="text-[11px] leading-4 text-[#53506B]">
                    <span className="font-semibold text-[#39364F]">{entry.fromStatus ? COMPLAINT_STATUS_LABELS[entry.fromStatus] : "Submitted"} → {COMPLAINT_STATUS_LABELS[entry.toStatus]}</span> by {entry.changedByName} ({entry.changedByRole}) · {formatDateTime(entry.changedAt)}
                    {entry.note ? <span className="block text-[#777A91]">Note: {entry.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[#E7E6F0] bg-white p-3"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#8B8B9A]"><span className="text-[#6C45F5]">{icon}</span> {title}</h3>{children}</section>;
}
function InfoItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#8B8B9A]">{label}</dt><dd className="mt-0.5 font-medium text-[#39364F]">{value}</dd></div>;
}
function AttachmentList({ attachments, className = "" }: { attachments: ComplaintAttachment[]; className?: string }) {
  if (attachments.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {attachments.map((att) => {
        const href = `/api/complaints/attachments/${att.id}`;
        return (
          <li key={att.id} className="flex min-w-[180px] max-w-[260px] items-center gap-2 rounded-lg border border-[#E7E6F0] bg-[#FCFBFF] p-2">
            {att.kind === "image" ? (
              <a href={href} target="_blank" rel="noreferrer" className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[#F1F0F6] text-[#6C45F5]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={href} alt="" className="h-full w-full object-cover" />
              </a>
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#F1F0F6] text-[#6C45F5]"><FileText size={16} aria-hidden="true" /></span>
            )}
            <span className="min-w-0 flex-1">
              <a href={href} target="_blank" rel="noreferrer" className="block truncate text-[11px] font-semibold text-[#39364F] hover:underline" title={att.fileName}>{att.fileName}</a>
              <span className="block text-[10px] text-[#8B8B9A]">{att.kind === "image" ? "Image" : "Document"} · {formatBytes(att.sizeBytes)}</span>
            </span>
            <a href={href} target="_blank" rel="noreferrer" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#777A91] hover:bg-[#F1F0F6]" title="Open/download (authorised, signed)"><Download size={13} aria-hidden="true" /></a>
          </li>
        );
      })}
    </ul>
  );
}
