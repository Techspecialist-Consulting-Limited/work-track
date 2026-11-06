"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  Home,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getSessionUser,
  subscribeToDatabase,
} from "@/lib/worklog/repository";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import { InviteChairman } from "../InviteChairman";
import { downloadWorkLogWorkbook } from "@/lib/worklog/export-xlsx";
import { EXERCISE_END, EXERCISE_START } from "@/lib/worklog/seed";
import { getDaySummary } from "@/lib/worklog/selectors";
import { formatDateLabel, formatMinutes } from "@/lib/worklog/time";
import { getZonedDateKey, WORKTRACK_SCHEDULE } from "@/lib/worktrack/schedule-config";
import type { Employee } from "@/lib/worklog/types";
import type { DaySummary } from "@/lib/worklog/selectors";
import { EmployeeDetailMobile, DateSheet } from "./EmployeeDetail";
import {
  Avatar,
  BottomSheet,
  LOCATION_LABELS,
  MetricCard,
  SheetOption,
  pad2,
  primaryLocation,
  shiftDateKey,
} from "./shared";

type MobileFilter = "all" | "logged" | "none" | "overtime" | "office" | "home" | "break";

const FILTER_OPTIONS: { id: MobileFilter; label: string }[] = [
  { id: "all", label: "All staff" },
  { id: "logged", label: "Work logged" },
  { id: "none", label: "No work logged" },
  { id: "overtime", label: "Has overtime" },
  { id: "office", label: "Office" },
  { id: "home", label: "Home" },
  { id: "break", label: "On break" },
];

const EXERCISE_START_KEY = `${EXERCISE_START.year}-${pad2(EXERCISE_START.month)}-${pad2(EXERCISE_START.day)}`;
const EXERCISE_END_KEY = `${EXERCISE_END.year}-${pad2(EXERCISE_END.month)}-${pad2(EXERCISE_END.day)}`;

interface MobileEmployeeRow {
  employee: Employee;
  day: DaySummary;
  tasksRecorded: number;
  location: ReturnType<typeof primaryLocation>;
  onBreak: boolean;
}

function LocationGlyph({ location }: { location: MobileEmployeeRow["location"] }) {
  if (location === "office") return <Building2 size={12} className="text-[#3478D4]" aria-hidden="true" />;
  if (location === "home") return <Home size={12} className="text-[#6040E8]" aria-hidden="true" />;
  if (location === "mixed") return <ArrowLeftRight size={12} className="text-[#9292A8]" aria-hidden="true" />;
  return null;
}

