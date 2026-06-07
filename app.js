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

// AUTOMATISCHER START: Beim Laden der Seite sofort die Datenbank aufrufen
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
        
        // Liste initial rendern
        renderManagerList();
        
        // Lade-Overlay entfernen
        document.getElementById('loading-overlay').style.display = 'none';
    } catch (error) {
        document.getElementById('loading-overlay').innerText = "Fehler beim Laden der Airtable-Datenbank.";
        console.error(error);
    }
}

/* LIVE-UPDATE AN AIRTABLE: Wird getriggert, wenn das Firmen-Dropdown geändert wird */
async function updateCompanyField(recordId, newFirma) {
    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${airtableToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                fields: {
                    "Firma": newFirma
                }
            })
        });

        if (!response.ok) {
            throw new Error("Airtable-Update fehlgeschlagen.");
        }

        // Lokalen Cache updaten, damit Sortierung/Suche direkt ohne Reload stimmig bleiben
        const localRecord = databaseRecords.find(r => r.id === recordId);
        if (localRecord) {
            localRecord.fields.Firma = newFirma;
        }
        
        // Liste nach Änderung direkt neu sortieren und rendern
        renderManagerList();
    } catch (error) {
        alert("Fehler beim Speichern der Firma in Airtable. Bitte Internetverbindung prüfen!");
        console.error(error);
    }
}

/* STARTET DIE KAMERA: Wird aufgerufen, wenn der Scanner geöffnet wird */
function openScanner() {
    document.getElementById('scanner-overlay').style.display = 'block';
    isScannerActive = true;
    lastUUID = "";

    navigator.mediaDevices.getUserMedia(cameraConstraints)
        .then(function(stream) {
            cameraStream = stream;
            video.srcObject = stream;
            video.setAttribute("playsinline", true);
            video.play();
            requestAnimationFrame(tick); // QR-Code Loop starten
        })
        .catch(function(err) {
            console.warn("Full HD nicht unterstützt, Fallback auf Standard-Kamera...", err);
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
                .then(function(stream) {
                    cameraStream = stream;
                    video.srcObject = stream;
                    video.play();
                    requestAnimationFrame(tick);
                })
                .catch(function(fallbackErr) {
                    alert("Kamerazugriff verweigert.");
                    console.error(fallbackErr);
                    closeScanner();
                });
        });
}

/* STOPPT DIE KAMERA: Schaltet die Linsen aus und leert den Speicher */
function closeScanner() {
    isScannerActive = false;
    document.getElementById('scanner-overlay').style.display = 'none';
    document.getElementById('ar-card').style.display = 'none';

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    lastUUID = "";
}

// QR-Code Live-Scan-Schleife (läuft nur, wenn Scanner aktiv ist)
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

