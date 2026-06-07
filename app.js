const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let lastUUID = "";
let isFetching = false;
let clearTimer = null;
let databaseRecords = []; // Lokaler Zwischenspeicher für Sortierung/Suche

let cameraStream = null;      // Hält den aktiven Video-Stream
let isScannerActive = false;   // Flag zur Steuerung des Render-Loops

// ----------------------------------------------------
// AIRTABLE ACCESS CONFIGURATION (Sicher im privaten Repository)
const airtableToken = "pat4ytEWExJctNU62.59f8c764a353cf3d3571ea45e9d0d2e713e95a5a83499e97c5770f60850170b9";
const baseId = "appXKM0UQ8uJLuiNB";
const tableName = "SSDs";
// ----------------------------------------------------

// Full-HD Kameraeinstellungen für scharfes Scannen aus der Distanz
const cameraConstraints = {
    video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
    },
    audio: false
};

// ====================================================
// GLOBAL HELPERS
// ====================================================

/* REPARIERT: Bereinigt kryptische Einheiten wie 'Ti'/'Gi' in allgemein gängige Kürzel ('TB'/'GB') */
function cleanStorageUnits(speicherStr) {
    if (!speicherStr) return "Keine Info";
    return speicherStr
        .replace(/TiB?/g, 'TB')
        .replace(/GiB?/g, 'GB')
        .replace(/MiB?/g, 'MB')
        .replace(/KiB?/g, 'KB')
        .replace(/\bT\b/g, 'TB')
        .replace(/\bG\b/g, 'GB')
        .replace(/\bM\b/g, 'MB');
}

/* Hilfsfunktion: Berechnet Speicher-Prozentwerte für den Fortschrittsbalken */
function parseStorageData(speicherStr) {
    const result = { percentUsed: 0, freeMB: 0 };
    if (!speicherStr) return result;

    const matches = speicherStr.match(/([\d.,]+)\s*([a-zA-Z]*)\s+frei\s+von\s+([\d.,]+)\s*([a-zA-Z]*)/);
    if (!matches) return result;

    const freeVal = parseFloat(matches[1].replace(',', '.'));
    const freeUnit = matches[2].toLowerCase();
    const totalVal = parseFloat(matches[3].replace(',', '.'));
    const totalUnit = matches[4].toLowerCase();

    const toMB = (val, unit) => {
        if (unit.includes('t')) return val * 1024 * 1024;
        if (unit.includes('g')) return val * 1024;
        if (unit.includes('m')) return val;
        return val;
    };

    const freeMB = toMB(freeVal, freeUnit);
    const totalMB = toMB(totalVal, totalUnit);
    
    if (totalMB > 0) {
        const usedMB = totalMB - freeMB;
        result.percentUsed = Math.max(0, Math.min(100, (usedMB / totalMB) * 100));
        result.freeMB = freeMB;
    }
    return result;
}

/* Ordner-Parser: Erstellt saubere UI-Chips inklusive kaskadierender Einblende-Animation */
function generateFolderHTML(ordnerStr, company) {
    if (!ordnerStr || ordnerStr.trim() === "" || ordnerStr.includes("(Leer)")) {
        return '<div class="no-folders">Keine Ordner vorhanden</div>';
    }
    
    const folderArray = ordnerStr.split(/\\n|\n/).filter(Boolean);
    if (folderArray.length === 0) return '<div class="no-folders">Keine Ordner vorhanden</div>';
    
    const iconColor = company === "Gecko" ? "#29ABE2" : "#00663a";
    
    return folderArray.map((folder, index) => `
        <div class="folder-item" style="animation-delay: ${index * 0.04}s;">
            <svg class="folder-icon" style="fill: ${iconColor};" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <span class="folder-name">${folder.trim()}</span>
        </div>
    `).join('');
}

// ====================================================
// CORE WORKFLOW & LIFE-CYCLE
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
    fetchDatabase();
});

/* Lädt die gesamte Airtable-Datenbank für die Listenansicht */
async function fetchDatabase() {
    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();
        databaseRecords = data.records || [];
        
        renderManagerList();
        document.getElementById('loading-overlay').style.display = 'none';
    } catch (error) {
        document.getElementById('loading-overlay').innerText = "Fehler beim Laden der Airtable-Datenbank.";
        console.error(error);
    }
}

