// Offline regression checks; no API keys or paid requests. Run: node scripts/check-elevenlabs-audio-tags.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
const mocks = {
    "./llm-provider-adapter": { buildProviderRequest() { throw new Error("Network must not be used in regression checks"); } },
    "./llm-http": { fetchLlmPayload() { throw new Error("Network must not be used in regression checks"); } },
    "./action-parser": { stripActionShells: text => text },
    "./text-tool-protocol": { stripTextToolDirectives: text => text },
    "./custom-app-chat-directives": { loadCustomAppChatDirectives: () => [] },
};
function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
        fileName: filename,
        reportDiagnostics: true,
    });
    const errors = (output.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `Syntax error in ${relative}`);
    const module = { exports: {} };
    cache.set(filename, module);
    const requireLocal = id => {
        if (id in mocks) return mocks[id];
        if (id.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)));
        return nativeRequire(id);
    };
    new Function("require", "module", "exports", output.outputText)(requireLocal, module, module.exports);
    return module.exports;
}
const tags = load("lib/elevenlabs-audio-tags.ts");
assert.equal(tags.supportsElevenAudioTags({ provider: "ElevenLabs", model: "eleven_v3" }), true);
assert.equal(tags.supportsElevenAudioTags({ provider: "ElevenLabs", model: "unknown" }), false);
assert.equal(tags.supportsElevenAudioTags({ provider: "ElevenLabs", model: "unknown", elevenAudioTags: true }), true);
assert.equal(tags.supportsElevenAudioTags({ provider: "OpenAI", model: "eleven_v3" }), false);
assert.equal(tags.hasElevenAudioTags("[British accent] Hello"), true);
assert.equal(tags.stripElevenAudioTags("[whispers]请填写[姓名]"), "请填写[姓名]");
const { compilePerformanceCues } = load("lib/elevenlabs-performance.ts");
const original = "你好🙂，请填写[姓名]。";
const result = compilePerformanceCues(original, { cues: [{ offset: 0, tag: "curious" }, { offset: 3, tag: "whispers" }] });
assert.equal(tags.stripElevenAudioTags(result), original);
assert.throws(() => compilePerformanceCues(original, { cues: [] }));
assert.throws(() => compilePerformanceCues(original, { cues: [{ offset: 100, tag: "curious" }] }));
assert.throws(() => compilePerformanceCues(original, { cues: [{ offset: 0, tag: "turn around" }] }));
const { parseAIResponse } = load("lib/rich-message-parser.ts");
const parsed = parseAIResponse("[语音条:[curious]你好。\n\n[whispers]请填写[姓名]。]\n\n正常消息", []);
assert.equal(parsed.parts.length, 2);
assert.equal(parsed.parts[0].mediaType, "audio");
assert.equal(parsed.parts[0].mediaData.label, "你好。\n\n请填写[姓名]。");
assert.equal(parsed.parts[0].mediaData.speechPerformanceText, "[curious]你好。\n\n[whispers]请填写[姓名]。");
assert.equal(parsed.parts[1].content, "正常消息");
assert.equal(parseAIResponse("[语音条:旧消息]", []).parts[0].mediaData.label, "旧消息");
console.log("ElevenLabs audio tag regression checks passed (offline; parser dependencies mocked).");
