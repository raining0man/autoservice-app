// ============================================================
// Автосервис Админ v10.1 — Firebase Sync
// - Название заказа = Вид работ
// - Тост-уведомления вместо alert (работают в Telegram)
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

let clients = [];
let orders = [];
let businessExpenses = [];
let dataVersion = 0;
let tempCars = [];
let tempExpenses = [];
let selectedClientIdx = null;
let selectedCarIdx = null;
let editClientIdx = null;
let editClientCars = [];
let editOrderIdx = null;
let editOrderExpenses = [];
let editBizExpIdx = null;

let isReady = false;
let isSaving = false;
let firebaseConnected = false;

let searchQuery = '';
let orderFilter = 'all';
let bizExpFilter = 'all';

const WORK_TYPES = ['Слесарные работы', 'Малярные работы', 'Кузовные работы', 'Арматурные работы'];
const STATUS_LABELS = {
    'callback':    { label: '📞 Перезвонить', cls: 'status-callback' },
    'inspection':  { label: '🔍 Осмотр',      cls: 'status-inspection' },
    'processing':  { label: '📋 Обработка',   cls: 'status-processing' },
    'in_progress': { label: '🔧 В работе',    cls: 'status-in_progress' },
    'done':        { label: '✅ Готов',       cls: 'status-done' },
    'refused':     { label: '❌ Отказ',       cls: 'status-refused' }
};

const BIZ_CATEGORIES = {
    'Аренда':       { icon: '🏠', fixedAmount: 176800, dayOfMonth: 5,  cls: 'cat-arenda' },
    'КУ':           { icon: '💡', fixedAmount: null,   dayOfMonth: 15, cls: 'cat-ku' },
    'Оборудование': { icon: '🔧', fixedAmount: null,   dayOfMonth: null, cls: 'cat-equip' },
    'Интернет':     { icon: '🌐', fixedAmount: null,   dayOfMonth: null, cls: 'cat-internet' },
    'Прочее':       { icon: '📦', fixedAmount: null,   dayOfMonth: null, cls: 'cat-other' }
};

function genId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Тост-уведомления ----------
function toast(message, type) {
    const el = document.getElementById('app-toast');
    if (!el) { console.log('[toast]', message); return; }
    el.textContent = message;
    el.className = type ? type : '';
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.classList.remove('show'); }, 2500);
}
function toastErr(msg) { toast(msg, 'error'); }
function toastOk(msg) { toast(msg, 'success'); }

// ---------- Статус синхронизации ----------
function setStatus(text, state) {
    const el = document.getElementById('statusText');
    const dot = document.getElementById('syncDot');
    if (el) el.textContent = text;
    if (dot) { dot.className = 'sync-dot'; if (state) dot.classList.add(state); }
}

function updateVersionDisplay() {
    const el = document.getElementById('versionText');
    if (el) el.textContent = 'v' + dataVersion;
}

// ---------- Кэш ----------
function saveToLocalCache() {
    try {
        localStorage.setItem('autoservice_cache', JSON.stringify({
            clients, orders, businessExpenses, version: dataVersion, updatedAt: new Date().toISOString()
        }));
    } catch (e) { console.warn(e); }
}

function loadFromLocalCache() {
    try {
        const saved = localStorage.getItem('autoservice_cache');
        if (saved) {
            const parsed = JSON.parse(saved);
            clients = parsed.clients || [];
            orders = parsed.orders || [];
            businessExpenses = parsed.businessExpenses || [];
            dataVersion = parsed.version || 0;
            return true;
        }
    } catch (e) { console.warn(e); }
    return false;
}

function migrateData() {
    clients = clients.map(c => {
        if (c.car !== undefined && !c.cars) {
            c = { name: c.name, phone: c.phone, cars: c.car ? [{ model: c.car, plate: '' }] : [], comment: '' };
        }
        if (!c.id) c.id = genId('client');
        if (c.comment === undefined) c.comment = '';
        c.cars = (c.cars || []).map(car => {
            if (!car.id) car.id = genId('car');
            if (car.vin === undefined) car.vin = '';
            if (car.paintCode === undefined) car.paintCode = '';
            return car;
        });
        return c;
    });
    orders = orders.map(o => {
        if (!o.workType) o.workType = 'Слесарные работы';
        if (!o.status) o.status = 'in_progress';
        if (!o.comment) o.comment = '';
        if (!o.acceptedAt) o.acceptedAt = '';
        return o;
    });
    businessExpenses = (businessExpenses || []).map(e => {
        if (!e.id) e.id = genId('bexp');
        if (e.paid === undefined) e.paid = false;
        if (e.comment === undefined) e.comment = '';
        return e;
    });
}

