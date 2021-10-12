import { ImgurImageService } from "./imgur_image_service.js";
import { SheetsDatabaseService } from "./sheets_database_service.js";
import { v4 as uuidv4 } from "uuid"
import { fileURLToPath } from "url";
import * as fs from "fs";

const ImladrisService = (() => {
    const ALLOWED_TYPES = [ "link", "image" ];
    const COLUMNS = ["Id", "Link", "Type", "Name", "Tags", "Description"];
    const ID_INDEX = COLUMNS.indexOf("Id");
    const LINK_INDEX = COLUMNS.indexOf("Link");
    const TYPE_INDEX = COLUMNS.indexOf("Type");
    const NAME_INDEX = COLUMNS.indexOf("Name");
    const TAGS_INDEX = COLUMNS.indexOf("Tags");
    const DESCRIPTION_INDEX = COLUMNS.indexOf("Description");
    const CACHE_EXPIRY_TIME = 30 * 1000;
    
    const DEFAULT_STARTING_ROW = 2;
    const CONFIG_PATH = "./config.json";

    function getColumnEntry(data, row, column) {
        if(data.length > row) {
            const rowArr = data[row];
            if(rowArr.length > column) {
                let cell = rowArr[column];
                if(cell != null && cell.length > 0) {
                    return rowArr[column];
                }
            }
        }
        return null;
    }

    function getEntryObj(data, row) {
        const obj = {};
        if(data.length > row) {
            const rowArr = data[row];
            if(rowArr.length >= COLUMNS.length) {
                for(let i = 0; i < COLUMNS.length; ++i) {
                    obj[COLUMNS[i]] = rowArr[i];
                }
            }
        }
        return obj;
    }
    
    function getId(data, index) {
        return getColumnEntry(data, index, ID_INDEX);
    }

    function getLink(data, index) {
        return getColumnEntry(data, index, LINK_INDEX);
    }

    function getName(data, index) {
        return getColumnEntry(data, index, NAME_INDEX);
    }

    function getTags(data, index) {
        const str = getColumnEntry(data, index, TAGS_INDEX);
        if(str != null) {
            return str.toLowerCase().split(",");
        }
        return null;
    }

    function getDescription(data, index) {
        return getColumnEntry(data, index, DESCRIPTION_INDEX);
    }

    function getType(data, index) {
        return getColumnEntry(data, index, TYPE_INDEX);
    }
    
    return class ImladrisService {
        constructor() {
            this.config = JSON.parse(fs.readFileSync(CONFIG_PATH).toString());
            this.imageService = new ImgurImageService(this.config.imgurAPI_ClientID);
            this.databaseService = new SheetsDatabaseService(
                this.config.googleAPI_Secret,
                this.config.googleAPI_SpreadsheetId,
                DEFAULT_STARTING_ROW,
                COLUMNS);
            this.cachedData = null;
            this.idToIndex = null;
            this.lastIndexTimestamp = -999;
        }
        
        addItem(link, type, name, tags, description) {
            // Validate type
            if(type == null) {
                console.log("Error: Type cannot be null");
                return;
            }
            
            type = type.toLowerCase();
            if(!ALLOWED_TYPES.includes(type)) {
                console.log("Error: Unsupported type \"" + type + "\"");
            }

            // Name defaults to link
            name = name || link;
            
            let id = uuidv4();
            let tagStr = null;
            if(tags != null) {
                tagStr = tags.join(",");
            }
            this.databaseService.addEntry([ id, link, type, name, tagStr, description ]);
        }
        
        // Returns true if database is already refreshed, false if it is updating
        refreshDatabase(forceUpdate, callback) {
            const currentTime = Date.now();
            if(!!forceUpdate
                    || this.cachedData == null
                    || currentTime > this.lastIndexTimestamp + CACHE_EXPIRY_TIME) {
                this.reindexDatabase(callback);
                this.lastIndexTimestamp = currentTime;
                return false;
            }
            
            callback();
            return true;
        }
        
        reindexDatabase(callback) {
            const self = this;
            this.databaseService.fetchDatabase(data => {
                console.log("Reindexing database");
                self.cachedData = [];
                self.idToIndex = {};
                self.tagToIndexList = {};
                
                let index = 0;
                for(let i = 0; i < data.length; ++i) {

                    let id = getId(data, i);
                    if(id == null) {
                        console.log("Warning: Skipping invalid row " + (i + DEFAULT_STARTING_ROW) + " since it has no id");
                        continue;
                    }
                    
                    let link = getLink(data, i);
                    let type = getType(data, i);
                    let name = getName(data, i);
                    let tags = getTags(data, i);
                    let description = getDescription(data, i);
                    
                    self.cachedData.push({ id, link, type, name, tags, description });
                    
                    if(self.idToIndex.hasOwnProperty(id)) {
                        console.log("Warning: Duplicate id found \"" + id + "\" on row " + (i + DEFAULT_STARTING_ROW));
                    }
                    self.idToIndex[id] = index;
                    
                    if(tags != null) {
                        for(let tag of tags) {
                            if(!self.tagToIndexList.hasOwnProperty(tag)) {
                                self.tagToIndexList[tag] = [];
                            }
                            self.tagToIndexList[tag].push(index);
                        }
                    }
                    
                    ++index;
                }
                
                if(callback) {
                    callback();
                }
            });
        }
        
        getItemById(id, callback, forceUpdate) {
            return this.refreshDatabase(forceUpdate, () => {
                callback(this.getCachedItemById(id));
            });
        }
        
        getCachedItemById(id) {
            if(this.cachedData == null) {
                console.log("Error: No data cached");
                return null;
            }
            
            if(!this.idToIndex.hasOwnProperty(id)) {
                console.log("Error: ID does not exist in database");
                return null;
            }
            
            const index = this.idToIndex[id];
            if(index < 0 || index >= this.cachedData.length) {
                console.log("Error: Internal index " + index + " is invalid");
                return null;
            }
            const data = this.cachedData[index];
            return data;
        }
        
        filterItems(key, filter, callback, firstOnly) {
            this.databaseService.getMatchingRows(key, filter, (rowIndices, rowValues) => {
                callback(rowIndices, rowValues);
            }, firstOnly);
        }
        
        updateItems(key, filter, mutator, firstOnly) {
            this.databaseService.getMatchingRows(key, filter, (rowIndices, rowValues) => {
                const mutatedRows = [];
                
                for(let row of rowValues) {
                    mutatedRows.push(mutator(row));
                }
                
                this.databaseService.updateRows(rowIndices, mutatedRows);
            }, firstOnly);
        }
        
        deleteItems(key, filter, callback, firstOnly) {
            this.databaseService.getMatchingRows(key, filter, (rowIndices, rowValues) => {
                callback(result);
            }, firstOnly);
        }
        
        printDatabase() {
            this.databaseService.displayAllData();
        }
    }
})();