// Handler für erkannten QR-Code im Kamera-Modus
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

    card.style.display = 'block';
    card.style.borderColor = '#00663a';
    nameEl.innerText = "Verbinde mit Airtable...";
    speicherEl.innerText = "UUID erkannt: " + uuid.substring(0,8) + "...";
    ordnerEl.innerText = "Lade Ordnerstruktur...";
    updateEl.innerText = "-";

    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}?filterByFormula={UUID}='${uuid}'`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();

        if (data.records && data.records.length > 0) {
            const fields = data.records[0].fields;
            nameEl.innerText = fields.Name || "Unbenannte SSD";
            speicherEl.innerText = fields.Speicher || "Keine Speicherinfo";
            ordnerEl.innerText = fields.Ordner || "(Leer)";
            updateEl.innerText = "Zuletzt aktualisiert: " + (fields.Updates || "-");
            card.style.borderColor = '#00ff73';
            setTimeout(() => { card.style.borderColor = '#00663a'; }, 600);
        } else {
            nameEl.innerText = "Unbekannte SSD";
            speicherEl.innerText = "Gescannte ID: " + uuid;
            ordnerEl.innerText = "Prüfe, ob diese ID exakt so in der Airtable-Spalte 'UUID' steht.";
            card.style.borderColor = '#ff3333';
        }
    } catch (error) {
        nameEl.innerText = "Verbindungsfehler";
        speicherEl.innerText = "Airtable-Server nicht erreichbar.";
        console.error(error);
    } finally {
        isFetching = false;
        resetClearTimer();
    }
}

function resetClearTimer() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
        document.getElementById('ar-card').style.display = 'none';
        lastUUID = "";
    }, 6000); 
}

// Hilfsfunktion: Berechnet Speicher-Prozentwerte und extrahiert MB für die Sortierung
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

/* Rendert die Liste basierend auf Sortierung UND Suchbegriff */
function renderManagerList() {
    const content = document.getElementById('manager-content');
    const sortBy = document.getElementById('db-sort').value;
    const searchTerm = document.getElementById('db-search').value.toLowerCase().trim();
    content.innerHTML = '';

    if (databaseRecords.length === 0) {
        content.innerHTML = '<div style="text-align:center; color:#a0aec0;">Keine SSDs in Airtable gefunden.</div>';
        return;
    }

    // 1. FILTERN nach Suchbegriff
    let processedRecords = databaseRecords.filter(record => {
        const f = record.fields;
        const name = (f.Name || '').toLowerCase();
        const speicher = (f.Speicher || '').toLowerCase();
        const ordner = (f.Ordner || '').toLowerCase();
        const firma = (f.Firma || 'MNAU').toLowerCase();
        return name.includes(searchTerm) || speicher.includes(searchTerm) || ordner.includes(searchTerm) || firma.includes(searchTerm);
    });

    if (processedRecords.length === 0) {
        content.innerHTML = '<div style="text-align:center; color:#a0aec0; padding:20px;">Keine SSDs zu diesem Suchbegriff gefunden.</div>';
        return;
    }

    // GEWINNBRINGENDER HELPER: Sortiert Firmen strikt vor (MNAU = -1, Gecko = 1)
    const companyComparator = (a, b) => {
        const firmaA = a.fields.Firma || 'MNAU';
        const firmaB = b.fields.Firma || 'MNAU';
        if (firmaA === firmaB) return 0;
        if (firmaA === 'MNAU' && firmaB === 'Gecko') return -1;
        if (firmaA === 'Gecko' && firmaB === 'MNAU') return 1;
        return 0;
    };

    // 2. ERZWUNGENE ZWEISTUFIGE SORTIERUNG (Erst Firma, dann Kriterium)
    if (sortBy === 'name') {
        processedRecords.sort((a, b) => {
            const cComp = companyComparator(a, b);
            if (cComp !== 0) return cComp; // Wenn ungleiche Firmen, entscheidet die Firmen-Prio
            return (a.fields.Name || '').localeCompare(b.fields.Name || '');
        });
    } else if (sortBy === 'storage') {
        processedRecords.sort((a, b) => {
            const cComp = companyComparator(a, b);
            if (cComp !== 0) return cComp; // Wenn ungleiche Firmen, entscheidet die Firmen-Prio
            const storageA = parseStorageData(a.fields.Speicher);
            const storageB = parseStorageData(b.fields.Speicher);
            return storageB.freeMB - storageA.freeMB;
        });
    }

    // 3. HTML GENERIEREN
    processedRecords.forEach(record => {
        const f = record.fields;
        if (!f.UUID || !f.Name) return;

        const cleanFolders = f.Ordner ? f.Ordner.split('\\n').filter(Boolean).join('\n') : '(Keine Ordner vorhanden)';
        const currentFirma = f.Firma || "MNAU";

        // Brand-Klasse für CSS-Anpassungen ermitteln
        const brandClass = currentFirma === "Gecko" ? "gecko-brand" : "mnau-brand";

        const storageInfo = parseStorageData(f.Speicher);
        let barColor = '#2ecc71'; 
        if (storageInfo.percentUsed >= 90) {
            barColor = '#e74c3c'; 
        } else if (storageInfo.percentUsed >= 70) {
            barColor = '#f1c40f'; 
        }

        const row = document.createElement('div');
        row.className = `ssd-row ${brandClass}`;
        row.innerHTML = `
            <div class="ssd-row-header">
                <div class="ssd-info-block">
                    <div class="ssd-row-title">${f.Name}</div>
                    <div class="ssd-row-meta">Speicher: ${f.Speicher || 'Keine Info'}</div>
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
            <details class="ssd-details">
                <summary>Ordnerstruktur einblenden</summary>
                <div class="ssd-folders-preview">${cleanFolders}</div>
            </details>
        `;
        content.appendChild(row);
    });
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
            logoImg.onerror = () => reject(new Error(`Logo ${selectedLogoFile} konnte nicht geladen werden.`));
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
                    const w1 = lCtx.measureText(line1).width;
                    const w2 = lCtx.measureText(line2).width;
                    if (w1 <= maxWidth && w2 <= maxWidth) break;
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

        if (bestLines.length === 2 && targetFontSize > 80) {
            targetFontSize = 80;
        }

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
        alert("Fehler beim Erstellen des PNG-Labels. Vergewissere dich, dass mnau_logo.svg und gecko_logo.svg im Stammordner liegen.");
        console.error(err);
    }
}