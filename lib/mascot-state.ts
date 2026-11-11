// lib/mascot-state.ts
// Global mascot state — shared between widget and floating ball.

type MascotState = "widget" | "animating_in" | "animating_out" | "floating";

export const MASCOT_TRANSITION_MS = 320;

let _state: MascotState = "widget";
let _panelOpen = false;
let _openedFromQuickMenu = false;
let _widgetRect: DOMRect | null = null;
const _listeners = new Set<() => void>();
let _transitionTimer: ReturnType<typeof setTimeout> | null = null;

function notify() { _listeners.forEach((fn) => fn()); }

function scheduleState(nextState: MascotState) {
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(() => {
    _state = nextState;
    _transitionTimer = null;
    notify();
  }, MASCOT_TRANSITION_MS);
}

export function getMascotState() { return _state; }
export function isMascotPanelOpen() { return _panelOpen; }
export function getMascotWidgetRect() { return _widgetRect; }
export function isMascotQuickMenuMode() { return _openedFromQuickMenu; }

export function activateMascot(widgetRect: DOMRect) {
  _openedFromQuickMenu = false;
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _widgetRect = widgetRect;
  _state = "animating_in";
  notify();
  scheduleState("floating");
}

export function deactivateMascot() {
  if (_openedFromQuickMenu) { closeMascotPanel(); return; }
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _panelOpen = false;
  _state = "animating_out";
  notify();
  scheduleState("widget");
}

// 供统一快捷入口调用：不要求桌面组件先激活，也不会重置已有对话。
export function openMascotPanel() {
  if (_transitionTimer) { clearTimeout(_transitionTimer); _transitionTimer = null; }
  _openedFromQuickMenu = true;
  _state = "floating";
  _panelOpen = true;
  notify();
}

export function toggleMascotPanel() {
  if (_panelOpen) { closeMascotPanel(); return; }
  _panelOpen = true;
  notify();
}

export function closeMascotPanel() {
  _panelOpen = false;
  if (_openedFromQuickMenu) {
    if (_transitionTimer) { clearTimeout(_transitionTimer); _transitionTimer = null; }
    _openedFromQuickMenu = false;
    _state = "widget";
  }
  notify();
}

export function subscribeMascot(fn: () => void) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
