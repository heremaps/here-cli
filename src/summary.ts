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

export function summarize(features: any[], spaceId: string, upload: boolean) {
    const set1 = new Set();
    const tagCountMap: { [fieldName: string]: any } = {};
    const gemetryMap: { [fieldName: string]: any } = {};
    const dateRanges = { minUpdated: Infinity, maxUpdated: 0, minCreated: Infinity, maxCreated: 0 };

    features.forEach(element => {
        const tags = element.properties["@ns:com:here:xyz"].tags as string[];
        const geoType = (element.geometry) ? element.geometry["type"] : null;

        const updatedAt = element.properties["@ns:com:here:xyz"].updatedAt;
        if (updatedAt < dateRanges.minUpdated) {
            dateRanges.minUpdated = updatedAt;
        }

        if (updatedAt > dateRanges.maxUpdated) {
            dateRanges.maxUpdated = updatedAt;
        }
        const createdAt = element.properties["@ns:com:here:xyz"].createdAt;
        if (createdAt < dateRanges.minCreated) {
            dateRanges.minCreated = createdAt;
        }

        if (createdAt > dateRanges.maxCreated) {
            dateRanges.maxCreated = createdAt;
        }
        if (geoType) {
            if (gemetryMap[geoType]) {
                gemetryMap[geoType] = gemetryMap[geoType] + 1;
            } else {
                gemetryMap[geoType] = 1;
            }
        }

        tags.forEach(tag => {
            set1.add(tag);
            if (tagCountMap[tag]) {
                tagCountMap[tag] = tagCountMap[tag] + 1;
            } else {
                tagCountMap[tag] = 1;
            }
        });
    });
    const myArr = Array.from(set1);
    const summaryObject = { "count": features.length, "tagInfo": { "uniqueTagCount": myArr.length, "allTags": myArr, tagSummary: tagCountMap, gemetryMap: gemetryMap, dateRanges: dateRanges } };
    generateSummaryText(spaceId, summaryObject, upload);
}

function generateSummaryText(spaceId: string, summaryObject: any, upload: boolean) {
    console.log("==========================================================");
    if (upload) {
        console.log("                     Upload Summary                     ");
    } else {
        console.log("                     Summary for Space " + spaceId);
    }
    console.log("==========================================================");
    console.log("Total " + summaryObject.count + " features");
    printGeometry(summaryObject);
    console.log("Total unique tag Count : " + summaryObject.tagInfo.uniqueTagCount);
    console.log("Unique tag list  :" + JSON.stringify(summaryObject.tagInfo.allTags));
    printTags(summaryObject);
    if (!upload) {
        printDateRanges(summaryObject);
    }
}

function printGeometry(summaryObject: any) {
    const geometryR = new Array();
    for (const x in summaryObject.tagInfo.gemetryMap) {
        geometryR.push({ GeometryType: x, Count: summaryObject.tagInfo.gemetryMap[x] });
    }
    if (geometryR.length > 0) {
        common.drawTable(geometryR, ["GeometryType", "Count"]);
    } else {
        console.log("No geometry object found");
    }
}

function printTags(summaryObject: any) {
    const tags = new Array();
    for (const x in summaryObject.tagInfo.tagSummary) {
        tags.push({ TagName: x, Count: summaryObject.tagInfo.tagSummary[x] });
    }
    tags.sort(function (a, b) {
        return b.Count - a.Count;
    });
    common.drawTable(tags, ["TagName", "Count"]);
}

function printDateRanges(summaryObject: any) {
    console.log("Features created from " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.minCreated) + " to " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.maxCreated));
    console.log("Features updated from " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.minUpdated) + " to " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.maxUpdated));
}


export function analyze(features: any[], properties: string[], spaceId: string) {
    const propSummary: { [fieldName: string]: any } = {};
    //console.log(features);
    features.forEach(element => {
        element.properties.id = element.id;
        element = element.properties;
        properties.forEach(prop => {
            let tag = prop + ":" + element[prop];
            if (propSummary[tag]) {
                let cObj = propSummary[tag];
                cObj.Count = cObj.Count + 1;
            } else {
                propSummary[tag] = { PropertyName: prop, Value: element[prop], Count: 1 };
            }
        });
    });
    printProperties(propSummary, spaceId);
}

function printProperties(propSummary: any, spaceId: string) {
    const tags = new Array();
    const uniqueTagCount = [];
    for (const x in propSummary) {
        tags.push(propSummary[x]);
    }
    const uniqueProps = tags.map(obj => obj.PropertyName)
        .filter((value, index, self) => self.indexOf(value) === index)
    const gropedTags = groupBy(tags, "PropertyName");
    uniqueProps.sort(function (a, b) {
        return alphabetical(a, b);
    });
    let arrangedTags = new Array();
    uniqueProps.forEach(prop => {
        const da = gropedTags[prop];
        da.sort(function (a: any, b: any) {
            return b.Count - a.Count;
        });
        arrangedTags = arrangedTags.concat(gropedTags[prop]);
    });
    common.drawTable(arrangedTags, ["PropertyName", "Value", "Count"]);
    printUniquePropertyName(arrangedTags, spaceId);
}

function alphabetical(a: string, b: string) {
    const a1 = a.toLowerCase();
    const b1 = b.toLowerCase();
    if (a1 < b1) {
        return -1;
    } else if (a1 > b1) {
        return 1;
    } else {
        return 0;
    }
}

function printUniquePropertyName(tags: any[], spaceId: string) {
    let uniqueTagCount: number[] = [];
    tags.forEach(tag => {
        let val = uniqueTagCount[tag.PropertyName];
        if (val)
            val = val + 1;
        else
            val = 1;
        uniqueTagCount[tag.PropertyName] = val;
    });
    const uProps = new Array();
    for (const k in uniqueTagCount) {
        uProps.push({ PropertyName: k, Count: uniqueTagCount[k] });
    }
    uProps.sort(function (a, b) {
        return b.Count - a.Count;
    });
    console.log(`Total unique property values in space ${spaceId} : \n`);
    common.drawTable(uProps, ["PropertyName", "Count"]);
}

function groupBy(array: any[], prop: string) {
    let outMap: any[] = [];
    array.forEach(a => {
        const pName = a[prop];
        let value = outMap[pName];
        if (!value) {
            value = new Array();
            outMap[pName] = value;
            console.log(pName);
        }
        value.push(a);
    })
    return outMap;
}
