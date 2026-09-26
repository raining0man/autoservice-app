// ============================================================
// Автосервис Админ v4.0 — Mini App для Telegram
// Полное редактирование клиентов (имя, телефон, авто) и заказов
// ============================================================

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ---------- Данные ----------
let clients = [];
let orders = [];
let dataVersion = 0;
let tempCars = [];
let tempExpenses = [];

// Состояния выбора для формы нового заказа
let selectedClientIdx = null;
let selectedCarIdx = null;

// Состояния редактирования
let editClientIdx = null;     // индекс редактируемого клиента
let editClientCars = [];      // временный список авто при редактировании
let editOrderIdx = null;      // индекс редактируемого заказа
let editOrderExpenses = [];   // временный список расходов при редактировании

// ============================================================
//  ХРАНИЛИЩЕ
// ============================================================
function loadFromLocal() {
    try {
        const saved = localStorage.getItem('autoservice_data');
        if (saved) {
            const parsed = JSON.parse(saved);
            clients = parsed.clients || [];
            orders = parsed.orders || [];
            dataVersion = parsed.version || 0;
            migrateOldFormat();
        }
    } catch (e) { console.error('Ошибка загрузки:', e); }
}

function migrateOldFormat() {
    clients = clients.map(c => {
        if (c.car !== undefined && !c.cars) {
            return { name: c.name, phone: c.phone, cars: c.car ? [{ model: c.car, plate: '' }] : [] };
        }
        return c;
    });
}

function saveToLocal() {
    const data = { clients, orders, version: dataVersion, updatedAt: new Date().toISOString() };
    localStorage.setItem('autoservice_data', JSON.stringify(data));
    updateVersionDisplay();
}

function updateVersionDisplay() {
    const el = document.getElementById('versionText');
    if (el) el.textContent = `v${dataVersion}`;
}

function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
}

// ============================================================
//  ВРЕМЕННЫЕ СПИСКИ (форма нового клиента / заказа)
// ============================================================
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
            <span>🚗 ${escapeHtml(c.model)}${c.plate ? ` (${escapeHtml(c.plate)})` : ''}</span>
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

// ============================================================
//  КЛИЕНТЫ — добавление
// ============================================================
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
    saveToLocal();
    renderAll();
    setStatus('Клиент добавлен');
}

// ============================================================
//  КЛИЕНТЫ — удаление
// ============================================================
function deleteClient(index) {
    if (!confirm('Удалить клиента?')) return;
    if (selectedClientIdx === index) { selectedClientIdx = null; selectedCarIdx = null; }
    else if (selectedClientIdx !== null && selectedClientIdx > index) selectedClientIdx--;
    if (editClientIdx === index) editClientIdx = null;
    else if (editClientIdx !== null && editClientIdx > index) editClientIdx--;
    clients.splice(index, 1);
    saveToLocal();
    renderAll();
}

// ============================================================
//  КЛИЕНТЫ — редактирование
// ============================================================
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

function saveEditClient() {
    const name = document.getElementById(`editName_${editClientIdx}`).value.trim();
    const phone = document.getElementById(`editPhone_${editClientIdx}`).value.trim();
    if (!name) { alert('Введите ФИО'); return; }
    if (editClientCars.length === 0) { alert('Добавьте хотя бы одно авто'); return; }

    // Сохраняем состояния пикеров
    const prevSelectedClient = selectedClientIdx;
    const prevSelectedCar = selectedCarIdx;

    clients[editClientIdx].name = name;
    clients[editClientIdx].phone = phone;
    clients[editClientIdx].cars = [...editClientCars];

    editClientIdx = null;
    editClientCars = [];

    // Сбрасываем выбор, если авто изменилось
    selectedClientIdx = null;
    selectedCarIdx = null;
    saveToLocal();
    renderAll();
    setStatus('Клиент обновлён');
}

function addEditCar() {
    const model = document.getElementById(`editCarModel_${editClientIdx}`).value.trim();
    const plate = document.getElementById(`editCarPlate_${editClientIdx}`).value.trim();
    if (!model) { alert('Введите марку и модель'); return; }
    editClientCars.push({ model, plate });
    renderClients();
}

function removeEditCar(idx) {
    editClientCars.splice(idx, 1);
    renderClients();
}

