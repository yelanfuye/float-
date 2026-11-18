"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, FileEdit, Plus, Search, Tags, Trash2 } from "lucide-react";
import { ApiSettings } from "./api-settings";
import { VoiceSettings } from "./voice-settings";
import { ImageGenerationSettings } from "./image-generation-settings";
import { hydrateKvDb } from "@/lib/kv-db";
import { loadImageGenerationSettings } from "@/lib/settings-storage";
import { apiManagerTagKey, readApiManagerTags, updateApiManagerTags, type ApiManagerTags } from "@/lib/api-manager-tags";

type Kind = "api" | "voice" | "imageGeneration";
type Entry = { id: string; name: string; model: string };
type Actions = { add: () => void; edit: (id: string) => void; remove?: (id: string) => void };

function ConfigList({ kind, entries, actions }: { kind: Kind; entries: Entry[]; actions: Actions }) {
    const [metadata, setMetadata] = useState<ApiManagerTags>({});
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState<string[]>([]);
    const [any, setAny] = useState(false);
    const [untagged, setUntagged] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [batch, setBatch] = useState(false);
    const [picked, setPicked] = useState<string[]>([]);
    const [editor, setEditor] = useState<{ ids: string[]; mode: "add" | "remove" } | null>(null);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    useEffect(() => {
        let cancelled = false;
        hydrateKvDb().then(() => {
            const tags = readApiManagerTags();
            if (!cancelled) { setMetadata(tags); setReady(true); }
        }).catch(() => { if (!cancelled) setError("标签数据读取失败，请通过旧版入口管理 API；未覆盖原数据。"); });
        return () => { cancelled = true; };
    }, []);
    const tagsFor = (id: string) => metadata[apiManagerTagKey(kind, id)] || [];
    const vocabulary = Array.from(new Set(Object.values(metadata).flat())).sort((a, b) => a.localeCompare(b));
    const available = Array.from(new Set(entries.flatMap(entry => tagsFor(entry.id)))).sort((a, b) => a.localeCompare(b));
    const visible = entries.filter(entry => {
        const tags = tagsFor(entry.id);
        if (![entry.name, entry.model, ...tags].join(" ").toLowerCase().includes(query.trim().toLowerCase())) return false;
        if (untagged) return tags.length === 0;
        return !filters.length || (any ? filters.some(tag => tags.includes(tag)) : filters.every(tag => tags.includes(tag)));
    });
    const changeFilter = (fn: () => void) => { setPicked([]); fn(); };
    const openTags = (ids: string[], mode: "add" | "remove") => { setInput(""); setMessage(""); setEditor({ ids, mode }); };
    const togglePicked = (id: string) => setPicked(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    const saveTags = async () => {
        if (!editor || busy || !ready) return;
        setBusy(true);
        try {
            const next = await updateApiManagerTags(editor.ids.map(id => apiManagerTagKey(kind, id)), input.split(/[,，;；\n]+/), editor.mode);
            setMetadata(next); setPicked([]); setEditor(null); setMessage(`已更新 ${editor.ids.length} 个方案的标签`);
        } catch (reason) { setMessage(reason instanceof Error ? reason.message : "标签保存失败"); }
        finally { setBusy(false); }
    };
    return <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2"><Search size={17} aria-hidden="true" /><input aria-label="搜索方案" className="ui-input min-w-0 flex-1" placeholder="搜索名称、模型或标签" value={query} onChange={event => changeFilter(() => setQuery(event.target.value))} /></div>
        <div className="flex flex-wrap gap-2"><button className="ui-btn flex-1" aria-expanded={showFilters} disabled={!ready} onClick={() => setShowFilters(!showFilters)}><Tags size={16} />标签筛选{filters.length ? ` (${filters.length})` : ""}</button><button className="ui-btn flex-1" aria-pressed={batch} disabled={!ready} onClick={() => { setBatch(!batch); setPicked([]); }}>{batch ? "完成批量操作" : "批量操作"}</button><button className="ui-btn" onClick={actions.add} title="新增方案"><Plus size={17} /><span>新增</span></button></div>
        {showFilters && <div className="flex flex-col gap-3 border-y py-3" style={{ borderColor: "var(--c-card-border)" }}>
            <div className="flex flex-wrap gap-2">{available.map(tag => <button key={tag} className="ui-btn !min-h-9 !px-3 !py-1 text-xs" aria-pressed={filters.includes(tag)} style={filters.includes(tag) ? { background: "var(--c-text-title)", color: "var(--c-card, #fff)" } : undefined} onClick={() => changeFilter(() => { setUntagged(false); setFilters(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag]); })}>{tag}</button>)}</div>
            {!available.length && <span className="menu-desc">暂无标签</span>}
            <div className="flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={any} onChange={event => changeFilter(() => setAny(event.target.checked))} />满足任一标签</label><label className="flex items-center gap-2"><input type="checkbox" checked={untagged} onChange={event => changeFilter(() => { setUntagged(event.target.checked); setFilters([]); })} />只看未打标签</label></div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 menu-desc"><span>显示 {visible.length} / {entries.length} 个方案</span>{(query || filters.length > 0 || untagged) && <button className="ui-link-btn" onClick={() => changeFilter(() => { setQuery(""); setFilters([]); setUntagged(false); })}>清除筛选</button>}</div>
        {filters.length > 0 && <div className="flex flex-wrap gap-2 menu-desc"><span>{any ? "满足任一：" : "同时满足："}</span>{filters.map(tag => <button key={tag} className="ui-link-btn" onClick={() => changeFilter(() => setFilters(previous => previous.filter(value => value !== tag)))}>{tag} ×</button>)}</div>}
        {batch && <div className="flex flex-wrap items-center gap-3 border-y py-3"><span className="menu-desc">已选 {picked.length} 项</span><button className="ui-link-btn" disabled={!visible.length} onClick={() => setPicked(visible.every(entry => picked.includes(entry.id)) ? [] : visible.map(entry => entry.id))}>全选 / 取消当前结果</button><button className="ui-btn" disabled={!picked.length || busy} onClick={() => openTags(picked, "add")}>添加标签</button><button className="ui-btn" disabled={!picked.length || busy} onClick={() => openTags(picked, "remove")}>移除标签</button></div>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="menu-desc">{message}</p>}
        <div className="divide-y overflow-hidden rounded-lg border" style={{ borderColor: "var(--c-card-border)", background: "var(--c-card)" }}>
            {visible.map(entry => <div key={entry.id} className="flex min-h-[80px] min-w-0 items-center gap-2 px-3 py-2">
                {batch && <input className="h-5 w-5 shrink-0" type="checkbox" aria-label={`选择 ${entry.name}`} checked={picked.includes(entry.id)} onChange={() => togglePicked(entry.id)} />}
                <div className="min-w-0 flex-1"><button className="block w-full min-w-0 text-left" onClick={() => batch ? togglePicked(entry.id) : actions.edit(entry.id)}><span className="block truncate text-sm font-semibold">{entry.name}</span><span className="menu-desc block truncate">{entry.model}</span></button><div className="mt-1 flex flex-wrap gap-1">{tagsFor(entry.id).map(tag => <button key={tag} className="rounded px-2 py-1 text-xs" style={{ background: "var(--c-input)", color: "var(--c-text-title)", overflowWrap: "anywhere" }} disabled={batch} onClick={() => changeFilter(() => { setFilters([tag]); setUntagged(false); })}>{tag}</button>)}{!tagsFor(entry.id).length && <span className="menu-desc text-xs">未打标签</span>}</div></div>
                {!batch && <div className="flex shrink-0 flex-col"><button className="ui-link-btn p-2" aria-label={`编辑 ${entry.name}`} title="编辑方案" onClick={() => actions.edit(entry.id)}><FileEdit size={17} /></button><button className="ui-link-btn p-2" disabled={!ready} aria-label={`为 ${entry.name} 添加标签`} title="添加标签" onClick={() => openTags([entry.id], "add")}><Tags size={17} /></button>{actions.remove && <button className="ui-link-btn p-2" title="删除方案" aria-label={`删除 ${entry.name}`} onClick={() => actions.remove?.(entry.id)}><Trash2 size={16} /></button>}</div>}
            </div>)}
            {!visible.length && <p className="menu-desc p-5 text-center">没有匹配的方案</p>}
        </div>
        {editor && <div className="modal-overlay modal-overlay-bottom"><div className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="api-tag-title"><div className="modal-header"><button className="modal-header-btn" disabled={busy} onClick={() => setEditor(null)}>取消</button><h3 id="api-tag-title" className="modal-header-title">{editor.mode === "add" ? "添加" : "移除"}标签 · {editor.ids.length} 项</h3><button className="modal-header-btn" disabled={busy || !input.trim()} onClick={saveTags}>{busy ? "保存中" : "保存"}</button></div><div className="modal-body flex flex-col gap-3"><input autoFocus aria-label="标签名称" className="ui-input" placeholder="自定义标签，多个用逗号分隔" value={input} onChange={event => setInput(event.target.value)} /><div className="flex flex-wrap gap-2">{vocabulary.map(tag => <button className="ui-btn text-xs" key={tag} onClick={() => setInput(previous => previous ? `${previous}，${tag}` : tag)}>{tag}</button>)}</div><p role="status" className="menu-desc">{message}</p></div></div></div>}
    </div>;
}

function ImageManager() {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [panel, setPanel] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (panel) return;
        let cancelled = false;
        hydrateKvDb().then(() => {
            const settings = loadImageGenerationSettings();
            const rows: Entry[] = (settings.openaiPresets || []).map(preset => ({ id: `openai:${preset.id}`, name: preset.name || "OpenAI 兼容生图", model: preset.model }));
            if (!rows.length) rows.push({ id: "openai:legacy", name: "OpenAI 兼容生图", model: settings.model });
            rows.push({ id: "novelai", name: "NovelAI 接口", model: `${settings.novelai?.presets.length || 0} 个参数预设` }, { id: "gemini", name: "Gemini 原生生图", model: settings.gemini?.model || "未设置模型" });
            if (!cancelled) setEntries(rows);
        }).catch(() => { if (!cancelled) setError("生图配置读取失败，请使用旧版入口。"); });
        return () => { cancelled = true; };
    }, [panel]);
    if (panel) return <div className="flex flex-col gap-4"><button className="ui-btn self-start" onClick={() => setPanel(false)}><ArrowLeft size={16} />返回接口列表</button><ImageGenerationSettings /></div>;
    return <div className="flex flex-col gap-4"><button className="ui-btn" onClick={() => setPanel(true)}>生图设置与完整方案编辑</button><p className="menu-desc">过渡版沿用完整生图面板；编辑条目后在面板中选择对应引擎及方案。</p>{error && <p role="alert">{error}</p>}<ConfigList kind="imageGeneration" entries={entries} actions={{ add: () => setPanel(true), edit: () => setPanel(true) }} /></div>;
}

