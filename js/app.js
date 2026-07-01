// js/app.js

// ============================================================
// APP INITIALIZATION
// ============================================================

// Override the existing getMedicines/saveMedicines to use offline-first
// The functions in storage.js now handle this automatically.

// Render reminder list (using local data)
async function renderReminderList() {
    const container = document.getElementById('reminderList');
    
    // Get data from IndexedDB (instantly!)
    const medicines = await getLocalMedicines();
    
    if (medicines.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p style="font-size: 48px; margin-bottom: 12px;">💊</p>
                <p style="font-size: 16px; color: #8892a8;">No reminders added yet.</p>
                <p style="font-size: 14px; color: #2a3140;">Add your first medicine above!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = medicines.map(med => {
        const timesDisplay = med.times.map(t => {
            const hour = parseInt(t.split(':')[0]);
            const min = t.split(':')[1];
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            return `${displayHour}:${min} ${ampm}`;
        }).join(', ');
        
        return `
            <div class="reminder-item">
                <div class="reminder-info">
                    <span class="reminder-name">${med.name}</span>
                    <span class="reminder-time">${timesDisplay}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="status-badge">${med.takenToday ? '✅ Taken' : '⏳ Pending'}</span>
                    <span onclick="editMedicine(${med.id})" style="cursor: pointer; color: #4facfe; font-size: 18px;">✏️</span>
                    <span onclick="deleteMedicine(${med.id})" style="cursor: pointer; color: #ff4757; font-size: 18px;">🗑️</span>
                </div>
            </div>
        `;
    }).join('');
}