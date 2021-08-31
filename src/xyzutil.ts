#!/usr/bin/env node

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

const bboxDirections = ["west", "south", "east", "north"];
import * as common from "./common";
import * as catalogUtil from "./catalogUtil";
import * as summary from "./summary";
import * as hexbin from "./hexbin";
import * as moment from 'moment';
import * as fs from "fs";
const path = require('path');
const open = require("open");
import * as glob from 'glob';
import * as inquirer from "inquirer";
import * as transform from "./transformutil";
const XLSX = require('xlsx');
const gsv = require("geojson-validation");
let cq = require("block-queue");

let choiceList: { name: string, value: string }[] = [];

let joinValueToFeatureIdMap: Map<string, string> = new Map();

const filesToUpload = [
    {
        type: "checkbox",
        name: "selectedFiles",
        message: "Select the files to be uploaded",
        choices: choiceList
    }
];

const titlePrompt = [
    {
        type: 'input',
        name: 'title',
        message: 'Enter a title for the new space: '
    }
];

let catalogHrn: string,
    layer: any;
let idMsg = "Data Hub space ";
export function setCatalogHrn(hrn: string){
    catalogHrn = hrn;
    idMsg = "Interactive map layer ";
}

export function setLayer(layerConfig: any){
    layer = layerConfig;
}

