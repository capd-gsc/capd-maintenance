// Waits on what the page is doing instead of fixed sleeps.
//   idle()        – every DB call the app started has finished and nothing new started (the app's
//                   await-chain after a click is done: save → reload data → re-render)
//   toast(fn)     – run fn, then wait for a *new* .toast (an old one may still be on screen)
//   rerender(fn)  – run fn, then wait until #app was rendered again (login → shell, or login → error)
//   login(fn)     – run fn (submit a login), wait for the shell (#logout) or a login error, then idle
//   logout()      – click #logout and wait for the login page (trial mode reloads the page)
module.exports = function waits(p, { timeout = 20000 } = {}) {
  // one hop through the page's task queue, then read the busy counter (0 while the page is navigating)
  const busy = () => p.evaluate(() => new Promise(r => {
    const c = new MessageChannel(); c.port1.onmessage = () => r(document.readyState === 'complete' ? (window.__busy || 0) : 1); c.port2.postMessage(0);
  })).catch(() => 1);
  const idle = async () => {
    const end = Date.now() + timeout;
    let quiet = 0; while (quiet < 2 && Date.now() < end) quiet = (await busy()) ? 0 : quiet + 1;
    if (quiet < 2) console.error('wait.idle: page still busy after ' + timeout + 'ms');
  };
  const mark = (sel) => p.evaluate(s => document.querySelectorAll(s).forEach(e => e.dataset.seen = '1'), sel).catch(() => {});
  const toast = async fn => { await mark('.toast'); await fn(); await p.waitForSelector('.toast:not([data-seen])', { state: 'attached', timeout }); await idle(); };
  const rerender = async fn => { await mark('#app > *'); await fn(); await p.waitForSelector('#app > :not([data-seen]):is(.shell, .login)', { state: 'attached', timeout }); await idle(); };
  const login = async fn => { await mark('#app > *'); await fn(); await p.waitForSelector('#app > :not([data-seen]) :is(#logout, .err)', { state: 'attached', timeout }); await idle(); };
  const logout = async () => { await mark('#app > *'); await p.click('#logout'); await p.waitForSelector('#app > .login:not([data-seen])', { state: 'attached', timeout }); await idle(); };
  return { idle, toast, rerender, login, logout };
};