// ---------- Firebase ----------
async function saveToFirebase() {
    saveToLocalCache();
    if (!isReady) { setStatus('Ожидание подключения...', ''); return; }
    isSaving = true;
    dataVersion++;
    setStatus('Сохранение...', '');
    try {
        await db.collection('data').doc('main').set({
            clients, orders, businessExpenses, version: dataVersion,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        updateVersionDisplay();
        setStatus('Сохранено в облако', 'ok');
    } catch (e) {
        console.error(e);
        setStatus('Локально (нет связи)', '');
    }
    isSaving = false;
}

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
                businessExpenses = data.businessExpenses || [];
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
                businessExpenses = data.businessExpenses || [];
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
        console.error('onSnapshot:', error);
        firebaseConnected = false;
        setStatus('Нет связи с облаком', 'error');
        isReady = true;
    });
}

async function init() {
    if (loadFromLocalCache()) {
        migrateData();
        renderAll();
        updateVersionDisplay();
        setStatus('Локальные данные. Подключение...', '');
    } else {
        setStatus('Подключение...', '');
    }
    setTimeout(() => {
        if (!firebaseConnected) {
            setStatus('Нет связи с облаком. Работаем локально', 'error');
            isReady = true;
        }
    }, 15000);
    try {
        const userCred = await auth.signInAnonymously();
        console.log('✅ UID:', userCred.user.uid);
        subscribeToFirebase();
    } catch (e) {
        console.error(e);
        setStatus('Ошибка авторизации: ' + e.code, 'error');
        isReady = true;
    }
    // Автозаполнение полей расхода бизнеса
    setTimeout(onBizExpCategoryChange, 100);
}

// ---------- Временные списки ----------
function addCarToList() {
    const model = document.getElementById('carModel').value.trim();
    const plate = document.getElementById('carPlate').value.trim();
    const vin = document.getElementById('carVin').value.trim();
    const paintCode = document.getElementById('carPaintCode').value.trim();
    if (!model) { toastErr('Введите марку и модель авто'); return; }
    tempCars.push({ id: genId('car'), model, plate, vin, paintCode });
    ['carModel', 'carPlate', 'carVin', 'carPaintCode'].forEach(id => document.getElementById(id).value = '');
    renderTempCars();
    toastOk('Авто добавлено');
}

function removeCarFromList(i) { tempCars.splice(i, 1); renderTempCars(); }

