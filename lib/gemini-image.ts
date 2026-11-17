// Shared by browser direct requests and the server relay. No credentials are persisted here.
export const GEMINI_IMAGE_ASPECT_RATIOS = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

type GeminiImageInput = {
    baseUrl: string;
    model: string;
    prompt: string;
    aspectRatio?: string;
    referenceImageDataUrl?: string | null;
};

export function buildGeminiImageRequest(input: GeminiImageInput): { url: string; body: string } {
    const base = input.baseUrl.trim().replace(/\/+$/, "");
    const model = input.model.trim().replace(/^models\//, "");
    if (!base || !model || !input.prompt.trim()) throw new Error("生图失败（Google）：请填写接口地址、模型和图片描述。");
    let endpoint: URL;
    try { endpoint = new URL(base); }
    catch { throw new Error("生图失败（Google）：接口地址无效，请填写完整的 HTTP(S) 地址。"); }
    if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error("生图失败（Google）：接口地址须为不含密钥、查询参数或锚点的 HTTP(S) 地址。");
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("生图失败（Google）：模型 ID 格式无效，请填写模型名称。");
    // Accept an API root, a versioned root, or a full generateContent endpoint.
    const root = base.replace(/\/models\/[^/]+:generateContent$/, "");
    const versioned = /\/v1(?:beta|alpha)?$/.test(root) ? root : `${root}/v1beta`;
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt.trim() }];
    if (input.referenceImageDataUrl) {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(input.referenceImageDataUrl);
        if (!match) throw new Error("生图失败（Google）：参考图需要 PNG、JPEG 或 WebP 格式。");
        parts.push({ inlineData: { mimeType: match[1], data: match[2].replace(/\s/g, "") } });
    }
    const ratio = input.aspectRatio || "auto";
    if (!GEMINI_IMAGE_ASPECT_RATIOS.includes(ratio)) throw new Error("生图失败（Google）：不支持此画面比例，请重新选择。");
    return {
        url: `${versioned}/models/${encodeURIComponent(model)}:generateContent`,
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                ...(ratio !== "auto" ? { imageConfig: { aspectRatio: ratio } } : {}),
            },
        }),
    };
}

export function parseGeminiImageResponse(value: unknown, status = 200): { b64: string; mimeType: string } {
    const data = value as {
        error?: { message?: string; status?: string };
        promptFeedback?: { blockReason?: string };
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{
            thought?: boolean;
            text?: string;
            inlineData?: { data?: string; mimeType?: string };
            inline_data?: { data?: string; mime_type?: string };
        }> } }>;
    } | null;
    if (status < 200 || status >= 300 || data?.error) {
        const advice = status === 401 || status === 403 ? "请检查 API Key、模型权限及服务地区。"
            : status === 429 ? "额度不足或请求过于频繁，请检查配额后重试。"
            : status === 404 ? "未找到模型或接口，请检查模型 ID 与接口地址。" : "请检查接口配置或稍后重试。";
        throw new Error(`生图失败（Google，HTTP ${status}）：${advice}${typeof data?.error?.message === "string" ? ` 接口说明：${data.error.message.slice(0, 500)}` : ""}`);
    }
    const candidates = (Array.isArray(data?.candidates) ? data.candidates : []).filter(c => c && typeof c === "object");
    const getParts = (candidate: typeof candidates[number]) => (Array.isArray(candidate.content?.parts) ? candidate.content.parts : []).filter(p => p && typeof p === "object");
    for (const candidate of candidates) {
        for (const part of getParts(candidate)) {
            if (part.thought) continue;
            const image = part.inlineData || part.inline_data;
            const mimeType = part.inlineData?.mimeType || part.inline_data?.mime_type || "image/png";
            if (image?.data && /^image\//.test(mimeType)) return { b64: image.data, mimeType };
        }
    }
    const reason = data?.promptFeedback?.blockReason || candidates.find(c => c.finishReason && c.finishReason !== "STOP")?.finishReason;
    const text = candidates.flatMap(getParts).filter(p => !p.thought).map(p => typeof p.text === "string" ? p.text : "").join(" ").slice(0, 400);
    throw new Error(`生图失败（Google）：接口未返回图片。${reason ? `原因：${reason}。` : "请确认所选模型支持生图。"}${text ? ` 模型说明：${text}` : ""}`);
}
