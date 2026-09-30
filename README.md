# pi-ask-user-cz

`ask_user_question` for [Pi](https://pi.dev/), with the questionnaire in **Czech** and the
model still speaking **English**.

Fork of [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
v2.11.0. Same tool, same dialog, same keyboard model, same answer envelope — one change in where
the language is decided.

```
model authors   English  ──────────────────────────────►  model reads back
                     │                                        English
                     ▼                                        ▲
              translate at render time ──► Czech dialog ──► answer restore
              (pi-prompt-translate-czk)      (TUI + chrome)     (label → original)
```

## Why

Two separate things were wrong, and they need two different fixes:

1. **The chrome could not be Czech.** Upstream localises through `@juicesharp/rpiv-i18n`, whose
   `SUPPORTED_LOCALES` constant gates both the `/languages` picker and which `locales/*.json` files
   are read. It ships nine languages and Czech is not one of them, so dropping a `cs.json` into the
   package is silently ignored. This fork resolves Czech itself (`state/i18n-bridge.ts`).
2. **Asking the model to write Czech is the wrong fix.** It changes model behaviour, it makes the
   tool description and the answer envelope Czech too, and it leaks into every other surface.
   Here the model keeps its English and only the pixels change.

## Install

```sh
pi install git:github.com/mastnacek/pi-ask-user-cz
```

This package is installed from GitHub, never from a local path. Pi clones and reconciles the
checkout, so the running code is the committed code — edit
`D:\01_programovani\pi\plugins\pi-ask-user-cz`, push, then `pi update` (or reinstall) to ship it.
Local-path installs are deliberately *not* used for it: they load whatever is on disk, which makes
"what am I actually running" answerable only by guessing.

`cim-budu` (which shipped a `career_interactive_question` tool as a side effect) is disabled in the
same settings, so the two menus cannot collide.

## Configuration

Optional, at `~/.config/pi-ask-user-cz/config.json` (`$XDG_CONFIG_HOME` wins if set):

```json
{
  "collapseKey": "alt+o",
  "guidance": { "promptSnippet": "Ask the user when a decision blocks progress" }
}
```

Same shape as upstream, different namespace — an upstream `rpiv-ask-user-question` config on the
same machine is left alone. `guidance` is the only place model-facing text can be changed, and it
stays English by default.

## How the translation happens

The fork owns no translator. It calls `pi-prompt-translate-czk`'s own `translate(..., "tool")`,
whose contract is already exactly what is needed — literal, marker-delimited, no commentary, code
and paths untouched — and reuses that plugin's `formatBlocks` / `parseBlocks` rather than
reimplementing the marker protocol. The imported module is the same resolved file the running
extension uses, so this is the user's live config: the same target language, the same model, the
same cost accounting, and the same `enabled` kill switch.

What is translated: `question`, `header`, `options[].label`, `options[].description`.

What is not, on purpose:

| Left alone | Why |
| --- | --- |
| `options[].preview` | It is an artifact — ASCII mockup, code, config, diagram. Translating it is the one place a literal translation actively corrupts meaning. |
| tool description, prompt snippet, guidelines | Prompt inputs, not UI. Czech there would change model behaviour. |
| the user's free text, notes, global note | The user typing Czech at the model is their own words. |
| `multiSelect` | Structural. |

Every skip is **visible**: a missing plugin, a disabled plugin, a model failure or a marker-contract
breach produces one `warning` notification naming the reason, and an English dialog. There is no
path where the questionnaire comes up half-translated or silently English.

## Tests

```sh
npm test          # 9 assertions, node --test, no model call
node scripts/rpc-smoke.mjs --model openrouter/google/gemini-3.5-flash-lite
```

Run both from the development tree (`D:\01_programovani\pi\plugins\pi-ask-user-cz`), not from Pi's
git checkout. `npm test` needs no install; the runner bundles with the esbuild hoisted in the parent
`pi/plugins` workspace, so the package itself carries no dev dependencies.

`npm test` covers the two pure functions that can silently corrupt an answer: the marker
round-trip and the Czech → English label restore. The runner bundles with the workspace's hoisted
esbuild, so it needs no vitest and no install step.

`rpc-smoke.mjs` drives a real Pi subprocess over RPC with the tool allowlisted, and asserts the
three records that matter: the arguments the model wrote (English), the options the user is shown
(Czech), and the envelope the model gets back (English).

## Known limitations

What is **verified**, and how:

| Path | Evidence |
| --- | --- |
| Chrome in Czech (live TUI) | Dialog rendered `Napište vlastní.`, Czech title, Czech option labels. |
| Content translated (live TUI + RPC) | Question, header, labels and descriptions arrive in Czech; a real `translate(..., "tool")` call, marker contract honoured. |
| Answer restore (live TUI, multi-select) | Clicking a Czech option returned the exact English label: `"What should happen to the cim-budu extension, which is disabled right now?"="Leave it disabled"`. |
| Answer restore (RPC, single-select) | `"Which Python web framework should we use?"="Django"`. |
| Failures degrade loudly | A skipped translation raises one `warning` naming the reason; it never fails silently and never renders half-translated. |
| Pure logic | 9 assertions: marker round-trip, preview pass-through, header width fallback, user's own text untouched, unknown label passed through, cancelled result, marker breach rejected wholesale. |

What is **not** verified, honestly:

- **The custom free-text row, per-question notes, the global note and Esc-cancellation were never
  exercised in the TUI.** The code paths are upstream's and the unit tests cover the restore, but no
  run has actually typed into them.
- **The preview pane has never rendered.** The unit test proves `preview` is left byte-identical, not
  that a preview pane draws correctly next to a Czech option list. Note previews are single-select
  only, and both live tests so far were either single-select without a preview or multi-select.
- **Multi-question dialogs, the tab bar and the Submit tab have never rendered** — every live test
  was a single question.
- **The header-width fallback never triggered live** (headers were `Framework` and `cim-budu`, both
  inside the 16-character chip). Only the unit test covers it.
- **Translation quality is not asserted.** The smoke test checks that nothing Czech comes back, not
  that the Czech is good. A different translator model may legitimately breach the marker contract
  and fall back to English by design.
- **Only one agent model and one translator model** were used
  (`openrouter/google/gemini-3.5-flash-lite` for both, plus `gemini-3.5-flash-lite` in one earlier
  run).
- Upstream's own test suite was not ported; only the fork's new logic is covered here.

## Upstream and licence

Forked from [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono) v2.11.0
by juicesharp, MIT — `LICENSE` is theirs and covers the inherited files unchanged. The fork changes
(`translate-*.ts`, `config-support.ts`, `session-factory.ts`, `prompt-events.ts`,
`tool/prompt-copy.ts`, `state/i18n-bridge.ts`, `locales/cs.json`, and the wiring in
`ask-user-question.ts`) are MIT © mastnacek. Upstream doc comments are preserved where behaviour is
unchanged, so the diff against v2.11.0 stays readable.

No behavioural changes were made to the questionnaire itself: validation, the marker rows, the
preview layout, the tab bar, multi-select, notes, the collapse key and the answer envelope are
upstream's code.
