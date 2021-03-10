#!/usr/bin/env node

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

const bboxDirections = ["west", "south", "east", "north"];
import * as common from "./common";

export function getSpaceDataFromXyz(id: string, options: any) {
    return new Promise<any>(function (resolve, reject) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (offset: string) {
            let uri = "/hub/spaces/" + id;
            let spFunction;
            if (options.bbox) {
                spFunction = "bbox";
                options.limit = 100000;//Max limit of records space api supports 
            } else if(options.search) {
                spFunction = "search"
            } else if(options.id){
                spFunction = "features/"+options.id
            } else {
                spFunction = "iterate";
            }
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
                if (options.bbox) {
                    var bboxarray = options.bbox.split(",");
                    if (bboxarray.length !== 4) {
                        console.error(`\nboundingbox input size is not proper - "${options.bbox}"`);
                        process.exit(1);
                    }
                    bboxarray.forEach(function (item: string, i: number) {
                        if (item && item != "") {
                            let number = parseFloat(item.toLowerCase());
                            if (isNaN(number)) {
                                console.error(`\nLoading space data using bounding box failed - "${item}" is not a valid number`);
                                process.exit(1);
                            }
                            uri = uri + "&" + bboxDirections[i] + "=" + number;
                        }
                    });
                }
                if(options.search){
                    uri = uri + "&" + common.replaceOpearators(options.search);
                }
                if (offset && offset !== '0') {
                    uri = uri + "&handle=" + offset;
                }
                if (options.tags) {
                    uri = uri + "&tags=" + options.tags;
                }
            }
            return uri;
        };
        if (!options.totalRecords) {
            options.totalRecords = 500000;
        }
        let recordLength = 0;
        let features = new Array();
        let jsonOut;
        (async () => {

            try {
                let cHandle = options.handle ? options.handle : 0;
                if (cHandle === 0 && !options.ignoreLogs) {
                    process.stdout.write("Operation may take a while. Please wait...");
                }
                do {
                    if(!options.ignoreLogs){
                        process.stdout.write(".");
                    }
                    let response = await execute(
                        getUrI(String(cHandle)),
                        "GET",
                        cType,
                        "",
                        options.token,
                        true
                    );
                    jsonOut = response.body;
                    if (jsonOut.constructor !== {}.constructor) {
                        jsonOut = JSON.parse(jsonOut);
                    }
                    cHandle = jsonOut.handle;
                    if (jsonOut.features) {
                        recordLength += jsonOut.features.length;
                        features = features.concat(jsonOut.features);
                    } else {
                        cHandle = -1;
                    }
                    if (options.currentHandleOnly) {
                        cHandle = -1;
                        break;
                    }
                } while (cHandle >= 0 && recordLength < options.totalRecords);
                if (!options.currentHandleOnly && !options.ignoreLogs) {
                    process.stdout.write("\n");
                }
                jsonOut.features = features;
                resolve(jsonOut);
            } catch (error) {
                console.error(`\ngetting data from Data Hub space failed: ${JSON.stringify(error)}`);
                reject(error);
            }
        })();
    });
}

//function created here to pass the test. TODO - rewrite the test code
export async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false, setAuthorization: boolean = true) {
    if (!token) {
        token = await common.verify();
    }
    return await common.execInternal(uri, method, contentType, data, token, gzip, setAuthorization);
}