import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../src/select-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')

function mount(props) {
  const hooks = []
  let cursor = 0
  let focusCount = 0
  const react = {
    createElement: (type, elementProps, ...children) => ({ type, props: elementProps, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useId: () => ':filter-test:',
    useEffect: () => {},
  }
  const context = {
    require: name => {
      assert.equal(name, 'react')
      return react
    },
    window: { innerWidth: 800, innerHeight: 600 },
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  const FilterSelect = vm.runInContext('FilterSelect', context)
  function render() {
    cursor = 0
    const tree = FilterSelect(props)
    tree.children[0].props.ref.current = {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 220, bottom: 136, width: 120 }),
      focus: () => { focusCount += 1 },
    }
    return tree
  }
  return { render, focused: () => focusCount }
}

function key(tree, name) {
  let prevented = false
  tree.children[0].props.onKeyDown({ key: name, preventDefault: () => { prevented = true } })
  return prevented
}

test('自绘下拉展开后是 DOM listbox，选择仅更新选中值且恢复焦点', () => {
  const changes = []
  const props = {
    label: '账号：', value: '',
    options: [{ value: '', label: '全部账号' }, { value: 'a1', label: '账号一' }],
    onChange: value => { changes.push(value); props.value = value },
  }
  const view = mount(props)
  let tree = view.render()
  assert.equal(tree.children[0].props.role, 'combobox')
  assert.equal(tree.children[0].props['aria-expanded'], false)
  assert.equal(tree.children[1], null)
  tree.children[0].props.onClick()
  tree = view.render()
  const menu = tree.children[1]
  assert.equal(menu.props.role, 'listbox')
  assert.equal(menu.props.style.top, 140)
  assert.equal(menu.children.length, 2)
  assert.equal(menu.children[0].props['aria-selected'], true)
  menu.children[1].props.onClick()
  tree = view.render()
  assert.deepEqual(changes, ['a1'])
  assert.equal(tree.children[0].children[0].children[0], '账号一')
  assert.equal(tree.children[0].props['aria-expanded'], false)
  assert.equal(view.focused(), 1)
})

test('自绘下拉支持方向键、Home/End、Enter、Escape 与 Tab', () => {
  const changes = []
  const props = {
    label: '排序：', value: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ],
    onChange: value => changes.push(value),
  }
  const view = mount(props)
  let tree = view.render()
  assert.equal(key(tree, 'ArrowDown'), true)
  tree = view.render()
  assert.equal(tree.children[0].props['aria-expanded'], true)
  assert.equal(key(tree, 'End'), true)
  tree = view.render()
  assert.equal(tree.children[0].props['aria-activedescendant'], ':filter-test:-2')
  assert.equal(key(tree, 'Home'), true)
  tree = view.render()
  assert.equal(tree.children[0].props['aria-activedescendant'], ':filter-test:-0')
  assert.equal(key(tree, 'ArrowDown'), true)
  tree = view.render()
  assert.equal(key(tree, 'Enter'), true)
  assert.deepEqual(changes, ['b'])
  assert.equal(view.render().children[0].props['aria-expanded'], false)
  tree = view.render()
  tree.children[0].props.onClick()
  tree = view.render()
  assert.equal(key(tree, 'Escape'), true)
  assert.equal(view.render().children[0].props['aria-expanded'], false)
  tree = view.render()
  tree.children[0].props.onClick()
  tree = view.render()
  assert.equal(key(tree, 'Tab'), false)
  assert.equal(view.render().children[0].props['aria-expanded'], false)
})

test('禁用筛选器不能展开，也不会提交选择', () => {
  const changes = []
  const view = mount({
    label: '账号：', value: '', disabled: true,
    options: [{ value: '', label: '全部账号' }],
    onChange: value => changes.push(value),
  })
  const tree = view.render()
  assert.equal(tree.children[0].props.disabled, true)
  tree.children[0].props.onClick()
  assert.equal(key(tree, 'ArrowDown'), false)
  assert.equal(view.render().children[0].props['aria-expanded'], false)
  assert.deepEqual(changes, [])
})

test('连续按键早于 React 重绘时仍提交最后高亮的选项', () => {
  const changes = []
  const view = mount({
    label: '排序：', value: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ],
    onChange: value => changes.push(value),
  })
  const tree = view.render()
  key(tree, 'ArrowDown')
  key(tree, 'End')
  key(tree, 'Enter')
  assert.deepEqual(changes, ['c'])
  assert.equal(view.render().children[0].props['aria-expanded'], false)
})

test('四项菜单高度包含边框，窗口失焦有成对关闭监听', () => {
  const view = mount({
    label: '发布时间：', value: '30d',
    options: ['7d', '30d', '90d', 'all'].map(value => ({ value, label: value })),
    onChange: () => {},
  })
  view.render().children[0].props.onClick()
  assert.equal(view.render().children[1].props.style.maxHeight, 154)
  assert.match(source, /window\.addEventListener\('blur', dismiss\)/u)
  assert.match(source, /window\.removeEventListener\('blur', dismiss\)/u)
})
