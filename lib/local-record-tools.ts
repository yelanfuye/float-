// Local-only search/export helpers. No storage writes, network or audio dependencies.
export type LocalRecord = { id: string; label: string; time: string; text: string; searchText: string };

export function recordPlainText(source: string): string {
  if (!source) return "";
  const prepared = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|section|article|blockquote|ul|ol|li|tr|pre|details|summary)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t");
  // Parse inertly; never insert generated HTML into the live document.
  const text = typeof DOMParser !== "undefined"
    ? new DOMParser().parseFromString(prepared, "text/html").body.textContent || ""
    : prepared.replace(/<[^>]+>/g, "");
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function recordPreview(text: string, query: string): string {
  const plain = text.replace(/\s+/g, " ");
  const index = plain.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  const start = Math.max(0, index - 40);
  return `${start ? "…" : ""}${plain.slice(start, start + 180)}${plain.length > start + 180 ? "…" : ""}`;
}

export function downloadRecords(title: string, records: LocalRecord[], filename: string): void {
  const content = [title, ...records.map(record => `${record.label}\n时间：${record.time}\n\n${record.text}`)].join("\n\n--------------------\n\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename.replace(/\.txt$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 160) || "记录"}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
