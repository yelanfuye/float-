import { hydrateKvDb, kvGet, kvSetAsync, registerKvMigration } from "./kv-db";

// Organization metadata only. Never copy credentials or replace configuration IDs.
const KEY = "ai_phone_api_manager_tags_v1";
registerKvMigration(KEY);
export type ApiManagerTags = Record<string, string[]>;
export function apiManagerTagKey(kind: string, id: string): string {
    return JSON.stringify([kind, id]);
}
export function normalizeApiManagerTags(values: string[]): string[] {
    const seen = new Set<string>();
    return values.map(value => value.trim()).filter(value => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        if (value.length > 30) throw new Error("每个标签最多 30 个字符");
        seen.add(key);
        return true;
    });
}
export function readApiManagerTags(): ApiManagerTags {
    const raw = kvGet(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("标签数据无法读取；原 API 配置不受影响，请使用旧版入口。");
    const entries = Object.entries(parsed);
    if (entries.some(([, value]) => !Array.isArray(value) || value.some(tag => typeof tag !== "string"))) {
        throw new Error("标签数据格式异常；未覆盖已有标签。");
    }
    return Object.fromEntries(entries) as ApiManagerTags;
}
export async function updateApiManagerTags(keys: string[], input: string[], mode: "add" | "remove"): Promise<ApiManagerTags> {
    await hydrateKvDb();
    const current = readApiManagerTags();
    const vocabulary = Object.values(current).flat();
    const tags = normalizeApiManagerTags(input).map(tag => vocabulary.find(value => value.toLowerCase() === tag.toLowerCase()) || tag);
    if (!tags.length) throw new Error("请至少填写一个标签");
    const remove = new Set(tags.map(tag => tag.toLowerCase()));
    const next = { ...current };
    keys.forEach(key => {
        const previous = current[key] || [];
        next[key] = mode === "add" ? normalizeApiManagerTags([...previous, ...tags]) : previous.filter(tag => !remove.has(tag.toLowerCase()));
    });
    await kvSetAsync(KEY, JSON.stringify(next));
    return next;
}