export function getSpaceDataFromXyz(id: string, options: any) {
    return new Promise<any>(function (resolve, reject) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (offset: string) {
            let uri = id;
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

export async function uploadToXyzSpace(id: string, options: any) {
    //(async () => {
    let tags = "";

    let printErrors = false;
    if (options.errors) {
        printErrors = true;
    }

    //Default chunk size set as 200
    if (!options.chunk) {
        options.chunk = 200;
    }

    /*
    if (options.unique && options.override) {
        console.log(
            "conflicting options -- you must use either unique or override. Refer to 'here xyz upload -h' for help"
        );
        process.exit(1);
    } else if (!options.override) {
        options.unique = true;
    }
    */

    if (options.assign && options.stream) {
        console.log(
            "conflicting options - you cannot choose assign mode while selecting streaming option"
        );
        process.exit(1);
    }

    let files: string[] = [''];//Initialising as blank string, so that if options.file is not given loop will execute atleast once and else condition will be executed
    if(options.batch){
        files = [];
        if(options.batch != true && options.batch.toLowerCase().indexOf(".") == -1){
            options.batch = "*."+options.batch;
        }
        let directories = options.file.split(',');
        for(let directory of directories) {
            if(!(fs.existsSync(directory) && fs.lstatSync(directory).isDirectory())){
                console.log("--batch option requires directory path in --file option");
                process.exit(1);
            }
            if(options.batch == true){
                const allFiles = fs.readdirSync(directory, { withFileTypes: true })
                    .filter(dirent => dirent.isFile())
                    .map(dirent => dirent.name);
                allFiles.forEach(function (item: any) {
                    choiceList.push({'name': item, 'value': path.join(directory,item)});
                });
            } else {
                files = files.concat(glob.sync(path.join(directory,options.batch)));
                if(options.batch == 'shp' || options.batch == '*.shp'){
                    const allDirectories = fs.readdirSync(directory, { withFileTypes: true })
                        .filter(dirent => dirent.isDirectory())
                        .map(dirent => dirent.name);
                    for(let subDirectory of allDirectories) {
                        files = files.concat(glob.sync(path.join(directory,subDirectory,options.batch)));
                    }
                }
            }
        }
        if(options.batch == true){
            let answers: any = await inquirer.prompt(filesToUpload);
            files = answers.selectedFiles;
        }
        if(files.length == 0){
            console.log("No files found of the specified format in the directory");
            process.exit(1);
        }
    } else if(options.file){
        files = options.file.split(',');
    }

    for(let file of files) {
        options.file = file;
        let startTime = new Date();
        if(!options.stream && options.file && !(options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".zip") != -1 || options.file.toLowerCase().indexOf(".gpx") != -1 || options.file.toLowerCase().indexOf(".xls") != -1 || options.file.toLowerCase().indexOf(".xlsx") != -1)){
            console.log("you can stream your uploads of CSV, GeoJSON and GeoJSONL files using the -s option. This will allow you to upload very large files, and will dramatically reduce the upload time for files of any size.");
        }
        if(options.stream && options.file && (options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".zip") != -1 || options.file.toLowerCase().indexOf(".gpx") != -1 || options.file.toLowerCase().indexOf(".xls") != -1 || options.file.toLowerCase().indexOf(".xlsx") != -1)){
            console.log("Stream option is not supported for this file type, please execute the command without -s / --stream option.");
            process.exit(1);
        }

        if (options.file) {
            console.log("uploading file - " + file);
            const fs = require("fs");
            if (options.file.toLowerCase().indexOf(".geojsonl") != -1) {
                if (!options.stream) {
                    const result: any = await transform.readLineFromFile(options.file, 100);
                    await uploadData(id, options, tags, { type: "FeatureCollection", features: common.collate(result) }, true, options.ptag, options.file, options.id, printErrors);
                } else {
                    let queue = streamingQueue();
                    await transform.readLineAsChunks(options.file, options.chunk ? options.chunk : 1000, options, function (result: any) {
                        return new Promise((res, rej) => {
                            (async () => {
                                if (result.length > 0) {
                                    await queue.send({ id: id, options: options, tags: tags, fc: { type: "FeatureCollection", features: common.collate(result) }, retryCount: 3 });
                                }
                                res(queue);
                            })();
                        });
                    });
                    while (queue.chunksize != 0) {
                        await new Promise(done => setTimeout(done, 1000));
                    }
                }
            } else if (options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".zip") != -1) {
                let result = await transform.readShapeFile(
                    options.file,
                );
                await uploadData(
                    id,
                    options,
                    tags,
                    result,
                    true,
                    options.ptag,
                    options.file,
                    options.id
                );
            } else if (options.file.toLowerCase().indexOf(".csv") != -1 || options.file.toLowerCase().indexOf(".txt") != -1) {
                if (!options.stream) {
                    let result = await transform.read(
                        options.file,
                        true,
                        { headers: true, delimiter: options.delimiter, quote: options.quote }
                    );
                    const object = {
                        features: await transform.transform(
                            result,
                            options
                        ),
                        type: "FeatureCollection"
                    };
                    await uploadData(
                        id,
                        options,
                        tags,
                        object,
                        true,
                        options.ptag,
                        options.file,
                        options.id
                    );
                } else {
                    let queue = streamingQueue();
                    await transform.readCSVAsChunks(options.file, options.chunk ? options.chunk : 1000, options, function (result: any) {
                        return new Promise((res, rej) => {
                            (async () => {
                                if (result.length > 0) {
                                    const fc = {
                                        features: await transform.transform(
                                            result,
                                            options
                                        ),
                                        type: "FeatureCollection"
                                    };
                                    await queue.send({ id: id, options: options, tags: tags, fc: fc, retryCount: 3 });
                                }
                                res(queue);
                            })();
                        });

                    });
                    while (queue.chunksize != 0) {
                        await new Promise(done => setTimeout(done, 1000));
                    }
                }
            } else if (options.file.indexOf(".gpx") != -1) {
                let result = await transform.read(
                    options.file,
                    false,
                    {}
                );
                const object = {
                    features: await transform.transformGpx(
                        result,
                        options
                    ),
                    type: "FeatureCollection"
                };
                await uploadData(
                    id,
                    options,
                    tags,
                    object,
                    true,
                    options.ptag,
                    options.file,
                    options.id
                );
            } else if (options.file.toLowerCase().indexOf(".xls") != -1 || options.file.toLowerCase().indexOf(".xlsx") != -1) {
                const workbook = await transform.readExcelFile(
                    options.file
                );
                var sheetNameList = workbook.SheetNames;
                for(let sheetName of sheetNameList) {
                    console.log("uploading sheet - " + sheetName);
                    let result = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defVal : ""});
                    const object = {
                        features: await transform.transform(
                            result,
                            options
                        ),
                        type: "FeatureCollection"
                    };
                    await uploadData(
                        id,
                        options,
                        tags,
                        object,
                        true,
                        options.ptag,
                        options.file,
                        options.id
                    );
                }
            } else {
                if (!options.stream) {
                    let result = await transform.read(
                        options.file,
                        false
                    );
                    let object = JSON.parse(result);
                    if(!(object.features && object.features.length > 0 && object.features[0].type == 'Feature') && !(object.type && object.type == 'Feature')){
                        object = {
                            features: await transform.transform(
                                object,
                                options
                            ),
                            type: "FeatureCollection"
                        };
                    }
                    await uploadData(
                        id,
                        options,
                        tags,
                        object,
                        true,
                        options.ptag,
                        options.file,
                        options.id
                    );
                } else {
                    let queue = streamingQueue();
                    let c = 0;
                    await transform.readGeoJsonAsChunks(options.file, options.chunk ? options.chunk : 1000, options, async function (result: any) {
                        if (result.length > 0) {
                            const fc = {
                                features: result,
                                type: "FeatureCollection"
                            };
                            await queue.send({ id: id, options: options, tags: tags, fc: fc, retryCount: 3 });
                        }
                        return queue;
                    });
                    while (queue.chunksize != 0) {
                        await new Promise(done => setTimeout(done, 1000));
                    }
                }
            }
        } else {
            const getStdin = require("get-stdin");
            await getStdin().then((str: string) => {
                try {
                    const obj = JSON.parse(str);
                    uploadData(
                        id,
                        options,
                        tags,
                        obj,
                        false,
                        options.ptag,
                        null,
                        options.id
                    );
                } catch (e) {
                    console.log(
                        "Empty or invalid input to upload. Refer to 'here xyz upload -h' for help"
                    );
                    process.exit(1);
                }
            });
        }
        let totalTime = ((new Date().getTime() - startTime.getTime()) / 1000);
        console.log(options.totalCount + " features uploaded to " + idMsg + "'" + id + "' in " + totalTime + " seconds, at the rate of " + Math.round(options.totalCount / totalTime) + " features per second");
    }
    if(!catalogHrn){
        await updateCommandMetadata(id, options, false, null);
    }
    console.log("");
    //console.log("upload completed successfully");
    //})();
}

function uploadData(
    id: string,
    options: any,
    tags: any,
    object: any,
    isFile: boolean,
    tagProperties: any,
    fileName: string | null,
    uid: string,
    printFailed: boolean = false
): any {
    return new Promise((resolve, reject) => {
        let upresult: any = { success: 0, failed: 0, entries: [] };
        if (object.type == "Feature") {
            object = { features: [object], type: "FeatureCollection" };
        }

        if (options.errors) {
            printFailed = true;
        }

        if (options.assign) {
            //console.log("assign mode on");
            const questions = common.createQuestionsList(object);
            inquirer.prompt(questions).then((answers: any) => {
                if (options.ptag === undefined) {
                    options.ptag = "";
                }
                options.ptag = options.ptag + answers.tagChoices;
                if (options.id === undefined) {
                    options.id = "";
                }
                options.id = options.id + answers.idChoice;
                //console.log(options.ptag);
                //console.log("unique key - " + options.id);
                //Need to be inside if, else this will be executed before user choice is inserted as its async
                uploadDataToSpaceWithTags(
                    id,
                    options,
                    tags,
                    object,
                    false,
                    options.ptag,
                    fileName,
                    options.id,
                    upresult,
                    printFailed
                ).then(x => resolve(x)).catch((error) => reject(error));

            });
        } else {
            uploadDataToSpaceWithTags(
                id,
                options,
                tags,
                object,
                false,
                options.ptag,
                fileName,
                options.id,
                upresult,
                printFailed
            ).then(x => resolve(x)).catch((error) => reject(error));
        }

    });

}

