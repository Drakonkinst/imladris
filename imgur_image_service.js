import fetch from "node-fetch";

const ImgurImageService = (() => {
    const ENDPOINT_URL = "https://api.imgur.com/3/";
    const CLIENT_ID_PREFIX = "Client-ID ";
    const IMAGE_TYPES = [ "file", "base64", "url" ];
    
    // Don't actually need this function since Content-Type is set to JSON
    function stringify(obj, assignChar, separatorChar) {
        assignChar = assignChar || "=";
        separatorChar = separatorChar || ";";
        
        let result = "";
        
        for(let k in obj) {
            if(obj.hasOwnProperty(k)) {
                if(result.length > 0) {
                    result += separatorChar;
                }
                result += k + assignChar + obj[k];
            }
        }
        
        return result;
    }
    
    // Returns a JSON response
    async function sendRequest(url, request, callback) {
        callback = callback || function() {};
        
        try {
            const response = await fetch(ENDPOINT_URL + url, request);
            const json = await response.json();
            callback(json);
        } catch(error) {
            console.log(error);
        }
    }
    
    return class ImgurImageService {
        constructor(clientId) {
            this.clientId = clientId;
        }
        
        uploadImage(type, data, callback) {
            if(!IMAGE_TYPES.includes(type)) {
                console.log("Error: Image type not supported. Must be \"file\", \"base64\", or \"url\"");
                return null;
            }
            
            const request = {
                method: "POST",
                headers: {
                    "Authorization": CLIENT_ID_PREFIX + this.clientId,
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "type": type,
                    "image": data
                })
            };
            
            sendRequest("image", request, callback);
        }
        
        deleteImage(deleteHash, callback) {
            const request = {
                method: "DELETE",
                headers: {
                    "Authorization": CLIENT_ID_PREFIX + this.clientId,
                    "Accept": "application/json"
                }
            }
            
            sendRequest("image/" + deleteHash, request, callback);
        }
    };
})();

export { ImgurImageService };