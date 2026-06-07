import { airtableToken, baseId, tableName, cameraConstraints } from './config.js';
import { cleanStorageUnits, parseStorageData, generateFolderHTML } from './helpers.js';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

let lastUUID = "";
let isFetching = false;
let clearTimer = null;
let cameraStream = null;
let isScannerActive = false;
let updateDashboardCallback = null; // Callback für das lautlose Update nach dem Schließen

/* Registriert den Dashboard-Refresher beim Booten */
export function setupScanner(onCloseCallback) {
    updateDashboardCallback = onCloseCallback;
}

export function openScanner() {
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

export function closeScanner() {
    isScannerActive = false;
    document.getElementById('scanner-overlay').classList.remove('active');
    document.getElementById('ar-card').classList.remove('active');

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    lastUUID = "";

    // Ruft das lautlose Dashboard-Update im Hintergrund auf
    if (updateDashboardCallback) updateDashboardCallback();
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

        // Greift auf die globale jsQR-Bibliothek aus dem CDN zu
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
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

            // Der phasenverschobene Stagger-Effekt für seidenweiche Animationen im Kamera-HUD
            if (arStorageBar) {
                arStorageBar.style.backgroundColor = barColor;
                arStorageBar.style.width = '0%';

                setTimeout(() => {
                    arStorageBar.style.transition = 'width 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
                    arStorageBar.style.width = `${storageInfo.percentUsed}%`;
                }, 350);
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