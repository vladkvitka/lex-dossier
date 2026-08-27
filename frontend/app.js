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
  packages: [],
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
    await loadAllPackages();
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
  function categoryRow(c, depth){
    return `
      <div class="tree-row" style="padding-left:${12 + depth*20}px;">
        <span class="tree-name">${escapeHtml(c.name)}${!c.is_active ? ' <span style="color:var(--muted);">(неактивна)</span>' : ''}</span>
        <span class="row-actions">
          <button class="icon-btn" onclick="renameCategoryPrompt('${c.id}')" title="Переименовать">✎</button>
          <button class="icon-btn danger" onclick="deleteCategoryConfirm('${c.id}')" title="Удалить">🗑</button>
        </span>
      </div>
      ${renderLevel(c.id, depth+1)}
    `;
  }
  function renderLevel(parentKey, depth){
    const items = byParent[parentKey] || [];
    return items.map(c => categoryRow(c, depth)).join('');
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
    ${g.items.map(c => categoryRow(c, 0)).join('')}
  `).join('');
}

async function renameCategoryPrompt(categoryId){
  const category = state.categories.find(c => c.id === categoryId);
  if (!category) return;
  const newName = window.prompt('Новое название категории:', category.name);
  if (newName === null) return; // отмена
  const trimmed = newName.trim();
  if (!trimmed || trimmed === category.name) return;
  try {
    await api(`/categories/${categoryId}`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name: trimmed })
    });
    toast('Категория переименована');
    await loadCategories();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function deleteCategoryConfirm(categoryId){
  const category = state.categories.find(c => c.id === categoryId);
  if (!category) return;
  const ok = window.confirm(`Удалить категорию «${category.name}»? Дочерние категории тоже будут скрыты. Уже существующие шаблоны и дела не пострадают.`);
  if (!ok) return;
  try {
    await api(`/categories/${categoryId}`, { method: 'DELETE' });
    toast('Категория удалена');
    await loadCategories();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
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
  const pkgCatSelect = document.getElementById('newPkgCategory');
  if (pkgCatSelect){
    pkgCatSelect.innerHTML = '<option value="">— выберите категорию —</option>' + opts;
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

let currentFieldsTemplateId = null;

const FIELD_TYPES = [
  { value: 'text', label: 'Текст (в одну строку)' },
  { value: 'textarea', label: 'Текст (многострочный)' },
  { value: 'date', label: 'Дата' },
  { value: 'number', label: 'Число' },
  { value: 'money', label: 'Денежная сумма' },
  { value: 'select', label: 'Выбор из списка' },
];

async function openTemplateFields(id){
  try {
    const tmpl = await api(`/templates/${id}`);
    currentFieldsTemplateId = id;
    document.getElementById('feTitle').textContent = 'Поля шаблона: ' + tmpl.name;
    renderFieldsForm(tmpl.fields || []);
    switchNav('admin-fields', null);
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

function renderFieldsForm(fields){
  const box = document.getElementById('feFormBox');
  if (!fields.length){
    box.innerHTML = '<div style="color:var(--muted);">В этом документе не найдено плейсхолдеров — добавьте поле вручную кнопкой ниже</div>';
    return;
  }
  box.innerHTML = fields.map(f => `
    <div class="upload-zone" style="max-width:720px;margin-bottom:12px;" data-field-row="${f.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div class="field" style="margin-bottom:0;flex:1;margin-right:12px;">
          <label>Плейсхолдер (ключ в тексте документа {{...}})</label>
          <input data-fe="field_key" value="${escapeHtml(f.field_key)}" style="font-family:var(--font-mono);font-size:12px;">
        </div>
        <button class="icon-btn danger" style="margin-top:18px;" onclick="deleteTemplateField('${f.id}')" title="Удалить поле">🗑 Удалить</button>
      </div>
      <div class="field">
        <label>Название поля (видит юрист в форме)</label>
        <input data-fe="label" value="${escapeHtml(f.label)}">
      </div>
      <div class="field">
        <label>Тип поля</label>
        <select data-fe="field_type">
          ${FIELD_TYPES.map(t => `<option value="${t.value}" ${t.value===f.field_type?'selected':''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;">
        <input type="checkbox" data-fe="is_required" ${f.is_required ? 'checked' : ''}> Обязательное поле
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;">
        <input type="checkbox" data-fe="is_shared" ${f.is_shared ? 'checked' : ''} onchange="onSharedToggle(this)"> Общее для пакета (одно значение для нескольких документов)
      </label>
      <div class="field" data-shared-key-field style="display:${f.is_shared ? 'block' : 'none'};margin-bottom:0;">
        <label>Ключ группировки общего поля</label>
        <input data-fe="shared_group_key" value="${escapeHtml(f.shared_group_key || '')}" placeholder="например: фио_доверителя">
      </div>
    </div>`).join('');
}

function onSharedToggle(checkbox){
  const row = checkbox.closest('[data-field-row]');
  const keyField = row.querySelector('[data-shared-key-field]');
  keyField.style.display = checkbox.checked ? 'block' : 'none';
}

async function saveTemplateFields(){
  const errBox = document.getElementById('feError');
  errBox.style.display = 'none';
  const rows = document.querySelectorAll('#feFormBox [data-field-row]');
  const fields = Array.from(rows).map(row => {
    const isShared = row.querySelector('[data-fe=is_shared]').checked;
    return {
      id: row.getAttribute('data-field-row'),
      field_key: row.querySelector('[data-fe=field_key]').value.trim(),
      label: row.querySelector('[data-fe=label]').value.trim(),
      field_type: row.querySelector('[data-fe=field_type]').value,
      is_required: row.querySelector('[data-fe=is_required]').checked,
      is_shared: isShared,
      shared_group_key: isShared ? (row.querySelector('[data-fe=shared_group_key]').value.trim() || null) : null,
    };
  });
  try {
    const tmpl = await api(`/templates/${currentFieldsTemplateId}/fields`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fields })
    });
    renderFieldsForm(tmpl.fields || []);
    toast('Карта полей сохранена');
  } catch (err){
    errBox.textContent = 'Ошибка сохранения: ' + err.message;
    errBox.style.display = 'block';
  }
}

