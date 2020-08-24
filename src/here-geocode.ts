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

import * as program from "commander";
import * as common from "./common";
import { geoCodeString } from "./geocodeUtil";

program
    .version('0.1.0')
    .name('here geocode')
    .parse(process.argv);
geoCode(process.argv[2]).catch(err => console.error(err));

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

async function geoCode(locationString: string) {

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

    let response = await geoCodeString(locationString, hasAppCode, appInfo);

    let geocodeJson = JSON.parse(response.body);
    if (geocodeJson.Response.View.length == 0) {
        console.log("Could not geocode the place '" + locationString + "'");
    } else {
        console.log(JSON.stringify(toGeoJson(geocodeJson), null, 2));
    }
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
