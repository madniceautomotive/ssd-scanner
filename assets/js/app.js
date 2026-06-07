// Importiert Berechnungen und Druck-Logiken aus den Modulen
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

// Airtable Konfiguration
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

async function fetchDatabase() {
    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();
        databaseRecords = data.records || [];
        renderManagerList(true); 
        document.getElementById('loading-overlay').style.display = 'none';
    } catch (error) {
        document.getElementById('loading-overlay').innerText = "Fehler beim Laden der Airtable-Datenbank.";
        console.error(error);
    }
}

function renderManagerList(isInitialLoad = false) {
    const content = document.getElementById('manager-content');
    const sortBy = document.getElementById('db-sort').value;
    const searchTerm = document.getElementById('db-search').value.toLowerCase().trim();

    // FLIP - PHASE 1: FIRST
    const firstPositions = {};
    if (!isInitialLoad) {
        content.querySelectorAll('[data-flip-id]').forEach(el => {
            const id = el.getAttribute('data-flip-id');
            firstPositions[id] = el.getBoundingClientRect();
        });
    }

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

        const row = document.createElement('div');
        row.className = `ssd-row ${brandClass}`;
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
        
        row.innerHTML = `
            <div class="ssd-row-header">
                <div class="ssd-info-block">
                    <div class="ssd-row-title">${f.Name}</div>
                    <div class="ssd-row-meta">Speicher: ${cleanStorageUnits(f.Speicher)}</div>
                    <div class="storage-bar-container">
                        <div class="storage-bar" style="width: ${storageInfo.percentUsed}%; background-color: ${barColor};"></div>
                    </div>
                </div>
                <div class="action-group">
                    <select id="logo-select-${f.UUID}" class="logo-select" onchange="updateCompanyField('${record.id}', this.value)">
                        <option value="MNAU" ${currentFirma === 'MNAU' ? 'selected' : ''}>MNAU</option>
                        <option value="Gecko" ${currentFirma === 'Gecko' ? 'selected' : ''}>Gecko</option>
                    </select>
                    <button class="print-btn" onclick="generateLabelPNG('${f.Name}', '${f.UUID}')">
                        <svg style="width:16px; height:16px; fill:currentColor;" viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                        PNG
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

    // FLIP - PHASE 2, 3 & 4: LAST, INVERT & PLAY
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
        console.error("Airtable-Hintergrundsync fehlgeschlagen:", error);
    }
}

function openScanner() {
    document.getElementById('scanner-overlay').classList.add('active');
    isScannerActive = true;
    lastUUID = "";

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
}

function tick() {
    if (!isScannerActive) return;

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

    card.classList.add('active'); 
    card.style.borderColor = '#00663a';
    nameEl.innerText = "Verbinde mit Airtable...";
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

            nameEl.innerText = fields.Name || "Unbenannte SSD";
            speicherEl.innerText = cleanStorageUnits(fields.Speicher);
            ordnerEl.innerHTML = generateFolderHTML(fields.Ordner, company, "");
            updateEl.innerText = "Zulterzt aktualisiert: " + (fields.Updates || "-");
            card.style.borderColor = brandColor;
        } else {
            nameEl.innerText = "Unbekannte SSD";
            speicherEl.innerText = "Gescannte ID: " + uuid;
            ordnerEl.innerHTML = '<div class="no-folders">Nicht in Airtable registriert.</div>';
            card.style.borderColor = '#ff3333';
        }
    } catch (error) {
        nameEl.innerText = "Verbindungsfehler";
        speicherEl.innerText = "Airtable-Server nicht erreichbar.";
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

// CRITICAL INTERFACE BRIDGE: Da ES6-Module geschützte Scopes haben, binden wir die HTML-Klick-Trigger händisch an das globale Window-Objekt
window.openScanner = openScanner;
window.closeScanner = closeScanner;
window.renderManagerList = renderManagerList;
window.updateCompanyField = updateCompanyField;
window.generateLabelPNG = generateLabelPNG;