async function uploadDataToSpaceWithTags(
    id: string,
    options: any,
    tags: any,
    object: any,
    isFile: boolean,
    tagProperties: any,
    fileName: string | null,
    uid: string,
    upresult: any,
    printFailed: boolean
) {
    return new Promise(async (resolve, reject) => {
        gsv.valid(object, async function (valid: boolean, errs: any) {
            if (!valid) {
                console.log(errs);
                reject(errs);
                return;
            }
            const featureOut = await mergeAllTags(
                object.features,
                tags,
                tagProperties,
                fileName,
                uid,
                options
            );

            try {
                let uri = id + "/features" + "?clientId=cli";
                if(!catalogHrn && options.tags){
                    uri = uri + "&addTags=" + options.tags.toLowerCase();
                }
                if (options.stream) {
                    upresult = await iterateChunks([featureOut], uri, 0, 1, options.token, upresult, printFailed);
                } else {
                    const chunks = options.chunk
                        ? chunkify(featureOut, parseInt(options.chunk))
                        : [featureOut];
                    upresult = await iterateChunks(chunks, uri, 0, chunks.length, options.token, upresult, printFailed);
                    process.stdout.write("\n");
                    // let tq =  taskQueue(8,chunks.length);
                    // chunks.forEach(chunk=>{
                    //     tq.send({chunk:chunk,url:id + "/features"});
                    // });
                    // await tq.shutdown();
                }
            } catch (e) {
                reject(e);
                return;
            }

            if (!options.stream) {
                if (isFile)
                    console.log(
                        "'" +
                        options.file +
                        "' uploaded to " + idMsg + "'" +
                        id +
                        "'"
                    );
                else
                    console.log("data upload to " + idMsg + "'" + id + "' completed");
                if (upresult.failed > 0) {
                    console.log("not all the features could be successfully uploaded -- to print rejected features, run command with -e")
                    console.log("=============== Upload Summary ============= ");
                    upresult.total = featureOut.length;
                    console.table(upresult);
                } else {
                    summary.summarize(featureOut, id, true, options);
                }
                options.totalCount = featureOut.length;

            }
            resolve(upresult);
        });
    });
}

async function iterateChunks(chunks: any, url: string, index: number, chunkSize: number, token: string, upresult: any, printFailed: boolean): Promise<any> {
    const item = chunks.shift();
    const fc = { type: "FeatureCollection", features: item };
    const response = await execute(
        url,
        "POST",
        "application/geo+json",
        JSON.stringify(fc, (key, value) => {
            if (typeof value === 'string') {
                return value.replace(/\0/g, '');
            }
            return value;
        }),
        token,
        true
    );

    if (response.statusCode >= 200 && response.statusCode < 210) {
        let res = response.body;
        if (res.features)
            upresult.success = upresult.success + res.features.length;
        if (res.failed) {
            upresult.failed = upresult.failed + res.failed.length;
            //upresult.entries = upresult.entries.concat(res.failed);
            for (let n = 0; n < res.failed.length; n++) {
                const failedentry = res.failed[n];
                if (printFailed) {
                    console.log("Failed to upload : " + JSON.stringify(failedentry));
                }
            }
        }
    }
    index++;
    process.stdout.write("\ruploaded " + ((index / chunkSize) * 100).toFixed(2) + "%");
    if (index == chunkSize) {
        return upresult;
    }
    return await iterateChunks(chunks, url, index, chunkSize, token, upresult, printFailed);
}

async function iterateChunk(chunk: any, url: string, token: string | null = null) {
    const fc = { type: "FeatureCollection", features: chunk };
    const response = await execute(
        url,
        "POST",
        "application/geo+json",
        JSON.stringify(fc, (key, value) => {
            if (typeof value === 'string') {
                return value.replace(/\0/g, '');
            }
            return value;
        }),
        token,
        true
    );
    return response.body;
}

function chunkify(data: any[], chunksize: number) {
    let chunks: any[] = [];
    for (const k in data) {
        const item = data[k];
        if (!chunks.length || chunks[chunks.length - 1].length == chunksize)
            chunks.push([]);
        chunks[chunks.length - 1].push(item);
    }
    return chunks;
}

function streamingQueue() {
    let queue = cq(10, function (task: any, done: Function) {
        uploadData(task.id, task.options, task.tags, task.fc,
            true, task.options.ptag, task.options.file, task.options.id)
            .then((result: any) => {
                queue.uploadCount += result.success;
                queue.failedCount += result.failed;
                process.stdout.write("\ruploaded feature count :" + queue.uploadCount + ", failed feature count :" + queue.failedCount);
                queue.chunksize--;
                done();
            }).catch((err: any) => {
                if(task.options.errors){
                    console.log("\nFailed to upload : " + JSON.stringify(err));
                } else if(err.message.indexOf('The longitude (1st) value in coordinates of the Point is out of bounds') !== -1){
                    console.log("\nsome features have longitudes out of bounds (> 180 or < -180) -- use -e to see the full error message");
                }
                queue.failedCount += task.fc.features.length;
                process.stdout.write("\ruploaded feature count :" + queue.uploadCount + ", failed feature count :" + queue.failedCount);
                queue.chunksize--;
                done();
            });
    });
    queue.uploadCount = 0;
    queue.chunksize = 0;
    queue.failedCount = 0;
    queue.send = async function (obj: any) {
        while (this.chunksize > 25) {
            await new Promise(done => setTimeout(done, 1000));
        }
        this.push(obj);
        this.chunksize++;
    }
    queue.shutdown = async () => {
        queue.shutdown = true;
        while (queue.chunksize != 0) {
            await new Promise(done => setTimeout(done, 1000));
        }
        return true;
    }
    return queue;
}

