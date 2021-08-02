/*
  Copyright (C) 2018 - 2021 HERE Europe B.V.
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
import { geoCodeString } from "./geocodeUtil";
import {table,getBorderCharacters} from 'table';
import {ApiError} from "./api-error";
import * as turf from "@turf/turf";
import * as intersect from "@turf/intersect";
import {
    UserAuth,
    requestToken,
    loadCredentialsFromFile
} from "@here/olp-sdk-authentication";
import {RequestFactory, OlpClientSettings, HRN} from "@here/olp-sdk-core";

const fs = require('fs');
const path = require('path');
import * as zlib from "zlib";
import * as h3 from "h3-js";
const geojson2h3 = require('geojson2h3');
const h3resolutionRadiusMap = require('./h3resolutionRadiusMap.json');

let choiceList: { name: string, value: string}[] = [];
const questions = [
    {
        type: "list",
        name: "tagChoices",
        message: "Select default AppId.",
        choices: choiceList
    }
];

export const questionConfirm = [
    {
        type: 'input',
        name: 'confirmed',
        message: 'Enter (Y)es to continue or (N)o to cancel'
    }
];

const settings = require('user-settings').file('.herecli');
const tableConsole = require("console.table");
let apiServerUrl: string;
const xyzUrl = "https://xyz.api.here.com";
const account_api_url = 'https://account.api.here.com/authentication/v1.1';
//const tableNew = require("table");

// TODO this should go into env config as well
export function xyzRoot(xyzUrlAlways: boolean){
    if(xyzUrlAlways){
        return xyzUrl;
    } else {
        if(!apiServerUrl){
            apiServerUrl = settings.get('apiServerUrl');
            if(!apiServerUrl){
                settings.set('apiServerUrl',xyzUrl);
                apiServerUrl = xyzUrl;
            }
        }
        return apiServerUrl;
    }
}

export function isApiServerXyz(){
    return (xyzRoot(false) === xyzUrl);
}

export function setApiServerUrl(url: string){
    settings.set('apiServerUrl',url);
    apiServerUrl = url;
}

async function getImlUrl(catalogHrn: string){
    const olpClientSettings = new OlpClientSettings({
        environment: "here",
        getToken: () => getWorkspaceToken()
    });
    const url = await RequestFactory.getBaseUrl("interactive","v1",olpClientSettings, HRN.fromString(catalogHrn));
    console.log(url);
    return url;
}

async function getHostUrl(uri: string, catalogHrn: string){
    if(catalogHrn){
        uri = await getImlUrl(catalogHrn) + "/layers/" + uri;
    } else {
        uri = xyzRoot(false) + "/hub/spaces/" + uri;
    }
    return uri;
}

export async function setWorkSpaceCredentials(filePath: string){
    try {
        const token: string = await getWorkspaceToken(filePath);//This to verify the credentials
        settings.set('workspaceMode', 'true');
        settings.set('credentialsFilePath', filePath);
        console.log("Workspace credentials loaded successfully");
    } catch(error){
        console.log(error.message);
    }
}

export async function getWorkspaceToken(credentialsPath : string = ''){
    if(!credentialsPath){
        credentialsPath = settings.get('credentialsFilePath');
    }
    const credentials = loadCredentialsFromFile(
        credentialsPath
    );
    const userAuth = new UserAuth({
        credentials,
        tokenRequester: requestToken
    });
    const token: string = await userAuth.getToken();
    return token;
}

export const keySeparator = "%%";

export let validated = false;
let rows = 100;
let cookie: string;

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
                if(app.status.toLowerCase() == 'active' || app.blocked === false) {
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
            await generateTokenAndStoreIt(cookieData, appId, {}).catch(err => {throw err});//{} as urm so that its full rights as per policy even when it changes at later stage
            await encryptAndStore('appDetails', appId + keySeparator + appCode).catch(err => {throw err});
            await encryptAndStore('apiKeys', appId).catch(err => {throw err});
            settings.set('apiServerUrl','https://xyz.api.here.com');
            settings.set('workspaceMode','false');
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
            const newtoken = await generateTokenAndStoreIt(mainCoookie, appDetails[0], {});//{} as urm so that its full rights as per policy even when it changes at later stage
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
    const accountMeStr = await getAppIds(cookie);
    let expirationTime : number = 0;
    if(!isPermanent){
        expirationTime = Math.round((new Date().getTime())/1000) + (48*60*60); 
    }
    const token = await sso.fetchToken(cookie, await readOnlySpaceRightsRequest(spaceIds, accountMeStr), appId, expirationTime);
    return token.tid;
}

function getMacAddress() {
    return getMAC();
}

export async function login(authId: string, authSecret: string) {
    const response = await requestAsync({
        url: xyzRoot(true) + "/token-api/tokens?app_id=" + authId + "&app_code=" + authSecret + "&tokenType=PERMANENT",
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

export async function generateTokenAndStoreIt(mainCookie:string, appId : string, urm: any) {
    const token = await sso.fetchToken(mainCookie, urm, appId);
    encryptAndStore('keyInfo', token.tid);
    encryptAndStore("accountId",token.aid);
    return token;
}

async function readOnlySpaceRightsRequest(spaceIds:string[], accountMeString: string) {
    const aid = await getAccountId();
    const readFeatureArray = spaceIds.map(id => { 
        if(accountMeString.indexOf(id) !== -1) {
            return {space: id};
        }else {
            return {space: id, owner: aid};
        }
    });
    return {
          "xyz-hub": {
            "readFeatures": readFeatureArray, 
            "useCapabilities": [{
            }],
            "accessConnectors": [{
            }]
          }
    };
}

export async function getAppIds(cookies: string) {
    const options = {
        url: xyzRoot(true)+`/account-api/accounts/me?clientId=cli`,
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
            url : xyzRoot(true)+`/account-api/accounts/${accountId}`,
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

export async function createNewSharingRequest(spaceId: string){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharingRequest`,
        method : 'PUT',
        headers : {
            "Cookie": cookie
        },
        json : {
            spaceId: spaceId
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while creating sharing Request: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function getSharingRequests(){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharingRequest`,
        method : 'GET',
        headers : {
            "Cookie": cookie
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while getting sharing Requests: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function getExistingSharing(){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharing`,
        method : 'GET',
        headers : {
            "Cookie": cookie
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while getting sharing: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function deleteSharing(sharingId: string){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharing/${sharingId}`,
        method : 'DELETE',
        headers : {
            "Cookie": cookie
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while deleting sharing: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function deleteSharingRequest(sharingRequestId: string){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharingRequest/${sharingRequestId}`,
        method : 'DELETE',
        headers : {
            "Cookie": cookie
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while deleting sharingRequest: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function getExistingApprovals(){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharingApproval`,
        method : 'GET',
        headers : {
            "Cookie": cookie
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while getting sharing Approval: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function putSharingApproval(sharingId: string, verdict:string, urm: string[] = []){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharingApproval/${sharingId}`,
        method : 'PUT',
        headers : {
            "Cookie": cookie
        },
        json : {
            verdict: verdict,
            urm: urm
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while putting sharing Approval: " + JSON.stringify(response.body));
    }
    return response.body;
}

export async function modifySharingRights(sharingId: string, urm: string[]){
    if(!cookie){
        cookie = await getCookieFromStoredCredentials();
    }
    var options = {
        url : xyzRoot(true)+`/account-api/sharing/${sharingId}`,
        method : 'PATCH',
        headers : {
            "Cookie": cookie
        },
        json : {
            urm: urm
        },
        responseType: "json"
    }
    const response = await requestAsync(options);
    if (response.statusCode < 200 || response.statusCode > 299){
        throw new Error("Error while Patching sharing: " + JSON.stringify(response.body));
    }
    return response.body;
}

async function validateToken(token: string) {
    if (validated)
        return true;

    const response = await requestAsync({
        url: xyzRoot(true) + "/token-api/tokens/" + token,
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
        url: xyzRoot(true) + "/token-api/tokens/" + tokenId,
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
        url: xyzRoot(true) + "/token-api/tokens",
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

export async function getLocalApiKey(){
    let response = await geoCodeString("mumbai", false);//sample geocode call to check if apiKey is valid
    let apiKeys = await decryptAndGet("apiKeys");
    const apiKeyArr = getSplittedKeys(apiKeys);
    if(!apiKeyArr){
        console.log("ApiKey not found, please generate/enable your API Keys at https://developer.here.com. \n" +
                    "If already generated/enabled, please try again in a few minutes.");
        process.exit(1);
    }
    const apiKey = apiKeyArr[1];
    return apiKey;
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

export function getClippedh3HexbinsInsidePolygon(feature: any, h3resolution: string){
    //h3.polyfill
    const bufferedFeature = turf.buffer(feature, Number(h3resolutionRadiusMap[h3resolution]) * 2);
    const hexagons = geojson2h3.featureToH3Set(bufferedFeature, Number(h3resolution));
    let featureCollection =  geojson2h3.h3SetToFeatureCollection(hexagons);
    for (var i = featureCollection.features.length - 1; i >= 0; i--) {
        const newHexbin = intersect.default(feature, featureCollection.features[i]);
        if (newHexbin) { 
            newHexbin.id = featureCollection.features[i].id;
            featureCollection.features[i] = newHexbin;
        } else {
            featureCollection.features.splice(i, 1);
        }
    }
    return featureCollection;
}

export function getH3HexbinChildren(h3Index: string, resolution: number){
	let children = h3.h3ToChildren(h3Index,resolution)
	return children
}

/**
 *
 * @param apiError error object
 *@param isIdSpaceId set this boolean flag as true if you want to give space specific message in console for 404
*/
export function handleError(apiError: ApiError, isIdSpaceId: boolean = false) {
    if (apiError.statusCode) {
        if (apiError.statusCode == 401) {
            console.log("Operation FAILED : Unauthorized, if the problem persists, please reconfigure account with `here configure` command");
        } else if (apiError.statusCode == 403) {
            console.log("Operation FAILED : Insufficient rights to perform action");
        } else if (apiError.statusCode == 404) {
            if (isIdSpaceId) {
                console.log("Operation FAILED: Space does not exist");
            } else {
                console.log("Operation FAILED : Resource not found.");
            }
        } else {
            console.log("OPERATION FAILED : Error code - " + apiError.statusCode + ", message - " + apiError.message);
        }
    } else {
        if (apiError.message && apiError.message.indexOf("Insufficient rights.") != -1) {
            console.log("Operation FAILED - Insufficient rights to perform action");
        } else {
            console.log("OPERATION FAILED - " + apiError.message);
        }
    }
}

