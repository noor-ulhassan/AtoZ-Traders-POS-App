/**
 * Page-side helpers, installed once into the renderer as `window.__t`.
 *
 * React owns every input's value, so a plain `el.value = x` is discarded on the
 * next render. Setting through the native prototype setter and then dispatching
 * a bubbling `input` event is what React's synthetic-event layer actually
 * listens for — this is how a real keystroke looks to the app.
 */
export const INSTALL = `
window.__t = (() => {
  const vis = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const all = (sel) => Array.from(document.querySelectorAll(sel))
  const byText = (sel, text) =>
    all(sel).filter((el) => vis(el) && (el.textContent || '').trim().toLowerCase().includes(String(text).toLowerCase()))

  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return {
    text: () => document.body.innerText,
    html: (sel) => (document.querySelector(sel) || {}).outerHTML || null,
    count: (sel) => all(sel).length,

    /**
     * Label-driven field lookup. Field renders <label for> as a sibling of the
     * control (correct for accessibility), so resolve through the id first and
     * only then fall back to a nested control.
     */
    fieldByLabel: (label) => {
      const labels = all('label').filter((l) =>
        (l.textContent || '').trim().toLowerCase().startsWith(String(label).toLowerCase())
      )
      for (const l of labels) {
        const target = l.htmlFor ? document.getElementById(l.htmlFor) : null
        if (target && vis(target)) return target
        const nested = l.querySelector('input, textarea, select')
        if (nested && vis(nested)) return nested
      }
      return null
    },

    fill: (label, value) => {
      const el = window.__t.fieldByLabel(label)
      if (!el) throw new Error('no field labelled ' + label)
      setNative(el, value)
      return true
    },

    fillSelector: (sel, value, index = 0) => {
      const el = all(sel).filter(vis)[index]
      if (!el) throw new Error('no element for ' + sel)
      setNative(el, value)
      return true
    },

    click: (text, sel = 'button, a, [role=button]') => {
      const el = byText(sel, text)[0]
      if (!el) throw new Error('no clickable "' + text + '"')
      el.click()
      return true
    },

    clickAny: (...texts) => {
      for (const t of texts) {
        const el = byText('button, a, [role=button]', t)[0]
        if (el) {
          el.click()
          return t
        }
      }
      throw new Error('none of these are on screen: ' + texts.join(', '))
    },

    clickSelector: (sel, index = 0) => {
      const el = all(sel).filter(vis)[index]
      if (!el) throw new Error('no element for ' + sel)
      el.click()
      return true
    },

    has: (text) => document.body.innerText.toLowerCase().includes(String(text).toLowerCase()),

    /** Wait until \`text\` appears on screen. */
    waitFor: async (text, timeout = 8000) => {
      const end = Date.now() + timeout
      while (Date.now() < end) {
        if (window.__t.has(text)) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return false
    },

    waitForGone: async (text, timeout = 8000) => {
      const end = Date.now() + timeout
      while (Date.now() < end) {
        if (!window.__t.has(text)) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return false
    },

    /** Direct access to the preload contract, exactly as the UI uses it. */
    api: async (path, ...args) => {
      const fn = path.split('.').reduce((o, k) => (o == null ? o : o[k]), window.api)
      if (typeof fn !== 'function') throw new Error('no api at ' + path)
      return await fn(...args)
    },

    apiShape: () => {
      const walk = (obj, prefix) =>
        Object.entries(obj).flatMap(([k, v]) =>
          typeof v === 'function' ? [prefix + k] : typeof v === 'object' && v ? walk(v, prefix + k + '.') : []
        )
      return walk(window.api, '')
    },

    route: () => location.hash || location.pathname
  }
})();
true
`
