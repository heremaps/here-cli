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
    const dataStr = await common.decryptAndGet("appDetails");

    const appInfo = common.getSplittedKeys(dataStr);
    if (!appInfo) {
        throw new Error("Account information out of date. Please re-run 'here configure'");
    }
    const geocodeURL = 'https://geocoder.cit.api.here.com/6.2/geocode.json' +
        '?app_id=' + encodeURIComponent(appInfo[0]) +
        '&app_code=' + encodeURIComponent(appInfo[1]) +
        '&searchtext=' + encodeURIComponent(locationString);

    const { response, body } = await requestAsync({ url: geocodeURL });

    if (response.statusCode !== 200)
        throw new Error(response.body);
    let geocodeJson = JSON.parse(body);
    if (geocodeJson.Response.View.length == 0) {
        return null;
    } else {
        let result = toGeoJson(geocodeJson);
        return result;
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