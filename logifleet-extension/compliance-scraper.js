// ============================================================
//  LogiFleet Compliance Scraper v2 — compliance-scraper.js
//  - Sequential processing with 600-1200ms jitter
//  - localStorage checkpointing every 5 drivers
//  - Resume detection on load
//  - Live upsert to Supabase every checkpoint
//  - CSV backup download on completion
// ============================================================

const BASE_URL       = 'https://backend.mrt.co.za';
const CS_SUPABASE_URL   = 'https://brzrzlsueddmiozybqbr.supabase.co';
const CS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyenJ6bHN1ZWRkbWlvenlicWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTQ1NTMsImV4cCI6MjA5NTUzMDU1M30.3uFV1WEDv8XnPOTz1ExQ82eS22UPr5SZ98mm_2fopK4';
const CHECKPOINT_KEY = 'lf_compliance_checkpoint';
const BATCH_SIZE     = 5;

let _cs_accessToken = null;
let _cs_cs_stopRequested = false;

// ============================================================
//  UTILITIES
// ============================================================

const cs_jitter = (min = 600, max = 1200) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

const cs_parseHTML = html => new DOMParser().parseFromString(html, 'text/html');

async function cs_fetchPage(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return cs_parseHTML(await res.text());
}

// ============================================================
//  CHECKPOINT — localStorage
// ============================================================

function saveCheckpoint(data) {
  try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(data)); } catch(e) {}
}

function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function clearCheckpoint() {
  try { localStorage.removeItem(CHECKPOINT_KEY); } catch(e) {}
}

// ============================================================
//  AUTH — reuse token from content.js if available,
//         otherwise show login dialog
// ============================================================

