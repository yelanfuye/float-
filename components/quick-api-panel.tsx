"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, RefreshCw, PlugZap } from "lucide-react";
import { CONTENT_APP_LABELS, type ContentAppId, type ApiConfig } from "@/lib/settings-types";
import { loadBindingConfig } from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";

function listApiBindings(id: string): string[] {
    const config = loadBindingConfig();
    const characters = loadCharacters();
    const items: string[] = [];
    const appName = (app: string) => CONTENT_APP_LABELS[app as ContentAppId] || app;
    if (config.globalDefaults.apiConfigId === id) items.push("全局默认（未单独指定的项目继承）");
    for (const [app, slot] of Object.entries(config.appDefaults || {})) {
        if (slot?.apiConfigId === id) items.push(`全局 · ${appName(app)}`);
    }
    for (const binding of config.characterBindings) {
        const name = characters.find(c => c.id === binding.characterId)?.name || "已删除角色";
        if (binding.defaults.apiConfigId === id) items.push(`${name} · 角色默认`);
        for (const [app, slot] of Object.entries(binding.appOverrides || {})) {
            if (slot?.apiConfigId === id) items.push(`${name} · ${appName(app)}`);
        }
    }
    const auxiliary = [
        [config.memorySummaryApiConfigId, "记忆总结"], [config.embeddingApiConfigId, "向量召回"],
        [config.mascotApiConfigId, "小卷"], [config.qaApiConfigId, "工坊"],
        [config.reasoningTranslateApiConfigId, "思考翻译"],
    ];
    for (const [apiId, label] of auxiliary) if (apiId === id && label) items.push(label);
    return items;
}
import { buildRequestHeaders, determineBaseUrl, isNativeAnthropicApi, simpleLLMCall } from "@/lib/api-helpers";
import styles from "./quick-action-paw.module.css";

type Props = {
    config: ApiConfig;
    scopeLabel: string;
    onBack: () => void;
    onConfirm: (model: string) => string | void;
};

