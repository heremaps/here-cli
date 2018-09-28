#!/usr/bin/env node

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

var request = require('request');
var url = "https://account.here.com/sign-in?client-id=es1HEn2LGqFocvfD1eEt&version=3&sdk=true&type=frame&uri=https%3A%2F%2Fxyz.here.com&sign-in-screen-config=password,heread&track-id=trackUPMUI&lang=en-us";
var signInURL ="https://account.here.com/api/account/sign-in-with-password";
var xyzRoot = "https://xyz.api.here.com"; 
var maxRightsURL = xyzRoot+"/token-api/maxRights";
var tokenURL = xyzRoot+"/token-api/token?tokenType=PERMANENT"

function getToken(userName,password){
    return new Promise(function(resolve,reject){
        executeWithCookie(userName,password)
        .then(mainCookie=>{
            fetchMaxRights(mainCookie).then(x=>fetchToken(mainCookie,x).then(data=>resolve(data.token))).catch(function(error) {
                reject(error);
            });
        }).catch(error=>reject(error));
    });
}
function executeWithCookie(userName,password){
   return new Promise(function(resolve,reject){
        request(url, function (error, response, csrfToken) { 
            var  cookies = response.headers['set-cookie'];
            csrfToken = csrfToken.substring(csrfToken.indexOf("csrf"));
            csrfToken =csrfToken.substring(csrfToken.indexOf(':')+3,csrfToken.indexOf(',')-1);
            var body = `{\"realm\":\"here\",\"email\":\"${userName}\",\"password\":\"${password}\",\"rememberMe\":true}`;
            const options = { 
                url: signInURL,
                method: 'POST',
                headers: {
                    "Cookie":extractCookies(cookies,["here_account","here_account.sig"]),
                    "x-csrf-token":csrfToken,
                    "Content-Type":"application/json"
                },
                body : body
            };
            request(options, function(error, res, body) {
                var statusCode = response && response.statusCode;
                if(statusCode!=200){
                    reject(new Error("Error while Authenticating : "+JSON.stringify(error)));
                }else{
                    var mainCookie = extractCookies(res.headers['set-cookie'],["here"]);
                    resolve(mainCookie);
                    // fetchMaxRights(mainCookie).then(x=>fetchToken(mainCookie,x).then(data=>resolve(callBack(data)))).catch(function(error) {
                    //     reject(error);
                    // });
                }
            });
        
        });
    });
}

function extractCookies(cookies,expectedKeys){
    var returnCookie = "" ,app = "";
    cookies.forEach(function(cookie){
        expectedKeys.forEach(key=>{
            if(cookie.startsWith(key)){
                returnCookie += app+ cookie.split(";")[0];
                app=";";
            }
        });
    });
    return returnCookie;
    
}

function fetchMaxRights(cookies){
    const options = { 
        url: maxRightsURL,
        method: 'GET',
        headers: {
            "Cookie":cookies,
            "Content-Type":"application/json"
        }
    };
    return new Promise(function(resolve, reject) {
        request(options, function(error, response, body) {
            var statusCode = response && response.statusCode;
            if (statusCode != 200) {
                reject(new Error("Error while fetching maxrights :"+body));
            }else{
                resolve(body);
            }
            
        });
    });
}

function fetchToken(cookies,body){
    var bodyStr = JSON.stringify({ "urm":JSON.parse(body)});
    //console.log(cookies);
    const options = {
        url: tokenURL,
        method: "POST",
        body: bodyStr,
        headers: {
            "Cookie":cookies,
            "Content-Type":"application/json"
        }
    }
    return new Promise(function(resolve,reject){
        request(options, function (error, response, body) {
            var statusCode = response && response.statusCode;
            if (statusCode != 200) {
                reject(new Error("Error while fetching token :"+body));
            }else{
                resolve(JSON.parse(body));
            }
        });
    });
}


module.exports.getToken=getToken;
module.exports.executeWithCookie=executeWithCookie;


