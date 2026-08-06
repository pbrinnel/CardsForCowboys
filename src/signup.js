// ============================================================
// Kickstarter email capture — THE shared signup handler
// ============================================================
// Wires up every .signup-section on the page, so a page can carry more than
// one and any page can carry it at all. Markup + styles: css/signup.css.
//
// Load it as a module, once per page:
//   <script type="module" src="src/signup.js"></script>
//
// Writes {email, ts} to emailSignups/. That payload is EXACT: the security
// rule in database.rules.json ends with `"$other": { ".validate": false }`,
// so adding a field here (a `page` or `source`, say) makes every write fail
// with permission_denied until the rules are edited AND deployed.

import { db } from './firebase-config.js';
import { ref, push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// Mirrors the server-side rule's regex. Deliberately not just an '@' check:
// the rule also requires a dot in the domain, so `me@localhost` used to pass
// the client and come back as the generic "something went wrong".
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function setMsg(el, text, state) {
  el.textContent = text;
  el.classList.remove('is-pending', 'is-error', 'is-ok');
  if (state) el.classList.add('is-' + state);
}

function wire(section) {
  if (section.dataset.signupWired) return;   // a re-run must not double-bind
  section.dataset.signupWired = '1';

  const input = section.querySelector('.signup-input');
  const btn   = section.querySelector('.signup-btn');
  const msg   = section.querySelector('.signup-msg');
  if (!input || !btn || !msg) return;

  async function submit() {
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      setMsg(msg, 'Please enter a valid email address.', 'error');
      input.focus();
      return;
    }
    btn.disabled = true;
    setMsg(msg, 'Saving…', 'pending');
    try {
      await push(ref(db, 'emailSignups'), { email, ts: Date.now() });
      input.value = '';
      setMsg(msg, "You're on the list — we'll be in touch!", 'ok');
    } catch (e) {
      btn.disabled = false;
      setMsg(msg, 'Something went wrong. Please try again.', 'error');
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

export function initSignupForms(root = document) {
  root.querySelectorAll('.signup-section').forEach(wire);
}

initSignupForms();
