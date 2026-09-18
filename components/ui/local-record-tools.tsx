"use client";

import { useMemo, useState } from "react";
import { downloadRecords, recordPreview, type LocalRecord } from "@/lib/local-record-tools";

export function LocalRecordTools({ title, records, onLocate }: {
  title: string; records: LocalRecord[]; onLocate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<LocalRecord[] | null>(null);
  const [filename, setFilename] = useState("");
  const [limit, setLimit] = useState(50);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter(record => !needle || record.searchText.toLocaleLowerCase().includes(needle));
  }, [records, query]);
  const chosen = records.filter(record => selected.has(record.id));
  const prepare = (items: LocalRecord[]) => {
    setFilename(`${title}_${new Date().toLocaleDateString("sv-SE")}`);
    setPreview(items);
  };
  return <div className="local-record-tools" style={{ padding: "8px 12px", color: "var(--c-text, inherit)" }}
    onPointerDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>搜索 / TXT 导出</button>
    {open && <section aria-label={`${title}搜索与导出`} style={{ paddingTop: 8 }}>
      <input aria-label="搜索全部记录" placeholder="搜索正文、原文、摘要、时间" value={query}
        onChange={event => { setQuery(event.target.value); setLimit(50); }} style={{ width: "100%", padding: 8, color: "inherit", background: "var(--c-bg, #fff)", border: "1px solid currentColor" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "10px 0" }}>
        <span aria-live="polite">已选 {chosen.length} / 共 {records.length} 条 · 匹配 {filtered.length} 条</span>
        <button type="button" onClick={() => setSelected(new Set(records.map(record => record.id)))}>全选</button>
        <button type="button" onClick={() => setSelected(previous => new Set([...previous, ...filtered.map(record => record.id)]))}>选择筛选结果</button>
        <button type="button" onClick={() => setSelected(new Set())}>清空选择</button>
        <button type="button" disabled={!records.length} onClick={() => prepare(records)}>完整导出</button>
        <button type="button" disabled={!chosen.length} onClick={() => prepare(chosen)}>导出所选</button>
      </div>
      <div style={{ maxHeight: "35vh", overflowY: "auto", overflowAnchor: "none" }}>
        {filtered.slice(0, limit).map(record => <div key={record.id} style={{ padding: "8px 0", borderBottom: "1px solid #8885" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={selected.has(record.id)} onChange={() => setSelected(previous => {
              const next = new Set(previous); if (next.has(record.id)) next.delete(record.id); else next.add(record.id); return next;
            })} />
            <span>{record.label} · {record.time}</span>
          </label>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9em", padding: "4px 0" }}>{recordPreview(record.searchText, query)}</div>
          <button type="button" onClick={() => { setOpen(false); onLocate(record.id); }}>定位到原文</button>
        </div>)}
        {!filtered.length && <p>没有匹配的记录</p>}
        {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 50)}>显示更多结果</button>}
      </div>
      {preview && <section aria-label="确认导出" style={{ border: "1px solid currentColor", padding: 12, marginTop: 8 }}>
        <p>确认导出 {preview.length} 条记录，按原始顺序排列。只下载 TXT，不修改记录。</p>
        <label>文件名 <input value={filename} onChange={event => setFilename(event.target.value)} style={{ color: "inherit", background: "var(--c-bg, #fff)" }} /></label>
        <div style={{ maxHeight: "25vh", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0" }}>
          {preview.map(record => <details key={record.id}><summary>{record.label} · {record.time}</summary>{record.text}</details>)}
        </div>
        <button type="button" onClick={() => { downloadRecords(title, preview, filename); setPreview(null); }}>确认下载 TXT</button>
        <button type="button" onClick={() => setPreview(null)} style={{ marginLeft: 16 }}>取消</button>
      </section>}
    </section>}
  </div>;
}
