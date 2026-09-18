// 音频占用协调：不依赖 React、播放器或微信模块，避免循环引用。
const holds = new Set<symbol>();
const listeners = new Set<() => void>();
export function isAudioPlaybackActive(): boolean { return holds.size > 0; }
export function subscribeAudioPlayback(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function notify(): void { for (const listener of listeners) listener(); }

/** 在启动真实播放前获取；结束、失败和取消时释放。释放函数可重复调用。 */
export function acquireAudioPlayback(): () => void {
    const token = Symbol("audio-playback");
    holds.add(token);
    if (holds.size === 1) notify();
    return () => {
        if (!holds.delete(token)) return;
        if (!holds.size) notify();
    };
}
