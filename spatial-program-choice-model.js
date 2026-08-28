(function spatialProgramChoiceModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpatialProgramChoiceModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createSpatialProgramChoiceModel() {
  "use strict";

  function callRanges(source) {
    const text = String(source || "");
    const ranges = [];
    const matcher = /\bchoice\s*\(/g;
    let match;
    while ((match = matcher.exec(text))) {
      let cursor = matcher.lastIndex;
      while (/\s/.test(text[cursor] || "")) cursor += 1;
      if (text[cursor] !== "{") continue;
      const start = cursor;
      let depth = 0;
      let quote = "";
      let escaped = false;
      for (; cursor < text.length; cursor += 1) {
        const character = text[cursor];
        if (quote) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === "{") depth += 1;
        if (character !== "}") continue;
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start, end: cursor + 1, json: text.slice(start, cursor + 1) });
          matcher.lastIndex = cursor + 1;
          break;
        }
      }
    }
    return ranges;
  }

  function normalize(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
    const id = String(spec.id || "").trim();
    const options = Array.isArray(spec.options)
      ? spec.options.map((option) => ({
        id: String(option && option.id || "").trim(),
        label: String(option && option.label || "").trim()
      }))
      : [];
    const selected = Array.isArray(spec.selected)
      ? spec.selected.map((value) => String(value))
      : [];
    if (!id || options.length === 0 || options.some((option) => !option.id || !option.label)) return null;
    if (new Set(options.map((option) => option.id)).size !== options.length) return null;
    if (selected.some((value) => !options.some((option) => option.id === value))) return null;
    return { id, options, selected, empty: String(spec.empty || "未选择") };
  }

  function parsedEntries(source) {
    return callRanges(source).flatMap((range) => {
      try {
        const raw = JSON.parse(range.json);
        const control = normalize(raw);
        return control ? [{ range, raw, control }] : [];
      } catch (_error) {
        return [];
      }
    });
  }

  function parse(source) {
    return parsedEntries(source).map((entry) => entry.control);
  }

  function toggle(source, controlId, optionId) {
    const text = String(source || "");
    const entry = parsedEntries(text).find((candidate) => candidate.control.id === controlId);
    if (!entry) throw new Error("CHOICE_NOT_FOUND");
    if (!entry.control.options.some((option) => option.id === optionId)) {
      throw new Error("CHOICE_OPTION_NOT_FOUND");
    }
    const selected = entry.control.selected.includes(optionId)
      ? entry.control.selected.filter((value) => value !== optionId)
      : [...entry.control.selected, optionId];
    const replacement = JSON.stringify({ ...entry.raw, selected });
    return {
      source: `${text.slice(0, entry.range.start)}${replacement}${text.slice(entry.range.end)}`,
      selected
    };
  }

  return Object.freeze({ parse, toggle });
});