// ============================================================
//  РЕНДЕР КЛИЕНТОВ
// ============================================================
function renderClients() {
    const container = document.getElementById('clientsList');
    if (!container) return;
    if (clients.length === 0) {
        container.innerHTML = '<div class="empty">Нет клиентов</div>';
        return;
    }

    container.innerHTML = clients.map((c, i) => {
        // Режим редактирования
        if (editClientIdx === i) {
            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header">
                    <strong>✏️ Редактирование</strong>
                </div>
                <label>ФИО:</label>
                <input type="text" id="editName_${i}" value="${escapeAttr(c.name)}" />
                <label>Телефон:</label>
                <input type="tel" id="editPhone_${i}" value="${escapeAttr(c.phone || '')}" />

                <div class="sub-section">
                    <div class="sub-title">🚗 Автомобили</div>
                    ${editClientCars.map((car, idx) => `
                        <div class="car-line">
                            <span class="car-info">🚗 ${escapeHtml(car.model)}${car.plate ? ` · ${escapeHtml(car.plate)}` : ''}</span>
                            <button class="btn-icon delete" onclick="removeEditCar(${idx})">✕</button>
                        </div>
                    `).join('')}
                    <div style="margin-top:8px;">
                        <input type="text" id="editCarModel_${i}" placeholder="Марка, модель (новое авто)" />
                        <input type="text" id="editCarPlate_${i}" placeholder="Гос. номер (необязательно)" />
                        <button class="btn-secondary" onclick="addEditCar()">➕ Добавить авто</button>
                    </div>
                </div>

                <button class="btn-success" onclick="saveEditClient()">✓ Сохранить</button>
                <button class="btn-secondary" onclick="cancelEditClient()">Отмена</button>
            </div>
            `;
        }

        // Обычный режим
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
            <div>
                ${(c.cars || []).map(car =>
                    `<div class="car-line"><span class="car-info">🚗 ${escapeHtml(car.model)}${car.plate ? ` · ${escapeHtml(car.plate)}` : ''}</span></div>`
                ).join('')}
            </div>
        </div>
        `;
    }).join('');
}

// ============================================================
//  ПИКЕР КЛИЕНТОВ
// ============================================================
function renderClientPicker() {
    const el = document.getElementById('clientPicker');
    if (!el) return;
    if (clients.length === 0) {
        el.innerHTML = '<div class="empty">Сначала добавьте клиента</div>';
        selectedClientIdx = null;
        return;
    }
    el.innerHTML = clients.map((c, i) => `
        <button class="picker-btn ${selectedClientIdx === i ? 'active' : ''}"
                onclick="selectClient(${i})">
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

// ============================================================
//  ПИКЕР АВТО
// ============================================================
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
        <button class="picker-btn ${selectedCarIdx === i ? 'active' : ''}"
                onclick="selectCar(${i})">
            🚗 ${escapeHtml(car.model)}
            ${car.plate ? `<small>${escapeHtml(car.plate)}</small>` : ''}
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

// ============================================================
//  ЗАКАЗЫ — добавление
// ============================================================
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
        work, cost, deadline, prepayment,
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

    saveToLocal();
    renderAll();
    setStatus('Заказ добавлен');
}

// ============================================================
//  ЗАКАЗЫ — удаление
// ============================================================
function deleteOrder(index) {
    if (!confirm('Удалить заказ?')) return;
    if (editOrderIdx === index) editOrderIdx = null;
    else if (editOrderIdx !== null && editOrderIdx > index) editOrderIdx--;
    orders.splice(index, 1);
    saveToLocal();
    renderAll();
}

// ============================================================
//  ЗАКАЗЫ — редактирование
// ============================================================
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
    const work = document.getElementById(`editWork_${editOrderIdx}`).value.trim();
    const cost = parseFloat(document.getElementById(`editCost_${editOrderIdx}`).value) || 0;
    const deadline = document.getElementById(`editDeadline_${editOrderIdx}`).value;
    const prepayment = parseFloat(document.getElementById(`editPrepayment_${editOrderIdx}`).value) || 0;

    if (!work) { alert('Введите описание работ'); return; }

    o.work = work;
    o.cost = cost;
    o.deadline = deadline;
    o.prepayment = prepayment;
    o.expenses = [...editOrderExpenses];

    editOrderIdx = null;
    editOrderExpenses = [];
    saveToLocal();
    renderAll();
    setStatus('Заказ обновлён');
}

function addEditOrderExpense() {
    const desc = document.getElementById(`editExpDesc_${editOrderIdx}`).value.trim();
    const amount = parseFloat(document.getElementById(`editExpAmount_${editOrderIdx}`).value) || 0;
    if (!desc) { alert('Введите описание расхода'); return; }
    if (amount <= 0) { alert('Введите сумму больше нуля'); return; }
    editOrderExpenses.push({ desc, amount });
    renderOrders();
}

function removeEditOrderExpense(idx) {
    editOrderExpenses.splice(idx, 1);
    renderOrders();
}

// ============================================================
//  ДЕДЛАЙН
// ============================================================
function getDeadlineInfo(deadline) {
    if (!deadline) return { text: 'без срока', cls: '' };
    const today = new Date(); today.setHours(0,0,0,0);
    const dl = new Date(deadline + 'T00:00:00');
    const diff = Math.round((dl - today) / (1000 * 60 * 60 * 24));
    const formatted = dl.toLocaleDateString('ru-RU');
    if (diff < 0)  return { text: `просрочен (${formatted})`, cls: 'overdue' };
    if (diff === 0) return { text: `сегодня (${formatted})`,  cls: 'today' };
    if (diff <= 3)  return { text: `через ${diff} дн. (${formatted})`, cls: 'today' };
    return { text: formatted, cls: 'ok' };
}

// ============================================================
//  РЕНДЕР ЗАКАЗОВ
// ============================================================
function renderOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty">Нет заказов</div>';
        return;
    }

    container.innerHTML = orders.map((o, i) => {
        // Режим редактирования
        if (editOrderIdx === i) {
            const expensesTotal = editOrderExpenses.reduce((s, e) => s + e.amount, 0);
            return `
            <div class="card" style="border-color:#ffc107;">
                <div class="card-header">
                    <strong>✏️ Редактирование заказа</strong>
                </div>
                <small style="color:#888; font-size:12px; display:block; margin-bottom:8px;">
                    👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ` (${escapeHtml(o.carPlate)})` : ''}
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
                    ${editOrderExpenses.map((e, idx) => `
                        <div class="temp-item">
                            <span>${escapeHtml(e.desc)} — ${e.amount.toFixed(0)} ₽</span>
                            <button onclick="removeEditOrderExpense(${idx})">✕</button>
                        </div>
                    `).join('')}
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

        // Обычный режим
        const expensesTotal = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const profit = (o.cost || 0) - expensesTotal;
        const dl = getDeadlineInfo(o.deadline);

        return `
        <div class="card">
            <div class="card-header">
                <div>
                    <strong>${escapeHtml(o.work)}</strong>
                    <small>👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ` (${escapeHtml(o.carPlate)})` : ''}</small>
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

            ${(o.expenses && o.expenses.length > 0) ? `
                <div class="order-expenses">
                    <div style="font-size:11px; color:#888; margin-bottom:4px;">Расходы:</div>
                    ${o.expenses.map(e => `
                        <div class="exp-item">
                            <span>${escapeHtml(e.desc)}</span>
                            <span>${e.amount.toFixed(0)} ₽</span>
                        </div>
                    `).join('')}
                    <div class="exp-item" style="border-top:1px solid rgba(0,0,0,0.08); margin-top:4px; padding-top:4px; font-weight:600;">
                        <span>Итого расходов:</span>
                        <span>${expensesTotal.toFixed(0)} ₽</span>
                    </div>
                </div>
            ` : ''}

            <div class="order-total">
                Прибыль: <span class="${profit >= 0 ? 'profit' : 'loss'}">${profit.toFixed(0)} ₽</span>
            </div>
        </div>
        `;
    }).join('');
}

