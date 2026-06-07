// Importiert Berechnungen und Druck-Logiken EXKLUSIV aus den Modulen
import { cleanStorageUnits, parseStorageData, generateFolderHTML } from './modules/helpers.js';
import { generateLabelPNG } from './modules/printer.js';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let lastUUID = "";
let isFetching = false;
let clearTimer = null;
let databaseRecords = [];

let cameraStream = null;
let isScannerActive = false;

// Database Konfiguration
const airtableToken = "pat4ytEWExJctNU62.59f8c764a353cf3d3571ea45e9d0d2e713e95a5a83499e97c5770f60850170b9";
const baseId = "appXKM0UQ8uJLuiNB";
const tableName = "SSDs";

const cameraConstraints = {
    video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
    },
    audio: false
};

document.addEventListener("DOMContentLoaded", () => {
    fetchDatabase();
});

/* Steuert das geschmeidige Ein- und Ausfahren der Feature-Schublade */
function toggleFeatureHub() {
    const panel = document.getElementById('feature-hub-panel');
    panel.classList.toggle('active');
}

/* Schaltet das Custom-Sortier-Dropdown-Menü aktiv oder inaktiv */
function toggleSortMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('sort-dropdown-menu');
    if (menu) menu.classList.toggle('active');
}

/* Setzt den Sortier-State im versteckten HTML-Feld, steuert die LED-Klassen und triggert den FLIP-Effekt */
function setSortMode(mode, event) {
    if (event) event.stopPropagation();

    const hiddenInput = document.getElementById('db-sort');
    if (hiddenInput) hiddenInput.value = mode;

    const options = document.querySelectorAll('.sort-option');
    options.forEach(opt => {
        if (opt.getAttribute('data-sort-val') === mode) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });

    const menu = document.getElementById('sort-dropdown-menu');
    if (menu) menu.classList.remove('active');

    renderManagerList(false);
}

// Schließt das Sortier-Menü automatisch bei einem Klick ins Leere
document.addEventListener('click', () => {
    const menu = document.getElementById('sort-dropdown-menu');
    if (menu) menu.classList.remove('active');
});

/* Leert das Suchfeld per Klick, setzt den Fokus zurück und aktualisiert die Liste */
function clearSearch() {
    const searchInput = document.getElementById('db-search');
    if (searchInput) {
        searchInput.value = '';
        renderManagerList();
        searchInput.focus();
    }
}

