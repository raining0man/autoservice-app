// ============================================================
// Автосервис Админ v8.0 — Firebase Sync + расширенные функции
// - Виды работ, статусы, комментарии, даты, поиск, итоги
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyABMtS_Ix0172SV8ICquhoytqZ1sDJ8RZw",
  authDomain: "menu-auto-e79d2.firebaseapp.com",
  projectId: "menu-auto-e79d2",
  storageBucket: "menu-auto-e79d2.firebasestorage.app",
  messagingSenderId: "398535584228",
  appId: "1:398535584228:web:157d79f5f0c38899983ff1",
  measurementId: "G-LHYD04M8FM"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ---------- Данные ----------
let clients = [];
let orders = [];
let dataVersion = 0;
let tempCars = [];
let tempExpenses = [];
let selectedClientIdx = null;
let selectedCarIdx = null;
let editClientIdx = null;
let editClientCars = [];
let editOrderIdx = null;
let editOrderExpenses = [];

let isReady = false;
let isSaving = false;
let firebaseConnected = false;

let searchQuery = '';
let orderFilter = 'all'; // 'all' | 'in_progress' | 'done'

const WORK_TYPES = ['Слесарные работы', 'Малярные работы', 'Кузовные работы', 'Арматурные работы'];

// ---------- Статус ----------
function setStatus(text, state) {
    const el = document.getElementById('statusText');
    const dot = document.getElementById('syncDot');
    if (el) el.textContent = text;
    if (dot) {
        dot.className = 'sync-dot';
        if (state) dot.classList.add(state);
    }
}

function updateVersionDisplay() {
    const el = document.getElementById('versionText');
    if (el) el.textContent = 'v' + dataVersion;
}

// ---------- Локальный кэш ----------
function saveToLocalCache() {
    try {
        localStorage.setItem('autoservice_cache', JSON.stringify({
            clients, orders, version: dataVersion,
            updatedAt: new Date().toISOString()
        }));
    } catch (e) { console.warn('Ошибка локального кэша:', e); }
}

function loadFromLocalCache() {
    try {
        const saved = localStorage.getItem('autoservice_cache');
        if (saved) {
            const parsed = JSON.parse(saved);
            clients = parsed.clients || [];
            orders = parsed.orders || [];
            dataVersion = parsed.version || 0;
            console.log('📦 Локальный кэш:', clients.length, 'клиентов,', orders.length, 'заказов');
            return true;
        }
    } catch (e) { console.warn('Ошибка чтения кэша:', e); }
    return false;
}

// ---------- Миграция старых данных ----------
function migrateData() {
    clients = clients.map(c => {
        if (c.car !== undefined && !c.cars) {
            return {
                name: c.name, phone: c.phone,
                cars: c.car ? [{ model: c.car, plate: '' }] : [],
                comment: ''
            };
        }
        if (c.comment === undefined) c.comment = '';
        return c;
    });
    orders = orders.map(o => {
        if (!o.workType) o.workType = 'Слесарные работы';
        if (!o.status) o.status = 'in_progress';
        if (!o.comment) o.comment = '';
        if (!o.acceptedAt) o.acceptedAt = '';
        return o;
    });
}

