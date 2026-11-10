// Stream failures are diagnostic records, never successful model turns.
// Recovery drafts are isolated from chat history, memory and action execution.
import { kvEntries, kvRemove, kvSetAsync } from "./kv-db";
import { pushApiLog } from "./api-log-store";

export const STREAM_RECOVERY_EVENT = "chat-stream-recovery-updated";
const PREFIX = "ai_phone_stream_recovery_v1:";
export type StreamRecoveryDraft = {
    id: string;
    sessionId: string;
    offline: boolean;
    createdAt: string;
    text: string;
    /** 对应本次线下请求的用户输入；缺省表示旧草稿未留存，空字符串表示本轮确实无输入。 */
    userContent?: string;
    diagnostic: string;
    persisted: boolean;
};
const volatileDrafts = new Map<string, StreamRecoveryDraft>();

export function loadStreamRecoveryDrafts(sessionId: string): StreamRecoveryDraft[] {
    const drafts = new Map<string, StreamRecoveryDraft>();
    for (const { key, value } of kvEntries()) {
        if (!key.startsWith(PREFIX)) continue;
        try {
            const draft = JSON.parse(value) as StreamRecoveryDraft;
            if (draft.sessionId === sessionId && typeof draft.text === "string") drafts.set(draft.id, draft);
        } catch { /* ignore damaged entries */ }
    }
    for (const draft of volatileDrafts.values()) {
        if (draft.sessionId === sessionId) drafts.set(draft.id, draft);
    }
    return [...drafts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function removeStreamRecoveryDraft(id: string): void {
    kvRemove(PREFIX + id);
    volatileDrafts.delete(id);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(STREAM_RECOVERY_EVENT));
}

export function redactStreamError(error: unknown, secret = ""): string {
    let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (secret) text = text.split(secret).join("[REDACTED]");
    return text.replace(/https?:\/\/[^\s<>"']+/gi, "[URL omitted]")
        .replace(/(authorization|x-api-key|xi-api-key|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 2000);
}

export function createStreamTrace(meta: {
    sessionId?: string; offline?: boolean; appId?: string;
    model: string; provider: string; apiKey: string; characterName?: string;
    /** 仅供本地线下草稿恢复，不写入诊断日志。 */
    userContent?: string;
}) {
    const startedAt = Date.now();
    const id = `${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
    let stage = "request";
    let status: number | undefined;
    let contentType = "";
    let bytes = 0;
    let chunks = 0;
    let events = 0;
    let lastByteAt: number | undefined;
    let firstByteAt: number | undefined;
    let text = "";
    let reasoningChars = 0;
    let reported = false;
    return {
        stage(value: string) { stage = value; },
        response(response: Response) {
            status = response.status;
            contentType = (response.headers.get("content-type") || "").slice(0, 160);
        },
        chunk(value: Uint8Array) {
            bytes += value.byteLength;
            chunks++;
            lastByteAt = Date.now();
            firstByteAt ??= lastByteAt;
        },
        parsed(content: string, reasoning = "") {
            events++;
            text += content;
            reasoningChars += reasoning.length;
        },
        async fail(error: unknown, reason: "cancelled" | "timeout" | "error" = "error") {
            if (reported) return;
            reported = true;
            const now = Date.now();
            const diagnostic = JSON.stringify({
                kind: "stream_failure", requestId: id, sessionId: meta.sessionId,
                mode: meta.offline ? "offline" : "online", appId: meta.appId,
                provider: meta.provider, model: meta.model, reason, stage,
                startedAt: new Date(startedAt).toISOString(), elapsedMs: now - startedAt,
                status, contentType, receivedBytes: bytes, chunks, parsedEvents: events,
                receivedTextChars: text.length, reasoningChars,
                firstByteMs: firstByteAt === undefined ? null : firstByteAt - startedAt,
                lastByteAt: lastByteAt === undefined ? null : new Date(lastByteAt).toISOString(),
                idleMs: lastByteAt === undefined ? null : now - lastByteAt,
                error: redactStreamError(error, meta.apiKey),
            }, null, 2);
            // No headers, URL, prompt, raw SSE or tool arguments are written to diagnostics.
            pushApiLog({
                characterName: meta.characterName, model: meta.model,
                source: meta.appId === "qa" ? "qa" : "chat",
                channel: meta.appId === "qa" ? "qa" : "chat",
                messages: [], rawResponse: diagnostic,
            });
            if (!meta.sessionId || !text.trim()) return;
            const draft: StreamRecoveryDraft = {
                id, sessionId: meta.sessionId, offline: meta.offline === true,
                createdAt: new Date(now).toISOString(), text, diagnostic, persisted: false,
                // 原始输入只随本地线下草稿保存；线上请求不额外留存，诊断仍不含输入。
                ...(meta.offline === true && typeof meta.userContent === "string"
                    ? { userContent: meta.userContent } : {}),
            };
            volatileDrafts.set(id, draft);
            try {
                await kvSetAsync(PREFIX + id, JSON.stringify({ ...draft, persisted: true }));
                volatileDrafts.delete(id);
            } catch {
                // Keep an in-memory copy and explicitly tell the user to copy it now.
            }
            if (typeof window !== "undefined") window.dispatchEvent(new Event(STREAM_RECOVERY_EVENT));
        },
    };
}
export type StreamTrace = ReturnType<typeof createStreamTrace>;
