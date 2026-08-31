import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BASE_URL;
    const normalized = raw.replace(/\/$/, "");
    return /^https:\/\/api\.elevenlabs\.io$/i.test(normalized) ? `${normalized}/v1` : normalized;
}

function normalizeApiKey(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim()
        .replace(/^['\"]|['\"]$/g, "")
        .replace(/^Bearer\s+/i, "")
        .replace(/^xi-api-key\s*:\s*/i, "")
        .replace(/^['\"]|['\"]$/g, "")
        .trim();
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const apiKey = normalizeApiKey(body.apiKey);
        const baseUrl = normalizeBaseUrl(body.baseUrl);
        const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
        const payload = body.payload;

        if (!apiKey) return NextResponse.json({ error: "missing_api_key", message: "ElevenLabs API Key 未配置" }, { status: 400 });
        if (!voiceId) return NextResponse.json({ error: "missing_voice_id", message: "ElevenLabs Voice ID 未配置" }, { status: 400 });
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return NextResponse.json({ error: "invalid_payload", message: "ElevenLabs 请求参数无效" }, { status: 400 });
        }

        const response = await proxyFetch(`${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}`, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body: JSON.stringify(payload),
        });
        const bytes = await response.arrayBuffer();
        if (!response.ok) {
            const text = new TextDecoder().decode(bytes).slice(0, 1000);
            return NextResponse.json({
                error: "tts_failed",
                message: text || `ElevenLabs HTTP ${response.status}`,
                upstreamStatus: response.status,
            }, { status: response.status });
        }

        return new NextResponse(bytes, {
            status: 200,
            headers: {
                "Content-Type": response.headers.get("content-type") || "audio/mpeg",
                "Cache-Control": "no-store",
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: "tts_failed", message: message.slice(0, 1000) }, { status: 502 });
    }
}