export async function execInternal(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    gzip: boolean,
    setAuthorization: boolean,
    catalogHrn : string = ""
) {
    if (gzip) {
        return await execInternalGzip(
            uri,
            method,
            contentType,
            data,
            token,
            3,
            catalogHrn
        );
    }
    if (!uri.startsWith("http")) {
        uri = await getHostUrl(uri, catalogHrn);
    }
    const responseType = contentType.indexOf('json') !== -1 ? 'json' : 'text';
    let headers: any = {
        "Content-Type": contentType,
        "App-Name": "HereCLI"
    };
    if(isApiServerXyz() || catalogHrn){
        headers["Authorization"] = "Bearer " + token;
    }
    const reqJson = {
        url: uri,
        method: method,
        headers: headers,
        json: method === "GET" ? undefined : data,
        allowGetBody: true,
        responseType: responseType
    };

    //Remove Auth params if not required, Used to get public response from URL
    if (setAuthorization == false) {
        delete reqJson.headers.Authorization;
    }

    const response = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        let message = (response.body && response.body.constructor != String) ? JSON.stringify(response.body) : response.body;
        //throw new Error("Invalid response - " + message);
        throw new ApiError(response.statusCode, message);
    }
    return response;
}

function gzip(data: zlib.InputType): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) =>
        zlib.gzip(data, (error, result) => {
            if (error)
                reject(error)
            else
                resolve(result);
        })
    );
}

