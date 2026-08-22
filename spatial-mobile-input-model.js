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
    return { heldPointers: new Map() };
  }

  function pressModifier(state, code, pointerId) {
    const modifier = MODIFIER_BY_CODE[code] || null;
    if (!state || !state.heldPointers || !modifier) return false;
    state.heldPointers.set(pointerId, modifier);
    return true;
  }

  function releasePointer(state, pointerId) {
    return Boolean(state && state.heldPointers && state.heldPointers.delete(pointerId));
  }

  function clear(state) {
    if (state && state.heldPointers) state.heldPointers.clear();
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
    return {
      button: Number.isFinite(event.button) ? event.button : 0,
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
    releasePointer,
    clear,
    heldModifiers,
    mergePointerEvent,
    classifyTouchRelease
  });
})(typeof window !== "undefined" ? window : globalThis);
