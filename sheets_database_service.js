import { google } from "googleapis"

const SheetsDatabaseService = (() => {
    const NUM_LETTERS = 26;
    const CHAR_A = 65;
    const STARTING_COLUMN = "A";
    
    // https://stackoverflow.com/questions/181596/how-to-convert-a-column-number-e-g-127-into-an-excel-column-e-g-aa
    function getExcelColumnName(columnNumber) {
        if(columnNumber <= 0) {
            return null;
        }

        let columnName = "";
        
        while(columnNumber > 0) {
            let modulo = (columnNumber - 1) % NUM_LETTERS;
            columnName = String.fromCharCode(modulo + CHAR_A) + columnName;
            columnNumber = Math.floor((columnNumber - modulo) / NUM_LETTERS);
        }
        
        return columnName;
    }
    
    return class SheetsDatabaseService {
        constructor(apiSecret, spreadsheetId, startingRow, columns) {
            this.spreadsheetId = spreadsheetId;
            this.jwtClient = new google.auth.JWT(
                apiSecret.client_email,
                null,
                apiSecret.private_key,
                ["https://www.googleapis.com/auth/spreadsheets"]);
            this.jwtClient.authorize((err, tokens) => {
                if(err) {
                    console.log(err);
                } else {
                    console.log("Successfully connected to Google Sheets API!");
                }
            });
            this.sheets = google.sheets("v4");
            this.columns = columns;
            this.startingRow = startingRow;
            this.dataRange = STARTING_COLUMN + startingRow + ":" + getExcelColumnName(this.columns.length);
        }
        
        displayAllData() {
            this.sheets.spreadsheets.values.get({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "range": this.dataRange
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    for(let row of response.data.values) {
                        console.log(row);
                    }
                }
            });
        }
        
        fetchDatabase(callback) {
            this.sheets.spreadsheets.values.get({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "range": this.dataRange
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    callback(response.data.values);
                }
            });
        }
        
        addEntry(rowArr) {
            if(rowArr.length > this.columns.length) {
                console.log("Error: Database only supports up to " + this.columns.length + " columns");
                return;
            }
            
            this.sheets.spreadsheets.values.append({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "range": this.dataRange,
                "valueInputOption": "RAW",
                "resource": {
                    "values": [ rowArr ]
                }
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    console.log("Updated " + response.data.updates.updatedCells + " cells");
                }
            });
        }
        
        // If firstOnly is false, returns a list instead
        getMatchingRows(columnName, filter, callback, firstOnly) {
            if(!this.columns.includes(columnName)) {
                console.log("Error: Database does not contain matching column \"" + columnName + "\"");
                return;
            }
            const columnIndex = this.columns.indexOf(columnName);
            const self = this;
            
            this.sheets.spreadsheets.values.get({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "range": this.dataRange
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    let rowIndex = self.startingRow - 1;
                    let matchingIndices = [];
                    let matchingRows = [];
                    for(let row of response.data.values) {
                        ++rowIndex;
                        if(columnIndex >= row.length) {
                            continue;
                        }
                        const columnValue = row[columnIndex];
                        if(filter(columnValue)) {
                            if(firstOnly) {
                                callback([ rowIndex ], [ row ]);
                                break;
                            }
                            matchingIndices.push(rowIndex);
                            matchingRows.push(row);
                        }
                    }
                    
                    if(!firstOnly) {
                        callback(matchingIndices, matchingRows);
                    }
                }
            });
        }
        
        updateRows(rowIndices, rowValues, callback) {
            if(rowIndices.length !== rowValues.length) {
                console.log("Error: Row indices length must match row values length");
                return;
            }

            const lastColumn = getExcelColumnName(this.columns.length);
            const updates = [];
            for(let i = 0; i < rowIndices.length; ++i) {
                const rowIndex = rowIndices[i];
                const rowValue = rowValues[i];
                
                if(rowValue.length !== this.columns.length) {
                    console.log("Error: Skipping row index " + rowIndex + " since it has an incorrect number of columns");
                    continue;
                }
                
                updates.push({
                    "range": STARTING_COLUMN + rowIndex + ":" + lastColumn + rowIndex,
                    "values": [ rowValue ]
                });
            }
            
            this.sheets.spreadsheets.values.batchUpdate({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "resource": {
                    "valueInputOption": "RAW",
                    "data": updates
                }
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    console.log(response.data)
                }
            });
        }
        
        deleteRows(rowIndices) {
            if(rowIndices.length <= 0) {
                console.log("Warning: Row indices list is empty");
                return;
            }
            // Ensure inverse order
            rowIndices = rowIndices.sort().reverse();
            
            const requestList = [];
            
            for(let rowIndex of rowIndices) {
                console.log("Deleting " + rowIndex + ", " + (rowIndex + 1));
                requestList.push({
                    "deleteDimension": {
                        "range": {
                            //"sheetId": this.spreadsheetId,
                            "dimension": "ROWS",
                            "startIndex": rowIndex - 1,
                            "endIndex": rowIndex
                        }
                    }
                });
            }
            
            this.sheets.spreadsheets.batchUpdate({
                "auth": this.jwtClient,
                "spreadsheetId": this.spreadsheetId,
                "resource": {
                    "requests": requestList
                }
            }, (err, response) => {
                if(err) {
                    console.log("Error: Google Sheets API returned an error: " + err);
                } else {
                    console.log(response.data);
                }
            });
        }
        
        // TODO: operation for a single row/update
        
        getDataRange() {
            return this.dataRange;
        }
    };
    
    
})();

export { SheetsDatabaseService };