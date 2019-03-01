#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common = require("./common");
function summarize(features, spaceId, upload) {
    const set1 = new Set();
    const tagCountMap = {};
    const gemetryMap = {};
    const dateRanges = { minUpdated: Infinity, maxUpdated: 0, minCreated: Infinity, maxCreated: 0 };
    features.forEach(element => {
        const tags = element.properties["@ns:com:here:xyz"].tags;
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
            }
            else {
                gemetryMap[geoType] = 1;
            }
        }
        tags.forEach(tag => {
            set1.add(tag);
            if (tagCountMap[tag]) {
                tagCountMap[tag] = tagCountMap[tag] + 1;
            }
            else {
                tagCountMap[tag] = 1;
            }
        });
    });
    const myArr = Array.from(set1);
    const summaryObject = { "count": features.length, "tagInfo": { "uniqueTagCount": myArr.length, "allTags": myArr, tagSummary: tagCountMap, gemetryMap: gemetryMap, dateRanges: dateRanges } };
    generateSummaryText(spaceId, summaryObject, upload);
}
exports.summarize = summarize;
function generateSummaryText(spaceId, summaryObject, upload) {
    console.log("==========================================================");
    if (upload) {
        console.log("                     Upload Summary                     ");
    }
    else {
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
function printGeometry(summaryObject) {
    const geometryR = new Array();
    for (const x in summaryObject.tagInfo.gemetryMap) {
        geometryR.push({ GeometryType: x, Count: summaryObject.tagInfo.gemetryMap[x] });
    }
    if (geometryR.length > 0) {
        common.drawTable(geometryR, ["GeometryType", "Count"]);
    }
    else {
        console.log("No geometry object found");
    }
}
function printTags(summaryObject) {
    const tags = new Array();
    for (const x in summaryObject.tagInfo.tagSummary) {
        tags.push({ TagName: x, Count: summaryObject.tagInfo.tagSummary[x] });
    }
    tags.sort(function (a, b) {
        return b.Count - a.Count;
    });
    common.drawTable(tags, ["TagName", "Count"]);
}
function printDateRanges(summaryObject) {
    console.log("Features created from " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.minCreated) + " to " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.maxCreated));
    console.log("Features updated from " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.minUpdated) + " to " + common.timeStampToLocaleString(summaryObject.tagInfo.dateRanges.maxUpdated));
}
function analyze(features, properties, spaceId) {
    const propSummary = {};
    //console.log(features);
    features.forEach(element => {
        element.properties.id = element.id;
        element = element.properties;
        properties.forEach(prop => {
            let tag = prop + ":" + element[prop];
            if (propSummary[tag]) {
                let cObj = propSummary[tag];
                cObj.Count = cObj.Count + 1;
            }
            else {
                propSummary[tag] = { PropertyName: prop, Value: element[prop], Count: 1 };
            }
        });
    });
    printProperties(propSummary, spaceId);
}
exports.analyze = analyze;
function printProperties(propSummary, spaceId) {
    const tags = new Array();
    const uniqueTagCount = [];
    for (const x in propSummary) {
        tags.push(propSummary[x]);
    }
    const uniqueProps = tags.map(obj => obj.PropertyName)
        .filter((value, index, self) => self.indexOf(value) === index);
    const gropedTags = groupBy(tags, "PropertyName");
    uniqueProps.sort(function (a, b) {
        return alphabetical(a, b);
    });
    let arrangedTags = new Array();
    uniqueProps.forEach(prop => {
        const da = gropedTags[prop];
        da.sort(function (a, b) {
            return b.Count - a.Count;
        });
        arrangedTags = arrangedTags.concat(gropedTags[prop]);
    });
    common.drawTable(arrangedTags, ["PropertyName", "Value", "Count"]);
    printUniquePropertyName(arrangedTags, spaceId);
}
function alphabetical(a, b) {
    const a1 = a.toLowerCase();
    const b1 = b.toLowerCase();
    if (a1 < b1) {
        return -1;
    }
    else if (a1 > b1) {
        return 1;
    }
    else {
        return 0;
    }
}
function printUniquePropertyName(tags, spaceId) {
    let uniqueTagCount = [];
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
function groupBy(array, prop) {
    let outMap = [];
    array.forEach(a => {
        const pName = a[prop];
        let value = outMap[pName];
        if (!value) {
            value = new Array();
            outMap[pName] = value;
            console.log(pName);
        }
        value.push(a);
    });
    return outMap;
}
