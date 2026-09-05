# ElevenLabs TTS 插件技术交接

## 1. 目标

为 AI 虚拟手机项目提供一个独立的 ElevenLabs TTS 接口插件或适配层，解决以下问题：

- 使用 ElevenLabs 官方接口或兼容中转接口生成语音；
- 保持 API Key 只存在于用户本地配置或安全的请求环境中；
- 支持 `eleven_v3` 的 Audio Tags（方括号语音指导）；
- 支持自然口语台词和一段话内的语气变化；
- 返回可被浏览器和项目现有播放器播放的音频 Blob；
- 能明确区分鉴权失败、站点访问保护、跨域失败、格式错误和上游错误。

本文件是给另一个 AI/开发者的工程交接，不是产品使用说明。API Key、Cookie、Netlify 登录信息和真实 Voice ID 不得写入代码、日志或文档。

## 2. 当前项目位置

主要文件：

- `lib/tts-service.ts`：TTS 总入口、MiniMax/OpenAI/ElevenLabs 请求和浏览器播放工具；
- `lib/settings-types.ts`：`VoiceApiConfig` 类型；
- `components/settings/voice-settings.tsx`：语音配置页、模型/音色同步和试听；
- `components/chat/message-bubble.tsx`：语音消息气泡、首次合成、缓存和播放；
- `components/chat/chat-room.tsx`：长按消息操作菜单和重新生成语音；
- `components/chat/voice-call-screen.tsx`：语音通话中的 TTS；
- `lib/llm-prompt-assembler.ts`：聊天模型提示词组装，含 ElevenLabs v3 语音台词规则；
- `lib/rich-message-parser.ts`：`[语音条:...]` 等富消息标记解析；
- `app/api/voice/elevenlabs-tts/route.ts`：旧的服务端 ElevenLabs 代理；目前浏览器 TTS 主路径已不应依赖它；
- `app/api/voice/elevenlabs-models/route.ts`：旧的服务端模型同步代理。

## 3. 当前 ElevenLabs 请求链路

当前主路径设计为浏览器直连：

```text
用户本地 VoiceApiConfig
  -> lib/tts-service.ts
  -> fetch(BaseURL + /text-to-speech/{voice_id})
  -> ElevenLabs 或兼容接口
  -> audio Blob
  -> data URL（语音消息落库）或播放器
```

请求方法：

```text
POST {baseUrl}/text-to-speech/{voiceId}
```

请求头：

```http
xi-api-key: <用户本地 API Key>
Content-Type: application/json
Accept: audio/mpeg
```

请求体基础形态：

```json
{
  "text": "要朗读的脚本",
  "model_id": "eleven_v3"
}
```

非 v3 模型当前会发送旧版 `voice_settings`：

```json
{
  "stability": 0.5,
  "similarity_boost": 0.75,
  "style": 0,
  "use_speaker_boost": true,
  "speed": 1.0
}
```

v3 的当前实现不自动发送上述旧版 `voice_settings`，主要依靠文本里的 Audio Tags 和台词本身控制表达。若插件要改变这一点，必须提供可回退开关，并在文档中注明适用模型和实测证据。

## 4. 已知历史问题

### 4.1 401 误判

曾经收到过如下返回：

```html
<title>Login Redirect</title>
...
app.netlify.com/edge-access
requested_path=/api/voice/elevenlabs-tts
```

这不是 ElevenLabs 的 401，而是 Netlify 站点访问保护拦截了本站服务端路由。旧代码会把所有 401 统一显示为“ElevenLabs API Key 未通过鉴权”，造成误导。

因此主 TTS 路径已改为浏览器直连，绕过本站 `/api/voice/elevenlabs-tts`。直连要求目标接口允许 CORS，并允许 `xi-api-key` 和 `Content-Type` 请求头。

### 4.2 音质忽好忽坏

项目曾给官方/兼容接口的 URL 强制增加：

