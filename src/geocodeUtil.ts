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

import * as common from "./common";
import { requestAsync } from "./requestAsync";

function toFeature(result: any) {
    return {
        "type": "Feature",
        "id": result.Location.LocationId,
        "geometry": {
            "type": "Point",
            "coordinates": [result.Location.DisplayPosition.Longitude, result.Location.DisplayPosition.Latitude]
        },
        "properties": result
    }
}

export async function geoCode(locationString: string) {

    let hasAppCode = true;
    let dataStr = await common.decryptAndGet("appDetails");
    let appInfo = common.getSplittedKeys(dataStr);
    
    if (!appInfo) {
        throw new Error("Account information out of date. Please re-run 'here configure'.");
    }

    const appId = appInfo[0];
    const appCode = appInfo[1];
    
    if(!appCode || appCode === 'undefined') {
        hasAppCode = false;
    }

    let result = await execGeoCode(locationString, hasAppCode, appInfo);

    if (result.response.statusCode !== 200) {
        if(result.response.statusCode === 401 && !hasAppCode) {
            await common.encryptAndStore("apiKeys", appId);
            result = await execGeoCode(locationString, hasAppCode, appInfo);
            if(result.response.statusCode !== 200) {
                if(result.response.statusCode === 401) {
                    console.log("API Keys for AppId "+ appId +" is disabled or not generated. \n" +
                        "Please generate/enable your API Keys at https://developer.here.com." +
                        "If already generated/enabled, please try again in a few minutes.");
                    process.exit(1);
                } else {
                    throw new Error(result.response.body);
                }
            }
        } else if(result.response.statusCode === 403) {
            console.log("Invalid credentials for AppId "+appId+". Please re-run 'here configure'.");
            process.exit(1);
        } else {
            throw new Error(result.response.body);
        }
        let geocodeJson = JSON.parse(result.body);
        if (geocodeJson.Response.View.length == 0) {
            console.log("Could not geocode the place '" + locationString + "'");
        } else {
            console.log(JSON.stringify(toGeoJson(geocodeJson), null, 2));
        }
    }
}


async function execGeoCode(locationString: string, hasAppCode: any, appInfo: any) {

    const appId = appInfo[0];
    if(hasAppCode === false) {

        let apiKeys = await common.decryptAndGet("apiKeys");
        appInfo = common.getSplittedKeys(apiKeys);

        if(!appInfo) {
            const accountInfo:string = await common.decryptAndGet("accountInfo","Please run `here configure` command.");
            const credentials = accountInfo.split("%%");
            const cookieData = await common.hereAccountLogin(credentials[0], credentials[1]);
            apiKeys = await common.getApiKeys(cookieData, appId).catch(err => {throw err});
            await common.encryptAndStore('apiKeys', apiKeys).catch(err => {throw err});
            appInfo = common.getSplittedKeys(apiKeys);
        }
    }

    if (!appInfo) {
        console.log("API Keys for AppId "+ appId +" is disabled or not generated. \n" +
                        "Please generate/enable your API Keys at https://developer.here.com.");
        process.exit(1);
    }
    let geocodeURL;
    if(hasAppCode) {
        geocodeURL = 'https://geocoder.api.here.com/6.2/geocode.json' +
        '?app_id=' + encodeURIComponent(appInfo[0]) +
        '&app_code=' + encodeURIComponent(appInfo[1]) +
        '&searchtext=' + encodeURIComponent(locationString);
    } else {
        geocodeURL = 'https://geocoder.ls.hereapi.com/6.2/geocode.json' +
        '?apiKey=' + encodeURIComponent(appInfo[1]) +
        '&searchtext=' + encodeURIComponent(locationString);
    }
    return await requestAsync({ url: geocodeURL });
}

function toGeoJson(responseJson: any) {
    const features = new Array();
    responseJson.Response.View[0].Result.forEach((element: any) => {
        features.push(toFeature(element));
    });
    return {
        "type": "FeatureCollection",
        "features": features
    };
}