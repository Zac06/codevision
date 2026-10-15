const { Plugin, PluginSettingTab, Setting, Modal, FuzzySuggestModal, Notice, Platform, requestUrl } = require("obsidian");

const API = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULTS = { apiKey: "", model: "gemini-3.8-flash" };
const MAX_SIDE = 1600; // longest image side sent to the model; text stays legible, tokens stay low

const PROMPT = [
  "Transcribe the code in this slide screenshot exactly.",
  '- Detect the programming language and return its markdown fence name in lowercase (java, cpp, python, ...). Return "text" if it is program output or not code.',
  "- Keep every character, line break and indentation as shown. Do not fix, rename or complete anything.",
  "- Text drawn in red is an annotation. Write it as a comment in the language's own comment syntax, on the same line when it sits beside code, otherwise on its own line. Leave it unchanged if it already starts with a comment marker, or if the language is \"text\".",
].join("\n");
const AS_JSON = "\n- Return only the JSON fields, no explanations.";
const AS_FENCE = "\n- Reply with exactly one markdown fenced code block: the fence name is the language, the content is the code. No explanations.";

// ponytail: the fence grows if the code itself contains ```
function toFence(language, code) {
  const lang = String(language || "").toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  let fence = "```";
  while (code.includes(fence)) fence += "`";
  return `${fence}${lang}\n${code.replace(/\s+$/, "")}\n${fence}\n`;
}

const json = (res) => { try { return res.json; } catch { return {}; } };