async function mergeAllTags(
    features: any,
    tags: string,
    tagProperties: any,
    fileName: string | null,
    idStr: string,
    options: any,
) {
    let inputTags: Array<string> = [];
    tags.split(",").forEach(function (item) {
        if (item && item != "") inputTags.push(item.toLowerCase());
    });
    const tps = tagProperties ? tagProperties.split(",") : null;
    let checkId = false;
    const featureMap: Array<string> = [];
    const duplicates = new Array();
    for (let item of features) {
        let finalTags = inputTags.slice();
        let origId = null;
        //Generate id only if doesnt exist
        if (idStr) {
            const fId = common.createUniqueId(idStr, item);
            if (fId && fId != "") {
                item.id = fId;
            }
        } else if(!item.id && options.keys){
            const propertyValue = item.properties[options.csvProperty];
            if(joinValueToFeatureIdMap.get(propertyValue)){
                item.id = joinValueToFeatureIdMap.get(propertyValue);
            } else {
                options.search = "p." + options.spaceProperty + "='" + propertyValue + "'";
                if(options.filter){
                    options.search = options.search + '&p.' + options.filter;
                }
                let jsonOut = await getSpaceDataFromXyz(options.primarySpace, options);
                if (jsonOut.features && jsonOut.features.length === 0) {
                    console.log("\nNo feature available for the required value - " + propertyValue);
                    finalTags.push("no_match");
                } else {
                    item.id = jsonOut.features[0].id;
                    joinValueToFeatureIdMap.set(propertyValue, jsonOut.features[0].id);
                }
            }
            console.log("featureId for property " + propertyValue + " is - " + item.id);
        } else {
            if (options.override) {
                checkId = true;
                origId = item.id;
                item.id = undefined;
                const id = common.md5Sum(JSON.stringify(item));
                item.id = id;
                if (featureMap[item.id]) {
                    const dupe = {
                        id: origId,
                        geometry: JSON.stringify(item.geometry),
                        properties: JSON.stringify(item.properties)
                    };
                    duplicates.push(dupe);
                }
            }
        }
        if (options.override) {
            if (!featureMap[item.id]) {
                featureMap[item.id] = item;
            }
        }
        if (!item.properties) {
            item.properties = {};
        }
        let metaProps = item.properties["@ns:com:here:xyz"];
        if (!metaProps) {
            metaProps = {};
        }
        if (metaProps && metaProps.tags) {
            finalTags = finalTags.concat(metaProps.tags);
        }
        if (tps) {
            tps.forEach(function (tp: any) {
                if (item.properties[tp] || item.properties[tp] === false || item.properties[tp] === 0) {
                    if (Array.isArray(item.properties[tp])) {
                        for (let i in item.properties[tp]) {
                            common.addTagsToList(item.properties[tp][i], tp, finalTags);
                        }
                    } else {
                        common.addTagsToList(item.properties[tp], tp, finalTags);
                    }
                }
            });
        }

        if(options.date){
            try{
                options.date.split(",").forEach((element: any) => {
                    let value = item.properties[element];
                    if(value){
                        let dateValue: moment.Moment;
                        if(!isNaN(Number(value)) && !isNaN(parseFloat(value)) && isFinite(parseFloat(value))){
                            dateValue = moment(new Date(parseFloat(value.toString())));
                        } else {
                            /*
                            if(value.indexOf("Z") == -1){
                                value = value + ' Z+00:00';
                            }
                            */
                            dateValue = moment(new Date(value));
                        }
                        if(dateValue && dateValue.isValid()){
                            item.properties['xyz_timestamp_'+element] = dateValue.valueOf();
                            item.properties['xyz_iso8601_'+element] = dateValue.toISOString(true).substring(0,dateValue.toISOString(true).length-6);
                            if(options.datetag){
                                common.addDatetimeTag(dateValue, element, options, finalTags);
                            }
                            if(options.dateprops){
                                common.addDatetimeProperty(dateValue, element, options, item);
                            }
                        }
                    }
                });
            } catch(e){
                console.log("Invalid time format - " + e.message);
                process.exit(1);
            }
        }
        
        if (origId) {
            metaProps.originalFeatureId = origId;
        }
        if(finalTags && finalTags.length > 0){
            metaProps.tags = common.uniqArray(finalTags);
        }
        item.properties["@ns:com:here:xyz"] = metaProps;
    };
    const nameTag = fileName ? common.getFileName(fileName) : null;
    if (nameTag) {
        if(!options.tags){
            options.tags = nameTag;
        } else if(options.tags.indexOf(nameTag) == -1){
            options.tags = options.tags + "," + nameTag;
        }
    }

    if (!options.override && duplicates.length > 0) {
        const featuresOut = new Array();
        for (const k in featureMap) {
            featuresOut.push(featureMap[k]);
        }
        console.log(
            "***************************************************************"
        );
        console.log(
            "We detected duplicate features in this chunk and only the first was uploaded. Features that had duplicates:\n"
        );
        common.drawTable(duplicates, ["id", "geometry", "properties"]); // TODO: suppress geometry of lines,polygons
        console.log(
            "uploading " +
            featuresOut.length +
            " out of " +
            features.length +
            " records"
        );
        console.log(
            "***************************************************************\n"
        );
        return featuresOut;
    } else {
        return features;
    }
}

