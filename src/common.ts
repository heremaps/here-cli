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
import * as inquirer from 'inquirer';

import {table,getBorderCharacters} from 'table';

const fs = require('fs');
const path = require('path');

const settings = require('user-settings').file('.herecli');
const tableConsole = require("console.table");
//const tableNew = require("table");

// TODO this should go into env config as well
export const xyzRoot = () => "https://xyz.api.here.com";
const account_api_url = 'https://account.api.here.com/authentication/v1.1';

export const keySeparator = "%%";

export let validated = false;
let rows = 100;

const tableConfig:any = {
    border: getBorderCharacters(`norc`),
    columnDefault: {
        wrapWord: true
    },
    drawHorizontalLine: (index:number, size:number) => {
        return index === 0 || index === 1 || index === rows || index === size;
    }
};

const questionLicense = [
    {
        type: 'input',
        name: 'license',
        message: 'Enter (A)ccept or (D)ecline to proceed'
    }
];

export async function resetTermsFlag() {
    settings.set('ProBetaLicense', 'false');
}

export async function verifyProBetaLicense() {
    
    if (settings.get('ProBetaLicense') === 'true') {
        return;
    } else {
        const accountInfo:string = await decryptAndGet("accountInfo","Please run `here configure` command.")
        const appDataStored:string= await decryptAndGet("appDetails");

        const appDetails = appDataStored.split("%%");        
        const credentials = accountInfo.split("%%");
        console.log("Setting up your HERE XYZ Pro beta access..");
        const mainCoookie = await hereAccountLogin(credentials[0], credentials[1]);
        const accountMeStr = await getAppIds(mainCoookie);
        const accountMe = JSON.parse(accountMeStr);
        const proTcAcceptedAt = accountMe.proTcAcceptedAt;
        if(proTcAcceptedAt != null && proTcAcceptedAt > 0) {
            const newtoken = await generateToken(mainCoookie, appDetails[0]);
            if(newtoken) {
                settings.set('ProBetaLicense', 'true');
                console.log("Successfully obtained HERE XYZ Pro beta access!");
            }
            
        } else {
           const accepted:boolean = await showLicenseConfirmationForProBeta();
           if(accepted == true) {
                await upgradeToProBeta(mainCoookie, accountMe.aid);
                const newtoken = await generateToken(mainCoookie, appDetails[0]);
                if(newtoken) {
                    settings.set('ProBetaLicense', 'true');
                    console.log("Successfully obtained HERE XYZ Pro beta access!");
                }
                
           } else {
            console.log("In order to use the HERE XYZ Pro Beta functionality, you will need to accept the Beta license agreement. You can continue using the existing HERE XYZ functionalities");
            process.exit(1);
           }
        }
        
    }
}

async function showLicenseConfirmationForProBeta() {
    console.log(fs.readFileSync(path.resolve(__dirname, 'pro-beta-terms.txt'), 'utf8'));
    try {
        const opn = require("opn");
        opn("https://legal.here.com/en-gb/HERE-XYZ-Pro-Beta-Terms-and-Conditions",{wait:false});
    } catch {
    }
    const answer = await inquirer.prompt<{ license?: string }>(questionLicense);

    const termsResp = answer.license ? answer.license.toLowerCase() : 'decline';
    if (termsResp === "a" || termsResp === "accept") {
        return true;
    } else {
        return false;
    }
}

export async function upgradeToProBeta(cookies?: string, accountId?: string) {
    //proTcAcceptedAt
    console.log("Requesting XYZ Pro beta access...");
    const proTS = new Date().getTime();
    let payload : any = {proTcAcceptedAt: proTS};   
    
        var options = {
            url : xyzRoot()+`/account-api/accounts/${accountId}`,
            method : 'PATCH',
            headers : {
                "Cookie": cookies
            },
            json : true,
            body : payload
        }
        const { response, body } = await requestAsync(options);
        if (response.statusCode < 200 || response.statusCode > 299) {
            throw new Error("Account operation failed : " + JSON.stringify(body));
        }
        return body;
}

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

    if (response.statusCode < 200 || response.statusCode > 299)
        throw new Error("Failed to login: " + JSON.stringify(body));

    encryptAndStore('keyInfo', body.tid);
    encryptAndStore('appDetails', authId + keySeparator + authSecret);

    console.log("Secrets verified successfully");
    return { response, authId, authSecret };
}

export async function hereAccountLogin(email: string, password: string) {
    const mainCookie = await sso.executeWithCookie(email, password);
    encryptAndStore('accountInfo', email + keySeparator + password);
    console.log("Secrets verified successfully");
    return mainCookie;
}

export async function generateToken(mainCookie:string, appId : string) {
    const maxRights = await sso.fetchMaxRights(mainCookie);
    const token = await sso.fetchToken(mainCookie, maxRights, appId);
    encryptAndStore('keyInfo', token.tid);
    await generateROToken(mainCookie, JSON.parse(maxRights), appId);
    return token;
}