async function execInternalGzip(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    retry: number = 3,
    catalogHrn : string
) {
    const zippedData = await gzip(data);
    if (!uri.startsWith("http")) {
        uri = await getHostUrl(uri, catalogHrn);
    }
    let headers: any = {
        "Content-Type": contentType,
        "App-Name": "HereCLI",
        "Content-Encoding": "gzip",
        "Accept-Encoding": "gzip"
    };
    if(isApiServerXyz() || catalogHrn){
        headers["Authorization"] = "Bearer " + token;
    }
    const responseType = contentType.indexOf('json') !== -1 ? 'json' : 'text';
    const reqJson = {
        url: uri,
        method: method,
        headers: headers,
        decompress: true,
        body: method === "GET" ? undefined : zippedData,
        allowGetBody: true,
        responseType: responseType
    };

    let response = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        if (response.statusCode >= 500 && retry > 0) {
            await new Promise(done => setTimeout(done, 1000));
            response = await execInternalGzip(uri, method, contentType, data, token, --retry, catalogHrn);
        } else if (response.statusCode == 413 && typeof data === "string"){
            let jsonData = JSON.parse(data);
            if(jsonData.type && jsonData.type === "FeatureCollection") {
                if(jsonData.features.length > 1){
                    console.log("\nuploading chunk size of " + jsonData.features.length + " features failed with 413 Request Entity too large error, trying upload again with smaller chunk of " + Math.ceil(jsonData.features.length / 2));
                    const half = Math.ceil(jsonData.features.length / 2);    
                    const firstHalf = jsonData.features.splice(0, half)
                    const firstHalfString = JSON.stringify({ type: "FeatureCollection", features: firstHalf }, (key, value) => {
                        if (typeof value === 'string') {
                            return value.replace(/\0/g, '');
                        }
                        return value;
                    });
                    response = await execInternalGzip(uri, method, contentType, firstHalfString, token, retry, catalogHrn);
                    const secondHalf = jsonData.features.splice(-half);
                    const secondHalfString = JSON.stringify({ type: "FeatureCollection", features: secondHalf }, (key, value) => {
                        if (typeof value === 'string') {
                            return value.replace(/\0/g, '');
                        }
                        return value;
                    });
                    const secondResponse = await execInternalGzip(uri, method, contentType, secondHalfString, token, retry, catalogHrn);
                    if(secondResponse.body.features) {
                        response.body.features = (response.body && response.body.features) ? response.body.features.concat(secondResponse.body.features) : secondResponse.body.features;
                    }
                    if(secondResponse.body.failed) {
                        response.body.failed = (response.body && response.body.failed) ? response.body.failed.concat(secondResponse.body.failed) : secondResponse.body.failed;
                    }
                } else {
                    console.log("\nfeature " + (jsonData.features[0].id ? ("with ID " + jsonData.features[0].id) : JSON.stringify(jsonData.features[0]) +" is too large for API gateway limit, please simplify the geometry to reduce its size"));
                    response = {
                        statusCode:200,
                        body:{
                            failed:jsonData.features
                        }
                    }
                }
            } else {
                throw new ApiError(response.statusCode, response.body);
            }
        } else {
            //   throw new Error("Invalid response :" + response.statusCode);
            throw new ApiError(response.statusCode, response.body);
        }
    }
    return response;
}

