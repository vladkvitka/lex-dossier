/*
  Лекс.Досье — фронтенд этапа 8.
  Названия полей запросов сверены с реальными main.py / schemas.py / models.py
  сервера (вход, категории, шаблоны, поля шаблона).
*/

const API = '/api';

let state = {
  token: localStorage.getItem('lex_token') || null,
  role: localStorage.getItem('lex_role') || null,
  fullName: localStorage.getItem('lex_full_name') || null,
  categories: [],
  templates: [],
  cases: [],
};

// Направления дел — по данным из prototype.html (data-branch="civil_admin"/"svo").
// Если в реальной системе используются другие ключи направления, поправить здесь.
const BRANCHES = [
  { value: 'civil_admin', label: 'Гражданские и административные дела' },
  { value: 'svo', label: 'Участники СВО' },
];

// ---------- вспомогательные функции ----------

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2500);
}

async function api(path, options={}){
  const headers = options.headers || {};
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, {...options, headers});
  if (res.status === 401){
    // токен истёк или недействителен — возвращаем на экран входа
    doLogout();
    throw new Error('Сессия истекла, войдите заново');
  }
  let body = null;
  try { body = await res.json(); } catch(e) { /* нет тела ответа */ }
  if (!res.ok){
    const detail = body && body.detail ? JSON.stringify(body.detail) : ('HTTP ' + res.status);
    throw new Error(detail);
  }
  return body;
}

// ---------- вход ----------

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Входим...';

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    });

    // TokenResponse содержит access_token, role и full_name сразу —
    // отдельный запрос /auth/me не нужен.
    const token = data.access_token;
    if (!token) throw new Error('Сервер не вернул токен (проверьте поле access_token в ответе)');
    state.token = token;
    state.role = data.role;
    state.fullName = data.full_name;
    localStorage.setItem('lex_token', token);
    localStorage.setItem('lex_role', data.role || '');
    localStorage.setItem('lex_full_name', data.full_name || '');

    await enterApp();
  } catch (err){
    errBox.textContent = 'Не удалось войти: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
}

function doLogout(){
  state.token = null;
  state.role = null;
  state.fullName = null;
  localStorage.removeItem('lex_token');
  localStorage.removeItem('lex_role');
  localStorage.removeItem('lex_full_name');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginShell').style.display = 'flex';
}

// ---------- вход в приложение после успешной авторизации ----------

async function enterApp(){
  document.getElementById('loginShell').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  const role = state.role || 'lawyer';
  const name = state.fullName || '—';
  document.getElementById('userName').textContent = name;
  document.getElementById('userAvatar').textContent = name.slice(0,2).toUpperCase();

  if (role === 'admin'){
    document.getElementById('nav-admin').style.display = 'block';
    document.getElementById('nav-lawyer').style.display = 'none';
    await loadCategories();
    await loadTemplates();
    await loadCasesList();
    switchNav('admin-categories', document.querySelector('[data-nav=admin-categories]'));
  } else {
    document.getElementById('nav-lawyer').style.display = 'block';
    document.getElementById('nav-admin').style.display = 'none';
    await loadCategories();
    await loadTemplates();
    await loadCasesList();
    switchNav('cases-list', document.querySelector('#nav-lawyer [data-nav=cases-list]'));
  }
}

function switchNav(screenId, btn){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+screenId).classList.add('active');
  const parent = btn ? btn.closest('.sidenav') : null;
  if (parent){
    parent.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
}

// ---------- категории ----------

async function loadCategories(){
  state.categories = await api('/categories');
  renderCategoryTree();
  renderCategorySelects();
}

function renderCategoryTree(){
  const box = document.getElementById('adminTree');
  if (!state.categories.length){
    box.innerHTML = '<div class="tree-empty">Категорий пока нет — добавьте первую выше</div>';
    return;
  }
  const byParent = {};
  state.categories.forEach(c=>{
    const p = c.parent_id || 'root';
    (byParent[p] = byParent[p] || []).push(c);
  });
  function renderLevel(parentKey, depth){
    const items = byParent[parentKey] || [];
    return items.map(c => `
      <div class="tree-row" style="padding-left:${12 + depth*20}px;">
        <span class="tree-name">${escapeHtml(c.name)}${!c.is_active ? ' <span style="color:var(--muted);">(неактивна)</span>' : ''}</span>
      </div>
      ${renderLevel(c.id, depth+1)}
    `).join('');
  }
  // Корневые категории группируем по направлению (branch), т.к. это два
  // самостоятельных дерева — гражданские/административные дела и СВО.
  const roots = byParent['root'] || [];
  const grouped = BRANCHES.map(b => ({
    ...b,
    items: roots.filter(c => c.branch === b.value),
  })).filter(g => g.items.length);

  if (!grouped.length){
    box.innerHTML = '<div class="tree-empty">Категорий пока нет — добавьте первую выше</div>';
    return;
  }

  box.innerHTML = grouped.map(g => `
    <div style="padding:10px 12px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:700;">${g.label}</div>
    ${g.items.map(c => `
      <div class="tree-row" style="padding-left:12px;">
        <span class="tree-name">${escapeHtml(c.name)}${!c.is_active ? ' <span style="color:var(--muted);">(неактивна)</span>' : ''}</span>
      </div>
      ${renderLevel(c.id, 1)}
    `).join('')}
  `).join('');
}