function readOnlyRightsRequest(maxRights:any) {
    return {
          "xyz-hub": {
            "readFeatures": maxRights['xyz-hub'].readFeatures,
            "useCapabilities": [{
                "id" : "hexbinClustering"
            }]
          }
    };
}
export async function generateROToken(mainCookie:string, maxRights:any, appId : string) {
    const token = await sso.fetchToken(mainCookie, JSON.stringify(readOnlyRightsRequest(maxRights)), appId);
    encryptAndStore('roKeyInfo', token.tid);
}

export async function getAppIds(cookies: string) {
    const options = {
        url: xyzRoot()+`/account-api/accounts/me?clientId=cli`,
        method: 'GET',
        headers: {
            "Cookie": cookies
        }
    };
    const { response, body } = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299)
        throw new Error("Error while fetching Apps: " + JSON.stringify(body));

    return body;
}

export async function updateDefaultAppId(cookies: string, accountId: string, appId: string, updateTC: boolean) {
        let payload : any = {};
        payload.defaultAppId = appId;
        if(updateTC){
            payload.tcAccepted = true;
        }
        var options = {
            url : xyzRoot()+`/account-api/accounts/${accountId}`,
            method : 'PATCH',
            headers : {
                "Cookie": cookies
            },
            json : true,
            body : payload
        }
        const { response, body } = await requestAsync(options);
        if (response.statusCode < 200 || response.statusCode > 299)
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

    if (response.statusCode < 200 || response.statusCode > 299) {
        console.log("Failed to login : " + JSON.stringify(body));
        throw new Error("Failed to log in");
    }

    validated = true;
    return response;
}

export async function getAccountId(){
    try{
        const accountId = await decryptAndGet("accountId", "No accountId found. Try running 'here configure'");
        return accountId;
    } catch(error){
        const currentToken = await decryptAndGet("keyInfo", "No token found");
        const tokenBody = await getTokenInformation(currentToken);
        await encryptAndStore("accountId",tokenBody.aid);
        return tokenBody.aid;
    }
}

async function getTokenInformation(tokenId: string){
    const { response, body } = await requestAsync({
        url: xyzRoot() + "/token-api/tokens/" + tokenId,
        method: "GET",
        json: true,
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
        throw new Error("Fetching token information failed for Token - " + tokenId);
    }
    return body;
}

export async function encryptAndStore(key: string, toEncrypt: string) {
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

export async function verify(readOnly: boolean = false) {
    let keyInfo = null;
    if(readOnly) {
      keyInfo = settings.get('roKeyInfo');
    }
    if(!keyInfo || keyInfo==null || keyInfo=="" ){
        keyInfo = settings.get('keyInfo');
    }
    const secretKey = await getMacAddress();
    if (keyInfo) {
        const bytes = CryptoJS.AES.decrypt(keyInfo, secretKey);
        const token = bytes.toString(CryptoJS.enc.Utf8);
        await validateToken(token);
        return token;
    } else {
        const message = "No saved keyinfo found. Try running 'here configure'";
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

export function drawNewTable(data: any, columns: any, columnWidth?: any) {
    if(!columnWidth && columns && columns.length > 2) {
        columnWidth = [];
        let size = Math.floor(115 / columns.length);
        for(let n in columns) {
            columnWidth.push(size);
        }
    }
    if(columnWidth && columnWidth.length > 0 && columns && columns.length == columnWidth.length) {
        const obj:any = {};
        for(let i = 0; i < columnWidth.length; i++) {
            obj[i] = { width: columnWidth[i] }
        }
        tableConfig['columns'] = obj;
    }
    rows = data.length + 1 ; // +1 for header
    let output = table(extractTableData(columns, data),tableConfig);
    console.log(output);
}

export function drawTable(data: any, columns: any) {

    //console.table(extractData(columns, data));
    drawNewTable(data, columns);
}

function extractTableData(fields: any, data: any) {
    const rowArr = new Array();
    rowArr.push(fields);
    for(const r in data) {
        const colArr = new Array();
        for(const c in fields) {
            const fieldname = fields[c];
            //colArr.push(data[r][fieldname]);
            colArr.push(resolveObject(fieldname, data[r]));
        }
        rowArr.push(colArr);
    }
    return rowArr;
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

export async function getApiKeys(cookies: string, appId: string) {
    const hrn = encodeURIComponent('hrn:here:account::HERE:app/'+appId);
    let token;
    let ha = cookies.split(';').find(x => x.startsWith('here_access=')||x.startsWith('here_access_st='));
    if(ha) {
        token = ha.split('=')[1];
    }
    const options = {
        url: account_api_url + `/apps/${hrn}/apiKeys`,
        method: 'GET',
        auth: {
            'bearer': token
        }
    };
    const { response, body } = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299) {
        throw new Error("Error while fetching Api Keys: " + JSON.stringify(body));
    }
    const resp = JSON.parse(body);
    let apiKeys = appId;
    if(resp.items && resp.items.length > 0) {
        for(var i=0; i<resp.items.length; i++) {
            let item = resp.items[i]
            if(item.enabled === true) {
                apiKeys += (keySeparator + item.apiKeyId);
            }
        }
    }
    return apiKeys;
}