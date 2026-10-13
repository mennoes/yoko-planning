const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')

// Exercise the component's actual pointer handlers without a browser or DB.
function mount(values = [5, 5], total = 10, renderedSize = 120) {
  const listeners = new Map()
  const refs = []
  let unmount
  const live = [], commits = []
  const jsx = (type, props, key) => ({ type, props, key })
  const context = {
    exports: {},
    window: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) },
    },
    require: name => name === 'react' ? {
      useMemo: fn => fn(),
      useState: value => [value, () => {}],
      useRef: value => { const ref = { current: value }; refs.push(ref); return ref },
      useEffect: fn => { unmount = fn() },
    } : { jsx, jsxs: jsx },
  }
  vm.createContext(context)
  vm.runInContext(ts.transpile(fs.readFileSync('components/DistributionPie.tsx', 'utf8'), {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }), context)
  const tree = context.exports.DistributionPie({
    segments: values.map((value, i) => ({ id: String(i), value, color: '#888' })),
    total, size: 120, interactive: true,
    onChange: next => live.push({ ...next }), onCommit: next => commits.push({ ...next }),
  })
  tree.props.ref.current = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: renderedSize, height: renderedSize }),
    setPointerCapture() {}, releasePointerCapture() {},
  }
  const handles = []
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    if (node.props.onPointerDown) handles.push(node)
    walk(node.props.children)
  }
  walk(tree)
  function event(deg, pointerId = 1) {
    const angle = (deg - 90) * Math.PI / 180
    const radius = renderedSize / 2 - 2
    return { clientX: renderedSize / 2 + radius * Math.cos(angle),
      clientY: renderedSize / 2 + radius * Math.sin(angle), pointerId, button: 0,
      preventDefault() {}, stopPropagation() {} }
  }
  return { handles, live, commits, listeners, unmount,
    start: (index, deg) => handles[index].props.onPointerDown(event(deg)),
    emit: (type, deg, id) => listeners.get(type)?.(event(deg, id)),
  }
}

// Only movable boundaries get handles. A scaled SVG still tracks the pointer.
const scaled = mount([5, 5], 10, 60)
assert.equal(scaled.handles.length, 1)
scaled.start(0, 180)
scaled.emit('pointermove', 270)
assert.deepEqual(scaled.live.at(-1), { 0: 7.5, 1: 2.5 })
assert.equal(scaled.commits.length, 0)
scaled.emit('pointerup', 270)
assert.deepEqual(scaled.commits, [{ 0: 7.5, 1: 2.5 }])
assert.equal(scaled.listeners.size, 0)

// A sweep past 180 degrees must not reverse direction or reset the split.
const sweep = mount([1, 9])
sweep.start(0, 36)
for (const deg of [126, 216, 306]) sweep.emit('pointermove', deg)
assert.deepEqual(sweep.live.at(-1), { 0: 8.5, 1: 1.5 })
sweep.emit('pointerup', 306)
assert.equal(sweep.commits.length, 1)

// Other pointers cannot change or finish the active drag. Cancel rolls back.
const cancelled = mount()
cancelled.start(0, 180)
cancelled.emit('pointermove', 270, 2)
assert.equal(cancelled.live.length, 0)
cancelled.emit('pointerup', 270, 2)
assert.equal(cancelled.commits.length, 0)
cancelled.emit('pointermove', 270)
cancelled.emit('pointercancel', 270)
assert.deepEqual(cancelled.live.at(-1), { 0: 5, 1: 5 })
assert.equal(cancelled.commits.length, 0)
assert.equal(cancelled.listeners.size, 0)

// Only the neighboring pair changes, and rounding keeps the total constant.
const triple = mount([0.5, 0.5, 1], 2)
triple.start(0, 90)
triple.emit('pointerup', 99)
assert.deepEqual(triple.commits.at(-1), { 0: 0.6, 1: 0.4, 2: 1 })

const removed = mount()
removed.start(0, 180)
removed.unmount()
assert.equal(removed.listeners.size, 0)
assert.equal(removed.commits.length, 0)
console.log('Distribution pie: scaled dragging, long sweeps, totals, cancel and cleanup pass')