```text
?output_format=mp3_44100_128
```

后来曾实验性改为：

```text
?output_format=mp3_44100_192
```

目前代码状态需以仓库实际版本为准；不要假定中转站支持该查询参数。不同接口可能：

- 忽略 `output_format`；
- 将其转成其他格式；
- 不支持该参数并走默认路径；
- 返回后再次转码。

MiniMax 当前明确请求：

```json
{
  "audio_setting": {
    "sample_rate": 44100,
    "bitrate": 256000,
    "format": "mp3",
    "channel": 1
  }
}
```

ElevenLabs 输出格式通常在 URL 查询参数中指定，不应把 MiniMax 的 `audio_setting` 字段发送给 ElevenLabs。

如果比较音质，必须记录实际请求 URL、HTTP `Content-Type`、文件字节数、音频容器和采样信息。不能仅根据 `Accept: audio/mpeg` 推断码率。

### 4.3 播放和保存链路

已检查的普通语音消息路径：

1. ElevenLabs 返回 Blob；
2. `FileReader.readAsDataURL()` 转成 data URL；
3. `persistMessageVoiceAudio()` 将 data URL 写入聊天存储；
4. 语音气泡使用原生 `Audio` 播放。

现有代码没有主动重新编码、降采样或音频压缩。若把从 Edge 下载到桌面后播放也听起来模糊，优先怀疑上游返回文件、输出格式或中转服务转码，而不是播放器。

## 5. 语音文本与 Audio Tags

### 5.1 当前聊天 TTS 文本

普通角色语音气泡使用：

```ts
const text = msg.mediaData?.label || "语音消息";
const bilingual = splitBilingualText(text);
const speechText = bilingual?.original || text;
```

生成时使用 `speechText`。已有音频会缓存；只重新点击旧气泡不会自动重新生成。

### 5.2 重新生成语音

角色语音消息长按菜单目前包含“重新生成语音”功能，设计目标是：

- 弹出当前朗读文本；
- 用户可以编辑本次 TTS 文本；
- 用户可以手动加入 v3 标签，例如：

```text
[excited] 真的？你已经到了？[playfully] 那这次算你赢。
```

- 二次确认会消耗 TTS 额度；
- 成功后替换旧音频；
- 失败时保留旧音频；
- 不修改聊天原文；
- 不重新生成整轮聊天回复。

重新生成必须使用当前角色绑定的语音配置，并防止同一条消息同时发起两个请求。

### 5.3 当前 v3 提示词规则

`lib/llm-prompt-assembler.ts` 已加入仅针对绑定 ElevenLabs v3 聊天场景的规则，目标包括：

- 台词口语化，减少报告式和书面化表达；
- 标签按语境使用，不是每句必加；
- 每句话最多两个 Audio Tags，通常一个就够；
- 禁止在一句话前连续堆三个或更多标签；
- 每个标签必须独立成对，例如：

```text
[a] [b] 这句话
```

- 不允许合并、嵌套或漏掉括号；
- 标签应放在对应句子或语气变化的位置，不要统一堆在整段开头；
- 不默认使用 `[whispers]`，因为耳语可能降低听感音量；
- 不用口音、机器人、喊叫、喘息等标签作为默认自然化手段；
- 不使用 SSML。

当前规则使用的社区经验参考标签包括：

```text
[conversational tone]
[casual]
[lighthearted]
[playfully]
[cheeky]
[happily]
[hesitant]
[questioning]
[reflective]
[understated]
[matter-of-fact]
[annoyed]
[frustrated]
[flustered]
[nervous]
[regretful]
[resigned tone]
[sad]
[wistful]
[surprised]
[excited]
[angry]
[sarcastic tone]
[tired]
[continues softly]
[slows down]
[soft chuckle]
[sighs]
[sigh of relief]
[whispers]
```

这些不是项目内部保证有效的枚举，也不是所有音色都保证响应的固定词表。插件不应擅自把清单扩大成强制词典。

