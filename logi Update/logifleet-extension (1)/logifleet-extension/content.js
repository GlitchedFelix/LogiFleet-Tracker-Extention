// ============================================================
//  LogiFleet Driver Sync — content.js
//  Targets: https://backend.mrt.co.za/admin/drivers*
// ============================================================

const SUPABASE_URL      = 'https://brzrzlsueddmiozybqbr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyenJ6bHN1ZWRkbWlvenlicWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTQ1NTMsImV4cCI6MjA5NTUzMDU1M30.3uFV1WEDv8XnPOTz1ExQ82eS22UPr5SZ98mm_2fopK4';

// In-memory session token — survives the page session, cleared on tab close
let _accessToken = null;

// ============================================================
//  1. AUTH — Sign in via Supabase and cache the access token
// ============================================================

async function ensureLoggedIn() {
  if (_accessToken) return _accessToken;

  // Show a styled login dialog (prompt() is too basic for two fields)
  const creds = await showLoginDialog();
  if (!creds) return null; // user dismissed

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey':       SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: creds.email, password: creds.password })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_description || data.message || 'Login failed');
  }

  _accessToken = data.access_token;
  return _accessToken;
}

function showLoginDialog() {
  return new Promise(resolve => {
    // Remove any stale dialog
    const existing = document.getElementById('lf-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'lf-login-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        background: #fff; border-radius: 14px; padding: 32px 28px;
        width: 340px; box-shadow: 0 8px 40px rgba(0,0,0,0.22);
      ">
        <div style="font-size:20px;font-weight:800;margin-bottom:4px;color:#1a1714;">
          Logi<span style="color:#c75b2a">Fleet</span>
        </div>
        <div style="font-size:12px;color:#8c8278;margin-bottom:24px;">Sign in to sync drivers</div>

        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#8c8278;display:block;margin-bottom:5px;">Email</label>
        <input id="lf-email" type="email" placeholder="you@example.com" style="
          width:100%;padding:9px 12px;border:1px solid #e0dbd3;border-radius:7px;
          font-size:13px;outline:none;margin-bottom:14px;box-sizing:border-box;
          font-family:inherit;color:#1a1714;
        "/>

        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#8c8278;display:block;margin-bottom:5px;">Password</label>
        <input id="lf-password" type="password" placeholder="••••••••" style="
          width:100%;padding:9px 12px;border:1px solid #e0dbd3;border-radius:7px;
          font-size:13px;outline:none;margin-bottom:6px;box-sizing:border-box;
          font-family:inherit;color:#1a1714;
        "/>

        <div id="lf-login-error" style="color:#c0392b;font-size:12px;min-height:18px;margin-bottom:14px;"></div>

        <div style="display:flex;gap:8px;">
          <button id="lf-cancel-btn" style="
            flex:1;padding:10px;border:1px solid #e0dbd3;background:#f5f4f1;
            border-radius:7px;cursor:pointer;font-size:13px;color:#8c8278;font-family:inherit;
          ">Cancel</button>
          <button id="lf-login-submit" style="
            flex:2;padding:10px;background:#c75b2a;color:#fff;border:none;
            border-radius:7px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;
          ">Sign In</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const emailInput    = overlay.querySelector('#lf-email');
    const passwordInput = overlay.querySelector('#lf-password');
    const errorEl       = overlay.querySelector('#lf-login-error');
    const submitBtn     = overlay.querySelector('#lf-login-submit');
    const cancelBtn     = overlay.querySelector('#lf-cancel-btn');

    emailInput.focus();

    const dismiss = (result) => {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => dismiss(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(null); });

    const trySubmit = async () => {
      const email    = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        errorEl.textContent = 'Email and password are required.';
        return;
      }
      submitBtn.textContent = 'Signing in…';
      submitBtn.disabled = true;
      errorEl.textContent = '';

      // Attempt auth here so we can show inline errors
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.message || 'Login failed');
        _accessToken = data.access_token;
        dismiss({ email, password });
      } catch(err) {
        errorEl.textContent = err.message;
        submitBtn.textContent = 'Sign In';
        submitBtn.disabled = false;
      }
    };

    submitBtn.addEventListener('click', trySubmit);
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmit(); });
    emailInput.addEventListener('keydown',    e => { if (e.key === 'Enter') passwordInput.focus(); });
  });
}

// ============================================================
//  2. INJECT THE SYNC BUTTON
// ============================================================

