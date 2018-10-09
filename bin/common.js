/*
  Copyright (C) 2018 HERE Europe B.V.
  SPDX-License-Identifier: MIT
  
  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/



var settings = require('user-settings').file('.herecli');
var request = require('request');
var table = require("console.table");
var sso = require("./sso");
// TODO this should go into env config as well
var xyzRoot = "https://xyz.api.here.com"; 

var keySeparator = "%%";

var rightsRequest = function(appId){
    return {
        "urm": {
          "xyz-hub": {
            "createFeatures": [
              {
                "owner": appId
              }
            ],
            "manageSpaces": [
              {
                "owner": appId
              }
            ],
            "readFeatures": [
              {
                "owner": appId
              }
            ],
            "updateFeatures": [
              {
                "owner": appId
              }
            ],
            "deleteFeatures": [
              {
                "owner": appId
              }
            ]
          }
        }
      }
}
var login = function(authId, authSecret, onSuccess, onFailure) {
    request({
        url: xyzRoot + "/token-api/token?app_id="+authId+"&app_code="+authSecret+"&tokenType=PERMANENT",
        method: "POST",
        body: rightsRequest(authId),
        json: true,

    }, function (error, response, body) {
        var statusCode = response && response.statusCode;
        if (statusCode != 200) {
            console.log("Failed to login : " + JSON.stringify(body));
            if (onFailure)
                onFailure(response, authId, authSecret);
        } else {
            encryptAndStore('keyInfo',body.token);
            encryptAndStore('appDetails',authId+keySeparator+authSecret);
            if (onSuccess)
                onSuccess(response, authId, authSecret);
            else
                console.log("Secrets verified successfully");
        }
    });
}

var hereAccountLogin = function(email, password,onSuccess, onFailure) {
    sso.getToken(email,password).then(token=>{
        encryptAndStore('keyInfo',token);
        encryptAndStore('accountInfo',email+keySeparator+password);
        if (onSuccess)
            onSuccess(response, email, password);
        else
            console.log("Secrets verified successfully");
    }).catch(function(error) {
        console.log("Failed to login:"+error);
    });
}


var validateToken = function(token,onSuccess, onFailure) {
    if(module.exports.validated){
        onSuccess({},token);
    }else{
        request({
            url: xyzRoot + "/token-api/token?access_token="+token,
            method: "GET",
            json: true,

        }, function (error, response, body) {
            var statusCode = response && response.statusCode;
            if (statusCode != 200) {
                console.log("Failed to login : " + JSON.stringify(body));
                if (onFailure)
                    onFailure(response,token);
            } else {
                if (onSuccess){
                    module.exports.validated=true;
                    onSuccess(response,token);
                }else
                    console.log("Secrets verified successfully");
            }
        });
    }
}

function encryptAndStore(key,toEncrypt) {
    require('getmac').getMac(function (err, macAddress) {
        if (err) throw err
        secretKey = macAddress;
        var CryptoJS = require("crypto-js");
        var ciphertext = CryptoJS.AES.encrypt(toEncrypt, secretKey);
        settings.set(key, ciphertext.toString());
    });
}

function decryptAndGet(key,description){
    var CryptoJS = require("crypto-js");
    var keyInfo = settings.get(key);
    return new Promise(
        function (resolve, reject) {
            require('getmac').getMac(function (err, macAddress) {
                if (err) throw err
                secretKey = macAddress;
                if (keyInfo) {
                    var bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
                    var token = bytes.toString(CryptoJS.enc.Utf8);
                    resolve(token);
                } else {
                    var message = (description)? description : "No appId/appCode found. Try running 'here configure'";
                    var reason = new Error(message);
                    reject(reason); 
                }
            });
        }
    );
    
}

var verify = function(onSuccess, onFailure) {
    var CryptoJS = require("crypto-js");
    var keyInfo = settings.get('keyInfo');
    require('getmac').getMac(function (err, macAddress) {
        if (err) throw err
        secretKey = macAddress;
        if (keyInfo) {
            var bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
            var token = bytes.toString(CryptoJS.enc.Utf8);
            //var keyTokens = plaintext.split(" ");
            validateToken(token, onSuccess, onFailure);
        } else {
            var message = "No saved keyinfo found. Try running 'here configure set'";
            console.log(message);
            if(onFailure) onFailure(message);
            process.exit(1);
        }
    });
}
var validate = function(commands,args,program){
    if (!args || args.length === 0){
          console.log("Invlid command 1 :");
          program.help();
    }else {
      if(args[0]=="help" || args[0]=="--help" || args[0]=="-h" || args[0]=="-help"){
          program.help();
      }else if(!commands.includes(args[0])){
          console.log("invalid command '"+args[0]+"'");
          program.help();
      }
    }
}

var md5Sum=function(string) {
    var crypto = require('crypto');
    return crypto.createHash('md5').update(string).digest('hex');
}
var timeStampToLocaleString = function(timeStamp){
    var dt = new Date(timeStamp);
    return dt.toLocaleString(undefined, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}
function drawTable(data, columns) {
    console.table(extractData(columns, data));
}
function extractData(fields, data) {
    var outArr = new Array();
    for (var i in data) {
      var obj = new Object();
      var cObj = data[i];
      for (var j in fields) {
        obj[fields[j]] = Object.resolve(fields[j], cObj);
      }
      outArr.push(obj);
    }
    return outArr;
}

function getSplittedKeys(inString){
    if(inString.indexOf(keySeparator)!=-1){
        return inString.split(keySeparator);
    }else {
        //Backward support for old separator
        const tokens = inString.split("-");
        if(tokens.length==2){
            return tokens;
        }else{
            return null;
        }
    }
}
module.exports.drawTable = drawTable;
module.exports.timeStampToLocaleString = timeStampToLocaleString;
module.exports.md5Sum = md5Sum;
module.exports.validate = validate;
module.exports.login = login;
module.exports.verify = verify;
module.exports.decryptAndGet=decryptAndGet;
module.exports.encryptAndStore=encryptAndStore;
module.exports.hereAccountLogin=hereAccountLogin;
module.exports.keySeparator=keySeparator;
module.exports.getSplittedKeys=getSplittedKeys;
module.exports.xyzRoot = function() {return xyzRoot}

