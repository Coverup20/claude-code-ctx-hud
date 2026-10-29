import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HINT = {
  plugin: 'ctx-hud',
  component: 'PromptHint',
  requestId: 'prompt-hint',
  props: {
    isDraft: false,
    isWorking: false,
    hint: '',
  },
  viewport: { columns: 100, rows: 40 },
} as const

// Nothing sits beneath the plugin in a test: these hooks stand for the engine,
// so `next(e)` has something to resolve to.
function engine(on: On, model: string, agents: readonly object[] = []) {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: model }))
  on('agent.list', () => ({ value: agents }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

function measurement(tokens: number | undefined, percent?: number) {
  return {
    context: { tokens, window: 1_000_000, percent },
    rateLimits: [],
    changed: ['context' as const],
  }
}

// The bar is the two Boxes that carry a background: the filled run first.
async function shares(ui: {
  findAll: (q: object) => Promise<readonly { props: Record<string, unknown> }[]>
}) {
  const boxes = await ui.findAll({ type: 'Box' })

  return boxes
    .filter(b => b.props.backgroundColor !== undefined)
    .map(b => ({
      color: b.props.backgroundColor,
      grow: b.props.flexGrow,
      width: b.props.width,
    }))
}

test('the labels read the fill, the counts and the model', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(341_000, 34.4))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /CTX/ }))?.text).toBe(' CTX 34% ')
  expect((await ui.find({ type: 'Text', text: /free/ }))?.text).toBe(
    ' 66% free · 341k/1.00M · deep-1m[1m]',
  )
  await ui.unmount()
})

test('the bar is two shares of the row, not a count of columns', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(341_000, 34.4))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  // Neither Box asks for a width, so the layout gives each its share of what
  // the labels leave: the row fills itself at whatever width it ends up.
  expect(await shares(ui)).toEqual([
    { color: 'success', grow: 34, width: 0 },
    { color: 'inactive', grow: 66, width: 0 },
  ])
  await ui.unmount()
})

test('an empty window leaves the fill no share at all', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(1_000, 0))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await shares(ui)).toEqual([
    { color: 'success', grow: 0, width: 0 },
    { color: 'inactive', grow: 100, width: 0 },
  ])
  await ui.unmount()
})

test('an over-full window is clamped to 100, never past the row', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  // The engine reports the fill unclamped when a turn runs over the window.
  await $.session.measure(measurement(1_200_000, 118))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  // A share over 100 would push the trough negative and the labels off the row.
  expect(await shares(ui)).toEqual([
    { color: 'success', grow: 100, width: 0 },
    { color: 'inactive', grow: 0, width: 0 },
  ])
  expect((await ui.find({ type: 'Text', text: /free/ }))?.text).toBe(
    ' 0% free · 1.20M/1.00M · deep-1m[1m]',
  )
  await ui.unmount()
})

test('a running turn keeps the reading and the engine word with it', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(341_000, 34.4))

  // Yielding the row used to blank it: the engine draws nothing there of its
  // own, so what it would have said is drawn here beside the reading.
  const ui = await $.ui.mount({
    ...HINT,
    props: { ...HINT.props, isWorking: true, hint: 'esc to interrupt' },
    surface: 'terminal',
  })

  // One space between the two, carried by the reading's own label.
  expect((await ui.find({ type: 'Text', text: /interrupt/ }))?.text).toBe(
    'esc to interrupt',
  )
  expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeDefined()
  await ui.unmount()
})

test('an empty engine line adds nothing before the reading', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(341_000, 34.4))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })

  // Only the two labels; no empty run padding the row.
  expect(texts.map(t => t.text)).toEqual([
    ' CTX 34% ',
    ' 66% free · 341k/1.00M · deep-1m[1m]',
  ])
  await ui.unmount()
})

test('typing in the prompt keeps the reading', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  await $.session.measure(measurement(341_000, 34.4))

  // A draft is not a reason to give the row up: the reading is wanted most
  // while a prompt is being written.
  const ui = await $.ui.mount({
    ...HINT,
    props: { ...HINT.props, isDraft: true },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeDefined()
  await ui.unmount()
})

test('nothing is drawn before the first reading', async ($, on) => {
  engine(on, 'deep-1m[1m]')

  // A measurement with no fill yet: the session has had no response.
  await $.session.measure(measurement(undefined))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeUndefined()
  await ui.unmount()
})

test('live agents are counted, ended ones are not', async ($, on) => {
  engine(on, 'deep-1m[1m]', [
    { id: 'a', status: 'running', description: '', type: 'Explore' },
    { id: 'b', status: 'completed', description: '', type: 'Explore' },
    { id: 'c', status: 'waiting', description: '', type: 'Explore' },
  ])

  await $.session.measure(measurement(341_000, 34.4))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /free/ }))?.text).toBe(
    ' 66% free · 341k/1.00M · deep-1m[1m] · 2 agent',
  )
  await ui.unmount()
})

test('a reading an earlier version stored is declined', async ($, on) => {
  engine(on, 'deep-1m[1m]')
  // What the code before a shape bump wrote survives the reload; the tag is
  // how this version refuses to read it back as its own.
  on('state.get', () => ({
    value: { value: { shape: 'hud-0', value: { percent: 99 } }, version: 1 },
  }))

  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeUndefined()
  await ui.unmount()
})
