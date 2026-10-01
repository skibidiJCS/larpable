const button = document.querySelector('.join-button');
const count = document.querySelector('.count');
const storageKey = 'larpable.visitor';
let visitor = '';
let joined = false;
let busy = false;

try { visitor = localStorage.getItem(storageKey) || ''; } catch {}

function render(data) {
  visitor = data.visitor;
  joined = data.joined;
  try { localStorage.setItem(storageKey, visitor); } catch {}
  count.textContent = `${new Intl.NumberFormat().format(data.count)} joined`;
  button.textContent = joined ? "You're in." : 'Join the larp community';
  button.dataset.joined = String(joined);
  button.disabled = joined;
}

async function request(method) {
  const response = await fetch('/api/community', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
    headers: method === 'POST'
      ? { 'Content-Type': 'application/json' }
      : { 'X-Visitor-Token': visitor },
    ...(method === 'POST' ? { body: JSON.stringify({ visitor }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    render(await request('GET'));
  } catch {
    if (!joined) {
      count.textContent = 'Unable to connect. Try again.';
      button.disabled = false;
    }
  } finally {
    busy = false;
  }
}

button.addEventListener('click', async () => {
  if (busy || joined) return;
  busy = true;
  button.disabled = true;
  button.textContent = 'Joining…';
  button.setAttribute('aria-busy', 'true');
  try {
    // Refresh the server-issued identity first; this also reconciles other tabs.
    render(await request('GET'));
    if (!joined) {
      button.disabled = true;
      button.textContent = 'Joining…';
      render(await request('POST'));
    }
  } catch (error) {
    count.textContent = error.message === 'Please wait a minute before trying again.'
      ? error.message : 'Unable to join. Try again.';
    button.disabled = joined;
    button.textContent = joined ? "You're in." : 'Join the larp community';
  } finally {
    button.removeAttribute('aria-busy');
    busy = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
window.addEventListener('storage', (event) => {
  if (event.key === storageKey && event.newValue !== visitor) {
    visitor = event.newValue || visitor;
    refresh();
  }
});
refresh();
