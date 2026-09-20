// 筛选菜单由页面绘制，避免系统原生 select 弹出层在 Windows 上出现不可控边框。
const SelectReact = require('react')

export function FilterSelect({ label, value, options, onChange, disabled = false }) {
  const [open, setOpen] = SelectReact.useState(false)
  const [active, setActive] = SelectReact.useState(0)
  const [menuStyle, setMenuStyle] = SelectReact.useState(null)
  const openRef = SelectReact.useRef(false)
  const activeRef = SelectReact.useRef(0)
  const rootRef = SelectReact.useRef(null)
  const triggerRef = SelectReact.useRef(null)
  const menuRef = SelectReact.useRef(null)
  const listId = SelectReact.useId()
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selected = options[selectedIndex]

  function setMenuOpen(next) {
    openRef.current = next
    setOpen(next)
  }

  function setActiveIndex(next) {
    activeRef.current = next
    setActive(next)
  }

  function showMenu() {
    if (disabled || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const useAbove = below < 160 && above > below
    const available = Math.max(80, useAbove ? above : below)
    const height = Math.min(280, options.length * 36 + 10, available)
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setMenuStyle({ top: useAbove ? rect.top - height - 4 : rect.bottom + 4, left, width, maxHeight: height })
    setActiveIndex(selectedIndex)
    setMenuOpen(true)
  }

  function choose(index) {
    const option = options[index]
    if (!option || option.disabled) return
    setMenuOpen(false)
    if (option.value !== value) onChange(option.value)
    triggerRef.current?.focus()
  }

  SelectReact.useEffect(() => {
    if (!open) return undefined
    const dismissOutside = event => {
      if (!rootRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const dismissScroll = event => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const dismiss = () => setMenuOpen(false)
    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('scroll', dismissScroll, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('scroll', dismissScroll, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [open])

  SelectReact.useEffect(() => {
    if (disabled) setMenuOpen(false)
  }, [disabled])

  SelectReact.useEffect(() => {
    if (!open || !menuRef.current) return
    const menu = menuRef.current
    const option = menu.children[active]
    if (!option) return
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
  }, [open, active])

  function onKeyDown(event) {
    if (disabled) return
    if (event.key === 'Escape' && openRef.current) {
      event.preventDefault()
      setMenuOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'Tab' && openRef.current) {
      setMenuOpen(false)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && openRef.current) {
      event.preventDefault()
      choose(activeRef.current)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!openRef.current) {
      showMenu()
      return
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : activeRef.current
    for (let step = 0; step < options.length; step += 1) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = (next + direction + options.length) % options.length
      if (!options[next]?.disabled) break
      if (event.key === 'Home' || event.key === 'End') next += event.key === 'Home' ? 1 : -1
    }
    if (options[next] && !options[next].disabled) setActiveIndex(next)
  }

  return SelectReact.createElement('span', { className: 'ydo-filter-select', ref: rootRef },
    SelectReact.createElement('button', {
      ref: triggerRef,
      type: 'button',
      className: 'ydo-filter-trigger',
      role: 'combobox',
      'aria-label': label,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? `${listId}-${active}` : undefined,
      disabled,
      onClick: () => openRef.current ? setMenuOpen(false) : showMenu(),
      onKeyDown,
    },
    SelectReact.createElement('span', { className: 'ydo-filter-value' }, selected?.label || ''),
    SelectReact.createElement('span', { className: 'ydo-filter-chevron', 'aria-hidden': true })),
    open && menuStyle ? SelectReact.createElement('div', {
      ref: menuRef,
      id: listId,
      role: 'listbox',
      className: 'ydo-filter-menu',
      style: menuStyle,
      'aria-label': label,
    }, ...options.map((option, index) => SelectReact.createElement('div', {
      key: option.value,
      id: `${listId}-${index}`,
      role: 'option',
      'aria-selected': option.value === value,
      'aria-disabled': option.disabled || undefined,
      className: `ydo-filter-option${index === active ? ' ydo-filter-option-active' : ''}`,
      onPointerDown: event => event.preventDefault(),
      onClick: () => choose(index),
    }, option.label))) : null)
}
