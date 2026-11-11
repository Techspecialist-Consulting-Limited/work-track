"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Folder,
  Pencil,
  Plus,
  Save,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ProfileMenu } from "@/components/worklog/ProfileMenu";
import {
  archiveTeamProject,
  assignEmployeeTeam,
  createTeam,
  createTeamProject,
  getDatabaseSnapshot,
  getServerSnapshot,
  getSessionEmployeeId,
  getSessionRole,
  getSessionUser,
  promoteTeamProject,
  subscribeToDatabase,
  updateTeam,
  updateTeamProject,
} from "@/lib/worklog/repository";
import { getProjectsForTeam } from "@/lib/worklog/selectors";
import type { Employee, Team, TeamProject } from "@/lib/worklog/types";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full rounded-lg border border-[#E7E6F0] bg-white px-3 py-2 text-sm text-[#17172F] outline-none transition focus:border-[#6C45F5] focus:ring-2 focus:ring-[#6C45F5]/15";

export function TeamsAdmin() {
  const db = useSyncExternalStore(subscribeToDatabase, getDatabaseSnapshot, getServerSnapshot);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meEmployee = db.employees.find((employee) => employee.id === getSessionEmployeeId());
  const role = getSessionRole();
  const teams = useMemo(
    () => [...db.teams].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [db.teams]
  );
  const activeTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;

  async function run<T extends { ok?: boolean; message?: string } | null>(
    promise: Promise<T>,
    success: string
  ): Promise<boolean> {
    setError(null);
    try {
      const result = await promise;
      if (!result || result.ok === false) {
        setError(result?.message ?? "That change could not be saved.");
        return false;
      }
      setNotice(success);
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    }
  }

  if (!mounted) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#F7F7FC] text-sm text-[#737A96]">
        Loading configuration…
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#F7F7FC] px-4 py-5 text-[#17172F] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#6C45F5] text-white">
              <Zap size={18} strokeWidth={2.2} fill="currentColor" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Teams &amp; Projects</h1>
              <p className="text-xs text-[#777A91]">Configuration only — separate from reporting access.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/executive"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E7E6F0] bg-white px-3 text-sm font-semibold text-[#4A4665] transition hover:border-[#CFC8F3] hover:bg-[#F5F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <ArrowLeft size={15} aria-hidden="true" /> Executive board
            </Link>
            <ProfileMenu
              name={meEmployee?.name ?? getSessionUser()?.name ?? "Account"}
              role={meEmployee ? `${meEmployee.role} · ${meEmployee.department}` : role === "chairman" ? "Chairman" : "Config admin"}
              avatarUrl={meEmployee?.avatarUrl}
              editable={Boolean(meEmployee) && role !== "chairman"}
            />
          </div>
        </header>

        {notice ? (
          <p role="status" className="mb-4 rounded-xl border border-[#C7EBD8] bg-[#ECFDF5] px-4 py-2.5 text-sm text-[#047857]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-[#F6C7C7] bg-[#FDEEEE] px-4 py-2.5 text-sm text-[#B43A3A]">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">Teams</h2>
                <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B6880]">
                  {teams.length}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {teams.map((team) => {
                  const selected = activeTeam?.id === team.id;
                  const memberCount = db.employeeTeams.filter((row) => row.teamId === team.id).length;
                  return (
                    <li key={team.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTeamId(team.id)}
                        aria-pressed={selected}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] ${
                          selected
                            ? "border-[#6C45F5] bg-[#F5F1FF]"
                            : "border-transparent hover:border-[#E7E6F0] hover:bg-[#FCFBFF]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#17172F]">
                            {team.name}
                          </span>
                          {team.isDefault ? (
                            <span className="rounded-full bg-[#EAF8F0] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#15803D]">
                              Default
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8B8B9A]">
                          <Users size={11} aria-hidden="true" /> {memberCount} member{memberCount === 1 ? "" : "s"}
                          {!team.isActive ? <span className="text-[#B45309]">· inactive</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {teams.length === 0 ? (
                  <li className="rounded-xl bg-[#F7F7FC] px-3 py-4 text-center text-xs text-[#777A91]">
                    No teams yet. Create the first one.
                  </li>
                ) : null}
              </ul>
            </section>

            <NewTeamCard
              onCreated={async (teamId, message) => {
                setNotice(message);
                setSelectedTeamId(teamId);
              }}
              onError={setError}
            />
          </aside>

          <div className="min-w-0 space-y-4">
            {activeTeam ? (
              <>
                <TeamEditor
                  key={activeTeam.id}
                  team={activeTeam}
                  onSave={async (input) => {
                    const ok = await run(updateTeam({ teamId: activeTeam.id, ...input }), "Team updated.");
                    return ok;
                  }}
                />
                <MembersPanel
                  employees={db.employees}
                  assignedIds={
                    new Set(
                      db.employeeTeams
                        .filter((row) => row.teamId === activeTeam.id)
                        .map((row) => row.employeeId)
                    )
                  }
                  onToggle={async (employeeId, assigned) => {
                    const ok = await run(
                      assignEmployeeTeam({ employeeId, teamId: activeTeam.id, assigned }),
                      assigned ? "Employee added to the team." : "Employee removed from the team."
                    );
                    return ok;
                  }}
                />
                <ProjectsPanel
                  team={activeTeam}
                  projects={getProjectsForTeam(db, activeTeam.id, { includeArchived: true })}
                  onCreate={async (input) => {
                    const ok = await run(createTeamProject({ teamId: activeTeam.id, ...input }), "Project created.");
                    return ok;
                  }}
                  onUpdate={async (projectId, input) => {
                    const ok = await run(updateTeamProject({ projectId, ...input }), "Project updated.");
                    return ok;
                  }}
                  onArchive={async (projectId, archived) => {
                    const ok = await run(
                      archiveTeamProject(projectId, archived),
                      archived ? "Project archived." : "Project restored."
                    );
                    return ok;
                  }}
                  onPromote={async (projectId) => {
                    const ok = await run(promoteTeamProject(projectId), "Staff project approved.");
                    return ok;
                  }}
                />
              </>
            ) : (
              <section className="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-[#D8D3EC] bg-white p-8 text-center">
                <div>
                  <Folder size={28} className="mx-auto text-[#B8A8F8]" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-[#39364F]">No team selected</p>
                  <p className="mt-1 text-xs text-[#777A91]">Create a team to assign staff and projects.</p>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function NewTeamCard({
  onCreated,
  onError,
}: {
  onCreated: (teamId: string, message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (name.trim().length < 2) {
      onError("Enter a team name of at least 2 characters.");
      return;
    }
    setSaving(true);
    try {
      const result = await createTeam({ name: name.trim(), description: description.trim() || undefined });
      if (!result || result.ok === false) {
        onError(result?.message ?? "Could not create the team.");
        return;
      }
      onCreated(result.teamId ?? "", "Team created.");
      setName("");
      setDescription("");
      setOpen(false);
    } catch {
      onError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-3 shadow-sm">
      {open ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#8B8B9A]">New team</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cancel new team"
              className="grid h-7 w-7 place-items-center rounded-lg text-[#777A91] hover:bg-[#F7F7FC]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Team name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Customer Success"
              className={INPUT_CLASS}
              autoFocus
            />
          </label>
          <label className="mt-2 block text-[11px] font-semibold text-[#53506B]">
            Description (optional)
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:opacity-50"
          >
            <Plus size={15} aria-hidden="true" /> {saving ? "Creating…" : "Create team"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#CFC8F3] text-sm font-semibold text-[#5A3ED0] transition hover:bg-[#F5F1FF]"
        >
          <Plus size={15} aria-hidden="true" /> New team
        </button>
      )}
    </section>
  );
}

function TeamEditor({
  team,
  onSave,
}: {
  team: Team;
  onSave: (input: { name?: string; description?: string | null; isActive?: boolean }) => Promise<boolean>;
}) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [isActive, setIsActive] = useState(team.isActive);
  const [saving, setSaving] = useState(false);

  const dirty = name !== team.name || description !== (team.description ?? "") || isActive !== team.isActive;

  async function save() {
    setSaving(true);
    const ok = await onSave({ name: name.trim(), description: description.trim() || null, isActive });
    setSaving(false);
    if (!ok) return;
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#17172F]">{team.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#8B8B9A]">
            <span>Created {new Date(team.createdAt).toLocaleDateString()}</span>
            {team.origin === "backfill" ? (
              <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 font-semibold text-[#9A6200]">
                Auto-created from department — verify
              </span>
            ) : (
              <span className="rounded-full bg-[#EAF8F0] px-2 py-0.5 font-semibold text-[#15803D]">Admin-created</span>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#53506B]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 accent-[#6C45F5]"
          />
          Active
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[#53506B]">
          Team name
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-xs font-semibold text-[#53506B]">
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this team owns"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save team"}
        </button>
      </div>
    </section>
  );
}

function MembersPanel({
  employees,
  assignedIds,
  onToggle,
}: {
  employees: Employee[];
  assignedIds: Set<string>;
  onToggle: (employeeId: string, assigned: boolean) => Promise<boolean>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));

  async function toggle(employeeId: string, assigned: boolean) {
    setPendingId(employeeId);
    await onToggle(employeeId, assigned);
    setPendingId(null);
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[#17172F]">Team members</h2>
        <span className="text-[11px] font-semibold text-[#8B8B9A]">
          {assignedIds.size} of {employees.length} staff
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#777A91]">
        Only assigned staff can select this team and its projects when logging work.
      </p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {sorted.map((employee) => {
          const assigned = assignedIds.has(employee.id);
          return (
            <li key={employee.id}>
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition ${
                  assigned ? "border-[#CFC8F3] bg-[#F5F1FF]" : "border-[#E7E6F0] bg-white hover:bg-[#FCFBFF]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={assigned}
                  disabled={pendingId === employee.id}
                  onChange={(event) => toggle(employee.id, event.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[#6C45F5]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#17172F]">{employee.name}</span>
                  <span className="block truncate text-[11px] text-[#8B8B9A]">
                    {employee.role}
                    {employee.department ? ` · ${employee.department}` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProjectsPanel({
  team,
  projects,
  onCreate,
  onUpdate,
  onArchive,
  onPromote,
}: {
  team: Team;
  projects: TeamProject[];
  onCreate: (input: { name: string; description?: string }) => Promise<boolean>;
  onUpdate: (projectId: string, input: { name?: string; description?: string | null; isActive?: boolean }) => Promise<boolean>;
  onArchive: (projectId: string, archived: boolean) => Promise<boolean>;
  onPromote: (projectId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (name.trim().length < 2) return;
    setCreating(true);
    const ok = await onCreate({ name: name.trim(), description: description.trim() || undefined });
    setCreating(false);
    if (ok) {
      setName("");
      setDescription("");
    }
  }

  return (
    <section className="rounded-2xl border border-[#E7E6F0] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[#17172F]">Project library</h2>
        <span className="text-[11px] font-semibold text-[#8B8B9A]">
          {projects.filter((project) => !project.archivedAt).length} active
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#777A91]">
        Predefined projects for {team.name}. Staff can add missing projects from the work form; approve them here.
      </p>

      <div className="mt-3 rounded-xl border border-[#E7E6F0] bg-[#FCFBFF] p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-end">
          <label className="block text-[11px] font-semibold text-[#53506B]">
            Project name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New project"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[#53506B]">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={creating || name.trim().length < 2}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#6C45F5] px-4 text-sm font-semibold text-white transition hover:bg-[#5935DE] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} aria-hidden="true" /> {creating ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            onUpdate={onUpdate}
            onArchive={onArchive}
            onPromote={onPromote}
          />
        ))}
        {projects.length === 0 ? (
          <li className="rounded-xl bg-[#F7F7FC] px-3 py-6 text-center text-xs text-[#777A91]">
            No projects in this team yet.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function ProjectRow({
  project,
  onUpdate,
  onArchive,
  onPromote,
}: {
  project: TeamProject;
  onUpdate: (projectId: string, input: { name?: string; description?: string | null; isActive?: boolean }) => Promise<boolean>;
  onArchive: (projectId: string, archived: boolean) => Promise<boolean>;
  onPromote: (projectId: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [isActive, setIsActive] = useState(project.isActive);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const ok = await onUpdate(project.id, {
      name: name.trim(),
      description: description.trim() || null,
      isActive,
    });
    setPending(false);
    if (ok) setEditing(false);
  }

  async function toggleArchive() {
    setPending(true);
    await onArchive(project.id, !project.archivedAt);
    setPending(false);
  }

  async function promote() {
    setPending(true);
    await onPromote(project.id);
    setPending(false);
  }

  const archived = Boolean(project.archivedAt);

  return (
    <li
      className={`rounded-xl border p-3 ${
        archived ? "border-[#E7E6F0] bg-[#F7F7FC]" : "border-[#E7E6F0] bg-white"
      }`}
    >
      {editing ? (
        <div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[#53506B]">
              Project name
              <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="block text-[11px] font-semibold text-[#53506B]">
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#53506B]">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-4 w-4 accent-[#6C45F5]"
              />
              Active for new entries
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-9 rounded-lg border border-[#E7E6F0] px-3 text-xs font-semibold text-[#53506B] hover:bg-[#F7F7FC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || name.trim().length < 2}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#6C45F5] px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Save size={13} aria-hidden="true" /> Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className={`break-words text-sm font-semibold ${archived ? "text-[#8B8B9A] line-through" : "text-[#17172F]"}`}>
                {project.name}
              </span>
              {project.origin === "staff" ? (
                project.promotedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF8F0] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#15803D]">
                    <BadgeCheck size={10} aria-hidden="true" /> Approved
                  </span>
                ) : (
                  <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9A6200]">
                    Staff-added
                  </span>
                )
              ) : (
                <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6B6880]">
                  Predefined
                </span>
              )}
              {!project.isActive ? (
                <span className="rounded-full bg-[#FFF4E0] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9A6200]">
                  Inactive
                </span>
              ) : null}
              {archived ? (
                <span className="rounded-full bg-[#F1F0F6] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6B6880]">
                  Archived
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 break-words text-[11px] leading-4 text-[#777A91]">
              {project.description ?? "No description."}
            </p>
            {project.origin === "staff" ? (
              <p className="mt-0.5 text-[10px] text-[#9A97AD]">
                Added by {project.createdByName ?? "staff"}
                {project.promotedByName ? ` · approved by ${project.promotedByName}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {project.origin === "staff" && !project.promotedAt && !archived ? (
              <button
                type="button"
                onClick={promote}
                disabled={pending}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#A7E8C4] bg-[#ECFDF5] px-2.5 text-[11px] font-semibold text-[#047857] hover:bg-[#D8FBE8] disabled:opacity-50"
              >
                <BadgeCheck size={12} aria-hidden="true" /> Approve
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] hover:bg-[#F7F7FC]"
            >
              <Pencil size={12} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              onClick={toggleArchive}
              disabled={pending}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#E7E6F0] px-2.5 text-[11px] font-semibold text-[#53506B] hover:bg-[#F7F7FC] disabled:opacity-50"
            >
              <Archive size={12} aria-hidden="true" /> {archived ? "Restore" : "Archive"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