function renderTempCars() {
    const el = document.getElementById('carsTempList');
    if (!el) return;
    if (tempCars.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = tempCars.map((c, i) => {
        let extra = '';
        if (c.vin) extra += ' · VIN: ' + escapeHtml(c.vin);
        if (c.paintCode) extra += ' · Код краски: ' + escapeHtml(c.paintCode);
        return `<div class="temp-item">
            <span>🚗 ${escapeHtml(c.model)}${c.plate ? ' (' + escapeHtml(c.plate) + ')' : ''}${extra}</span>
            <button onclick="removeCarFromList(${i})">✕</button>
        </div>`;
    }).join('');
}

function addExpenseToList() {
    const desc = document.getElementById('expenseDesc').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;
    if (!desc) { toastErr('Введите описание расхода'); return; }
    if (amount <= 0) { toastErr('Введите сумму больше нуля'); return; }
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
    `).join('') + `<div style="font-size:12px; color:#888; text-align:right; padding:4px 8px 0 0;">Итого: <b>${total.toFixed(0)} ₽</b></div>`;
}

// ---------- Клиенты ----------
function addClient() {
    const name = document.getElementById('clientName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const comment = document.getElementById('clientComment').value.trim();
    if (!name) { toastErr('Введите ФИО клиента'); return; }
    if (tempCars.length === 0) { toastErr('Добавьте хотя бы один автомобиль'); return; }
    clients.push({ id: genId('client'), name, phone, comment, cars: [...tempCars] });
    tempCars = [];
    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientComment').value = '';
    renderTempCars();
    renderAll();
    saveToFirebase();
    toastOk('Клиент добавлен');
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

function cancelEditClient() { editClientIdx = null; editClientCars = []; renderClients(); }

function updateEditCar(idx, field, value) {
    if (editClientCars[idx]) editClientCars[idx][field] = value;
}

function addEditCar() {
    const model = document.getElementById('editCarModel_' + editClientIdx).value.trim();
    const plate = document.getElementById('editCarPlate_' + editClientIdx).value.trim();
    const vin = document.getElementById('editCarVin_' + editClientIdx).value.trim();
    const paintCode = document.getElementById('editCarPaintCode_' + editClientIdx).value.trim();
    if (!model) { toastErr('Введите марку и модель'); return; }
    editClientCars.push({ id: genId('car'), model, plate, vin, paintCode });
    renderClients();
}

function removeEditCar(idx) {
    if (!confirm('Удалить это авто?')) return;
    editClientCars.splice(idx, 1);
    renderClients();
}

function saveEditClient() {
    const name = document.getElementById('editName_' + editClientIdx).value.trim();
    const phone = document.getElementById('editPhone_' + editClientIdx).value.trim();
    const comment = document.getElementById('editComment_' + editClientIdx).value.trim();
    if (!name) { toastErr('Введите ФИО'); return; }
    if (editClientCars.length === 0) { toastErr('Добавьте хотя бы одно авто'); return; }
    for (const car of editClientCars) {
        if (!car.model || !car.model.trim()) { toastErr('У каждого авто должна быть марка и модель'); return; }
        if (!car.id) car.id = genId('car');
    }
    clients[editClientIdx].name = name;
    clients[editClientIdx].phone = phone;
    clients[editClientIdx].comment = comment;
    clients[editClientIdx].cars = editClientCars.map(c => ({
        id: c.id, model: c.model.trim(), plate: (c.plate || '').trim(),
        vin: (c.vin || '').trim(), paintCode: (c.paintCode || '').trim()
    }));
    editClientIdx = null;
    editClientCars = [];
    selectedClientIdx = null;
    selectedCarIdx = null;
    renderAll();
    saveToFirebase();
    toastOk('Клиент обновлён');
}

function clientMatchesSearch(c, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if ((c.name || '').toLowerCase().includes(q)) return true;
    if ((c.phone || '').toLowerCase().includes(q)) return true;
    if ((c.comment || '').toLowerCase().includes(q)) return true;
    if ((c.cars || []).some(car =>
        (car.model || '').toLowerCase().includes(q) ||
        (car.plate || '').toLowerCase().includes(q) ||
        (car.vin || '').toLowerCase().includes(q) ||
        (car.paintCode || '').toLowerCase().includes(q)
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
    if (clients.length === 0) { container.innerHTML = '<div class="empty">Нет клиентов</div>'; return; }

    const filtered = clients.map((c, i) => ({ ...c, _idx: i })).filter(c => clientMatchesSearch(c, searchQuery));
    if (filtered.length === 0) { container.innerHTML = '<div class="empty">Ничего не найдено</div>'; return; }

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
                carsHtml += '<label>VIN:</label>';
                carsHtml += '<input type="text" value="' + escapeAttr(car.vin || '') + '" oninput="updateEditCar(' + idx + ', \'vin\', this.value)" />';
                carsHtml += '<label>Код краски:</label>';
                carsHtml += '<input type="text" value="' + escapeAttr(car.paintCode || '') + '" oninput="updateEditCar(' + idx + ', \'paintCode\', this.value)" />';
                carsHtml += '<button class="btn-secondary" style="background:#dc3545; color:#fff; margin-top:4px;" onclick="removeEditCar(' + idx + ')">🗑 Удалить это авто</button>';
                carsHtml += '</div>';
            }
            if (editClientCars.length === 0) carsHtml = '<div class="empty" style="padding:8px 0;">Авто пока нет</div>';

            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header"><strong>✏️ Редактирование клиента</strong></div>
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
                        <input type="text" id="editCarPlate_${i}" placeholder="Гос. номер" />
                        <input type="text" id="editCarVin_${i}" placeholder="VIN" />
                        <input type="text" id="editCarPaintCode_${i}" placeholder="Код краски" />
                        <button class="btn-secondary" onclick="addEditCar()">➕ Добавить</button>
                    </div>
                </div>

                <button class="btn-success" onclick="saveEditClient()">✓ Сохранить всё</button>
                <button class="btn-secondary" onclick="cancelEditClient()">Отмена</button>
            </div>`;
        }

        let carsList = '';
        (c.cars || []).forEach(car => {
            carsList += '<div class="car-line"><span class="car-info">🚗 ' + escapeHtml(car.model) + (car.plate ? ' · ' + escapeHtml(car.plate) : '') + '</span></div>';
            const extras = [];
            if (car.vin) extras.push('VIN: ' + escapeHtml(car.vin));
            if (car.paintCode) extras.push('Краска: ' + escapeHtml(car.paintCode));
            if (extras.length) carsList += '<div class="car-extra">' + extras.join(' · ') + '</div>';
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
        </div>`;
    }).join('');
}

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

function selectCar(idx) { selectedCarIdx = idx; renderCarPicker(); updateOrderFormVisibility(); }

function updateOrderFormVisibility() {
    const form = document.getElementById('orderFormSection');
    if (!form) return;
    const show = (selectedClientIdx !== null && selectedCarIdx !== null);
    form.style.display = show ? 'block' : 'none';
    if (show && !document.getElementById('orderAccepted').value) {
        document.getElementById('orderAccepted').value = new Date().toISOString().split('T')[0];
    }
}

// ---------- Заказы ----------
function addOrder() {
    if (selectedClientIdx === null) { toastErr('Выберите клиента'); return; }
    if (selectedCarIdx === null) { toastErr('Выберите автомобиль'); return; }

    const workType = document.getElementById('orderWorkType').value;
    const work = document.getElementById('orderWork').value.trim();
    const status = document.getElementById('orderStatus').value;
    const cost = parseFloat(document.getElementById('orderCost').value) || 0;
    const acceptedAt = document.getElementById('orderAccepted').value;
    const deadline = document.getElementById('orderDeadline').value;
    const prepayment = parseFloat(document.getElementById('orderPrepayment').value) || 0;
    const comment = document.getElementById('orderComment').value.trim();
    if (!work) { toastErr('Введите описание работ'); return; }

    const client = clients[selectedClientIdx];
    const car = client.cars[selectedCarIdx];

    orders.push({
        id: genId('order'),
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone,
        carId: car.id,
        carModel: car.model,
        carPlate: car.plate,
        workType, work, status, cost, acceptedAt, deadline, prepayment, comment,
        expenses: [...tempExpenses],
        date: new Date().toLocaleDateString('ru-RU'),
        createdAt: new Date().toISOString()
    });

    tempExpenses = [];
    ['orderWork', 'orderCost', 'orderAccepted', 'orderDeadline', 'orderPrepayment', 'orderComment'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('orderStatus').value = 'in_progress';
    renderTempExpenses();
    selectedClientIdx = null;
    selectedCarIdx = null;
    renderClientPicker();
    renderCarPicker();
    updateOrderFormVisibility();
    renderAll();
    saveToFirebase();
    toastOk('Заказ добавлен');
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

function cancelEditOrder() { editOrderIdx = null; editOrderExpenses = []; renderOrders(); }

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
    if (!work) { toastErr('Введите описание работ'); return; }

    o.workType = workType; o.work = work; o.status = status; o.cost = cost;
    o.acceptedAt = acceptedAt; o.deadline = deadline; o.prepayment = prepayment;
    o.comment = comment; o.expenses = [...editOrderExpenses];

    editOrderIdx = null;
    editOrderExpenses = [];
    renderAll();
    saveToFirebase();
    toastOk('Заказ обновлён');
}

function addEditOrderExpense() {
    const desc = document.getElementById('editExpDesc_' + editOrderIdx).value.trim();
    const amount = parseFloat(document.getElementById('editExpAmount_' + editOrderIdx).value) || 0;
    if (!desc) { toastErr('Введите описание расхода'); return; }
    if (amount <= 0) { toastErr('Введите сумму больше нуля'); return; }
    editOrderExpenses.push({ desc, amount });
    renderOrders();
}

function removeEditOrderExpense(idx) { editOrderExpenses.splice(idx, 1); renderOrders(); }

function setOrderFilter(f) {
    orderFilter = f;
    document.querySelectorAll('[data-status]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === f);
    });
    renderOrders();
}

function parseDate(s) { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }

function getDeadlineInfo(deadline, status) {
    if (status === 'done') return { text: 'выполнен', cls: 'status-done' };
    if (status === 'refused') return { text: 'отказ', cls: 'status-refused' };
    if (!deadline) return { text: 'без срока', cls: '' };
    const today = new Date(); today.setHours(0,0,0,0);
    const dl = parseDate(deadline);
    if (!dl) return { text: 'без срока', cls: '' };
    const diff = Math.round((dl - today) / 86400000);
    const f = dl.toLocaleDateString('ru-RU');
    if (diff < 0) return { text: 'просрочен на ' + Math.abs(diff) + ' дн. (' + f + ')', cls: 'overdue' };
    if (diff === 0) return { text: 'сегодня (' + f + ')', cls: 'today' };
    if (diff <= 3) return { text: 'через ' + diff + ' дн. (' + f + ')', cls: 'today' };
    return { text: f + ' (через ' + diff + ' дн.)', cls: 'ok' };
}

function formatAccepted(dateStr) {
    if (!dateStr) return '—';
    const d = parseDate(dateStr);
    if (!d) return dateStr;
    return d.toLocaleDateString('ru-RU');
}

function formatElapsed(dateStr) {
    if (!dateStr) return '';
    const d = parseDate(dateStr);
    if (!d) return '';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return '';
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (days >= 2) return '(' + days + ' дн. назад)';
    if (days === 1) return '(1 день назад)';
    if (hours >= 1) return '(' + hours + ' ч. назад)';
    if (mins >= 1) return '(' + mins + ' мин. назад)';
    return '(только что)';
}

function getCarDisplay(o) {
    if (o.carId) {
        for (const c of clients) {
            for (const car of (c.cars || [])) {
                if (car.id === o.carId) {
                    return { model: car.model, plate: car.plate, vin: car.vin || '', paintCode: car.paintCode || '' };
                }
            }
        }
    }
    return { model: o.carModel, plate: o.carPlate, vin: '', paintCode: '' };
}

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
        const car = getCarDisplay(o);

        if (editOrderIdx === i) {
            const expensesTotal = editOrderExpenses.reduce((s, e) => s + e.amount, 0);
            let expensesHtml = '';
            editOrderExpenses.forEach((e, idx) => {
                expensesHtml += '<div class="temp-item"><span>' + escapeHtml(e.desc) + ' — ' + e.amount.toFixed(0) + ' ₽</span><button onclick="removeEditOrderExpense(' + idx + ')">✕</button></div>';
            });
            if (editOrderExpenses.length === 0) expensesHtml = '<div class="empty" style="padding:6px 0; font-size:12px;">Расходов нет</div>';

            const typeOptions = WORK_TYPES.map(t => `<option value="${t}" ${o.workType === t ? 'selected' : ''}>${t}</option>`).join('');
            const statusOptions = Object.entries(STATUS_LABELS).map(([k, v]) =>
                `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v.label}</option>`
            ).join('');

            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header"><strong>✏️ Редактирование заказа</strong></div>
                <small style="color:#888; font-size:12px; display:block; margin-bottom:8px;">
                    👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(car.model)}${car.plate ? ' (' + escapeHtml(car.plate) + ')' : ''}
                </small>

                <label>Вид работ:</label>
                <select id="editWorkType_${i}">${typeOptions}</select>

                <label>Описание работ:</label>
                <input type="text" id="editWork_${i}" value="${escapeAttr(o.work)}" />

                <label>Статус:</label>
                <select id="editStatus_${i}">${statusOptions}</select>

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
                    <div style="font-size:12px; color:#888; text-align:right; padding:2px 8px 6px 0;">Итого: <b>${expensesTotal.toFixed(0)} ₽</b></div>
                    <input type="text" id="editExpDesc_${i}" placeholder="Новый расход" />
                    <input type="number" id="editExpAmount_${i}" placeholder="Сумма (руб.)" />
                    <button class="btn-secondary" onclick="addEditOrderExpense()">➕ Добавить расход</button>
                </div>

                <button class="btn-success" onclick="saveEditOrder()">✓ Сохранить</button>
                <button class="btn-secondary" onclick="cancelEditOrder()">Отмена</button>
            </div>`;
        }

        const expensesTotal = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const prepayment = o.prepayment || 0;
        const profit = prepayment - expensesTotal;
        const dl = getDeadlineInfo(o.deadline, o.status);
        const st = STATUS_LABELS[o.status] || STATUS_LABELS['in_progress'];
        const elapsed = formatElapsed(o.acceptedAt);

        let carExtras = '';
        if (car.vin) carExtras += ' · VIN: ' + escapeHtml(car.vin);
        if (car.paintCode) carExtras += ' · Краска: ' + escapeHtml(car.paintCode);

        let expensesBlock = '';
        if (o.expenses && o.expenses.length > 0) {
            let expLines = '';
            o.expenses.forEach(e => {
                expLines += '<div class="exp-item"><span>' + escapeHtml(e.desc) + '</span><span>' + e.amount.toFixed(0) + ' ₽</span></div>';
            });
            expensesBlock = '<div class="order-expenses"><div style="font-size:11px; color:#888; margin-bottom:4px;">Расходы:</div>' + expLines +
                '<div class="exp-item" style="border-top:1px solid rgba(0,0,0,0.08); margin-top:4px; padding-top:4px; font-weight:600;">' +
                '<span>Итого расходов:</span><span>' + expensesTotal.toFixed(0) + ' ₽</span></div></div>';
        }

        return `
        <div class="card">
            <div class="card-header">
                <div>
                    <strong>${escapeHtml(o.workType || 'Вид работ не указан')}</strong>
                    <small>${escapeHtml(o.work)}</small>
                    <small>👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(car.model)}${car.plate ? ' (' + escapeHtml(car.plate) + ')' : ''}${carExtras}</small>
                </div>
                <div class="card-actions">
                    <button class="btn-icon edit" onclick="startEditOrder(${i})">✏️</button>
                    <button class="btn-icon delete" onclick="deleteOrder(${i})">✕</button>
                </div>
            </div>

            <div class="order-row">
                <span class="label">Статус:</span>
                <span><span class="badge ${st.cls}">${st.label}</span></span>
            </div>
            <div class="order-row">
                <span class="label">Принят в работу:</span>
                <span>${formatAccepted(o.acceptedAt)} <span class="order-elapsed">${elapsed}</span></span>
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
                <span>${prepayment.toFixed(0)} ₽</span>
            </div>
            <div class="order-row">
                <span class="label">К доплате:</span>
                <span>${((o.cost || 0) - prepayment).toFixed(0)} ₽</span>
            </div>

            ${expensesBlock}
            ${o.comment ? `<div class="order-comment">💬 ${escapeHtml(o.comment)}</div>` : ''}

            <div class="order-total">
                Прибыль: <span class="${profit >= 0 ? 'profit' : 'loss'}">${profit.toFixed(0)} ₽</span>
                <span style="font-size:11px; color:#888; font-weight:400;"> (предоплата − расходы)</span>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
//  РАСХОДЫ БИЗНЕСА
// ============================================================

function onBizExpCategoryChange() {
    const sel = document.getElementById('bizExpCategory');
    if (!sel) return;
    const cat = sel.value;
    const info = BIZ_CATEGORIES[cat];
    if (!info) return;
    const amountEl = document.getElementById('bizExpAmount');
    const dateEl = document.getElementById('bizExpDate');
    if (!amountEl || !dateEl) return;

    if (info.fixedAmount) {
        amountEl.value = info.fixedAmount;
    } else {
        amountEl.value = '';
    }

    if (info.dayOfMonth) {
        const today = new Date();
        const day = today.getDate();
        let year = today.getFullYear();
        let month = today.getMonth();
        if (day > info.dayOfMonth) {
            month++;
            if (month > 11) { month = 0; year++; }
        }
        const dd = String(info.dayOfMonth).padStart(2, '0');
        const mm = String(month + 1).padStart(2, '0');
        dateEl.value = year + '-' + mm + '-' + dd;
    } else {
        dateEl.value = '';
    }
}

function addBizExpense() {
    try {
        const category = document.getElementById('bizExpCategory').value;
        const amountStr = document.getElementById('bizExpAmount').value;
        const date = document.getElementById('bizExpDate').value;
        const comment = document.getElementById('bizExpComment').value.trim();
        const amount = parseFloat(amountStr) || 0;

        console.log('addBizExpense:', { category, amount, date, comment });

        if (!amount || amount <= 0) { toastErr('Введите сумму больше нуля'); return; }
        if (!date) { toastErr('Выберите дату платежа'); return; }

        businessExpenses.push({
            id: genId('bexp'),
            category, amount, date, comment,
            paid: false,
            createdAt: new Date().toISOString()
        });

        document.getElementById('bizExpAmount').value = '';
        document.getElementById('bizExpComment').value = '';
        onBizExpCategoryChange();
        renderAll();
        saveToFirebase();
        toastOk('Расход добавлен: ' + amount.toFixed(0) + ' ₽');
    } catch (e) {
        console.error('Ошибка addBizExpense:', e);
        toastErr('Ошибка: ' + e.message);
    }
}

function deleteBizExpense(id) {
    if (!confirm('Удалить расход?')) return;
    businessExpenses = businessExpenses.filter(e => e.id !== id);
    renderAll();
    saveToFirebase();
    toastOk('Удалено');
}

function toggleBizExpensePaid(id) {
    const e = businessExpenses.find(x => x.id === id);
    if (!e) return;
    e.paid = !e.paid;
    renderAll();
    saveToFirebase();
    toastOk(e.paid ? 'Отмечено как оплачено' : 'Возвращено в план');
}

function startEditBizExpense(id) {
    editBizExpIdx = id;
    renderBizExpenses();
}

function cancelEditBizExpense() {
    editBizExpIdx = null;
    renderBizExpenses();
}

function saveEditBizExpense() {
    const e = businessExpenses.find(x => x.id === editBizExpIdx);
    if (!e) { editBizExpIdx = null; renderBizExpenses(); return; }
    const category = document.getElementById('editBizCat').value;
    const amount = parseFloat(document.getElementById('editBizAmount').value) || 0;
    const date = document.getElementById('editBizDate').value;
    const comment = document.getElementById('editBizComment').value.trim();
    if (!amount || amount <= 0) { toastErr('Введите сумму больше нуля'); return; }
    if (!date) { toastErr('Выберите дату'); return; }
    e.category = category;
    e.amount = amount;
    e.date = date;
    e.comment = comment;
    editBizExpIdx = null;
    renderAll();
    saveToFirebase();
    toastOk('Сохранено');
}

function setBizExpFilter(f) {
    bizExpFilter = f;
    document.querySelectorAll('[data-expfilter]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.expfilter === f);
    });
    renderBizExpenses();
}

function isBizExpOverdue(e) {
    if (e.paid) return false;
    const d = parseDate(e.date);
    if (!d) return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return d < today;
}

function renderBizExpenses() {
    const container = document.getElementById('bizExpList');
    if (!container) return;

    let list = businessExpenses.slice();
    if (bizExpFilter === 'planned') list = list.filter(e => !e.paid);
    if (bizExpFilter === 'paid') list = list.filter(e => e.paid);

    list.sort((a, b) => {
        if (a.paid !== b.paid) return a.paid ? 1 : -1;
        return (b.date || '').localeCompare(a.date || '');
    });

    if (list.length === 0) {
        container.innerHTML = '<div class="empty">Нет расходов' + (bizExpFilter !== 'all' ? ' в этой категории' : '') + '</div>';
        return;
    }

    container.innerHTML = list.map(e => {
        const info = BIZ_CATEGORIES[e.category] || { icon: '📦', cls: 'cat-other' };
        const isOverdue = isBizExpOverdue(e);

        if (editBizExpIdx === e.id) {
            const catOptions = Object.keys(BIZ_CATEGORIES).map(k =>
                `<option value="${k}" ${e.category === k ? 'selected' : ''}>${BIZ_CATEGORIES[k].icon} ${k}</option>`
            ).join('');
            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header"><strong>✏️ Редактирование расхода</strong></div>
                <label>Категория:</label>
                <select id="editBizCat">${catOptions}</select>
                <label>Сумма (руб.):</label>
                <input type="number" id="editBizAmount" value="${e.amount}" />
                <label>Дата платежа:</label>
                <input type="date" id="editBizDate" value="${e.date}" />
                <label>Комментарий:</label>
                <input type="text" id="editBizComment" value="${escapeAttr(e.comment || '')}" />
                <button class="btn-success" onclick="saveEditBizExpense()">✓ Сохранить</button>
                <button class="btn-secondary" onclick="cancelEditBizExpense()">Отмена</button>
            </div>`;
        }

        const dateFmt = parseDate(e.date) ? parseDate(e.date).toLocaleDateString('ru-RU') : e.date;
        const paidBadge = e.paid
            ? '<span class="badge badge-paid">✅ Оплачено</span>'
            : (isOverdue ? '<span class="badge badge-overdue-exp">⚠️ Просрочено</span>' : '<span class="badge badge-planned">📋 Планируется</span>');

        return `
        <div class="card" style="${e.paid ? 'opacity:0.75;' : ''}">
            <div class="card-header">
                <div>
                    <strong>${info.icon} ${escapeHtml(e.category)}</strong>
                    <small>${dateFmt}</small>
                </div>
                <div class="card-actions">
                    <button class="btn-icon ${e.paid ? 'unpaid' : 'paid'}" onclick="toggleBizExpensePaid('${e.id}')"
                        title="${e.paid ? 'Вернуть в план' : 'Отметить оплачено'}">${e.paid ? '↩️' : '✅'}</button>
                    <button class="btn-icon edit" onclick="startEditBizExpense('${e.id}')">✏️</button>
                    <button class="btn-icon delete" onclick="deleteBizExpense('${e.id}')">✕</button>
                </div>
            </div>
            <div class="order-row">
                <span class="label">Сумма:</span>
                <span><b>${e.amount.toFixed(0)} ₽</b></span>
            </div>
            <div class="order-row">
                <span class="label">Статус:</span>
                <span>${paidBadge}</span>
            </div>
            ${e.comment ? `<div class="order-comment">💬 ${escapeHtml(e.comment)}</div>` : ''}
        </div>`;
    }).join('');
}

