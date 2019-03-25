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

import * as sso from "./sso";
import { requestAsync } from "./requestAsync";
import * as CryptoJS from "crypto-js";

const settings = require('user-settings').file('.herecli');
const table = require("console.table");
// TODO this should go into env config as well
export const xyzRoot = () => "https://xyz.api.here.com";

export const keySeparator = "%%";

export let validated = false;

function rightsRequest(appId: string) {
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
    return new Promise<string>((resolve, reject) =>
        require('getmac').getMac(function (err: any, macAddress: string) {
            if (err)
                reject(err);
            else
                resolve(macAddress);
        })
    );
}

export async function login(authId: string, authSecret: string) {
    const { response, body } = await requestAsync({
        url: xyzRoot() + "/token-api/token?app_id=" + authId + "&app_code=" + authSecret + "&tokenType=PERMANENT",
        method: "POST",
        body: rightsRequest(authId),
        json: true,
    });

    if (response.statusCode !== 200)
        throw new Error("Failed to login: " + JSON.stringify(body));

    encryptAndStore('keyInfo', body.token);
    encryptAndStore('appDetails', authId + keySeparator + authSecret);

    console.log("Secrets verified successfully");
    return { response, authId, authSecret };
}

export async function hereAccountLogin(email: string, password: string) {
    //const response = await sso.getToken(email, password);
    const mainCookie = await sso.executeWithCookie(email, password);
    //const maxRights = await sso.fetchMaxRights(mainCookie);
    //const token = response.data.token;
    //encryptAndStore('keyInfo', token);
    encryptAndStore('accountInfo', email + keySeparator + password);
    console.log("Secrets verified successfully");
    return mainCookie;
}

export async function generateToken(mainCookie:string, appId : string) {
    const maxRights = await sso.fetchMaxRights(mainCookie);
    const token = await sso.fetchToken(mainCookie, maxRights, appId);
    encryptAndStore('keyInfo', token.token);
}

export async function getAppIds(cookies: string) {
    const options = {
        url: xyzRoot()+`/account-api/accounts/me`,
        method: 'GET',
        headers: {
            "Cookie": cookies
        }
    };
    const { response, body } = await requestAsync(options);
    if (response.statusCode !== 200)
        throw new Error("Error while fetching Apps: " + JSON.stringify(body));

    return body;
}

export async function updateDefaultAppId(cookies: string, accountId: string, appId: string, updateTC: boolean) {

        let options: any = {}
        options.url = xyzRoot()+`/account-api/accounts/${accountId}`;
        options.method = 'PATCH';
        options.headers = {
            "Cookie": cookies
        }
        options.json= true;
        options.body = {};
        options.body.defaultAppId = appId;
        if (updateTC) {
            options.body.tcAccepted = true;
        }
        const { response, body } = await requestAsync(options);
        if (response.statusCode !== 200)
            throw new Error("Error while fetching Apps: " + JSON.stringify(body));

        return body;
}

async function validateToken(token: string) {
    if (validated)
        return true;

    const { response, body } = await requestAsync({
        url: xyzRoot() + "/token-api/tokens/" + token,
        method: "GET",
        json: true,
    });

    if (response.statusCode !== 200) {
        console.log("Failed to login : " + JSON.stringify(body));
        throw new Error("Failed to log in");
    }

    validated = true;
    return response;
}

async function encryptAndStore(key: string, toEncrypt: string) {
    const secretKey = await getMacAddress();
    const ciphertext = CryptoJS.AES.encrypt(toEncrypt, secretKey);
    settings.set(key, ciphertext.toString());
}

export async function decryptAndGet(key: string, description?: string) {
    const keyInfo = settings.get(key);

    const secretKey = await getMacAddress();

    if (keyInfo) {
        const bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
        const token = bytes.toString(CryptoJS.enc.Utf8);
        return token;
    } else {
        const message = description ? description : "No appId/appCode found. Try running 'here configure'";
        throw new Error(message);
    }
}

export async function verify() {
    const keyInfo = settings.get('keyInfo');

    const secretKey = await getMacAddress();
    if (keyInfo) {
        const bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
        const token = bytes.toString(CryptoJS.enc.Utf8);
        await validateToken(token);
        return token;
    } else {
        const message = "No saved keyinfo found. Try running 'here configure set'";
        throw new Error(message);
    }
}

export function validate(commands: string[], args: string[], program: any) {
    if (!args || args.length === 0) {
        console.log("Invalid command 1 :");
        program.help();
    } else {
        if (args[0] == "help" || args[0] == "--help" || args[0] == "-h" || args[0] == "-help") {
            program.help();
        } else if (!commands.includes(args[0])) {
            console.log("Invalid command '" + args[0] + "'");
            program.help();
        }
    }
}

export function md5Sum(string: string) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(string).digest('hex');
}

export function timeStampToLocaleString(timeStamp: number) {
    const dt = new Date(timeStamp);
    return dt.toLocaleString(undefined, {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function drawTable(data: any, columns: any) {
    console.table(extractData(columns, data));
}

function extractData(fields: any, data: any) {
    const outArr = new Array();
    for (const i in data) {
        const obj: { [key: string]: any } = {};
        const cObj = data[i];
        for (const j in fields) {
            obj[fields[j]] = resolveObject(fields[j], cObj);
        }
        outArr.push(obj);
    }
    return outArr;
}

function resolveObject(path: any, obj: any) {
    return path.split('.').reduce(function (prev: any, curr: any) {
        return prev ? prev[curr] : undefined
    }, obj)
}

export function getSplittedKeys(inString: string) {
    if (inString.indexOf(keySeparator) != -1) {
        return inString.split(keySeparator);
    }

    //Backward support for old separator
    const tokens = inString.split("-");
    if (tokens.length === 2) {
        return tokens;
    } else {
        return null;
    }
}