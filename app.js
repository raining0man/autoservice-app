// ============================================================
// Автосервис Админ v2.0 — Mini App для Telegram
// Новое: несколько авто на клиента, сроки, предоплата, расходы
// ============================================================

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ---------- Данные ----------
let clients = [];
let orders = [];
let dataVersion = 0;
let tempCars = [];      // временный список авто при создании клиента
let tempExpenses = [];  // временный список расходов при создании заказа

// ---------- Загрузка/Сохранение ----------
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

// Миграция со старого формата (одна машина как строка) на новый (массив cars)
function migrateOldFormat() {
    clients = clients.map(c => {
        if (c.car !== undefined && !c.cars) {
            return {
                name: c.name,
                phone: c.phone,
                cars: c.car ? [{ model: c.car, plate: '' }] : []
            };
        }
        return c;
    });
}

function saveToLocal() {
    const data = {
        clients,
        orders,
        version: dataVersion,
        updatedAt: new Date().toISOString()
    };
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

// ---------- Временные списки: АВТО ----------
function addCarToList() {
    const model = document.getElementById('carModel').value.trim();
    const plate = document.getElementById('carPlate').value.trim();
    if (!model) { alert('Введите марку и модель авто'); return; }
    tempCars.push({ model, plate });
    document.getElementById('carModel').value = '';
    document.getElementById('carPlate').value = '';
    renderTempCars();
}

function removeCarFromList(i) {
    tempCars.splice(i, 1);
    renderTempCars();
}

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

// ---------- Временные списки: РАСХОДЫ ----------
function addExpenseToList() {
    const desc = document.getElementById('expenseDesc').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;
    if (!desc) { alert('Введите описание расхода'); return; }
    if (amount <= 0) { alert('Введите сумму расхода больше нуля'); return; }
    tempExpenses.push({ desc, amount });
    document.getElementById('expenseDesc').value = '';
    document.getElementById('expenseAmount').value = '';
    renderTempExpenses();
}

function removeExpenseFromList(i) {
    tempExpenses.splice(i, 1);
    renderTempExpenses();
}

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
            Итого расходов: <b>${total.toFixed(0)} ₽</b>
        </div>
    `;
}

// ---------- Клиенты ----------
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

function deleteClient(index) {
    if (!confirm('Удалить клиента?')) return;
    clients.splice(index, 1);
    saveToLocal();
    renderAll();
}

function renderClients() {
    const container = document.getElementById('clientsList');
    if (!container) return;

    if (clients.length === 0) {
        container.innerHTML = '<div class="empty">Нет клиентов</div>';
        return;
    }

    container.innerHTML = clients.map((c, i) => `
        <div class="client-card">
            <div class="client-header">
                <div>
                    <strong>${escapeHtml(c.name)}</strong>
                    <small>${escapeHtml(c.phone || 'без телефона')}</small>
                </div>
                <button class="delete-btn" onclick="deleteClient(${i})">✕</button>
            </div>
            <div class="client-cars">
                ${(c.cars || []).map(car =>
                    `<div>🚗 ${escapeHtml(car.model)}${car.plate ? ` · ${escapeHtml(car.plate)}` : ''}</div>`
                ).join('')}
            </div>
        </div>
    `).join('');
}

// ---------- Обновление выпадающего списка клиентов ----------
function updateClientSelect() {
    const select = document.getElementById('orderClient');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Выберите клиента --</option>' +
        clients.map((c, i) => `<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
    select.value = currentVal;
    updateCarSelect();
}

// ---------- Обновление выпадающего списка авто (зависит от клиента) ----------
function updateCarSelect() {
    const clientIdx = document.getElementById('orderClient').value;
    const carSelect = document.getElementById('orderCar');
    if (!carSelect) return;

    if (clientIdx === '') {
        carSelect.innerHTML = '<option value="">-- Сначала выберите клиента --</option>';
        return;
    }

    const client = clients[parseInt(clientIdx)];
    const cars = client.cars || [];
    if (cars.length === 0) {
        carSelect.innerHTML = '<option value="">-- У клиента нет авто --</option>';
        return;
    }
    carSelect.innerHTML = '<option value="">-- Выберите авто --</option>' +
        cars.map((c, i) =>
            `<option value="${i}">${escapeHtml(c.model)}${c.plate ? ` (${escapeHtml(c.plate)})` : ''}</option>`
        ).join('');
}

