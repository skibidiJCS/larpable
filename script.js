const button = document.querySelector('.join-button');
const count = document.querySelector('.count');
const countValue = document.querySelector('.count-value');
const buttonLabel = document.querySelector('.button-label');
const buttonMark = document.querySelector('.button-mark');
const status = document.querySelector('.status');
const celebration = document.querySelector('.celebration');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const storageKey = 'larpable.visitor';
let visitor = '';
let joined = false;
let busy = false;

try { visitor = localStorage.getItem(storageKey) || ''; } catch {}

function render(data) {
  visitor = data.visitor;
  joined = data.joined;
  try { localStorage.setItem(storageKey, visitor); } catch {}
  const total = new Intl.NumberFormat().format(data.count);
  countValue.style.setProperty('--digits', String(total.length));
  countValue.replaceChildren(...Array.from(total, (character) => {
    const digit = document.createElement('span');
    digit.className = 'count-digit';
    digit.textContent = character;
    return digit;
  }));
  buttonLabel.textContent = joined ? "You're part of it!" : 'Join the larp community';
  buttonMark.textContent = joined ? '✓' : '+';
  status.textContent = '';
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
      status.textContent = 'Unable to connect. Try again.';
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
  buttonLabel.textContent = 'Joining…';
  button.setAttribute('aria-busy', 'true');
  try {
    // Refresh the server-issued identity first; this also reconciles other tabs.
    render(await request('GET'));
    if (!joined) {
      button.disabled = true;
      buttonLabel.textContent = 'Joining…';
      render(await request('POST'));
      celebrate();
    }
  } catch (error) {
    status.textContent = error.message === 'Please wait a minute before trying again.'
      ? error.message : 'Unable to join. Try again.';
    button.disabled = joined;
    buttonLabel.textContent = joined ? "You're part of it!" : 'Join the larp community';
  } finally {
    button.removeAttribute('aria-busy');
    busy = false;
  }
});

function celebrate() {
  if (reducedMotion.matches) return;
  count.dataset.celebrating = 'true';
  const colors = ['#eea1b3', '#c2b7ef', '#afd7bc', '#f4bf8f'];
  const particles = Array.from({ length: 20 }, (_, index) => {
    const particle = document.createElement('span');
    particle.className = 'confetti';
    const angle = (index / 20) * Math.PI * 2;
    const distance = 100 + Math.random() * 90;
    particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * distance - 55}px`);
    particle.style.setProperty('--rotation', `${Math.random() * 360}deg`);
    particle.style.setProperty('--color', colors[index % colors.length]);
    return particle;
  });
  celebration.replaceChildren(...particles);
  setTimeout(() => {
    celebration.replaceChildren();
    delete count.dataset.celebrating;
  }, 900);
}

button.addEventListener('pointermove', (event) => {
  if (reducedMotion.matches || button.disabled || event.pointerType !== 'mouse') return;
  const rect = button.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  button.style.setProperty('--tilt', `${(x - 0.5) * 2}deg`);
});
button.addEventListener('pointerleave', () => {
  button.style.setProperty('--tilt', '0deg');
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
