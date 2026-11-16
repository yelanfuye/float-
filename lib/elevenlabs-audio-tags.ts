import type { VoiceApiConfig } from "./settings-types";

// 明确确认的模型默认开启；未知模型由用户在设置中显式声明能力。
export function supportsElevenAudioTags(config: VoiceApiConfig): boolean {
    return config.provider === "ElevenLabs" && (config.elevenAudioTags ?? config.model?.trim() === "eleven_v3");
}

const TAG_NAMES = new Set([
    "whispers", "whispering", "shouts", "shouting", "laughs", "laughing", "chuckles",
    "sighs", "gasps", "crying", "sobbing", "clears throat", "curious", "excited",
    "sad", "angry", "calm", "thoughtful", "serious", "gentle", "cheerful", "sarcastic",
    "nervous", "tired", "hesitant", "reassuring", "playful", "surprised", "confident",
]);

export function isElevenAudioTag(value: string): boolean {
    const name = value.trim().toLowerCase();
    return TAG_NAMES.has(name) || /^(?:strong |slight )?[a-z]+(?: [a-z]+){0,2} accent$/.test(name);
}

export function hasElevenAudioTags(text: string): boolean {
    return [...text.matchAll(/\[([^\[\]\n]+)\]/g)].some(match => isElevenAudioTag(match[1]));
}

// 只移除识别到的演绎指令，保留正文中的 [姓名] 等方括号内容。
export function stripElevenAudioTags(text: string): string {
    return text.replace(/\[([^\[\]\n]+)\]/g, (full, name: string) => isElevenAudioTag(name) ? "" : full).trim();
}

export const ELEVEN_AUDIO_TAG_INSTRUCTION = `【ElevenLabs 语音演绎协议】
仅在发送语音条时使用，普通文字消息不要添加音频标签。保持原有 [语音条:台词] 格式，在台词内部插入英文方括号演绎标签，例如 [语音条:[curious] 你怎么来了？[whispers] 先别出声。]。
每条语音必须至少包含一个贴合角色性格、当前对话和表达意图的标签；平静表达也应使用 [calm]、[thoughtful] 等适合的声音指令。情绪有转折时按语义分段，避免逐字添加或堆叠矛盾标签。
可用声音标签：${[...TAG_NAMES].map(tag => `[${tag}]`).join("、")}。
只有角色设定或剧情明确要求时才使用英文口音描述标签，例如 [British accent]；不要随机切换口音。哭泣、喊叫和大笑必须有上下文支持。不添加环境音效、视觉动作、唱歌或无关台词。双语语音只在原文部分加入标签。`;