/* Rendert die Liste basierend auf Sortierung UND Suchbegriff */
function renderManagerList(movedRecordId = null) {
    const content = document.getElementById('manager-content');
    const sortBy = document.getElementById('db-sort').value;
    const searchTerm = document.getElementById('db-search').value.toLowerCase().trim();
    content.innerHTML = '';

    if (databaseRecords.length === 0) {
        content.innerHTML = '<div style="text-align:center; color:#a0aec0; padding:20px;">Keine Daten gefunden.</div>';
        return;
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

    let lastCompanySeen = null;

    processedRecords.forEach((record, index) => {
        const f = record.fields;
        if (!f.UUID || !f.Name) return;

        const currentFirma = f.Firma || "MNAU";

        if (currentFirma !== lastCompanySeen) {
            const divider = document.createElement('div');
            divider.className = `section-divider ${currentFirma.toLowerCase()}-divider`;
            divider.innerHTML = `<span>${currentFirma} STORAGE UNITS</span>`;
            content.appendChild(divider);
            lastCompanySeen = currentFirma;
        }

        const brandClass = currentFirma === "Gecko" ? "gecko-brand" : "mnau-brand";
        const storageInfo = parseStorageData(f.Speicher);
        
        let barColor = '#2ecc71'; 
        if (storageInfo.percentUsed >= 90) barColor = '#e74c3c'; 
        else if (storageInfo.percentUsed >= 70) barColor = '#f1c40f'; 

        const row = document.createElement('div');
        row.className = `ssd-row ${brandClass}`;
        
        // REPARIERT: Kontrollierter Einfliege-Effekt (Verhindert Ruckeln beim Durchreichen)
        if (movedRecordId) {
            if (record.id === movedRecordId) {
                row.style.animation = 'rowFadeIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.2) forwards';
            } else {
                row.style.animation = 'none';
                row.style.opacity = '1';
                row.style.transform = 'translateY(0)';
            }
        } else {
            row.style.animationDelay = `${index * 0.04}s`;
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
                    <select id="logo-select-${f.UUID}" class="logo-select" onchange="updateCompanyField('${record.id}', this.value, this)">
                        <option value="MNAU" ${currentFirma === 'MNAU' ? 'selected' : ''}>MNAU</option>
                        <option value="Gecko" ${currentFirma === 'Gecko' ? 'selected' : ''}>Gecko</option>
                    </select>
                    <button class="print-btn" onclick="generateLabelPNG('${f.Name}', '${f.UUID}')">
                        <svg style="width:16px; height:16px; fill:currentColor;" viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                        PNG
                    </button>
                </div>
            </div>
            <details class="ssd-details">
                <summary>Ordnerstruktur einblenden</summary>
                <div class="ssd-folders-preview">${generateFolderHTML(f.Ordner, currentFirma)}</div>
            </details>
        `;
        content.appendChild(row);
    });
}

/* LIVE-UPDATE AN AIRTABLE: Mit hocheleganten Inline-Zusammenstauchungs-Effekt */
async function updateCompanyField(recordId, newFirma, selectElement) {
    try {
        // Findet die genaue Zeile im Browser-Fenster
        const rowElement = selectElement.closest('.ssd-row');
        if (rowElement) {
            // Fährt die alte Zeile weich auf 0-Größe herunter und schiebt sie optisch weg
            rowElement.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            rowElement.style.opacity = '0';
            rowElement.style.transform = 'translateY(25px) scale(0.95)';
            rowElement.style.maxHeight = '0px';
            rowElement.style.marginBottom = '0px';
            rowElement.style.paddingTop = '0px';
            rowElement.style.paddingBottom = '0px';
            rowElement.style.overflow = 'hidden';
        }

        // Parallel läuft die API-Anfrage im Hintergrund weiter (Keine Wartezeit für den Nutzer!)
        fetch(`https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${airtableToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields: { "Firma": newFirma } })
        }).then(response => {
            if (!response.ok) console.error("Airtable-Hintergrundsync fehlgeschlagen.");
        });

        // Sobald die Zusammenstauchung fertig ist (400ms), ordnen wir die Liste im Speicher neu an
        setTimeout(() => {
            const localRecord = databaseRecords.find(r => r.id === recordId);
            if (localRecord) localRecord.fields.Firma = newFirma;
            
            // Rendert die Liste neu und übergibt die ID, damit NUR diese Zeile am neuen Ort auffedert
            renderManagerList(recordId);
        }, 400);

    } catch (error) {
        console.error(error);
    }
}