### 5.4 富消息解析注意事项

项目使用 `[语音条:文字内容]` 表示语音消息，同时也使用大量中文方括号表示照片、红包、世界书等功能。语音条内部可能含英文 Audio Tags，例如：

```text
[语音条:[surprised] 你已经到啦？[playfully] 好，那这次算你赢。]
```

解析器必须支持语音条内部一层英文标签，不能在第一个 `]` 处截断。不要用“删除所有方括号内容”的方式清洗展示文本，否则可能破坏业务富消息标记。

插件最好把“显示文本”和“朗读文本”作为两个明确字段处理：

- 显示文本：可以隐藏 Audio Tags；
- 朗读文本：保留 Audio Tags、标点和分段；
- 富消息控制标记：不能被当成 Audio Tags 删除或发送。

## 6. MiniMax 与 ElevenLabs 的区别

MiniMax 当前语音函数签名预留：

```ts
synthesizeSpeech(text, voiceConfig, { emotion?: string })
```

MiniMax 分支会将有效情绪转换成：

```json
"voice_setting": {
  "emotion": "happy"
}
```

有效值当前代码限制为：

```text
happy, sad, angry, fearful, disgusted, surprised, calm, neutral, fluent
```

但普通聊天气泡、设置试听和已检查的私聊通话调用处都没有传入独立 `emotion`。所以不要把“MiniMax 当前听感更自然”简单归因于项目自动传了情绪。

ElevenLabs 不应直接接收 MiniMax 的 `emotion` 字段。若要使用 ElevenLabs v3 情绪，需要把表达信息转成脚本中的 Audio Tags，或使用经确认支持的 v3 参数。两种接口的协议必须分开适配。

## 7. 插件建议接口

建议插件暴露一个纯函数或类接口，避免直接依赖 React：

```ts
type ElevenLabsTtsRequest = {
  apiKey: string;
  baseUrl?: string;
  voiceId: string;
  modelId: string;
  text: string;
  outputFormat?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
    speed?: number;
  };
};

type ElevenLabsTtsResult = {
  blob: Blob;
  contentType: string;
  outputUrl: string;
  modelId: string;
  voiceId: string;
  outputFormat?: string;
};

async function synthesize(request: ElevenLabsTtsRequest): Promise<ElevenLabsTtsResult>;
```

要求：

- 默认使用浏览器直连；
- 不在插件代码中硬编码 Key；
- API Key 只放在内存请求头中；
- 对 `baseUrl` 只移除末尾斜杠；官方裸地址 `https://api.elevenlabs.io` 可补 `/v1`，不要擅自改写自定义中转地址；
- `voiceId` 必须 URL 编码；
- `outputFormat` 需要明确映射到 URL 查询参数；
- 不要把未知 JSON 字段直接拼入请求；
- 原样读取响应字节，不做二次编码；
- 保留响应 `Content-Type`，对非音频响应先读取文本并报告具体错误；
- 对 HTML Login Redirect 单独识别为部署平台访问保护或网关拦截；
- 对 HTTP 401 单独标记鉴权失败，但同时保留上游正文；
- 支持请求超时和 AbortSignal；
- 不自动重试付费请求；
- 不在失败后自动切换模型、音色或输出格式。

## 8. 输出格式实验建议

插件应允许显式选择输出格式，但默认不要偷偷改变用户现有配置。建议按用户接口实际支持情况测试：

```text
mp3_44100_128
mp3_44100_192
```

`pcm_48000` 不应直接接入现有 MP3 播放链路，除非插件负责将 PCM 正确封装为浏览器可播放格式。不要把 `ulaw_8000` 当作高质量选项。

对照测试必须保持以下因素不变：

- Voice ID；
- 模型 ID；
- 文本；
- API Key；
- 接口地址；
- Audio Tags；
- 播放设备。

