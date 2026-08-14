import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js", "jsx"],
    support: javascript({ jsx: true })
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["typescript", "ts", "tsx"],
    support: javascript({ typescript: true, jsx: true })
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["python", "py"],
    support: python()
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    support: json()
  })
];

const markdownRenderer = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false
});

function sanitizeRenderedMarkdown(markdownText) {
  const unsafeHtml = markdownRenderer.render(String(markdownText || ""));
  const DOMPurify = createDOMPurify(window);
  return DOMPurify.sanitize(unsafeHtml, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"]
  });
}

function toPlainText(markdownText) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeRenderedMarkdown(markdownText);
  return (container.textContent || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function insertLineBreak(view) {
  const changes = view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: "\n" },
    range: EditorSelection.cursor(range.from + 1)
  }));
  view.dispatch(changes);
  return true;
}

function isShiftEnterLineBreak(event) {
  const enter = event.key === "Enter" || event.code === "Enter" || event.keyCode === 13;
  const shifted = event.shiftKey === true
    || (typeof event.getModifierState === "function" && event.getModifierState("Shift"));
  return enter && shifted;
}

function create(options = {}) {
  const textarea = options.textarea;
  const mount = options.mount;
  const preview = options.preview;
  const toggle = options.toggle;
  if (!textarea || !mount || !preview || !toggle) return null;

  let previewMode = false;
  const onSubmit = typeof options.onSubmit === "function" ? options.onSubmit : () => {};
  const onCancel = typeof options.onCancel === "function" ? options.onCancel : () => {};
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  const view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: textarea.value || "",
      extensions: [
        basicSetup,
        markdown({
          base: markdownLanguage,
          codeLanguages
        }),
        EditorView.lineWrapping,
        Prec.highest(keymap.of([
          {
            key: "Shift-Enter",
            run(editorView) {
              return insertLineBreak(editorView);
            }
          },
          {
            key: "Enter",
            run() {
              onSubmit();
              return true;
            }
          },
          {
            key: "Escape",
            run() {
              onCancel();
              return true;
            }
          }
        ])),
        Prec.highest(EditorView.domEventHandlers({
          keydown(event, editorView) {
            if (isShiftEnterLineBreak(event)) {
              event.preventDefault();
              event.stopPropagation();
              return insertLineBreak(editorView);
            }
            return false;
          }
        })),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const value = update.state.doc.toString();
          textarea.value = value;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          onChange(value);
          if (previewMode) preview.innerHTML = sanitizeRenderedMarkdown(value);
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            color: "var(--color-ink-2)",
            backgroundColor: "transparent"
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono)"
          },
          ".cm-content": {
            padding: "0.35rem 0.25rem",
            caretColor: "var(--color-update)"
          },
          ".cm-gutters": {
            display: "none"
          },
          ".cm-activeLine": {
            backgroundColor: "color-mix(in oklch, var(--color-update) 7%, transparent)"
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "color-mix(in oklch, var(--color-update) 22%, transparent)"
          },
          "&.cm-focused": {
            outline: "none"
          }
        })
      ]
    })
  });

  textarea.classList.add("is-cm6-fallback");
  const captureShiftEnter = (event) => {
    if (!isShiftEnterLineBreak(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    insertLineBreak(view);
  };
  view.contentDOM.addEventListener("keydown", captureShiftEnter, { capture: true });

  function setPreviewMode(nextMode) {
    previewMode = nextMode === true;
    mount.hidden = previewMode;
    preview.hidden = !previewMode;
    toggle.textContent = previewMode ? "编辑" : "预览";
    toggle.setAttribute("aria-pressed", String(previewMode));
    if (previewMode) {
      preview.innerHTML = sanitizeRenderedMarkdown(view.state.doc.toString());
    } else {
      view.focus();
    }
  }

  toggle.addEventListener("click", () => setPreviewMode(!previewMode));

  return Object.freeze({
    getValue() {
      return view.state.doc.toString();
    },
    setValue(value) {
      const nextValue = String(value || "");
      if (nextValue === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextValue }
      });
    },
    focus(selectAll = false) {
      if (previewMode) setPreviewMode(false);
      if (selectAll) {
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length }
        });
      }
      view.focus();
    },
    resetMode() {
      setPreviewMode(false);
    },
    renderPreview() {
      preview.innerHTML = sanitizeRenderedMarkdown(view.state.doc.toString());
    },
    renderMarkdown(markdownText) {
      return sanitizeRenderedMarkdown(markdownText);
    },
    insertLineBreak() {
      return insertLineBreak(view);
    },
    toPlainText,
    destroy() {
      view.contentDOM.removeEventListener("keydown", captureShiftEnter, { capture: true });
      view.destroy();
      textarea.classList.remove("is-cm6-fallback");
    }
  });
}

window.SpatialMarkdownEditor = Object.freeze({
  create,
  renderMarkdown: sanitizeRenderedMarkdown,
  toPlainText
});
