// Before acting on an element, do what a person would: open the ⋯ menu or the tab that holds it.
module.exports = function reveal(page) {
  const show = sel => page.evaluate(s => {
    let list; try { list = [...document.querySelectorAll(s)]; } catch (x) { return; }
    for (const e of list.slice(0, 1)) {
      const pane = e.closest('.tpane');
      if (pane && !pane.classList.contains('on')) document.querySelector(`[data-tabbtn="${pane.dataset.pane}"]`)?.click();
      const more = e.closest('details.more'); if (more) more.open = true;
    }
  }, sel).catch(() => {});
  const ACT = ['click', 'fill', 'selectOption', 'check', 'uncheck', 'setInputFiles', 'dispatchEvent'];
  for (const fn of ACT) {
    const orig = page[fn].bind(page);
    page[fn] = async (sel, ...rest) => { if (typeof sel === 'string') await show(sel); return orig(sel, ...rest); };
  }
  const wrap = (loc, sel) => new Proxy(loc, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (ACT.includes(k)) return async (...a) => { await show(sel); return v.apply(t, a); };
      if (['first', 'last', 'nth', 'filter'].includes(k)) return (...a) => wrap(v.apply(t, a), sel);
      return v.bind(t);
    }
  });
  const origLoc = page.locator.bind(page);
  page.locator = (sel, ...rest) => wrap(origLoc(sel, ...rest), sel);
  return page;
};