// Accepts "gemma-4-31b-it" or "models/gemma-4-31b-it"; rejects empty values and display names like "Gemma 4 31B".
function modelId(model) {
  const id = String(model || "").trim().replace(/^models\//, "");
  if (!id) throw new Error("No model set. Pick one in the plugin settings.");
  if (/\s/.test(id)) throw new Error(`"${id}" looks like a display name, not a model ID. Use Browse models in settings.`);
  return id;
}

// Gemma answers in a fence instead of JSON; take everything between the first and last fence.
function parseFence(text) {
  const m = text.match(/```+([^\n`]*)\n([\s\S]*)\n```+/);
  return m ? { language: m[1].trim(), code: m[2] } : null;
}

function explain(status, body) {
  const msg = body?.error?.message || "";
  if (status === 429) return "Free quota reached. Wait a minute or pick a lighter model in settings, then paste again.";
  if (status === 404) return 'Model not found. Pick one with "Browse models" in settings.';
  if (status === 400 || status === 403) return `Google rejected the request: ${msg || status}. Check the API key and model in settings.`;
  return `Request failed (${status}). ${msg}`.trim();
}

async function prepare(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/png");
  return { dataUrl, b64: dataUrl.split(",")[1] };
}

async function transcribe({ apiKey, model }, b64) {
  const id = modelId(model);
  // ponytail: Gemma has no JSON mode on this API, so it replies in a fence and we parse that
  const useJson = !id.startsWith("gemma");
  const res = await requestUrl({
    url: `${API}/models/${encodeURIComponent(id)}:generateContent`,
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT + (useJson ? AS_JSON : AS_FENCE) }, { inline_data: { mime_type: "image/png", data: b64 } }] }],
      ...(useJson && {
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { language: { type: "STRING" }, code: { type: "STRING" } },
            required: ["language", "code"],
          },
        },
      }),
    }),
    throw: false,
  });
  const body = json(res);
  if (res.status !== 200) throw new Error(explain(res.status, body));
  const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  let out = null;
  if (useJson) { try { out = JSON.parse(text); } catch {} } else out = parseFence(text);
  if (!out) throw new Error("The model did not return usable text. Paste again or try another model.");
  if (typeof out.code !== "string" || !out.code.trim()) throw new Error("No code found in the image.");
  return out;
}

class CodeVisionModal extends Modal {
  constructor(app, plugin, editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.busy = false;
  }

  onOpen() {
    this.modalEl.addClass("cv-modal");
    this.titleEl.setText("Paste a screenshot");
    this.zone = this.contentEl.createDiv({ cls: "cv-zone", attr: { tabindex: "0" } });
    this.hint();
    this.status = this.contentEl.createDiv({ cls: "cv-status", attr: { "aria-live": "polite" } });
    this.setStatus(`Waiting for an image. Model: ${this.plugin.settings.model}.`);

    this.onPaste = (e) => this.take(e.clipboardData?.files, e);
    document.addEventListener("paste", this.onPaste);
    this.zone.addEventListener("dragover", (e) => { e.preventDefault(); this.zone.addClass("is-over"); });
    this.zone.addEventListener("dragleave", () => this.zone.removeClass("is-over"));
    this.zone.addEventListener("drop", (e) => { e.preventDefault(); this.zone.removeClass("is-over"); this.take(e.dataTransfer?.files, e); });
    this.zone.focus();
  }

  onClose() {
    document.removeEventListener("paste", this.onPaste);
    this.contentEl.empty();
  }

  hint() {
    this.zone.empty();
    const h = this.zone.createDiv({ cls: "cv-hint" });
    const keys = h.createDiv({ cls: "cv-keys" });
    keys.createEl("kbd", { text: Platform.isMacOS ? "Cmd" : "Ctrl" });
    keys.createEl("kbd", { text: "V" });
    h.createDiv({ cls: "cv-sub", text: "or drop an image here" });
  }

  show(dataUrl) {
    this.zone.empty();
    const shot = this.zone.createDiv({ cls: "cv-shot" });
    shot.createEl("img", { attr: { src: dataUrl, alt: "Pasted screenshot" } });
    shot.createDiv({ cls: "cv-scan" });
    this.zone.addClass("is-scanning");
  }

  setStatus(text, isError = false) {
    this.status.setText(text);
    this.status.toggleClass("is-error", isError);
  }

  take(files, e) {
    const img = Array.from(files ?? []).find((f) => f.type.startsWith("image/"));
    if (!img) return;
    e.preventDefault();
    this.run(img);
  }

  async run(blob) {
    if (this.busy) return;
    this.busy = true;
    try {
      const { dataUrl, b64 } = await prepare(blob);
      this.show(dataUrl);
      this.setStatus(`Reading the code with ${this.plugin.settings.model}…`);
      const { language, code } = await transcribe(this.plugin.settings, b64);
      this.editor.replaceSelection(toFence(language, code));
      this.close();
      this.editor.focus();
    } catch (e) {
      this.zone.removeClass("is-scanning");
      this.setStatus(e.message || String(e), true);
    } finally {
      this.busy = false;
    }
  }
}

class ModelPicker extends FuzzySuggestModal {
  constructor(app, models, onPick) {
    super(app);
    this.models = models;
    this.onPick = onPick;
    this.setPlaceholder("Search models");
  }
  getItems() { return this.models; }
  getItemText(m) { return m; }
  onChooseItem(m) { this.onPick(m); }
}

class CodeVisionSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveData(s);
    containerEl.empty();

    new Setting(containerEl)
      .setName("Gemini API key")
      .setDesc("Create one in Google AI Studio. It is saved as plain text in this plugin's data.json, so keep that file out of any synced or public repository.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("AIza...").setValue(s.apiKey).onChange(async (v) => { s.apiKey = v.trim(); await save(); });
      });

    let modelText;
    new Setting(containerEl)
      .setName("Model")
      .setDesc("Any Gemini model ID that accepts images. Browse lists the ones your key can use.")
      .addText((t) => {
        modelText = t;
        t.setValue(s.model).onChange(async (v) => { s.model = v.trim(); await save(); });
      })
      .addButton((b) => b.setButtonText("Browse models").onClick(async () => {
        if (!s.apiKey) return new Notice("Add your API key first.");
        try {
          const res = await requestUrl({ url: `${API}/models?pageSize=200`, headers: { "x-goog-api-key": s.apiKey }, throw: false });
          const body = json(res);
          if (res.status !== 200) return new Notice(explain(res.status, body));
          const ids = (body.models ?? [])
            .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
            .map((m) => m.name.replace("models/", ""))
            .filter((id) => /^(gemini|gemma)/.test(id) && !/tts|image|embed|live|audio|robotics/.test(id));
          new ModelPicker(this.app, ids, async (id) => { s.model = id; modelText.setValue(id); await save(); }).open();
        } catch (e) {
          new Notice(`Could not load models: ${e.message || e}`);
        }
      }));
  }
}

module.exports = class CodeVision extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new CodeVisionSettings(this.app, this));
    this.addCommand({
      id: "paste-screenshot",
      name: "Paste screenshot as code block", // the palette shows it as "CodeVision: Paste screenshot as code block"
      editorCallback: (editor) => {
        if (!this.settings.apiKey) return new Notice("CodeVision: add your Gemini API key in the plugin settings first.");
        new CodeVisionModal(this.app, this, editor).open();
      },
    });
  }
};

Object.assign(module.exports, { toFence, parseFence, modelId });
