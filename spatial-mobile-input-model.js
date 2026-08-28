(function spatialMobileInputModel(global) {
  "use strict";

  const MODIFIER_BY_CODE = Object.freeze({
    ControlLeft: "ctrlKey",
    ControlRight: "ctrlKey",
    ShiftLeft: "shiftKey",
    ShiftRight: "shiftKey",
    AltLeft: "altKey",
    AltRight: "altKey",
    MetaLeft: "metaKey",
    MetaRight: "metaKey"
  });

  function createState() {
    return { heldPointers: new Map(), heldButtons: new Map() };
  }

  function pressModifier(state, code, pointerId) {
    const modifier = MODIFIER_BY_CODE[code] || null;
    if (!state || !state.heldPointers || !modifier) return false;
    state.heldPointers.set(pointerId, modifier);
    return true;
  }

  function releasePointer(state, pointerId) {
    if (!state) return false;
    const releasedModifier = Boolean(state.heldPointers && state.heldPointers.delete(pointerId));
    const releasedButton = Boolean(state.heldButtons && state.heldButtons.delete(pointerId));
    return releasedModifier || releasedButton;
  }

  function clear(state) {
    if (state && state.heldPointers) state.heldPointers.clear();
    if (state && state.heldButtons) state.heldButtons.clear();
  }

  function pressButton(state, button, pointerId) {
    const normalizedButton = Number(button);
    if (!state || !state.heldButtons || ![0, 1, 2].includes(normalizedButton)) return false;
    state.heldButtons.set(pointerId, normalizedButton);
    return true;
  }

  function heldButton(state) {
    if (!state || !state.heldButtons) return null;
    let button = null;
    for (const held of state.heldButtons.values()) button = held;
    return button;
  }

  function heldModifiers(state) {
    const held = {
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false
    };
    if (!state || !state.heldPointers) return held;
    for (const modifier of state.heldPointers.values()) held[modifier] = true;
    return held;
  }

  function mergePointerEvent(eventInput, state) {
    const event = eventInput || {};
    const held = heldModifiers(state);
    const virtualButton = heldButton(state);
    return {
      button: virtualButton === null ? (Number.isFinite(event.button) ? event.button : 0) : virtualButton,
      detail: Number.isFinite(event.detail) ? event.detail : 1,
      ctrlKey: Boolean(event.ctrlKey || held.ctrlKey),
      shiftKey: Boolean(event.shiftKey || held.shiftKey),
      altKey: Boolean(event.altKey || held.altKey),
      metaKey: Boolean(event.metaKey || held.metaKey)
    };
  }

  function classifyTouchRelease(input) {
    const gesture = input || {};
    if (gesture.cancelled) return null;
    const heldLongEnough = Number(gesture.durationMs) >= 480;
    const stayedStationary = Number(gesture.movementPx) <= 10;
    return heldLongEnough && stayedStationary ? 2 : 0;
  }

  global.SpatialMobileInputModel = Object.freeze({
    createState,
    pressModifier,
    pressButton,
    releasePointer,
    clear,
    heldModifiers,
    mergePointerEvent,
    classifyTouchRelease
  });
})(typeof window !== "undefined" ? window : globalThis);