export async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false, setAuthorization: boolean = true, catalogHrn: string = "") {
    if (!token) {
        if(catalogHrn){
            token = await getWorkspaceToken();
        } else {
            token = await verify();
        }
    }
    return await execInternal(uri, method, contentType, data, token, gzip, setAuthorization, catalogHrn);
}

export function replaceOpearators(expr: string) {
    return expr.replace(">=", "=gte=").replace("<=", "=lte=").replace(">", "=gt=").replace("<", "=lt=").replace("+", "&");
}

export function createQuestionsList(object: any) {
    let tagChoiceList = createChoiceList(object);
    let IdTagquestions = [
        {
            type: "checkbox",
            name: "tagChoices",
            message: "Select attributes to be added as tags, like key@value",
            choices: tagChoiceList
        },
        {
            type: "checkbox",
            name: "idChoice",
            message:
                "Select attributes to be used as the GeoJSON Feature ID (must be unique)",
            choices: tagChoiceList
        }
    ];
    return IdTagquestions;
}

export function createChoiceList(object: any){
    let inputChoiceList: { name: string, value: string}[] = [];
    for (let i = 0; i < 3 && i < object.features.length; i++) {
        let j = 0;
        for (let key in object.features[0].properties) {
            if (i === 0) {
                const desc =
                    "" +
                    (1 + j++) +
                    " : " +
                    key +
                    " : " +
                    object.features[i].properties[key];
                    inputChoiceList.push({ name: desc, value: key });
            } else {
                inputChoiceList[j].name =
                inputChoiceList[j].name + " , " + object.features[i].properties[key];
                j++;
            }
        }
    }
    return inputChoiceList;
}

