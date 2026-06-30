const { google } = require('googleapis');

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT env var not set');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

async function createInventorySheet(storeOwnerEmail, storeName) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  // Create spreadsheet
  const { data } = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${storeName} — CigarBuddy Inventory` },
      sheets: [{
        properties: {
          title: 'Inventory',
          gridProperties: { frozenRowCount: 1 },
        },
      }],
    },
  });

  const spreadsheetId = data.spreadsheetId;

  // Write header + two example rows
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Inventory!A1:E4',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        ['Brand', 'Cigar Name', 'Size', 'Price', 'Qty (leave blank = unknown count)'],
        ['--- DELETE THESE EXAMPLE ROWS ---', '', '', '', ''],
        ['Arturo Fuente', 'Gran Reserva', 'Robusto', '12.50', '10'],
        ['Padron', '1926 Serie', 'No. 9', '28.00', ''],
      ],
    },
  });

  // Bold headers + amber-ish background
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                backgroundColor: { red: 0.33, green: 0.2, blue: 0.04 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        // Auto-resize all columns
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 5 },
          },
        },
      ],
    },
  });

  // Share with store owner as editor
  if (storeOwnerEmail) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { type: 'user', role: 'writer', emailAddress: storeOwnerEmail },
      sendNotificationEmail: true,
    });
  }

  // Make publicly viewable so the server can fetch the CSV
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'anyone', role: 'reader' },
  });

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

module.exports = { createInventorySheet };