function renderBizExpTotals() {
    const el = document.getElementById('bizExpTotalsTotal');
    if (!el) return;

    let paidAll = 0, plannedAll = 0, overdueAll = 0;
    let paidMonth = 0, plannedMonth = 0;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    businessExpenses.forEach(e => {
        const amt = e.amount || 0;
        const d = parseDate(e.date);
        if (e.paid) {
            paidAll += amt;
            if (d && d >= monthStart && d <= monthEnd) paidMonth += amt;
        } else {
            plannedAll += amt;
            if (d && d >= monthStart && d <= monthEnd) plannedMonth += amt;
            if (isBizExpOverdue(e)) overdueAll += amt;
        }
    });

    function box(title, value, sub, cls) {
        return `<div class="total-box"><div class="total-title">${title}</div><div class="total-value ${cls || ''}">${value}</div>${sub ? `<div class="total-sub">${sub}</div>` : ''}</div>`;
    }

    el.innerHTML =
        box('Оплачено (всего)', paidAll.toFixed(0) + ' ₽', '', 'loss') +
        box('Планируется (всего)', plannedAll.toFixed(0) + ' ₽') +
        box('Просрочено', overdueAll.toFixed(0) + ' ₽', '', overdueAll > 0 ? 'loss' : '') +
        box('Оплачено (месяц)', paidMonth.toFixed(0) + ' ₽', '', 'loss') +
        box('План (месяц)', plannedMonth.toFixed(0) + ' ₽') +
        box('Всего записей', businessExpenses.length);
}