// ---------- Сохранение ----------
async function saveToFirebase() {
    saveToLocalCache();
    if (!isReady) {
        setStatus('Ожидание подключения...', '');
        return;
    }
    isSaving = true;
    dataVersion++;
    setStatus('Сохранение...', '');
    try {
        await db.collection('data').doc('main').set({
            clients: clients,
            orders: orders,
            version: dataVersion,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updateVersionDisplay();
        setStatus('Сохранено в облако', 'ok');
    } catch (e) {
        console.error('Ошибка сохранения:', e);
        setStatus('Локально (нет связи)', '');
    }
    isSaving = false;
}

// ---------- Подписка ----------
function subscribeToFirebase() {
    let firstSnapshot = false;
    db.collection('data').doc('main').onSnapshot((doc) => {
        if (isSaving) return;
        firebaseConnected = true;

        if (doc.exists) {
            const data = doc.data();
            const newVersion = data.version || 0;
            if (!firstSnapshot) {
                firstSnapshot = true;
                clients = data.clients || [];
                orders = data.orders || [];
                dataVersion = newVersion;
                migrateData();
                isReady = true;
                saveToLocalCache();
                renderAll();
                updateVersionDisplay();
                setStatus('Синхронизировано', 'ok');
            } else if (newVersion !== dataVersion) {
                clients = data.clients || [];
                orders = data.orders || [];
                dataVersion = newVersion;
                migrateData();
                saveToLocalCache();
                renderAll();
                updateVersionDisplay();
                setStatus('Обновлено из облака', 'ok');
            }
        } else {
            if (!firstSnapshot) {
                firstSnapshot = true;
                isReady = true;
                setStatus('Готово. Добавьте первого клиента', 'ok');
            }
        }
    }, (error) => {
        console.error('❌ onSnapshot error:', error);
        firebaseConnected = false;
        setStatus('Нет связи с облаком', 'error');
        isReady = true;
    });
}

// ---------- Старт ----------
async function init() {
    if (loadFromLocalCache()) {
        migrateData();
        renderAll();
        updateVersionDisplay();
        setStatus('Локальные данные. Подключение...', '');
    } else {
        setStatus('Подключение...', '');
    }

    const timeoutId = setTimeout(() => {
        if (!firebaseConnected) {
            setStatus('Нет связи с облаком. Работаем локально', 'error');
            isReady = true;
        }
    }, 15000);

    try {
        const userCred = await auth.signInAnonymously();
        console.log('✅ Авторизован. UID:', userCred.user.uid);
        setStatus('Авторизован. Загрузка данных...', '');
        subscribeToFirebase();
    } catch (e) {
        clearTimeout(timeoutId);
        console.error('❌ Ошибка авторизации:', e.code, e.message);
        setStatus('Ошибка авторизации: ' + e.code, 'error');
        isReady = true;
    }
}

// ---------- Временные списки ----------
function addCarToList() {
    const model = document.getElementById('carModel').value.trim();
    const plate = document.getElementById('carPlate').value.trim();
    if (!model) { alert('Введите марку и модель авто'); return; }
    tempCars.push({ model, plate });
    document.getElementById('carModel').value = '';
    document.getElementById('carPlate').value = '';
    renderTempCars();
}

function removeCarFromList(i) { tempCars.splice(i, 1); renderTempCars(); }

function renderTempCars() {
    const el = document.getElementById('carsTempList');
    if (!el) return;
    if (tempCars.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = tempCars.map((c, i) => `
        <div class="temp-item">
            <span>🚗 ${escapeHtml(c.model)}${c.plate ? ' (' + escapeHtml(c.plate) + ')' : ''}</span>
            <button onclick="removeCarFromList(${i})">✕</button>
        </div>
    `).join('');
}

function addExpenseToList() {
    const desc = document.getElementById('expenseDesc').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;
    if (!desc) { alert('Введите описание расхода'); return; }
    if (amount <= 0) { alert('Введите сумму больше нуля'); return; }
    tempExpenses.push({ desc, amount });
    document.getElementById('expenseDesc').value = '';
    document.getElementById('expenseAmount').value = '';
    renderTempExpenses();
}

function removeExpenseFromList(i) { tempExpenses.splice(i, 1); renderTempExpenses(); }

function renderTempExpenses() {
    const el = document.getElementById('expensesTempList');
    if (!el) return;
    if (tempExpenses.length === 0) { el.innerHTML = ''; return; }
    const total = tempExpenses.reduce((s, e) => s + e.amount, 0);
    el.innerHTML = tempExpenses.map((e, i) => `
        <div class="temp-item">
            <span>${escapeHtml(e.desc)} — ${e.amount.toFixed(0)} ₽</span>
            <button onclick="removeExpenseFromList(${i})">✕</button>
        </div>
    `).join('') + `
        <div style="font-size:12px; color:#888; text-align:right; padding:4px 8px 0 0;">
            Итого: <b>${total.toFixed(0)} ₽</b>
        </div>
    `;
}

// ---------- Клиенты ----------
function addClient() {
    const name = document.getElementById('clientName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const comment = document.getElementById('clientComment').value.trim();
    if (!name) { alert('Введите ФИО клиента'); return; }
    if (tempCars.length === 0) { alert('Добавьте хотя бы один автомобиль'); return; }

    clients.push({ name, phone, cars: [...tempCars], comment });
    tempCars = [];

    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientComment').value = '';
    renderTempCars();
    renderAll();
    saveToFirebase();
}

function deleteClient(index) {
    if (!confirm('Удалить клиента?')) return;
    if (selectedClientIdx === index) { selectedClientIdx = null; selectedCarIdx = null; }
    else if (selectedClientIdx !== null && selectedClientIdx > index) selectedClientIdx--;
    if (editClientIdx === index) editClientIdx = null;
    else if (editClientIdx !== null && editClientIdx > index) editClientIdx--;
    clients.splice(index, 1);
    renderAll();
    saveToFirebase();
}

function startEditClient(i) {
    editClientIdx = i;
    editClientCars = JSON.parse(JSON.stringify(clients[i].cars || []));
    renderClients();
}

function cancelEditClient() {
    editClientIdx = null;
    editClientCars = [];
    renderClients();
}

function updateEditCar(idx, field, value) {
    if (editClientCars[idx]) editClientCars[idx][field] = value;
}

function addEditCar() {
    const modelEl = document.getElementById('editCarModel_' + editClientIdx);
    const plateEl = document.getElementById('editCarPlate_' + editClientIdx);
    const model = modelEl.value.trim();
    const plate = plateEl.value.trim();
    if (!model) { alert('Введите марку и модель'); return; }
    editClientCars.push({ model, plate });
    renderClients();
}

function removeEditCar(idx) {
    if (!confirm('Удалить это авто?')) return;
    editClientCars.splice(idx, 1);
    renderClients();
}

function saveEditClient() {
    const nameEl = document.getElementById('editName_' + editClientIdx);
    const phoneEl = document.getElementById('editPhone_' + editClientIdx);
    const commentEl = document.getElementById('editComment_' + editClientIdx);
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    const comment = commentEl ? commentEl.value.trim() : '';
    if (!name) { alert('Введите ФИО'); return; }
    if (editClientCars.length === 0) { alert('Добавьте хотя бы одно авто'); return; }
    for (const car of editClientCars) {
        if (!car.model || !car.model.trim()) {
            alert('У каждого авто должна быть марка и модель');
            return;
        }
    }
    clients[editClientIdx].name = name;
    clients[editClientIdx].phone = phone;
    clients[editClientIdx].comment = comment;
    clients[editClientIdx].cars = editClientCars.map(c => ({
        model: c.model.trim(),
        plate: (c.plate || '').trim()
    }));
    editClientIdx = null;
    editClientCars = [];
    selectedClientIdx = null;
    selectedCarIdx = null;
    renderAll();
    saveToFirebase();
}

// ---------- Рендер клиентов ----------
function clientMatchesSearch(c, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if ((c.name || '').toLowerCase().includes(q)) return true;
    if ((c.phone || '').toLowerCase().includes(q)) return true;
    if ((c.comment || '').toLowerCase().includes(q)) return true;
    if ((c.cars || []).some(car =>
        (car.model || '').toLowerCase().includes(q) ||
        (car.plate || '').toLowerCase().includes(q)
    )) return true;
    return false;
}

function onSearchInput() {
    const el = document.getElementById('searchInput');
    searchQuery = el ? el.value.trim() : '';
    renderClients();
}

function renderClients() {
    const container = document.getElementById('clientsList');
    if (!container) return;

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty">Нет клиентов</div>';
        return;
    }

    const filtered = clients.map((c, i) => ({ ...c, _idx: i }))
        .filter(c => clientMatchesSearch(c, searchQuery));

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty">Ничего не найдено</div>';
        return;
    }

    container.innerHTML = filtered.map(c => {
        const i = c._idx;

        if (editClientIdx === i) {
            let carsHtml = '';
            for (let idx = 0; idx < editClientCars.length; idx++) {
                const car = editClientCars[idx];
                carsHtml += '<div style="margin-bottom:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; border-left:3px solid #2ea6ff;">';
                carsHtml += '<label>Марка, модель:</label>';
                carsHtml += '<input type="text" value="' + escapeAttr(car.model || '') + '" oninput="updateEditCar(' + idx + ', \'model\', this.value)" />';
                carsHtml += '<label>Гос. номер:</label>';
                carsHtml += '<input type="text" value="' + escapeAttr(car.plate || '') + '" oninput="updateEditCar(' + idx + ', \'plate\', this.value)" />';
                carsHtml += '<button class="btn-secondary" style="background:#dc3545; color:#fff; margin-top:4px;" onclick="removeEditCar(' + idx + ')">🗑 Удалить это авто</button>';
                carsHtml += '</div>';
            }
            if (editClientCars.length === 0) {
                carsHtml = '<div class="empty" style="padding:8px 0;">Авто пока нет</div>';
            }

            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header">
                    <strong>✏️ Редактирование клиента</strong>
                </div>
                <label>ФИО:</label>
                <input type="text" id="editName_${i}" value="${escapeAttr(c.name)}" />
                <label>Телефон:</label>
                <input type="tel" id="editPhone_${i}" value="${escapeAttr(c.phone || '')}" />
                <label>Комментарий:</label>
                <textarea id="editComment_${i}" rows="2">${escapeHtml(c.comment || '')}</textarea>

                <div class="sub-section">
                    <div class="sub-title">🚗 Автомобили</div>
                    ${carsHtml}
                    <div style="margin-top:12px; padding-top:12px; border-top:1px dashed rgba(0,0,0,0.15);">
                        <div class="sub-title">➕ Добавить новое авто</div>
                        <input type="text" id="editCarModel_${i}" placeholder="Марка, модель" />
                        <input type="text" id="editCarPlate_${i}" placeholder="Гос. номер (необязательно)" />
                        <button class="btn-secondary" onclick="addEditCar()">➕ Добавить</button>
                    </div>
                </div>

                <button class="btn-success" onclick="saveEditClient()">✓ Сохранить всё</button>
                <button class="btn-secondary" onclick="cancelEditClient()">Отмена</button>
            </div>
            `;
        }

        let carsList = '';
        (c.cars || []).forEach(car => {
            carsList += '<div class="car-line"><span class="car-info">🚗 ' + escapeHtml(car.model) + (car.plate ? ' · ' + escapeHtml(car.plate) : '') + '</span></div>';
        });

        return `
        <div class="card">
            <div class="card-header">
                <div>
                    <strong>${escapeHtml(c.name)}</strong>
                    <small>${escapeHtml(c.phone || 'без телефона')}</small>
                </div>
                <div class="card-actions">
                    <button class="btn-icon edit" onclick="startEditClient(${i})">✏️</button>
                    <button class="btn-icon delete" onclick="deleteClient(${i})">✕</button>
                </div>
            </div>
            <div>${carsList}</div>
            ${c.comment ? `<div class="order-comment">💬 ${escapeHtml(c.comment)}</div>` : ''}
        </div>
        `;
    }).join('');
}

// ---------- Пикер клиентов ----------
function renderClientPicker() {
    const el = document.getElementById('clientPicker');
    if (!el) return;
    if (clients.length === 0) {
        el.innerHTML = '<div class="empty">Сначала добавьте клиента</div>';
        selectedClientIdx = null;
        return;
    }
    el.innerHTML = clients.map((c, i) => `
        <button class="picker-btn ${selectedClientIdx === i ? 'active' : ''}" onclick="selectClient(${i})">
            ${escapeHtml(c.name)}
            <small>${escapeHtml(c.phone || 'без телефона')} · авто: ${(c.cars || []).length}</small>
        </button>
    `).join('');
}

function selectClient(idx) {
    selectedClientIdx = idx;
    selectedCarIdx = null;
    renderClientPicker();
    renderCarPicker();
    updateOrderFormVisibility();
}

// ---------- Пикер авто ----------
function renderCarPicker() {
    const section = document.getElementById('carPickerSection');
    const el = document.getElementById('carPicker');
    if (!section || !el) return;

    if (selectedClientIdx === null) { section.style.display = 'none'; return; }

    const client = clients[selectedClientIdx];
    const cars = client.cars || [];

    if (cars.length === 0) {
        section.style.display = 'block';
        el.innerHTML = '<div class="empty">У клиента нет авто</div>';
        return;
    }
    section.style.display = 'block';
    el.innerHTML = cars.map((car, i) => `
        <button class="picker-btn ${selectedCarIdx === i ? 'active' : ''}" onclick="selectCar(${i})">
            🚗 ${escapeHtml(car.model)}
            ${car.plate ? '<small>' + escapeHtml(car.plate) + '</small>' : ''}
        </button>
    `).join('');
}

function selectCar(idx) {
    selectedCarIdx = idx;
    renderCarPicker();
    updateOrderFormVisibility();
}

function updateOrderFormVisibility() {
    const form = document.getElementById('orderFormSection');
    if (!form) return;
    const show = (selectedClientIdx !== null && selectedCarIdx !== null);
    form.style.display = show ? 'block' : 'none';
    if (show && !document.getElementById('orderAccepted').value) {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('orderAccepted').value = today;
    }
}

// ---------- Заказы ----------
function addOrder() {
    if (selectedClientIdx === null) { alert('Выберите клиента'); return; }
    if (selectedCarIdx === null) { alert('Выберите автомобиль'); return; }

    const workType = document.getElementById('orderWorkType').value;
    const work = document.getElementById('orderWork').value.trim();
    const cost = parseFloat(document.getElementById('orderCost').value) || 0;
    const acceptedAt = document.getElementById('orderAccepted').value;
    const deadline = document.getElementById('orderDeadline').value;
    const prepayment = parseFloat(document.getElementById('orderPrepayment').value) || 0;
    const comment = document.getElementById('orderComment').value.trim();

    if (!work) { alert('Введите описание работ'); return; }

    const client = clients[selectedClientIdx];
    const car = client.cars[selectedCarIdx];

    orders.push({
        clientName: client.name,
        clientPhone: client.phone,
        carModel: car.model,
        carPlate: car.plate,
        workType: workType,
        work: work,
        status: 'in_progress',
        cost: cost,
        acceptedAt: acceptedAt,
        deadline: deadline,
        prepayment: prepayment,
        comment: comment,
        expenses: [...tempExpenses],
        date: new Date().toLocaleDateString('ru-RU'),
        createdAt: new Date().toISOString()
    });

    tempExpenses = [];
    document.getElementById('orderWork').value = '';
    document.getElementById('orderCost').value = '';
    document.getElementById('orderAccepted').value = '';
    document.getElementById('orderDeadline').value = '';
    document.getElementById('orderPrepayment').value = '';
    document.getElementById('orderComment').value = '';
    renderTempExpenses();

    selectedClientIdx = null;
    selectedCarIdx = null;
    renderClientPicker();
    renderCarPicker();
    updateOrderFormVisibility();

    renderAll();
    saveToFirebase();
}

function deleteOrder(index) {
    if (!confirm('Удалить заказ?')) return;
    if (editOrderIdx === index) editOrderIdx = null;
    else if (editOrderIdx !== null && editOrderIdx > index) editOrderIdx--;
    orders.splice(index, 1);
    renderAll();
    saveToFirebase();
}

function startEditOrder(i) {
    editOrderIdx = i;
    editOrderExpenses = JSON.parse(JSON.stringify(orders[i].expenses || []));
    renderOrders();
}

function cancelEditOrder() {
    editOrderIdx = null;
    editOrderExpenses = [];
    renderOrders();
}

function saveEditOrder() {
    const o = orders[editOrderIdx];
    const i = editOrderIdx;
    const workType = document.getElementById('editWorkType_' + i).value;
    const work = document.getElementById('editWork_' + i).value.trim();
    const status = document.getElementById('editStatus_' + i).value;
    const cost = parseFloat(document.getElementById('editCost_' + i).value) || 0;
    const acceptedAt = document.getElementById('editAccepted_' + i).value;
    const deadline = document.getElementById('editDeadline_' + i).value;
    const prepayment = parseFloat(document.getElementById('editPrepayment_' + i).value) || 0;
    const comment = document.getElementById('editComment_' + i).value.trim();

    if (!work) { alert('Введите описание работ'); return; }

    o.workType = workType;
    o.work = work;
    o.status = status;
    o.cost = cost;
    o.acceptedAt = acceptedAt;
    o.deadline = deadline;
    o.prepayment = prepayment;
    o.comment = comment;
    o.expenses = [...editOrderExpenses];

    editOrderIdx = null;
    editOrderExpenses = [];
    renderAll();
    saveToFirebase();
}

function addEditOrderExpense() {
    const descEl = document.getElementById('editExpDesc_' + editOrderIdx);
    const amountEl = document.getElementById('editExpAmount_' + editOrderIdx);
    const desc = descEl.value.trim();
    const amount = parseFloat(amountEl.value) || 0;
    if (!desc) { alert('Введите описание расхода'); return; }
    if (amount <= 0) { alert('Введите сумму больше нуля'); return; }
    editOrderExpenses.push({ desc, amount });
    renderOrders();
}

function removeEditOrderExpense(idx) {
    editOrderExpenses.splice(idx, 1);
    renderOrders();
}

function setOrderFilter(f) {
    orderFilter = f;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === f);
    });
    renderOrders();
}

// ---------- Дедлайн ----------
function parseDate(s) {
    if (!s) return null;
    const d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
}

function getDeadlineInfo(deadline, status) {
    if (status === 'done') return { text: 'выполнен', cls: 'status-done' };
    if (!deadline) return { text: 'без срока', cls: '' };
    const today = new Date(); today.setHours(0,0,0,0);
    const dl = parseDate(deadline);
    if (!dl) return { text: 'без срока', cls: '' };
    const diff = Math.round((dl - today) / (1000 * 60 * 60 * 24));
    const formatted = dl.toLocaleDateString('ru-RU');
    if (diff < 0)  return { text: 'просрочен на ' + Math.abs(diff) + ' дн. (' + formatted + ')', cls: 'overdue' };
    if (diff === 0) return { text: 'сегодня (' + formatted + ')',  cls: 'today' };
    if (diff <= 3)  return { text: 'через ' + diff + ' дн. (' + formatted + ')', cls: 'today' };
    return { text: formatted + ' (через ' + diff + ' дн.)', cls: 'ok' };
}

function formatAccepted(dateStr) {
    if (!dateStr) return '—';
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    return d.toLocaleDateString('ru-RU');
}

// ---------- Рендер заказов ----------
function renderOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;

    let visible = orders.map((o, i) => ({ ...o, _idx: i }));
    if (orderFilter !== 'all') {
        visible = visible.filter(o => (o.status || 'in_progress') === orderFilter);
    }

    if (visible.length === 0) {
        container.innerHTML = '<div class="empty">Нет заказов' + (orderFilter !== 'all' ? ' в этой категории' : '') + '</div>';
        return;
    }

    container.innerHTML = visible.map(o => {
        const i = o._idx;

        if (editOrderIdx === i) {
            const expensesTotal = editOrderExpenses.reduce((s, e) => s + e.amount, 0);
            let expensesHtml = '';
            editOrderExpenses.forEach((e, idx) => {
                expensesHtml += '<div class="temp-item"><span>' + escapeHtml(e.desc) + ' — ' + e.amount.toFixed(0) + ' ₽</span><button onclick="removeEditOrderExpense(' + idx + ')">✕</button></div>';
            });
            if (editOrderExpenses.length === 0) {
                expensesHtml = '<div class="empty" style="padding:6px 0; font-size:12px;">Расходов нет</div>';
            }

            let typeOptions = WORK_TYPES.map(t =>
                `<option value="${t}" ${o.workType === t ? 'selected' : ''}>${t}</option>`
            ).join('');

            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header">
                    <strong>✏️ Редактирование заказа</strong>
                </div>
                <small style="color:#888; font-size:12px; display:block; margin-bottom:8px;">
                    👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ' (' + escapeHtml(o.carPlate) + ')' : ''}
                </small>

                <label>Вид работ:</label>
                <select id="editWorkType_${i}">${typeOptions}</select>

                <label>Описание работ:</label>
                <input type="text" id="editWork_${i}" value="${escapeAttr(o.work)}" />

                <label>Статус:</label>
                <select id="editStatus_${i}">
                    <option value="in_progress" ${o.status === 'in_progress' ? 'selected' : ''}>В работе</option>
                    <option value="done" ${o.status === 'done' ? 'selected' : ''}>Готов</option>
                </select>

                <label>Стоимость работ (руб.):</label>
                <input type="number" id="editCost_${i}" value="${o.cost || 0}" />

                <label>Дата принятия в работу:</label>
                <input type="date" id="editAccepted_${i}" value="${o.acceptedAt || ''}" />

                <label>Срок выполнения:</label>
                <input type="date" id="editDeadline_${i}" value="${o.deadline || ''}" />

                <label>Предоплата (руб.):</label>
                <input type="number" id="editPrepayment_${i}" value="${o.prepayment || 0}" />

                <label>Комментарий:</label>
                <textarea id="editComment_${i}" rows="2">${escapeHtml(o.comment || '')}</textarea>

                <div class="sub-section">
                    <div class="sub-title">💸 Расходы</div>
                    ${expensesHtml}
                    <div style="font-size:12px; color:#888; text-align:right; padding:2px 8px 6px 0;">
                        Итого: <b>${expensesTotal.toFixed(0)} ₽</b>
                    </div>
                    <input type="text" id="editExpDesc_${i}" placeholder="Новый расход" />
                    <input type="number" id="editExpAmount_${i}" placeholder="Сумма (руб.)" />
                    <button class="btn-secondary" onclick="addEditOrderExpense()">➕ Добавить расход</button>
                </div>

                <button class="btn-success" onclick="saveEditOrder()">✓ Сохранить</button>
                <button class="btn-secondary" onclick="cancelEditOrder()">Отмена</button>
            </div>
            `;
        }

        const expensesTotal = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const profit = (o.cost || 0) - expensesTotal;
        const dl = getDeadlineInfo(o.deadline, o.status);
        const statusLabel = o.status === 'done' ? '✅ Готов' : '🔧 В работе';
        const statusCls = o.status === 'done' ? 'status-done' : 'status-in_progress';

        let expensesBlock = '';
        if (o.expenses && o.expenses.length > 0) {
            let expLines = '';
            o.expenses.forEach(e => {
                expLines += '<div class="exp-item"><span>' + escapeHtml(e.desc) + '</span><span>' + e.amount.toFixed(0) + ' ₽</span></div>';
            });
            expensesBlock = '<div class="order-expenses">' +
                '<div style="font-size:11px; color:#888; margin-bottom:4px;">Расходы:</div>' +
                expLines +
                '<div class="exp-item" style="border-top:1px solid rgba(0,0,0,0.08); margin-top:4px; padding-top:4px; font-weight:600;">' +
                '<span>Итого расходов:</span><span>' + expensesTotal.toFixed(0) + ' ₽</span></div></div>';
        }

        return `
        <div class="card">
            <div class="card-header">
                <div>
                    <strong>${escapeHtml(o.work)}</strong>
                    <small>👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ' (' + escapeHtml(o.carPlate) + ')' : ''}</small>
                </div>
                <div class="card-actions">
                    <button class="btn-icon edit" onclick="startEditOrder(${i})">✏️</button>
                    <button class="btn-icon delete" onclick="deleteOrder(${i})">✕</button>
                </div>
            </div>

            <div class="order-row">
                <span class="label">Статус:</span>
                <span><span class="badge ${statusCls}">${statusLabel}</span></span>
            </div>
            <div class="order-row">
                <span class="label">Вид работ:</span>
                <span><span class="badge type">${escapeHtml(o.workType || 'не указан')}</span></span>
            </div>
            <div class="order-row">
                <span class="label">Принят в работу:</span>
                <span>${formatAccepted(o.acceptedAt)}</span>
            </div>
            <div class="order-row">
                <span class="label">Срок:</span>
                <span><span class="badge ${dl.cls}">${dl.text}</span></span>
            </div>
            <div class="order-row">
                <span class="label">Стоимость работ:</span>
                <span>${(o.cost || 0).toFixed(0)} ₽</span>
            </div>
            <div class="order-row">
                <span class="label">Предоплата:</span>
                <span>${(o.prepayment || 0).toFixed(0)} ₽</span>
            </div>
            <div class="order-row">
                <span class="label">К доплате:</span>
                <span>${((o.cost || 0) - (o.prepayment || 0)).toFixed(0)} ₽</span>
            </div>

            ${expensesBlock}

            ${o.comment ? `<div class="order-comment">💬 ${escapeHtml(o.comment)}</div>` : ''}

            <div class="order-total">
                Прибыль: <span class="${profit >= 0 ? 'profit' : 'loss'}">${profit.toFixed(0)} ₽</span>
            </div>
        </div>
        `;
    }).join('');
}

// ---------- Итоги ----------
function calcTotals() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = { count: 0, cost: 0, expense: 0, profit: 0 };
    let month = { count: 0, cost: 0, expense: 0, profit: 0 };

    orders.forEach(o => {
        const exp = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const cost = o.cost || 0;
        const profit = cost - exp;

        total.count++;
        total.cost += cost;
        total.expense += exp;
        total.profit += profit;

        let created = null;
        if (o.createdAt) created = new Date(o.createdAt);
        else if (o.date) {
            const parts = o.date.split('.');
            if (parts.length === 3) created = new Date(parts[2], parts[1] - 1, parts[0]);
        }

        if (created && created >= monthStart) {
            month.count++;
            month.cost += cost;
            month.expense += exp;
            month.profit += profit;
        }
    });

    return { total, month };
}

function renderTotals() {
    const t = calcTotals();
    const elTotal = document.getElementById('totalsTotal');
    const elMonth = document.getElementById('totalsMonth');
    if (!elTotal || !elMonth) return;

    function box(title, value, sub, cls) {
        return `<div class="total-box">
            <div class="total-title">${title}</div>
            <div class="total-value ${cls || ''}">${value}</div>
            ${sub ? `<div class="total-sub">${sub}</div>` : ''}
        </div>`;
    }

    elTotal.innerHTML =
        box('Заказов', t.total.count) +
        box('Прибыль', t.total.profit.toFixed(0) + ' ₽', '', t.total.profit >= 0 ? 'profit' : 'loss') +
        box('Работ на сумму', t.total.cost.toFixed(0) + ' ₽') +
        box('Расходов', t.total.expense.toFixed(0) + ' ₽');

    elMonth.innerHTML =
        box('Заказов', t.month.count) +
        box('Прибыль', t.month.profit.toFixed(0) + ' ₽', '', t.month.profit >= 0 ? 'profit' : 'loss') +
        box('Работ на сумму', t.month.cost.toFixed(0) + ' ₽') +
        box('Расходов', t.month.expense.toFixed(0) + ' ₽');
}

// ---------- Очистка ----------
function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = []; orders = []; tempCars = []; tempExpenses = [];
    selectedClientIdx = null; selectedCarIdx = null;
    editClientIdx = null; editClientCars = [];
    editOrderIdx = null; editOrderExpenses = [];
    renderAll();
    saveToFirebase();
}

// ---------- Вспомогательные ----------
function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function escapeAttr(text) {
    if (text === undefined || text === null) return '';
    const AMP = String.fromCharCode(38);
    const QUOT = String.fromCharCode(34);
    const LT = String.fromCharCode(60);
    const GT = String.fromCharCode(62);
    return String(text)
        .split(AMP).join(AMP + 'amp;')
        .split(QUOT).join(AMP + 'quot;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;');
}

function renderAll() {
    renderClients();
    renderClientPicker();
    renderCarPicker();
    updateOrderFormVisibility();
    renderOrders();
    renderTotals();
    updateVersionDisplay();
    renderTempCars();
    renderTempExpenses();
}

// ---------- Старт ----------
init();
console.log('🔧 Автосервис Админ v8.0 — расширенная версия');