async function addTemplateFieldPrompt(){
  const key = window.prompt('Ключ плейсхолдера (как он написан в документе внутри {{ }}):');
  if (!key || !key.trim()) return;
  const label = window.prompt('Название поля для формы юриста:', key.trim()) || key.trim();
  try {
    const tmpl = await api(`/templates/${currentFieldsTemplateId}/fields/add`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ field_key: key.trim(), label: label.trim(), field_type: 'text', is_required: false, is_shared: false })
    });
    renderFieldsForm(tmpl.fields || []);
    toast('Поле добавлено');
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function deleteTemplateField(fieldId){
  const ok = window.confirm('Удалить это поле из карты полей шаблона?');
  if (!ok) return;
  try {
    const tmpl = await api(`/templates/${currentFieldsTemplateId}/fields/${fieldId}`, { method: 'DELETE' });
    renderFieldsForm(tmpl.fields || []);
    toast('Поле удалено');
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

// ---------- пакеты ----------

let editingPackageId = null;

async function loadAllPackages(){
  state.packages = await api('/packages');
  renderAdminPackagesTable();
}

function renderAdminPackagesTable(){
  const body = document.getElementById('adminPkgBody');
  if (!body) return;
  if (!state.packages.length){
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted);">Пакетов пока нет</td></tr>';
    return;
  }
  body.innerHTML = state.packages.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(categoryName(p.category_id))}</td>
      <td>${p.items.length}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" onclick="editPackage('${p.id}')">Изменить</button>
        <button class="btn btn-sm" style="color:var(--wine);" onclick="deletePackageConfirm('${p.id}')">Удалить</button>
      </td>
    </tr>`).join('');
}

function onPkgCategoryChange(){
  const catId = document.getElementById('newPkgCategory').value;
  const box = document.getElementById('newPkgTemplates');
  if (!catId){
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;">Сначала выберите категорию</div>';
    return;
  }
  const inCategory = state.templates.filter(t => t.category_id === catId);
  if (!inCategory.length){
    box.innerHTML = '<div style="color:var(--muted);font-size:13px;">В этой категории пока нет шаблонов</div>';
    return;
  }
  const checkedIds = editingPackageId
    ? new Set((state.packages.find(p => p.id === editingPackageId)?.items || []).map(i => i.template_id))
    : new Set();
  box.innerHTML = inCategory.map(t => `
    <label style="display:flex;align-items:center;gap:9px;padding:5px 0;font-size:13.5px;">
      <input type="checkbox" value="${t.id}" data-pkg-tmpl ${checkedIds.has(t.id) ? 'checked' : ''}> ${escapeHtml(t.name)}
      ${t.status !== 'published' ? '<span class="badge badge-draft" style="margin-left:6px;">черновик</span>' : ''}
    </label>`).join('');
}

function editPackage(packageId){
  const pkg = state.packages.find(p => p.id === packageId);
  if (!pkg) return;
  editingPackageId = packageId;
  document.getElementById('newPkgName').value = pkg.name;
  document.getElementById('newPkgCategory').value = pkg.category_id;
  onPkgCategoryChange();
  document.getElementById('createPkgBtn').textContent = 'Сохранить изменения';
  document.getElementById('cancelPkgEditBtn').style.display = 'inline-block';
  switchNav('admin-packages', document.querySelector('[data-nav=admin-packages]'));
  document.getElementById('newPkgName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPackageForm(){
  editingPackageId = null;
  document.getElementById('newPkgName').value = '';
  document.getElementById('newPkgCategory').value = '';
  document.getElementById('newPkgTemplates').innerHTML = '<div style="color:var(--muted);font-size:13px;">Сначала выберите категорию</div>';
  document.getElementById('createPkgBtn').textContent = 'Создать пакет';
  document.getElementById('cancelPkgEditBtn').style.display = 'none';
}

async function savePackage(){
  const name = document.getElementById('newPkgName').value.trim();
  const categoryId = document.getElementById('newPkgCategory').value;
  const templateIds = Array.from(document.querySelectorAll('#newPkgTemplates [data-pkg-tmpl]:checked')).map(el => el.value);
  const errBox = document.getElementById('newPkgError');
  errBox.style.display = 'none';

  if (!name || !categoryId || !templateIds.length){
    errBox.textContent = 'Укажите название, категорию и выберите хотя бы один шаблон';
    errBox.style.display = 'block';
    return;
  }
  const btn = document.getElementById('createPkgBtn');
  btn.disabled = true;
  try {
    if (editingPackageId){
      await api(`/packages/${editingPackageId}`, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, template_ids: templateIds })
      });
      toast('Пакет обновлён');
    } else {
      await api('/packages', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, category_id: categoryId, template_ids: templateIds })
      });
      toast('Пакет создан');
    }
    resetPackageForm();
    await loadAllPackages();
  } catch (err){
    errBox.textContent = 'Ошибка: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function deletePackageConfirm(packageId){
  const pkg = state.packages.find(p => p.id === packageId);
  if (!pkg) return;
  const ok = window.confirm(`Удалить пакет «${pkg.name}»? Уже созданные дела с этим пакетом не пострадают, просто потеряют ссылку на него.`);
  if (!ok) return;
  try {
    await api(`/packages/${packageId}`, { method: 'DELETE' });
    toast('Пакет удалён');
    if (editingPackageId === packageId) resetPackageForm();
    await loadAllPackages();
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
    body.innerHTML = '<tr><td colspan="6" style="color:var(--muted);">Дел пока нет</td></tr>';
    return;
  }
  body.innerHTML = state.cases.map(c => `
    <tr>
      <td>${escapeHtml(c.client_name)}</td>
      <td>${escapeHtml(categoryName(c.category_id))}</td>
      <td>${escapeHtml(c.created_by_email || c.created_by_name || '—')}</td>
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

async function onNewCaseCategoryChange(){
  const catId = document.getElementById('newCaseCategory').value;
  const pkgField = document.getElementById('newCasePackageField');
  const pkgSelect = document.getElementById('newCasePackage');
  if (!catId){
    pkgField.style.display = 'none';
    return;
  }
  try {
    const packages = await api(`/packages?category_id=${catId}`);
    if (!packages.length){
      pkgField.style.display = 'none';
      pkgSelect.innerHTML = '<option value="">— без пакета, выберу документы вручную —</option>';
      return;
    }
    pkgSelect.innerHTML = '<option value="">— без пакета, выберу документы вручную —</option>' +
      packages.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.items.length} док.)</option>`).join('');
    pkgField.style.display = 'block';
  } catch (err){
    toast('Ошибка загрузки пакетов: ' + err.message);
  }
}

async function createCase(){
  const client = document.getElementById('newCaseClient').value.trim();
  const categoryId = document.getElementById('newCaseCategory').value;
  const packageId = document.getElementById('newCasePackage').value || null;
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
      body: JSON.stringify({ category_id: categoryId, client_name: client, package_id: packageId })
    });
    document.getElementById('newCaseClient').value = '';
    document.getElementById('newCaseCategory').value = '';
    document.getElementById('newCasePackageField').style.display = 'none';
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

    // Если у дела есть пакет и документы ещё не генерировались —
    // сразу отмечаем шаблоны из пакета, чтобы не выбирать их вручную.
    if (currentCase.package_id && !currentCaseSelectedTemplates.size){
      try {
        const packages = await api(`/packages?category_id=${currentCase.category_id}`);
        const pkg = packages.find(p => p.id === currentCase.package_id);
        if (pkg){
          pkg.items.forEach(item => currentCaseSelectedTemplates.add(item.template_id));
        }
      } catch (e) { /* не критично — просто не предвыберем */ }
    }

    document.getElementById('caseTitle').textContent = currentCase.client_name;
    document.getElementById('caseSub').textContent =
      categoryName(currentCase.category_id) + ' · ' + statusLabel(currentCase.status) +
      (currentCase.created_by_email ? ' · автор: ' + currentCase.created_by_email : '');

    // Список опубликованных шаблонов в категории дела, доступных для выбора
    if (!state.templates.length) await loadTemplates();
    const available = state.templates.filter(t => t.category_id === currentCase.category_id && t.status === 'published');

    renderCaseTemplatesBox(available);
    await renderCaseFieldsForm(available);
    renderCaseDocuments();
    renderCaseDocTabs(available);

    switchNav('case-detail', null);
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function renameCurrentCase(){
  if (!currentCase) return;
  const newName = window.prompt('Новое имя клиента:', currentCase.client_name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === currentCase.client_name) return;
  try {
    currentCase = await api(`/cases/${currentCase.id}`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ client_name: trimmed })
    });
    document.getElementById('caseTitle').textContent = currentCase.client_name;
    toast('Дело переименовано');
    await loadCasesList();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function deleteCurrentCase(){
  if (!currentCase) return;
  const ok = window.confirm(`Удалить дело «${currentCase.client_name}»? Все сгенерированные документы будут удалены безвозвратно.`);
  if (!ok) return;
  try {
    await api(`/cases/${currentCase.id}`, { method: 'DELETE' });
    toast('Дело удалено');
    currentCase = null;
    await loadCasesList();
    switchNav('cases-list', document.querySelector(state.role === 'admin' ? '#nav-admin [data-nav=cases-list]' : '#nav-lawyer [data-nav=cases-list]'));
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
  renderCaseDocTabs(available);
}

async function renderCaseFieldsForm(available){
  const formBox = document.getElementById('caseFormBox');
  const fieldsBox = document.getElementById('caseFieldsBox');

  if (!currentCaseSelectedTemplates.size){
    formBox.style.display = 'none';
    return;
  }
  formBox.style.display = 'block';

  // Собираем объединённый список полей по всем выбранным шаблонам.
  // Ключ объединения: shared_group_key, если поле общее и он задан,
  // иначе — обычный field_key. Так одинаковые по смыслу поля разных
  // документов (например «ФИО доверителя») превращаются в одно поле формы.
  const selected = available.filter(t => currentCaseSelectedTemplates.has(t.id));
  const fieldsByGroupKey = new Map();
  for (const t of selected){
    const detail = await api(`/templates/${t.id}`);
    for (const f of detail.fields){
      const groupKey = (f.is_shared && f.shared_group_key) ? f.shared_group_key : f.field_key;
      if (!fieldsByGroupKey.has(groupKey)) fieldsByGroupKey.set(groupKey, f);
    }
  }

  const existingValues = {};
  (currentCase.fields || []).forEach(f => { existingValues[f.field_key] = f.value; });

  const rows = Array.from(fieldsByGroupKey.entries());
  fieldsBox.innerHTML = rows.length
    ? rows.map(([groupKey, f]) => `
        <div class="field">
          <label>${escapeHtml(f.label)}${f.is_required ? ' *' : ''}${f.is_shared ? ' <span style="color:var(--muted);font-weight:400;">(общее)</span>' : ''}</label>
          ${f.field_type === 'textarea'
            ? `<textarea rows="3" data-field-key="${escapeHtml(groupKey)}" oninput="scheduleRefreshPreview()">${escapeHtml(existingValues[groupKey] || '')}</textarea>`
            : `<input data-field-key="${escapeHtml(groupKey)}" value="${escapeHtml(existingValues[groupKey] || '')}" oninput="scheduleRefreshPreview()">`}
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

// ---------- предпросмотр документа (вкладки + живой рендер) ----------

let currentDocTabId = null;
let previewDebounceTimer = null;

function renderCaseDocTabs(available){
  const tabsBox = document.getElementById('docTabs');
  const selected = available.filter(t => currentCaseSelectedTemplates.has(t.id));

  if (!selected.length){
    tabsBox.innerHTML = '';
    document.getElementById('docPreviewTitle').textContent = '—';
    document.getElementById('docBody').innerHTML = '<div class="doc-body-empty">Отметьте документ слева, чтобы увидеть предпросмотр</div>';
    currentDocTabId = null;
    return;
  }

  if (!currentDocTabId || !selected.some(t => t.id === currentDocTabId)){
    currentDocTabId = selected[0].id;
  }

  tabsBox.innerHTML = selected.map(t => `
    <div class="doc-tab ${t.id === currentDocTabId ? 'active' : ''}" data-doc="${t.id}" onclick="selectDocTab('${t.id}')">
      <span class="dot"></span>${escapeHtml(t.name)}
    </div>`).join('');

  refreshPreview();
}

function selectDocTab(templateId){
  currentDocTabId = templateId;
  document.querySelectorAll('.doc-tab').forEach(el => el.classList.toggle('active', el.dataset.doc === templateId));
  refreshPreview();
}

function scheduleRefreshPreview(){
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(refreshPreview, 500);
}

function highlightGaps(html){
  // Сервер вставляет служебные метки вида ⟦не заполнено: label⟧ вместо
  // пустых значений в предпросмотре — оборачиваем их в заметный стиль,
  // как «пропуски» в прототипе. В итоговом скачанном файле таких меток нет.
  return html.replace(/⟦([^⟧]*)⟧/g, '<span class="gap">$1</span>');
}

async function refreshPreview(){
  if (!currentDocTabId || !currentCase) return;
  const template = state.templates.find(t => t.id === currentDocTabId);
  document.getElementById('docPreviewTitle').textContent = template ? template.name : '—';

  const inputs = document.querySelectorAll('#caseFieldsBox [data-field-key]');
  const values = {};
  inputs.forEach(el => { values[el.getAttribute('data-field-key')] = el.value; });

  const docBody = document.getElementById('docBody');
  try {
    const result = await api(`/cases/${currentCase.id}/preview`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ template_id: currentDocTabId, values })
    });
    docBody.innerHTML = highlightGaps(result.html);
  } catch (err){
    docBody.innerHTML = `<div class="doc-body-empty">Не удалось построить предпросмотр: ${escapeHtml(err.message)}</div>`;
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
    const filename = filenameFromResponse(res, `document.${format}`);
    const blob = await res.blob();
    triggerBlobDownload(blob, filename);
  } catch (err){
    toast('Ошибка скачивания: ' + err.message);
  }
}