// ============================================================
//  ОБЩИЕ ИТОГИ
// ============================================================

function calcTotals() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    function empty() {
        return { count: 0, cost: 0, prepay: 0, expense: 0, profit: 0, bizPaid: 0, done: 0, in_progress: 0, callback: 0, inspection: 0, processing: 0, refused: 0 };
    }
    let total = empty(), month = empty();

    orders.forEach(o => {
        const exp = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const prepay = o.prepayment || 0;
        const cost = o.cost || 0;
        const profit = prepay - exp;
        const st = o.status || 'in_progress';

        total.count++;
        total.cost += cost;
        total.prepay += prepay;
        total.expense += exp;
        total.profit += profit;
        if (st === 'done') total.done++;
        else if (st === 'in_progress') total.in_progress++;
        else if (st === 'callback') total.callback++;
        else if (st === 'inspection') total.inspection++;
        else if (st === 'processing') total.processing++;
        else if (st === 'refused') total.refused++;

        let created = null;
        if (o.createdAt) created = new Date(o.createdAt);
        else if (o.date) {
            const p = o.date.split('.');
            if (p.length === 3) created = new Date(p[2], p[1] - 1, p[0]);
        }
        if (created && created >= monthStart) {
            month.count++;
            month.cost += cost;
            month.prepay += prepay;
            month.expense += exp;
            month.profit += profit;
            if (st === 'done') month.done++;
            else if (st === 'in_progress') month.in_progress++;
            else if (st === 'callback') month.callback++;
            else if (st === 'inspection') month.inspection++;
            else if (st === 'processing') month.processing++;
            else if (st === 'refused') month.refused++;
        }
    });

    businessExpenses.forEach(e => {
        if (!e.paid) return;
        const d = parseDate(e.date);
        if (!d) return;
        total.bizPaid += e.amount || 0;
        if (d >= monthStart) month.bizPaid += e.amount || 0;
    });

    return { total, month };
}

