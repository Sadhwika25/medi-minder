// js/storage.js

// ============================================================
// OFFLINE-FIRST STORAGE WITH CONFLICT RESOLUTION
// ============================================================

// Configure localforage (IndexedDB)
localforage.config({
    name: 'MediMinder',
    storeName: 'medicines',
    version: 1.0
});

// ============================================================
// 1. LOCAL STORAGE (IndexedDB)
// ============================================================

// Get all medicines from local IndexedDB
async function getLocalMedicines() {
    try {
        const medicines = await localforage.getItem('medicines');
        return medicines || [];
    } catch (error) {
        console.error('Error reading from IndexedDB:', error);
        return [];
    }
}

// Save all medicines to local IndexedDB
async function saveLocalMedicines(medicines) {
    try {
        await localforage.setItem('medicines', medicines);
        return true;
    } catch (error) {
        console.error('Error saving to IndexedDB:', error);
        return false;
    }
}

// Get a single medicine by ID from local storage
async function getLocalMedicine(id) {
    const medicines = await getLocalMedicines();
    return medicines.find(m => m.id === id);
}

// ============================================================
// 2. SYNC QUEUE (For offline changes)
// ============================================================

// Get the sync queue (pending operations)
async function getSyncQueue() {
    try {
        const queue = await localforage.getItem('syncQueue');
        return queue || [];
    } catch (error) {
        console.error('Error reading sync queue:', error);
        return [];
    }
}

// Add an operation to the sync queue
async function addToSyncQueue(operation) {
    const queue = await getSyncQueue();
    queue.push({
        ...operation,
        timestamp: Date.now(),
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    });
    await localforage.setItem('syncQueue', queue);
    console.log(`📦 Added to sync queue: ${operation.type} - ${operation.medicine?.name || operation.id}`);
}

// Clear a specific item from the sync queue after successful sync
async function removeFromSyncQueue(queueItemId) {
    const queue = await getSyncQueue();
    const updatedQueue = queue.filter(item => item.id !== queueItemId);
    await localforage.setItem('syncQueue', updatedQueue);
}

// Clear the entire sync queue (after a successful full sync)
async function clearSyncQueue() {
    await localforage.setItem('syncQueue', []);
    console.log('🗑️ Sync queue cleared.');
}

// ============================================================
// 3. MAIN OFFLINE-FIRST FUNCTIONS
// ============================================================

// Get medicines: First from local storage, then trigger cloud sync
async function getMedicines() {
    // 1. Always return local data first (instant!)
    const localMedicines = await getLocalMedicines();
    
    // 2. Try to sync in the background (if online)
    if (navigator.onLine) {
        syncWithCloud().catch(err => console.warn('Background sync warning:', err));
    }
    
    return localMedicines;
}

// Save medicine: Save locally first, then queue for cloud sync
async function saveMedicines(medicines) {
    // 1. Save locally immediately (offline)
    await saveLocalMedicines(medicines);
    console.log('💾 Saved to local IndexedDB');
    
    // 2. Add to sync queue for cloud backup
    const operation = {
        type: 'save',
        medicines: medicines,
        timestamp: Date.now()
    };
    await addToSyncQueue(operation);
    
    // 3. If online, sync immediately
    if (navigator.onLine) {
        await syncWithCloud();
    }
    
    return true;
}

// ============================================================
// 4. CLOUD SYNC (Push & Pull)
// ============================================================

// Sync local changes to the cloud
async function syncWithCloud() {
    if (!navigator.onLine) {
        console.log('📡 Offline: Cannot sync with cloud.');
        return;
    }
    
    const uid = getCurrentUserUID();
    if (!uid) {
        console.log('🔒 User not authenticated, skipping sync.');
        return;
    }
    
    console.log('🔄 Syncing with cloud...');
    
    try {
        // Step 1: Push local changes to cloud
        const queue = await getSyncQueue();
        if (queue.length > 0) {
            console.log(`📤 Syncing ${queue.length} pending operations...`);
            
            for (const item of queue) {
                if (item.type === 'save' && item.medicines) {
                    // Push local data to Firebase
                    const sanitized = sanitizeMedicines(item.medicines);
                    await firebase.database().ref(`medicines/${uid}`).set(
                        convertToFirebaseObject(sanitized)
                    );
                    console.log(`✅ Synced medicine data to Firebase`);
                }
            }
            
            // Clear the queue after successful sync
            await clearSyncQueue();
        }
        
        // Step 2: Pull cloud data to local (conflict resolution)
        await pullFromCloud();
        
        console.log('✅ Sync completed successfully.');
    } catch (error) {
        console.error('❌ Sync failed:', error);
    }
}