export async function updateCommandMetadata(id: string, options: any, isClear: boolean = false, favCommand: string | null = null){
    let history: Array<any> = [];
    let data: any = {};
    if(favCommand){
        data = {
            client: {
                'favouriteCommand': favCommand
            }
        }
    } else {
        let spaceData = await getSpaceMetaData(id, options.token);
        if(spaceData.client && spaceData.client.history){
            history = spaceData.client.history;
        }
        let commandArray: Array<string> = [];
        for(let i:number=4; i < process.argv.length; i++){
            let element = process.argv[i];
            if(element === '--token'){
                i++;//removing token explicitely so that its not visible in space history
            } else {
                element = element.includes(' ') ? "'" + element.trim() + "'": element.trim();
                commandArray.push(element);
            }
        }
        let command = {
            "command" : `here xyz upload ${id} ` + commandArray.join(" "),
            "timestamp": moment().toISOString(true)
        }
        history = [command].concat(history);
        data = {
            client: {
                'history' : isClear ? [] : history.slice(0, 3)
            }
        }
    }
    const uri = id + "?clientId=cli";
    const cType = "application/json";
    const response = await execute(uri, "PATCH", cType, data);
    return response.body;
}

export async function showSpace(id: string, options: any) {
    let uri = id;
    let cType = "application/json";
    let tableFunction = common.drawTable;
    let requestMethod = "GET";
    let postData: string = "";

    if(options.vector && options.spatial) {
        console.log("options 'vector' and 'spatial' can not be used together, try 'web'");
        process.exit(1);
    }

    if(options.permanent && !(options.web || options.vector)) {
        console.log("option 'permanent' can only be used with either 'web' or 'vector' options");
        process.exit(1);
    }

    if(options.limit && options.all){
        console.log("options 'limit' and 'all' can not be used together");
        process.exit(1);
    }

    if(options.spatial && !(options.radius || options.center || options.feature || options.geometry)) {
        console.log("spatial option needs one of the following options to search - --center and --radius, a 'featureID', or a geometry");
        process.exit(1);
    }

    if(options.center && !options.radius){
        console.log("'radius' option is required for a --center --spatial search");
        process.exit(1);
    }

    if(options.h3 && !options.feature){
        console.log("'feature' option is required for a --h3 --spatial search");
        process.exit(1);
    }

    if(options.web && (options.geometry || options.h3)) {
        let invalidOption;
        if(options.geometry){
            invalidOption = "geometry"
        } else {
            invalidOption = "h3"
        }
        console.log("usage of options web and " + invalidOption + " together is not yet supported, please try option web with radius, feature/center options");
        process.exit(1);
    }

    if(options.all){
        options.totalRecords = Number.MAX_SAFE_INTEGER;
        options.currentHandleOnly = true;
        options.handle = 0;
        options.ignoreLogs = true;
        if(options.chunk){
            options.limit = options.chunk;
        }
        let cHandle;
        if(!options.geojsonl){
            process.stdout.write('{"type":"FeatureCollection","features":[');
        }
        do {
            let jsonOut = await getSpaceDataFromXyz(id, options);
            cHandle = jsonOut.handle;
            if (jsonOut.features && jsonOut.features.length > 0) {
                jsonOut.features.forEach((element: any) => {
                    if(element.properties && element.properties['@ns:com:here:xyz']){
                        delete element.properties['@ns:com:here:xyz'];
                    }
                    if(options.geojsonl){
                        console.log(JSON.stringify(element));
                    }
                });
                if(!options.geojsonl){
                    if(options.handle != 0){
                        process.stdout.write(",");
                    }
                    let outString = JSON.stringify(jsonOut.features);
                    process.stdout.write(outString.substring(1, outString.length-1));
                }
            } else {
                cHandle = -1;
            }
            options.handle = jsonOut.handle;
        } while (cHandle >= 0);
        if(!options.geojsonl){
            process.stdout.write(']}');
        }
        process.exit(0);
    }

    if (options.raw) {
        tableFunction = function (data: any, columns: any) {
            if (data.features && data.features.length > 0) {
                data.features.forEach((element: any) => {
                    if(element.properties && element.properties['@ns:com:here:xyz']){
                        if(element.properties['@ns:com:here:xyz']['uuid']){
                            delete element.properties['@ns:com:here:xyz']['uuid'];
                        }
                        if(element.properties['@ns:com:here:xyz']['puuid']){
                            delete element.properties['@ns:com:here:xyz']['puuid'];
                        }
                        if(element.properties['@ns:com:here:xyz']['tags']){
                            delete element.properties['@ns:com:here:xyz']['tags'];
                        }
                    }
                    if(options.geojsonl){
                        console.log(JSON.stringify(element));
                    }
                });
            }
            if(!options.geojsonl){
                console.log(JSON.stringify(data, null, 2));
            }
        };
    }

    cType = "application/geo+json";
    let refspace,reffeature;
    if (!options.limit) {
        options.limit = 5000;
    }
    const spFunction = options.offset ? "iterate" : ( options.spatial ? "spatial" : "search" );
    if (options.limit) {
        uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
        if (options.offset) {
            uri = uri + "&handle=" + options.offset;
        }
        if (options.tags) {
            uri = uri + "&tags=" + options.tags;
        }
        if (options.prop) {
            uri = uri + "&selection=p.@ns:com:here:xyz," + options.prop;
        }

        if (options.search) {
            const expression = common.replaceOpearators(options.search);
            uri = uri + "&" + expression;
        }

        if(options.spatial) {
            if(options.radius && options.center) {
                if(options.center.indexOf("'") >= 0 || options.center.indexOf('"') >= 0) {
                    options.center = options.center.replace(/'/g,'').replace(/"/g,'');
                }
                const latlon = options.center.split(",");
                const lat = latlon[1];
                const lon = latlon[0];
                uri = uri + "&" + "lat="+lat+"&lon="+lon+"&radius="+options.radius;
            }
            if(options.feature) {
                const refspacefeature = options.feature.split(',');
                refspace = refspacefeature[0];
                reffeature = refspacefeature[1];
                uri = uri + "&" + "refSpaceId="+refspace+"&refFeatureId="+reffeature;
                if(options.radius) {
                    uri = uri + "&" + "radius="+ options.radius;
                }
            } else if(options.geometry) {
                let geometryinput = JSON.parse(await transform.read(options.geometry, false));
                if(geometryinput.type && geometryinput.type == 'FeatureCollection') {
                    console.log("you have supplied a FeatureCollection instead of a GeoJSON Geometry. Kindly supply one Feature or GeoJson-Geometry.");
                    process.exit(1);
                } else if (geometryinput.type && geometryinput.type == 'Feature') {
                    geometryinput = geometryinput.geometry;
                }
                requestMethod = "POST";
                postData = geometryinput;
                if(options.radius) {
                    uri = uri + "&" + "radius="+ options.radius;
                }
            }
        }
        cType = "application/geo+json";
    }
    if (options.targetSpace) {
        if (options.targetSpace == true) {
			if (options.feature){
				const refspacefeature = options.feature.split(',');
                refspace = refspacefeature[0];
                reffeature = refspacefeature[1];
            	options.targetSpace = await promptInputAndCreateSpace("features from " + idMsg + id + " within/along feature " + reffeature + " via " + idMsg + refspace);
            } else {
            	options.targetSpace = await promptInputAndCreateSpace("target " + idMsg + "for spatial query of " + id);
            }
        }
    }
    if (options.vector) {
        await launchXYZSpaceInvader(id, options.tags ? "&tags=" + options.tags : "", options.token, options.permanent);
    }
    else if (options.web) {
        //console.log(uri);
        let spaceIds: string[] = [id];
        if(options.feature){
            const refspacefeature = options.feature.split(',');
            const refspace = refspacefeature[0];
            spaceIds.push(refspace);
        }
        await launchHereGeoJson(uri, spaceIds, options.token, options.permanent);
    } else {
        let response;
        if(options.h3){
            options.id = reffeature;
            let jsonOut = await getSpaceDataFromXyz(refspace, options);
            //this returns Feature, not a FeatureCollections
            let spatialfeature = jsonOut;
            let hexbins = common.getClippedh3HexbinsInsidePolygon(spatialfeature, options.h3);
            let area = hexbin.getH3HexbinArea(parseInt(options.h3))
            let units = "km2";
            let printArea = area.toFixed(1) + units;
			if (area < .1){
				units = "m2"
				printArea = (area*1000).toFixed(1) + units
			}
            if(!options.raw){
            	console.log("feature", spatialfeature.id,"contains",hexbins.features.length,"h3 hexbins @ resolution",options.h3,"(average area of",printArea + ")")
				console.log()
            }
            requestMethod = "POST";
            let allFeatures: any[] = [];
            let fullHexbinCounter = hexbins.features.length;
            let hexbinnedFeatureCount = 0
            options.limit = 30000 // given the number of features per hexbin will vary, can we detect this and adjust? also consider upload size...
            for(let hexbin of hexbins.features){
                postData = hexbin.geometry;
                response = await execute(
                    uri,
                    requestMethod,
                    cType,
                    postData,
                    options.token
                );
                if(!options.raw){
                    if(response.body.features.length > 0){
                    	fullHexbinCounter -= 1
                    	hexbinnedFeatureCount += response.body.features.length
                        let density = (response.body.features.length/area).toFixed(1)
                    	density = density + "/" + units
                    	let hexCount = hexbins.features.length - fullHexbinCounter
                    	let hexCountStatus = hexCount + " of " + hexbins.features.length
                    	let data = {'count': hexCountStatus,'h3 id': hexbin.id,'features': response.body.features.length,'density': density}
                    	// TODO: if we hit the limit, we could increase the resolution of the hexbins (by two levels for clean nesting) and iterate through those
                    	// can we make the whole hexbin process a recursive function? but at what point? before we clip the hexbin?
                    	if (response.body.features.length == options.limit){
                    		console.log("caution: download of ",hexbin.id,"may be incomplete since its feature count = download limit of",options.limit," -- try increasing `--limit` or increase h3 resolution from",options.h3,"to a higher resolution")
                    		const childResolution = parseInt(options.h3) + 2 // if you only go to the next resolution, child hexbins don't completely nest -- 7 vs 49 though...
                    		const childArray = common.getH3HexbinChildren(hexbin.id,childResolution)
                    		console.log('children @ r'+childResolution,childArray)
                    	}
                		console.table([data])
                	} 
                }
                if(options.targetSpace){
                    let features = response.body.features;
                    if (features.length > 0) {
                        features.forEach((element: any) => {
                            if(element.properties && element.properties['@ns:com:here:xyz']){
                                if(element.properties['@ns:com:here:xyz']['uuid']){
                                    delete element.properties['@ns:com:here:xyz']['uuid'];
                                }
                                if(element.properties['@ns:com:here:xyz']['puuid']){
                                    delete element.properties['@ns:com:here:xyz']['puuid'];
                                }
                                if(element.properties['@ns:com:here:xyz']['tags']){
                                    delete element.properties['@ns:com:here:xyz']['tags'];
                                }
                            }
                        });
                    }
                	const uri = options.targetSpace + "/features" + "?clientId=cli" + "&addTags=h3@" + hexbin.id
                    await iterateChunk(features, uri, options.token);
                } else {
                    allFeatures = allFeatures.concat(response.body.features);
                }
            }
            let done = hexbins.features.length - fullHexbinCounter
            console.log(done,"h3 hexbins processed (" + fullHexbinCounter ,"were empty),",hexbinnedFeatureCount,"features processed")
            if(options.targetSpace){
                if(options.saveHexbins){
                    const uri = options.targetSpace + "/features" + "?clientId=cli" + "&addTags=hexbins";
                    await iterateChunk(hexbins.features, uri, options.token);
                }
                console.log(hexbinnedFeatureCount,"features uploaded successfully to target " + idMsg,options.targetSpace);
            } else {
                response.body.features = allFeatures;
            }
        } else {
            response = await execute(
                uri,
                requestMethod,
                cType,
                postData,
                options.token
            );
        }
        if (response.statusCode >= 200 && response.statusCode < 210 && !options.targetSpace) {

            let fields = [
                "id",
                "geometry.type",
                "createdAt",
                "updatedAt"
            ];
            if(!catalogHrn){
                fields.push("tags");
            }
            const responseBody = response.body;
            const allFeatures = responseBody.features;
            const responseHandle = responseBody.handle;
            if (responseHandle)
                console.log("Next Handle / Offset : " + responseHandle);
            if (!options.raw) {
                allFeatures.forEach((element: any) => {
                    element.tags = element.properties["@ns:com:here:xyz"].tags;
                    element.updatedAt = common.timeStampToLocaleString(
                        element.properties["@ns:com:here:xyz"].updatedAt
                    );
                    element.createdAt = common.timeStampToLocaleString(
                        element.properties["@ns:com:here:xyz"].createdAt
                    );
                });
            }

            if (options.prop && options.prop.length > 0) {
                let str = (options.prop).replace(/p\./g, "properties.").replace(/f./g, "");

                fields = (str).split(",")
            }
            tableFunction(options.raw ? response.body : allFeatures, fields);
        } else {
            if (response.statusCode == 404) {
                console.log("OPERATION FAILED : " + id + " does not exist");
            }
        }
    }
}

async function launchHereGeoJson(uri: string, spaceIds: string[],  token: string, isPermanent: boolean) {
    if(!token){
        token = await getReadOnlyToken(spaceIds, isPermanent);
    }
    const accessAppend =
        uri.indexOf("?") == -1
            ? "?access_token=" + token
            : "&access_token=" + token;
    open(
        "http://geojson.tools/index.html?url=" +
        common.xyzRoot(false) +
        uri +
        accessAppend
        , { wait: false });
}

async function getReadOnlyToken(inputSpaceIds: string[], isPermanent: boolean){
    if(isPermanent){
        console.log("generating permanent token for this " + idMsg);
    } else {
        console.log("generating a temporary token which will expire in 48 hours – use --permanent / -x to generate a token for this " + idMsg + "that will not expire");
    }
    let spaceIds: string[] = [];
    for(let spaceId of inputSpaceIds){
        const spaceConfig = await getSpaceMetaData(spaceId);
        spaceIds.push(spaceId);
        if(spaceConfig.storage && spaceConfig.storage.id && spaceConfig.storage.id === 'virtualspace'){
            const storageparams = spaceConfig.storage.params.virtualspace;
            spaceIds = spaceIds.concat(storageparams['group'] ? storageparams['group'] : []);
            spaceIds = spaceIds.concat(storageparams['merge'] ? storageparams['merge'] : []);
            spaceIds = spaceIds.concat(storageparams['override'] ? storageparams['override'] : []);
            spaceIds = spaceIds.concat(storageparams['custom'] ? storageparams['custom'] : []);
        }
    }
    const token = await common.createReadOnlyToken(spaceIds, isPermanent);
    return token;
}

async function launchXYZSpaceInvader(spaceId: string, tags: string, token: string, isPermanent: boolean) {
    if(!token){
        token = await getReadOnlyToken([spaceId], isPermanent);
    }
    const uri = "https://geojson.tools/space-invader/?mode=1&space=" + spaceId + "&token=" + token + tags; //TODO add property search values
    open(
        uri
        , { wait: false });
}

export async function promptInputAndCreateSpace(defaultMessage: string){
    let options: any = {};
    const titleInput = await inquirer.prompt<{ title?: string }>(titlePrompt);
    options.title = titleInput.title ? titleInput.title : "file_upload_" + new Date().toISOString();
    const descPrompt = [{
        type: 'input',
        name: 'description',
        message: 'Enter a description for the new space : ',
        default: defaultMessage
    }];
    const descInput = await inquirer.prompt<{ description?: string }>(descPrompt);
    options.message = descInput.description ? descInput.description : defaultMessage;
    options.enableUUID = false;

    const response: any = await createSpace(options)
        .catch(err => {
            common.handleError(err);
            process.exit(1);
        });
    return response.id;
}

export async function createSpace(options: any) {
    if (options) {
        if (!options.title) {
            options.title = "a new " +  idMsg + "created from commandline";
        }
        if (!options.message) {
            options.message = "a new " + idMsg + "created from commandline";
        }
    }
    let gp: any = common.getGeoSpaceProfiles(options.title, options.message, options.client, options.enableUUID);

    if (options.schema) {

        await common.verifyProLicense();

        if (options.schema == true) {
            console.log("Please add local filepath / http link for your schema definition")
            process.exit(1);
        } else {
            let schemaDef: string = "";
            if (options.schema.indexOf("http") == 0) {
                schemaDef = options.schema;
            } else {
                schemaDef = await transform.read(options.schema, false);
            }

            schemaDef = schemaDef.replace(/\r?\n|\r/g, " ");

            let processors = common.getSchemaProcessorProfile(schemaDef);

            gp['processors'] = processors;
        }
    }
    if(options.processors){
        if(!gp['processors']){
            gp['processors'] = {...gp['processors'], ...options.processors}
        } else {
            gp['processors'] = options.processors;
        }
    }

    const response = await execute("?clientId=cli", "POST", "application/json", gp, options.token);
    console.log(idMsg + "'" + response.body.id + "' created successfully");
    return response.body;
}

export async function deleteSpace(geospaceId: string, options:any) {

    if (!options.force) {
        await printDeleteWarning(geospaceId, options);
        console.log("Are you sure you want to delete the given " + idMsg + "?");
        const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);

        const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
        if (termsResp !== "y" && termsResp !== "yes") {
            console.log("CANCELLED !");
            process.exit(1);
        }
    }

    if(catalogHrn){
        await catalogUtil.deleteLayer(catalogHrn, geospaceId, options.token);
    } else {
        const response = await execute(
            geospaceId + "?clientId=cli",
            "DELETE",
            "application/json",
            "",
            options.token
        );
        if (response.statusCode >= 200 && response.statusCode < 210)
            console.log(idMsg + "'" + geospaceId + "' deleted successfully");
    }
}

