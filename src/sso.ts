#!/usr/bin/env node

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

import { requestAsync } from "./requestAsync";

const url = "https://account.here.com/sign-in?client-id=es1HEn2LGqFocvfD1eEt&version=3&sdk=true&type=frame&uri=https%3A%2F%2Fxyz.here.com&sign-in-screen-config=password,heread&track-id=trackUPMUI&lang=en-us";
const signInURL ="https://account.here.com/api/account/sign-in-with-password";
const xyzRoot = "https://xyz.api.here.com";
const maxRightsURL = xyzRoot+"/token-api/maxRights";
const tokenURL = xyzRoot+"/token-api/token?tokenType=PERMANENT&description=Token+Generated+by+CLI"

export async function getToken(userName: string, password: string) {
    const mainCookie = await executeWithCookie(userName,password);
    const maxRights = await fetchMaxRights(mainCookie);
    //const data = await fetchToken(mainCookie, maxRights);
    const response = {
   //     data:data,
        mainCookie:mainCookie
    }
    return response;
}

export async function executeWithCookie(userName: string, password: string) {

    const { response, body } = await requestAsync({ url });

    let csrfToken = body as string;

    const cookies = response.headers['set-cookie'];
    csrfToken = csrfToken.substring(csrfToken.indexOf("csrf"));
    csrfToken = csrfToken.substring(csrfToken.indexOf(':') + 3, csrfToken.indexOf(',') - 1);
    const requestBody = `{"realm":"here","email":"${userName}","password":"${password}","rememberMe":true}`;
    const options = {
        url: signInURL,
        method: 'POST',
        headers: {
            "Cookie": extractCookies(cookies, ["here_account","here_account.sig"]),
            "x-csrf-token": csrfToken,
            "Content-Type": "application/json"
        },
        body : requestBody
    };

    const { response: res, body: csrfBody } = await requestAsync(options);
    if (res.statusCode !== 200){
        throw new Error("Error while Authenticating. Please check credentials and try again.");
    }        

    const mainCookie = extractCookies(res.headers['set-cookie'], ["here"]);
    return mainCookie;
}

function extractCookies(cookies: string[] | undefined, expectedKeys: string[]) {
    let returnCookie = "";
    let app = "";

    if (cookies === undefined)
        return returnCookie;

    cookies.forEach(cookie => {
        expectedKeys.forEach(key => {
            if (cookie.startsWith(key)){
                returnCookie += app + cookie.split(";")[0];
                app = ";";
            }
        });
    });
    return returnCookie;
}

export async function fetchMaxRights(cookies: string){
    const options = {
        url: maxRightsURL,
        method: 'GET',
        headers: {
            "Cookie": cookies
        }
    };

    const { response, body } = await requestAsync(options);
    if (response.statusCode < 200 && response.statusCode >= 300)
        throw new Error("Error while fetching maxrights: " + JSON.stringify(body));

    return body;
}

export async function fetchToken(cookies: string, requestBody: any, appId : string) {
    const bodyStr = JSON.stringify({ "urm": JSON.parse(requestBody), cid: appId });
    const options = {
        url: tokenURL,
        method: "POST",
        body: bodyStr,
        headers: {
            "Cookie":cookies,
            "Content-Type":"application/json"
        }
    }

    const { response, body } = await requestAsync(options);
    if (response.statusCode < 200 && response.statusCode >= 300)
        throw new Error("Error while fetching token: " + body);

    return JSON.parse(body);
}