// Pull latest data from cloud and merge with local (conflict resolution)
async function pullFromCloud() {
    const uid = getCurrentUserUID();
    if (!uid) return;
    
    try {
        const snapshot = await firebase.database().ref(`medicines/${uid}`).once('value');
        const cloudData = snapshot.val();
        
        if (!cloudData) {
            console.log('☁️ No cloud data found.');
            return;
        }
        
        // Convert Firebase object to array
        const cloudMedicines = Object.keys(cloudData).map(key => ({
            id: parseInt(key),
            ...cloudData[key]
        }));
        
        // Get local medicines
        const localMedicines = await getLocalMedicines();
        
        // Merge with conflict resolution (last-write-wins by timestamp)
        const mergedMedicines = mergeWithConflictResolution(localMedicines, cloudMedicines);
        
        // Save merged data locally
        await saveLocalMedicines(mergedMedicines);
        
        console.log('📥 Pulled cloud data and merged with local.');
    } catch (error) {
        console.error('❌ Failed to pull from cloud:', error);
    }
}

// ============================================================
// 5. CONFLICT RESOLUTION (Last-write-wins by timestamp)
// ============================================================

function mergeWithConflictResolution(local, cloud) {
    const merged = [...cloud]; // Start with cloud data
    
    // For each local medicine, check if it's newer than cloud version
    for (const localMed of local) {
        const cloudIndex = merged.findIndex(m => m.id === localMed.id);
        
        if (cloudIndex === -1) {
            // Medicine exists in local but not in cloud → add it
            merged.push(localMed);
            console.log(`🆕 Added local medicine to merged: ${localMed.name}`);
        } else {
            // Medicine exists in both → compare timestamps
            const cloudMed = merged[cloudIndex];
            const localTime = localMed.lastModified || localMed.id;
            const cloudTime = cloudMed.lastModified || cloudMed.id;
            
            if (localTime > cloudTime) {
                // Local version is newer → overwrite cloud version
                merged[cloudIndex] = {
                    ...localMed,
                    id: localMed.id
                };
                console.log(`⚔️ Conflict resolved: Local version of "${localMed.name}" is newer.`);
            } else {
                console.log(`✓ Cloud version of "${cloudMed.name}" is newer or equal.`);
            }
        }
    }
    
    return merged;
}

// ============================================================
// 6. NETWORK LISTENER (Auto-sync when back online)
// ============================================================

// Listen for online/offline events
window.addEventListener('online', async () => {
    console.log('🌐 Device is online. Syncing...');
    await syncWithCloud();
});

window.addEventListener('offline', () => {
    console.log('📡 Device is offline. Changes will be queued.');
});

// ============================================================
// 7. UTILITY FUNCTIONS
// ============================================================

// Sanitize medicines before saving to Firebase
function sanitizeMedicines(medicines) {
    return medicines.map(med => ({
        ...med,
        lastTakenDate: med.lastTakenDate !== undefined ? med.lastTakenDate : null,
        takenToday: med.takenToday !== undefined ? med.takenToday : false,
        lastModified: Date.now()
    }));
}

// Convert array to Firebase object (keyed by ID)
function convertToFirebaseObject(medicines) {
    const obj = {};
    medicines.forEach(med => {
        obj[med.id] = {
            name: med.name,
            times: med.times,
            takenToday: med.takenToday,
            lastTakenDate: med.lastTakenDate,
            lastModified: med.lastModified || med.id
        };
    });
    return obj;
}

// ============================================================
// 8. INITIALIZATION
// ============================================================

// Try to sync on page load (if online)
setTimeout(() => {
    if (navigator.onLine) {
        syncWithCloud().catch(err => console.warn('Initial sync warning:', err));
    }
}, 2000);

console.log('📦 Offline-first storage initialized.');