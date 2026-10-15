# CodeVision

An Obsidian plugin that turns a screenshot of code into a fenced code block. Paste an image, and CodeVision sends it to the Gemini API, detects the programming language and inserts the block at your cursor.

Made for notes taken from lecture slides, where the code is an image and can't be copied.

## What it does

- Reads the code from a pasted or dropped screenshot, keeping line breaks and indentation.
- Detects the language and uses it as the fence name (`java`, `cpp`, `python`, ...). Program output gets a plain `text` block.
- Turns text drawn in red into a comment in the detected language, so slide annotations end up in the code.

## Install

**With BRAT:** install the BRAT plugin, choose *Add beta plugin* and paste this repository's URL.

**Manually:** download `codevision.zip` from the latest release and extract it into `<your vault>/.obsidian/plugins/`. The zip already contains the `code-vision` folder, so you end up with `.obsidian/plugins/code-vision/main.js`. (`.obsidian` is a hidden folder.) Then reload the plugin list and enable *CodeVision* under Settings → Community plugins.

## Set up

1. Create a free API key in [Google AI Studio](https://aistudio.google.com/).
2. Open Settings → CodeVision and paste the key.
3. Choose a model. *Browse models* lists the ones your key can use. A Flash-Lite model is fast and works well for clean slides.

## Use

1. Put the cursor where the code should go.
2. Run **CodeVision: Paste screenshot as code block** from the command palette (`Ctrl/Cmd+P`). You can also assign a hotkey, or type `/codevision` if the core *Slash commands* plugin is enabled.
3. Paste a screenshot with `Ctrl/Cmd+V`, or drop an image into the window.
4. The block is inserted when the model has finished reading.

## Privacy

- Your screenshots are sent to Google's Gemini API. On the free tier, Google may use inputs to improve its models, so check their terms before sending anything private.
- The API key is stored as **plain text** in this plugin's `data.json`. Don't sync or commit that file to a public repository.

## Troubleshooting

| Message | What to do |
|---|---|
| Free quota reached (429) | Wait a minute, or choose a lighter model or a fallback. |
| Google is busy or failed (500/503) | Paste again, or set a fallback model. |
| Looks like a display name, not a model ID | Use *Browse models* instead of typing the name. |
| Google rejected the request | Check the API key and the model in settings. |

Models whose ID starts with `gemma` are supported too. They don't have JSON mode, so the plugin asks them for a fenced block instead. Accuracy depends on the model, so always check the result against the slide.

## License

MIT
