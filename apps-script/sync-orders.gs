// ==== Configuration — the same for every shop, set once in this template ====
var API_URL = "https://your-app-domain.com/api/orders"; // production OrderHub URL
var API_SECRET = "PASTE_API_SECRET_HERE";                // must match API_SECRET in .env.local

// Shop name/platform are NOT hardcoded here — they're written into the
// "Config" tab automatically when /shops/new provisions this spreadsheet,
// so nothing needs editing per shop. See getShopConfig() below.

// Column layout on the "Orders" tab — row 1 is the header, data starts at row 2.
// Column H (Synced) is written by this script; don't edit it by hand.
var COL = {
  CUSTOMER_NAME: 1,    // A
  CUSTOMER_PHONE: 2,   // B
  CUSTOMER_CITY: 3,    // C
  CUSTOMER_ADDRESS: 4, // D
  PRODUCT: 5,          // E
  QUANTITY: 6,         // F
  PRICE: 7,            // G
  SYNCED: 8            // H
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("OrderHub")
    .addItem("Send Orders to OrderHub", "sendOrdersToOrderHub")
    .addToUi();
}

function getShopConfig() {
  var configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Config");
  return {
    shopName: configSheet.getRange("B1").getValue(),
    platform: configSheet.getRange("B2").getValue()
  };
}

function sendOrdersToOrderHub() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var sheetName = sheet.getName();
  var config = getShopConfig();
  var data = sheet.getDataRange().getValues();

  for (var row = 1; row < data.length; row++) { // skip header row
    var rowNumber = row + 1;
    var synced = data[row][COL.SYNCED - 1];

    if (synced === "Yes") continue; // already sent, skip

    var payload = {
      platform: config.platform,
      shop_name: config.shopName,
      sheet_id: sheetId,
      sheet_name: sheetName,
      customer_name: data[row][COL.CUSTOMER_NAME - 1],
      customer_phone: data[row][COL.CUSTOMER_PHONE - 1],
      customer_city: data[row][COL.CUSTOMER_CITY - 1],
      customer_address: data[row][COL.CUSTOMER_ADDRESS - 1],
      product: data[row][COL.PRODUCT - 1],
      quantity: data[row][COL.QUANTITY - 1],
      price: data[row][COL.PRICE - 1]
    };

    var options = {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": API_SECRET },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      var response = UrlFetchApp.fetch(API_URL, options);
      var status = response.getResponseCode();

      if (status === 200) {
        sheet.getRange(rowNumber, COL.SYNCED).setValue("Yes");
      } else {
        sheet.getRange(rowNumber, COL.SYNCED).setValue("Error: " + status);
        Logger.log("Row " + rowNumber + " failed (" + status + "): " + response.getContentText());
      }
    } catch (err) {
      sheet.getRange(rowNumber, COL.SYNCED).setValue("Error: " + err.message);
      Logger.log("Row " + rowNumber + " network error: " + err.message);
    }
  }
}
