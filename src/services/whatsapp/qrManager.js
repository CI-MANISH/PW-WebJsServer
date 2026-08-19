const QRCode = require('qrcode');

async function generate(qrString) {
    return await QRCode.toDataURL(
        qrString
    );
}

module.exports = { generate };