// ============================================================
//  ОЧИСТКА
// ============================================================
function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = []; orders = []; tempCars = []; tempExpenses = [];
    selectedClientIdx = null; selectedCarIdx = null;
    editClientIdx = null; editClientCars = [];
    editOrderIdx = null; editOrderExpenses = [];
    dataVersion = 0;
    saveToLocal();
    renderAll();
    setStatus('Все данные удалены');
}

// ============================================================
//  СИНХРОНИЗАЦИЯ
// ============================================================
function saveToTelegram() {
    if (!tg) { alert('Откройте приложение через Telegram'); return; }
    dataVersion += 1;
    const data = { clients, orders, version: dataVersion, updatedAt: new Date().toISOString(), device: tg.platform || 'unknown' };
    const jsonStr = JSON.stringify(data, null, 2);
    try {
        tg.sendData(JSON.stringify({ action: 'save', version: dataVersion, content: jsonStr }));
        setStatus(`Сохранено (v${dataVersion})`);
        saveToLocal();
    } catch (e) {
        console.error('Ошибка отправки:', e);
        alert('Не удалось сохранить. Попробуйте ещё раз.');
    }
}

function loadFromTelegram() {
    if (!tg) { alert('Откройте приложение через Telegram'); return; }
    try {
        tg.sendData(JSON.stringify({ action: 'load' }));
        setStatus('Запрос отправлен...');
    } catch (e) { console.error(e); alert('Не удалось запросить данные.'); }
}

if (tg) {
    tg.onEvent('webAppData', (data) => {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed.clients) {
                clients = parsed.clients || [];
                orders = parsed.orders || [];
                dataVersion = parsed.version || 0;
                migrateOldFormat();
                saveToLocal();
                renderAll();
                setStatus(`Загружено (v${dataVersion})`);
            }
        } catch (e) {
            console.error('Ошибка обработки данных от бота:', e);
            setStatus('Ошибка загрузки');
        }
    });
}

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ
// ============================================================
function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Для value="" в input — экранируем кавычки
function escapeAttr(text) {
    if (text === undefined || text === null) return '';
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ---------- Старт ----------
loadFromLocal();
renderAll();
setStatus('Готово');
console.log('🔧 Автосервис Админ v4.0 запущен');
