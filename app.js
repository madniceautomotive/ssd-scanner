const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let lastUUID = "";
let isFetching = false;
let clearTimer = null;

// ----------------------------------------------------
// HIER STEHEN DEINE DATEN FELSENFEST IM CODE (Sicher im privaten Repo!)
const airtableToken = "pat4ytEWExJctNU62.59f8c764a353cf3d3571ea45e9d0d2e713e95a5a83499e97c5770f60850170b9";
const baseId = "appXKM0UQ8uJLuiNB";
const tableName = "SSDs";
// ----------------------------------------------------

navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(function(stream) {
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        video.play();
        document.getElementById('loading-overlay').style.display = 'none';
        requestAnimationFrame(tick);
    })
    .catch(function(err) {
        document.getElementById('loading-overlay').innerText = "Kamerazugriff verweigert oder nicht unterstützt.";
        console.error(err);
    });

function tick() {
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

    card.style.display = 'block';
    card.style.borderColor = '#00ffcc';
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
            card.style.borderColor = '#00ff00';
            setTimeout(() => { card.style.borderColor = '#00ffcc'; }, 600);
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

/* Manager Logik für Datenbank-Übersicht */
async function openManager() {
    const overlay = document.getElementById('manager-overlay');
    const content = document.getElementById('manager-content');
    overlay.style.display = 'flex';
    content.innerHTML = '<div style="color:#00ffcc; text-align:center; padding:20px;">Lade Airtable-Datenbank...</div>';

    try {
        const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
            headers: { Authorization: `Bearer ${airtableToken}` }
        });
        const data = await response.json();
        content.innerHTML = '';

        if (data.records && data.records.length > 0) {
            data.records.forEach(record => {
                const f = record.fields;
                if (!f.UUID || !f.Name) return;

                const cleanFolders = f.Ordner ? f.Ordner.split('\\n').filter(Boolean).join('\n') : '(Keine Ordner vorhanden)';

                const row = document.createElement('div');
                row.className = 'ssd-row';
                row.innerHTML = `
                    <div class="ssd-row-header">
                        <div class="ssd-info-block">
                            <div class="ssd-row-title">${f.Name}</div>
                            <div class="ssd-row-meta">Speicher: ${f.Speicher || 'Keine Info'}</div>
                        </div>
                        <div class="action-group">
                            <select id="logo-select-${f.UUID}" class="logo-select">
                                <option value="mnau_logo.svg">MNAU</option>
                                <option value="gecko_logo.svg">Gecko</option>
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
        } else {
            content.innerHTML = '<div style="text-align:center; color:#a0aec0;">Keine SSDs in Airtable gefunden.</div>';
        }
    } catch (error) {
        content.innerHTML = '<div style="text-align:center; color:#ff3333;">Fehler beim Laden von Airtable.</div>';
        console.error(error);
    }
}

function closeManager() {
    document.getElementById('manager-overlay').style.display = 'none';
}

/* HTML5 Off-Screen Canvas Label Generator - MIT SMARTEM WORT-UMBRUCH */
async function generateLabelPNG(name, uuid) {
    try {
        const selectedLogoFile = document.getElementById(`logo-select-${uuid}`).value;
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
        downloadLink.download = `MNAU_Label_${name.replace(/\s+/g, '_')}.png`;
        downloadLink.href = labelCanvas.toDataURL('image/png');
        downloadLink.click();

    } catch (err) {
        alert("Fehler beim Erstellen des PNG-Labels. Vergewissere dich, dass mnau_logo.svg und gecko_logo.svg im Stammordner auf GitHub liegen.");
        console.error(err);
    }
}