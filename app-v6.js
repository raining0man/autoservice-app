// ============================================================
// Автосервис Админ v6.0 — Firebase Sync
// Данные хранятся в облаке Firestore, синхронизация мгновенная
// ============================================================

// ---------- КОНФИГ FIREBASE ----------
const firebaseConfig = {
  apiKey: "AIzaSyABM5s_1e0172SV8ICquhoyqZ1s0J8RZ2w",
  authDomain: "menu-auto-e79d2.firebaseapp.com",
  projectId: "menu-auto-e79d2",
  storageBucket: "menu-auto-e79d2.firebasestorage.app",
  messagingSenderId: "398535584228",
  appId: "1:398535584228:web:157d7915f0c388999983f1",
  measurementId: "G-LYWD048M4P"
};

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Включаем кэш Firestore (работает офлайн)
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn('Кэш Firestore не активирован:', err.code);
});

// Telegram Mini App
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

// Флаг: не перезаписывать Firestore, пока идёт первичная загрузка
let isReady = false;
let isSaving = false;

// ---------- Статус ----------
function setStatus(text, state) {
    const el = document.getElementById('statusText');
    const dot = document.getElementById('syncDot');
    if (el) el.textContent = text;
    if (dot) {
        dot.className = 'sync-dot';
        if (state) dot.classList.add(state); // 'ok' или 'error'
    }
}

function updateVersionDisplay() {
    const el = document.getElementById('versionText');
    if (el) el.textContent = 'v' + dataVersion;
}

// ---------- СОХРАНЕНИЕ В FIRESTORE ----------
async function saveToFirebase() {
    if (!isReady) return;
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
        setStatus('Ошибка синхронизации', 'error');
    }
    isSaving = false;
}

// ---------- ЗАГРУЗКА ИЗ FIRESTORE (реальное время) ----------
function subscribeToFirebase() {
    db.collection('data').doc('main').onSnapshot((doc) => {
        // Если сами сейчас сохраняем — не перезаписываем UI своими же данными
        if (isSaving) return;

        if (doc.exists) {
            const data = doc.data();
            // Проверяем, что данные действительно изменились
            const newVersion = data.version || 0;
            if (newVersion !== dataVersion) {
                clients = data.clients || [];
                orders = data.orders || [];
                dataVersion = newVersion;
                migrateOldFormat();
                renderAll();
                updateVersionDisplay();
                setStatus('Обновлено из облака', 'ok');
            } else {
                setStatus('Синхронизировано', 'ok');
            }
        } else {
            // Документ ещё не создан — ждём первого сохранения
            setStatus('Готово. Создайте первого клиента', 'ok');
        }
        isReady = true;
    }, (error) => {
        console.error('Ошибка подписки:', error);
        setStatus('Нет связи с облаком', 'error');
    });
}

// ---------- АВТОРИЗАЦИЯ И СТАРТ ----------
async function init() {
    try {
        await auth.signInAnonymously();
        console.log('✅ Анонимная авторизация Firebase OK');
        subscribeToFirebase();
    } catch (e) {
        console.error('Ошибка авторизации:', e);
        setStatus('Ошибка авторизации', 'error');
    }
}

// ---------- ВРЕМЕННЫЕ СПИСКИ ----------
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

