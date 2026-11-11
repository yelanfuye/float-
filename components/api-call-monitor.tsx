"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, RefreshCw, Search, Trash2 } from "lucide-react";
import { API_LOGS_UPDATED_EVENT, clearApiLogs, getApiLogs, type DebugInfo } from "@/lib/api-log-store";
import { loadApiConfigs } from "@/lib/settings-storage";
import { hydrateKvDb } from "@/lib/kv-db";
import styles from "./api-call-monitor.module.css";

type Result = "success" | "error" | "cancelled" | "unknown";
const LABELS: Record<Result, string> = { success: "成功", error: "失败", cancelled: "已取消", unknown: "未知" };

function resultOf(log: DebugInfo): Result {
    if (log.status === "success" || log.status === "error" || log.status === "cancelled") return log.status;
    // 旧日志只识别明确的失败标记，不以有内容或 HTTP 200 推断成功。
    if (/^\[(API 错误|请求失败)/.test(log.rawResponse)) return "error";
    try {
        const data = JSON.parse(log.rawResponse);
        if (data?.kind === "stream_failure") return data.reason === "cancelled" ? "cancelled" : "error";
    } catch { /* 普通文本 */ }
    return "unknown";
}

function responseText(log: DebugInfo): string {
    try {
        const data = JSON.parse(log.rawResponse);
        // 原生工具日志只展示可见内容/动作名，不展开思考字段或原始协议。
        if (data && typeof data === "object" && !Array.isArray(data) && "toolCalls" in data) {
            const names = Array.isArray(data.toolCalls) ? data.toolCalls.map((call: { name?: string }) => call?.name || "未命名动作").join("、") : "";
            const incomplete = Array.isArray(data.truncatedToolCalls) && data.truncatedToolCalls.length ? "部分动作参数不完整，已丢弃；请查看原功能的提示。" : "";
            return [typeof data.content === "string" ? data.content : "", names ? `动作：${names}` : "", incomplete].filter(Boolean).join("\n") || "该记录没有可见正文。";
        }
    } catch { /* 截断或纯文本，按原文展示 */ }
    return log.rawResponse || "该记录没有可见正文。";
}

function timeText(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function ApiCallMonitor({ onBack }: { onBack?: () => void }) {
    const [logs, setLogs] = useState<DebugInfo[]>([]);
    const [filter, setFilter] = useState<Result | "all">("all");
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [secrets, setSecrets] = useState<string[]>([]);
    const refresh = useCallback(() => {
        setLogs(getApiLogs().slice().reverse());
        setSecrets(loadApiConfigs().map(config => config.apiKey).filter(Boolean));
    }, []);
    useEffect(() => {
        let disposed = false;
        refresh();
        void hydrateKvDb().then(() => { if (!disposed) refresh(); }).catch(() => {});
        window.addEventListener(API_LOGS_UPDATED_EVENT, refresh);
        window.addEventListener("focus", refresh);
        window.addEventListener("settings-bindings-updated", refresh);
        return () => {
            disposed = true;
            window.removeEventListener(API_LOGS_UPDATED_EVENT, refresh);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("settings-bindings-updated", refresh);
        };
    }, [refresh]);
    const redact = useCallback((input: string) => {
        let text = input;
        for (const secret of secrets) text = text.split(secret).join("[已隐藏]");
        return text.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [已隐藏]")
            .replace(/((?:api[_-]?key|x-api-key|authorization|access_token|token)["']?\s*[:=]\s*["']?)[^\s,;&"']+/gi, "$1[已隐藏]");
    }, [secrets]);
    const visible = useMemo(() => logs.filter(log => {
        if (filter !== "all" && resultOf(log) !== filter) return false;
        const term = query.trim().toLocaleLowerCase();
        return !term || [log.characterName, log.model, log.provider, log.rawResponse].some(value => value?.toLocaleLowerCase().includes(term));
    }), [logs, filter, query]);
    const selected = logs.find(log => log.id === selectedId);
    const successCount = logs.filter(log => resultOf(log) === "success").length;
    const errorCount = logs.filter(log => resultOf(log) === "error").length;

    return <div className={styles.monitor}>
        <div className={styles.toolbar}>
            {onBack && <button type="button" onClick={onBack}><ArrowLeft size={15} />返回</button>}
            <button type="button" onClick={refresh}><RefreshCw size={15} />刷新</button>
            <button type="button" className={styles.danger} disabled={!logs.length} onClick={() => {
                if (!window.confirm("清空本机模型调用记录？聊天内容和工坊专用记录不会删除。此操作不可撤销。")) return;
                clearApiLogs(); setSelectedId(null); refresh();
            }}><Trash2 size={15} />清空记录</button>
        </div>
        <p className={styles.note}>本机已记录的模型调用：{logs.length} 条 · 成功 {successCount} · 失败 {errorCount}。旧记录缺少明确结果时标为「未知」，不计入成功。</p>
        <p className={styles.note}>不是服务商后台；不包含所有网络请求。工坊记录仍在工坊内查看。日志按容量滚动保留，正文可能截断；密钥已尽量遮盖，分享报错前请再检查隐私。</p>
        <label className={styles.search}><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型、来源或报错" aria-label="搜索调用记录" /></label>
        <label className={styles.filter}><span>结果筛选</span><select value={filter} onChange={event => setFilter(event.target.value as Result | "all")}><option value="all">全部</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {selected ? <article className={styles.detail}>
            <button type="button" className={styles.back} onClick={() => setSelectedId(null)}><ArrowLeft size={15} />返回记录列表</button>
            <div className={styles.detailHeading}><b>{redact(selected.model || "未记录模型")}</b><span className={styles.badge} data-result={resultOf(selected)}>{LABELS[resultOf(selected)]}</span></div>
            <dl className={styles.meta}>
                <dt>时间</dt><dd>{timeText(selected.timestamp)}</dd>
                <dt>来源</dt><dd>{redact(selected.characterName || (selected.source === "background" ? "后台功能" : "聊天"))}</dd>
                <dt>服务商</dt><dd>{redact(selected.provider || "旧记录未留存")}</dd>
                <dt>HTTP</dt><dd>{selected.httpStatus ?? "未记录"}</dd>
                <dt>耗时</dt><dd>{selected.durationMs === undefined ? "未记录" : `${(selected.durationMs / 1000).toFixed(2)} 秒`}</dd>
                <dt>Token</dt><dd>{selected.usage?.total_tokens ?? "未记录"}</dd>
            </dl>
            <h4>返回内容 / 报错详情</h4>
            <pre className={styles.response}>{redact(responseText(selected))}</pre>
        </article> : <div className={styles.list}>
            {!visible.length && <div className={styles.empty}><Activity size={23} /><span>{logs.length ? "没有符合条件的记录" : "暂无调用记录"}</span><small>发送一次正常聊天或测试连接后，在这里查看已记录的结果。</small></div>}
            {visible.map(log => <button key={log.id} type="button" className={styles.entry} onClick={() => setSelectedId(log.id)}>
                <div className={styles.entryHeading}><b>{redact(log.model || "未记录模型")}</b><span className={styles.badge} data-result={resultOf(log)}>{LABELS[resultOf(log)]}</span></div>
                <span className={styles.source}>{redact(log.characterName || (log.source === "background" ? "后台功能" : "聊天"))} · {timeText(log.timestamp)}</span>
                <span className={styles.preview}>{redact(responseText(log)).slice(0, 120)}</span>
            </button>)}
        </div>}
    </div>;
}
