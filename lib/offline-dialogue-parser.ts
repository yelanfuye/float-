export type OfflineDialogueBlock =
    | { type: "narration"; text: string }
    | { type: "char_dialogue"; text: string; translation?: string }
    | { type: "user_dialogue"; text: string; translation?: string };

const BLOCK_RE = /<(narration|char_dialogue|user_dialogue)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const INNER_RE = /<(original|translation)\s*>([\s\S]*?)<\/\1>/gi;

function cleanText(value: string): string {
    return value.replace(/^\s+|\s+$/g, "").replace(/<br\s*\/?>/gi, "\n");
}

function parseDialogueBody(body: string): { text: string; translation?: string } {
    let original = "";
    let translation = "";
    INNER_RE.lastIndex = 0;
    for (const match of body.matchAll(INNER_RE)) {
        if (match[1].toLowerCase() === "original") original = cleanText(match[2]);
        if (match[1].toLowerCase() === "translation") translation = cleanText(match[2]);
    }
    if (!original) original = cleanText(body.replace(INNER_RE, ""));
    return { text: original, ...(translation ? { translation } : {}) };
}

/** Structured offline protocol parser. Null means legacy text format. */
export function parseOfflineDialogueBlocks(text: string): OfflineDialogueBlock[] | null {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const blocks: OfflineDialogueBlock[] = [];
    BLOCK_RE.lastIndex = 0;
    for (const match of normalized.matchAll(BLOCK_RE)) {
        const type = match[1].toLowerCase();
        const body = match[2] || "";
        if (type === "narration") {
            const narration = cleanText(body);
            if (narration) blocks.push({ type: "narration", text: narration });
            continue;
        }
        const dialogue = parseDialogueBody(body);
        if (dialogue.text) blocks.push({ type: type === "user_dialogue" ? "user_dialogue" : "char_dialogue", ...dialogue });
    }
    return blocks.length ? blocks : null;
}