export async function clearSpace(id: string, options: any) {

    if (!options.force) {
        if (!options.ids) {
            await printDeleteWarning(id, options);
        }
        console.log("Are you sure you want to clear data?");
        const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);

        const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
        if (termsResp !== "y" && termsResp !== "yes") {
            console.log("CANCELLED !");
            process.exit(1);
        }
    }

    if (!options.ids && !options.tags) {
        options.ids = "*";
    }
    let tagOption = options.tags
        ? options.tags
            .split(",")
            .filter((x: any) => !"") // ### TODO ???
            .map((x: string) => "tags=" + x)
            .join("&")
        : "";
    if (tagOption != "") {
        tagOption += "&";
    }
    let idOption = options.ids
        ? options.ids
            .split(",")
            .filter((x: any) => !"") // ### TODO ???
            .map((x: string) => "id=" + x)
            .join("&")
        : "";

    let finalOpt = tagOption + idOption;

    const response = await execute(
        id + "/features?" + finalOpt + "&clientId=cli",
        "DELETE",
        "application/geo+json",
        null,
        options.token
    );
    if (response.statusCode >= 200 && response.statusCode < 210) {
        console.log("data cleared successfully.");
    }
}

async function printDeleteWarning(id: string, options: any) {
    console.log("loading " + idMsg + "details..");
    const jsonStats = await getStatsAndBasicForSpace(id);
    if (options.tags) {
        const tagsArray = options.tags.split(",").filter((x: any) => x != "")

        let tagsStats = jsonStats.tags.value.filter((tagStat: any) => tagsArray.indexOf(tagStat.key) >= 0).map((tagStat: any) => { tagStat['tag'] = tagStat.key; tagsArray.splice(tagsArray.indexOf(tagStat.key), 1); return tagStat; });

        for (const tag of tagsArray) {
            tagsStats.push({ tag: tag, count: 0 });
        }
        console.log(idMsg + "details")
        const statsAll = [{ key: "title", value: jsonStats.spacedef ? jsonStats.spacedef.title : "" }, { key: "description", value: jsonStats.spacedef ? jsonStats.spacedef.description : "" }];
        common.drawTable(statsAll, ["key", "value"]);

        if (tagsStats && tagsStats.length > 0) {
            console.log("number of features matching for the tag(s) you have entered");
        }
        common.drawTable(tagsStats, ["tag", "count"]);
    } else {
        console.log("details of " + idMsg + "and feature(s) being affected by this action");
        const statsAll = [{ key: "title", value: jsonStats.spacedef ? jsonStats.spacedef.title : "" }, { key: "description", value: jsonStats.spacedef ? jsonStats.spacedef.description : "" }];
        common.drawTable(statsAll, ["key", "value"]);

        const realStats =[{ key: "total features", value: jsonStats.count.value, estimated: jsonStats.count.estimated }, { key: "geometry types", value: jsonStats.geometryTypes.value, estimated: jsonStats.geometryTypes.estimated }]
        common.drawNewTable(realStats, ["key", "value", "estimated"], [20,20,20]);
        // OR we could print a normal statement like below.
        // console.log("There are total " + jsonStats.count.value + " features consisting geometry type(s) " + jsonStats.geometryTypes.value + " in the " + idMsg + ".");
    }
}

