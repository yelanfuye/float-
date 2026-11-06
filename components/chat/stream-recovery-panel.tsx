"use client";

import { useEffect, useState } from "react";
import { OfflineDraftRestore } from "./offline-draft-restore";
import { STREAM_RECOVERY_EVENT, loadStreamRecoveryDrafts, removeStreamRecoveryDraft, type StreamRecoveryDraft } from "@/lib/stream-recovery";

function CopyButton({ text, label }: { text: string; label: string }) {
    const [notice, setNotice] = useState("");
    return <button type="button" className="ui-btn ui-btn-outline" onClick={async () => {
        try {
            await navigator.clipboard.writeText(text);
            setNotice("已复制");
        } catch { setNotice("复制失败，请长按文本复制"); }
    }}>{notice || label}</button>;
}

/** 常驻、非模态浮框：无遮罩，不自动计时关闭，不因点击背景而消失。 */
export function GenerationErrorPanel({ message, onClose }: { message: string; onClose: () => void }) {
    return <section role="alert" aria-label="线下生成错误" style={{
        position: "absolute", left: 16, right: 16, bottom: "calc(100px + env(safe-area-inset-bottom, 0px))",
        zIndex: 180, maxHeight: "55%", overflowY: "auto", padding: 18, borderRadius: 18,
        background: "var(--c-page-body-bg, #fff)", color: "var(--c-text, #292929)",
        border: "1px solid #dfb6ac", boxShadow: "0 12px 40px #0003", userSelect: "text",
    }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <strong style={{ flex: 1, color: "#a04432" }}>⚠ 线下生成提示</strong>
            <button type="button" aria-label="关闭报错悬浮框" onClick={onClose} style={{ width: 44, height: 44, border: 0, background: "transparent", color: "inherit", fontSize: 24 }}>×</button>
        </div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, lineHeight: 1.7, margin: "8px 0 16px" }}>{message}</div>
        <CopyButton text={message} label="复制错误信息" />
        <p style={{ fontSize: 12, opacity: .65, marginBottom: 0 }}>此提示不会自动消失，点右上角 × 关闭。流式中断草稿可在聊天底部查看。</p>
    </section>;
}

export function StreamRecoveryPanel({ sessionId, offline, busy = false, summaryTag, thinkingTags, onRestored }: {
    sessionId: string; offline: boolean; busy?: boolean;
    summaryTag?: string; thinkingTags?: string[]; onRestored?: () => void;
}) {
    const [drafts, setDrafts] = useState<StreamRecoveryDraft[]>([]);
    useEffect(() => {
        const refresh = () => setDrafts(loadStreamRecoveryDrafts(sessionId));
        refresh();
        window.addEventListener(STREAM_RECOVERY_EVENT, refresh);
        return () => window.removeEventListener(STREAM_RECOVERY_EVENT, refresh);
    }, [sessionId]);
    const visible = drafts.filter(draft => draft.offline === offline);
    if (!visible.length) return null;
    return <section aria-label="未完成草稿" style={{ padding: 14, border: "1px solid #dfb6ac", borderRadius: 14, margin: "12px 0", color: "var(--c-text)", userSelect: "text" }}>
        <strong>未完成草稿 · {visible.length}</strong>
        <p style={{ fontSize: 12, opacity: .7 }}>草稿本身不进入角色记忆，不执行动作。线下草稿可经你核对后恢复为正式记录；删除前请先复制需要的内容。</p>
        {visible.map(draft => <details key={draft.id} style={{ marginTop: 12 }}>
            <summary>{new Date(draft.createdAt).toLocaleString()} · {draft.text.length} 字符{draft.persisted ? " · 已保存" : " · 未写入磁盘，请立即复制"}</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 260, overflowY: "auto", fontFamily: "inherit", fontSize: 13 }}>{draft.text}</pre>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <CopyButton text={draft.text} label="复制草稿原文" />
                <CopyButton text={draft.diagnostic} label="复制诊断" />
                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => {
                    if (window.confirm("仅删除这份未完成草稿？此操作不能撤销。")) removeStreamRecoveryDraft(draft.id);
                }}>删除草稿</button>
            </div>
            {offline && onRestored && <OfflineDraftRestore draft={draft} busy={busy} summaryTag={summaryTag} thinkingTags={thinkingTags} onRestored={onRestored} />}
            <details style={{ marginTop: 8 }}><summary>诊断详情</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{draft.diagnostic}</pre></details>
        </details>)}
    </section>;
}