function renderCategorySelects(){
  const opts = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('newCatParent').innerHTML =
    '<option value="">— без родителя, верхний уровень —</option>' + opts;
  document.getElementById('newTmplCategory').innerHTML =
    '<option value="">— выберите категорию —</option>' + opts;
  const caseCatSelect = document.getElementById('newCaseCategory');
  if (caseCatSelect){
    caseCatSelect.innerHTML = '<option value="">— выберите категорию —</option>' + opts;
  }
}

async function createCategory(){
  const name = document.getElementById('newCatName').value.trim();
  const branch = document.getElementById('newCatBranch').value;
  const parentId = document.getElementById('newCatParent').value || null;
  if (!name){ toast('Введите название категории'); return; }
  if (!branch){ toast('Выберите направление'); return; }
  const btn = document.getElementById('addCatBtn');
  btn.disabled = true;
  try {
    await api('/categories', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, branch, parent_id: parentId, sort_order: 0 })
    });
    document.getElementById('newCatName').value = '';
    toast('Категория добавлена');
    await loadCategories();
  } catch (err){
    toast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- шаблоны ----------

async function loadTemplates(){
  state.templates = await api('/templates');
  renderAdminTemplates();
  renderLawyerTemplates();
}

function categoryName(id){
  const c = state.categories.find(x => x.id === id);
  return c ? c.name : '—';
}

function renderAdminTemplates(){
  const body = document.getElementById('adminTmplBody');
  if (!body) return;
  if (!state.templates.length){
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted);">Шаблонов пока нет</td></tr>';
    return;
  }
  body.innerHTML = state.templates.map(t => {
    const published = t.status === 'published';
    return `
      <tr>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(categoryName(t.category_id))}</td>
        <td><span class="badge ${published ? 'badge-published' : 'badge-draft'}">${published ? 'Опубликован' : 'Черновик'}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-sm" onclick="openTemplateFields('${t.id}')">Поля</button>
          ${published ? '' : `<button class="btn-primary btn-sm" onclick="publishTemplate('${t.id}')">Опубликовать</button>`}
        </td>
      </tr>`;
  }).join('');
}

