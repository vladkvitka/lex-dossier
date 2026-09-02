/*
  Лекс.Досье — фронтенд этапа 11.
  Названия полей запросов сверены с реальными main.py / schemas.py / models.py
  сервера (вход, категории, шаблоны, поля шаблона).
  В этом этапе: визард "Новое дело" (направление->категория->подкатегория),
  автосохранение полей вместо кнопки "Сохранить данные", авторазлогин по
  бездействию, кнопка "Сгенерировать/Обновить документы", скачивание
  пакета в docx/PDF, типизированные поля ввода (дата/число).
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
  stopInactivityWatcher();
  stopCasesListPolling();
}

// ---------- автоматический разлогин после бездействия ----------

const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 1 час
let inactivityTimer = null;
let inactivityListenersAttached = false;

function resetInactivityTimer(){
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (!state.token) return;
    doLogout();
    toast('Вы вышли из системы из-за часа бездействия');
  }, INACTIVITY_LIMIT_MS);
}

function startInactivityWatcher(){
  if (!inactivityListenersAttached){
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
      window.addEventListener(evt, resetInactivityTimer, { passive: true })
    );
    inactivityListenersAttached = true;
  }
  resetInactivityTimer();
}

function stopInactivityWatcher(){
  clearTimeout(inactivityTimer);
  inactivityTimer = null;
}

// ---------- вход в приложение после успешной авторизации ----------

async function enterApp(){
  document.getElementById('loginShell').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  startInactivityWatcher();

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
    startCasesListPolling();
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

// Статус дела на сервере может смениться сам по себе (генерация другим
// сотрудником, авто-архивация по истечении 4 рабочих дней) — простой
// switchNav показывал бы старые данные, загруженные при входе в систему,
// пока не нажмёшь F5. Клик по "Дела" в меню теперь всегда сначала
// перезапрашивает список, а пока экран открыт — обновляет его сам по себе.
async function openCasesListNav(btn){
  switchNav('cases-list', btn);
  try { await loadCasesList(); } catch (err){ toast('Не удалось обновить список дел: ' + err.message); }
  startCasesListPolling();
}

let casesListPollTimer = null;
const CASES_LIST_POLL_MS = 60 * 1000;

function startCasesListPolling(){
  stopCasesListPolling();
  casesListPollTimer = setInterval(() => {
    const screen = document.getElementById('screen-cases-list');
    if (!screen || !screen.classList.contains('active')){
      stopCasesListPolling();
      return;
    }
    loadCasesList().catch(() => {}); // тихий фоновый рефреш, без тостов об ошибках
  }, CASES_LIST_POLL_MS);
}

function stopCasesListPolling(){
  clearTimeout(casesListPollTimer);
  clearInterval(casesListPollTimer);
  casesListPollTimer = null;
}

// ---------- категории ----------

async function loadCategories(){
  state.categories = await api('/categories');
  renderCategoryTree();
  renderCategorySelects();
}

function categorySort(a, b){
  return a.name.localeCompare(b.name, 'ru');
}

function topLevelCategoriesOfBranch(branch){
  return state.categories.filter(c => c.branch === branch && !c.parent_id && c.is_active).sort(categorySort);
}

function subcategoriesOf(parentId){
  return state.categories.filter(c => c.parent_id === parentId && c.is_active).sort(categorySort);
}

function serviceCategory(){
  return state.categories.find(c => c.branch === 'service');
}

function renderCategoryTree(){
  const box = document.getElementById('adminTree');
  // В дереве показываем только направления СВО и гражданские — «Служебные»
  // это системная категория без иерархии, ей место в библиотеке шаблонов.
  const branchCats = state.categories.filter(c => c.branch === 'svo' || c.branch === 'civil_admin');
  if (!branchCats.length){
    box.innerHTML = '<div class="tree-empty">Категорий пока нет — добавьте первую выше</div>';
    return;
  }
  function categoryRow(c, depth){
    return `
      <div class="tree-row" style="padding-left:${12 + depth*20}px;">
        <span class="tree-name">${escapeHtml(c.name)}${!c.is_active ? ' <span style="color:var(--muted);">(неактивна)</span>' : ''}</span>
        <span class="row-actions">
          <button class="icon-btn" onclick="renameCategoryPrompt('${c.id}')" title="Переименовать">✎</button>
          <button class="icon-btn danger" onclick="deleteCategoryConfirm('${c.id}')" title="Удалить">🗑</button>
        </span>
      </div>
      ${subcategoriesOf(c.id).map(sub => categoryRow(sub, depth + 1)).join('')}
    `;
  }
  const grouped = BRANCHES.map(b => ({
    ...b,
    items: topLevelCategoriesOfBranch(b.value),
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
  // Визарды категорий/шаблонов/пакетов/нового дела сами перестраивают свои
  // селекты по шагам (см. onCatWizBranchChange / onTmplWizBranchChange /
  // onPkgWizBranchChange / onNewCaseBranchChange) — здесь ничего не строим,
  // функция оставлена как единая точка вызова из loadCategories().
}

// ---------- визард создания категории ----------

function onCatWizBranchChange(){
  const branch = document.getElementById('catWizBranch').value;
  const parentField = document.getElementById('catWizParentField');
  const nameField = document.getElementById('catWizNameField');
  const addBtn = document.getElementById('catWizAddBtn');
  if (!branch){
    parentField.style.display = 'none';
    nameField.style.display = 'none';
    addBtn.style.display = 'none';
    return;
  }
  const parentSelect = document.getElementById('catWizParent');
  const tops = topLevelCategoriesOfBranch(branch);
  parentSelect.innerHTML = '<option value="new">— новая категория, верхний уровень —</option>' +
    tops.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  parentSelect.value = 'new';
  parentField.style.display = 'block';
  nameField.style.display = 'block';
  addBtn.style.display = 'inline-flex';
  onCatWizParentChange();
}

function onCatWizParentChange(){
  const isNew = document.getElementById('catWizParent').value === 'new';
  const label = document.getElementById('catWizNameLabel');
  const input = document.getElementById('catWizName');
  if (isNew){
    label.textContent = 'Название новой категории (верхний уровень)';
    input.placeholder = 'ЖИЛИЩНЫЕ СПОРЫ';
  } else {
    label.textContent = 'Название новой подкатегории';
    input.placeholder = 'Взыскание задолженности по ЖКХ';
  }
}

async function createCategory(){
  const branch = document.getElementById('catWizBranch').value;
  const parentValue = document.getElementById('catWizParent').value;
  const isTopLevel = parentValue === 'new';
  const parentId = isTopLevel ? null : parentValue;
  let name = document.getElementById('catWizName').value.trim();

  if (!branch){ toast('Выберите направление'); return; }
  if (!name){ toast('Введите название'); return; }
  if (isTopLevel) name = name.toUpperCase(); // категории верхнего уровня — капсом

  const btn = document.getElementById('catWizAddBtn');
  btn.disabled = true;
  try {
    await api('/categories', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, branch, parent_id: parentId, sort_order: 0 })
    });
    document.getElementById('catWizName').value = '';
    toast(isTopLevel ? 'Категория добавлена' : 'Подкатегория добавлена');
    await loadCategories();
    onCatWizBranchChange(); // перестроим список категорий с учётом новой
  } catch (err){
    toast('Ошибка: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function universalCategoryIds(){
  return new Set(state.categories.filter(c => c.is_universal).map(c => c.id));
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

function docGroupLabel(group){
  return group === 'service' ? 'Служебный' : 'Основной';
}

function categoryBranch(categoryId){
  const c = state.categories.find(x => x.id === categoryId);
  return c ? c.branch : null;
}

function variantLabel(v){
  return v === 'serviceman' ? 'военнослужащий' : (v === 'relatives' ? 'родня' : '');
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
    const isSvoMain = categoryBranch(t.category_id) === 'svo' && t.doc_group !== 'service';
    const variantBadge = t.variant_group_id
      ? `<br><span style="font-size:11px;color:var(--navy);">вариант: ${variantLabel(t.applicant_variant)}</span>`
      : '';
    return `
      <tr>
        <td>${escapeHtml(t.name)}<br><span style="font-size:11px;color:var(--muted);">${docGroupLabel(t.doc_group)}</span>${variantBadge}</td>
        <td>${escapeHtml(categoryName(t.category_id))}</td>
        <td><span class="badge ${published ? 'badge-published' : 'badge-draft'}">${published ? 'Опубликован' : 'Черновик'}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-sm" onclick="openTemplateFields('${t.id}')">Поля</button>
          ${isSvoMain ? `<button class="btn btn-sm" onclick="toggleVariantPanel('${t.id}')">Вариант</button>` : ''}
          ${published ? '' : `<button class="btn-primary btn-sm" onclick="publishTemplate('${t.id}')">Опубликовать</button>`}
          <button class="btn btn-sm" style="color:var(--wine);" onclick="deleteTemplateConfirm('${t.id}')">Удалить</button>
        </td>
      </tr>
      <tr id="variantPanelRow-${t.id}" style="display:none;">
        <td colspan="4" style="background:var(--surface-alt);"></td>
      </tr>`;
  }).join('');
}

function toggleVariantPanel(templateId){
  const row = document.getElementById(`variantPanelRow-${templateId}`);
  if (!row) return;
  const showing = row.style.display !== 'none';
  // Схлопнуть все остальные открытые панели, чтобы не путаться.
  document.querySelectorAll('[id^="variantPanelRow-"]').forEach(r => r.style.display = 'none');
  if (showing) return;

  const t = state.templates.find(x => x.id === templateId);
  if (!t) return;
  const cell = row.querySelector('td');

  if (t.variant_group_id){
    const sibling = state.templates.find(x => x.variant_group_id === t.variant_group_id && x.id !== t.id);
    cell.innerHTML = `
      <div style="padding:10px 4px;font-size:13px;">
        Этот шаблон — вариант «<b>${variantLabel(t.applicant_variant)}</b>» документа
        «${escapeHtml(t.name)}», связан с шаблоном
        «${sibling ? escapeHtml(sibling.name) : '—'}» (вариант «${sibling ? variantLabel(sibling.applicant_variant) : '?'}»).
        Юрист в деле видит их как один пункт списка — подставляется нужный по типу заявителя.
        <div style="margin-top:8px;">
          <button class="btn btn-sm" style="color:var(--wine);" onclick="unlinkTemplateVariant('${t.id}')">Отвязать варианты</button>
        </div>
      </div>`;
  } else {
    const candidates = state.templates.filter(x =>
      x.id !== t.id && x.category_id === t.category_id && !x.variant_group_id
    );
    cell.innerHTML = `
      <div style="padding:10px 4px;font-size:13px;">
        Связать «${escapeHtml(t.name)}» как один из двух вариантов документа по типу заявителя
        (служащий / родня) — юрист увидит один пункт, система сама подставит нужный файл.
        ${candidates.length ? `
          <div class="field" style="max-width:420px;margin-top:8px;">
            <label>Второй шаблон (другой вариант того же документа)</label>
            <select id="variantSibling-${t.id}">
              ${candidates.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="max-width:420px;">
            <label>Этот шаблон («${escapeHtml(t.name)}») — от лица</label>
            <select id="variantThis-${t.id}">
              <option value="serviceman">военнослужащего (сам заявитель)</option>
              <option value="relatives">родственника (жена/мать/отец/брат/сестра)</option>
            </select>
          </div>
          <button class="btn-primary btn-sm" onclick="linkTemplateVariant('${t.id}')">Связать</button>
        ` : `<div style="color:var(--muted);margin-top:8px;">
          Нет других несвязанных шаблонов в этой же категории — сначала загрузите второй вариант документа.
        </div>`}
      </div>`;
  }
  row.style.display = '';
}

async function linkTemplateVariant(templateId){
  const siblingSelect = document.getElementById(`variantSibling-${templateId}`);
  const thisSelect = document.getElementById(`variantThis-${templateId}`);
  if (!siblingSelect || !thisSelect) return;
  const otherTemplateId = siblingSelect.value;
  const thisVariant = thisSelect.value;
  const otherVariant = thisVariant === 'serviceman' ? 'relatives' : 'serviceman';
  try {
    await api(`/templates/${templateId}/link-variant`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ other_template_id: otherTemplateId, this_variant: thisVariant, other_variant: otherVariant })
    });
    toast('Варианты связаны');
    await loadTemplates();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function unlinkTemplateVariant(templateId){
  const ok = window.confirm('Отвязать варианты? Оба шаблона снова станут отдельными пунктами списка документов.');
  if (!ok) return;
  try {
    await api(`/templates/${templateId}/unlink-variant`, { method: 'POST' });
    toast('Варианты отвязаны');
    await loadTemplates();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function deleteTemplateConfirm(templateId){
  const tmpl = state.templates.find(t => t.id === templateId);
  if (!tmpl) return;
  const ok = window.confirm(`Удалить шаблон «${tmpl.name}»? Это можно сделать, только если он не используется в пакетах и по нему ещё не генерировались документы.`);
  if (!ok) return;
  try {
    await api(`/templates/${templateId}`, { method: 'DELETE' });
    toast('Шаблон удалён');
    await loadTemplates();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
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

// ---------- визард создания шаблона ----------

let tmplWizTargetCategoryId = null;

function onTmplWizBranchChange(){
  const branch = document.getElementById('tmplWizBranch').value;
  const categoryField = document.getElementById('tmplWizCategoryField');
  const subcategoryField = document.getElementById('tmplWizSubcategoryField');
  const finalFields = document.getElementById('tmplWizFinalFields');
  tmplWizTargetCategoryId = null;
  categoryField.style.display = 'none';
  subcategoryField.style.display = 'none';
  finalFields.style.display = 'none';

  if (!branch) return;

  if (branch === 'service'){
    const svc = serviceCategory();
    if (!svc){
      toast('Системная категория «Служебные» ещё не создана на сервере — выполните миграцию');
      return;
    }
    tmplWizTargetCategoryId = svc.id;
    finalFields.style.display = 'block';
    return;
  }

  const categorySelect = document.getElementById('tmplWizCategory');
  const tops = topLevelCategoriesOfBranch(branch);
  categorySelect.innerHTML = '<option value="">— выберите категорию —</option>' +
    tops.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  categoryField.style.display = 'block';
}

function onTmplWizCategoryChange(){
  const categoryId = document.getElementById('tmplWizCategory').value;
  const subcategoryField = document.getElementById('tmplWizSubcategoryField');
  const finalFields = document.getElementById('tmplWizFinalFields');
  tmplWizTargetCategoryId = null;
  finalFields.style.display = 'none';

  if (!categoryId){
    subcategoryField.style.display = 'none';
    return;
  }
  const subSelect = document.getElementById('tmplWizSubcategory');
  const subs = subcategoriesOf(categoryId);
  subSelect.innerHTML = '<option value="">— выберите подкатегорию —</option>' +
    subs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  subcategoryField.style.display = 'block';
  if (!subs.length){
    subSelect.innerHTML = '<option value="">— в этой категории пока нет подкатегорий, создайте на вкладке «Категории» —</option>';
  }
}

function onTmplWizSubcategoryChange(){
  const subcategoryId = document.getElementById('tmplWizSubcategory').value;
  const finalFields = document.getElementById('tmplWizFinalFields');
  if (!subcategoryId){
    tmplWizTargetCategoryId = null;
    finalFields.style.display = 'none';
    return;
  }
  tmplWizTargetCategoryId = subcategoryId;
  finalFields.style.display = 'block';
}

async function uploadTemplate(){
  const name = document.getElementById('newTmplName').value.trim();
  const description = document.getElementById('newTmplDescription').value.trim();
  const fileInput = document.getElementById('newTmplFile');
  const errBox = document.getElementById('uploadError');
  errBox.style.display = 'none';

  if (!name || !tmplWizTargetCategoryId || !fileInput.files.length){
    errBox.textContent = 'Заполните название, пройдите шаги направления/категории и выберите файл .docx';
    errBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('uploadTmplBtn');
  btn.disabled = true;
  btn.textContent = 'Загружаем...';

  try {
    const form = new FormData();
    form.append('name', name);
    form.append('category_id', tmplWizTargetCategoryId);
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
  { value: 'documents_list', label: '⚙ Список документов дела (заполняется автоматически)' },
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
        <select data-fe="field_type" onchange="onFieldTypeChange(this)">
          ${FIELD_TYPES.map(t => `<option value="${t.value}" ${t.value===f.field_type?'selected':''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="notice" data-doclist-note style="display:${f.field_type === 'documents_list' ? 'block' : 'none'};">
        Это служебное поле — юрист его не заполняет. При генерации сюда автоматически подставится нумерованный перечень «основных» документов, отмеченных для этого дела в текущем запуске генерации.
      </div>
      <div data-normal-field-options style="display:${f.field_type === 'documents_list' ? 'none' : 'block'};">
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
      </div>
    </div>`).join('');
}

function onFieldTypeChange(select){
  const row = select.closest('[data-field-row]');
  const isDocList = select.value === 'documents_list';
  row.querySelector('[data-doclist-note]').style.display = isDocList ? 'block' : 'none';
  row.querySelector('[data-normal-field-options]').style.display = isDocList ? 'none' : 'block';
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
let pkgWizTargetSubcategoryId = null;
let pkgWizManuallyAdded = new Set(); // id шаблонов, добавленных вручную из другой категории

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

async function loadAllPackages(){
  state.packages = await api('/packages');
  renderAdminPackagesTable();
}

// ---------- визард создания пакета ----------

function onPkgWizBranchChange(){
  const branch = document.getElementById('pkgWizBranch').value;
  document.getElementById('pkgWizCategoryField').style.display = 'none';
  document.getElementById('pkgWizSubcategoryField').style.display = 'none';
  document.getElementById('pkgWizFinalFields').style.display = 'none';
  pkgWizTargetSubcategoryId = null;
  if (!branch) return;

  const categorySelect = document.getElementById('pkgWizCategory');
  const tops = topLevelCategoriesOfBranch(branch);
  categorySelect.innerHTML = '<option value="">— выберите категорию —</option>' +
    tops.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('pkgWizCategoryField').style.display = 'block';
}

function onPkgWizCategoryChange(){
  const categoryId = document.getElementById('pkgWizCategory').value;
  document.getElementById('pkgWizSubcategoryField').style.display = 'none';
  document.getElementById('pkgWizFinalFields').style.display = 'none';
  pkgWizTargetSubcategoryId = null;
  if (!categoryId) return;

  const subSelect = document.getElementById('pkgWizSubcategory');
  const subs = subcategoriesOf(categoryId);
  subSelect.innerHTML = '<option value="">— выберите подкатегорию —</option>' +
    subs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('pkgWizSubcategoryField').style.display = 'block';
}

function onPkgWizSubcategoryChange(){
  const subcategoryId = document.getElementById('pkgWizSubcategory').value;
  if (!subcategoryId){
    document.getElementById('pkgWizFinalFields').style.display = 'none';
    pkgWizTargetSubcategoryId = null;
    return;
  }
  pkgWizTargetSubcategoryId = subcategoryId;
  pkgWizManuallyAdded = new Set();
  renderPkgWizTemplateLists();
  document.getElementById('pkgWizFinalFields').style.display = 'block';
}

function pkgTemplateRow(t, checked){
  return `
    <label style="display:flex;align-items:center;gap:9px;padding:5px 0;font-size:13.5px;" data-pkg-row="${t.id}">
      <input type="checkbox" value="${t.id}" data-pkg-tmpl ${checked ? 'checked' : ''}> ${escapeHtml(t.name)}
      ${t.status !== 'published' ? '<span class="badge badge-draft" style="margin-left:6px;">черновик</span>' : ''}
    </label>`;
}

function renderPkgWizTemplateLists(){
  if (!pkgWizTargetSubcategoryId) return;
  const universalIds = universalCategoryIds();
  const checkedIds = editingPackageId
    ? new Set((state.packages.find(p => p.id === editingPackageId)?.items || []).map(i => i.template_id))
    : null; // null = отмечать всё по умолчанию (новый пакет)

  const ownTemplates = state.templates.filter(t => t.category_id === pkgWizTargetSubcategoryId);
  const universalTemplates = state.templates.filter(t => universalIds.has(t.category_id));
  const ownIds = new Set(ownTemplates.map(t => t.id));
  const universalIdSet = new Set(universalTemplates.map(t => t.id));

  const ownBox = document.getElementById('pkgWizOwnTemplates');
  ownBox.innerHTML = ownTemplates.length
    ? ownTemplates.map(t => pkgTemplateRow(t, checkedIds ? checkedIds.has(t.id) : true)).join('')
    : '<div style="color:var(--muted);font-size:12.5px;">В этой подкатегории пока нет шаблонов</div>';

  const universalBox = document.getElementById('pkgWizUniversalTemplates');
  universalBox.innerHTML = universalTemplates.length
    ? universalTemplates.map(t => pkgTemplateRow(t, checkedIds ? checkedIds.has(t.id) : true)).join('')
    : '<div style="color:var(--muted);font-size:12.5px;">Общих (служебных) шаблонов пока нет</div>';

  // При редактировании существующего пакета — шаблоны, не входящие ни в
  // «свои», ни в «общие» (были добавлены вручную из другой категории),
  // сразу показываем в блоке «добавлено вручную».
  const addedBox = document.getElementById('pkgWizAddedOther');
  addedBox.innerHTML = '';
  pkgWizManuallyAdded = new Set();
  if (checkedIds){
    checkedIds.forEach(id => {
      if (!ownIds.has(id) && !universalIdSet.has(id)){
        const t = state.templates.find(x => x.id === id);
        if (t){
          pkgWizManuallyAdded.add(id);
          addedBox.insertAdjacentHTML('beforeend', pkgManualRow(t));
        }
      }
    });
  }

  renderPkgWizAddOtherSelect();
}

function pkgManualRow(t){
  return `
    <label style="display:flex;align-items:center;gap:9px;padding:5px 0;font-size:13.5px;" data-pkg-manual-row="${t.id}">
      <input type="checkbox" value="${t.id}" data-pkg-tmpl checked> ${escapeHtml(t.name)}
      <span style="color:var(--muted);">— ${escapeHtml(categoryName(t.category_id))}</span>
      <button type="button" class="icon-btn danger" style="margin-left:auto;" onclick="removePkgManualTemplate('${t.id}')">✕</button>
    </label>`;
}

function renderPkgWizAddOtherSelect(){
  const select = document.getElementById('pkgWizAddOther');
  const universalIds = universalCategoryIds();
  const exclude = new Set([
    ...state.templates.filter(t => t.category_id === pkgWizTargetSubcategoryId).map(t => t.id),
    ...state.templates.filter(t => universalIds.has(t.category_id)).map(t => t.id),
    ...pkgWizManuallyAdded,
  ]);
  const options = state.templates
    .filter(t => !exclude.has(t.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  select.innerHTML = '<option value="">— выберите шаблон —</option>' +
    options.map(t => `<option value="${t.id}">${escapeHtml(t.name)} — ${escapeHtml(categoryName(t.category_id))}</option>`).join('');
}

function onPkgWizAddOtherTemplate(select){
  const templateId = select.value;
  if (!templateId) return;
  const t = state.templates.find(x => x.id === templateId);
  if (!t) return;
  pkgWizManuallyAdded.add(templateId);
  document.getElementById('pkgWizAddedOther').insertAdjacentHTML('beforeend', pkgManualRow(t));
  renderPkgWizAddOtherSelect();
}

function removePkgManualTemplate(templateId){
  pkgWizManuallyAdded.delete(templateId);
  const row = document.querySelector(`[data-pkg-manual-row="${templateId}"]`);
  if (row) row.remove();
  renderPkgWizAddOtherSelect();
}

function editPackage(packageId){
  const pkg = state.packages.find(p => p.id === packageId);
  if (!pkg) return;
  editingPackageId = packageId;
  document.getElementById('newPkgName').value = pkg.name;

  const category = state.categories.find(c => c.id === pkg.category_id);
  const topCategory = category && category.parent_id ? state.categories.find(c => c.id === category.parent_id) : category;
  if (category && topCategory){
    document.getElementById('pkgWizBranch').value = topCategory.branch;
    onPkgWizBranchChange();
    document.getElementById('pkgWizCategory').value = topCategory.id;
    onPkgWizCategoryChange();
    document.getElementById('pkgWizSubcategory').value = pkg.category_id;
    onPkgWizSubcategoryChange();
  }

  document.getElementById('createPkgBtn').textContent = 'Сохранить изменения';
  document.getElementById('cancelPkgEditBtn').style.display = 'inline-block';
  switchNav('admin-packages', document.querySelector('[data-nav=admin-packages]'));
  document.getElementById('newPkgName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPackageForm(){
  editingPackageId = null;
  pkgWizManuallyAdded = new Set();
  document.getElementById('newPkgName').value = '';
  document.getElementById('pkgWizBranch').value = '';
  onPkgWizBranchChange();
  document.getElementById('createPkgBtn').textContent = 'Создать пакет';
  document.getElementById('cancelPkgEditBtn').style.display = 'none';
}

async function savePackage(){
  const name = document.getElementById('newPkgName').value.trim();
  const categoryId = pkgWizTargetSubcategoryId;
  const templateIds = Array.from(document.querySelectorAll('#pkgWizFinalFields [data-pkg-tmpl]:checked')).map(el => el.value);
  const errBox = document.getElementById('newPkgError');
  errBox.style.display = 'none';

  if (!name || !categoryId || !templateIds.length){
    errBox.textContent = 'Укажите название, пройдите шаги направления/категории/подкатегории и выберите хотя бы один шаблон';
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
      <td><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></td>
      <td>${new Date(c.created_at).toLocaleDateString('ru-RU')}</td>
      <td style="text-align:right;"><button class="btn btn-sm" onclick="openCase('${c.id}')">Открыть</button></td>
    </tr>`).join('');
}

let newCaseTargetCategoryId = null; // выбранная (под)категория дела — итог визарда
let newCaseSelectedBranch = null;   // направление — определяет, показывать ли "Кто заявитель"

async function openNewCaseForm(){
  if (!state.categories.length){
    await loadCategories();
  }
  // Сброс визарда на первый шаг при каждом открытии формы.
  newCaseTargetCategoryId = null;
  newCaseSelectedBranch = null;
  document.getElementById('newCaseBranch').value = '';
  document.getElementById('newCaseCategoryField').style.display = 'none';
  document.getElementById('newCaseSubcategoryField').style.display = 'none';
  document.getElementById('newCaseFinalFields').style.display = 'none';
  document.getElementById('newCaseApplicantField').style.display = 'none';
  document.getElementById('newCaseApplicant').value = '';
  document.getElementById('newCaseClient').value = '';
  document.getElementById('newCaseError').style.display = 'none';
  switchNav('case-new', null);
}

function onNewCaseBranchChange(){
  const branch = document.getElementById('newCaseBranch').value;
  newCaseSelectedBranch = branch || null;
  const categoryField = document.getElementById('newCaseCategoryField');
  const subcategoryField = document.getElementById('newCaseSubcategoryField');
  const finalFields = document.getElementById('newCaseFinalFields');
  newCaseTargetCategoryId = null;
  categoryField.style.display = 'none';
  subcategoryField.style.display = 'none';
  finalFields.style.display = 'none';
  if (!branch) return;

  const categorySelect = document.getElementById('newCaseCategory');
  const tops = topLevelCategoriesOfBranch(branch);
  categorySelect.innerHTML = '<option value="">— выберите категорию —</option>' +
    tops.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  categoryField.style.display = 'block';
}

function onNewCaseCategoryChange(){
  const categoryId = document.getElementById('newCaseCategory').value;
  const subcategoryField = document.getElementById('newCaseSubcategoryField');
  const finalFields = document.getElementById('newCaseFinalFields');
  newCaseTargetCategoryId = null;
  finalFields.style.display = 'none';
  if (!categoryId){
    subcategoryField.style.display = 'none';
    return;
  }
  const subSelect = document.getElementById('newCaseSubcategory');
  const subs = subcategoriesOf(categoryId);
  if (!subs.length){
    // В этой категории нет подкатегорий — считаем её саму конечным узлом,
    // как это уже принято для шаблонов без подкатегорий.
    subcategoryField.style.display = 'none';
    selectNewCaseCategoryTarget(categoryId);
    return;
  }
  subSelect.innerHTML = '<option value="">— выберите подкатегорию —</option>' +
    subs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  subcategoryField.style.display = 'block';
}

function onNewCaseSubcategoryChange(){
  const subcategoryId = document.getElementById('newCaseSubcategory').value;
  if (!subcategoryId){
    newCaseTargetCategoryId = null;
    document.getElementById('newCaseFinalFields').style.display = 'none';
    return;
  }
  selectNewCaseCategoryTarget(subcategoryId);
}

async function selectNewCaseCategoryTarget(categoryId){
  newCaseTargetCategoryId = categoryId;
  document.getElementById('newCaseFinalFields').style.display = 'block';
  // "Кто заявитель" — только для направления СВО; для гражданских/административных
  // дел это поле не показываем и не отправляем (см. _svo_applicant_context на бэке).
  const applicantField = document.getElementById('newCaseApplicantField');
  if (newCaseSelectedBranch === 'svo'){
    applicantField.style.display = 'block';
  } else {
    applicantField.style.display = 'none';
    document.getElementById('newCaseApplicant').value = '';
  }
  const pkgField = document.getElementById('newCasePackageField');
  const pkgSelect = document.getElementById('newCasePackage');
  try {
    const packages = await api(`/packages?category_id=${categoryId}`);
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
  const categoryId = newCaseTargetCategoryId;
  const packageId = document.getElementById('newCasePackage').value || null;
  const isSvo = newCaseSelectedBranch === 'svo';
  const applicantType = isSvo ? document.getElementById('newCaseApplicant').value : null;
  const errBox = document.getElementById('newCaseError');
  errBox.style.display = 'none';

  if (!client || !categoryId){
    errBox.textContent = 'Пройдите шаги направления/категории/подкатегории и укажите имя клиента';
    errBox.style.display = 'block';
    return;
  }
  if (isSvo && !applicantType){
    errBox.textContent = 'Для направления СВО укажите, кто заявитель';
    errBox.style.display = 'block';
    return;
  }
  const btn = document.getElementById('createCaseBtn');
  btn.disabled = true;
  try {
    const newCase = await api('/cases', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ category_id: categoryId, client_name: client, package_id: packageId, applicant_type: applicantType })
    });
    await loadCasesList();
    await openCase(newCase.id);
  } catch (err){
    errBox.textContent = 'Ошибка: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

let currentCaseAvailableTemplates = [];

async function openCase(caseId){
  try {
    currentCase = await api(`/cases/${caseId}`);
    currentCaseSelectedTemplates = new Set(currentCase.documents.map(d => d.template_id));

    // Список опубликованных шаблонов, доступных для выбора в этом деле —
    // уже разрешённый сервером: своя категория + «общие» категории, и если
    // у какого-то документа есть варианты по типу заявителя (служащий/
    // родня), сервер сам оставил только подходящий (см.
    // /cases/{id}/available-templates и _resolve_case_templates в main.py).
    currentCaseAvailableTemplates = await api(`/cases/${caseId}/available-templates`);

    // Если у дела есть пакет и документы ещё не генерировались — сразу
    // отмечаем шаблоны из пакета (тоже уже разрешённые под тип заявителя
    // этого дела — package_template_ids приходит готовым из /cases/{id}).
    if (currentCase.package_id && !currentCaseSelectedTemplates.size){
      currentCase.package_template_ids.forEach(id => currentCaseSelectedTemplates.add(id));
    }

    document.getElementById('caseTitle').textContent = currentCase.client_name;
    document.getElementById('caseSub').textContent =
      categoryName(currentCase.category_id) + ' · ' + statusLabel(currentCase.status) +
      (currentCase.created_by_email ? ' · автор: ' + currentCase.created_by_email : '');

    const available = currentAvailableTemplates();

    renderCaseTemplatesBox(available);
    await renderCaseFieldsForm(available);
    renderCaseDocuments();
    renderCaseDocTabs(available);
    caseHasPendingChanges = false;
    updateGenerateButtonState();

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
    startCasesListPolling();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

function renderCaseTemplatesBox(available){
  const mainBox = document.getElementById('caseTemplatesBoxMain');
  const serviceBox = document.getElementById('caseTemplatesBoxService');

  function renderGroup(box, items){
    if (!items.length){
      box.innerHTML = '<div style="color:var(--muted);font-size:13px;">Нет доступных шаблонов</div>';
      return;
    }
    box.innerHTML = items.map(t => `
      <label style="display:flex;align-items:center;gap:9px;padding:6px 0;font-size:13.5px;">
        <input type="checkbox" value="${t.id}" ${currentCaseSelectedTemplates.has(t.id) ? 'checked' : ''}
          onchange="onCaseTemplateToggle()">
        ${escapeHtml(t.name)}
      </label>`).join('');
  }

  renderGroup(mainBox, available.filter(t => t.doc_group !== 'service'));
  renderGroup(serviceBox, available.filter(t => t.doc_group === 'service'));
}

function currentAvailableTemplates(){
  return currentCaseAvailableTemplates;
}

async function onCaseTemplateToggle(){
  const boxes = document.querySelectorAll('#caseTemplatesBoxMain input[type=checkbox], #caseTemplatesBoxService input[type=checkbox]');
  currentCaseSelectedTemplates = new Set(
    Array.from(boxes).filter(b => b.checked).map(b => b.value)
  );
  const available = currentAvailableTemplates();
  await renderCaseFieldsForm(available);
  renderCaseDocTabs(available);
  markCaseHasPendingChanges();
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
      if (f.field_type === 'documents_list') continue; // заполняется автоматически, в форму не выводим
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
          ${caseFieldInputHtml(f, groupKey, existingValues[groupKey] || '')}
        </div>`).join('')
    : '<div style="color:var(--muted);">В выбранных документах не найдено полей</div>';
}

function caseFieldInputHtml(f, groupKey, value){
  // Тип поля ограничивает, что можно ввести — например, в "дату" больше
  // нельзя напечатать буквы: браузер сам не даст ввести некорректный формат.
  const key = escapeHtml(groupKey);
  const val = escapeHtml(value);
  if (f.field_type === 'textarea'){
    return `<textarea rows="3" data-field-key="${key}" oninput="scheduleRefreshPreview()">${val}</textarea>`;
  }
  if (f.field_type === 'date'){
    // value дела хранится как обычный текст — если это не ISO-дата
    // (yyyy-mm-dd), нативный date-picker её не примет, оставляем поле
    // пустым, а не подставляем нечитаемое значение.
    const isoVal = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    return `<input type="date" data-field-key="${key}" value="${isoVal}" oninput="scheduleRefreshPreview()">`;
  }
  if (f.field_type === 'number' || f.field_type === 'money'){
    return `<input type="number" step="any" inputmode="decimal" data-field-key="${key}" value="${val}" oninput="scheduleRefreshPreview()">`;
  }
  return `<input type="text" data-field-key="${key}" value="${val}" oninput="scheduleRefreshPreview()">`;
}

async function saveCaseFields(opts = {}){
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
    if (!opts.silent) toast('Данные сохранены');
  } catch (err){
    // Автосохранение молча повторит попытку при следующем вводе — не
    // показываем тост на каждую неудачу фонового сохранения, только для
    // явного вызова (например, перед генерацией).
    if (!opts.silent){
      errBox.textContent = 'Ошибка сохранения: ' + err.message;
      errBox.style.display = 'block';
    }
  }
}

// ---------- предпросмотр документа (вкладки + просмотр/редактирование) ----------

let currentDocTabId = null;
let previewDebounceTimer = null;
let isEditingDoc = false;
let lastPreviewParagraphs = [];   // текущие абзацы активной вкладки (как пришли с сервера)
let lastPreviewHasManualEdit = false;

let currentDocGroup = 'main';   // активная вкладка верхнего уровня: 'main' | 'service'

function renderCaseDocTabs(available){
  const groupTabsBox = document.getElementById('docGroupTabs');
  const tabsBox = document.getElementById('docTabs');
  const selected = available.filter(t => currentCaseSelectedTemplates.has(t.id));

  if (!selected.length){
    groupTabsBox.innerHTML = '';
    tabsBox.innerHTML = '';
    document.getElementById('docPreviewTitle').textContent = '—';
    document.getElementById('docBody').innerHTML = '<div class="doc-body-empty">Отметьте документ слева, чтобы увидеть предпросмотр</div>';
    setEditModeUI(false);
    currentDocTabId = null;
    return;
  }

  const groups = [
    { value: 'main', label: 'Основные', items: selected.filter(t => t.doc_group !== 'service') },
    { value: 'service', label: 'Служебные', items: selected.filter(t => t.doc_group === 'service') },
  ].filter(g => g.items.length);

  if (!groups.some(g => g.value === currentDocGroup)){
    currentDocGroup = groups[0].value;
  }
  const activeGroup = groups.find(g => g.value === currentDocGroup);

  groupTabsBox.innerHTML = groups.length > 1
    ? groups.map(g => `
        <div class="doc-tab ${g.value === currentDocGroup ? 'active' : ''}" onclick="selectDocGroup('${g.value}')">
          ${escapeHtml(g.label)}
        </div>`).join('')
    : '';

  if (!currentDocTabId || !activeGroup.items.some(t => t.id === currentDocTabId)){
    currentDocTabId = activeGroup.items[0].id;
  }

  tabsBox.innerHTML = activeGroup.items.map(t => `
    <div class="doc-tab ${t.id === currentDocTabId ? 'active' : ''}" data-doc="${t.id}" onclick="selectDocTab('${t.id}')">
      <span class="dot"></span>${escapeHtml(t.name)}
    </div>`).join('');

  isEditingDoc = false;
  refreshPreview();
}

function selectDocGroup(groupValue){
  if (isEditingDoc){
    const ok = window.confirm('Несохранённые правки этого документа будут потеряны. Переключиться на другую группу?');
    if (!ok) return;
  }
  currentDocGroup = groupValue;
  currentDocTabId = null; // выбор конкретного документа заново — из первого в группе
  renderCaseDocTabs(currentAvailableTemplates());
}

function selectDocTab(templateId){
  if (isEditingDoc){
    const ok = window.confirm('Несохранённые правки этого документа будут потеряны. Переключиться на другой документ?');
    if (!ok) return;
  }
  currentDocTabId = templateId;
  isEditingDoc = false;
  document.querySelectorAll('#docTabs .doc-tab').forEach(el => el.classList.toggle('active', el.dataset.doc === templateId));
  refreshPreview();
}

let fieldsAutoSaveTimer = null;

function scheduleRefreshPreview(){
  if (isEditingDoc) return; // пока правим текст руками — не затираем правки живым рендером по полям
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(refreshPreview, 500);

  // Данные автоматически сохраняются в базу (без отдельной кнопки), с
  // небольшой задержкой после последнего нажатия клавиши.
  clearTimeout(fieldsAutoSaveTimer);
  fieldsAutoSaveTimer = setTimeout(() => saveCaseFields({ silent: true }), 800);

  markCaseHasPendingChanges();
}

// ---------- статус кнопки "Сгенерировать/Обновить документы" ----------

let caseHasPendingChanges = false;

function markCaseHasPendingChanges(){
  caseHasPendingChanges = true;
  updateGenerateButtonState();
}

function updateGenerateButtonState(){
  const btn = document.getElementById('generateDocsBtn');
  if (!btn) return;
  const alreadyGenerated = !!(currentCase && currentCase.documents && currentCase.documents.length);
  if (!alreadyGenerated){
    btn.textContent = 'Сгенерировать документы';
    btn.disabled = false;
    return;
  }
  btn.textContent = 'Обновить документы';
  btn.disabled = !caseHasPendingChanges;
}

function highlightGaps(text){
  // Сервер вставляет служебные метки: ⟦...⟧ для незаполненных полей
  // (подсвечиваем красным — «пропуск»), ⟪...⟫ для полей, куда реально была
  // подставлена подстановка, в т.ч. через склонение (подсвечиваем синим —
  // «внимание, это подставленное значение, проверьте его глазами»).
  // В итоговом скачанном файле таких меток нет — они только для предпросмотра.
  let html = escapeHtml(text);
  html = html.replace(/⟦([^⟧]*)⟧/g, '<span class="gap">$1</span>');
  html = html.replace(/⟪([^⟫]*)⟫/g, '<span class="filled">$1</span>');
  return html;
}

function renderDocBodyReadOnly(paragraphs){
  const docBody = document.getElementById('docBody');
  docBody.innerHTML = paragraphs.length
    ? paragraphs.map(p => `<p>${p.trim() ? highlightGaps(p) : '&nbsp;'}</p>`).join('')
    : '<div class="doc-body-empty">В документе не найдено текстовых абзацев</div>';
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
      body: JSON.stringify({
        template_id: currentDocTabId,
        values,
        selected_template_ids: Array.from(currentCaseSelectedTemplates)
      })
    });
    lastPreviewParagraphs = result.paragraphs;
    lastPreviewHasManualEdit = result.has_manual_edit;
    renderDocBodyReadOnly(lastPreviewParagraphs);
    setEditModeUI(false, lastPreviewHasManualEdit);
  } catch (err){
    docBody.innerHTML = `<div class="doc-body-empty">Не удалось построить предпросмотр: ${escapeHtml(err.message)}</div>`;
  }
}

function setEditModeUI(editing, hasManualEdit){
  const editBtn = document.getElementById('docEditBtn');
  const saveBtn = document.getElementById('docSaveEditBtn');
  const cancelBtn = document.getElementById('docCancelEditBtn');
  const resetBtn = document.getElementById('docResetEditBtn');
  if (!editBtn) return;
  editBtn.style.display = editing ? 'none' : 'inline-flex';
  saveBtn.style.display = editing ? 'inline-flex' : 'none';
  cancelBtn.style.display = editing ? 'inline-flex' : 'none';
  resetBtn.style.display = (!editing && hasManualEdit) ? 'inline-flex' : 'none';
}

function autoGrowTextarea(ta){
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
}

function startEditDoc(){
  if (!currentDocTabId) return;
  isEditingDoc = true;
  const docBody = document.getElementById('docBody');
  docBody.innerHTML = '';
  // Один textarea НА КАЖДЫЙ абзац (а не одно большое поле на весь текст) —
  // это принципиально: так число абзацев физически не может разъехаться
  // при сохранении (раньше лишняя/недостающая пустая строка в общем поле
  // сдвигала все абзацы после неё, и на сервере им доставалось чужое
  // форматирование — см. _apply_paragraph_texts в main.py).
  //
  // Текст абзацев показываем КАК ЕСТЬ, включая служебные метки ⟪⟫/⟦⟧ —
  // это осознанно: метки нужны, чтобы после сохранения правки нетронутые
  // абзацы по-прежнему подсвечивались (синим/красным) при повторном
  // открытии документа. От утечки этих меток в скачанный .docx это не
  // страдает — они вычищаются один раз, прямо перед вставкой текста в
  // итоговый файл на генерации (см. _strip_preview_markers в main.py).
  const wrap = document.createElement('div');
  wrap.id = 'docEditParagraphs';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
  lastPreviewParagraphs.forEach(p => {
    const ta = document.createElement('textarea');
    ta.className = 'doc-edit-paragraph';
    ta.style.cssText = 'width:100%;min-height:40px;border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-family:var(--font-doc);font-size:14.5px;line-height:1.7;resize:none;overflow:hidden;';
    ta.value = p;
    ta.addEventListener('input', () => autoGrowTextarea(ta));
    wrap.appendChild(ta);
  });
  docBody.appendChild(wrap);
  wrap.querySelectorAll('textarea').forEach(autoGrowTextarea);
  setEditModeUI(true);
  const first = wrap.querySelector('textarea');
  if (first) first.focus();
}

function cancelEditDoc(){
  isEditingDoc = false;
  renderDocBodyReadOnly(lastPreviewParagraphs);
  setEditModeUI(false, lastPreviewHasManualEdit);
}

async function saveEditDoc(){
  const wrap = document.getElementById('docEditParagraphs');
  if (!wrap) return;
  // Порядок textarea в DOM == порядок абзацев — берём значения как есть,
  // без split по строкам, поэтому число абзацев остаётся ровно таким же,
  // каким было при открытии редактирования.
  const paragraphs = Array.from(wrap.querySelectorAll('textarea')).map(ta => ta.value);

  // Те же значения полей, что видел юрист в момент правки — сервер
  // рендерит по ним ТОТ ЖЕ документ и применяет правки прямо к нему.
  const inputs = document.querySelectorAll('#caseFieldsBox [data-field-key]');
  const values = {};
  inputs.forEach(el => { values[el.getAttribute('data-field-key')] = el.value; });

  try {
    const result = await api(`/cases/${currentCase.id}/documents/edit`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        template_id: currentDocTabId,
        paragraphs,
        values,
        selected_template_ids: Array.from(currentCaseSelectedTemplates)
      })
    });
    lastPreviewParagraphs = result.paragraphs;
    lastPreviewHasManualEdit = result.has_manual_edit;
    isEditingDoc = false;
    renderDocBodyReadOnly(lastPreviewParagraphs);
    setEditModeUI(false, true);
    markCaseHasPendingChanges();
    toast('Правки сохранены — учтутся при генерации документа');
  } catch (err){
    // 409 — данные дела успели измениться, пока шло редактирование
    // (см. save_document_edit на сервере); предлагаем переоткрыть документ,
    // а не тихо считать, что правки сохранились.
    if (String(err.message).includes('изменились, пока вы редактировали')){
      toast('Данные дела изменились, пока вы редактировали документ — переоткройте его и повторите правки');
    } else {
      toast('Ошибка сохранения правок: ' + err.message);
    }
  }
}

async function resetEditDoc(){
  if (!currentDocTabId || !currentCase) return;
  const ok = window.confirm('Отменить ручные правки текста и вернуться к автоматической подстановке полей?');
  if (!ok) return;
  try {
    await api(`/cases/${currentCase.id}/documents/edit?template_id=${currentDocTabId}`, { method: 'DELETE' });
    toast('Ручные правки отменены');
    await refreshPreview();
    markCaseHasPendingChanges();
  } catch (err){
    toast('Ошибка: ' + err.message);
  }
}

async function generateDocuments(){
  if (!currentCaseSelectedTemplates.size){
    toast('Сначала выберите хотя бы один документ');
    return;
  }
  const wasAlreadyGenerated = !!(currentCase.documents && currentCase.documents.length);
  const errBox = document.getElementById('caseFormError');
  errBox.style.display = 'none';
  try {
    // Сначала сохраняем текущие значения формы, чтобы генерация шла по свежим данным
    await saveCaseFields({ silent: true });
    await api(`/cases/${currentCase.id}/generate`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ template_ids: Array.from(currentCaseSelectedTemplates) })
    });
    currentCase = await api(`/cases/${currentCase.id}`);
    renderCaseDocuments();
    document.getElementById('caseSub').textContent =
      categoryName(currentCase.category_id) + ' · ' + statusLabel(currentCase.status) +
      (currentCase.created_by_email ? ' · автор: ' + currentCase.created_by_email : '');
    caseHasPendingChanges = false;
    updateGenerateButtonState();
    toast(wasAlreadyGenerated ? 'Документы обновлены' : 'Документы сгенерированы');
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

async function downloadAllCaseDocuments(format){
  if (!currentCase) return;
  try {
    const res = await fetch(`${API}/cases/${currentCase.id}/download-all?format=${format}`, {
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
  let match = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (match) { try { return decodeURIComponent(match[1]); } catch(e) {} }
  match = cd.match(/filename="?([^";]+)"?/i);
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