/* STARTET DIE KAMERA */
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

/* STOPPT DIE KAMERA VIA HARDWARE-COMMAND */
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

/* Handler für erkannten QR-Code im Kamera-Modus */
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
            // REPARIERT: Auch hier in der AR-Kameraansicht werden die gereinigten Einheiten ausgespuckt!
            speicherEl.innerText = cleanStorageUnits(fields.Speicher);
            ordnerEl.innerHTML = generateFolderHTML(fields.Ordner, company);
            updateEl.innerText = "Zuletzt aktualisiert: " + (fields.Updates || "-");
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

/* HTML5 Off-Screen Canvas Label Generator - MIT SMARTEM WORT-UMBRUCH */
async function generateLabelPNG(name, uuid) {
    try {
        const selectedCompany = document.getElementById(`logo-select-${uuid}`).value;
        const selectedLogoFile = selectedCompany === "Gecko" ? "gecko_logo.svg" : "mnau_logo.svg";
        const qrDataUrl = await QRCode.toDataURL(uuid, { margin: 1, width: 340 });

        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 300;
        labelCanvas.height = 1000;
        const lCtx = labelCanvas.getContext('2d');

        lCtx.fillStyle = '#ffffff';
        lCtx.fillRect(0, 0, 300, 1000);

        const logoImg = new Image();
        logoImg.src = selectedLogoFile;
        await new Promise((resolve, reject) => {
            logoImg.onload = resolve;
            logoImg.onerror = () => reject(new Error(`Logo ${selectedLogoFile} fehlt.`));
        });
        
        lCtx.drawImage(logoImg, 15, 40, 270, 270);
        lCtx.fillStyle = '#000000';
        lCtx.textAlign = 'center';
        lCtx.textBaseline = 'middle';
        
        const maxWidth = 270;
        const words = name.split(' ');
        let bestLines = [name];
        let targetFontSize = 110;

        let singleLineSize = 110;
        do {
            lCtx.font = `bold ${singleLineSize}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
            if (lCtx.measureText(name).width <= maxWidth) break;
            singleLineSize--;
        } while (singleLineSize > 12);

        if (singleLineSize < 75 && words.length > 1) {
            let maxPossibleFontSizeForTwoLines = 0;
            let optimalLines = [name];

            for (let i = 1; i < words.length; i++) {
                const line1 = words.slice(0, i).join(' ');
                const line2 = words.slice(i).join(' ');
                let currentFontSize = 110;
                do {
                    lCtx.font = `bold ${currentFontSize}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
                    if (lCtx.measureText(line1).width <= maxWidth && lCtx.measureText(line2).width <= maxWidth) break;
                    currentFontSize--;
                } while (currentFontSize > 12);

                if (currentFontSize > maxPossibleFontSizeForTwoLines) {
                    maxPossibleFontSizeForTwoLines = currentFontSize;
                    optimalLines = [line1, line2];
                }
            }
            if (maxPossibleFontSizeForTwoLines > singleLineSize) {
                bestLines = optimalLines;
                targetFontSize = maxPossibleFontSizeForTwoLines;
            } else {
                targetFontSize = singleLineSize;
            }
        } else {
            targetFontSize = singleLineSize;
        }

        if (bestLines.length === 2 && targetFontSize > 80) targetFontSize = 80;

        lCtx.font = `bold ${targetFontSize}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;

        if (bestLines.length === 1) {
            lCtx.fillText(bestLines[0], 150, 420);
        } else {
            const lineSpacing = targetFontSize * 1.25; 
            lCtx.fillText(bestLines[0], 150, 420 - (lineSpacing / 2));
            lCtx.fillText(bestLines[1], 150, 420 + (lineSpacing / 2));
        }

        const qrImg = new Image();
        qrImg.src = qrDataUrl;
        await new Promise((resolve) => qrImg.onload = resolve);
        lCtx.drawImage(qrImg, 15, 530, 270, 270);

        const downloadLink = document.createElement('a');
        downloadLink.download = `${selectedCompany}_Label_${name.replace(/\s+/g, '_')}.png`;
        downloadLink.href = labelCanvas.toDataURL('image/png');
        downloadLink.click();
    } catch (err) {
        alert("Fehler beim Erstellen des PNG-Labels.");
        console.error(err);
    }
}