function renderLawyerTemplates(){
  const body = document.getElementById('lawyerTmplBody');
  if (!body) return;
  const published = state.templates.filter(t => t.status === 'published');
  if (!published.length){
    body.innerHTML = '<tr><td colspan="3" style="color:var(--muted);">Опубликованных шаблонов пока нет</td></tr>';
    return;
  }
  body.innerHTML = published.map(t => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(categoryName(t.category_id))}</td>
      <td><button class="btn btn-sm" onclick="openTemplateFields('${t.id}')">Показать поля</button></td>
    </tr>`).join('');
}

async function uploadTemplate(){
  const name = document.getElementById('newTmplName').value.trim();
  const categoryId = document.getElementById('newTmplCategory').value;
  const description = document.getElementById('newTmplDescription').value.trim();
  const fileInput = document.getElementById('newTmplFile');
  const errBox = document.getElementById('uploadError');
  errBox.style.display = 'none';

  if (!name || !categoryId || !fileInput.files.length){
    errBox.textContent = 'Заполните название, категорию и выберите файл .docx';
    errBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('uploadTmplBtn');
  btn.disabled = true;
  btn.textContent = 'Загружаем...';

  try {
    const form = new FormData();
    form.append('name', name);
    form.append('category_id', categoryId);
    if (description) form.append('description', description);
    form.append('file', fileInput.files[0]);

    await api('/templates', { method: 'POST', body: form });

    document.getElementById('newTmplName').value = '';
    document.getElementById('newTmplDescription').value = '';
    fileInput.value = '';
    toast('Шаблон загружен, поля найдены автоматически');
    await loadTemplates();
  } catch (err){
    errBox.textContent = 'Ошибка загрузки: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Загрузить и найти поля';
  }
}

async function publishTemplate(id){
  try {
    await api(`/templates/${id}/publish`, { method: 'POST' });
    toast('Шаблон опубликован');
    await loadTemplates();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function openTemplateFields(id){
  try {
    const tmpl = await api(`/templates/${id}`);
    document.getElementById('feTitle').textContent = 'Поля шаблона: ' + tmpl.name;
    const fields = tmpl.fields || [];
    const body = document.getElementById('feTableBody');
    body.innerHTML = fields.length
      ? fields.map(f => `
          <tr>
            <td class="fe-key">{{${escapeHtml(f.field_key)}}}</td>
            <td>${escapeHtml(f.label)}</td>
            <td>${escapeHtml(f.field_type)}</td>
            <td style="text-align:center;">${f.is_required ? '✓' : '—'}</td>
            <td style="text-align:center;">${f.is_shared ? '✓' : '—'}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" style="color:var(--muted);">Поля не найдены</td></tr>';
    switchNav('admin-fields', null);
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

// ---------- дела ----------

let currentCase = null;           // текущее открытое дело (CaseDetailOut)
let currentCaseSelectedTemplates = new Set(); // выбранные для дела шаблоны (id)

async function loadCasesList(){
  state.cases = await api('/cases');
  renderCasesList();
}

function statusLabel(status){
  const map = { draft: 'Черновик', in_progress: 'В работе', ready: 'Готово', archived: 'В архиве' };
  return map[status] || status;
}

function renderCasesList(){
  const body = document.getElementById('casesListBody');
  if (!body) return;
  if (!state.cases.length){
    body.innerHTML = '<tr><td colspan="5" style="color:var(--muted);">Дел пока нет</td></tr>';
    return;
  }
  body.innerHTML = state.cases.map(c => `
    <tr>
      <td>${escapeHtml(c.client_name)}</td>
      <td>${escapeHtml(categoryName(c.category_id))}</td>
      <td><span class="badge badge-draft">${statusLabel(c.status)}</span></td>
      <td>${new Date(c.created_at).toLocaleDateString('ru-RU')}</td>
      <td style="text-align:right;"><button class="btn btn-sm" onclick="openCase('${c.id}')">Открыть</button></td>
    </tr>`).join('');
}

async function openNewCaseForm(){
  if (!state.categories.length){
    await loadCategories();
  }
  switchNav('case-new', null);
}

async function createCase(){
  const client = document.getElementById('newCaseClient').value.trim();
  const categoryId = document.getElementById('newCaseCategory').value;
  const errBox = document.getElementById('newCaseError');
  errBox.style.display = 'none';

  if (!client || !categoryId){
    errBox.textContent = 'Укажите клиента и категорию';
    errBox.style.display = 'block';
    return;
  }
  const btn = document.getElementById('createCaseBtn');
  btn.disabled = true;
  try {
    const newCase = await api('/cases', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ category_id: categoryId, client_name: client })
    });
    document.getElementById('newCaseClient').value = '';
    document.getElementById('newCaseCategory').value = '';
    await loadCasesList();
    await openCase(newCase.id);
  } catch (err){
    errBox.textContent = 'Ошибка: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function openCase(caseId){
  try {
    currentCase = await api(`/cases/${caseId}`);
    currentCaseSelectedTemplates = new Set(currentCase.documents.map(d => d.template_id));

    document.getElementById('caseTitle').textContent = currentCase.client_name;
    document.getElementById('caseSub').textContent =
      categoryName(currentCase.category_id) + ' · ' + statusLabel(currentCase.status);

    // Список опубликованных шаблонов в категории дела, доступных для выбора
    if (!state.templates.length) await loadTemplates();
    const available = state.templates.filter(t => t.category_id === currentCase.category_id && t.status === 'published');

    renderCaseTemplatesBox(available);
    await renderCaseFieldsForm(available);
    renderCaseDocuments();

    switchNav('case-detail', null);
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

function renderCaseTemplatesBox(available){
  const box = document.getElementById('caseTemplatesBox');
  if (!available.length){
    box.innerHTML = '<div style="color:var(--muted);">В этой категории пока нет опубликованных шаблонов</div>';
    return;
  }
  box.innerHTML = available.map(t => `
    <label style="display:flex;align-items:center;gap:9px;padding:6px 0;font-size:13.5px;">
      <input type="checkbox" value="${t.id}" ${currentCaseSelectedTemplates.has(t.id) ? 'checked' : ''}
        onchange="onCaseTemplateToggle()">
      ${escapeHtml(t.name)}
    </label>`).join('');
}

async function onCaseTemplateToggle(){
  const boxes = document.querySelectorAll('#caseTemplatesBox input[type=checkbox]');
  currentCaseSelectedTemplates = new Set(
    Array.from(boxes).filter(b => b.checked).map(b => b.value)
  );
  const available = state.templates.filter(t => t.category_id === currentCase.category_id && t.status === 'published');
  await renderCaseFieldsForm(available);
}

async function renderCaseFieldsForm(available){
  const formBox = document.getElementById('caseFormBox');
  const fieldsBox = document.getElementById('caseFieldsBox');

  if (!currentCaseSelectedTemplates.size){
    formBox.style.display = 'none';
    return;
  }
  formBox.style.display = 'block';

  // Собираем объединённый список полей по всем выбранным шаблонам,
  // без дублей по field_key (одинаковый ключ = одно поле формы дела).
  const selected = available.filter(t => currentCaseSelectedTemplates.has(t.id));
  const fieldsByKey = new Map();
  for (const t of selected){
    const detail = await api(`/templates/${t.id}`);
    for (const f of detail.fields){
      if (!fieldsByKey.has(f.field_key)) fieldsByKey.set(f.field_key, f);
    }
  }

  const existingValues = {};
  (currentCase.fields || []).forEach(f => { existingValues[f.field_key] = f.value; });

  const rows = Array.from(fieldsByKey.values());
  fieldsBox.innerHTML = rows.length
    ? rows.map(f => `
        <div class="field">
          <label>${escapeHtml(f.label)}${f.is_required ? ' *' : ''}</label>
          ${f.field_type === 'textarea'
            ? `<textarea rows="3" data-field-key="${escapeHtml(f.field_key)}">${escapeHtml(existingValues[f.field_key] || '')}</textarea>`
            : `<input data-field-key="${escapeHtml(f.field_key)}" value="${escapeHtml(existingValues[f.field_key] || '')}">`}
        </div>`).join('')
    : '<div style="color:var(--muted);">В выбранных документах не найдено полей</div>';
}

async function saveCaseFields(){
  const inputs = document.querySelectorAll('#caseFieldsBox [data-field-key]');
  const values = {};
  inputs.forEach(el => { values[el.getAttribute('data-field-key')] = el.value; });

  const errBox = document.getElementById('caseFormError');
  errBox.style.display = 'none';
  try {
    currentCase = await api(`/cases/${currentCase.id}/fields`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(values)
    });
    toast('Данные сохранены');
  } catch (err){
    errBox.textContent = 'Ошибка сохранения: ' + err.message;
    errBox.style.display = 'block';
  }
}

async function generateDocuments(){
  if (!currentCaseSelectedTemplates.size){
    toast('Сначала выберите хотя бы один документ');
    return;
  }
  const errBox = document.getElementById('caseFormError');
  errBox.style.display = 'none';
  try {
    // Сначала сохраняем текущие значения формы, чтобы генерация шла по свежим данным
    await saveCaseFields();
    await api(`/cases/${currentCase.id}/generate`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ template_ids: Array.from(currentCaseSelectedTemplates) })
    });
    currentCase = await api(`/cases/${currentCase.id}`);
    renderCaseDocuments();
    toast('Документы сгенерированы');
  } catch (err){
    errBox.textContent = 'Ошибка генерации: ' + err.message;
    errBox.style.display = 'block';
  }
}

