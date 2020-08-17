/*
  Copyright (C) 2018 - 2020 HERE Europe B.V.
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
import getMAC from 'getmac';

import {table,getBorderCharacters} from 'table';

const fs = require('fs');
const path = require('path');

let choiceList: { name: string, value: string}[] = [];
const questions = [
    {
        type: "list",
        name: "tagChoices",
        message: "Select default AppId.",
        choices: choiceList
    }
];

const settings = require('user-settings').file('.herecli');
const tableConsole = require("console.table");
//const tableNew = require("table");

// TODO this should go into env config as well
export const xyzRoot = () => "https://xyz.api.here.com";
const account_api_url = 'https://account.api.here.com/authentication/v1.1';


export const keySeparator = "%%";

export let validated = false;
let rows = 100;

const tableConfig: any = {
    border: getBorderCharacters(`norc`),
    columnDefault: {
        wrapWord: true
    },
    drawHorizontalLine: (index: number, size: number) => {
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

export async function verifyProLicense() {
    // let now = new Date().getTime();
    // let minutesInMilis = 1000 * 60 * 1;
    // if (settings.get('ProEnabled') && settings.get('ProEnabledTS') && settings.get('ProEnabledTS') + minutesInMilis > now) {
    if (settings.get('ProEnabled')) {
        if (settings.get('ProEnabled') === 'true') {
            return;
        } else {
            console.log("This is a Add-on feature and your plan does not have access to this command.")
            console.log("If you have recently changed your plan, please run 'here configure refresh' command to refresh your settings.");
            console.log("If you wish to upgrade your plan, please visit developer.here.com.");
            process.exit(1);
        }
    } else {
        console.log("Refreshing your account access..")
        await refreshAccount();
        await verifyProLicense();
    }
}

export async function updatePlanDetails(accountMe: any) {
    settings.set('ProEnabled', 'false');
    let apps = accountMe.apps;
    if (apps) {
        for (let appId of Object.keys(apps)) {
            let app = apps[appId];
            if(!app.blocked) {
                if (app.plan.internal === true || app.dsPlanType.startsWith('XYZ_PRO') || app.dsPlanType.startsWith('XYZ_ENTERPRISE')) {
                    settings.set('ProEnabled', 'true');
                    settings.set('ProEnabledTS', new Date().getTime());
                    console.log("Add-on features enabled.");
                    break;
                }
            }
        }
    } else {
        console.log("Warning : could not update plan details.")
    }
}

export async function loginFlow(email: string, password: string) {
    try {
        await resetTermsFlag();

        let cookieData = await hereAccountLogin(email, password);
        let appsData = await getAppIds(cookieData);
        appsData = JSON.parse(appsData);
        let hereAccountID = appsData.aid;
        let updateTC = false;
        let appIdAppCodeMap : any = {};
        if (appsData.apps) {
            let apps = appsData.apps;
            let defaultAppId = appsData.defaultAppId;
            updateTC = appsData.tcAcceptedAt == 0 ? true : false;
            for (let key in apps) {
                let app = apps[key];
                appIdAppCodeMap[app.dsAppId] = app.dsAppCode;
                if(app.status.toLowerCase() == 'active'){
                    if (key == defaultAppId) {
                        choiceList.push({ name: app.dsAppId + " (Name-" + app.dsAppName + ")" + ' (DEFAULT)', value: app.dsAppId  });
                    } else {
                        choiceList.push({ name: app.dsAppId + " (Name-" + app.dsAppName + ")", value: app.dsAppId });
                    }
                }
            }
        }
        if(choiceList.length > 0){
            let appId;
            if(choiceList.length === 1){
                appId = choiceList[0].value;
            } else {
                let appIdAnswers : any = await inquirer.prompt(questions);
                appId = appIdAnswers.tagChoices;
            }
            let appCode = appIdAppCodeMap[appId];
            await updateDefaultAppId(cookieData, hereAccountID, appId, updateTC === false).catch(err => {throw err});
            await updatePlanDetails(appsData);
            await generateToken(cookieData, appId, appsData.urm).catch(err => {throw err});
            await encryptAndStore('appDetails', appId + keySeparator + appCode).catch(err => {throw err});
            await encryptAndStore('apiKeys', appId).catch(err => {throw err});
            console.log('Default App Selected - ' + appId);
        }else{
            console.log('No Active Apps found. Please login to https://developer.here.com for more details.');
        }
    }catch(error){
        console.log(error.message);
    }
}

export async function refreshAccount(fullRefresh = false) {
    const accountInfo: string = await decryptAndGet("accountInfo", "Please run `here configure` command.");
    const appDataStored: string = await decryptAndGet("appDetails");
    const appDetails = getSplittedKeys(appDataStored);
    const credentials = getSplittedKeys(accountInfo);
    if(!appDetails || !credentials){
        throw new Error("Error while refreshing Account, please use 'here configre'");
    }

    try {
        if(fullRefresh) {
            await loginFlow(credentials[0], credentials[1]);
        } else {
            const mainCoookie = await hereAccountLogin(credentials[0], credentials[1]);
            const accountMeStr = await getAppIds(mainCoookie);
            const accountMe = JSON.parse(accountMeStr);
            const newtoken = await generateToken(mainCoookie, appDetails[0], accountMe.urm);
            if (newtoken) {
                await updatePlanDetails(accountMe);
                console.log("Successfully refreshed account!");
            }
        }        
    } catch (e) {
        console.log(e.message);
    }
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

export async function createReadOnlyToken(spaceIds: string[], isPermanent: boolean){
    const appDataStored: string = await decryptAndGet("appDetails");
    const keys = getSplittedKeys(appDataStored);
    const appId = keys ? keys[0] : '';
    const cookie = await getCookieFromStoredCredentials();
    let expirationTime : number = 0;
    if(!isPermanent){
        expirationTime = Math.round((new Date().getTime())/1000) + (48*60*60); 
    }
    const token = await sso.fetchToken(cookie, JSON.stringify(await readOnlySpaceRightsRequest(spaceIds)), appId, expirationTime);
    return token.tid;
}

function getMacAddress() {
    return getMAC();
}

export async function login(authId: string, authSecret: string) {
    const response = await requestAsync({
        url: xyzRoot() + "/token-api/tokens?app_id=" + authId + "&app_code=" + authSecret + "&tokenType=PERMANENT",
        method: "POST",
        json: rightsRequest(authId),
        responseType: "json"
    });

    if (response.statusCode < 200 || response.statusCode > 299)
        throw new Error("Failed to login: " + JSON.stringify(response.body));

    encryptAndStore('keyInfo', response.body.tid);
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

export async function generateToken(mainCookie:string, appId : string, urm: any = null) {
    if(!urm){
        const accountMeStr = await getAppIds(mainCookie);
        const accountMe = JSON.parse(accountMeStr);
        urm = accountMe.urm;
    }
    const token = await sso.fetchToken(mainCookie, urm, appId);
    encryptAndStore('keyInfo', token.tid);
    encryptAndStore("accountId",token.aid);
    return token;
}

async function readOnlySpaceRightsRequest(spaceIds:string[]) {
    const aid = await getAccountId();
    return {
          "xyz-hub": {
            "readFeatures": spaceIds.map(id => { return {space: id, owner: aid}}), 
            "useCapabilities": [{
            }],
            "accessConnectors": [{
            }]
          }
    };
}

export async function getAppIds(cookies: string) {
    const options = {
        url: xyzRoot()+`/account-api/accounts/me?clientId=cli`,
        method: 'GET',
        headers: {
            "Cookie": cookies
        }
    };
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299)
        throw new Error("Error while fetching Apps: " + JSON.stringify(response.body));

    return response.body;
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
            json : payload,
            responseType: "json"
        }
        const response = await requestAsync(options);
        if (response.statusCode < 200 || response.statusCode > 299)
            throw new Error("Error while fetching Apps: " + JSON.stringify(response.body));

        return response.body;
}

async function validateToken(token: string) {
    if (validated)
        return true;

    const response = await requestAsync({
        url: xyzRoot() + "/token-api/tokens/" + token,
        method: "GET",
        responseType: "json"
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
        console.log("Failed to login : " + JSON.stringify(response.body));
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
    const response = await requestAsync({
        url: xyzRoot() + "/token-api/tokens/" + tokenId,
        method: "GET",
        responseType: "json"
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
        throw new Error("Fetching token information failed for Token - " + tokenId);
    }
    return response.body;
}

export async function getTokenList(){
    const cookie = await getCookieFromStoredCredentials();
    const options = {
        url: xyzRoot() + "/token-api/tokens",
        method: "GET",
        headers: {
            Cookie: cookie
        }
    };

    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299) {
        throw new Error("Error while fetching tokens :" + response.body);
    }
    const tokenInfo = JSON.parse(response.body);
    return tokenInfo;
}

export async function getCookieFromStoredCredentials(){
    const dataStr = await decryptAndGet(
        "accountInfo",
        "No here account configure found. Try running 'here configure account'"
    );
    const appInfo = getSplittedKeys(dataStr);
    if (!appInfo) {
        throw new Error("Account information out of date. Please re-run 'here configure'");
    }
    const cookie = await sso.executeWithCookie(appInfo[0], appInfo[1]);
    return cookie;
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
        program.commandHelp();
    } else {
        if (args[0] == "help" || args[0] == "--help" || args[0] == "-h" || args[0] == "-help") {
            program.commandHelp();
        } else if (!commands.includes(args[0])) {
            console.log("Invalid command '" + args[0] + "'");
            program.commandHelp();
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

export function createUniqueId(idStr: string, item: any) {
    const ids = idStr.split(",");
    const vals = new Array();
    ids.forEach(function (id) {
        const v = item.properties ? item.properties[id] : null;
        if (v) {
            vals.push(v);
        }
    });
    const idFinal = vals.join("-");
    return idFinal;
}

export function drawNewTable(data: any, columns: any, columnWidth?: any) {
    if(!columnWidth && columns && columns.length > 2) {
        let size = Math.floor(115 / columns.length);
        columnWidth = new Array(columns.length).fill(size);
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
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
        }
    };
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299) {
        throw new Error("Error while fetching Api Keys: " + JSON.stringify(response.body));
    }
    const resp = JSON.parse(response.body);
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
