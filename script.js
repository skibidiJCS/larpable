const button = document.querySelector('.join-button');
const count = document.querySelector('.count');
const countValue = document.querySelector('.count-value');
const buttonLabel = document.querySelector('.button-label');
const buttonMark = document.querySelector('.button-mark');
const status = document.querySelector('.status');
const celebration = document.querySelector('.celebration');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const signInDialog = document.querySelector('.sign-in-dialog');
const signInStatus = document.querySelector('.sign-in-status');
const googleButton = document.querySelector('.google-button');
let googleClientId = '';
let nonce = '';
let googleLoading;
let googleConfiguration = '';
let joined = false;
let busy = false;


function render(data) {
  googleClientId = data.googleClientId;
  nonce = data.nonce;
  joined = data.joined;
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

async function request(method, credential) {
  const response = await fetch('/api/community', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    ...(method === 'POST' ? { body: JSON.stringify({ credential }) } : {}),
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

function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Google sign-in could not load. Check your connection or content blocker, then close and retry.')); }, 20000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.google?.accounts?.id) resolve();
      else { script.remove(); reject(new Error('Sign-in could not load. Please try again.')); }
    };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Sign-in could not load. Please try again.')); };
    document.head.append(script);
  }).catch((error) => { googleLoading = undefined; throw error; });
  return googleLoading;
}

async function finishSignIn(response) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  buttonLabel.textContent = 'Joining…';
  button.setAttribute('aria-busy', 'true');
  signInStatus.textContent = 'Joining…';
  googleButton.setAttribute('inert', '');
  try {
    const previouslyJoined = joined;
    render(await request('POST', response.credential));
    signInDialog.close();
    if (!previouslyJoined) celebrate();
  } catch (error) {
    signInStatus.textContent = error.message;
    status.textContent = error.message;
    button.disabled = joined;
    buttonLabel.textContent = joined ? "You're part of it!" : 'Join the larp community';
  } finally {
    googleButton.removeAttribute('inert');
    button.removeAttribute('aria-busy');
    busy = false;
  }
}

button.addEventListener('click', async () => {
  if (busy || joined) return;
  busy = true;
  googleButton.replaceChildren();
  signInStatus.textContent = 'Loading sign-in…';
  signInDialog.showModal();
  try {
    render(await request('GET'));
    if (joined) { signInDialog.close(); return; }
    if (!googleClientId) throw new Error('Sign-in is unavailable. Please try later.');
    await loadGoogle();
    if (!signInDialog.open) return;
    const configuration = `${googleClientId}:${nonce}`;
    if (googleConfiguration !== configuration) {
      window.google.accounts.id.initialize({
        client_id: googleClientId, nonce, callback: finishSignIn, auto_select: false,
        use_fedcm_for_button: true, button_auto_select: false,
      });
      googleConfiguration = configuration;
    }
    googleButton.replaceChildren();
    window.google.accounts.id.renderButton(googleButton, {
      type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
      width: Math.min(280, googleButton.clientWidth),
      click_listener: () => {
        signInStatus.textContent = 'Complete sign-in in Google’s window. If nothing opens, allow popups or open this page in Safari or Chrome.';
      },
    });
    signInStatus.textContent = '';
  } catch (error) {
    signInStatus.textContent = error.message;
  } finally {
    busy = false;
  }
});

document.querySelector('.dialog-close').addEventListener('click', () => signInDialog.close());
signInDialog.addEventListener('click', (event) => {
  const rect = signInDialog.getBoundingClientRect();
  if (event.target === signInDialog &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
    signInDialog.close();
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
  if (document.visibilityState === 'visible' && !signInDialog.open) refresh();
});

refresh();
