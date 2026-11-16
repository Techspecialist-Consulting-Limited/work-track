import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ATTACHMENT_BYTES,
  isImageMime,
  sanitizeFileName,
  validateAttachmentFile,
} from "../src/lib/worklog/attachment-rules";
import { breakCountdown } from "../src/lib/worklog/break-timer";
import { WORKTRACK_SCHEDULE } from "../src/lib/worktrack/schedule-config";

test("supported document uploads validate", () => {
  for (const [name, mime] of [
    ["report.pdf", "application/pdf"],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["export.csv", "text/csv"],
    ["readme.txt", "text/plain"],
  ] as const) {
    const result = validateAttachmentFile(name, mime, 1024);
    assert.equal(result.ok, true, name);
    assert.equal(result.mimeType, mime);
  }
});

test("supported image uploads validate", () => {
  for (const [name, mime] of [
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["shot.png", "image/png"],
    ["pic.webp", "image/webp"],
  ] as const) {
    const result = validateAttachmentFile(name, mime, 2048);
    assert.equal(result.ok, true, name);
  }
});

test("unsupported file types are rejected", () => {
  for (const name of ["virus.exe", "script.js", "archive.zip", "noextension", "file.svg"]) {
    const result = validateAttachmentFile(name, "application/octet-stream", 100);
    assert.equal(result.ok, false, name);
  }
});

test("oversized files are rejected at the 10 MB limit", () => {
  const result = validateAttachmentFile("big.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1);
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /10 MB/);
  assert.equal(validateAttachmentFile("ok.pdf", "application/pdf", MAX_ATTACHMENT_BYTES).ok, true);
});

test("empty files and MIME mismatches are rejected", () => {
  assert.equal(validateAttachmentFile("a.pdf", "application/pdf", 0).ok, false);
  const mismatch = validateAttachmentFile("photo.png", "application/x-msdownload", 100);
  assert.equal(mismatch.ok, false);
});

test("sanitise strips path segments and unsafe characters", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("my file (final).PDF"), "my file (final).PDF");
  assert.equal(isImageMime("image/png"), true);
  assert.equal(isImageMime("application/pdf"), false);
});

test("break countdown derives remaining time from the persisted start", () => {
  const start = "2025-01-06T13:00:00.000Z"; // arbitrary instant
  const startMs = new Date(start).getTime();
  const allowance = WORKTRACK_SCHEDULE.breakAllowanceMinutes * 60;

  // 10 minutes elapsed of a 60 minute allowance → 50:00 remaining.
  const mid = breakCountdown(start, startMs + 10 * 60_000, WORKTRACK_SCHEDULE.breakAllowanceMinutes);
  assert.equal(mid.exceeded, false);
  assert.equal(mid.remainingSeconds, allowance - 600);
  assert.equal(mid.overSeconds, 0);

  // Exactly at the boundary → zero remaining, not yet exceeded.
  const edge = breakCountdown(start, startMs + allowance * 1000, WORKTRACK_SCHEDULE.breakAllowanceMinutes);
  assert.equal(edge.exceeded, false);
  assert.equal(edge.remainingSeconds, 0);

  // Past the allowance → overrun tracked, never auto-ended.
  const over = breakCountdown(start, startMs + (allowance + 135) * 1000, WORKTRACK_SCHEDULE.breakAllowanceMinutes);
  assert.equal(over.exceeded, true);
  assert.equal(over.remainingSeconds, 0);
  assert.equal(over.overSeconds, 135);
});

test("break countdown is stable across recomputation (refresh-safe)", () => {
  const start = "2025-01-06T13:00:00.000Z";
  const startMs = new Date(start).getTime();
  const now = startMs + 30 * 60_000;
  // Recomputing from the same persisted start at the same instant is identical —
  // there is no counter state that a refresh could reset.
  assert.deepEqual(
    breakCountdown(start, now, WORKTRACK_SCHEDULE.breakAllowanceMinutes),
    breakCountdown(start, now, WORKTRACK_SCHEDULE.breakAllowanceMinutes)
  );
});
