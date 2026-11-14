# AG-UI Studio v0.1 — Known Limitations

Status: **frozen snapshot** after three fix rounds following the dual code review.
The P0 findings are fixed; everything below is a deliberate, documented limitation for v0.1.

## What works today

- **Any AG-UI HTTP service**: `POST RunAgentInput -> text/event-stream`, configured via `?agui=<url>` or the backend menu. No bridge or custom fields required.
- Multi-turn runs keep the transcript and `sharedState`; resume keeps the interrupt cards and sends the interrupted thread's messages/state.
- Streaming `TEXT_MESSAGE_*`, `REASONING_*`, `TOOL_CALL_*`, `STATE_SNAPSHOT/DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*`, `CUSTOM`, `RAW`, steps, subagents and interrupts all reduce into the shared view model.
- Five skins (aurora / paper / terminal / brutalist / classic) tolerate arbitrary tool results, activity content and scalar/array state without crashing.
- Long streams: 200-row inspector tail, 16 ms notification batching, 2000-event log cap, snapshot de-duplication.
- `tsc --noEmit` is part of CI; 379 tests across 29 files.

## Known limitations (v0.1)

### Human-in-the-loop
- Resume payload is the generic wrapper `{ approved, editedArgs }`. An interrupt whose `responseSchema` requires a different answer shape cannot be satisfied from the UI. This is the main protocol-level gap left.
- Expired interrupts are only detected when the user acts; there is no countdown/disabled state before that, and an expired interrupt is submitted as a cancelled resume.
- No multi-step approval workflow UI (approve one, then continue editing in a separate step).

### Session / replay semantics
- `replay()` still means "clear the thread" for real backends; "retry", "replay" and "new thread" are not separate actions yet.
- Thread continuity is per page session; there is no reconnect UI that offers to resume a suspended run after reload (although `MESSAGES_SNAPSHOT` no longer destroys pending interrupts).
- `?agent=` remains the white-label branding parameter; the AG-UI endpoint is `?agui=`.

### Protocol rendering
- AG-UI has no `SUBAGENT_*` event; subagent activity appears as `task` tool calls and state. The skins do not invent subagent cards from arbitrary state.
- Unknown `CUSTOM` names are inspector/debug-only by default; only `handoff`/`artifact` are rendered inline.
- Specialized tool views (sources, reservation) rely on the old demo payload shape; other payloads fall back to generic text/JSON.
- `ACTIVITY_DELTA` patches the plan entry rather than an authoritative activity `content` object; `replace:false` is not honored.
- `RUN_FINISHED(cancelled)` maps to stopped; usage is only read from terminal `usage` arrays, and token display shows `—` when unknown.

### Performance
- Transcript and inspector use **tail windows**, not true virtualization. Extremely large threads are bounded but not constant-time.
- The store keeps up to 2000 logged events; older events are dropped (the inspector count reflects the window, not the full historical run).
- Full state snapshots (deep agents) are still sent whole in `RunAgentInput`; there is no projection/size cap.
- Notification batching is 16 ms for streaming runs; the first token may be slightly delayed.

### UI / chrome
- Aurora and Classic still contain demo theatre: fake thread list, hard-coded tool counts, demo model label.
- Some strings and empty states are visually tuned for the scripted demo rather than arbitrary agents.
- Paper stacks its margin rail on narrow screens, but other skins still hide secondary panels at tablet widths.
- No Storybook, visual-regression baseline or formal browser E2E suite.

### Hosting / integrations
- GitHub Pages hosts the static demo only; pi / deepseek / deep agent backends require the local bridge and LangGraph services.
- Direct browser connections need the service to allow CORS. Auth headers can be supplied through `agui.agent.headers` localStorage, but there is no settings UI for them.
- The npm package `agui-skins` is build/verified but not published to a registry.

## How to run the local integrations

```bash
# standard AG-UI reference endpoint
node server/agui-echo.mjs
# pi bridge / deepseek backend
node server/bridge.mjs
# native deep agent (Python)
cd server/deepagent && langgraph dev --no-browser --port 2024
# frontend
pnpm dev
```

Open `http://127.0.0.1:5178/?agui=http://127.0.0.1:5180/agui&autosend=1`.

## Known-future (not promised for v0.1)

Schema-driven resume, replay/newThread split, transcript `aria-live`, true virtualization, Storybook/visual regression, npm release.