async function getStatsAndBasicForSpace(spaceId: string) {
    let statsbody = await getSpaceStatistics(spaceId);
    if(catalogHrn) {
        statsbody['spacedef'] = {};
        statsbody['spacedef']['id'] = layer.id;
        statsbody['spacedef']['title'] = layer.name;
        statsbody['spacedef']['description'] = layer.description;
    } else {
        statsbody['spacedef'] = await getSpaceMetaData(spaceId);
    }
    return statsbody;
}

export async function getSpaceMetaData(id: string, token: string | null = null) {
    const uri = id + "?clientId=cli&skipCache=true";
    const cType = "application/json";
    const response = await execute(uri, "GET", cType, "", token);
    return response.body;
}

export async function getSpaceStatistics(id: string, token: string | null = null) {
    const uri = id + "/statistics?clientId=cli&skipCache=true";
    const cType = "application/json";
    const response = await execute(uri, "GET", cType, "", token);
    return response.body;
}

//function created here to pass the test. TODO - rewrite the test code
export async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false, setAuthorization: boolean = true) {
    if (!token) {
        if(catalogHrn){
            token = await common.getWorkspaceToken();
        } else {
            token = await common.verify();
        }
    }
    return await common.execInternal(uri, method, contentType, data, token, gzip, setAuthorization, catalogHrn);
}