"use client";

import { useEffect, useState } from "react";
import type { VoiceApiConfig } from "@/lib/settings-types";
import { fetchElevenModels, fetchElevenVoices, type ElevenModel, type ElevenVoice } from "@/lib/elevenlabs-service";
import { Input } from "@/components/ui/form";

export function ElevenLabsOptions({ config, onChange, onPreview, playing }: {
    config: VoiceApiConfig;
    onChange: (updates: Partial<VoiceApiConfig>) => void;
    onPreview: () => void;
    playing: boolean;
}) {
    const [models, setModels] = useState<ElevenModel[]>([]);
    const [voices, setVoices] = useState<ElevenVoice[]>([]);
    const [modelError, setModelError] = useState("");
    const [voiceError, setVoiceError] = useState("");
    const [modelBusy, setModelBusy] = useState(false);
    const [voiceBusy, setVoiceBusy] = useState(false);
    const [modelRefresh, setModelRefresh] = useState(0);
    const [voiceRefresh, setVoiceRefresh] = useState(0);
    const [manualModel, setManualModel] = useState(false);
    const [manualVoice, setManualVoice] = useState(false);
    const { id, apiKey, baseUrl } = config;

    useEffect(() => {
        setModels([]);
        setVoices([]);
    }, [id, apiKey, baseUrl]);

    useEffect(() => {
        const controller = new AbortController();
        setModelError("");
        setModelBusy(Boolean(apiKey.trim()));
        const timer = setTimeout(() => {
            if (!apiKey.trim()) return;
            void fetchElevenModels({ apiKey, baseUrl }, controller.signal).then(
                value => { if (!controller.signal.aborted) setModels(value); },
                error => { if (!controller.signal.aborted) setModelError(error instanceof Error ? error.message : "模型加载失败"); },
            ).finally(() => { if (!controller.signal.aborted) setModelBusy(false); });
        }, 650);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [id, apiKey, baseUrl, modelRefresh]);

    useEffect(() => {
        const controller = new AbortController();
        setVoiceError("");
        setVoiceBusy(Boolean(apiKey.trim()));
        const timer = setTimeout(() => {
            if (!apiKey.trim()) return;
            void fetchElevenVoices({ apiKey, baseUrl }, controller.signal).then(
                value => { if (!controller.signal.aborted) setVoices(value); },
                error => { if (!controller.signal.aborted) setVoiceError(error instanceof Error ? error.message : "音色加载失败"); },
            ).finally(() => { if (!controller.signal.aborted) setVoiceBusy(false); });
        }, 650);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [id, apiKey, baseUrl, voiceRefresh]);

    const customModel = manualModel || Boolean(config.model && !models.some(m => m.id === config.model));
    const customVoice = manualVoice || Boolean(config.defaultVoice && !voices.some(v => v.id === config.defaultVoice));
    return <div className="flex flex-col gap-3">
        <label className="menu-desc">接口地址（包含 /v1）</label>
        <Input value={config.baseUrl || ""} placeholder="https://api.elevenlabs.io/v1" onChange={event => onChange({ baseUrl: event.target.value })} />
        <div className="flex justify-between items-center">
            <label className="menu-desc">语音模型</label>
            <button type="button" className="ui-btn ui-btn-outline" disabled={modelBusy || !apiKey.trim()} onClick={() => setModelRefresh(v => v + 1)}>{modelBusy ? "加载中…" : "刷新模型"}</button>
        </div>
        <select className="ui-select" aria-label="ElevenLabs 模型" value={customModel ? "__manual__" : config.model || ""} onChange={event => {
            setManualModel(event.target.value === "__manual__");
            if (event.target.value !== "__manual__") onChange({ model: event.target.value });
        }}>
            <option value="" disabled>请选择模型</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name} ({model.id})</option>)}
            <option value="__manual__">自行填写模型 ID</option>
        </select>
        {customModel && <Input aria-label="ElevenLabs 模型 ID" value={config.model || ""} placeholder="例如 eleven_v3" onChange={event => onChange({ model: event.target.value })} />}
        {modelError && <span role="alert" className="menu-desc">{modelError}</span>}
        {!modelBusy && !modelError && apiKey.trim() && !models.length && <span className="menu-desc">未返回可用 TTS 模型，可刷新或手填 ID。</span>}
        <div className="flex justify-between items-center">
            <label className="menu-desc">音色</label>
            <button type="button" className="ui-btn ui-btn-outline" disabled={voiceBusy || !apiKey.trim()} onClick={() => setVoiceRefresh(v => v + 1)}>{voiceBusy ? "加载中…" : "刷新音色"}</button>
        </div>
        <select className="ui-select" aria-label="ElevenLabs 音色" value={customVoice ? "__manual__" : config.defaultVoice || ""} onChange={event => {
            setManualVoice(event.target.value === "__manual__");
            if (event.target.value !== "__manual__") onChange({ defaultVoice: event.target.value });
        }}>
            <option value="" disabled>请选择音色</option>
            {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} ({voice.id})</option>)}
            <option value="__manual__">自行填写 ID</option>
        </select>
        {customVoice && <Input aria-label="ElevenLabs Voice ID" value={config.defaultVoice} placeholder="输入 Voice ID" onChange={event => onChange({ defaultVoice: event.target.value })} />}
        {voiceError && <span role="alert" className="menu-desc">{voiceError}</span>}
        {!voiceBusy && !voiceError && apiKey.trim() && !voices.length && <span className="menu-desc">未返回账户音色，可刷新或自行填写 ID。</span>}
        <button type="button" className="ui-btn ui-btn-soft-action" disabled={!playing && (!apiKey.trim() || !config.model?.trim() || !config.defaultVoice.trim())} onClick={onPreview}>{playing ? "停止试听" : "试听（调用语音 API）"}</button>
        <span className="menu-desc">列表刷新不会修改已保存的模型和音色。v3 的语气标签由语音文本提供，接口不自动添加。</span>
    </div>;
}