export function QuickApiPanel({ config, scopeLabel, onBack, onConfirm }: Props) {
    const [bindings, setBindings] = useState(() => listApiBindings(config.id));
    useEffect(() => {
        const sync = () => setBindings(listApiBindings(config.id));
        window.addEventListener("settings-bindings-updated", sync);
        window.addEventListener("focus", sync);
        return () => {
            window.removeEventListener("settings-bindings-updated", sync);
            window.removeEventListener("focus", sync);
        };
    }, [config.id]);
    const [model, setModel] = useState(config.defaultModel || "");
    const [models, setModels] = useState<string[]>([]);
    const [busy, setBusy] = useState<"models" | "test" | null>(null);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
    const requestRef = useRef<AbortController | null>(null);
    useEffect(() => () => {
        requestRef.current?.abort();
        requestRef.current = null;
    }, []);

    async function run(kind: "models" | "test") {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setBusy(kind);
        setResult(null);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
        try {
            if (!config.apiKey.trim()) throw new Error("请先在设置中填写 API Key");
            const base = determineBaseUrl(config).trim().replace(/\/+$/, "");
            if (!base) throw new Error("请先在设置中填写 API 地址");
            if (kind === "test") {
                if (!model.trim()) throw new Error("请先选择或填写模型");
                const response = await simpleLLMCall(
                    { ...config, defaultModel: model.trim() },
                    [{ role: "user", content: "请简短回复：连接成功。" }],
                    { max_tokens: 4096, signal: controller.signal, label: "悬浮窗连接测试" },
                );
                if (controller.signal.aborted) throw new Error("请求已取消");
                if (response.error || !response.content) throw new Error(response.error || "模型未返回内容");
                setResult({ ok: true, text: `连接成功 · ${model.trim()}：${response.content.replace(/\s+/g, " ").slice(0, 160)}` });
            } else {
                const root = base.replace(/\/(chat\/completions|completions|embeddings|messages)$/i, "");
                const endpoint = /\/models$/i.test(root) ? root : `${root}/models`;
                const headers = buildRequestHeaders(config, base);
                if (config.provider === "Google") {
                    delete headers.Authorization;
                    headers["x-goog-api-key"] = config.apiKey;
                }
                if (isNativeAnthropicApi(config)) headers["anthropic-dangerous-direct-browser-access"] = "true";
                const collected = new Set<string>();
                const visited = new Set<string>();
                let cursor = "";
                do {
                    const url = new URL(endpoint);
                    if (cursor) url.searchParams.set(config.provider === "Google" ? "pageToken" : "after_id", cursor);
                    const response = await fetch(url, { headers, signal: controller.signal });
                    if (!response.ok) throw new Error(`拉取失败（HTTP ${response.status}），请检查地址、密钥及模型列表权限`);
                    const data = await response.json();
                    const rows: unknown = config.provider === "Google" ? data?.models : data?.data;
                    if (!Array.isArray(rows)) throw new Error("接口返回的模型列表格式不正确");
                    for (const row of rows) {
                        if (!row || typeof row !== "object") continue;
                        if (config.provider === "Google" && Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes("generateContent")) continue;
                        const id = config.provider === "Google" ? row.name : row.id;
                        if (typeof id === "string" && id.trim()) collected.add(config.provider === "Google" ? id.replace(/^models\//, "") : id);
                    }
                    const next = config.provider === "Google" ? data.nextPageToken : (isNativeAnthropicApi(config) && data.has_more ? data.last_id : "");
                    if (isNativeAnthropicApi(config) && data.has_more && !next) throw new Error("模型列表分页缺少游标，请稍后重试");
                    if (next && (typeof next !== "string" || visited.has(next) || visited.size >= 100)) throw new Error("模型列表分页异常，请稍后重试");
                    cursor = typeof next === "string" ? next : "";
                    if (cursor) visited.add(cursor);
                } while (cursor);
                if (controller.signal.aborted) throw new Error("请求已取消");
                const nextModels = [...collected].sort((a, b) => a.localeCompare(b));
                setModels(nextModels);
                setResult({ ok: nextModels.length > 0, text: nextModels.length ? `已获取 ${nextModels.length} 个模型，请选择后确认` : "接口没有返回可用模型，也可以手动填写模型 ID" });
            }
        } catch (error) {
            if (requestRef.current === controller && (!controller.signal.aborted || timedOut)) {
                setResult({ ok: false, text: timedOut ? "请求超时，请稍后重试" : error instanceof Error ? error.message : "请求失败，请重试" });
            }
        } finally {
            clearTimeout(timer);
            if (requestRef.current === controller) {
                requestRef.current = null;
                setBusy(null);
            }
        }
    }

    return (
        <div className={styles.detail}>
            <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16} />返回预设列表</button>
            <div className={styles.summary}>
                <small>{scopeLabel}</small>
                <h4>{config.name || config.provider}</h4>
                <span>{config.provider}</span>
                <p className={styles.note}>已绑定项目 · {bindings.length} 项直接绑定</p>
                {bindings.length ? <ul className={styles.bindings}>{bindings.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className={styles.note}>暂无直接绑定，确认后应用到当前范围。</p>}
            </div>
            <label className={styles.field}>
                <span>模型</span>
                <input value={model} disabled={!!busy} placeholder="选择或填写模型 ID" onChange={event => { setModel(event.target.value); setResult(null); }} autoComplete="off" spellCheck={false} />
            </label>
            {models.length > 0 && <label className={styles.field}>
                <span>已拉取的模型</span>
                <select value={models.includes(model) ? model : ""} disabled={!!busy} onChange={event => { if (event.target.value) { setModel(event.target.value); setResult(null); } }}>
                    <option value="" disabled>请选择模型</option>
                    {models.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
            </label>}
            <div className={styles.actions}>
                <button type="button" disabled={!!busy} onClick={() => void run("models")}><RefreshCw size={15} />{busy === "models" ? "拉取中…" : "拉取模型"}</button>
                <button type="button" disabled={!!busy || !model.trim()} onClick={() => void run("test")}><PlugZap size={15} />{busy === "test" ? "测试中…" : "测试连接"}</button>
            </div>
            <p className={styles.note}>确认后更新这份 API 预设的模型，并应用到{scopeLabel}。其他使用同一份预设的角色也会使用新模型。测试会发送一条简短请求，可能产生少量费用。</p>
            {result && <p role="status" aria-live="polite" className={styles.result} data-ok={result.ok}>{result.text}</p>}
            <button type="button" className={styles.confirm} disabled={!!busy || !model.trim()} onClick={() => {
                const error = onConfirm(model.trim());
                if (error) setResult({ ok: false, text: error });
            }}><Check size={16} />确认并应用</button>
        </div>
    );
}
