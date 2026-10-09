# Skills in the native CLI workflow

Checked against current provider documentation on 2026-10-08. The native Codex runtime preserves the CLI's own skill discovery; ORC does not install skills. The example manifest below is a proposed ORC bootstrap format; the app does not read it yet.

ORC should associate a workspace and agent profile with existing skill directories, then let the selected CLI discover and execute the original `SKILL.md` and its supporting resources. A profile is configuration, not a running agent. Creating a profile must not start a process or draw an occupied seat.

## Native configuration available today

| CLI | Project skill location | Discovery and invocation |
| --- | --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md` | Also discovers `~/.agents/skills`; invoke with `$skill-name` or select through `/skills`. Symlinked skill folders are supported. |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Also discovers `~/.claude/skills`; invoke `/skill-name`. Plugin skills retain their namespace, such as `/plugin-name:skill-name`. |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md` | Use `/skills list` to inspect discovery and `/skills reload` to refresh. The model activates a matching skill through its native tool and preserves the CLI consent prompt. |
| Antigravity CLI (`agy`, the user's Gemini tool) | Provider-native skills and plugin components; current docs describe staged plugins under `~/.gemini/antigravity-cli/plugins/` | Native `/skills` browses local and global workflows. This is a different executable and lifecycle from Google's `gemini` CLI; the local TUI trust gate prevented live menu verification. |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | Also discovers `.agents/skills` and `.claude/skills`; the agent loads content through its native `skill` tool. |

Sources: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), [Gemini CLI skills](https://geminicli.com/docs/cli/skills/), [OpenCode skills](https://opencode.ai/docs/skills/).

The user clarified that their Gemini provider is **`agy` (Antigravity CLI)**. The Gemini CLI row is a general comparison, not the executable to use for this installation. [Current Antigravity CLI features](https://antigravity.google/docs/cli/features.md) document its `/skills` browser. Actual local results are recorded in the [compatibility audit](cli-skills-compatibility.md).

There is no universal native `config.json` for all four CLIs. Codex uses `~/.codex/config.toml`; its `[[skills.config]]` entries enable or disable discovered skills, rather than registering an arbitrary search root. Claude's `settings.json` `permissions.additionalDirectories` grants file access but does not load skills; an external directory passed through `--add-dir` loads its `.claude/skills`. See [Codex configuration](https://learn.chatgpt.com/docs/build-skills) and [Claude additional directories](https://code.claude.com/docs/en/skills#load-skills-from-a-directory-outside-the-project).

OpenCode supports custom search roots through `skills.paths` in its native `opencode.json`, as implemented in the [provider's discovery source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/skill/index.ts):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": {
    "paths": ["./company-skills"]
  }
}
```

Keep existing provider settings when adding this section. This example does not change tool or skill approval rules. A skill's provider-specific extensions still need compatibility review; copying identical folders does not guarantee identical behavior across providers.

## Proposed ORC manifest

[orc.config.example.json](../examples/orc.config.example.json) describes one workspace and reusable agent profiles. Paths refer to the server that will run the repo and CLI. Skill names must match actual files discovered by that provider. The supervisor can use these profile bindings when choosing an agent; native discovery must confirm availability before ORC marks a skill as available.

In the later runtime phase, a validated importer can save the configuration in PostgreSQL, scoped to the workspace. The database remains the source of persisted state. Importing must not launch sessions, copy credentials, overwrite native CLI settings, or bypass confirmation prompts. Each launch will preserve the provider's terminal, tool calls and native skill invocation syntax. The web terminal will forward that input to the actual CLI rather than interpreting a separate invented skill command.

Until that importer exists, editing this manifest has no effect on the application. Configured, discovered and activated skills must remain separate states in the eventual UI. Other CLI providers are documented here for planning; they are not connected to the current native Codex runtime.