只改变 `output_format`，分别保存原始文件并在外部播放器播放。记录 HTTP 状态、Content-Type、文件大小和听感。

## 9. v3 语气实验建议

语气测试要单独进行，不要同时改码率、音色、文本和提示词。

基线：

```json
{
  "text": "今天天气不错，适合出去走走。",
  "model_id": "eleven_v3"
}
```

标签对照：

```json
{
  "text": "[casual] 今天天气不错，适合出去走走。",
  "model_id": "eleven_v3"
}
```

一段内切换对照：

```text
[surprised] 你已经到啦？我还以为要再等一会儿。[playfully] 好，那这次算你赢。
```

注意：

- 每句最多两个标签，通常一个足够；
- 标签必须独立使用完整中括号；
- 不要写成 `[a,b,c]` 代替三个独立标签；
- 不要在一句话前连续堆很多标签；
- 标签生效范围和稳定性依赖模型、音色、文本和上下文；
- 不能把一次成功当成所有音色都稳定支持。

## 10. 验收标准

### 请求

- [ ] 请求确实发往用户配置的目标地址；
- [ ] URL 路径为 `/text-to-speech/{voice_id}`；
- [ ] Voice ID 已编码；
- [ ] `xi-api-key` 只出现在发往目标接口的请求头；
- [ ] v3 的 `model_id` 原样传递；
- [ ] 输出格式明确且可追踪；
- [ ] 不经过 Netlify 受保护的本站代理，除非用户明确选择代理模式。

### 音频

- [ ] 成功响应为音频；
- [ ] 不二次压缩、不降采样、不转码；
- [ ] Blob、data URL、下载文件的字节内容一致；
- [ ] 浏览器内播放和下载后外部播放结果一致；
- [ ] 失败响应不会被误显示为音频。

### 语气

- [ ] v3 语音规则只注入适用的 ElevenLabs v3 场景；
- [ ] 每句话最多两个标签；
- [ ] 标签各自成对、不能嵌套；
- [ ] 支持一段话中在不同句子前切换标签；
- [ ] 不强制每句添加标签；
- [ ] 普通文字消息不被污染；
- [ ] 已生成语音的重新生成可以使用编辑后的朗读文本。

### 安全和费用

- [ ] 不记录 API Key；
- [ ] 不把 API Key 写入错误提示、URL、日志或提交内容；
- [ ] 失败不自动重试；
- [ ] 用户明确知道每次重新生成可能消耗额度；
- [ ] 不自动切换账户、音色、模型或输出格式。

## 11. 给接手 AI 的简短任务

请基于本文件实现一个独立 ElevenLabs TTS 插件或适配层：

1. 先阅读项目现有 `lib/tts-service.ts` 和消息解析/保存链路；
2. 先输出你发现的实际请求差异，不要直接重写整个 TTS 文件；
3. 保持浏览器直连方案，除非明确说明为什么需要代理；
4. 先提供最小、可回退的代码补丁；
5. 只改请求构造、响应校验或插件边界，不改聊天消息协议；
6. 不自动添加一堆标签；每句话最多两个，通常一个；
7. 明确说明 output format 在目标接口是否被实际支持；
8. 不使用真实 API Key 做未经授权的测试；
9. 最后给出变更文件、请求示例、测试方法和未验证风险。

## 12. 当前未确认事项

以下事项不能从本项目源码单独确认：

- 某个第三方中转站是否完整支持 ElevenLabs v3；
- 中转站是否支持 `output_format` 及哪些格式；
- 返回 MP3 的真实码率和采样率；
- 某个克隆音色是否适合所有 Audio Tags；
- v3 每个社区经验标签是否都稳定生效；
- ElevenLabs 账户余额、套餐权限和字符额度；
- Netlify 当前部署是否已成功更新到仓库最新版本。

接手者必须把“源码已确认”“文档声明”“第三方经验”“实际测试”分开记录。