function renderTotals() {
    const t = calcTotals();
    const elTotal = document.getElementById('totalsTotal');
    const elMonth = document.getElementById('totalsMonth');
    if (!elTotal || !elMonth) return;

    function box(title, value, sub, cls) {
        return `<div class="total-box"><div class="total-title">${title}</div><div class="total-value ${cls || ''}">${value}</div>${sub ? `<div class="total-sub">${sub}</div>` : ''}</div>`;
    }

    function makeGrid(s) {
        const netProfit = s.profit - s.bizPaid;
        return box('Всего заказов', s.count) +
               box('Прибыль по заказам', s.profit.toFixed(0) + ' ₽', 'предоплата − расходы по заказам', s.profit >= 0 ? 'profit' : 'loss') +
               box('Расходы бизнеса', s.bizPaid.toFixed(0) + ' ₽', 'оплачено', s.bizPaid > 0 ? 'loss' : '') +
               box('Чистая прибыль', netProfit.toFixed(0) + ' ₽', 'прибыль − расходы бизнеса', netProfit >= 0 ? 'profit' : 'loss') +
               box('Готовых', s.done, '', 'profit') +
               box('В работе', s.in_progress) +
               box('Перезвонить', s.callback) +
               box('Осмотр', s.inspection) +
               box('Обработка', s.processing) +
               box('Отказ', s.refused) +
               box('Предоплаты', s.prepay.toFixed(0) + ' ₽') +
               box('Расходы по заказам', s.expense.toFixed(0) + ' ₽') +
               box('Сумма работ', s.cost.toFixed(0) + ' ₽');
    }

    elTotal.innerHTML = makeGrid(t.total);
    elMonth.innerHTML = makeGrid(t.month);
}

// ============================================================
//  ОЧИСТКА И ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = []; orders = []; businessExpenses = []; tempCars = []; tempExpenses = [];
    selectedClientIdx = null; selectedCarIdx = null;
    editClientIdx = null; editClientCars = [];
    editOrderIdx = null; editOrderExpenses = [];
    editBizExpIdx = null;
    renderAll();
    saveToFirebase();
    toastOk('Все данные удалены');
}

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
    return String(text).split(AMP).join(AMP + 'amp;').split(QUOT).join(AMP + 'quot;').split(LT).join(AMP + 'lt;').split(GT).join(AMP + 'gt;');
}

function renderAll() {
    renderClients();
    renderClientPicker();
    renderCarPicker();
    updateOrderFormVisibility();
    renderOrders();
    renderBizExpenses();
    renderBizExpTotals();
    renderTotals();
    updateVersionDisplay();
    renderTempCars();
    renderTempExpenses();
}

// Глобальный обработчик ошибок для отладки
window.addEventListener('error', function(ev) {
    console.error('Global error:', ev.message, 'at', ev.filename + ':' + ev.lineno);
});

init();
console.log('🔧 Автосервис Админ v10.1');
