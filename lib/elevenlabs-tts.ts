/** Browser-first ElevenLabs v3 adapter. Keeps response bytes unchanged. */
export type ElevenLabsOutputFormat = "provider_default" | "mp3_44100_128" | "mp3_44100_192";
export type ElevenLabsErrorCode = "INVALID_REQUEST" | "AUTH" | "ACCESS_BLOCKED" | "UPSTREAM" | "NETWORK" | "TIMEOUT" | "ABORTED" | "INVALID_AUDIO" | "FORMAT_MISMATCH";
export class ElevenLabsError extends Error {
    code: ElevenLabsErrorCode;
    status?: number;
    details?: string;
    constructor(code: ElevenLabsErrorCode, message: string, status?: number, details?: string) {
        super(message); this.name = "ElevenLabsError"; this.code = code; this.status = status; this.details = details;
    }
}
export type ElevenLabsTtsRequest = {
    apiKey: string; baseUrl?: string; voiceId: string; text: string;
    modelId?: "eleven_v3"; outputFormat?: ElevenLabsOutputFormat;
    timeoutMs?: number; signal?: AbortSignal;
};
export type ElevenLabsTtsResult = {
    blob: Blob; contentType: string; byteLength: number; modelId: "eleven_v3";
    outputFormat: ElevenLabsOutputFormat; warnings: string[];
};
function invalid(message: string): never { throw new ElevenLabsError("INVALID_REQUEST", message); }
function redact(text: string, key: string): string {
    return text.split(key).join("[REDACTED]").replace(/((?:xi-api-key|api[_-]?key|authorization)["'\s:=]+)[^\s,<>"]+/gi, "$1[REDACTED]").slice(0, 1500);
}
function buildRequest(r: ElevenLabsTtsRequest) {
    const key = typeof r.apiKey === "string" ? r.apiKey.trim() : "";
    if (!key || /[\r\n]/.test(key)) invalid("请填写有效的 ElevenLabs API Key");
    if (typeof r.text !== "string" || !r.text.trim()) invalid("朗读文本不能为空");
    if ([...r.text].length > 5000) invalid("v3 单次文本不能超过 5000 字符");
    const voice = r.voiceId?.trim();
    if (!voice || voice === "." || voice === "..") invalid("请填写 Voice ID");
    if (r.modelId !== undefined && r.modelId !== "eleven_v3") invalid("此适配器只支持 eleven_v3");
    const format = r.outputFormat ?? "provider_default";
    if (!["provider_default", "mp3_44100_128", "mp3_44100_192"].includes(format)) invalid("输出格式不受支持");
    const timeout = r.timeoutMs ?? 120000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600000) invalid("超时应在 1 至 600000 毫秒之间");
    let base: URL;
    try { base = new URL(r.baseUrl?.trim() || "https://api.elevenlabs.io/v1"); } catch { return invalid("接口地址必须是完整的 HTTPS URL"); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) invalid("接口地址须使用 HTTPS，且不能包含账号、查询参数或片段");
    base.pathname = base.pathname.replace(/\/+$/, "");
    if (base.origin === "https://api.elevenlabs.io" && (!base.pathname || base.pathname === "/")) base.pathname = "/v1";
    const endpoint = new URL(`${base.toString().replace(/\/+$/, "")}/text-to-speech/${encodeURIComponent(voice)}`);
    if (format !== "provider_default") endpoint.searchParams.set("output_format", format);
    return { key, timeout, format, url: endpoint.toString(), body: JSON.stringify({ text: r.text, model_id: "eleven_v3" as const }) };
}
async function readResponseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break; if (!value) continue;
            if (size + value.length > 32 * 1024 * 1024) throw new ElevenLabsError("INVALID_AUDIO", "返回文件超过 32MB 限制");
            chunks.push(value); size += value.length;
        }
    } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}
export async function synthesizeElevenLabs(r: ElevenLabsTtsRequest): Promise<ElevenLabsTtsResult> {
    const { key, timeout, format, url, body } = buildRequest(r);
    if (r.signal?.aborted) throw new ElevenLabsError("ABORTED", "已取消语音生成");
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort(); r.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
        const response = await fetch(url, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" }, body, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
        const bytes = await readResponseBytes(response, controller.signal);
        const contentType = response.headers.get("content-type") || "";
        const prefix = new TextDecoder().decode(bytes.subarray(0, 4096));
        if (/text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(prefix)) throw new ElevenLabsError("ACCESS_BLOCKED", "接口返回网页，可能被登录保护或网关拦截", response.status);
        if (!response.ok) { const details = redact(new TextDecoder().decode(bytes), key); throw new ElevenLabsError(response.status === 401 ? "AUTH" : "UPSTREAM", `ElevenLabs 请求失败（HTTP ${response.status}）${details ? `：${details}` : ""}`, response.status, details); }
        if (!bytes.length || /json|^text\//i.test(contentType) || /^\s*[\[{]/.test(prefix)) throw new ElevenLabsError("INVALID_AUDIO", "接口没有返回可播放音频", response.status, redact(prefix, key));
        if (bytes[0] !== 0xff && ascii(bytes, 0, 3) !== "ID3") throw new ElevenLabsError("INVALID_AUDIO", "接口返回内容不是 MP3");
        const warnings: string[] = [];
        if (format !== "provider_default") warnings.push(`已请求 ${format}；当前仅验证返回为 MP3，未对 MP3 帧码率做强制判定。`);
        return { blob: new Blob([bytes], { type: "audio/mpeg" }), contentType, byteLength: bytes.length, modelId: "eleven_v3", outputFormat: format, warnings };
    } catch (error: unknown) {
        if (error instanceof ElevenLabsError) throw error;
        if (controller.signal.aborted) throw new ElevenLabsError(timedOut ? "TIMEOUT" : "ABORTED", timedOut ? "语音请求或下载超时；未自动重试" : "已取消语音生成");
        throw new ElevenLabsError("NETWORK", "无法读取接口响应：请检查网络、HTTPS、CORS 或重定向；未自动重试。");
    } finally { window.clearTimeout(timer); r.signal?.removeEventListener("abort", abort); }
}
function ascii(bytes: Uint8Array, start: number, length: number): string { return String.fromCharCode(...bytes.subarray(start, start + length)); }