function renderCaseDocuments(){
  const box = document.getElementById('caseDocsBox');
  const body = document.getElementById('caseDocsBody');
  const docs = (currentCase && currentCase.documents) || [];
  if (!docs.length){
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  body.innerHTML = docs.map(d => `
    <tr>
      <td>${escapeHtml(d.template_name)}</td>
      <td>${new Date(d.generated_at).toLocaleString('ru-RU')}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" onclick="downloadCaseDocument('${d.id}','docx')">Скачать .docx</button>
        ${d.has_pdf ? `<button class="btn btn-sm" onclick="downloadCaseDocument('${d.id}','pdf')">Скачать .pdf</button>` : ''}
      </td>
    </tr>`).join('');
}

async function downloadCaseDocument(documentId, format){
  try {
    const res = await fetch(`${API}/cases/${currentCase.id}/documents/${documentId}/download?format=${format}`, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (res.status === 401){ doLogout(); throw new Error('Сессия истекла'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err){
    toast('Ошибка скачивания: ' + err.message);
  }
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- запуск ----------

(async function init(){
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  if (state.token && state.role){
    // Доверяем сохранённому токену и роли до первого запроса к API.
    // Если токен на самом деле истёк, api() поймает 401 и вернёт на вход.
    await enterApp();
    return;
  }
  document.getElementById('loginShell').style.display = 'flex';
})();