/* Manueller Refresh-Trigger mit visueller CSS-Rotations-Injektion */
async function manualRefresh() {
    const refreshBtn = document.getElementById('db-refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    await fetchDatabase();

    if (refreshBtn) {
        setTimeout(() => {
            refreshBtn.classList.remove('spinning');
        }, 400);
    }
}

async function fetchDatabase() {
    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();
        databaseRecords = data.records || [];
        renderManagerList(true);
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (error) {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.innerText = "Fehler beim Laden der Database.";
        console.error(error);
    }
}

/* HIGH-PERFORMANCE FLIP ENGINE: Filtert, sortiert und berechnet Speicherallokationen */
function renderManagerList(isInitialLoad = false) {
    const content = document.getElementById('manager-content');
    const sortBy = document.getElementById('db-sort').value;
    const searchTerm = document.getElementById('db-search').value.toLowerCase().trim();

    // SICHTBARKEITS-SCHALTUNG FÜR DAS LÖSCHKREUZ
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) {
        clearBtn.style.display = searchTerm !== "" ? "flex" : "none";
    }

    // FLIP - PHASE 1: FIRST
    const firstPositions = {};
    if (!isInitialLoad) {
        content.querySelectorAll('[data-flip-id]').forEach(el => {
            const id = el.getAttribute('data-flip-id');
            firstPositions[id] = el.getBoundingClientRect();
        });
    }

    // Filter-Logik für die Suche
    let processedRecords = databaseRecords.filter(record => {
        const f = record.fields;
        return (f.Name || '').toLowerCase().includes(searchTerm) ||
            (f.Speicher || '').toLowerCase().includes(searchTerm) ||
            (f.Ordner || '').toLowerCase().includes(searchTerm) ||
            (f.Firma || 'MNAU').toLowerCase().includes(searchTerm);
    });

    if (processedRecords.length === 0) {
        content.innerHTML = '<div style="text-align:center; color:#a0aec0; padding:20px;">Keine SSDs gefunden.</div>';
        return;
    }

    const companyComparator = (a, b) => {
        const firmaA = a.fields.Firma || 'MNAU';
        const firmaB = b.fields.Firma || 'MNAU';
        if (firmaA === firmaB) return 0;
        return (firmaA === 'MNAU' && firmaB === 'Gecko') ? -1 : 1;
    };

    if (sortBy === 'name') {
        processedRecords.sort((a, b) => companyComparator(a, b) || (a.fields.Name || '').localeCompare(b.fields.Name || ' '));
    } else if (sortBy === 'storage') {
        processedRecords.sort((a, b) => companyComparator(a, b) || parseStorageData(b.fields.Speicher).freeMB - parseStorageData(a.fields.Speicher).freeMB);
    }

    content.innerHTML = '';

    // SPEICHER-ALLOKATIONS-RECHNER
    const allocVal = parseFloat(document.getElementById('db-alloc-val').value);
    const allocUnit = document.getElementById('db-alloc-unit').value;
    let targetMB = 0;
    let recommendedIds = new Set();

    if (!isNaN(allocVal) && allocVal > 0) {
        targetMB = allocUnit === "TB" ? allocVal * 1024 * 1024 : allocVal * 1024;

        let singleFits = processedRecords.filter(r => parseStorageData(r.fields.Speicher).freeMB >= targetMB);
        let suggestionHTML = `<h3>💾 Speicher-Allokation (${allocVal} ${allocUnit})</h3>`;

        if (singleFits.length > 0) {
            suggestionHTML += `<p>➔ Folgende SSDs bieten <span class="alloc-highlight-green">einzeln</span> genügend freien Speicherplatz:</p><div class="alloc-chip-container">`;
            singleFits.forEach(r => {
                const chipBrandClass = (r.fields.Firma || 'MNAU').toLowerCase() + '-alloc-chip';
                suggestionHTML += `<span class="alloc-target-chip ${chipBrandClass}">${r.fields.Name}</span>`;
                recommendedIds.add(r.id);
            });
            suggestionHTML += `</div>`;
        } else {
            let sortedForCombo = [...processedRecords].sort((a, b) => parseStorageData(b.fields.Speicher).freeMB - parseStorageData(a.fields.Speicher).freeMB);
            let comboSelected = [];
            let accumulatedMB = 0;

            for (let r of sortedForCombo) {
                let freeMB = parseStorageData(r.fields.Speicher).freeMB;
                if (freeMB > 0) {
                    comboSelected.push(r);
                    accumulatedMB += freeMB;
                    recommendedIds.add(r.id);
                    if (accumulatedMB >= targetMB) break;
                }
            }

            if (accumulatedMB >= targetMB) {
                suggestionHTML += `<p>➔ Keine einzelne SSD groß genug. Daten <span class="alloc-highlight-blue">aufteilen empfohlen</span> auf folgende Units:</p><div class="alloc-chip-container">`;
                comboSelected.forEach(r => {
                    const chipBrandClass = (r.fields.Firma || 'MNAU').toLowerCase() + '-alloc-chip';
                    suggestionHTML += `<span class="alloc-target-chip ${chipBrandClass}">${r.fields.Name}</span>`;
                });
                suggestionHTML += `</div>`;
            } else {
                let missingMB = targetMB - accumulatedMB;
                let missingStr = missingMB >= 1048576 ? `${(missingMB / 1048576).toFixed(2)} TB` : `${(missingMB / 1024).toFixed(0)} GB`;
                suggestionHTML += `<p class="alloc-error">⚠️ Speichermangel! Dir fehlen noch knapp <strong>${missingStr}</strong>.</p>`;
            }
        }

        const sugBox = document.createElement('div');
        sugBox.className = 'suggestion-box';
        sugBox.innerHTML = suggestionHTML;
        content.appendChild(sugBox);
    }

    let lastCompanySeen = null;

    processedRecords.forEach((record, index) => {
        const f = record.fields;
        if (!f.UUID || !f.Name) return;

        const currentFirma = f.Firma || "MNAU";

        if (currentFirma !== lastCompanySeen) {
            const divider = document.createElement('div');
            divider.className = `section-divider ${currentFirma.toLowerCase()}-divider`;
            divider.setAttribute('data-flip-id', `divider-${currentFirma.toLowerCase()}`);
            divider.innerHTML = `<span>${currentFirma} STORAGE UNITS</span>`;
            content.appendChild(divider);
            lastCompanySeen = currentFirma;
        }

        const brandClass = currentFirma === "Gecko" ? "gecko-brand" : "mnau-brand";
        const storageInfo = parseStorageData(f.Speicher);

        let barColor = '#2ecc71';
        if (storageInfo.percentUsed >= 90) barColor = '#e74c3c';
        else if (storageInfo.percentUsed >= 70) barColor = '#f1c40f';

        const ordnerText = (f.Ordner || '').toLowerCase();
        const hasMatchingFolder = searchTerm !== "" && ordnerText.includes(searchTerm);
        const autoOpenAttribute = hasMatchingFolder ? "open" : "";

        const isRecommended = recommendedIds.has(record.id) ? "recommended-alloc-row" : "";

        const row = document.createElement('div');
        row.className = `ssd-row ${brandClass} ${isRecommended}`;
        row.setAttribute('data-flip-id', record.id);

        if (isInitialLoad) {
            row.style.opacity = '0';
            row.style.transform = 'translateY(16px)';
            setTimeout(() => {
                row.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
                row.style.opacity = '1';
                row.style.transform = 'translateY(0)';
            }, index * 35);
        }

        // REPARIERT: Injektion mit style="width:0%" und data-target-width für den Layout Flush
        row.innerHTML = `
            <div class="ssd-row-header">
                <div class="ssd-info-block">
                    <div class="ssd-row-title">
                        ${f.Name}
                        ${recommendedIds.has(record.id) ? '<span class="alloc-row-badge">✓ Empfohlen</span>' : ''}
                    </div>
                    <div class="ssd-row-meta">Speicher: ${cleanStorageUnits(f.Speicher)}</div>
                    <div class="storage-bar-container">
                        <div class="storage-bar list-storage-bar" style="width: 0%; background-color: ${barColor};" data-target-width="${storageInfo.percentUsed}%"></div>
                    </div>
                </div>
                <div class="action-group">
                    <select id="logo-select-${f.UUID}" class="logo-select" onchange="updateCompanyField('${record.id}', this.value)">
                        <option value="MNAU" ${currentFirma === 'MNAU' ? 'selected' : ''}>MNAU</option>
                        <option value="Gecko" ${currentFirma === 'Gecko' ? 'selected' : ''}>Gecko</option>
                    </select>
                    <button class="print-btn" onclick="generateLabelPNG('${f.Name}', '${f.UUID}')">
                        <svg style="width:16px; height:16px; fill:currentColor;" viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                        Label
                    </button>
                    <button class="delete-btn" onclick="deleteSSD('${record.id}', '${f.Name}')" title="SSD aus Database löschen">
                        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
            </div>
            <details class="ssd-details" ${autoOpenAttribute}>
                <summary>Ordnerstruktur einblenden</summary>
                <div class="ssd-folders-preview">${generateFolderHTML(f.Ordner, currentFirma, searchTerm)}</div>
            </details>
        `;
        content.appendChild(row);
    });

    // REPARIERT: "Forced Reflow" bricht das DOM-Batching auf und zwingt die Listenbalken zur Animation!
    content.querySelectorAll('.list-storage-bar').forEach(bar => {
        bar.offsetWidth; // Layout Flush erzwingen
        bar.style.width = bar.getAttribute('data-target-width');
    });

    // FLIP - PHASE 2, 3 & 4: PLAY
    if (!isInitialLoad) {
        content.querySelectorAll('[data-flip-id]').forEach(el => {
            const id = el.getAttribute('data-flip-id');
            const first = firstPositions[id];
            if (first) {
                const last = el.getBoundingClientRect();
                const dy = first.top - last.top;
                if (dy !== 0) {
                    el.style.transition = 'none';
                    el.style.transform = `translateY(${dy}px)`;
                }
            } else {
                el.style.opacity = '0';
                el.style.transform = 'translateY(15px)';
            }
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                content.querySelectorAll('[data-flip-id]').forEach(el => {
                    el.style.transition = 'transform 0.55s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.4s ease';
                    el.style.transform = 'translateY(0)';
                    el.style.opacity = '1';
                });
            });
        });
    }
}