// ---------- Заказы ----------
function addOrder() {
    const clientIdx = document.getElementById('orderClient').value;
    const carIdx = document.getElementById('orderCar').value;
    const work = document.getElementById('orderWork').value.trim();
    const cost = parseFloat(document.getElementById('orderCost').value) || 0;
    const deadline = document.getElementById('orderDeadline').value;
    const prepayment = parseFloat(document.getElementById('orderPrepayment').value) || 0;

    if (clientIdx === '') { alert('Выберите клиента'); return; }
    if (carIdx === '') { alert('Выберите автомобиль'); return; }
    if (!work) { alert('Введите описание работ'); return; }

    const client = clients[parseInt(clientIdx)];
    const car = client.cars[parseInt(carIdx)];

    orders.push({
        clientName: client.name,
        clientPhone: client.phone,
        carModel: car.model,
        carPlate: car.plate,
        work,
        cost,
        deadline,
        prepayment,
        expenses: [...tempExpenses],
        date: new Date().toLocaleDateString('ru-RU')
    });

    tempExpenses = [];
    document.getElementById('orderWork').value = '';
    document.getElementById('orderCost').value = '';
    document.getElementById('orderDeadline').value = '';
    document.getElementById('orderPrepayment').value = '';
    renderTempExpenses();

    saveToLocal();
    renderAll();
    setStatus('Заказ добавлен');
}

function deleteOrder(index) {
    if (!confirm('Удалить заказ?')) return;
    orders.splice(index, 1);
    saveToLocal();
    renderAll();
}

// ---------- Дедлайн: статус ----------
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

function renderOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;

    if (orders.length === 0) {
        container.innerHTML = '<div class="empty">Нет заказов</div>';
        return;
    }

    // Сортируем: сначала новые по дате добавления
    const indexed = orders.map((o, i) => ({ ...o, _idx: i }));

    container.innerHTML = indexed.map(o => {
        const expensesTotal = (o.expenses || []).reduce((s, e) => s + e.amount, 0);
        const profit = (o.cost || 0) - expensesTotal;
        const dl = getDeadlineInfo(o.deadline);

        return `
        <div class="order-card">
            <div class="order-header">
                <div>
                    <strong>${escapeHtml(o.work)}</strong>
                    <small>👤 ${escapeHtml(o.clientName)} · 🚗 ${escapeHtml(o.carModel)}${o.carPlate ? ` (${escapeHtml(o.carPlate)})` : ''}</small>
                </div>
                <button class="delete-btn" onclick="deleteOrder(${o._idx})">✕</button>
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

// ---------- Очистка ----------
function clearAll() {
    if (!confirm('Удалить ВСЕ данные? Это действие необратимо!')) return;
    clients = []; orders = []; tempCars = []; tempExpenses = [];
    dataVersion = 0;
    saveToLocal();
    renderAll();
    setStatus('Все данные удалены');
}

// ============================================================
//  СИНХРОНИЗАЦИЯ ЧЕРЕЗ TELEGRAM
// ============================================================

function saveToTelegram() {
    if (!tg) { alert('Откройте приложение через Telegram'); return; }
    dataVersion += 1;
    const data = {
        clients, orders,
        version: dataVersion,
        updatedAt: new Date().toISOString(),
        device: tg.platform || 'unknown'
    };
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

function renderAll() {
    renderClients();
    renderOrders();
    updateClientSelect();
    updateVersionDisplay();
    renderTempCars();
    renderTempExpenses();
}

// ---------- Старт ----------
loadFromLocal();
renderAll();
setStatus('Готово');
console.log('🔧 Автосервис Админ v2.0 запущен');
