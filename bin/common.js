"use strict";
/*
  Copyright (C) 2018 - 2019 HERE Europe B.V.
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const sso = require("./sso");
const requestAsync_1 = require("./requestAsync");
const CryptoJS = require("crypto-js");
const settings = require('user-settings').file('.herecli');
const table = require("console.table");
// TODO this should go into env config as well
exports.xyzRoot = () => "https://xyz.api.here.com";
exports.keySeparator = "%%";
exports.validated = false;
function rightsRequest(appId) {
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
    };
}
function getMacAddress() {
    return new Promise((resolve, reject) => require('getmac').getMac(function (err, macAddress) {
        if (err)
            reject(err);
        else
            resolve(macAddress);
    }));
}
function login(authId, authSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const { response, body } = yield requestAsync_1.requestAsync({
            url: exports.xyzRoot() + "/token-api/token?app_id=" + authId + "&app_code=" + authSecret + "&tokenType=PERMANENT",
            method: "POST",
            body: rightsRequest(authId),
            json: true,
        });
        if (response.statusCode !== 200)
            throw new Error("Failed to login: " + JSON.stringify(body));
        encryptAndStore('keyInfo', body.token);
        encryptAndStore('appDetails', authId + exports.keySeparator + authSecret);
        console.log("Secrets verified successfully");
        return { response, authId, authSecret };
    });
}
exports.login = login;
function hereAccountLogin(email, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const token = yield sso.getToken(email, password);
        encryptAndStore('keyInfo', token);
        encryptAndStore('accountInfo', email + exports.keySeparator + password);
        console.log("Secrets verified successfully");
        return token;
    });
}
exports.hereAccountLogin = hereAccountLogin;
function validateToken(token) {
    return __awaiter(this, void 0, void 0, function* () {
        if (exports.validated)
            return true;
        const { response, body } = yield requestAsync_1.requestAsync({
            url: exports.xyzRoot() + "/token-api/token?access_token=" + token,
            method: "GET",
            json: true,
        });
        if (response.statusCode !== 200) {
            console.log("Failed to login : " + JSON.stringify(body));
            throw new Error("Failed to log in");
        }
        exports.validated = true;
        return response;
    });
}
function encryptAndStore(key, toEncrypt) {
    return __awaiter(this, void 0, void 0, function* () {
        const secretKey = yield getMacAddress();
        const ciphertext = CryptoJS.AES.encrypt(toEncrypt, secretKey);
        settings.set(key, ciphertext.toString());
    });
}
function decryptAndGet(key, description) {
    return __awaiter(this, void 0, void 0, function* () {
        const keyInfo = settings.get(key);
        const secretKey = yield getMacAddress();
        if (keyInfo) {
            const bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
            const token = bytes.toString(CryptoJS.enc.Utf8);
            return token;
        }
        else {
            const message = description ? description : "No appId/appCode found. Try running 'here configure'";
            throw new Error(message);
        }
    });
}
exports.decryptAndGet = decryptAndGet;
function verify() {
    return __awaiter(this, void 0, void 0, function* () {
        const keyInfo = settings.get('keyInfo');
        const secretKey = yield getMacAddress();
        if (keyInfo) {
            const bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
            const token = bytes.toString(CryptoJS.enc.Utf8);
            yield validateToken(token);
            return token;
        }
        else {
            const message = "No saved keyinfo found. Try running 'here configure set'";
            throw new Error(message);
        }
    });
}
exports.verify = verify;
function validate(commands, args, program) {
    if (!args || args.length === 0) {
        console.log("Invalid command 1 :");
        program.help();
    }
    else {
        if (args[0] == "help" || args[0] == "--help" || args[0] == "-h" || args[0] == "-help") {
            program.help();
        }
        else if (!commands.includes(args[0])) {
            console.log("Invalid command '" + args[0] + "'");
            program.help();
        }
    }
}
exports.validate = validate;
function md5Sum(string) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(string).digest('hex');
}
exports.md5Sum = md5Sum;
function timeStampToLocaleString(timeStamp) {
    const dt = new Date(timeStamp);
    return dt.toLocaleString(undefined, {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
exports.timeStampToLocaleString = timeStampToLocaleString;
function drawTable(data, columns) {
    console.table(extractData(columns, data));
}
exports.drawTable = drawTable;
function extractData(fields, data) {
    const outArr = new Array();
    for (const i in data) {
        const obj = {};
        const cObj = data[i];
        for (const j in fields) {
            obj[fields[j]] = resolveObject(fields[j], cObj);
        }
        outArr.push(obj);
    }
    return outArr;
}
function resolveObject(path, obj) {
    return path.split('.').reduce(function (prev, curr) {
        return prev ? prev[curr] : undefined;
    }, obj);
}
function getSplittedKeys(inString) {
    if (inString.indexOf(exports.keySeparator) != -1) {
        return inString.split(exports.keySeparator);
    }
    //Backward support for old separator
    const tokens = inString.split("-");
    if (tokens.length === 2) {
        return tokens;
    }
    else {
        return null;
    }
}
exports.getSplittedKeys = getSplittedKeys;