// Wrapper function to return null if it does not exist
function nullableAtIndex(arr, index) {
    if(index >= arr.length) {
        return null;
    }
    return arr[index];
}

function setAtIndex(arr, index, value, emptyValue) {
    if(emptyValue == null) {
        emptyValue = "";
    }

    while(index >= arr.length) {
        arr.push(emptyValue);
    }

    arr[index] = value;
    
    return arr;
}

if(process.argv[1] === fileURLToPath(import.meta.url)) {
    let imladrisService = new ImladrisService();
    
    /*
    imladrisService.filterItems("Id", id => true, rowList => {
        console.log(rowList);
    }, false);*/
    
    imladrisService.updateItems("Id", id => true, row => {
        return setAtIndex(row, 3, "Boomer");
    });
    
    //imladrisService.addItem("google.com", "link", "Google", ["google", "hello world"], "description");
    //imladrisService.printDatabase();
    //imladrisService.reindexDatabase();
    
    /*
    let caching = imladrisService.getItemById("80da3529-d102-4709-9ae6-75ca7232a543", data => {
        console.log("DATA1");
        console.log(data);
        
    });
    console.log("Caching: " + caching);
    
    let caching2 = imladrisService.getItemById("80da3529-d102-4709-9ae6-75ca7232a543", data2 => {
        console.log("DATA2");
        console.log(data2);
    });
    console.log("Caching2: " + caching2);*/
    
    
    /*
    console.log("Uploading image...")
    imageService.uploadImage("url", "https://picsum.photos/200", uploadResponse => {
        console.log("Image uploaded!");
        console.log(uploadResponse.status);
        console.log(uploadResponse.success);
        console.log(uploadResponse.data);
        console.log("Deleting image...");
        imageService.deleteImage(uploadResponse.data.deletehash, deleteResponse => {
            console.log("Deleted image! Status: " + deleteResponse.status);
        });
    });*/
}
