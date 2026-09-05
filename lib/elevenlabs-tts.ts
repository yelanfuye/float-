/** Browser-first ElevenLabs v3 adapter. No SDK, storage, transcoding or automatic retries. */

export type ElevenLabsOutputFormat = "provider_default" | "mp3_44100_128" | "mp3_44100_192";
export type ElevenLabsErrorCode = "INVALID_REQUEST" | "AUTH" | "ACCESS_BLOCKED" | "UPSTREAM" | "NETWORK" | "TIMEOUT" | "ABORTED" | "INVALID_AUDIO" | "FORMAT_MISMATCH";

export class ElevenLabsError extends Error {
    code: ElevenLabsErrorCode;
    status?: number;
    details?: string;
    constructor(code: ElevenLabsErrorCode, message: string, status?: number, details?: string) {
        super(message);
        this.name = "ElevenLabsError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

type Mp3Info = {
    codec: "mp3";
    sampleRate: number;
    channels: number;
    frameCount: number;
    durationSeconds: number;
    bitrateKbps: number;
    variableBitrate: boolean;
};

export type ElevenLabsTtsRequest = {
    apiKey: string;
    baseUrl?: string;
    voiceId: string;
    text: string;
    modelId?: "eleven_v3";
    outputFormat?: ElevenLabsOutputFormat;
    timeoutMs?: number;
    signal?: AbortSignal;
};

export type ElevenLabsTtsResult = {
    blob: Blob;
    contentType: string;
    byteLength: number;
    modelId: "eleven_v3";
    outputFormat: ElevenLabsOutputFormat;
    audio: Mp3Info;
    warnings: string[];
};

function fail(message: string): never {
    throw new ElevenLabsError("INVALID_AUDIO", message);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function inspectMp3(bytes: Uint8Array): Mp3Info {
    let p = 0;
    if (ascii(bytes, 0, 3) === "ID3") {
        if (bytes.length < 10 || [6, 7, 8, 9].some(i => bytes[i] > 127)) fail("MP3 的 ID3 文件头损坏");
        const tagSize = bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
        p = 10 + tagSize + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0);
        if (p > bytes.length) fail("MP3 的 ID3 数据不完整");
    }
    let frameCount = 0;
    let durationSeconds = 0;
    let audioBytes = 0;
    let sampleRate = 0;
    let channels = 0;
    let firstBitrate = 0;
    let variableBitrate = false;
    while (p < bytes.length) {
        if (bytes.length - p === 128 && ascii(bytes, p, 3) === "TAG") break;
        if (bytes.length - p < 4) fail("MP3 末尾有不完整帧");
        const a = bytes[p], b = bytes[p + 1], c = bytes[p + 2], d = bytes[p + 3];
        const version = (b >> 3) & 3;
        const layer = (b >> 1) & 3;
        const bitrateIndex = c >> 4;
        const rateIndex = (c >> 2) & 3;
        if (a !== 255 || (b & 224) !== 224 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
            fail("返回内容不是完整的标准 MP3；可能是错误页、其他格式或被截断的音频");
        }
        const baseRate = [44100, 48000, 32000][rateIndex];
        const rate = baseRate / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const kbps = (version === 3
            ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
            : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
        const frameSize = Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + ((c >> 1) & 1);
        const channelCount = (d >> 6) === 3 ? 1 : 2;
        if (p + frameSize > bytes.length) fail("MP3 音频下载不完整，末帧被截断");
        if (frameCount && (sampleRate !== rate || channels !== channelCount)) fail("MP3 内的采样率或声道数发生变化");
        if (frameCount && firstBitrate !== kbps) variableBitrate = true;
        if (!frameCount) firstBitrate = kbps;
        sampleRate = rate;
        channels = channelCount;
        durationSeconds += (version === 3 ? 1152 : 576) / rate;
        audioBytes += frameSize;
        frameCount++;
        p += frameSize;
    }
    if (!frameCount) fail("接口未返回 MP3 音频帧");
    return {
        codec: "mp3", sampleRate, channels, frameCount, durationSeconds,
        bitrateKbps: variableBitrate ? Math.round(audioBytes * 8 / durationSeconds / 1000) : firstBitrate,
        variableBitrate,
    };
}

function redact(text: string, key: string): string {
    for (const secret of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]) {
        if (secret) text = text.split(secret).join("[REDACTED]");
    }
    return text.replace(/((?:xi-api-key|api[_-]?key|authorization)["'\s:=]+)[^\s,<>"]+/gi, "$1[REDACTED]").slice(0, 1500);
}

function buildRequest(request: ElevenLabsTtsRequest): { url: string; key: string; body: string; format: ElevenLabsOutputFormat; timeout: number } {
    const invalid = (message: string): never => { throw new ElevenLabsError("INVALID_REQUEST", message); };
    const key = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
    if (!key || /[\r\n]/.test(key)) invalid("请填写有效的 ElevenLabs API Key");
    if (typeof request.text !== "string" || !request.text.trim()) invalid("朗读文本不能为空");
    if ([...request.text].length > 5000) invalid("v3 单次文本不能超过 5000 字符");
    const voiceId = request.voiceId?.trim();
    if (!voiceId || voiceId === "." || voiceId === "..") invalid("请填写 Voice ID");
    if (request.modelId !== undefined && request.modelId !== "eleven_v3") invalid("此适配器只支持 eleven_v3");
    const format = request.outputFormat ?? "provider_default";
    if (!["provider_default", "mp3_44100_128", "mp3_44100_192"].includes(format)) invalid("输出格式不受支持");
    const timeout = request.timeoutMs ?? 120000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600000) invalid("超时应在 1 至 600000 毫秒之间");
    let url: URL;
    try { url = new URL(request.baseUrl?.trim() || "https://api.elevenlabs.io/v1"); }
    catch { return invalid("接口地址必须是完整的 HTTPS URL"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) invalid("接口地址须使用 HTTPS，且不能包含账号、查询参数或片段");
    if (url.href.includes(key) || url.href.includes(encodeURIComponent(key))) invalid("请勿在接口地址里填写 API Key");
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (url.origin === "https://api.elevenlabs.io" && (!url.pathname || url.pathname === "/")) url.pathname = "/v1";
    const base = url.toString().replace(/\/+$/, "");
    const endpoint = new URL(`${base}/text-to-speech/${encodeURIComponent(voiceId)}`);
    if (format !== "provider_default") endpoint.searchParams.set("output_format", format);
    return { url: endpoint.toString(), key, body: JSON.stringify({ text: request.text, model_id: "eleven_v3" }), format, timeout };
}

async function readBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    const limit = response.ok ? 32 * 1024 * 1024 : 16384;
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;
            if (size + value.length > limit) {
                if (response.ok) throw new ElevenLabsError("INVALID_AUDIO", "返回文件超过 32MB 限制");
                chunks.push(value.subarray(0, limit - size)); size = limit; break;
            }
            chunks.push(value); size += value.length;
        }
    } finally {
        signal.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function synthesizeElevenLabs(request: ElevenLabsTtsRequest): Promise<ElevenLabsTtsResult> {
    const { url, key, body, format, timeout } = buildRequest(request);
    if (request.signal?.aborted) throw new ElevenLabsError("ABORTED", "已取消语音生成");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
        });
        const bytes = await readBytes(response, controller.signal);
        const contentType = response.headers.get("content-type") || "";
        const prefix = new TextDecoder().decode(bytes.subarray(0, 4096));
        if (/text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(prefix)) {
            throw new ElevenLabsError("ACCESS_BLOCKED", "接口返回网页：可能被站点登录保护或网关拦截", response.status);
        }
        if (!response.ok) {
            const details = redact(new TextDecoder().decode(bytes), key);
            throw new ElevenLabsError(response.status === 401 ? "AUTH" : "UPSTREAM", `ElevenLabs 接口请求失败（HTTP ${response.status}）${details ? `：${details}` : ""}`, response.status, details);
        }
        if (/json|^text\//i.test(contentType) || /^\s*[\[{]/.test(prefix)) throw new ElevenLabsError("INVALID_AUDIO", "接口返回文本或 JSON，没有返回音频", response.status, redact(new TextDecoder().decode(bytes), key));
        if (!bytes.length) throw new ElevenLabsError("INVALID_AUDIO", "接口返回了空音频");
        const audio = inspectMp3(bytes);
        const warnings: string[] = [];
        if (format !== "provider_default") {
            const wanted = format === "mp3_44100_192" ? 192 : 128;
            if (audio.sampleRate !== 44100 || (!audio.variableBitrate && audio.bitrateKbps !== wanted)) throw new ElevenLabsError("FORMAT_MISMATCH", `请求 ${format}，实际收到 ${audio.sampleRate}Hz / ${audio.bitrateKbps}kbps MP3；上游可能忽略了输出格式。`);
            if (audio.variableBitrate) warnings.push("收到可变码率 MP3，平均码率不能证明上游严格采用了固定码率。");
        }
        if (audio.sampleRate < 44100 || audio.bitrateKbps < 128) warnings.push("实际采样率或码率较低，请与清晰样本的原文件对照。");
        if (!/^audio\/(mpeg|mp3)(?:;|$)/i.test(contentType)) warnings.push("响应 Content-Type 不是 MP3；已按实际 MP3 帧识别，未改变音频字节。");
        return { blob: new Blob([bytes], { type: "audio/mpeg" }), contentType, byteLength: bytes.length, modelId: "eleven_v3", outputFormat: format, audio, warnings };
    } catch (error: unknown) {
        if (error instanceof ElevenLabsError) throw error;
        if (controller.signal.aborted) throw new ElevenLabsError(timedOut ? "TIMEOUT" : "ABORTED", timedOut ? "语音请求或下载超时；未自动重试" : "已取消语音生成");
        throw new ElevenLabsError("NETWORK", "无法读取接口响应：请检查网络、HTTPS、CORS 或重定向；未自动重试。");
    } finally {
        window.clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
    }
}
