const statusEl = document.getElementById('status');
const syncBtn = document.getElementById('sync');

async function refresh() {
  const status = await browser.runtime.sendMessage({ type: 'get-status' });
  if (status?.hasSession) {
    const when = status.lastSync ? new Date(status.lastSync).toLocaleString('pl-PL') : 'nigdy';
    statusEl.innerHTML = `<span class="ok">✓ Cookie wysłane</span><br>Ostatnia synchronizacja: ${when}`;
  } else {
    statusEl.textContent = 'Brak wysłanego cookie. Zaloguj się na instagram.com na dedykowanym koncie.';
  }
}

syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Wysyłam…';
  const res = await browser.runtime.sendMessage({ type: 'manual-sync' });
  if (res?.ok) {
    statusEl.innerHTML = '<span class="ok">✓ Wysłano</span>';
  } else {
    statusEl.innerHTML = `<span class="err">✗ ${res?.error || 'Błąd'}</span>`;
  }
  syncBtn.disabled = false;
  syncBtn.textContent = 'Wyślij teraz';
  setTimeout(refresh, 1500);
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

refresh();