async function updateCompanyField(recordId, newFirma) {
    const localRecord = databaseRecords.find(r => r.id === recordId);
    if (localRecord) localRecord.fields.Firma = newFirma;
    renderManagerList(false);

    try {
        await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${airtableToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields: { "Firma": newFirma } })
        });
    } catch (error) {
        console.error("Database-Hintergrundsync fehlgeschlagen:", error);
    }
}

async function deleteSSD(recordId, ssdName) {
    const securityCheck = confirm(`🛑 KRITISCHER VORGANG:\nMöchtest du die SSD "${ssdName}" wirklich unwiderruflich aus der Database löschen?\n\nDieser Vorgang kann NICHT rückgängig gemacht werden!`);
    if (!securityCheck) return;

    databaseRecords = databaseRecords.filter(record => record.id !== recordId);
    renderManagerList(false);

    try {
        await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`, {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${airtableToken}`
            }
        });
    } catch (error) {
        console.error("REST-API Deletion Error:", error);
        alert("Fehler beim Synchronisieren des Löschvorgangs. Bitte lade das HUD neu.");
    }
}

function openScanner() {
    document.getElementById('scanner-overlay').classList.add('active');
    isScannerActive = true;
    lastUUID = "";

    const arStorageBar = document.getElementById('ar-storage-bar');
    if (arStorageBar) {
        arStorageBar.style.transition = 'none';
        arStorageBar.style.width = '0%';
    }

    navigator.mediaDevices.getUserMedia(cameraConstraints)
        .then(function(stream) {
            cameraStream = stream;
            video.srcObject = stream;
            video.setAttribute("playsinline", true);
            video.play();
            requestAnimationFrame(tick);
        })
        .catch(function(err) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
                .then(function(stream) {
                    cameraStream = stream;
                    video.srcObject = stream;
                    video.play();
                    requestAnimationFrame(tick);
                })
                .catch(function(fallbackErr) {
                    alert("Kamerazugriff verweigert.");
                    closeScanner();
                });
        });
}