export function addDatetimeTag(dateValue:moment.Moment, element:string, options: any, finalTags: Array<string>){
    dateValue.locale('en');
    let allTags = false;
    if (options.datetag == true || options.datetag == undefined) {
        allTags = true;
    }
    let inputTagsList = [];
    if (!allTags) {
        inputTagsList = options.datetag.split(',');
    }
    if (allTags || inputTagsList.includes('year')) {
        addTagsToList(dateValue.year().toString(), 'date_' + element + '_year', finalTags);
    }
    if (allTags || inputTagsList.includes('month')) {
        addTagsToList(dateValue.format('MMMM'), 'date_' + element + '_month', finalTags);
    }
    if (allTags || inputTagsList.includes('year_month')) {
        addTagsToList(dateValue.year().toString() + '-' + ("0" + (dateValue.month() + 1)).slice(-2).toString(), 'date_' + element + '_year_month', finalTags);
    }
    if (allTags || inputTagsList.includes('week')) {
        addTagsToList(("0" + (dateValue.week())).slice(-2), 'date_' + element + '_week', finalTags);
    }
    if (allTags || inputTagsList.includes('year_week')) {
        addTagsToList(dateValue.year().toString() + '-' + ("0" + (dateValue.week())).slice(-2), 'date_' + element + '_year_week', finalTags);
    }
    if (allTags || inputTagsList.includes('weekday')) {
        addTagsToList(dateValue.format('dddd'), 'date_' + element + '_weekday', finalTags);
    }
    if (allTags || inputTagsList.includes('hour')) {
        addTagsToList(("0" + (dateValue.hour())).slice(-2), 'date_' + element + '_hour', finalTags);
    }
}

export function addTagsToList(value: string, tp: string, finalTags: string[]) {
    value = value.toString().toLowerCase();
    value = value.replace(/\s+/g, "_");
    value = value.replace(/,+/g, "_");
    value = value.replace(/&+/g, "_and_");
    value = value.replace(/\++/g, "_plus_");
    value = value.replace(/#+/g, "_num_");
    tp = tp.replace(/\s+/g, "_");
    //finalTags.push(value); // should we add tags with no @ an option?
    finalTags.push(tp + "@" + value);
    return finalTags;
}

export function uniqArray<T>(a: Array<T>) {
    return Array.from(new Set(a));
}

export function getFileName(fileName: string) {
    try {
        let bName = path.basename(fileName);
        if (bName.indexOf(".") != -1) {
            bName = bName.substring(0, bName.lastIndexOf("."));
        }
        return bName;
    } catch (e) {
        return null;
    }
}

export function addDatetimeProperty(dateValue:moment.Moment, element:string, options: any, item: any){
    dateValue.locale('en');
    let allTags = false;
    if (options.dateprops == true || options.dateprops == undefined) {
        allTags = true;
    }
    let inputTagsList = [];
    if (!allTags) {
        inputTagsList = options.dateprops.split(',');
    }
    if (allTags || inputTagsList.includes('year')) {
        item.properties['date_' + element + '_year'] = dateValue.year().toString();
    }
    if (allTags || inputTagsList.includes('month')) {
        item.properties['date_' + element + '_month'] = dateValue.format('MMMM');
    }
    if (allTags || inputTagsList.includes('year_month')) {
        item.properties['date_' + element + '_year_month'] = dateValue.year().toString() + '-' + ("0" + (dateValue.month() + 1)).slice(-2).toString();
    }
    if (allTags || inputTagsList.includes('week')) {
        item.properties['date_' + element + '_week'] = ("0" + (dateValue.week())).slice(-2);
    }
    if (allTags || inputTagsList.includes('year_week')) {
        item.properties['date_' + element + '_year_week'] = dateValue.year().toString() + '-' + ("0" + (dateValue.week())).slice(-2);
    }
    if (allTags || inputTagsList.includes('weekday')) {
        item.properties['date_' + element + '_weekday'] = dateValue.format('dddd');
    }
    if (allTags || inputTagsList.includes('hour')) {
        item.properties['date_' + element + '_hour'] = ("0" + (dateValue.hour())).slice(-2);
    }
}

export function collate(result: Array<any>) {
    return result.reduce((features: any, feature: any) => {
        if (feature.type === "Feature") {
            features.push(feature);
        } else if (feature.type === "FeatureCollection") {
            features = features.concat(feature.features);
        } else {
            console.log("Unknown type" + feature.type);
        }
        return features
    }, []);
}

export function getGeoSpaceProfiles(title: string, description: string, client: any, enableUUID: boolean = false) {
    return {
        title,
        description,
        client,
        enableUUID
    };
}

export function getSchemaProcessorProfile(schema: string) {
    return {
        "schema-validator" : [{
            "eventTypes": ["ModifyFeaturesEvent.request", "ModifySpaceEvent.request"],
            "params": {
                "schema": schema
            },
            "order": 0
        }]
    }
}