function downloadActiveTabDoc(format){
  if (!currentDocTabId || !currentCase) return;
  const doc = (currentCase.documents || []).find(d => d.template_id === currentDocTabId);
  if (!doc){
    toast('Сначала сгенерируйте документы для этого дела');
    return;
  }
  if (format === 'pdf' && !doc.has_pdf){
    toast('PDF-версия для этого документа недоступна');
    return;
  }
  downloadCaseDocument(doc.id, format);
}

async function downloadAllCaseDocuments(){
  if (!currentCase) return;
  try {
    const res = await fetch(`${API}/cases/${currentCase.id}/download-all`, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (res.status === 401){ doLogout(); throw new Error('Сессия истекла'); }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const body = await res.json(); if (body.detail) msg = body.detail; } catch(e){}
      throw new Error(msg);
    }
    const filename = filenameFromResponse(res, 'документы.zip');
    const blob = await res.blob();
    triggerBlobDownload(blob, filename);
  } catch (err){
    toast('Ошибка скачивания: ' + err.message);
  }
}

function filenameFromResponse(res, fallback){
  const cd = res.headers.get('Content-Disposition') || '';
  let match = cd.match(/filename\*=UTF-8''([^;]+)/);
  if (match) { try { return decodeURIComponent(match[1]); } catch(e) {} }
  match = cd.match(/filename="?([^";]+)"?/);
  if (match) return match[1];
  return fallback;
}

function triggerBlobDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
