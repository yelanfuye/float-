"use client";

import { createPortal } from "react-dom";

/**
 * 生图失败提示：只在失败发生的那一刻弹一次，关掉即消失。
 * 之前是在气泡下面挂一行红字，会一直留在会话里，滚回去还能看到。
 */
export type GenerationErrorFeature = "image" | "text" | "voice";

// 同一窗口供文字、生图和语音失败复用；旧调用默认保持生图标题。
export function GenerationErrorDialog({
    message,
    onClose,
    feature = "image",
}: {
    message: string;
    onClose: () => void;
    feature?: GenerationErrorFeature;
}) {
    if (typeof document === "undefined") return null;
    return createPortal(
        <div
            className="modal-overlay"
            data-ui="modal"
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onPointerCancel={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
            onClick={e => {
                e.stopPropagation();
                onClose();
            }}
        >
            <div
                className="modal-dialog chat-generated-image-error-dialog"
                data-ui="modal-dialog"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header" data-ui="modal-header">
                    <h3 className="modal-title">{feature === "voice" ? "语音生成失败" : feature === "text" ? "文字生成失败" : "图片生成失败"}</h3>
                </div>
                <div className="modal-body" data-ui="modal-body">
                    <p className="chat-generated-image-error-text">{message}</p>
                </div>
                <div className="modal-footer" data-ui="modal-footer">
                    <button className="ui-btn ui-btn-primary" onClick={onClose}>知道了</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

// 保留原导出名称，兼容已有聊天和朋友圈的生图失败调用。
export const GeneratedImageErrorDialog = GenerationErrorDialog;
