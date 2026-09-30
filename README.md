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

Honest list of what is **not** proven, because the RPC harness cannot reach it:

- **The TUI overlay path is unverified.** In RPC mode `ctx.ui.custom()` returns `undefined`, so the
  run takes the `rpc-fallback` `ui.select` path. The Czech strings are the same object the overlay
  would render, but `QuestionnaireSession` and its ~5.4k-line render graph never executed under
  test. This is the surface a human actually looks at.
- **Multi-select, custom free text, notes, cancellation, previews and multi-question tab bars were
  not exercised** — only single-select with two options. The `selected[]` restore, the header
  width fallback and the preview pass-through are covered by unit tests only.
- **Translation quality is not asserted.** The smoke test checks that nothing Czech comes back, not
  that the Czech is good. A different translator model may legitimately breach the marker contract
  and fall back to English by design.
- **One resolver path.** The translate plugin is looked up only in its Pi-installed checkout,
  `~/.pi/agent/git/github.com/mastnacek/pi-prompt-translate-czk`. The development tree next to this
  package is deliberately *not* a candidate: if the installed checkout went missing, running against
  unreleased source would be worse than degrading to English.
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
