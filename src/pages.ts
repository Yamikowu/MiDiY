/** Hash navigation keeps both tools mounted so HID, drafts and captures survive. */
export function mountPages(): void {
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-page]')];
  const show = () => {
    const page = location.hash === '#testing' ? 'testing' : 'mapping';
    for (const tab of tabs) {
      const active = tab.dataset.page === page;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(`page-${tab.dataset.page}`)!.hidden = !active;
    }
    document.title = `${page === 'testing' ? 'Testing' : 'Mapping'} · MiDiY`;
  };
  tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); location.hash = tabs[next].hash; tabs[next].focus();
  }));
  window.addEventListener('hashchange', show);
  show();
}
