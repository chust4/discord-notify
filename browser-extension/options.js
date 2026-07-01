const $ = (id) => document.getElementById(id);

async function load() {
  const stored = await browser.storage.local.get(['appUrl', 'basicUser', 'basicPass']);
  $('appUrl').value = stored.appUrl || '';
  $('user').value = stored.basicUser || '';
  $('pass').value = stored.basicPass || '';
}

$('save').addEventListener('click', async () => {
  const appUrl = $('appUrl').value.trim().replace(/\/+$/, '');
  const user = $('user').value.trim();
  const pass = $('pass').value;
  const status = $('status');
  status.textContent = '';

  if (!appUrl || !/^https?:\/\//i.test(appUrl)) {
    status.textContent = '✗ Podaj pełny adres, np. http://192.168.0.32:8092';
    return;
  }

  let origin;
  try {
    origin = new URL(appUrl).origin + '/*';
  } catch {
    status.textContent = '✗ Niepoprawny adres URL.';
    return;
  }

  const granted = await browser.permissions.request({ origins: [origin] });
  if (!granted) {
    status.textContent = '✗ Bez zgody na dostęp do tego adresu wtyczka nie może wysyłać cookie.';
    return;
  }

  await browser.storage.local.set({ appUrl, basicUser: user, basicPass: pass });
  status.textContent = '✓ Zapisano. Odwiedź instagram.com, aby zsynchronizować cookie.';
});

load();
