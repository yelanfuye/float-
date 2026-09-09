export type OfflineDialogueBlock =
    | { type: "narration"; text: string }
    | { type: "char_dialogue"; text: string; translation?: string; speakerId?: string }
    | { type: "user_dialogue"; text: string; translation?: string; speakerId?: string };

const BLOCK_RE = /<(narration|char_dialogue|user_dialogue|dialogue)([^>]*)>([\s\S]*?)<\/\1>/gi;
const INNER_RE = /<(original|translation)\s*>([\s\S]*?)<\/\1>/gi;

function attribute(attrs: string, name: string): string | undefined {
    const match = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return match?.[1]?.trim() || undefined;
}

function cleanText(value: string): string {
    return value
        .replace(/^\s+|\s+$/g, "")
        .replace(/<br\s*\/?>(?=\n|$)/gi, "\n");
}

function parseDialogueBody(body: string): { text: string; translation?: string } {
    let original = "";
    let translation = "";
    let match: RegExpExecArray | null;
    INNER_RE.lastIndex = 0;
    while ((match = INNER_RE.exec(body)) !== null) {
        if (match[1].toLowerCase() === "original") original = cleanText(match[2]);
        if (match[1].toLowerCase() === "translation") translation = cleanText(match[2]);
    }
    if (!original) original = cleanText(body.replace(INNER_RE, ""));
    return { text: original, ...(translation ? { translation } : {}) };
}

/**
 * Parse the structured offline content protocol. Returns null when the text
 * contains no recognized block tags, so legacy offline records can keep using
 * the old renderer.
 */
export function parseOfflineDialogueBlocks(text: string): OfflineDialogueBlock[] | null {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];

    const blocks: OfflineDialogueBlock[] = [];
    let match: RegExpExecArray | null;
    BLOCK_RE.lastIndex = 0;
    while ((match = BLOCK_RE.exec(normalized)) !== null) {
        const tag = match[1].toLowerCase();
        const attrs = match[2] || "";
        const body = match[3] || "";
        if (tag === "narration") {
            const value = cleanText(body);
            if (value) blocks.push({ type: "narration", text: value });
            continue;
        }
        const dialogue = parseDialogueBody(body);
        if (!dialogue.text) continue;
        const speakerId = attribute(attrs, "speaker") || attribute(attrs, "speakerId");
        const type = tag === "user_dialogue" ? "user_dialogue" : "char_dialogue";
        blocks.push({ type, ...dialogue, ...(speakerId ? { speakerId } : {}) });
    }

    return blocks.length > 0 ? blocks : null;
}
