/* Off-Screen Canvas Label Generator mit intelligentem Textumbruch */
export async function generateLabelPNG(name, uuid) {
    try {
        const selectedCompany = document.getElementById(`logo-select-${uuid}`).value;
        const selectedLogoFile = selectedCompany === "Gecko" ? "assets/img/gecko_logo.svg" : "assets/img/mnau_logo.svg";
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
            logoImg.onerror = () => reject(new Error(`Logo fehlt: ${selectedLogoFile}`));
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