// ---------- КЛИЕНТЫ ----------
function addClient() {
    const name = document.getElementById('clientName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    if (!name) { alert('Введите ФИО клиента'); return; }
    if (tempCars.length === 0) { alert('Добавьте хотя бы один автомобиль'); return; }

    clients.push({ name, phone, cars: [...tempCars] });
    tempCars = [];

    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
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
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
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

// ---------- РЕНДЕР КЛИЕНТОВ ----------
function renderClients() {
    const container = document.getElementById('clientsList');
    if (!container) return;
    if (clients.length === 0) {
        container.innerHTML = '<div class="empty">Нет клиентов</div>';
        return;
    }

    container.innerHTML = clients.map((c, i) => {
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
        </div>
        `;
    }).join('');
}

// ---------- ПИКЕР КЛИЕНТОВ ----------
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

// ---------- ПИКЕР АВТО ----------
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
    form.style.display = (selectedClientIdx !== null && selectedCarIdx !== null) ? 'block' : 'none';
}

// ---------- ЗАКАЗЫ ----------
function addOrder() {
    if (selectedClientIdx === null) { alert('Выберите клиента'); return; }
    if (selectedCarIdx === null) { alert('Выберите автомобиль'); return; }

    const work = document.getElementById('orderWork').value.trim();
    const cost = parseFloat(document.getElementById('orderCost').value) || 0;
    const deadline = document.getElementById('orderDeadline').value;
    const prepayment = parseFloat(document.getElementById('orderPrepayment').value) || 0;

    if (!work) { alert('Введите описание работ'); return; }

    const client = clients[selectedClientIdx];
    const car = client.cars[selectedCarIdx];

    orders.push({
        clientName: client.name,
        clientPhone: client.phone,
        carModel: car.model,
        carPlate: car.plate,
        work: work,
        cost: cost,
        deadline: deadline,
        prepayment: prepayment,
        expenses: [...tempExpenses],
        date: new Date().toLocaleDateString('ru-RU')
    });

    tempExpenses = [];
    document.getElementById('orderWork').value = '';
    document.getElementById('orderCost').value = '';
    document.getElementById('orderDeadline').value = '';
    document.getElementById('orderPrepayment').value = '';
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
    const workEl = document.getElementById('editWork_' + editOrderIdx);
    const costEl = document.getElementById('editCost_' + editOrderIdx);
    const deadlineEl = document.getElementById('editDeadline_' + editOrderIdx);
    const prepaymentEl = document.getElementById('editPrepayment_' + editOrderIdx);

    const work = workEl.value.trim();
    const cost = parseFloat(costEl.value) || 0;
    const deadline = deadlineEl.value;
    const prepayment = parseFloat(prepaymentEl.value) || 0;

    if (!work) { alert('Введите описание работ'); return; }

    o.work = work;
    o.cost = cost;
    o.deadline = deadline;
    o.prepayment = prepayment;
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

// ---------- ДЕДЛАЙН ----------
function getDeadlineInfo(deadline) {
    if (!deadline) return { text: 'без срока', cls: '' };
    const today = new Date(); today.setHours(0,0,0,0);
    const dl = new Date(deadline + 'T00:00:00');
    const diff = Math.round((dl - today) / (1000 * 60 * 60 * 24));
    const formatted = dl.toLocaleDateString('ru-RU');
    if (diff < 0)  return { text: 'просрочен (' + formatted + ')', cls: 'overdue' };
    if (diff === 0) return { text: 'сегодня (' + formatted + ')',  cls: 'today' };
    if (diff <= 3)  return { text: 'через ' + diff + ' дн. (' + formatted + ')', cls: 'today' };
    return { text: formatted, cls: 'ok' };
}

// ---------- РЕНДЕР ЗАКАЗОВ ----------
function renderOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty">Нет заказов</div>';
        return;
    }

    container.innerHTML = orders.map((o, i) => {
        if (editOrderIdx === i) {
            const expensesTotal = editOrderExpenses.reduce((s, e) => s + e.amount, 0);
            let expensesHtml = '';
            editOrderExpenses.forEach((e, idx) => {
                expensesHtml += '<div class="temp-item"><span>' + escapeHtml(e.desc) + ' — ' + e.amount.toFixed(0) + ' ₽</span><button onclick="removeEditOrderExpense(' + idx + ')">✕</button></div>';
            });
            if (editOrderExpenses.length === 0) {
                expensesHtml = '<div class="empty" style="padding:6px 0; font-size:12px;">Расходов нет</div>';
            }

            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header">
                    <strong>✏️ Редактирование заказа</strong>
                </div>
                <small style="color:#888; font-size:12px; display:block; margin-bottom:8px;">
                    👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ' (' + escapeHtml(o.carPlate) + ')' : ''}
                </small>

                <label>Описание работ:</label>
                <input type="text" id="editWork_${i}" value="${escapeAttr(o.work)}" />

                <label>Стоимость работ (руб.):</label>
                <input type="number" id="editCost_${i}" value="${o.cost || 0}" />

                <label>Срок выполнения:</label>
                <input type="date" id="editDeadline_${i}" value="${o.deadline || ''}" />

                <label>Предоплата (руб.):</label>
                <input type="number" id="editPrepayment_${i}" value="${o.prepayment || 0}" />

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
        const dl = getDeadlineInfo(o.deadline);

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

            <div class="order-total">
                Прибыль: <span class="${profit >= 0 ? 'profit' : 'loss'}">${profit.toFixed(0)} ₽</span>
            </div>
        </div>
        `;
    }).join('');
}

// ---------- ОЧИСТКА ----------
function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = []; orders = []; tempCars = []; tempExpenses = [];
    selectedClientIdx = null; selectedCarIdx = null;
    editClientIdx = null; editClientCars = [];
    editOrderIdx = null; editOrderExpenses = [];
    renderAll();
    saveToFirebase();
}

// ---------- ВСПОМОГАТЕЛЬНЫЕ ----------
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
    updateVersionDisplay();
    renderTempCars();
    renderTempExpenses();
}

// ---------- СТАРТ ----------
init();
console.log('🔧 Автосервис Админ v6.0 — Firebase Sync');
