#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const requestAsync_1 = require("./requestAsync");
const url = "https://account.here.com/sign-in?client-id=es1HEn2LGqFocvfD1eEt&version=3&sdk=true&type=frame&uri=https%3A%2F%2Fxyz.here.com&sign-in-screen-config=password,heread&track-id=trackUPMUI&lang=en-us";
const signInURL = "https://account.here.com/api/account/sign-in-with-password";
const xyzRoot = "https://xyz.api.here.com";
const maxRightsURL = xyzRoot + "/token-api/maxRights";
const tokenURL = xyzRoot + "/token-api/token?tokenType=PERMANENT";
function getToken(userName, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const mainCookie = yield executeWithCookie(userName, password);
        const maxRights = yield fetchMaxRights(mainCookie);
        const data = yield fetchToken(mainCookie, maxRights);
        return data.token;
    });
}
exports.getToken = getToken;
function executeWithCookie(userName, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const { response, body } = yield requestAsync_1.requestAsync({ url });
        let csrfToken = body;
        const cookies = response.headers['set-cookie'];
        csrfToken = csrfToken.substring(csrfToken.indexOf("csrf"));
        csrfToken = csrfToken.substring(csrfToken.indexOf(':') + 3, csrfToken.indexOf(',') - 1);
        const requestBody = `{"realm":"here","email":"${userName}","password":"${password}","rememberMe":true}`;
        const options = {
            url: signInURL,
            method: 'POST',
            headers: {
                "Cookie": extractCookies(cookies, ["here_account", "here_account.sig"]),
                "x-csrf-token": csrfToken,
                "Content-Type": "application/json"
            },
            body: requestBody
        };
        const { response: res, body: csrfBody } = yield requestAsync_1.requestAsync(options);
        if (res.statusCode !== 200)
            throw new Error("Error while Authenticating: " + JSON.stringify(csrfBody));
        const mainCookie = extractCookies(res.headers['set-cookie'], ["here"]);
        return mainCookie;
    });
}
exports.executeWithCookie = executeWithCookie;
function extractCookies(cookies, expectedKeys) {
    let returnCookie = "";
    let app = "";
    if (cookies === undefined)
        return returnCookie;
    cookies.forEach(cookie => {
        expectedKeys.forEach(key => {
            if (cookie.startsWith(key)) {
                returnCookie += app + cookie.split(";")[0];
                app = ";";
            }
        });
    });
    return returnCookie;
}
function fetchMaxRights(cookies) {
    return __awaiter(this, void 0, void 0, function* () {
        const options = {
            url: maxRightsURL,
            method: 'GET',
            headers: {
                "Cookie": cookies,
                "Content-Type": "application/json"
            }
        };
        const { response, body } = yield requestAsync_1.requestAsync(options);
        if (response.statusCode !== 200)
            throw new Error("Error while fetching maxrights: " + JSON.stringify(body));
        return body;
    });
}
function fetchToken(cookies, requestBody) {
    return __awaiter(this, void 0, void 0, function* () {
        const bodyStr = JSON.stringify({ "urm": JSON.parse(requestBody) });
        const options = {
            url: tokenURL,
            method: "POST",
            body: bodyStr,
            headers: {
                "Cookie": cookies,
                "Content-Type": "application/json"
            }
        };
        const { response, body } = yield requestAsync_1.requestAsync(options);
        if (response.statusCode !== 200)
            throw new Error("Error while fetching token: " + body);
        return JSON.parse(body);
    });
}
