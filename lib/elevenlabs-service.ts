import type { VoiceApiConfig } from "./settings-types";

export type ElevenModel = { id: string; name: string; limit?: number };
export type ElevenVoice = { id: string; name: string };

type ElevenCredentials = Pick<VoiceApiConfig, "apiKey" | "baseUrl">;

function apiBase(config: ElevenCredentials): string {
    const base = (config.baseUrl?.trim() || "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base) || !base.endsWith("/v1")) {
        throw new Error("ElevenLabs 接口地址须为 http(s) 地址并以 /v1 结尾");
    }
    return base;
}

async function request(config: ElevenCredentials, path: string, init: RequestInit = {}, version: "v1" | "v2" = "v1"): Promise<Response> {
    if (!config.apiKey.trim()) throw new Error("请先填写 ElevenLabs API Key");
    const controller = new AbortController();
    const abort = () => controller.abort();
    const external = init.signal;
    if (external?.aborted) abort();
    external?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 120_000);
    try {
        const base = version === "v2" ? apiBase(config).replace(/\/v1$/, "/v2") : apiBase(config);
        const response = await fetch(`${base}${path}`, {
            ...init,
            signal: controller.signal,
            headers: { "xi-api-key": config.apiKey.trim(), ...init.headers },
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            const detail = data?.detail;
            const message = typeof detail === "string" ? detail : detail?.message;
            throw new Error(message || `ElevenLabs 请求失败（HTTP ${response.status}）`);
        }
        // 读取响应体也在超时与取消的保护内。
        const blob = await response.blob();
        return new Response(blob, { status: response.status, headers: response.headers });
    } catch (error) {
        if (controller.signal.aborted && !external?.aborted) throw new Error("ElevenLabs 请求超时，请重试");
        throw error;
    } finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", abort);
    }
}

export async function fetchElevenModels(config: ElevenCredentials, signal?: AbortSignal): Promise<ElevenModel[]> {
    const data: unknown = await (await request(config, "/models", { signal })).json();
    if (!Array.isArray(data)) throw new Error("模型接口返回格式异常");
    return data.filter(item => item && typeof item.model_id === "string" && item.can_do_text_to_speech === true)
        .map(item => ({
            id: item.model_id,
            name: String(item.name || item.model_id),
            limit: typeof item.maximum_text_length_per_request === "number" ? item.maximum_text_length_per_request : undefined,
        }));
}

export async function fetchElevenVoices(config: ElevenCredentials, signal?: AbortSignal): Promise<ElevenVoice[]> {
    const voices = new Map<string, ElevenVoice>();
    const seenTokens = new Set<string>();
    let token = "";
    do {
        const query = new URLSearchParams({ page_size: "100" });
        if (token) query.set("next_page_token", token);
        const data = await (await request(config, `/voices?${query}`, { signal }, "v2")).json();
        if (!Array.isArray(data?.voices)) throw new Error("音色接口返回格式异常");
        for (const voice of data.voices) {
            if (voice && typeof voice.voice_id === "string") {
                voices.set(voice.voice_id, { id: voice.voice_id, name: String(voice.name || voice.voice_id) });
            }
        }
        if (!data.has_more) break;
        token = typeof data.next_page_token === "string" ? data.next_page_token : "";
        if (!token || seenTokens.has(token)) throw new Error("音色分页返回异常，请刷新重试");
        seenTokens.add(token);
    } while (token);
    return [...voices.values()];
}

// v3 的保守客户端保护值；不代表标签计费规则，不做可能拆坏标签的自动分段。
const V3_TEXT_LIMIT = 5000;
export async function synthesizeElevenSpeech(text: string, config: VoiceApiConfig, signal?: AbortSignal): Promise<Blob> {
    if (!config.model?.trim()) throw new Error("请选择 ElevenLabs 语音模型");
    if (!config.defaultVoice.trim()) throw new Error("请选择音色或填写 Voice ID");
    if (config.model.trim() === "eleven_v3" && Array.from(text).length > V3_TEXT_LIMIT) {
        throw new Error(`v3 单次语音文本请控制在 ${V3_TEXT_LIMIT} 字符以内（客户端保守检查包含标签）`);
    }
    const response = await request(config, `/text-to-speech/${encodeURIComponent(config.defaultVoice.trim())}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        // 不清理方括号、不补写表演标签，完整保留调用方传入的语音文本。
        body: JSON.stringify({ text, model_id: config.model.trim() }),
    });
    const blob = await response.blob();
    if (!blob.size || /json|text\//i.test(blob.type)) throw new Error("ElevenLabs 未返回有效音频");
    return blob;
}
