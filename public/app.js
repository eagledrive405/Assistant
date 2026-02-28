/* ═══════════════════════════════════════════════════════════════════════════
   Work Product Manager — Frontend SPA
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  products: [],
  selectedId: null,
  emails: [],
  notes: [],
  activeTab: 'overview',
  viewingEmailId: null,
  searchQuery: '',
};

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $sidebarList  = document.getElementById('sidebar-list');
const $mainContent  = document.getElementById('main-content');
const $headerStatus = document.getElementById('header-status');

// ── API Helper ─────────────────────────────────────────────────────────────
const api = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get:    (url)        => api.request('GET',    url),
  post:   (url, body)  => api.request('POST',   url, body),
  put:    (url, body)  => api.request('PUT',    url, body),
  delete: (url)        => api.request('DELETE', url),
};

// ── Toast Notifications ────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `show toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

// ── Utility ────────────────────────────────────────────────────────────────
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s) {
  return { todo: 'To Do', 'in-progress': 'In Progress', review: 'In Review', blocked: 'Blocked', done: 'Done' }[s] || s;
}

function badgeHtml(status) {
  return `<span class="badge badge-${status}">${statusLabel(status)}</span>`;
}

function selectedProduct() {
  return state.products.find(p => p.id === state.selectedId) || null;
}

// ── Modals ─────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ── Sidebar Rendering ──────────────────────────────────────────────────────
function renderSidebar() {
  const query = state.searchQuery.toLowerCase();
  const filtered = state.products.filter(p =>
    p.title.toLowerCase().includes(query) ||
    (p.description || '').toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    $sidebarList.innerHTML = `<div class="empty-state-small">${
      state.searchQuery ? 'No results found.' : 'No work products yet.'
    }</div>`;
    return;
  }

  $sidebarList.innerHTML = filtered.map(p => `
    <div class="product-item ${p.id === state.selectedId ? 'active' : ''}"
         data-id="${p.id}" role="button" tabindex="0">
      <div class="product-item-title">${escHtml(p.title)}</div>
      <div class="product-item-meta">
        ${badgeHtml(p.status)}
        <span class="product-item-counts">
          ${p.email_count || 0} email${p.email_count !== 1 ? 's' : ''}
          · ${p.note_count || 0} note${p.note_count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  `).join('');

  $sidebarList.querySelectorAll('.product-item').forEach(el => {
    el.addEventListener('click', () => selectProduct(parseInt(el.dataset.id)));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') selectProduct(parseInt(el.dataset.id)); });
  });
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Main Content Rendering ─────────────────────────────────────────────────
function renderWelcome() {
  $mainContent.innerHTML = `
    <div class="welcome-state">
      <div class="welcome-icon">◈</div>
      <h2>Work Product Manager</h2>
      <p>Select a work product from the sidebar, or create a new one to get started.</p>
      <button class="btn btn-primary" id="btn-new-product-main">+ New Work Product</button>
    </div>`;
  document.getElementById('btn-new-product-main').addEventListener('click', openNewProductModal);
}

function renderProductDetail() {
  const p = selectedProduct();
  if (!p) return renderWelcome();

  const emailCount = state.emails.length;
  const noteCount  = state.notes.length;

  $mainContent.innerHTML = `
    <div class="product-header">
      <div class="product-title-row">
        <input type="text" id="product-title-input" class="product-title"
               value="${escHtml(p.title)}" placeholder="Work product title…" />
        <select id="product-status-select" class="status-select">
          ${['todo','in-progress','review','blocked','done'].map(s =>
            `<option value="${s}" ${p.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`
          ).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="btn-save-product">Save</button>
        <button class="btn btn-danger btn-sm" id="btn-delete-product">Delete</button>
      </div>
      <div class="tabs">
        ${['overview','emails','notes'].map(tab => `
          <button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
            ${tab.charAt(0).toUpperCase() + tab.slice(1)}
            ${tab === 'emails' ? `<span class="tab-count">${emailCount}</span>` : ''}
            ${tab === 'notes'  ? `<span class="tab-count">${noteCount}</span>`  : ''}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="tab-content" id="tab-content"></div>
  `;

  // Tab switching
  $mainContent.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderProductDetail();
    });
  });

  // Save product
  document.getElementById('btn-save-product').addEventListener('click', saveProduct);
  document.getElementById('btn-delete-product').addEventListener('click', deleteProduct);
  document.getElementById('product-title-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveProduct();
  });

  // Render active tab
  const tabEl = document.getElementById('tab-content');
  if (state.activeTab === 'overview') renderOverviewTab(tabEl, p);
  if (state.activeTab === 'emails')   renderEmailsTab(tabEl);
  if (state.activeTab === 'notes')    renderNotesTab(tabEl);
}

// ── Overview Tab ───────────────────────────────────────────────────────────
function renderOverviewTab(container, p) {
  const emailCount = state.emails.length;
  const noteCount  = state.notes.length;

  container.innerHTML = `
    <div class="overview-grid">
      <div class="stat-card">
        <div class="stat-label">Emails</div>
        <div class="stat-value">${emailCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Notes</div>
        <div class="stat-value">${noteCount}</div>
      </div>
    </div>

    <div class="section-title">Description</div>
    <textarea id="product-description" class="description-area"
      placeholder="Add a description for this work product…">${escHtml(p.description || '')}</textarea>
    <div class="save-row">
      <button class="btn btn-ghost btn-sm" id="btn-save-desc">Save Description</button>
    </div>

    <div class="section-title">AI Summary</div>
    <div class="ai-summary-card">
      <div class="ai-summary-header">
        <div class="ai-summary-label">✦ Claude Summary</div>
        <button class="btn btn-ai btn-sm" id="btn-gen-summary">
          ${p.ai_summary ? '↻ Regenerate' : '✦ Generate Summary'}
        </button>
      </div>
      <div id="summary-loading" class="ai-loading" style="display:none">
        <span class="spinner"></span> Claude is analysing your work product…
      </div>
      <div id="summary-content" class="${p.ai_summary ? 'ai-summary-text' : 'ai-summary-empty'}">
        ${p.ai_summary
          ? escHtml(p.ai_summary)
          : 'Generate a summary to get a quick overview of this work product, including action items and next steps.'}
      </div>
    </div>

    <div style="margin-top:12px;color:var(--text-3);font-size:11px">
      Created ${formatDate(p.created_at)} · Last updated ${formatDate(p.updated_at)}
    </div>
  `;

  document.getElementById('btn-save-desc').addEventListener('click', async () => {
    const desc = document.getElementById('product-description').value;
    await saveProductField({ description: desc });
    toast('Description saved');
  });

  document.getElementById('btn-gen-summary').addEventListener('click', generateSummary);
}

// ── Emails Tab ─────────────────────────────────────────────────────────────
function renderEmailsTab(container) {
  container.innerHTML = `
    <div class="emails-toolbar">
      <span style="color:var(--text-2);font-size:13px">${state.emails.length} email${state.emails.length !== 1 ? 's' : ''}</span>
      <button class="btn btn-primary btn-sm" id="btn-add-email">+ Add Email</button>
    </div>
    ${state.emails.length === 0
      ? `<div class="empty-state-tab">
           <div style="font-size:32px">✉</div>
           <p>No emails yet. Add an email to track correspondence for this work product.</p>
         </div>`
      : state.emails.map(email => renderEmailCard(email)).join('')
    }
  `;

  document.getElementById('btn-add-email').addEventListener('click', openAddEmailModal);
  container.querySelectorAll('[data-view-email]').forEach(btn => {
    btn.addEventListener('click', () => openViewEmailModal(parseInt(btn.dataset.viewEmail)));
  });
  container.querySelectorAll('[data-delete-email]').forEach(btn => {
    btn.addEventListener('click', () => deleteEmail(parseInt(btn.dataset.deleteEmail)));
  });
}

function renderEmailCard(email) {
  return `
    <div class="email-card">
      <div class="email-card-header">
        <div class="email-card-info">
          <div class="email-card-subject">${escHtml(email.subject || '(no subject)')}</div>
          <div class="email-card-from">From: ${escHtml(email.from_email || '—')}</div>
        </div>
        <div class="email-card-date">${formatDate(email.received_at)}</div>
        ${email.ai_reply ? '<span class="has-reply-badge">✦ AI reply</span>' : ''}
        <div class="email-card-actions">
          <button class="btn btn-ghost btn-sm" data-view-email="${email.id}">View</button>
          <button class="btn btn-icon" data-delete-email="${email.id}" title="Delete email">✕</button>
        </div>
      </div>
    </div>
  `;
}

// ── Notes Tab ──────────────────────────────────────────────────────────────
function renderNotesTab(container) {
  container.innerHTML = `
    <textarea id="new-note-input" class="note-input-area" rows="3"
      placeholder="Type a note… (Ctrl+Enter to save)"></textarea>
    <div class="note-add-row">
      <button class="btn btn-primary btn-sm" id="btn-add-note">+ Add Note</button>
    </div>
    ${state.notes.length === 0
      ? `<div class="empty-state-tab">
           <div style="font-size:32px">📝</div>
           <p>No notes yet. Add notes to keep track of important information.</p>
         </div>`
      : state.notes.map(note => `
          <div class="note-card">
            <div class="note-card-body">
              <div class="note-card-text">${escHtml(note.content)}</div>
              <div class="note-card-date">${formatDate(note.created_at)}</div>
            </div>
            <div class="note-card-actions">
              <button class="btn btn-icon" data-delete-note="${note.id}" title="Delete note">✕</button>
            </div>
          </div>
        `).join('')
    }
  `;

  const noteInput = document.getElementById('new-note-input');
  document.getElementById('btn-add-note').addEventListener('click', () => addNote(noteInput.value));
  noteInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(noteInput.value);
  });
  container.querySelectorAll('[data-delete-note]').forEach(btn => {
    btn.addEventListener('click', () => deleteNote(parseInt(btn.dataset.deleteNote)));
  });
}

// ── Data Actions ───────────────────────────────────────────────────────────
async function loadProducts() {
  state.products = await api.get('/api/work-products');
  renderSidebar();
}

async function selectProduct(id) {
  state.selectedId = id;
  state.activeTab  = 'overview';
  renderSidebar();
  $mainContent.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3)"><span class="spinner"></span></div>`;

  const [emails, notes] = await Promise.all([
    api.get(`/api/work-products/${id}/emails`),
    api.get(`/api/work-products/${id}/notes`),
  ]);
  state.emails = emails;
  state.notes  = notes;
  renderProductDetail();
}

async function saveProduct() {
  const p = selectedProduct();
  if (!p) return;
  const title  = document.getElementById('product-title-input')?.value?.trim();
  const status = document.getElementById('product-status-select')?.value;
  if (!title) return toast('Title cannot be empty', 'error');
  await saveProductField({ title, status });
  toast('Saved');
}

async function saveProductField(fields) {
  const p = selectedProduct();
  if (!p) return;
  const updated = await api.put(`/api/work-products/${p.id}`, { ...p, ...fields });
  const idx = state.products.findIndex(x => x.id === p.id);
  if (idx !== -1) state.products[idx] = { ...state.products[idx], ...updated };
  renderSidebar();
}

async function deleteProduct() {
  const p = selectedProduct();
  if (!p) return;
  if (!confirm(`Delete "${p.title}" and all its emails and notes?`)) return;
  await api.delete(`/api/work-products/${p.id}`);
  state.products = state.products.filter(x => x.id !== p.id);
  state.selectedId = null;
  state.emails = [];
  state.notes  = [];
  renderSidebar();
  renderWelcome();
  toast('Work product deleted');
}

async function generateSummary() {
  const p = selectedProduct();
  if (!p) return;
  const btn = document.getElementById('btn-gen-summary');
  const loading = document.getElementById('summary-loading');
  const content = document.getElementById('summary-content');
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'flex';
  if (content) content.style.display = 'none';
  try {
    const { summary } = await api.post(`/api/work-products/${p.id}/ai-summary`);
    const idx = state.products.findIndex(x => x.id === p.id);
    if (idx !== -1) state.products[idx].ai_summary = summary;
    if (content) {
      content.textContent = summary;
      content.className = 'ai-summary-text';
      content.style.display = '';
    }
    if (btn) { btn.textContent = '↻ Regenerate'; btn.disabled = false; }
    if (loading) loading.style.display = 'none';
  } catch (err) {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = '';
    toast('Failed to generate summary: ' + err.message, 'error');
  }
}

// ── Email Actions ──────────────────────────────────────────────────────────
function openAddEmailModal() {
  document.getElementById('email-from').value    = '';
  document.getElementById('email-to').value      = '';
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value    = '';
  document.getElementById('email-date').value    = new Date().toISOString().slice(0, 16);
  openModal('modal-add-email');
  document.getElementById('email-subject').focus();
}

async function saveEmail() {
  const p = selectedProduct();
  if (!p) return;
  const body = {
    from_email:  document.getElementById('email-from').value,
    to_email:    document.getElementById('email-to').value,
    subject:     document.getElementById('email-subject').value,
    body:        document.getElementById('email-body').value,
    received_at: document.getElementById('email-date').value,
  };
  if (!body.body.trim()) return toast('Email body is required', 'error');
  const email = await api.post(`/api/work-products/${p.id}/emails`, body);
  state.emails.unshift(email);
  const idx = state.products.findIndex(x => x.id === p.id);
  if (idx !== -1) state.products[idx].email_count = (state.products[idx].email_count || 0) + 1;
  closeModal('modal-add-email');
  renderProductDetail();
  toast('Email added');
}

async function deleteEmail(emailId) {
  if (!confirm('Delete this email?')) return;
  await api.delete(`/api/emails/${emailId}`);
  state.emails = state.emails.filter(e => e.id !== emailId);
  const p = selectedProduct();
  if (p) {
    const idx = state.products.findIndex(x => x.id === p.id);
    if (idx !== -1) state.products[idx].email_count = Math.max(0, (state.products[idx].email_count || 1) - 1);
  }
  renderProductDetail();
  toast('Email deleted');
}

function openViewEmailModal(emailId) {
  const email = state.emails.find(e => e.id === emailId);
  if (!email) return;
  state.viewingEmailId = emailId;

  document.getElementById('view-email-subject').textContent = email.subject || '(no subject)';
  document.getElementById('view-email-from').textContent    = email.from_email || '—';
  document.getElementById('view-email-to').textContent      = email.to_email || '—';
  document.getElementById('view-email-date').textContent    = formatDate(email.received_at);
  document.getElementById('view-email-body').textContent    = email.body || '';
  document.getElementById('view-email-reply').value         = email.ai_reply || '';
  document.getElementById('ai-reply-loading').style.display = 'none';

  const actionsEl = document.getElementById('ai-reply-actions');
  actionsEl.style.display = email.ai_reply ? 'flex' : 'none';

  openModal('modal-view-email');
}

async function generateReply() {
  const emailId = state.viewingEmailId;
  if (!emailId) return;
  const tone = document.getElementById('reply-tone').value;
  const btn  = document.getElementById('btn-generate-reply');
  const loading = document.getElementById('ai-reply-loading');
  const textarea = document.getElementById('view-email-reply');
  const actions  = document.getElementById('ai-reply-actions');

  btn.disabled = true;
  loading.style.display = 'flex';
  textarea.style.display = 'none';
  try {
    const { reply } = await api.post(`/api/emails/${emailId}/ai-reply`, { tone });
    const idx = state.emails.findIndex(e => e.id === emailId);
    if (idx !== -1) state.emails[idx].ai_reply = reply;
    textarea.value = reply;
    textarea.style.display = '';
    actions.style.display = 'flex';
    toast('Reply generated');
  } catch (err) {
    textarea.style.display = '';
    toast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    loading.style.display = 'none';
  }
}

// ── Note Actions ───────────────────────────────────────────────────────────
async function addNote(content) {
  const p = selectedProduct();
  if (!p || !content?.trim()) return toast('Note content cannot be empty', 'error');
  const note = await api.post(`/api/work-products/${p.id}/notes`, { content: content.trim() });
  state.notes.unshift(note);
  const idx = state.products.findIndex(x => x.id === p.id);
  if (idx !== -1) state.products[idx].note_count = (state.products[idx].note_count || 0) + 1;
  renderProductDetail();
  toast('Note added');
}

async function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  await api.delete(`/api/notes/${noteId}`);
  state.notes = state.notes.filter(n => n.id !== noteId);
  const p = selectedProduct();
  if (p) {
    const idx = state.products.findIndex(x => x.id === p.id);
    if (idx !== -1) state.products[idx].note_count = Math.max(0, (state.products[idx].note_count || 1) - 1);
  }
  renderProductDetail();
  toast('Note deleted');
}

// ── New Product Modal ──────────────────────────────────────────────────────
function openNewProductModal() {
  document.getElementById('new-product-title').value       = '';
  document.getElementById('new-product-description').value = '';
  document.getElementById('new-product-status').value      = 'todo';
  openModal('modal-new-product');
  setTimeout(() => document.getElementById('new-product-title').focus(), 50);
}

async function createProduct() {
  const title       = document.getElementById('new-product-title').value.trim();
  const description = document.getElementById('new-product-description').value.trim();
  const status      = document.getElementById('new-product-status').value;
  if (!title) return toast('Title is required', 'error');
  const product = await api.post('/api/work-products', { title, description, status });
  state.products.unshift({ ...product, email_count: 0, note_count: 0 });
  closeModal('modal-new-product');
  renderSidebar();
  await selectProduct(product.id);
  toast('Work product created');
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.getElementById('btn-new-product').addEventListener('click', openNewProductModal);
document.getElementById('btn-new-product-welcome')?.addEventListener('click', openNewProductModal);
document.getElementById('btn-create-product').addEventListener('click', createProduct);
document.getElementById('btn-save-email').addEventListener('click', saveEmail);
document.getElementById('btn-generate-reply').addEventListener('click', generateReply);
document.getElementById('btn-regen-reply').addEventListener('click', generateReply);
document.getElementById('btn-copy-reply').addEventListener('click', () => {
  const text = document.getElementById('view-email-reply').value;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
});

document.getElementById('new-product-title').addEventListener('keydown', e => {
  if (e.key === 'Enter') createProduct();
});

document.getElementById('search-input').addEventListener('input', e => {
  state.searchQuery = e.target.value;
  renderSidebar();
});

// ── Boot ───────────────────────────────────────────────────────────────────
(async function init() {
  try {
    await loadProducts();
    if (state.products.length > 0) {
      renderSidebar();
    }
    renderWelcome();
  } catch (err) {
    $mainContent.innerHTML = `<div style="padding:40px;color:var(--red)">Failed to load: ${err.message}</div>`;
  }
})();
