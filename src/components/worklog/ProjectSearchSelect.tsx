"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import type { TeamProject } from "@/lib/worklog/types";
import { NEW_PROJECT_OPTION } from "./shared";

interface ProjectSearchSelectProps {
  projects: TeamProject[];
  /** Currently committed project id ("" when none). */
  value: string;
  selectedProject?: TeamProject;
  disabled?: boolean;
  /** Called with the project id, or NEW_PROJECT_OPTION to open add-project. */
  onPick: (value: string) => void;
  /** Called when the user edits the query; parent owns filtering state. */
  onQueryChange: (query: string) => void;
  query: string;
  inputClassName: string;
}

/**
 * Single integrated searchable project/main-task selector.
 * Shows the committed selection until the user types; typing switches to
 * search mode and surfaces matching projects plus an add-project action.
 */
export function ProjectSearchSelect({
  projects,
  value,
  selectedProject,
  disabled = false,
  onPick,
  onQueryChange,
  query,
  inputClassName,
}: ProjectSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedName = selectedProject?.name ?? "";
  const queryTrimmed = query.trim();
  const queryLower = queryTrimmed.toLocaleLowerCase();

  const results = useMemo(() => {
    if (!queryLower) return projects;
    return projects.filter((project) => project.name.toLocaleLowerCase().includes(queryLower));
  }, [projects, queryLower]);

  const exactMatch = results.some(
    (project) => project.name.toLocaleLowerCase() === queryLower
  );
  const canAdd = queryTrimmed.length >= 2 && !exactMatch;
  const optionCount = results.length + 1; // + add-project row

  // Commit selection → leave search mode and echo the chosen name.
  function commit(id: string) {
    setEditing(false);
    setOpen(false);
    setActiveIndex(-1);
    onPick(id);
    onQueryChange("");
  }

  function handleChange(text: string) {
    setEditing(true);
    setOpen(true);
    setActiveIndex(-1);
    onQueryChange(text);
    if (value && text.trim() && text.trim().toLocaleLowerCase() !== selectedName.toLocaleLowerCase()) {
      // Searching for something else — drop the stale selection so a save
      // can't silently keep the previous project.
      onPick("");
    }
  }

  function handleFocus() {
    if (disabled) return;
    setOpen(true);
    if (!editing && value) {
      // Focus on a committed value: allow immediate re-search.
      setEditing(true);
      onQueryChange("");
    }
  }

  function handleBlur() {
    // Delay so option clicks register first.
    window.setTimeout(() => {
      setOpen(false);
      setEditing(false);
      setActiveIndex(-1);
      onQueryChange("");
    }, 120);
  }

  function clearSelection() {
    setEditing(false);
    setOpen(false);
    onPick("");
    onQueryChange("");
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setEditing(false);
        onQueryChange("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onQueryChange]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setEditing(false);
      onQueryChange("");
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        let next = index;
        for (let i = 0; i < optionCount; i += 1) {
          next = (next + dir + optionCount) % optionCount;
          if (next === results.length) {
            // add-project row is always enabled
            return next;
          }
          return next;
        }
        return next;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        commit(results[activeIndex].id);
      } else if (activeIndex === results.length || (activeIndex < 0 && canAdd)) {
        commit(NEW_PROJECT_OPTION);
      } else if (activeIndex < 0 && results.length === 1) {
        commit(results[0].id);
      }
    }
  }

  const displayValue = editing ? query : value ? selectedName : "";

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9A93C0]"
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="project-search-results"
          aria-autocomplete="list"
          value={displayValue}
          disabled={disabled}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Search projects or main tasks…"
          aria-label="Search projects or main tasks"
          className={`${inputClassName} pl-9 pr-16`}
        />
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {value && !editing ? (
            <button
              type="button"
              aria-label="Clear selected project"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelection}
              className="grid h-7 w-7 place-items-center rounded-md text-[#9A97AD] hover:bg-[#F1F0F6] hover:text-[#53506B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
          <ChevronDown size={15} aria-hidden="true" className="text-[#9A93C0]" />
        </span>
      </div>

      {open ? (
        <div
          id="project-search-results"
          role="listbox"
          aria-label="Matching projects"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-[#E8E6F0] bg-white p-1.5 shadow-[0_14px_36px_rgba(27,25,61,0.18)]"
        >
          {results.map((project, index) => {
            const selected = project.id === value;
            const active = index === activeIndex;
            return (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(project.id)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "bg-[#F0EDFF] font-medium text-[#4936AE]"
                    : active
                      ? "bg-[#F7F5FF] text-[#373A55]"
                      : "text-[#535A76] hover:bg-[#F7F5FF]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="block truncate text-[11px] text-[#9A97AD]">
                    {project.origin === "staff"
                      ? project.promotedAt
                        ? "Staff-added · approved"
                        : "Staff-added · pending review"
                      : (project.description ?? "Team project")}
                  </span>
                </span>
                {selected ? <Check size={15} className="shrink-0 text-[#7257FF]" aria-hidden="true" /> : null}
              </button>
            );
          })}

          {results.length === 0 && !canAdd ? (
            <p className="px-3 py-4 text-center text-xs text-[#9A97AD]">
              No matching projects — add it below.
            </p>
          ) : null}

          <button
            type="button"
            role="option"
            aria-selected={false}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => commit(NEW_PROJECT_OPTION)}
            onMouseEnter={() => setActiveIndex(results.length)}
            className={`mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg border-t border-[#F0EDF6] px-2.5 py-2 text-left text-sm font-semibold transition-colors ${
              activeIndex === results.length
                ? "bg-[#EAF8F0] text-[#15803D]"
                : "text-[#15803D] hover:bg-[#EAF8F0]"
            }`}
          >
            <Plus size={15} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {canAdd ? `Add “${queryTrimmed}” as a project` : "Add a project / task…"}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
