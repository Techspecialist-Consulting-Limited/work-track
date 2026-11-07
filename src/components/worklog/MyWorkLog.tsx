"use client";

import { MobileStaffWorkspace } from "./MobileStaffWorkspace";
import { DesktopStaffWorkspace } from "./DesktopStaffWorkspace";
import { RecordsDialog } from "./RecordsDialog";
import { TaskDetailsDialog } from "./TaskDetailsDialog";
import { ViewportDebug } from "./ViewportDebug";
import { useWorkLogController } from "./useWorkLogController";

export function MyWorkLog() {
  const controller = useWorkLogController();

  if (!controller.mounted) {
    return <div className="grid min-h-dvh place-items-center text-sm text-[#777A91]">Loading your work log…</div>;
  }

  return (
    <>
      <MobileStaffWorkspace c={controller} />
      <DesktopStaffWorkspace c={controller} />
      <RecordsDialog c={controller} />
      <TaskDetailsDialog c={controller} />
      <ViewportDebug />
      {controller.notice ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-[#17172F] px-4 py-3 text-sm font-medium text-white shadow-xl lg:bottom-5"
        >
          {controller.notice}
        </div>
      ) : null}
    </>
  );
}