export default function ApiManager({ onLegacy }: { onLegacy: (kind: Kind) => void }) {
    const [kind, setKind] = useState<Kind>("api");
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { let cancelled = false; hydrateKvDb().then(() => { if (!cancelled) setReady(true); }).catch(() => { if (!cancelled) setError("配置存储暂时无法读取；请先备份数据，不要清除浏览器数据。"); }); return () => { cancelled = true; }; }, []);
    return <div className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">API 管理</h2><button className="ui-link-btn" onClick={() => onLegacy(kind)}>打开旧版</button></div><nav aria-label="API 类型" className="flex gap-1 rounded-lg p-1" style={{ background: "var(--c-input)" }}>{([['api', '大模型'], ['voice', '语音'], ['imageGeneration', '生图']] as const).map(([id, label]) => <button key={id} aria-pressed={kind === id} className="min-h-10 min-w-0 flex-1 rounded-md px-2 text-sm" style={kind === id ? { background: "var(--c-card, #fff)", fontWeight: 600 } : undefined} onClick={() => setKind(id)}>{label}</button>)}</nav>{error && <p role="alert">{error}</p>}{!ready && !error && <p role="status">正在读取原有配置…</p>}{ready && (kind === "api" ? <ApiSettings renderList={(configs, actions) => <ConfigList kind="api" entries={configs.map(config => ({ id: config.id, name: config.name || config.provider, model: config.defaultModel || config.provider }))} actions={actions} />} /> : kind === "voice" ? <VoiceSettings renderList={(configs, actions) => <ConfigList kind="voice" entries={configs.map(config => ({ id: config.id, name: config.name || config.provider, model: [config.model, config.defaultVoice].filter(Boolean).join(" · ") || config.provider }))} actions={actions} />} /> : <ImageManager />)}</div>;
}
