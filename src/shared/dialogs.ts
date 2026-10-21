import { t, l } from '../i18n/index';
export function confirmAction(message: string, accept = t('continue')): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `<form method="dialog"><h2>${l('confirm_action', {})}</h2><p></p><div class="inline-actions"><button class="outline" value="cancel" autofocus>${l('cancel', {})}</button><button class="primary" value="accept"></button></div></form>`;
    dialog.querySelector('p')!.textContent = message;
    dialog.querySelector<HTMLButtonElement>('[value="accept"]')!.textContent = accept;
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'accept'; dialog.remove(); resolve(accepted); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
