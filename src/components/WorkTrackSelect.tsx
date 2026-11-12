"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface WorkTrackSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  dotColor?: string;
  disabled?: boolean;
  tone?: "success";
}

interface WorkTrackSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly WorkTrackSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  leadingIcon?: ReactNode;
  variant?: "light" | "dark";
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}
// testing values
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;
const MENU_MAX_HEIGHT = 280;
const OPTION_HEIGHT = 44;

export function WorkTrackSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className = "",
  leadingIcon,
  variant = "light",
}: WorkTrackSelectProps<T>) {
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const getMenuPosition = useCallback((trigger: HTMLButtonElement): MenuPosition => {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      Math.max(rect.width, Math.min(168, viewportWidth - VIEWPORT_PADDING * 2)),
      viewportWidth - VIEWPORT_PADDING * 2
    );
    const desiredHeight = Math.min(options.length * OPTION_HEIGHT + 12, MENU_MAX_HEIGHT);
    const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_PADDING;
    const openBelow = spaceBelow >= desiredHeight || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(80, Math.min(MENU_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove));
    const top = openBelow ? rect.bottom + MENU_GAP : Math.max(VIEWPORT_PADDING, rect.top - MENU_GAP - Math.min(desiredHeight, maxHeight));
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      viewportWidth - width - VIEWPORT_PADDING
    );

    return { left, top, width, maxHeight };
  }, [options.length]);

  const openMenu = useCallback((nextIndex = selectedIndex) => {
    const trigger = triggerRef.current;
    if (!trigger || disabled) return;
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(nextIndex >= 0 && !options[nextIndex]?.disabled ? nextIndex : firstEnabled);
    setPosition(getMenuPosition(trigger));
    setOpen(true);
  }, [disabled, getMenuPosition, options, selectedIndex]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const moveActive = useCallback((startIndex: number, direction: 1 | -1) => {
    if (!options.length) return;
    let index = startIndex;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) {
        setActiveIndex(index);
        document.getElementById(`${listboxId}-option-${index}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }, [listboxId, options]);

  const moveToBoundary = useCallback((fromEnd: boolean) => {
    const indexes = options.map((option, index) => ({ option, index }));
    const candidate = (fromEnd ? indexes.reverse() : indexes).find(({ option }) => !option.disabled);
    if (candidate) {
      setActiveIndex(candidate.index);
      document.getElementById(`${listboxId}-option-${candidate.index}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [listboxId, options]);

  const selectOption = useCallback((option: WorkTrackSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  }, [closeMenu, onChange]);

  const handleTypeahead = useCallback((character: string) => {
    typeaheadRef.current += character.toLocaleLowerCase();
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 500);

    const query = typeaheadRef.current;
    const start = open ? activeIndex : selectedIndex;
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (start + offset + options.length) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
        if (!open) openMenu(index);
        else setActiveIndex(index);
        return;
      }
    }
  }, [activeIndex, open, openMenu, options, selectedIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        openMenu(event.key === "Home"
          ? options.findIndex((option) => !option.disabled)
          : [...options].map((option, index) => ({ option, index })).reverse().find(({ option }) => !option.disabled)?.index ?? -1);
      } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        handleTypeahead(event.key);
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveToBoundary(event.key === "End");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) selectOption(option);
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      handleTypeahead(event.key);
    }
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const updatePosition = () => {
      if (triggerRef.current) setPosition(getMenuPosition(triggerRef.current));
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [getMenuPosition, open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  const dark = variant === "dark";
  const currentLabel = selectedOption?.label ?? placeholder ?? "";

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
        className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C45F5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 sm:text-sm ${
          dark
            ? "border-white/[0.1] bg-[#0b1125]/90 text-wt-text hover:border-wt-violet/55 hover:bg-[#111832]"
            : "border-[#E7E6EF] bg-white text-[#535A76] hover:border-[#CFC8F3] hover:bg-[#FCFBFF]"
        }`}
      >
        {leadingIcon ? <span aria-hidden="true" className="shrink-0">{leadingIcon}</span> : null}
        <span className="min-w-0 flex-1 truncate" title={currentLabel}>{currentLabel}</span>
        <ChevronDown size={14} aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""} ${dark ? "text-wt-muted" : "text-[#858BA1]"}`} />
      </button>

      {open && position && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          className={`wt-dropdown-enter fixed z-[100] overflow-y-auto overscroll-contain rounded-[11px] border border-[#E8E6F0] bg-white p-1.5 shadow-[0_14px_36px_rgba(27,25,61,0.18)] ${dark ? "text-[#535A76]" : ""}`}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            touchAction: "pan-y",
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                onPointerMove={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => selectOption(option)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-sm leading-snug transition-colors ${
                  option.disabled
                    ? "cursor-not-allowed text-[#A7A9B6]"
                    : selected
                      ? "bg-[#F0EDFF] font-medium text-[#4936AE]"
                      : active
                        ? "bg-[#F7F5FF] text-[#373A55]"
                        : option.tone === "success"
                          ? "bg-[#EAF8F0] font-semibold text-[#15803D] hover:bg-[#DFF3E8]"
                          : "text-[#535A76] hover:bg-[#F7F5FF]"
                }`}
              >
                {option.dotColor ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.dotColor }} /> : null}
                <span className={`min-w-0 flex-1 break-words ${option.tone === "success" ? "font-semibold text-[#15803D]" : ""}`}>{option.label}</span>
                {selected ? <Check size={14} aria-hidden="true" className="shrink-0 text-[#7257FF]" /> : null}
              </div>
            );
          })}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
