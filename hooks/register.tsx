// CTX HUD - the context-window reading on the line under the prompt.
//
// What this module reads: the context-window figures the engine pushes at
// `session.measure` (the same figures `$.session.usage()` answers, without its
// breakdown), the main loop's model name, and from `$.agent.list()` only the
// number of agents whose status is still live. It never reads an agent's
// description, prompt or output. No API request is made anywhere in this file.
//
// What this module deliberately does NOT hook: prompt.submit, tool.call,
// session.append, session.messages. It never sees prompt text, tool arguments,
// tool output or model replies. It calls neither $.fs, $.http nor $.process:
// it writes no file, opens no socket and starts no command.
//
// `claude plugin validate` prints the hooks and engine calls it makes, which
// is how to hold this comment to the code.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hud } from '../types'

// Bump the shape tag whenever Hud's fields change: a value stored by an older
// version then reads as absent instead of being read back wrong.
const hud = atom({ plugin: 'ctx-hud', key: 'hud' } as const, null, {
  shape: 'hud-2',
})

// The hint line never says how wide the body is: its props carry none, and
// `viewport.columns` measures the whole terminal, which overshoots whenever a
// pane is docked beside the prompt. So the bar counts no columns at all. It is
// two Boxes with no text and no width of their own, and the layout hands each
// a share of whatever the labels leave: full width wherever the row ends up.
//
// Swap these two for other ThemeKeys to recolour the bar.
const BAR_FILLED = 'success'
const BAR_TROUGH = 'inactive'

// What the bar keeps even where the labels would take the whole row.
const MIN_BAR = 8

// Statuses of an agent whose loop has not ended. `completed`, `failed` and
// `killed` are ended; a message may resume one, and then it counts again.
const LIVE = new Set(['pending', 'running', 'waiting'])

function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`

  return String(tokens)
}

// Counts the live agents of this session. Only the count leaves this
// function: no id, name or description is kept.
async function countLive($: EngineInterface): Promise<number> {
  const agents = await $.agent.list()

  return agents.filter(agent => LIVE.has(agent.status)).length
}

// Replaces the agent count of the stored reading, keeping the rest. Does
// nothing before the first reading, so the band stays away until there is one.
async function setAgents($: EngineInterface, agents: number): Promise<void> {
  await update($, hud, prev => (prev === null ? null : { ...prev, agents }))
}

export const register: Register = on => {
  // The engine measures the session after every main-thread turn and raises
  // this with the figures already on it: pushed, not polled, so there is no
  // timer and nothing to poll.
  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens

    // No reading yet: keep the HUD away rather than drawing a confident 0%.
    if (tokens === undefined) return next(e)

    const reading: Hud = {
      percent: Math.max(0, Math.min(100, Math.round(e.context.percent ?? 0))),
      tokens,
      window: e.context.window,
      // Read every time, so a /model switch shows at the next measurement.
      model: await $.session.model(),
      agents: await countLive($),
    }
    await update($, hud, () => reading)

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { changed: e.changed }))

  // A subagent starts, and a turn of any loop ends: the count moves on both.
  // A spawn's agent may not be listed yet at its own hook; the turn that
  // follows corrects it.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    await setAgents($, await countLive($))

    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'ctx-hud: agent count unavailable' }))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await setAgents($, await countLive($))

    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { text: e.text }))

  // The dim line under the prompt. The row is never yielded back: handing it
  // over left it blank, because the engine often has nothing to put there.
  // What it would have said is drawn here instead, beside the reading.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const now = await read($, hud)

    // Nothing measured yet: the row is the engine's, as it was before.
    if (now === null) return next(e)

    // What the engine would have said here (`esc to interrupt`), drawn rather
    // than yielded to: giving the row back left it blank, since what the
    // engine has to say is often nothing at all.
    // Typed as always there, but a missing one would throw and take the whole
    // row with it, and this hook has no net under it.
    const said = (e.props.hint ?? '').trim()
    const agents = now.agents > 0 ? ` · ${now.agents} agent` : ''
    // The leading space is the gap after whatever the engine put at the left
    // of the row: its own `·` separator, or `said` just below.
    const head = ` CTX ${now.percent}% `
    const tail =
      ` ${100 - now.percent}% free · ` +
      `${compact(now.tokens)}/${compact(now.window)} · ${now.model}${agents}`

    const { Box, Text } = $.ui.resolve(e)

    // The labels keep their size, the bar between them takes the rest; the two
    // shares are the reading itself, so the fill needs no arithmetic.
    return (
      <Box flexDirection="row" width="100%">
        {said ? (
          <Box flexShrink={0}>
            <Text dimColor>{said}</Text>
          </Box>
        ) : null}
        <Box flexShrink={0}>
          <Text>{head}</Text>
        </Box>
        <Box flexGrow={1} minWidth={MIN_BAR} height={1}>
          <Box
            width={0}
            flexGrow={now.percent}
            height={1}
            backgroundColor={BAR_FILLED}
          />
          <Box
            width={0}
            flexGrow={100 - now.percent}
            height={1}
            backgroundColor={BAR_TROUGH}
          />
        </Box>
        <Box flexShrink={0}>
          <Text>{tail}</Text>
        </Box>
      </Box>
    )
  })
}