function injectButton() {
  if (document.getElementById('logifleet-sync-btn')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'logifleet-sync-wrapper';
  wrapper.style.cssText = `
    position: fixed; top: 16px; right: 20px; z-index: 99999;
    display: flex; align-items: center; gap: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  const btn = document.createElement('button');
  btn.id = 'logifleet-sync-btn';
  btn.textContent = '⬆ Sync Drivers to LogiFleet';
  btn.style.cssText = `
    background: #c75b2a; color: #fff; border: none;
    padding: 10px 18px; border-radius: 7px; font-size: 13px; font-weight: 600;
    cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.18);
    transition: background 0.15s, opacity 0.15s; white-space: nowrap;
  `;
  btn.onmouseover = () => btn.style.background = '#a84a22';
  btn.onmouseout  = () => btn.style.background = '#c75b2a';

  const status = document.createElement('span');
  status.id = 'logifleet-sync-status';
  status.style.cssText = `
    background: rgba(0,0,0,0.75); color: #fff; padding: 7px 13px;
    border-radius: 6px; font-size: 12px; display: none;
    max-width: 280px; line-height: 1.4;
  `;

  // Sign-out link — clears the cached token
  const signOutBtn = document.createElement('button');
  signOutBtn.id = 'logifleet-signout-btn';
  signOutBtn.textContent = 'Sign Out';
  signOutBtn.style.cssText = `
    background: none; border: 1px solid rgba(255,255,255,0.4); color: #fff;
    padding: 6px 11px; border-radius: 6px; font-size: 11px; cursor: pointer;
    display: none; opacity: 0.8;
  `;
  signOutBtn.onclick = () => {
    _accessToken = null;
    signOutBtn.style.display = 'none';
    setStatus('Signed out.', 'rgba(80,80,80,0.85)');
  };

  btn.addEventListener('click', runSync);
  wrapper.appendChild(btn);
  wrapper.appendChild(status);
  wrapper.appendChild(signOutBtn);
  document.body.appendChild(wrapper);
}

// ============================================================
//  3. SCRAPE DRIVER RECORDS FROM THE PAGE
// ============================================================

function scrapeDrivers() {
  const drivers = [];
  const mediaBodyEls = document.querySelectorAll('div.media-body.pl-1');

  mediaBodyEls.forEach(el => {
    try {
      const anchor = el.querySelector('p.text-bold-600 a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href') || '';
      const idMatch = href.match(/(\d+)\s*$/);
      if (!idMatch) return;

      const profile_id   = idMatch[1];
      const profile_name = anchor.textContent.trim();

      const mutedP = el.querySelector('p.text-muted');
      if (!mutedP) return;

      const email   = extractTextAfterIcon(mutedP, 'ft-mail');
      const cell_no = extractTextAfterIcon(mutedP, 'ft-smartphone');

      drivers.push({ profile_id, profile_name, email, cell_no });
    } catch (err) {
      console.warn('[LogiFleet] Failed to parse a driver element:', err);
    }
  });

  return drivers;
}

function extractTextAfterIcon(parentEl, iconClass) {
  const nodes = Array.from(parentEl.childNodes);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.tagName === 'I' &&
      node.classList.contains(iconClass)
    ) {
      let text = '';
      for (let j = i + 1; j < nodes.length; j++) {
        const next = nodes[j];
        if (next.nodeType === Node.ELEMENT_NODE && next.tagName === 'I') break;
        if (next.nodeType === Node.TEXT_NODE) text += next.textContent;
      }
      return text.trim() || null;
    }
  }
  return null;
}

// ============================================================
//  4. SEND TO SUPABASE (UPSERT) using authenticated token
// ============================================================

async function upsertDrivers(drivers, company_id, token) {
  const payload = drivers.map(d => ({
    profile_id:   d.profile_id,
    profile_name: d.profile_name,
    email:        d.email    || null,
    cell_no:      d.cell_no  || null,
    company_id:   company_id || null,
  }));

  const response = await fetch(`${SUPABASE_URL}/rest/v1/drivers`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,        // ← authenticated user JWT
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase error ${response.status}: ${errText}`);
  }

  return await response.json();
}

// ============================================================
//  5. MAIN SYNC FLOW
// ============================================================

function setStatus(msg, color = 'rgba(0,0,0,0.75)') {
  const status = document.getElementById('logifleet-sync-status');
  if (!status) return;
  status.style.display = 'inline-block';
  status.style.background = color;
  status.textContent = msg;
}

async function runSync() {
  const btn = document.getElementById('logifleet-sync-btn');

  // --- Ensure authenticated ---
  setStatus('Checking login…', 'rgba(0,0,0,0.75)');
  let token;
  try {
    token = await ensureLoggedIn();
  } catch(err) {
    setStatus(`✗ Login error: ${err.message}`, 'rgba(160,30,30,0.9)');
    return;
  }

  if (!token) {
    setStatus('Sync cancelled.', 'rgba(80,80,80,0.85)');
    return;
  }

  // Show sign-out button once logged in
  const signOutBtn = document.getElementById('logifleet-signout-btn');
  if (signOutBtn) signOutBtn.style.display = 'inline-block';

  // --- Ask for company_id ---
  const rawCompanyId = prompt(
    'LogiFleet Sync\n\nEnter the Company ID (UUID) to attach to these drivers.\nLeave blank to set company as None.',
    ''
  );
  if (rawCompanyId === null) {
    setStatus('Sync cancelled.', 'rgba(80,80,80,0.85)');
    return;
  }
  const company_id = rawCompanyId.trim() || null;

  // --- Scrape ---
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.textContent = 'Scraping…';
  setStatus('Scanning page for driver records…');

  const drivers = scrapeDrivers();

  if (drivers.length === 0) {
    setStatus('⚠ No driver records found on this page.', 'rgba(160,100,0,0.9)');
    resetButton(btn);
    return;
  }

  setStatus(`Found ${drivers.length} drivers. Syncing…`);
  btn.textContent = 'Syncing…';

  // --- Upsert ---
  try {
    const result = await upsertDrivers(drivers, company_id, token);
    const count = Array.isArray(result) ? result.length : drivers.length;
    setStatus(`✓ ${count} drivers synced!`, 'rgba(30,120,60,0.9)');
    console.log('[LogiFleet] Sync complete:', result);
  } catch (err) {
    // If token expired, clear it so next click re-prompts login
    if (err.message.includes('401')) _accessToken = null;
    setStatus(`✗ ${err.message}`, 'rgba(160,30,30,0.9)');
    console.error('[LogiFleet] Sync error:', err);
  } finally {
    resetButton(btn);
  }
}

function resetButton(btn) {
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.textContent = '⬆ Sync Drivers to LogiFleet';
}

// ============================================================
//  6. INIT
// ============================================================

injectButton();
