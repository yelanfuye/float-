import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BASE_URL;
    const normalized = raw.replace(/\/$/, "");
    if (/^https:\/\/api\.elevenlabs\.io$/i.test(normalized)) return `${normalized}/v1`;
    return normalized;
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

function getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const apiKey = normalizeApiKey(body.apiKey);
        const baseUrl = normalizeBaseUrl(body.baseUrl);
        if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });

        const response = await proxyFetch(`${baseUrl}/models`, {
            method: "GET",
            headers: {
                "xi-api-key": apiKey,
                Accept: "application/json",
            },
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return NextResponse.json({ error: "upstream_not_json", message: text.slice(0, 500) }, { status: 502 });
        }
        if (!response.ok) {
            const record = getRecord(payload);
            const detail = getRecord(record.detail);
            return NextResponse.json({
                error: "get_models_failed",
                message: String(detail.message || record.message || text || `HTTP ${response.status}`).slice(0, 500),
                upstreamStatus: response.status,
            }, { status: response.status === 401 ? 401 : 502 });
        }

        const models = Array.isArray(payload) ? payload : [];
        const normalized = models.flatMap(item => {
            const model = getRecord(item);
            const id = model.model_id ?? model.id;
            if (typeof id !== "string" || !id.trim()) return [];
            const name = model.name ?? id;
            return [{ id: id.trim(), name: typeof name === "string" && name.trim() ? name.trim() : id.trim() }];
        });
        return NextResponse.json({ ok: true, models: normalized });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: "get_models_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}
