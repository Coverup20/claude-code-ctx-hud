// The mod's state contract. Every $.state key the hooks module names must be
// declared here, or `claude plugin validate` refuses the module.

/**
 * What the HUD draws. Numbers only: no prompt text, no tool arguments, no
 * file paths. Rebuilt from the figures the engine pushes at `session.measure`
 * and from $.session.model(); the agent count moves on its own events.
 */
export type Hud = {
  /** Context window fill, 0-100, as the status line reports it. */
  percent: number
  /** Input tokens the last response was answered over. */
  tokens: number
  /** The context window of the session's model, in tokens. */
  window: number
  /** The main loop's model, as /model shows it. */
  model: string
  /** How many of this session's agents have not ended. A count, nothing else. */
  agents: number
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-hud': { hud: Shaped<Hud | null> }
  }
}