function closeScanner() {
    isScannerActive = false;
    document.getElementById('scanner-overlay').classList.remove('active');
    document.getElementById('ar-card').classList.remove('active');

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    lastUUID = "";
    fetchDatabase();
}

function tick() {
    if (!isScannerActive) return;

    if (isFetching) {
        requestAnimationFrame(tick);
        return;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
            const scannedUUID = code.data.trim();
            if (scannedUUID.length > 5) {
                handleQRDetected(scannedUUID);
                if (scannedUUID === lastUUID) {
                    resetClearTimer();
                }
            }
        }
    }
    requestAnimationFrame(tick);
}

async function handleQRDetected(uuid) {
    if (uuid === lastUUID || isFetching) return;
    if (clearTimer) clearTimeout(clearTimer);
    isFetching = true;
    lastUUID = uuid;

    const card = document.getElementById('ar-card');
    const nameEl = document.getElementById('ssd-name');
    const speicherEl = document.getElementById('ssd-speicher');
    const ordnerEl = document.getElementById('ssd-ordner');
    const updateEl = document.getElementById('ssd-update');
    const arStorageBar = document.getElementById('ar-storage-bar');

    if (arStorageBar) {
        arStorageBar.style.transition = 'none';
        arStorageBar.style.width = '0%';
    }

    card.classList.add('active');
    card.style.borderColor = '#00663a';
    nameEl.innerText = "Verbinde mit Database...";
    speicherEl.innerText = "UUID erkannt: " + uuid.substring(0,8) + "...";
    ordnerEl.innerHTML = '<div class="no-folders">Lade Ordnerstruktur...</div>';
    updateEl.innerText = "-";

    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}?filterByFormula={UUID}='${uuid}'`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();

        if (data.records && data.records.length > 0) {
            const fields = data.records[0].fields;
            const company = fields.Firma || "MNAU";
            const brandColor = company === "Gecko" ? "#29ABE2" : "#00663a";

            const storageInfo = parseStorageData(fields.Speicher);
            let barColor = '#2ecc71';
            if (storageInfo.percentUsed >= 90) barColor = '#e74c3c';
            else if (storageInfo.percentUsed >= 70) barColor = '#f1c40f';

            nameEl.innerText = fields.Name || "Unbenannte SSD";
            speicherEl.innerText = cleanStorageUnits(fields.Speicher);
            ordnerEl.innerHTML = generateFolderHTML(fields.Ordner, company, "");
            updateEl.innerText = "Zuletzt aktualisiert: " + (fields.Updates || "-");
            card.style.borderColor = brandColor;

            // REPARIERT: "Forced Reflow" zwingt den Scanner-Balken zur perfekten CSS-Breitenanimation bei jedem Scan
            if (arStorageBar) {
                arStorageBar.style.backgroundColor = barColor;
                arStorageBar.style.width = '0%';
                arStorageBar.offsetWidth; // Layout Flush erzwingen!
                arStorageBar.style.transition = 'width 0.65s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s';
                arStorageBar.style.width = `${storageInfo.percentUsed}%`;
            }
        } else {
            nameEl.innerText = "Unbekannte SSD";
            speicherEl.innerText = "Gescannte ID: " + uuid;
            ordnerEl.innerHTML = '<div class="no-folders">Nicht in Database registriert.</div>';
            card.style.borderColor = '#ff3333';
        }
    } catch (error) {
        nameEl.innerText = "Verbindungsfehler";
        speicherEl.innerText = "Server nicht erreichbar.";
    } finally {
        isFetching = false;
        resetClearTimer();
    }
}

function resetClearTimer() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
        document.getElementById('ar-card').classList.remove('active');
        lastUUID = "";
    }, 6000);
}

window.openScanner = openScanner;
window.closeScanner = closeScanner;
window.renderManagerList = renderManagerList;
window.updateCompanyField = updateCompanyField;
window.generateLabelPNG = generateLabelPNG;
window.toggleFeatureHub = toggleFeatureHub;
window.clearSearch = clearSearch;
window.toggleSortMenu = toggleSortMenu;
window.setSortMode = setSortMode;
window.deleteSSD = deleteSSD;
window.manualRefresh = manualRefresh;