function showComplianceLoginDialog() {
  return new Promise(resolve => {
    const existing = document.getElementById('lf-comp-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'lf-comp-login-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:32px 28px;width:340px;box-shadow:0 8px 40px rgba(0,0,0,0.22);">
        <div style="font-size:20px;font-weight:800;margin-bottom:4px;color:#1a1714;">Logi<span style="color:#c75b2a">Fleet</span></div>
        <div style="font-size:12px;color:#8c8278;margin-bottom:24px;">Sign in to sync compliance data</div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#8c8278;display:block;margin-bottom:5px;">Email</label>
        <input id="lf-comp-email" type="email" placeholder="you@example.com" style="width:100%;padding:9px 12px;border:1px solid #e0dbd3;border-radius:7px;font-size:13px;outline:none;margin-bottom:14px;box-sizing:border-box;font-family:inherit;color:#1a1714;"/>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#8c8278;display:block;margin-bottom:5px;">Password</label>
        <input id="lf-comp-password" type="password" placeholder="••••••••" style="width:100%;padding:9px 12px;border:1px solid #e0dbd3;border-radius:7px;font-size:13px;outline:none;margin-bottom:6px;box-sizing:border-box;font-family:inherit;color:#1a1714;"/>
        <div id="lf-comp-error" style="color:#c0392b;font-size:12px;min-height:18px;margin-bottom:14px;"></div>
        <div style="display:flex;gap:8px;">
          <button id="lf-comp-cancel" style="flex:1;padding:10px;border:1px solid #e0dbd3;background:#f5f4f1;border-radius:7px;cursor:pointer;font-size:13px;color:#8c8278;font-family:inherit;">Cancel</button>
          <button id="lf-comp-submit" style="flex:2;padding:10px;background:#1a6fc7;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;">Sign In</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const emailEl  = overlay.querySelector('#lf-comp-email');
    const passEl   = overlay.querySelector('#lf-comp-password');
    const errEl    = overlay.querySelector('#lf-comp-error');
    const submitEl = overlay.querySelector('#lf-comp-submit');
    const cancelEl = overlay.querySelector('#lf-comp-cancel');

    emailEl.focus();
    const dismiss = r => { overlay.remove(); resolve(r); };
    cancelEl.addEventListener('click', () => dismiss(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(null); });

    const trySubmit = async () => {
      const email = emailEl.value.trim(), password = passEl.value;
      if (!email || !password) { errEl.textContent = 'Email and password required.'; return; }
      submitEl.textContent = 'Signing in…'; submitEl.disabled = true; errEl.textContent = '';
      try {
        const res = await fetch(`${CS_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'apikey': CS_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.message || 'Login failed');
        _cs_accessToken = data.access_token;
        dismiss(true);
      } catch(err) {
        errEl.textContent = err.message;
        submitEl.textContent = 'Sign In'; submitEl.disabled = false;
      }
    };

    submitEl.addEventListener('click', trySubmit);
    passEl.addEventListener('keydown',  e => { if (e.key === 'Enter') trySubmit(); });
    emailEl.addEventListener('keydown', e => { if (e.key === 'Enter') passEl.focus(); });
  });
}

async function ensureAuth() {
  // Reuse token from the sync button (content.js) if it signed in already
  if (window._accessToken) { _cs_accessToken = window._accessToken; return true; }
  if (_cs_accessToken) return true;
  const result = await showComplianceLoginDialog();
  return !!result;
}

// ============================================================
//  SCRAPERS
// ============================================================

function scrapeEditPage(doc) {
  const hasImage = (labelText) => {
    for (const bold of doc.querySelectorAll('label b')) {
      if (!bold.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) continue;
      const container = bold.closest('div.controls') || bold.closest('div.form-group');
      if (!container) continue;
      return !!container.querySelector('a[href*="/deletecarpic/"], a[href*="/deleteprofilepic/"], a[href*="/deletedriver"]');
    }
    // fallback: check by known input IDs for GIT and Owner Proof of Address
    const idMap = {
      'git cover':              'GitImage',
      'owner proof of address': 'OwnerAddressCarImage',
    };
    const key = labelText.toLowerCase();
    const inputId = idMap[key];
    if (inputId) {
      const input = doc.getElementById(inputId);
      if (input) {
        const container = input.closest('div.controls') || input.closest('div.form-group');
        if (container) return !!container.querySelector('a[href*="/delete"]');
      }
    }
    return false;
  };
  const vehicle_images = ['Vehicle Front Photo','Vehicle Back Photo With Number Plate','Vehicle Photo Left','Vehicle Photo Right']
    .some(lbl => hasImage(lbl));
  return {
    vehicle_images,
    owner_proof_of_address: hasImage('Owner Proof Of Address'),
    git_insurance:          hasImage('GIT Cover'),
  };
}

function scrapeAssetsPage(doc) {
  const titles = Array.from(doc.querySelectorAll('figure .modal-title'))
    .map(el => el.textContent.trim().toLowerCase());
  const has = kw => titles.some(t => t.includes(kw.toLowerCase()));
  return {
    owner_id:                has('Vehicle Owner ID') || has('Owner Passport'),
    owner_licence:           has('Vehicle Owner Driving License') || has('Owner Driving Licence'),
    driver_licence:          has('Driver License') || has('Driver Licence'),
    driver_pdp:              has('Driver PDP') || has('Public Driving Permit'),
    vehicle_licence_disc:    has('Vehicle NATIS') || has('NATIS'),
    driver_proof_of_address: has('Driver Proof Of Address'),
    vehicle_insurance:       has('Proof of Vehicle Insurance') || has('Vehicle Insurance'),
  };
}

// ============================================================
//  SUPABASE UPSERT BATCH
// ============================================================

async function upsertBatch(rows) {
  if (!_cs_accessToken) return;
  const payload = rows.map(r => ({
    profile_id:              r.profile_id,
    vehicle_images:          r.vehicle_images,
    owner_proof_of_address:  r.owner_proof_of_address,
    git_insurance:           r.git_insurance,
    owner_id:                r.owner_id,
    owner_licence:           r.owner_licence,
    driver_licence:          r.driver_licence,
    driver_pdp:              r.driver_pdp,
    vehicle_licence_disc:    r.vehicle_licence_disc,
    driver_proof_of_address: r.driver_proof_of_address,
    vehicle_insurance:       r.vehicle_insurance,
    updated_at:              new Date().toISOString(),
  }));

  const res = await fetch(`${CS_SUPABASE_URL}/rest/v1/drivers`, {
    method: 'POST',
    headers: {
      'apikey':        CS_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${_cs_accessToken}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.warn(`[LogiFleet] Supabase upsert failed for batch:`, txt);
  } else {
    console.log(`[LogiFleet] ✓ Upserted ${payload.length} drivers to Supabase`);
  }
}

// ============================================================
//  CSV
// ============================================================

function generateCSV(rows) {
  const headers = ['profile_id','vehicle_images','owner_proof_of_address','git_insurance',
    'owner_id','owner_licence','driver_licence','driver_pdp',
    'vehicle_licence_disc','driver_proof_of_address','vehicle_insurance'];
  const lines = [headers.join(',')];
  for (const row of rows)
    lines.push(headers.map(h => String(row[h] ?? false).toUpperCase()).join(','));
  return lines.join('\n');
}

function downloadCSV(rows) {
  const blob = new Blob([generateCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `logifleet-compliance-${new Date().toISOString().slice(0,10)}.csv`
  });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ============================================================
//  UI
// ============================================================

function injectComplianceButton() {
  if (document.getElementById('lf-compliance-btn')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'lf-compliance-wrapper';
  wrapper.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  const log = document.createElement('div');
  log.id = 'lf-compliance-log';
  log.style.cssText = `
    background: rgba(0,0,0,0.82); color: #fff; padding: 10px 14px;
    border-radius: 8px; font-size: 12px; display: none; max-width: 320px;
    line-height: 1.6; text-align: right;
  `;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const stopBtn = document.createElement('button');
  stopBtn.id = 'lf-compliance-stop';
  stopBtn.textContent = '⏹ Stop';
  stopBtn.style.cssText = `
    background: #c0392b; color: #fff; border: none; padding: 11px 14px;
    border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    display: none; box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  `;
  stopBtn.onclick = () => {
    _cs_stopRequested = true;
    stopBtn.textContent = 'Stopping…';
    stopBtn.disabled = true;
  };

  const btn = document.createElement('button');
  btn.id = 'lf-compliance-btn';
  btn.style.cssText = `
    background: #1a6fc7; color: #fff; border: none; padding: 11px 20px;
    border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2); white-space: nowrap;
  `;

  // Check for existing checkpoint to set button label
  const cp = loadCheckpoint();
  if (cp && cp.completed < cp.total) {
    btn.textContent = `▶ Resume Compliance (${cp.completed}/${cp.total})`;
    btn.style.background = '#d68910';
  } else {
    btn.textContent = '📋 Scrape Compliance Data';
  }

  btn.addEventListener('click', runComplianceScrape);
  btnRow.appendChild(stopBtn);
  btnRow.appendChild(btn);
  wrapper.appendChild(log);
  wrapper.appendChild(btnRow);
  document.body.appendChild(wrapper);
}

function setLog(msg, color = 'rgba(0,0,0,0.82)') {
  const log = document.getElementById('lf-compliance-log');
  if (!log) return;
  log.style.display = 'block';
  log.style.background = color;
  log.innerHTML = msg;
}

function setBtn(text, color = '#1a6fc7', disabled = false) {
  const btn = document.getElementById('lf-compliance-btn');
  if (!btn) return;
  btn.textContent = text;
  btn.style.background = color;
  btn.disabled = disabled;
  btn.style.opacity = disabled ? '0.65' : '1';
}

function showStopBtn(visible) {
  const s = document.getElementById('lf-compliance-stop');
  if (s) s.style.display = visible ? 'inline-block' : 'none';
}

// ============================================================
//  GET DRIVER IDS FROM PAGE
// ============================================================

function getDriverIdsFromPage() {
  const anchors = document.querySelectorAll('div.media-body.pl-1 p.text-bold-600 a[href]');
  const ids = [];
  anchors.forEach(a => {
    const match = a.getAttribute('href').match(/(\d+)\s*$/);
    if (match) ids.push(match[1]);
  });
  return [...new Set(ids)];
}

// ============================================================
//  MAIN LOOP
// ============================================================

async function runComplianceScrape() {
  _cs_stopRequested = false;

  // Auth first
  const authed = await ensureAuth();
  if (!authed) { setLog('Cancelled — not signed in.', 'rgba(80,80,80,0.9)'); return; }

  // Load checkpoint or start fresh
  let cp = loadCheckpoint();
  let allIds, results, startIndex;

  const pageIds = getDriverIdsFromPage();
  if (pageIds.length === 0) {
    setLog('⚠ No driver IDs found. Make sure you\'re on the drivers list with "Show All" active.', 'rgba(160,100,0,0.9)');
    return;
  }

  if (cp && cp.total === pageIds.length && cp.completed < cp.total) {
    // Resume existing run
    allIds     = cp.allIds;
    results    = cp.results;
    startIndex = cp.completed;
    setLog(`▶ Resuming from driver ${startIndex + 1}/${cp.total}…`);
  } else {
    // Fresh start — clear any stale checkpoint
    clearCheckpoint();
    allIds     = pageIds;
    results    = [];
    startIndex = 0;
  }

  const total = allIds.length;
  setBtn(`Processing 0/${total}…`, '#1a6fc7', true);
  showStopBtn(true);

  // ---- SEQUENTIAL LOOP ----
  for (let i = startIndex; i < allIds.length; i++) {
    if (_cs_stopRequested) {
      setLog(`⏸ Stopped at ${i}/${total}.<br>Click Resume to continue.`, 'rgba(80,80,80,0.9)');
      setBtn(`▶ Resume Compliance (${i}/${total})`, '#d68910', false);
      showStopBtn(false);
      // Save checkpoint so resume works
      saveCheckpoint({ allIds, results, completed: i, total });
      return;
    }

    const id       = allIds[i];
    const progress = `${i + 1}/${total}`;
    setBtn(`Processing ${progress}…`, '#1a6fc7', true);
    setLog(`⏳ <b>Driver ${progress}</b> — ID: ${id}<br>Fetching edit page…`);

    let row = {
      profile_id: id,
      vehicle_images: false, owner_proof_of_address: false, git_insurance: false,
      owner_id: false, owner_licence: false, driver_licence: false,
      driver_pdp: false, vehicle_licence_disc: false,
      driver_proof_of_address: false, vehicle_insurance: false,
    };

    try {
      const editDoc  = await cs_fetchPage(`${BASE_URL}/admin/drivers/edit/${id}`);
      Object.assign(row, scrapeEditPage(editDoc));

      await cs_jitter(600, 1200);

      setLog(`⏳ <b>Driver ${progress}</b> — ID: ${id}<br>Fetching documents page…`);
      const assetsDoc = await cs_fetchPage(`${BASE_URL}/admin/drivers/addupload_assets/${id}/1`);
      Object.assign(row, scrapeAssetsPage(assetsDoc));

      console.log(`[LogiFleet] ✓ ${id}`, row);
    } catch(err) {
      console.error(`[LogiFleet] ✗ Driver ${id}:`, err.message);
      row._error = err.message;
    }

    results.push(row);

    // ---- CHECKPOINT every BATCH_SIZE drivers ----
    if ((i + 1) % BATCH_SIZE === 0 || i === allIds.length - 1) {
      // Save progress
      saveCheckpoint({ allIds, results, completed: i + 1, total });

      // Upsert this batch to Supabase
      const batchStart = results.length - (results.length % BATCH_SIZE || BATCH_SIZE);
      const batch = results.slice(batchStart);
      setLog(`⏳ <b>Driver ${progress}</b><br>💾 Saving batch to LogiFleet…`);
      await upsertBatch(batch);
    }

    // Jitter between drivers (skip after last)
    if (i < allIds.length - 1) await cs_jitter(600, 1200);
  }

  // ---- DONE ----
  showStopBtn(false);
  clearCheckpoint();

  const failed = results.filter(r => r._error).length;
  const failNote = failed > 0 ? `<br>⚠ ${failed} errors (check console)` : '';

  setLog(
    `✅ <b>Complete!</b> ${results.length} drivers processed.${failNote}<br>📥 Downloading CSV backup…`,
    'rgba(25,100,50,0.9)'
  );
  setBtn('📋 Scrape Compliance Data', '#1a6fc7', false);

  downloadCSV(results);
  console.log('[LogiFleet] All done. Results:', results);
}

// ============================================================
//  INIT
// ============================================================

injectComplianceButton();
