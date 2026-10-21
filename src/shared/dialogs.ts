/** App-styled confirmation; resolves on buttons, Escape or the close action. */
export function confirmAction(message: string, accept = '繼續'): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = '<form method="dialog"><h2>確認操作</h2><p></p><div class="inline-actions"><button class="outline" value="cancel" autofocus>取消</button><button class="primary" value="accept"></button></div></form>';
    dialog.querySelector('p')!.textContent = message;
    dialog.querySelector<HTMLButtonElement>('[value="accept"]')!.textContent = accept;
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'accept'; dialog.remove(); resolve(accepted); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
