"use client";

import { useRef, useState } from "react";
import { loadChatOfflineTurns, parseOfflineResponse, restoreOfflineDraft } from "@/lib/chat-offline-storage";
import { stripXmlTagBlocks } from "@/lib/stream-preview";
import type { StreamRecoveryDraft } from "@/lib/stream-recovery";

/** 仅对用户明确选中的草稿恢复；不是自动完成检测，也不调用 LLM。 */
export function OfflineDraftRestore({ draft, busy, summaryTag = "summary", thinkingTags = [], onRestored }: {
    draft: StreamRecoveryDraft;
    busy: boolean;
    summaryTag?: string;
    thinkingTags?: string[];
    onRestored: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [body, setBody] = useState("");
    const [summary, setSummary] = useState("");
    const [tag, setTag] = useState(summaryTag);
    // 仅使用该草稿关联的原始输入；不从当前输入框或最近一条历史猜测，避免恢复错轮。
    // 正文/摘要重新提取时不重置此状态，保留用户在恢复表单中的修改。
    const [userText, setUserText] = useState(() => typeof draft.userContent === "string" ? draft.userContent : "");
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [notice, setNotice] = useState("");
    const [saved, setSaved] = useState(false);
    const [writeFailed, setWriteFailed] = useState(false);
    const imported = saved || (!writeFailed && loadChatOfflineTurns(draft.sessionId).some(turn => turn.recoveredFromDraftId === draft.id));
    const prepare = () => {
        const parsed = parseOfflineResponse(draft.text, tag);
        const contentMatch = draft.text.match(/<content>([\s\S]*?)<\/content>/i);
        // 不把全文兜底当作已完整正文；无闭合 content 时请用户手动提取。
        setBody(contentMatch ? stripXmlTagBlocks(contentMatch[1], [...thinkingTags, "thinking", "thought", "think"]).trim() : "");
        setSummary(parsed.summary);
        setNotice(contentMatch ? "已提取正文，请核对是否完整。标签闭合不代表模型已正常结束。" : "未找到闭合的 <content> 正文，请从草稿原文手动复制所需正文到下方。");
        setConfirmed(false);
        setOpen(true);
    };
    return <div style={{ marginTop: 12 }}>
        <button type="button" className="ui-btn ui-btn-outline" disabled={busy || saving || imported} onClick={prepare}>
            {imported ? "已恢复到线下记录" : "恢复到线下记录"}
        </button>
        {open && <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--c-border, #ccc)", borderRadius: 12 }}>
            <strong>确认恢复内容</strong>
            <p style={{ fontSize: 12 }}>保存后追加到当前线下记录末尾，并参与后续对话上下文；摘要会按现有规则进入短期记忆。不会重新请求模型，不执行草稿中的动作。原草稿仍保留。</p>
            <label style={{ display: "block" }}>摘要标签名
                <input className="ui-input" value={tag} disabled={saving} onChange={e => setTag(e.target.value)} />
            </label>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={saving} onClick={prepare}>按此标签重新提取（覆盖下方正文和摘要）</button>
            <label style={{ display: "block" }}>本轮用户输入（可编辑）
                <textarea className="ui-textarea" style={{ width: "100%", minHeight: 70 }} value={userText} disabled={saving} onChange={e => { setUserText(e.target.value); setConfirmed(false); }} />
            </label>
            <p style={{ fontSize: 12, opacity: .7 }}>
                {typeof draft.userContent === "string"
                    ? (draft.userContent ? "已自动带入这份草稿对应的原始输入，请核对；也可直接修改。" : "已记录本轮没有用户输入，可保持留空。")
                    : "这份旧草稿未留存对应输入，请补填；若本轮确实没有输入，可留空。"}
            </p>
            <label style={{ display: "block" }}>正文
                <textarea className="ui-textarea" style={{ width: "100%", minHeight: 180 }} value={body} disabled={saving} onChange={e => { setBody(e.target.value); setConfirmed(false); }} />
            </label>
            <label style={{ display: "block" }}>摘要（可留空，不自动补提）
                <textarea className="ui-textarea" style={{ width: "100%", minHeight: 70 }} value={summary} disabled={saving} onChange={e => { setSummary(e.target.value); setConfirmed(false); }} />
            </label>
            <label style={{ display: "flex", gap: 8, margin: "12px 0" }}>
                <input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />
                我已核对正文、摘要和对应输入，同意将其作为手动恢复记录加入后续上下文。
            </label>
            {notice && <p role="status" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{notice}</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="ui-btn ui-btn-primary" disabled={busy || saving || imported || !confirmed || !body.trim()} onClick={async () => {
                    if (savingRef.current || busy || !confirmed || !body.trim()) return;
                    savingRef.current = true;
                    setSaving(true);
                    try {
                        await restoreOfflineDraft({ sessionId: draft.sessionId, draftId: draft.id, userContent: userText,
                            assistantContent: body, summary, summaryTag: tag, rawText: draft.text });
                        setSaved(true);
                        setOpen(false);
                        onRestored();
                    } catch (error) {
                        setWriteFailed(true);
                        setNotice(`恢复未完成：${error instanceof Error ? error.message : String(error)}。原草稿未删除，可复制备份后重试。`);
                    } finally { savingRef.current = false; setSaving(false); }
                }}>{saving ? "保存中…" : "确认保存到线下"}</button>
                <button type="button" className="ui-btn ui-btn-ghost" disabled={saving} onClick={() => setOpen(false)}>取消</button>
            </div>
        </div>}
    </div>;
}
