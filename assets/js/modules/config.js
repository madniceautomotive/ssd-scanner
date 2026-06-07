// Zentrale Master-Konfiguration für die Database und Hardware
export const airtableToken = "pat4ytEWExJctNU62.59f8c764a353cf3d3571ea45e9d0d2e713e95a5a83499e97c5770f60850170b9";
export const baseId = "appXKM0UQ8uJLuiNB";
export const tableName = "SSDs";

export const cameraConstraints = {
    video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
    },
    audio: false
};