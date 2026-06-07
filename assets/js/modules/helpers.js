/* Berechtigt Einheiten: Wandelt kryptische Angaben wie 'Ti'/'Gi' in allgemein verständliche Kürzel ('TB'/'GB') um */
export function cleanStorageUnits(speicherStr) {
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
export function parseStorageData(speicherStr) {
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

/* Ordner-Parser mit intelligenter Vorsortierung UND digitalem Müll-Filter */
export function generateFolderHTML(ordnerStr, company, searchTerm = "") {
    if (!ordnerStr || ordnerStr.trim() === "" || ordnerStr.includes("(Leer)")) {
        return '<div class="no-folders">Keine Ordner vorhanden</div>';
    }

    const folderArray = ordnerStr.split(/\\n|\n/).filter(Boolean).map(f => f.trim());
    if (folderArray.length === 0) return '<div class="no-folders">Keine Ordner vorhanden</div>';

    // System-Müll-Filter (.DS_Store, Windows Papierkörbe und Geisterordner blockieren)
    const exactBlacklist = ['desktop.ini', 'thumbs.db'];
    const partialBlacklist = ['system volume information', 'recycle.bin', 'fseventsd', 'spotlight-v100'];

    const filteredArray = folderArray.filter(folder => {
        const lower = folder.toLowerCase();
        if (lower.startsWith('.') || lower.startsWith('$')) return false;
        if (exactBlacklist.includes(lower)) return false;
        if (partialBlacklist.some(junk => lower.includes(junk))) return false;
        return true;
    });

    if (filteredArray.length === 0) {
        return '<div class="no-folders">Keine Ordner vorhanden</div>';
    }

    // 1. Ordner in strukturierte Objekte mit Match-Status überführen
    const folderObjects = filteredArray.map(folder => {
        return {
            name: folder,
            isMatched: searchTerm !== "" && folder.toLowerCase().includes(searchTerm)
        };
    });

    // 2. DYNAMISCHE CHIP-SORTIERUNG: Gefundene Ordner (isMatched === true) nach ganz oben schieben (Hoisting)
    folderObjects.sort((a, b) => {
        if (a.isMatched && !b.isMatched) return -1;
        if (!a.isMatched && b.isMatched) return 1;
        return 0;
    });

    const iconColor = company === "Gecko" ? "#29ABE2" : "#00663a";

    // 3. HTML generieren basierend auf der neuen, gesäuberten und sortierten Liste
    return folderObjects.map((folderObj, index) => {
        const isMatched = folderObj.isMatched;
        const highlightClass = isMatched ? "highlighted-folder" : "";

        return `
            <div class="folder-item ${highlightClass}" style="animation-delay: ${index * 0.03}s;">
                <svg class="folder-icon" style="fill: ${isMatched ? (company === 'Gecko' ? '#121212' : '#ffffff') : iconColor};" viewBox="0 0 24 24">
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                <span class="folder-name">${folderObj.name}</span>
            </div>
        `;
    }).join('');
}