export function ExecutiveMobile() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const meEmployee = db.employees.find((e) => e.id === getSessionEmployeeId());
  const canEditProfile = Boolean(meEmployee) && getSessionRole() !== "chairman";
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<MobileFilter>("all");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const todayKey = getZonedDateKey(now);
  const activeKey = dateKey ?? todayKey;
  const selected = db.employees.find((e) => e.id === selectedId) ?? null;
  const outsideExercise = activeKey < EXERCISE_START_KEY || activeKey > EXERCISE_END_KEY;

  const rows = useMemo<MobileEmployeeRow[]>(
    () =>
      db.employees.map((employee) => {
        const day = getDaySummary(db, employee.id, activeKey, now);
        return {
          employee,
          day,
          tasksRecorded: new Set(day.entries.map((e) => e.taskId)).size,
          location: primaryLocation(day),
          onBreak: day.isToday && day.activeBreak !== null,
        };
      }),
    [db, activeKey, now]
  );

  const visibleRows = rows.filter(({ employee, day, location, onBreak }) => {
    if (query && !`${employee.name} ${employee.role}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    switch (filter) {
      case "all": return true;
      case "logged": return day.entries.length > 0;
      case "none": return day.entries.length === 0;
      case "overtime": return day.overtimeMinutes > 0;
      case "office": return location === "office";
      case "home": return location === "home";
      case "break": return onBreak;
    }
  });

  const recordedWork = rows.reduce((s, r) => s + r.day.entries.length, 0);
  const inOffice = rows.filter((r) => r.location === "office").length;
  const fromHome = rows.filter((r) => r.location === "home").length;

  const filterLabel = FILTER_OPTIONS.find((f) => f.id === filter)?.label ?? "All staff";

  async function exportDay() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadWorkLogWorkbook(
        db,
        { fromKey: activeKey, toKey: activeKey, employeeId: "all" },
        `WorkTrack_Team_Report_${activeKey}.xlsx`
      );
      setExportSheetOpen(false);
    } catch {
      setExportError("The workbook could not be created. Try again.");
    } finally {
      setExporting(false);
    }
  }

  if (!mounted) {
    return <div className="grid min-h-dvh place-items-center text-sm text-[#666783]">Loading team board…</div>;
  }

  const longDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKTRACK_SCHEDULE.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${activeKey}T12:00:00Z`));

  return (
    <div className="min-h-dvh bg-[#F7F6FC] pb-28 text-[#17172B]">
      {/* App header */}
      <header className="sticky top-0 z-40 border-b border-[#EAE8F2] bg-white/95 backdrop-blur">
        <div
          className="mx-auto flex w-full max-w-lg items-center justify-between px-5"
          style={{ minHeight: "calc(56px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#159947] text-white">
              <Zap size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-[#17172B]">WorkTrack</span>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#9292A8]">Executive</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {getSessionEmployeeId() && getSessionRole() !== "chairman" ? (
              <Link
                href="/"
                className="rounded-lg border border-[#EAE8F2] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#5A3ED0] transition hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
              >
                My Work
              </Link>
            ) : null}
            <InviteChairman compact />
            <ProfileMenu
              name={meEmployee?.name ?? getSessionUser()?.name ?? "Account"}
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : getSessionRole() === "chairman" ? "Chairman" : "HR"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={canEditProfile}
              required={canEditProfile && !meEmployee?.avatarUrl}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-5 pt-5">
        <h1 className="text-[22px] font-bold tracking-tight text-[#17172B]">Team Board</h1>
        <p className="mt-0.5 text-[13px] text-[#666783]">Team activity and work logs at a glance.</p>

        {/* Date navigator */}
        <div className="mt-4 flex items-center gap-1 rounded-2xl border border-[#EAE8F2] bg-white px-2 py-1.5 shadow-[0_1px_2px_rgba(23,23,43,0.04)]">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDateKey(shiftDateKey(activeKey, -1))}
            className="grid h-10 w-10 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
          >
            <ChevronRight size={18} className="rotate-180" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDateSheetOpen(true)}
            className="flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold text-[#17172B] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
          >
            <ClipboardCheck size={14} className="shrink-0 text-[#6040E8]" aria-hidden="true" />
            <span className="truncate">{longDate}</span>
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setDateKey(shiftDateKey(activeKey, 1))}
            className="grid h-10 w-10 place-items-center rounded-full text-[#666783] transition hover:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDateKey(null)}
            className="shrink-0 rounded-full bg-[#EFEAFF] px-3 py-2 text-[11px] font-bold text-[#4F31D0] transition hover:bg-[#E4DEFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
          >
            Today
          </button>
        </div>

        {outsideExercise ? (
          <p className="mt-3 rounded-2xl border border-[#F3C56B] bg-[#FFF6E5] px-4 py-2.5 text-[11px] font-medium text-[#8A5A00]">
            Outside the work exercise ({formatDateLabel(EXERCISE_START_KEY)} – {formatDateLabel(EXERCISE_END_KEY)}).
          </p>
        ) : null}

        {/* Summary cards */}
        <section aria-label="Daily summary" className="mt-4 grid grid-cols-2 gap-2.5">
          <MetricCard
            icon={<Users size={18} className="text-[#159947]" aria-hidden="true" />}
            iconClass="bg-[#EAF8EF]"
            value={String(db.employees.length)}
            label="Team Members"
          />
          <MetricCard
            icon={<ClipboardCheck size={18} className="text-[#6040E8]" aria-hidden="true" />}
            iconClass="bg-[#EFEAFF]"
            value={String(recordedWork)}
            label="Recorded Work"
          />
          <MetricCard
            icon={<Building2 size={18} className="text-[#3478D4]" aria-hidden="true" />}
            iconClass="bg-[#E8F0FB]"
            value={String(inOffice)}
            label="In Office"
          />
          <MetricCard
            icon={<Home size={18} className="text-[#6040E8]" aria-hidden="true" />}
            iconClass="bg-[#EFEAFF]"
            value={String(fromHome)}
            label="Working from Home"
          />
        </section>

        {/* Team list */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-[#17172B]">Team ({visibleRows.length})</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={searchOpen ? "Close search" : "Search team"}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((v) => !v)}
                className={`grid h-9 w-9 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
                  searchOpen ? "bg-[#EFEAFF] text-[#4F31D0]" : "bg-white text-[#666783] border border-[#EAE8F2]"
                }`}
              >
                {searchOpen ? <X size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              </button>
              <button
                type="button"
                aria-label={`Filter team, ${filterLabel}`}
                onClick={() => setFilterSheetOpen(true)}
                className={`grid h-9 w-9 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8] ${
                  filter !== "all" ? "bg-[#6040E8] text-white" : "bg-white text-[#666783] border border-[#EAE8F2]"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 6h16M7 12h10M10 18h4" />
                </svg>
              </button>
            </div>
          </div>

          {searchOpen ? (
            <div className="relative mt-2.5">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9292A8]" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search team"
                aria-label="Search team"
                autoFocus
                className="min-h-11 w-full rounded-2xl border border-[#EAE8F2] bg-white pl-10 pr-10 text-base text-[#17172B] outline-none transition placeholder:text-[#9292A8] focus:border-[#6040E8] focus:ring-2 focus:ring-[#6040E8]/15"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#9292A8] hover:bg-[#F5F4FB]"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          {filter !== "all" ? (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#EFEAFF] px-3 text-[11px] font-bold text-[#4F31D0] transition hover:bg-[#E4DEFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
            >
              {filterLabel}
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}

          <ul className="mt-3 space-y-2.5">
            {visibleRows.map(({ employee, day, tasksRecorded, location }) => (
              <li key={employee.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(employee.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#EAE8F2] bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(23,23,43,0.04)] transition active:bg-[#F5F4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6040E8]"
                >
                  <Avatar name={employee.name} avatarUrl={employee.avatarUrl} size={46} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-[#17172B]">{employee.name}</span>
                    <span className="block truncate text-[12px] text-[#666783]">{employee.role}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-[#9292A8]">
                      {day.entries.length === 0 ? (
                        <span>No work logged</span>
                      ) : (
                        <>
                          <span>{tasksRecorded} task{tasksRecorded === 1 ? "" : "s"}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatMinutes(day.workMinutes)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <LocationGlyph location={location} />
                            {LOCATION_LABELS[location]}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={17} className="shrink-0 text-[#C9C6D8]" aria-hidden="true" />
                </button>
              </li>
            ))}
            {visibleRows.length === 0 ? (
              <li className="rounded-2xl border border-[#EAE8F2] bg-white px-4 py-8 text-center text-[13px] text-[#666783]">
                No employees match this search.
              </li>
            ) : null}
          </ul>
        </section>

        {exportError ? <p role="alert" className="mt-3 text-xs text-[#B43A3A]">{exportError}</p> : null}
      </main>

      {/* Bottom navigation */}
      <nav
        aria-label="Executive"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#EAE8F2] bg-white/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-lg items-stretch justify-around px-2 pt-1.5">
          <span className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[#6040E8]" aria-current="page">
            <Users size={19} aria-hidden="true" />
            <span className="text-[10px] font-bold">Team</span>
          </span>
          <Link
            href="/executive/reports"
            className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[#9292A8] transition hover:text-[#6040E8]"
          >
            <FileText size={19} aria-hidden="true" />
            <span className="text-[10px] font-semibold">Reports</span>
          </Link>
          <button
            type="button"
            onClick={() => setExportSheetOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[#9292A8] transition hover:text-[#6040E8]"
          >
            <Download size={19} aria-hidden="true" />
            <span className="text-[10px] font-semibold">Export</span>
          </button>
        </div>
      </nav>

      {/* Employee detail (full screen) */}
      {selected ? (
        <EmployeeDetailMobile
          db={db}
          employee={selected}
          boardDateKey={activeKey}
          todayKey={todayKey}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {/* Date picker sheet */}
      <DateSheet
        open={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        viewDate={activeKey}
        todayKey={todayKey}
        onSelect={(key) => {
          setDateKey(key);
          setDateSheetOpen(false);
        }}
      />

      {/* Team filter sheet */}
      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter team">
        <div className="flex flex-col gap-1">
          {FILTER_OPTIONS.map((f) => (
            <SheetOption
              key={f.id}
              label={f.label}
              selected={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setFilterSheetOpen(false);
              }}
            />
          ))}
        </div>
      </BottomSheet>

      {/* Export sheet */}
      <BottomSheet open={exportSheetOpen} onClose={() => setExportSheetOpen(false)} title="Export">
        <div className="flex flex-col gap-1">
          <SheetOption
            label={`Export ${formatDateLabel(activeKey)} (Excel)`}
            onClick={exportDay}
          />
          <Link
            href="/executive/reports"
            onClick={() => setExportSheetOpen(false)}
            className="flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold text-[#17172B] transition hover:bg-[#F7F6FC]"
          >
            Date range or full exercise
            <ChevronRight size={15} className="text-[#9292A8]" aria-hidden="true" />
          </Link>
        </div>
        {exporting ? <p className="mt-2 text-xs text-[#666783]">Preparing workbook…</p> : null}
      </BottomSheet>
    </div>
  );
}
