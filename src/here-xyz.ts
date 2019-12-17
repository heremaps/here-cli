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

import * as zlib from "zlib";
import { requestAsync } from "./requestAsync";
import * as program from "commander";
import * as common from "./common";
import * as sso from "./sso";
import * as inquirer from "inquirer";
import * as transform from "./transformutil";
import * as fs from "fs";
import * as tmp from "tmp";
import * as summary from "./summary";
let cq = require("block-queue");
import { isBoolean } from "util";
import { ApiError } from "./api-error";
const gsv = require("geojson-validation");
const path = require('path');

let hexbin = require('./hexbin');
const zoomLevelsMap = require('./zoomLevelsMap.json');
let choiceList: { name: string, value: string }[] = [];
const bboxDirections = ["west", "south", "east", "north"];
const questions = [
    {
        type: "checkbox",
        name: "tagChoices",
        message: "Select attributes to be added as tags like key@value",
        choices: choiceList
    },
    {
        type: "checkbox",
        name: "idChoice",
        message:
            "Select attributes which would be used as the GeoJSON Feature ID (must be unique)",
        choices: choiceList
    }
];

const bboxQuestions = [
    {
        type: "number",
        name: "miny",
        message: "Enter the value of minimum Latitude",
    },
    {
        type: "number",
        name: "minx",
        message: "Enter the value of minimum Longitude",
    },
    {
        type: "number",
        name: "maxy",
        message: "Enter the value of maximum Latitude",
    },
    {
        type: "number",
        name: "maxx",
        message: "Enter the value of maximum Longitude",
    }
];

const titlePrompt = [
    {
        type: 'input',
        name: 'title',
        message: 'Enter a title for the new space: '
    }
];

const questionConfirm = [
    {
        type: 'input',
        name: 'confirmed',
        message: 'Enter (Y)es to continue or (N)o to cancel'
    }
];

const questionAnalyze = [
    {
        type: "checkbox",
        name: "properties",
        message: "Select the properties to analyze",
        choices: choiceList
    }
];

const tagruleUpdatePrompt = [
    {
        type: "list",
        name: "tagruleChoices",
        message: "Select tag rule to be updated",
        choices: choiceList
    }
]


const searchablePropertiesDisable = [
    {
        type: "checkbox",
        name: "propChoices",
        message: "Select properties to be disabled as searchable",
        choices: choiceList
    }
]


const tagruleDeletePrompt = [
    {
        type: "checkbox",
        name: "tagruleChoices",
        message: "Select tag rule(s) to be deleted",
        choices: choiceList
    }
]

program.version("0.1.0");

function getGeoSpaceProfiles(title: string, description: string, client: any) {
    return {
        title,
        description,
        client
    };
}

/**
 * 
 * @param apiError error object
 * @param isIdSpaceId set this boolean flag as true if you want to give space specific message in console for 404
 */
function handleError(apiError: ApiError, isIdSpaceId: boolean = false) {
    if (apiError.statusCode) {
        if (apiError.statusCode == 401) {
            console.log("Operation FAILED : Unauthorized, if the problem persists, please reconfigure account with `here configure` command");
        } else if (apiError.statusCode == 403) {
            console.log("Operation FAILED : Insufficient rights to perform action");
        } else if (apiError.statusCode == 404) {
            if (isIdSpaceId) {
                console.log("Operation FAILED: Space does not exist");
            } else {
                console.log("Operation FAILED : Resource not found.");
            }
        } else {
            console.log("OPERATION FAILED : " + apiError.message);
        }
    } else {
        if (apiError.message && apiError.message.indexOf("Insufficient rights.") != -1) {
            console.log("Operation FAILED - Insufficient Rights to perform action");
        } else {
            console.log("OPERATION FAILED - " + apiError.message);
        }
    }
}

async function execInternal(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    gzip: boolean
) {
    if (gzip) {
        return await execInternalGzip(
            uri,
            method,
            contentType,
            data,
            token
        );
    }
    if (!uri.startsWith("http")) {
        uri = common.xyzRoot() + uri;
    }
    const isJson = contentType == "application/json" ? true : false;
    const reqJson = {
        url: uri,
        method: method,
        json: isJson,
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": contentType,
            "App-Name": "HereCLI"
        },
        body: method === "GET" ? undefined : data
    };


    const { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        let message = (response.body && response.body.constructor != String) ? JSON.stringify(response.body) : response.body;
        //throw new Error("Invalid response - " + message);
        throw new ApiError(response.statusCode, message);
    }
    return { response, body };
}

function gzip(data: zlib.InputType): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) =>
        zlib.gzip(data, (error, result) => {
            if (error)
                reject(error)
            else
                resolve(result);
        })
    );
}

async function execInternalGzip(
    uri: string,
    method: string,
    contentType: string,
    data: any,
    token: string,
    retry: number = 3
) {
    const zippedData = await gzip(data);
    const isJson = contentType == "application/json" ? true : false;
    if (!uri.startsWith("http")) {
        uri = common.xyzRoot() + uri;
    }
    const reqJson = {
        url: uri,
        method,
        json: isJson,
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": contentType,
            "Content-Encoding": "gzip",
            "Accept-Encoding": "gzip"
        },
        gzip: true,
        body: method === "GET" ? undefined : zippedData
    };

    let { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        if (response.statusCode >= 500 && retry > 0) {
            await new Promise(done => setTimeout(done, 1000));
            body = await execInternalGzip(uri, method, contentType, data, token, --retry);
        } else {
            //   throw new Error("Invalid response :" + response.statusCode);
            throw new ApiError(response.statusCode, response.body);
        }
    }
    return { response, body };
}

async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false) {
    if (!token) {
        token = await common.verify();
    }
    return await execInternal(uri, method, contentType, data, token, gzip);
}

program
    .command("list")
    .alias("ls")
    .description("information about available XYZ spaces")
    .option("-r, --raw", "show raw XYZ space definition")
    .option(
        "-p, --prop <prop>",
        "property fields to include in table",
        collect,
        []
    )
    .action(async function (options) {
        listSpaces(options)
            .catch((error) => {
                handleError(error);
            })
    });

async function listSpaces(options: any) {
    const uri = "/hub/spaces?clientId=cli";
    const cType = "application/json";
    const { response, body } = await execute(uri, "GET", cType, "");
    if (body.length == 0) {
        console.log("No xyzspace found");
    } else {
        let fields = ["id", "title", "description"];
        if (options.prop.length > 0) {
            fields = options.prop;
        }
        if (options.raw) {
            try {
                console.log(JSON.stringify(JSON.parse(body), null, 2));
            } catch (e) {
                console.log(JSON.stringify(body, null, 2));
            }
        } else {
            common.drawNewTable(body, fields, [10, 40, 60]);
        }
    }
}

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

program
    .command("describe <id>")
    .description("gives the summary details of the given space [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access another user's space")
    .action(function (id, options) {
        (async () => {
            try {
                let featureCollection = await getSpaceDataFromXyz(id, options);
                summary.summarize(featureCollection.features, id, false);
            } catch (error) {
                handleError(error, true);
            }
        })();
    });

function getSpaceDataFromXyz(id: string, options: any) {
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
                if (offset) {
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
                if (cHandle === 0) {
                    process.stdout.write("Operation may take a while. Please wait...");
                }
                do {
                    process.stdout.write(".");
                    let { response, body } = await execute(
                        getUrI(String(cHandle)),
                        "GET",
                        cType,
                        "",
                        options.token,
                        true
                    );
                    jsonOut = body;
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
                if (!options.currentHandleOnly) {
                    process.stdout.write("\n");
                }
                jsonOut.features = features;
                resolve(jsonOut);
            } catch (error) {
                console.error(`\ngetting data from XYZ space failed: ${JSON.stringify(error)}`);
                reject(error);
            }
        })();
    });
}

program
    .command("analyze <id>")
    .description("property based analysis of the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access another user's space")
    .action(function (id, options) {
        analyzeSpace(id, options)
            .catch((error) => {
                handleError(error, true);
            });
    });

async function analyzeSpace(id: string, options: any) {
    let cType = "application/json";
    if (!options.limit) {
        options.limit = 5000;
    }
    const getUrI = function (offset: string) {
        let uri = "/hub/spaces/" + id;
        const spFunction = "iterate";
        if (options.limit) {
            uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
            if (offset) {
                uri = uri + "&handle=" + offset;
            }
            if (options.tags) {
                uri = uri + "&tags=" + options.tags;
            }
            cType = "application/geo+json";
        }
        return uri;
    };
    const totalRecords = 500000;
    let recordLength = 0;
    let features = new Array();
    //(async () => {

    let cHandle = 0;
    process.stdout.write("Operation may take a while. Please wait...");
    do {
        process.stdout.write(".");
        let { response, body } = await execute(
            getUrI(String(cHandle)),
            "GET",
            cType,
            "",
            options.token,
            true
        );
        const jsonOut = JSON.parse(body);
        cHandle = jsonOut.handle;
        if (jsonOut.features) {
            recordLength += jsonOut.features.length;
            features = features.concat(jsonOut.features);
        } else {
            cHandle = -1;
        }
    } while (cHandle >= 0 && recordLength < totalRecords);
    process.stdout.write("\n");

    createQuestionsList({ features: features });
    let properties: any = null;
    let answers: any = await inquirer.prompt(questionAnalyze);
    properties = answers.properties;
    if (properties && properties.length > 0) {
        summary.analyze(features, properties, id);
    } else {
        console.log("No property selected to analyze");
    }

    //})();
};

program
    .command('hexbin <id>')
    .description('create hexbins (and their centroids) using points in an XYZ space and upload them to another space')
    .option("-c, --cellsize <cellsize>", "size of hexgrid cells in meters, comma-separate multiple values")
    .option("-i, --ids", "add IDs of features counted within the hexbin as an array in the hexbin's feature property")
    .option("-p, --groupBy <groupBy>", "name of the feature property by which hexbin counts will be further grouped")
    .option("-a, --aggregate <aggregate>", "name of the feature property used for aggregating sum value of all the features inside hexbin")
    .option("-r, --readToken <readToken>", "token of another user's source space, from which points will be read")
    .option("-w, --writeToken <writeToken>", "token of another user's target space to which hexbins will be written")
    //.option("-d, --destSpace <destSpace>", "Destination Space name where hexbins and centroids will be uploaded")
    .option("-t, --tags <tags>", "only make hexbins for features in the source space that match the specific tag(s), comma-separate multiple values")
    .option("-b, --bbox [bbox]", "only create hexbins for records inside the bounding box specified either by individual coordinates provided interactively or as minLon,minLat,maxLon,maxLat (use “\\ “ to escape a bbox with negative coordinate(s))")
    .option("-l, --latitude <latitude>", "latitude which will be used for converting cellSize from meters to degrees")
    .option("-z, --zoomLevels <zoomLevels>", "hexbins optimized for zoom levels (1-18) - comma separate multiple values(-z 8,10,12) or dash for continuous range(-z 10-15)")
    .action(function (id, options) {
        (async () => {
            try {
                await common.verifyProBetaLicense();
                const sourceId = id;
                options.totalRecords = Number.MAX_SAFE_INTEGER;
                //options.token = 'Ef87rh2BTh29U-tyUx9NxQ';
                if (options.readToken) {
                    options.token = options.readToken;
                }
                /*
                const features = (await getSpaceDataFromXyz(id,options)).features;
                if(features.length === 0){
                    console.log("No features is available to create hexbins");
                    process.exit();
                }
                */
                if (options.bbox == true) {
                    options.bbox = await getBoundingBoxFromUser();
                }

                let cellSizes: number[] = [];
                if (options.zoomLevels) {
                    options.zoomLevels.split(",").forEach(function (item: string) {
                        if (item && item != "") {
                            let zoomLevels = item.split("-");
                            if (zoomLevels.length === 1) {
                                let number = parseInt(zoomLevels[0].toLowerCase());
                                if (isNaN(number) || number < 1 || number > 18) {
                                    console.error(`hexbin creation failed: zoom level input "${zoomLevels[0]}" is not a valid between 1-18`);
                                    process.exit(1);
                                }
                                cellSizes.push(parseInt(zoomLevelsMap[number]));
                            } else if (zoomLevels.length !== 2) {
                                console.error(`hexbin creation failed: zoom level input "${item}" is not a valid sequence`);
                                process.exit(1);
                            } else {
                                let lowNumber = parseInt(zoomLevels[0].toLowerCase());
                                let highNumber = parseInt(zoomLevels[1].toLowerCase());
                                if (isNaN(lowNumber) || isNaN(highNumber) || (lowNumber > highNumber) || lowNumber < 1 || lowNumber > 18 || highNumber < 1 || highNumber > 18) {
                                    console.error(`hexbin creation failed: zoom level input "${zoomLevels}" must be between 1-18`);
                                    process.exit(1);
                                }
                                for (var i = lowNumber; i <= highNumber; i++) {
                                    cellSizes.push(parseInt(zoomLevelsMap[i]));
                                }
                            }
                        }
                    });
                } else if (options.cellsize) {
                    options.cellsize.split(",").forEach(function (item: string) {
                        if (item && item != "") {
                            let number = parseInt(item.toLowerCase());
                            if (isNaN(number)) {
                                console.error(`hexbin creation failed: cellsize input "${item}" is not a valid number`);
                                process.exit(1);
                            }
                            cellSizes.push(number);
                        }
                    });
                } else {
                    cellSizes.push(2000);
                }
                if (!options.latitude) {
                    options.latitude = await getCentreLatitudeOfSpace(id, options.readToken);
                    if (!options.latitude) {
                        options.latitude = 0;
                    }
                }
                let cellSizeHexFeaturesMap = new Map();
                options.currentHandleOnly = true;
                options.handle = 0;
                let cHandle;
                let featureCount = 0;
                console.log("Creating hexbins for the space data");
                do {
                    let jsonOut = await getSpaceDataFromXyz(id, options);
                    if (jsonOut.features && jsonOut.features.length === 0 && options.handle == 0) {
                        console.log("\nNo features are available to create hexbins (only points are supported)");
                        process.exit();
                    }
                    cHandle = jsonOut.handle;
                    options.handle = jsonOut.handle;
                    if (jsonOut.features) {
                        const features = jsonOut.features;
                        featureCount += features.length;
                        process.stdout.write("\rhexbin creation done for feature count - " + featureCount);
                        /*
                        if(features.length === 0 && !options.handle){
                            console.log("No features is available to create hexbins");
                            process.exit();
                        }
                        */
                        for (const cellsize of cellSizes) {
                            //(async () => {
                            //console.log("Creating hexbins for the space data with size " + cellsize);
                            let hexFeatures = cellSizeHexFeaturesMap.get(cellsize);
                            hexFeatures = hexbin.calculateHexGrids(features, cellsize, options.ids, options.groupBy, options.aggregate, options.latitude, hexFeatures);
                            cellSizeHexFeaturesMap.set(cellsize, hexFeatures);
                            //console.log("uploading the hexagon grids to space with size " + cellsize);
                        }
                    } else {
                        cHandle = -1;
                    }
                } while (cHandle >= 0);
                process.stdout.write("\n");
                /*
                if(options.destSpace){
                    id = options.destSpace;
                } else {
                */
                let sourceSpaceData = await getSpaceMetaData(sourceId, options.readToken);
                let newspaceData;
                if ((sourceSpaceData.shared == true && await isOtherOwnerSpace(sourceSpaceData.owner)) || options.readToken) {
                    console.log("shared space or readToken found, creating new hexbin space");
                    newspaceData = await createHexbinSpaceUpdateMetadata(sourceId, sourceSpaceData, false, options.writeToken);
                    id = newspaceData.id;
                } else if (!sourceSpaceData.client || !sourceSpaceData.client.hexbinSpaceId) {
                    console.log("No hexbin space found, creating hexbin space");
                    newspaceData = await createHexbinSpaceUpdateMetadata(sourceId, sourceSpaceData, true, options.writeToken);
                    id = newspaceData.id;
                } else {
                    try {
                        console.log("using exisitng hexbin space - " + sourceSpaceData.client.hexbinSpaceId);
                        id = sourceSpaceData.client.hexbinSpaceId;
                        newspaceData = await getSpaceMetaData(id, options.writeToken);
                    } catch (error) {
                        if (error.statusCode && (error.statusCode == 404 || error.statusCode == 403)) {
                            console.log("looks like existing hexbin space " + id + " has been deleted or you don't have sufficient rights, creating new one ");
                            newspaceData = await createHexbinSpaceUpdateMetadata(sourceId, sourceSpaceData, true, options.writeToken);
                            id = newspaceData.id;
                        } else {
                            throw error;
                        }
                    }
                }
                let cellSizeSet = new Set<string>();
                let zoomLevelSet = new Set<string>();
                if (newspaceData.client && newspaceData.client.cellSizes) {
                    newspaceData.client.cellSizes.forEach((item: string) => cellSizeSet.add(item));
                }
                if (newspaceData.client && newspaceData.client.zoomLevels) {
                    newspaceData.client.zoomLevels.forEach((item: string) => zoomLevelSet.add(item));
                }

                options.token = null;
                if (options.writeToken) {
                    options.token = options.writeToken;
                }
                //cellSizes.forEach(function (cellsize : number) {
                for (const cellsize of cellSizes) {
                    //(async () => {
                    //console.log("Creating hexbins for the space data with size " + cellsize);
                    let hexFeatures = cellSizeHexFeaturesMap.get(cellsize);

                    let centroidFeatures: any[] = [];
                    var i = hexFeatures.length;
                    while (i--) {
                        let isValidHexagon = true;
                        hexFeatures[i].geometry.coordinates[0].forEach(function (coordinate: Array<number>) {
                            if (coordinate[0] < -180 || coordinate[0] > 180 || coordinate[1] > 90 || coordinate[1] < -90) {
                                isValidHexagon = false;
                                console.log("Invalid hexagon, created outside of permissible range - " + coordinate);
                            }
                            /*
                            coordinate[0] = coordinate[0] < -180 ? -179.999999 : coordinate[0];
                            coordinate[0] = coordinate[0] > 180 ? 179.999999 : coordinate[0];
                            coordinate[1] = coordinate[1] < -90 ? -89.999999 : coordinate[1];
                            coordinate[1] = coordinate[1] > 90 ? 89.999999 : coordinate[1];
                            */
                        });
                        if (isValidHexagon) {
                            let geometry = { "type": "Point", "coordinates": hexFeatures[i].properties.centroid };
                            let hashId = common.md5Sum(JSON.stringify(geometry) + '_' + cellsize);
                            centroidFeatures.push({ type: "Feature", "geometry": geometry, "properties": hexFeatures[i].properties, "id": hashId });
                        } else {
                            console.log("Invalid hexagon created, ignoring it - " + JSON.stringify(hexFeatures[i]));
                            hexFeatures.splice(i, 1);
                        }
                    }

                    //hexFeatures = hexFeatures.concat(centroidFeatures);
                    /*  
                    fs.writeFile('out.json', JSON.stringify({type:"FeatureCollection",features:hexFeatures}), (err) => {  
                        if (err) throw err;
                    });
                    */
                    if (hexFeatures.length > 0) {
                        let logStat = "uploading the hexagon grids to space with size " + cellsize;
                        cellSizeSet.add(cellsize + "");
                        if (options.zoomLevels) {
                            const zoomNumber = getKeyByValue(zoomLevelsMap, cellsize);
                            logStat += " / zoom Level " + zoomNumber;
                            zoomLevelSet.add(zoomNumber + "");
                        }
                        console.log(logStat);
                        //console.log("data to be uploaded - " + JSON.stringify(hexFeatures));

                        let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
                        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: hexFeatures }));
                        options.tags = 'hexbin_' + cellsize + ',cell_' + cellsize + ',hexbin';
                        if (options.zoomLevels) {
                            const zoomNumber = getKeyByValue(zoomLevelsMap, cellsize);
                            options.tags += ',zoom' + zoomNumber + ',zoom' + zoomNumber + '_hexbin';
                        }
                        //if(options.destSpace){
                        options.tags += ',' + sourceId;
                        //}
                        options.file = tmpObj.name;
                        options.override = true;
                        await uploadToXyzSpace(id, options);

                        tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
                        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: centroidFeatures }));
                        options.tags = 'centroid_' + cellsize + ',cell_' + cellsize + ',centroid';
                        if (options.zoomLevels) {
                            const zoomNumber = getKeyByValue(zoomLevelsMap, cellsize);
                            options.tags += ',zoom' + zoomNumber + ',zoom' + zoomNumber + '_centroid';
                        }
                        //if(options.destSpace){
                        options.tags += ',' + sourceId;
                        //}
                        options.file = tmpObj.name;
                        options.override = true;
                        await uploadToXyzSpace(id, options);
                        //});
                    } else {
                        console.log("No valid hexbins can be created for space with size " + cellsize);
                    }
                }
                await updateCellSizeAndZoomLevelsInHexbinSpace(id, Array.from(zoomLevelSet), Array.from(cellSizeSet), options.token);
                console.log("hexbins written to space " + id + " from points in source space " + sourceId);
                //});
            } catch (error) {
                handleError(error);
            }
        })();
    });

async function isOtherOwnerSpace(spaceOwner: string) {
    const currentOwner = await common.getAccountId();
    return currentOwner != spaceOwner;
}

async function createHexbinSpaceUpdateMetadata(sourceId: string, sourceSpaceData: any, updateSourceMetadata: boolean = true, newSpacetoken: string | null = null) {
    let newSpaceConfig = {
        title: 'hexbin space of ' + sourceSpaceData.title,
        message: 'hexbin space created for source spaceId - ' + sourceSpaceData.id + ' , title - ' + sourceSpaceData.title,
        client: {
            sourceSpaceId: sourceId,
            type: 'hexbin'
        },
        token: newSpacetoken
    }
    let newspaceData = await createSpace(newSpaceConfig);
    if (updateSourceMetadata) {
        await updateClientHexbinSpaceId(sourceId, newspaceData.id);
    }
    return newspaceData;
}

async function updateClientHexbinSpaceId(sourceId: string, hexbinId: string) {
    const uri = "/hub/spaces/" + sourceId + "?clientId=cli";
    const cType = "application/json";
    const data = {
        client: {
            hexbinSpaceId: hexbinId
        }
    }
    const { response, body } = await execute(uri, "PATCH", cType, data);
    return body;
}

async function updateCellSizeAndZoomLevelsInHexbinSpace(id: string, zoomLevels: string[], cellSizes: string[], token: string | null = null) {
    const uri = "/hub/spaces/" + id + "?clientId=cli";
    const cType = "application/json";
    const data = {
        client: {
            zoomLevels: zoomLevels,
            cellSizes: cellSizes
        }
    }
    const { response, body } = await execute(uri, "PATCH", cType, data, token);
    return body;
}

async function getBoundingBoxFromUser() {
    const answer: any = await inquirer.prompt(bboxQuestions);
    //bounding box - minLon,minLat,maxLon,maxLat
    return answer.minx + "," + answer.miny + "," + answer.maxx + "," + answer.maxy;
}

async function getSpaceMetaData(id: string, token: string | null = null) {
    const uri = "/hub/spaces/" + id + "?clientId=cli";
    const cType = "application/json";
    const { response, body } = await execute(uri, "GET", cType, "", token);
    return body;
}

function getKeyByValue(object: any, value: any) {
    return Object.keys(object).find(key => object[key] === value);
}

async function getCentreLatitudeOfSpace(spaceId: string, token: string | null = null) {
    const body = await getStatisticsData(spaceId, token);
    let bbox = body.bbox.value;
    const centreLatitude = (bbox[1] + bbox[3]) / 2;
    return centreLatitude;
}

async function getStatisticsData(spaceId: string, token: string | null = null) {
    const { response, body } = await execute(
        "/hub/spaces/" + spaceId + "/statistics",
        "GET",
        "application/json",
        null,
        token,
        true
    );
    return body;
}

function replaceOpearators(expr: string) {
    return expr.replace(">=", "=gte=").replace("<=", "=lte=").replace(">", "=gt=").replace("<", "=lt=").replace("+", "&");
}

program
    .command("show <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw XYZ space content")
    .option("-p, --prop <prop>", "selection of properties, use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt>")
    .option("-s, --search <propfilter>", "search expression in \"double quotes\", use single quote to signify string value,  use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt> (Use '+' for AND , Operators : >,<,<=,<=,=,!=) (use comma separated values to search multiple values of a property) {e.g. \"p.name=John,Tom+p.age<50+p.phone='9999999'+p.zipcode=123456\"}")
    .option("-w, --web", "display  XYZ space on http://geojson.tools")
    .option("-v, --vector", "analzye XYZ Space Invader and tangram.js")
    .action(function (id, options) {
        showSpace(id, options)
            .catch((error) => {
                handleError(error, true);
            });
    });

async function showSpace(id: string, options: any) {
    let uri = "/hub/spaces";
    let cType = "application/json";
    let tableFunction = common.drawTable;

    uri = uri + "/" + id;

    if (options.raw) {
        tableFunction = function (data: any, columns: any) {
            try {
                console.log(JSON.stringify(JSON.parse(data), null, 2));
            } catch (e) {
                console.log(JSON.stringify(data, null, 2));
            }
        };
    }

    if (options.search || options.prop) {
        await common.verifyProBetaLicense();
    }

    cType = "application/geo+json";
    if (!options.limit) {
        options.limit = 5000;
    }
    const spFunction = options.offset ? "iterate" : "search";
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
            const expression = replaceOpearators(options.search);
            uri = uri + "&" + expression;
        }
        cType = "application/geo+json";
    }
    if (options.vector) {
        await launchXYZSpaceInvader(id, options.tags ? "&tags=" + options.tags : "");
    }
    else if (options.web) {
        await launchHereGeoJson(uri);
    } else {
        const { response, body } = await execute(
            uri,
            "GET",
            cType,
            ""
        );
        if (response.statusCode >= 200 && response.statusCode < 210) {

            let fields = [
                "id",
                "geometry.type",
                "tags",
                "createdAt",
                "updatedAt"
            ];
            const responseBody = JSON.parse(body);
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
            tableFunction(options.raw ? body : allFeatures, fields);
        } else {
            if (response.statusCode == 404) {
                console.log("OPERATION FAILED : " + id + " does not exist");
            }
        }
    }
}

program
    .command("delete <id>")
    .description("delete the xyzspace with the given id")
    .option("--force", "skip the confirmation prompt")
    .action(async (geospaceId, options) => {
        //console.log("geospaceId:"+"/geospace/"+geospaceId);
        if (!options.force) {
            console.log("Are you sure you want to delete the given space?");
            const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);

            const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
            if (termsResp !== "y" && termsResp !== "yes") {
                console.log("CANCELLED !");
                process.exit(1);
            }
        }

        deleteSpace(geospaceId)
            .catch((error) => {
                handleError(error, true);
            })

    });

async function deleteSpace(geospaceId: string) {


    const { response, body } = await execute(
        "/hub/spaces/" + geospaceId + "?clientId=cli",
        "DELETE",
        "application/json",
        "",
    );
    if (response.statusCode >= 200 && response.statusCode < 210)
        console.log("xyzspace '" + geospaceId + "' deleted successfully");
}

program
    .command("create")
    .description("create a new xyzspace")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for XYZ space")
    .option("-d, --message [message]", "Short description ")
    .option("-s, --schema [schemadef]", "set json schema definition (local filepath / http link) for your space, all future data for this space will be validated for the schema")
    .action(options => createSpace(options)
        .catch(error => {
            handleError(error);
        }));

async function createSpace(options: any) {
    if (options) {
        if (!options.title) {
            options.title = "a new xyzspace created from commandline";
        }
        if (!options.message) {
            options.message = "a new xyzspace created from commandline";
        }
    }
    let gp: any = getGeoSpaceProfiles(options.title, options.message, options.client);

    if (options.schema) {

        await common.verifyProBetaLicense();

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

            let processors = getSchemaProcessorProfile(schemaDef);

            gp['processors'] = processors;
        }
    }


    const { response, body } = await execute("/hub/spaces?clientId=cli", "POST", "application/json", gp, options.token);
    console.log("xyzspace '" + body.id + "' created successfully");
    return body;
}

program
    .command("clear <id>")
    .description("clear data from xyz space")
    .option("-t, --tags [tags]", "tags for the XYZ space")
    .option("-i, --ids [ids]", "ids for the XYZ space")
    .option("--force", "skip the confirmation prompt")
    .action(async (id, options) => {
        if (!options.force) {
            console.log("Are you sure you want to clear data of the given space ?");
            const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);

            const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
            if (termsResp !== "y" && termsResp !== "yes") {
                console.log("CANCELLED !");
                process.exit(1);
            }
        }
        clearSpace(id, options).catch((error) => {
            handleError(error, true);
        })
    });

async function clearSpace(id: string, options: any) {

    if (!options.ids && !options.tags) {
        options.tags = "*";
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

    //console.log("/hub/spaces/"+id+"/features?"+deleteOptions);
    const { response, body } = await execute(
        "/hub/spaces/" + id + "/features?" + finalOpt + "&clientId=cli",
        "DELETE",
        "application/geo+json",
        null,
    );
    if (response.statusCode >= 200 && response.statusCode < 210) {
        console.log("data cleared successfully.");
    }
}

program
    .command("token")
    .description("list all XYZ tokens ")
    .action(() => {
        listTokens().catch((error) => {
            handleError(error);
        })
    });

async function listTokens() {
    const dataStr = await common.decryptAndGet(
        "accountInfo",
        "No here account configure found. Try running 'here configure account'"
    );
    const appInfo = common.getSplittedKeys(dataStr);
    if (!appInfo) {
        throw new Error("Account information out of date. Please re-run 'here configure'");
    }

    const cookie = await sso.executeWithCookie(appInfo[0], appInfo[1]);
    const options = {
        url: common.xyzRoot() + "/token-api/token",
        method: "GET",
        headers: {
            Cookie: cookie
        }
    };

    const { response, body } = await requestAsync(options);
    if (response.statusCode != 200) {
        console.log("Error while fetching maxrights :" + body);
        return;
    }

    const tokenInfo = JSON.parse(body);
    const currentToken = await common.decryptAndGet("keyInfo", "No token found");
    console.log(
        "===================================================="
    );
    console.log("Current CLI token is : " + currentToken);
    console.log(
        "===================================================="
    );
    common.drawNewTable(tokenInfo.tokens, ["id", "type", "iat", "description"], [25, 10, 10, 70]);
}

program
    .command("upload [id]")
    .description("upload GeoJSON, CSV, or a Shapefile to the given id -- if no spaceID is given, a new space will be created")
    .option("-f, --file <file>", "upload local GeoJSON, Shapefile, or CSV files (or GeoJSON/CSV URLs)")
    .option("-c, --chunk [chunk]", "chunk size, default 200")
    .option("-t, --tags [tags]", "tags for the xyz space")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    //     .option("-z, --alt [alt]", "altitude field name") // this breaks geojson
    .option("-z, --point [point]", "points field name with coordinates like (37.7,-122.4)")
    .option("-p, --ptag [ptag]", "property names to be used to add tags")
    .option("-i, --id [id]", "property name(s) to be used as the unique feature ID")
    .option(
        "-a, --assign",
        "lists sample data assign fields which needs to be selected as tags"
    )
    .option(
        "-u, --unique",
        "option to enforce uniqueness to the id by creating a hash of feature and use that as id"
    )
    .option("-o, --override", "override the data even if it shares the same feature id")
    .option("-s, --stream", "streaming data support for large csv and geojson uploads")
    .option('-d, --delimiter [,]', 'alternate delimiter used in csv', ',')
    .option('-q, --quote ["]', 'quote used in csv', '"')
    .option('-e, --errors', 'print data upload errors')
    .option('--string-fields <stringFields>', 'comma seperated property names which needs to be converted as String even though they are numbers or boolean e.g. postal code')
    .action(async function (id, options) {
        if (!id && options.file) {
            console.log("No space ID specified, creating a new XYZ space for this upload.");
            const titleInput = await inquirer.prompt<{ title?: string }>(titlePrompt);
            options.title = titleInput.title ? titleInput.title : "file_upload_" + new Date().toISOString();
            const descPrompt = [{
                type: 'input',
                name: 'description',
                message: 'Enter a description for the new space : ',
                default: path.parse(options.file).name
            }]
            const descInput = await inquirer.prompt<{ description?: string }>(descPrompt);
            options.message = descInput.description ? descInput.description : options.file;

            const response: any = await createSpace(options)
                .catch(err => {
                    handleError(err);
                    process.exit(1);
                });
            id = response.id;

        }
        uploadToXyzSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    });

function collate(result: Array<any>) {
    return result.reduce((features: any, feature: any) => {
        if (feature.type === "Feature") {
            features.push(feature);
        } else if (feature.type === "FeatureCollection") {
            features = features.concat(feature.features);
        } else {
            console.log("Unknown type" + feature.type);
        }
        return features
    }, []);
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

function taskQueue(size: number = 8, totalTaskSize: number) {
    let queue = cq(size, function (task: any, done: Function) {
        iterateChunk(task.chunk, task.url)
            .then(x => {
                queue.uploadCount += 1;
                queue.chunksize--;
                process.stdout.write("\ruploaded " + ((queue.uploadCount / totalTaskSize) * 100).toFixed(1) + "%");
                done();
            }).catch((err) => {
                queue.failedCount += 1;
                queue.chunksize--;
                console.log("failed features " + ((queue.failedCount / totalTaskSize) * 100).toFixed(1) + "%");
                done();
            });
    });
    queue.uploadCount = 0;
    queue.chunksize = 0;
    queue.failedCount = 0;
    queue.send = async function (obj: any) {
        queue.push(obj);
        queue.chunksize++;
        while (queue.chunksize > 25) {
            await new Promise(done => setTimeout(done, 1000));
        }
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


async function uploadToXyzSpace(id: string, options: any) {
    let startTime = new Date();
    //(async () => {
    let tags = "";
    if (options.tags) {
        tags = options.tags;
    }

    let printErrors = false;
    if (options.errors) {
        printErrors = true;
    }

    //Default chunk size set as 200
    if (!options.chunk) {
        options.chunk = 200;
    }

    if (options.unique && options.override) {
        console.log(
            "conflicting options -- you must use either unique or override. Refer to 'here xyz upload -h' for help"
        );
        process.exit(1);
    } else if (!options.override) {
        options.unique = true;
    }

    if (options.assign && options.stream) {
        console.log(
            "conflicting options - you cannot choose assign mode while selecting streaming option"
        );
        process.exit(1);
    }


    if (options.file) {
        const fs = require("fs");
        if (options.file.indexOf(".geojsonl") != -1) {
            if (!options.stream) {
                const result: any = await transform.readLineFromFile(options.file, 100);
                await uploadData(id, options, tags, { type: "FeatureCollection", features: collate(result) }, true, options.ptag, options.file, options.id, printErrors);
            } else {
                let queue = streamingQueue();
                await transform.readLineAsChunks(options.file, options.chunk ? options.chunk : 1000, options, function (result: any) {
                    return new Promise((res, rej) => {
                        (async () => {
                            if (result.length > 0) {
                                await queue.send({ id: id, options: options, tags: tags, fc: { type: "FeatureCollection", features: collate(result) }, retryCount: 3 });
                            }
                            res(queue);
                        })();
                    });
                });
                while (queue.chunksize != 0) {
                    await new Promise(done => setTimeout(done, 1000));
                }
            }
        } else if (options.file.indexOf(".shp") != -1) {
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
        } else if (options.file.indexOf(".csv") != -1 || options.file.indexOf(".txt") != -1) {
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
                                res(queue);
                            }
                        })();
                    });

                });
                while (queue.chunksize != 0) {
                    await new Promise(done => setTimeout(done, 1000));
                }
            }
        } else {
            if (!options.stream) {
                let result = await transform.read(
                    options.file,
                    false
                );
                await uploadData(
                    id,
                    options,
                    tags,
                    JSON.parse(result),
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
            }
        });
    }

    let totalTime = ((new Date().getTime() - startTime.getTime()) / 1000);
    console.log(options.totalCount + " features uploaded to XYZ space '" + id + "' in " + totalTime + " seconds, at the rate of " + Math.round(options.totalCount / totalTime) + " features per second");
    //})();
}

function createQuestionsList(object: any) {
    for (let i = 0; i < 3 && i < object.features.length; i++) {
        let j = 0;
        for (let key in object.features[0].properties) {
            if (i === 0) {
                const desc =
                    "" +
                    (1 + j++) +
                    " : " +
                    key +
                    " : " +
                    object.features[i].properties[key];
                choiceList.push({ name: desc, value: key });
            } else {
                choiceList[j].name =
                    choiceList[j].name + " , " + object.features[i].properties[key];
                j++;
            }
        }
    }
    return questions;
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
            const questions = createQuestionsList(object);
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
    return new Promise((resolve, reject) => {
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
                if (options.stream) {
                    upresult = await iterateChunks([featureOut], "/hub/spaces/" + id + "/features" + "?clientId=cli", 0, 1, options.token, upresult, printFailed);
                } else {
                    const chunks = options.chunk
                        ? chunkify(featureOut, parseInt(options.chunk))
                        : [featureOut];
                    upresult = await iterateChunks(chunks, "/hub/spaces/" + id + "/features" + "?clientId=cli", 0, chunks.length, options.token, upresult, printFailed);
                    process.stdout.write("\n");
                    // let tq =  taskQueue(8,chunks.length);
                    // chunks.forEach(chunk=>{
                    //     tq.send({chunk:chunk,url:"/hub/spaces/" + id + "/features"});
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
                        "' uploaded to xyzspace '" +
                        id +
                        "'"
                    );
                else
                    console.log(
                        "data upload to xyzspace '" + id + "' completed"
                    );

                if (upresult.failed > 0) {
                    console.log("all the features could not be uploaded successfully, to print rejected features, run command with -e")
                    console.log("=============== Upload Summary ============= ");
                    upresult.total = featureOut.length;
                    console.table(upresult);
                } else {
                    summary.summarize(featureOut, id, true);
                }
                options.totalCount = featureOut.length;

            }
            resolve(upresult);
        });
    });
}

function extractOption(callBack: any) {
    inquirer
        .prompt<{ choice: string }>([
            {
                name: "choice",
                type: "list",
                message:
                    "xyz upload will generate unique IDs for all features by default (no features will be overwritten). See upload -h for more options.",
                choices: ["continue", "quit"],
                default: 0
            }
        ])
        .then(answers => {
            if (answers.choice === "continue") {
                callBack();
            } else {
                process.exit();
            }
        });
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
    features.forEach(function (item: any) {
        let finalTags = inputTags.slice();
        let origId = null;
        //Generate id only if doesnt exist
        if (!item.id && idStr) {
            const fId = createUniqueId(idStr, item);
            if (fId && fId != "") {
                item.id = fId;
            }
        } else {
            if (options.unique) {
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
        if (options.unique) {
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
                if (item.properties[tp]) {
                    if (Array.isArray(item.properties[tp])) {
                        for (let i in item.properties[tp]) {
                            addTagsToList(item.properties[tp][i], tp, finalTags);
                        }
                    } else {
                        addTagsToList(item.properties[tp], tp, finalTags);
                    }
                }
            });
        }
        const nameTag = fileName ? getFileName(fileName) : null;
        if (nameTag) {
            finalTags.push(nameTag);
        }
        if (origId) {
            metaProps.originalFeatureId = origId;
        }
        metaProps.tags = uniqArray(finalTags);
        item.properties["@ns:com:here:xyz"] = metaProps;
    });

    if (options.unique && duplicates.length > 0) {
        const featuresOut = new Array();
        for (const k in featureMap) {
            featuresOut.push(featureMap[k]);
        }
        console.log(
            "***************************************************************"
        );
        console.log(
            "We detected duplicate records, only the first was uploaded. Duplicates listed below.\n"
        );
        common.drawTable(duplicates, ["id", "geometry", "properties"]);
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

function addTagsToList(value: string, tp: string, finalTags: string[]) {
    value = value.toString().toLowerCase();
    value = value.replace(/\s+/g, "_");
    //finalTags.push(value); // should we add tags with no @ an option?
    finalTags.push(tp + "@" + value);
    return finalTags;
}

function createUniqueId(idStr: string, item: any) {
    const ids = idStr.split(",");
    const vals = new Array();
    ids.forEach(function (id) {
        const v = item.properties ? item.properties[id] : null;
        if (v) {
            vals.push(v);
        }
    });
    const idFinal = vals.join("-");
    return idFinal;
}

function uniqArray<T>(a: Array<T>) {
    return Array.from(new Set(a));
}

function getFileName(fileName: string) {
    try {
        const path = require("path");
        let bName = path.basename(fileName);
        if (bName.indexOf(".") != -1) {
            bName = bName.substring(0, bName.lastIndexOf("."));
        }
        return bName;
    } catch (e) {
        return null;
    }
}

async function iterateChunks(chunks: any, url: string, index: number, chunkSize: number, token: string, upresult: any, printFailed: boolean): Promise<any> {
    const item = chunks.shift();
    const fc = { type: "FeatureCollection", features: item };
    const { response, body } = await execute(
        url,
        "PUT",
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
        let res = JSON.parse(body);
        if (res.features)
            upresult.success = upresult.success + res.features.length;
        if (res.failed) {
            upresult.failed = upresult.failed + res.failed.length;
            //upresult.entries = upresult.entries.concat(res.failed);


            for (let n = 0; n < res.failed.length; n++) {
                const failedentry = res.failed[n];
                if (printFailed) {
                    console.log("Failed to upload : " + JSON.stringify({ feature: fc.features[failedentry.position], reason: failedentry.message }));
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
async function iterateChunk(chunk: any, url: string) {
    const fc = { type: "FeatureCollection", features: chunk };
    const { response, body } = await execute(
        url,
        "PUT",
        "application/geo+json",
        JSON.stringify(fc),
        null,
        true
    );
    return body;
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

async function launchHereGeoJson(uri: string) {
    const token = await common.verify(true);
    const accessAppend =
        uri.indexOf("?") == -1
            ? "?access_token=" + token
            : "&access_token=" + token;
    const opn = require("opn");
    opn(
        "http://geojson.tools/index.html?url=" +
        common.xyzRoot() +
        uri +
        accessAppend
        , { wait: false });
}

async function launchXYZSpaceInvader(spaceId: string, tags: string) {
    const token = await common.verify(true);
    const uri = "https://s3.amazonaws.com/xyz-demo/scenes/xyz_tangram/index.html?space=" + spaceId + "&token=" + token + tags;
    const opn = require("opn");
    opn(
        uri
        , { wait: false });
}


program
    .command("config <id>")
    .description("configure/view advanced XYZ features for space")
    .option("--shared <flag>", "set your space as shared / public (default is false)")
    //.option("-a,--autotag <tagrules>", "set conditional tagging rules")
    .option("-t,--title [title]", "set title for the space")
    .option("-d,--message [message]", "set description for the space")
    .option("-c,--copyright [copyright]", "set copyright text for the space")
    .option("--stats", "see detailed space statistics")
    .option("-r, --raw", "show raw output")
    .option("-s,--schema [schemadef]", "view or set schema definition (local filepath / http link) for your space, applicable on future data")
    .option("--searchable", "view or configure searchable properties of an xyz space")
    .option("--tagrules", "add, remove, view the conditional rules to tag your features automatically, at present all tag rules will be applied synchronously before features are stored ( mode : sync )")
    .option("--delete", "use with schema/searchable/tagrules options to remove the respective configurations")
    .option("--add", "use with schema/searchable/tagrules options to add/set the respective configurations")
    .option("--update", "use with tagrules options to update the respective configurations")
    .option("--view", "use with schema/searchable/tagrules options to view the respective configurations")

    .action(function (id, options) {
        configXyzSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    })

async function configXyzSpace(id: string, options: any) {
    await common.verifyProBetaLicense();

    let patchRequest: any = {};
    let spacedef: any = null;

    if ((options.schema && options.searchable) ||
        (options.schema && options.tagrules) ||
        (options.tagrules && options.searchable)
    ) {
        console.log("conflict of options, searchable/schema/tagrules options can be used only with add/update/view/delete options")
        process.exit(1);
    }

    if ((options.schema || options.searchable || options.tagrules) &&
        (options.shared || options.title || options.message || options.copyright || options.stats)) {
        console.log("conflict of options, searchable/schema/tagrules options can be used only with add/update/view/delete options")
        process.exit(1);
    }

    if (!(options.schema || options.searchable || options.tagrules) &&
        (options.delete || options.add || options.view)) {
        console.log("invalid options, add/view/delete options can not be used without searchable/schema/tagrules options")
        process.exit(1);
    }

    if (!(options.tagrules) &&
            (options.update)) {
        console.log("invalid options, update option can not be used without tagrules options")
        process.exit(1);
    }


    if (options.searchable) {
        await searchableConfig(id, options);
        process.exit(1);
    } else if (options.tagrules) {
        await tagRuleConfig(id, options);
        process.exit(1);
    } else if (options.schema) {
        const url = `/hub/spaces/${id}?clientId=cli`
        const { response, body } = await execute(
            url,
            "GET",
            "application/json",
            ""
        );
        spacedef = body;
    }


    // if (options.delete && !options.schema) {
    //     console.log("delete option can only be used with schema option")
    //     process.exit(1);
    // }

    if (options.title) {
        patchRequest['title'] = options.title;
    }
    if (options.message) {
        patchRequest['description'] = options.message;
    }
    if (options.copyright) {
        let copyright: any = [];
        copyright.push({ label: options.copyright });
        patchRequest['copyright'] = copyright;
    }

    if (options.shared) {
        if (options.shared == 'true') {
            console.log("setting the space SHARED");
            patchRequest['shared'] = true;
        } else {
            console.log("setting the space NOT SHARED");
            patchRequest['shared'] = false;
        }
    }

    if (options.schema) {
        if (options.schema == true && options.delete != true) {
            if (spacedef.processors) {
                if(Array.isArray(spacedef.processors)){
                    let i = spacedef.processors.length;
                    while (i--) {
                        let processor = spacedef.processors[i];
                        if (processor.id === 'schema-validator') {
                            const { response, body } = await execute(processor.params.schemaUrl, "GET", "application/json", "");
                            console.log(JSON.stringify(body, null, 3));
                            process.exit(1);
                        }
                    }
                } else {
                    let schemaValidatorProcessor = spacedef.processors['schema-validator'];
                    if(schemaValidatorProcessor && schemaValidatorProcessor.length > 0){
                        const { response, body } = await execute(schemaValidatorProcessor[0].params.schemaUrl, "GET", "application/json", "");
                        console.log(JSON.stringify(body, null, 3));
                        process.exit(1);
                    }
                }
            }
            console.log("schema definition not found");
        } else {
            if (spacedef.processors) {
                if(Array.isArray(spacedef.processors)){
                    let i = spacedef.processors.length;
                    while (i--) {
                        let processor = spacedef.processors[i];
                        if (processor.id === 'schema-validator') {
                            spacedef.processors.splice(i, 1);
                        }
                    }
                } else {
                    let processor = spacedef.processors['schema-validator'];
                }
            }
            if (options.schema == true) {
                if (options.delete == true) {
                    console.log("Are you sure you want to remove the schema definition of the given space?");
                    const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);

                    const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
                    if (termsResp !== "y" && termsResp !== "yes") {
                        console.log("CANCELLED !");
                        process.exit(1);
                    }
                    console.log("Removing schema definition for the space.")
                    patchRequest['processors'] = {};
                    patchRequest['processors']['schema-validator'] = null;
                }
            } else {
                let schemaDef: string = "";
                if (options.schema.indexOf("http") == 0) {
                    schemaDef = options.schema;
                } else {
                    schemaDef = await transform.read(options.schema, false);
                }
                schemaDef = schemaDef.replace(/\r?\n|\r/g, " ");
                //console.log(JSON.stringify(schemaDef));
                /*
                if (!spacedef.processors)
                    spacedef.processors = [];
                spacedef.processors.push(getSchemaProcessorProfile(schemaDef));
                */
                patchRequest['processors'] = getSchemaProcessorProfile(schemaDef);
            }
            //patchRequest['processors'] = spacedef.processors;
        }
    }

    if (Object.keys(patchRequest).length > 0) {

        if (options.stats) {
            console.log("Request of stats will be ignored, stats option can only be used standalone or with -r/--raw")
        }

        const url = `/hub/spaces/${id}?clientId=cli`
        const { response, body } = await execute(
            url,
            "PATCH",
            "application/json",
            patchRequest,
            null,
            false
        );

        if (response.statusCode >= 200 && response.statusCode < 210) {
            console.log("space config updated successfully!");
        }
    } else if (options.stats) {
        const url = `/hub/spaces/${id}/statistics?clientId=cli`
        const { response, body } = await execute(
            url,
            "GET",
            "application/json",
            ""
        );

        if (response.statusCode >= 200 && response.statusCode < 210) {
            if (options.raw) {
                console.log(body);
            } else {
                showSpaceStats(body);
            }
        }
    } else {
        const url = `/hub/spaces/${id}?clientId=cli`
        const { response, body } = await execute(
            url,
            "GET",
            "application/json",
            ""
        );

        if (response.statusCode >= 200 && response.statusCode < 210) {
            if (options.raw) {
                console.log(body);
            } else {
                showSpaceConfig(body);
            }
        }
    }
}

function showSpaceStats(spacestatsraw: any) {
    console.log("=========== SPACE MAIN STATS INFO ===========")
    let spacestats: any = [];
    let allSearchable = false;
    let size = spacestatsraw.byteSize.value
    // convert to KB/MB/GB as appropriate
    let kbSize: any = (size / 1024).toFixed(1);
    var mbSize: any = (kbSize / 1024).toFixed(1);
    var gbSize: any = (mbSize / 1024).toFixed(1);
    if ((gbSize < 1) && (kbSize > 1024)) { size = mbSize + ' MB' };
    if (kbSize <= 1024) { size = kbSize + ' KB' };
    if (gbSize >= 1) { size = gbSize + ' GB' };
    if (kbSize < 1) { size = size + ' bytes' };
    spacestats.push({ property: 'BBox', value: spacestatsraw.bbox.value, estimated: spacestatsraw.bbox.estimated });
    spacestats.push({ property: 'Size', value: size, estimated: spacestatsraw.byteSize.estimated });
    spacestats.push({ property: 'Feature Count', value: spacestatsraw.count.value, estimated: spacestatsraw.count.estimated });
    spacestats.push({ property: 'Geometry Types', value: spacestatsraw.geometryTypes.value, estimated: spacestatsraw.geometryTypes.estimated });
    spacestats.push({ property: 'Properties Searchable', value: spacestatsraw.properties.searchable, estimated: '' });

    if (spacestatsraw.properties.searchable === 'ALL') {
        allSearchable = true;
    }
    //console.table(spacestats);
    common.drawNewTable(spacestats, ['property', 'value', 'estimated'], [30, 30, 10]);

    if (spacestatsraw.tags && spacestatsraw.tags.value) {
        console.log("=========== FEATURES' TAGS STATS INFO ===========")
        console.log("Estimated : " + spacestatsraw.tags.estimated)
        common.drawNewTable(spacestatsraw.tags.value, ['key', 'count'], [50, 10]);
    }


    if (spacestatsraw.properties && spacestatsraw.properties.value) {
        console.log("=========== FEATURES' PROPERTIES STATS INFO ===========")
        console.log("Estimated : " + spacestatsraw.properties.estimated)
        if (allSearchable) {
            console.log("ALL Properties searchable")
            common.drawNewTable(spacestatsraw.properties.value, ['key', 'count'])
        } else {
            common.drawNewTable(spacestatsraw.properties.value, ['key', 'count', 'searchable'], [50, 15, 10]);
        }
    }
}

function showSpaceConfig(spacedef: any) {
    console.log("=========== SPACE CONFIG INFO ===========")
    let spaceconfigs: any = [];
    spaceconfigs.push({ property: 'id', value: spacedef.id });
    spaceconfigs.push({ property: 'title', value: spacedef.title });
    spaceconfigs.push({ property: 'description', value: spacedef.description });
    spaceconfigs.push({ property: 'owner', value: spacedef.owner });
    spaceconfigs.push({ property: 'cid/app_id', value: spacedef.cid });
    spaceconfigs.push({ property: 'client', value: JSON.stringify(spacedef.client) });
    spaceconfigs.push({ property: 'shared', value: spacedef.shared || false });

    if (spacedef.copyright) {
        let copr = [];
        for (let n = 0; n < spacedef.copyright.length; n++) {
            const obj = spacedef.copyright[n];
            copr.push(obj.label);
        }
        //spacedef.copyright = copr;
        spaceconfigs.push({ property: 'copyright', value: spacedef.copyright });
    }

    if (spacedef.processors) {
        let processors: any = [];
        if(Array.isArray(spacedef.processors)){
            for (let n = 0; n < spacedef.processors.length; n++) {
                let processor = spacedef.processors[n];
                processors.push(processor.id)
            }
        } else {
            for (var key in spacedef.processors) {
                if (spacedef.processors.hasOwnProperty(key) && spacedef.processors[key].length > 0) {
                    processors.push(key);
                }
            }
        }

        //spacedef.processors = JSON.stringify(processors);
        spaceconfigs.push({ property: 'processors', value: JSON.stringify(processors) });
    }

    if (spacedef.listeners) {
        let listeners: any = [];
        if(Array.isArray(spacedef.listeners)){
            for (let n = 0; n < spacedef.listeners.length; n++) {
                let listener = spacedef.listeners[n];
                listeners.push(listener.id)
            }
        } else {
            for (var key in spacedef.listeners) {
                if (spacedef.processors.hasOwnProperty(key) && spacedef.listeners[key].length > 0) {
                    listeners.push(key);
                }
            }
        }

        //spacedef.processors = JSON.stringify(listeners);
        spaceconfigs.push({ property: 'listeners', value: JSON.stringify(listeners) });
    }

    if (spacedef.storage) {
        spacedef.storageid = spacedef.storage.id;

        if (spacedef.storage.params)
            spacedef.storageparam = JSON.stringify(spacedef.storage.params);


        spaceconfigs.push({ property: 'storageparam', value: JSON.stringify(spacedef.storage.params) });
        spaceconfigs.push({ property: 'storageid', value: spacedef.storageid });

        delete spacedef.storage;
    }
    common.drawNewTable(spaceconfigs, ['property', 'value'], [30, 90])
    //console.table(spacedef);
}

program
    .command("virtualize")
    .alias("vs")
    .description("{xyz pro} create a new virtual XYZ space")
    .option("-t, --title [title]", "Title for virtual XYZ space")
    .option("-d, --message [message]", "set description for the space")
    .option("-g, --group [spaceids]", "Group the spaces (All objects of each space will be part of the response) - enter comma separated space ids")
    .option("-a, --associate [spaceids]", "Associate the spaces. Features same id will be merged into one feature. Enter comma separated space ids, space1,space2. space1 properties will be merged into space2 features.")
    .action(options => createVirtualSpace(options).catch((err) => { handleError(err) }));

async function createVirtualSpace(options: any) {

    await common.verifyProBetaLicense();

    if (options) {
        if (options.group && options.associate) {
            console.log("ERROR : please select either associate or group");
            return;
        }

        if (!options.group && !options.associate) {
            console.log("ERROR : please provide the space ids along with virtual space combination type (group/associate)")
            return;
        }
    }
    let spaceids = options.group ? options.group : options.associate;
    if (isBoolean(spaceids)) {
        console.log("ERROR : please provide the space ids")
        return
    }

    spaceids = spaceids.split(",");
    const relationship = options.group ? "group" : "merge";
    if (!options.title) {
        options.title = createVirtualSpaceTitle(spaceids, options.associate);
    }
    if (!options.message) {
        options.message = await createVirtualSpaceDescription(spaceids, options.associate);
    }

    const gp = getVirtualSpaceProfiles(options.title, options.message, spaceids, relationship);
    const { response, body } = await execute("/hub/spaces?clientId=cli", "POST", "application/json", gp);
    if (response.statusCode >= 200 && response.statusCode < 210) {
        console.log("virtual xyzspace '" + body.id + "' created successfully");
    }
}

function createVirtualSpaceTitle(spaceids: any[], isAssociate: boolean) {
    let title = "XYZ Virtual Space, " + spaceids[0];
    for (let i = 1; i < spaceids.length; i++) {
        title += isAssociate ? ' -> ' + spaceids[i] : ' + ' + spaceids[i];
    }
    title += isAssociate ? ' (associate)' : ' (group)';
    return title;
}

async function createVirtualSpaceDescription(spaceids: any[], isAssociate: boolean) {
    let spaceData: any[] = [];
    let message: string = '';
    for (let i = 0; i < spaceids.length; i++) {
        spaceData[i] = await getSpaceMetaData(spaceids[i]);
    };
    message = isAssociate ? 'association of ' + spaceData[0].id + ' (' + spaceData[0].title + ')' : 'grouping of ' + spaceData[0].id + ' (' + spaceData[0].title + ')';
    for (let i = 1; i < spaceids.length; i++) {
        message += ' and ' + spaceData[i].id + ' (' + spaceData[i].title + ')';
    }
    return message;
}

function getVirtualSpaceProfiles(title: string, description: string, spaceids: Array<string>, vspacetype: string) {
    let virtualspace: any = {};
    virtualspace[vspacetype] = spaceids;

    return {
        title,
        description,
        "storage": {
            "id": "virtualspace",
            "params": {
                virtualspace
            }
        }
    }
}

function getSchemaProcessorProfile(schema: string) {
    return {
        "schema-validator" : [{
            "eventTypes": ["ModifyFeaturesEvent.request", "ModifySpaceEvent.request"],
            "params": {
                "schema": schema
            },
            "order": 0
        }]
    }
}

function getEmptyRuleTaggerProfile() {
    return {
        "eventTypes": ["ModifyFeaturesEvent.request"],
        "params": {
            "taggingRules": {
            }
        },
        "order": 0
    }
}

function composeJsonPath(condition: string) {
    condition = condition.toString();
    condition = condition.replace(/p\./g, "@.properties.").replace(/f\./g, "@.");
    let jsonPath: string = "$.features[?(" + condition + ")]";
    return jsonPath;
}

function parseJsonPath(jsonPath: string) {
    let myRegexp = /.\.features\[\?\((.*)\)\]/g;
    let match: any = myRegexp.exec(jsonPath);
    if(match) {
        let expression = match[1];
        let condition = expression.replace(/@\.properties\./g, "p.").replace(/@\./g, "f.");
        return condition;
    } else {
        return jsonPath;
    }
}

function isValidTagName(tagName: string) {
    return tagName && tagName.trim().length > 0 && tagName.indexOf(",") == -1
}

function isValidRuleExpression(ruleExpression: string) {
    return ruleExpression && ruleExpression.trim().length > 4
}

function getProcessorFromSpaceDefinition(spacedef: any, processorName: string){
    if (spacedef.processors) {
        if(Array.isArray(spacedef.processors)){
            let i = spacedef.processors.length;
            while (i--) {
                let processor = spacedef.processors[i];
                if (processor.id === processorName) {
                    return spacedef.processors.splice(i, 1)[0];
                }
            }
        } else {
            if(spacedef.processors[processorName] && spacedef.processors[processorName].length > 0){
                return spacedef.processors[processorName][0];
            }
            return null;
        }
    }
    return null;
}

// program
//     .command("tagrules <id>")
//     .description("add, remove, view the conditional rules to tag your features automatically, at present all tag rules will be applied synchronously before features are stored ( mode : sync )")
//     .option("--add", "add new tag rules")
//     .option("--delete", "delete tag rules")
//     .option("--update", "update existing tag rules")
//     .option("--view", "view existing tag rules")
//     // .option("--async", "tag rule will be applied asynchronously after features are written to the storage")
//     // .option("--sync", " [DEFAULT] tag rule will be applied synchronously before features are written to the storage")
//     .action(function (id, options) {
//         tagRuleConfig(id, options).catch((error) => handleError(error))
//     })

async function tagRuleConfig(id: string, options: any) {
    await common.verifyProBetaLicense();
    let patchRequest: any = {};
    let spacedef: any = {};
    const url = `/hub/spaces/${id}?clientId=cli`
    const { response, body } = await execute(
        url,
        "GET",
        "application/json",
        ""
    );
    spacedef = body;
    if (spacedef != null) {
        let ruleTagger = getProcessorFromSpaceDefinition(spacedef, 'rule-tagger');
        let ruleTaggerAsync = getProcessorFromSpaceDefinition(spacedef, 'rule-tagger-async');
        let taggingRules: any;
        let taggingRulesAsync: any;
        if (ruleTagger) {
            taggingRules = ruleTagger['params'].taggingRules;
        }
        if (ruleTaggerAsync) {
            taggingRulesAsync = ruleTaggerAsync['params'].taggingRules;
        }

        if (options.delete) {
            if ((!taggingRules || Object.keys(taggingRules).length == 0) && (!taggingRulesAsync || Object.keys(taggingRulesAsync).length == 0)) {
                console.log("tagrules are not defined for this space yet..!");
                process.exit(1);
            } else {
                if (taggingRules && Object.keys(taggingRules).length > 0) {
                    Object.keys(taggingRules).forEach(key => {
                        choiceList.push({ 'name': key + " , rule : " + parseJsonPath(taggingRules[key]) + ' , mode : sync', 'value': "sync_" + key });
                    })
                }
                if (taggingRulesAsync && Object.keys(taggingRulesAsync).length > 0) {
                    Object.keys(taggingRulesAsync).forEach(key => {
                        choiceList.push({ 'name': key + " , rule : " + parseJsonPath(taggingRulesAsync[key]) + ' , mode : async  ', 'value': "async_" + key });
                    })
                }

                let answers: any = await inquirer.prompt(tagruleDeletePrompt);
                answers.tagruleChoices.forEach((key: string) => {
                    if (key.startsWith("sync_")) {
                        delete taggingRules[key.substring(5)];
                    }
                    if (key.startsWith("async_")) {
                        delete taggingRulesAsync[key.substring(6)];
                    }
                })
                patchRequest['processors'] = {};
                if (taggingRules){
                    if(Object.keys(taggingRules).length == 0) {
                        patchRequest['processors']['rule-tagger'] = null;
                    } else {
                        patchRequest['processors']['rule-tagger'] = [];
                        patchRequest['processors']['rule-tagger'].push(ruleTagger);
                    }
                }
                if (taggingRulesAsync){
                    if(Object.keys(taggingRulesAsync).length == 0) {
                        patchRequest['processors']['rule-tagger-async'] = null;
                    } else {
                        patchRequest['processors']['rule-tagger-async'] = [];
                        patchRequest['processors']['rule-tagger-async'].push(ruleTaggerAsync);
                    }
                }
                //patchRequest['processors'] = spacedef.processors;
            }
        } else if (options.update) {
            if ((!taggingRules || Object.keys(taggingRules).length == 0) && (!taggingRulesAsync || Object.keys(taggingRulesAsync).length == 0)) {
                console.log("tagrules are not defined for this space yet..!");
                process.exit(1);
            } else {
                // scope of improvement: can create a common method to load rules in choiceList to reuse in update, delete options.
                if (taggingRules && Object.keys(taggingRules).length > 0) {
                    Object.keys(taggingRules).forEach(key => {
                        choiceList.push({ 'name': key + " , rule : " + parseJsonPath(taggingRules[key]) + ' , mode : sync', 'value': "sync_" + key });
                    })
                }
                if (taggingRulesAsync && Object.keys(taggingRulesAsync).length > 0) {
                    Object.keys(taggingRulesAsync).forEach(key => {
                        choiceList.push({ 'name': key + " , rule : " + parseJsonPath(taggingRulesAsync[key]) + ' , mode : async  ', 'value': "async_" + key });
                    })
                }

                let answers: any = await inquirer.prompt(tagruleUpdatePrompt);
                let key: string = answers.tagruleChoices;

                let existingTag = "";
                let existingCondition = "";
                if (key.startsWith("sync_")) {
                    existingTag = key.substring(5);
                    existingCondition = parseJsonPath(taggingRules[key.substring(5)]);
                }
                if (key.startsWith("async_")) {
                    existingTag = key.substring(6);
                    existingCondition = parseJsonPath(taggingRules[key.substring(6)]);
                }

                const tagNamePrompt = [{
                    type: 'input',
                    name: 'tagname',
                    message: 'Press ENTER to keep existing tag name OR type new tag name',
                    default: existingTag
                }]
                const tagNameInput = await inquirer.prompt<{ tagname: string }>(tagNamePrompt);
                const tagName = tagNameInput.tagname;

                if (isValidTagName(tagName)) {
                    console.log("Press ENTER OR type condition(s) for this tag rule. e.g. \"f.id == 123 || (p.country=='USA' & p.count<=100)\"")
                    const tagconditionPrompt = [{
                        type: 'input',
                        name: 'tagcondition',
                        message: 'condition : ',
                        default: existingCondition
                    }]

                    const tagConditionInput: any = await inquirer.prompt<{ tagcondition?: string }>(tagconditionPrompt);
                    const tagCondition = tagConditionInput.tagcondition;
                    if (isValidRuleExpression(tagCondition)) {
                        const jsonPath = composeJsonPath(tagCondition);
                        if (key.startsWith("sync_")) {
                            delete taggingRules[key.substring(5)];
                            taggingRules[tagName] = jsonPath;
                        }
                        if (key.startsWith("async_")) {
                            delete taggingRulesAsync[key.substring(6)];
                            taggingRulesAsync[tagName] = jsonPath;
                        }
                    } else {
                        console.log("invalid condition entered, please try again.");
                        process.exit(1);
                    }
                    //patchRequest['processors'] = spacedef.processors;
                    patchRequest['processors'] = {};
                    patchRequest['processors']['rule-tagger'] = [];
                    patchRequest['processors']['rule-tagger'].push(ruleTagger);
                    patchRequest['processors']['rule-tagger-async'] = [];
                    patchRequest['processors']['rule-tagger-async'].push(ruleTaggerAsync);
                }
            }
        } else if (options.add) {
            if (!spacedef.processors)
                spacedef.processors = [];

            if (options.async) {
                console.log("Starting to add a new asynchronous rule to automatically tag features..")
            } else {
                console.log("Starting to add a new synchronous rule to automatically tag features..")
            }

            const tagNamePrompt = [{
                type: 'input',
                name: 'tagname',
                message: 'Enter a tag name you would like to assign : '
            }]
            const tagNameInput = await inquirer.prompt<{ tagname: string }>(tagNamePrompt);
            const tagName = tagNameInput.tagname;

            if (isValidTagName(tagName)) {
                if ((!options.async && taggingRules && taggingRules[tagName]) || (options.async && taggingRulesAsync && taggingRulesAsync[tagName])) {
                    console.log('there already exists a tag rule for tag `' + tagName + '`, if you continue, the existing tagrule will be replaced')
                    const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);
                    const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
                    if (termsResp !== "y" && termsResp !== "yes") {
                        console.log("CANCELLED !");
                        process.exit(1);
                    }
                }
                console.log("Please enter condition(s) for the auto tagging your features with  `" + tagName +
                    "` e.g. \"f.id == 123 || (p.country=='USA' & p.count<=100)\"")
                const tagconditionPrompt = [{
                    type: 'input',
                    name: 'tagcondition',
                    message: 'condition :  '
                }]
                const tagConditionInput: any = await inquirer.prompt<{ tagcondition?: string }>(tagconditionPrompt);
                const tagCondition = tagConditionInput.tagcondition;
                if (isValidRuleExpression(tagCondition)) {
                    const jsonPath = composeJsonPath(tagCondition);
                    patchRequest['processors'] = {};
                    if (options.async) {
                        if (!ruleTaggerAsync) {
                            ruleTaggerAsync = getEmptyRuleTaggerProfile();
                            //spacedef.processors.push(ruleTaggerAsync);
                        }
                        taggingRulesAsync = ruleTaggerAsync['params'].taggingRules;
                        taggingRulesAsync[tagName] = jsonPath;
                        patchRequest['processors']['rule-tagger-async'] = [];
                        patchRequest['processors']['rule-tagger-async'].push(ruleTaggerAsync);
                    } else {
                        if (!ruleTagger) {
                            ruleTagger = getEmptyRuleTaggerProfile();
                            //spacedef.processors.push(ruleTagger);
                        }
                        taggingRules = ruleTagger['params'].taggingRules;
                        taggingRules[tagName] = jsonPath;
                        patchRequest['processors']['rule-tagger'] = [];
                        patchRequest['processors']['rule-tagger'].push(ruleTagger);
                    }
                    //patchRequest['processors'] = spacedef.processors;
                } else {
                    console.log("invalid condition entered, please try again.");
                    process.exit(1);
                }
            } else {
                console.log("invalid tag name entered, please try again.");
                process.exit(1);
            }
        } else { //also for --view
            if ((!taggingRules || Object.keys(taggingRules).length == 0) && (!taggingRulesAsync || Object.keys(taggingRulesAsync).length == 0)) {
                console.log("tagrules are not defined for this space yet..!")
            } else {
                let printdata: any = [];
                if (taggingRules && Object.keys(taggingRules).length > 0) {
                    Object.keys(taggingRules).forEach(key => {
                        printdata.push({ 'tag_name': key, 'mode': 'sync', 'auto_tag_condition': parseJsonPath(taggingRules[key]) });
                    })
                }
                if (taggingRulesAsync && Object.keys(taggingRulesAsync).length > 0) {
                    Object.keys(taggingRulesAsync).forEach(key => {
                        printdata.push({ 'tag_name': key, 'mode': 'async', 'auto_tag_condition': parseJsonPath(taggingRulesAsync[key]) });
                    })
                }
                common.drawNewTable(printdata, ['tag_name', 'mode', 'auto_tag_condition'], [35, 5, 75]);
            }
        }
    }

    if (Object.keys(patchRequest).length > 0) {

        const url = `/hub/spaces/${id}?clientId=cli`;
        const { response, body } = await execute(
            url,
            "PATCH",
            "application/json",
            patchRequest,
            null,
            false
        );
        if (response.statusCode >= 200 && response.statusCode < 210) {
            console.log("tagrules updated successfully!");
        }
    }
}


// program
//     .alias("index")
//     .command("searchable <id>")
//     .description("view or configure searchable properties of an xyz space")
//     .option("--add", "configure (index on) a property as searchable")
//     .option("--delete", "remove (index on) a property from searchable")
//     .option("--view", "view existing searchable properties")
//     // .option("--async", "tag rule will be applied asynchronously after features are written to the storage")
//     // .option("--sync", " [DEFAULT] tag rule will be applied synchronously before features are written to the storage")
//     .action(function (id, options) {
//         searchableConfig(id, options).catch((error) => handleError(error))
//     })

async function searchableConfig(id: string, options: any) {
    await common.verifyProBetaLicense();
    let patchRequest: any = {};
    let spacedef: any = {};
    const url = `/hub/spaces/${id}?clientId=cli`
    const req = await execute(
        url,
        "GET",
        "application/json",
        ""
    );
    spacedef = req.body;

    const surl = `/hub/spaces/${id}/statistics?clientId=cli`
    const sreq = await execute(
        surl,
        "GET",
        "application/json",
        ""
    );
    let stats = sreq.body;

    if (spacedef != null) {
        let searchableProperties = spacedef.searchableProperties;
        if (options.delete) {

            if (searchableProperties && Object.keys(searchableProperties).length > 0) {
                Object.keys(searchableProperties).forEach(propertyname => {
                    choiceList.push({ 'name': propertyname + " , mode : manually configured, searchable : " + searchableProperties[propertyname], 'value': propertyname });
                })
            }
            if (stats.properties) {
                if (stats.properties.searchable == 'ALL') {
                    console.log("All the properties of your space are searchable by default currently since your space size (feature count) is less than 10,000");
                    console.log("Manually configured settings will take effect once the space size (feature count) is more than 10,000");
                    stats.properties.value.forEach((prop: any) => {
                        if (!spacedef.searchableProperties ||
                            (spacedef.searchableProperties && spacedef.searchableProperties[prop.key] == null)) {
                            choiceList.push({ 'name': prop.key + " , mode : auto configured, searchable : true", 'value': prop.key });
                        }
                    });

                } else {
                    stats.properties.value.forEach((prop: any) => {
                        if (prop.searchable) {
                            if (!spacedef.searchableProperties ||
                                (spacedef.searchableProperties && spacedef.searchableProperties[prop.key] == null)) {
                                choiceList.push({ 'name': prop.key + " , mode : auto configured, searchable : " + (prop.searchable ? prop.searchable : "false"), 'value': prop.key });
                            }
                        }
                    });
                }

                let answers: any = await inquirer.prompt(searchablePropertiesDisable);
                answers.propChoices.forEach((key: string) => {
                    if(!spacedef.searchableProperties){
                        spacedef.searchableProperties = {};
                    }
                    spacedef.searchableProperties[key] = false;
                })
                patchRequest['searchableProperties'] = spacedef.searchableProperties;
            }

        } else if (options.add) {
            const propNamePrompt = [{
                type: 'input',
                name: 'propertyName',
                message: 'Enter the property name to make searchable ( create index on ) : '
            }]
            const propNameInput = await inquirer.prompt<{ propertyName: string }>(propNamePrompt);
            const propName = propNameInput.propertyName;

            if (isValidTagName(propName)) {
                if (!spacedef.searchableProperties) {
                    spacedef.searchableProperties = {};
                }
                spacedef.searchableProperties[propName] = true;
                patchRequest['searchableProperties'] = spacedef.searchableProperties;
            }

        } else { //also for --view

            let commonlist: any = [];

            if (spacedef.searchableProperties) {
                Object.keys(spacedef.searchableProperties).forEach((key: any) => {
                    commonlist.push({ propertyName: key, mode: 'manual', searchable: spacedef.searchableProperties[key] });
                });
            }
            if (stats.properties) {
                if (stats.properties.searchable == 'ALL') {
                    console.log("All the properties of your space are searchable by default currently since your space size (feature count) is less than 10,000");
                    console.log("Manually configured settings will take effect once the space size (feature count) is more than 10,000");
                    stats.properties.value.forEach((prop: any) => {
                        if (!spacedef.searchableProperties ||
                            (spacedef.searchableProperties && spacedef.searchableProperties[prop.key] == null)) {
                            commonlist.push({ propertyName: prop.key, mode: 'auto', searchable: 'true' });
                        }
                    });

                } else {
                    stats.properties.value.forEach((prop: any) => {
                        if (prop.searchable) {
                            if (!spacedef.searchableProperties || spacedef.searchableProperties && spacedef.searchableProperties[prop.key] == null) {
                                commonlist.push({ propertyName: prop.key, mode: 'auto', searchable: prop.searchable });
                            }
                        }
                    });
                }

            }

            common.drawNewTable(commonlist, ['propertyName', 'mode', 'searchable'], [60, 20, 20]);

        }
    }
    if (Object.keys(patchRequest).length > 0) {

        const url = `/hub/spaces/${id}?clientId=cli`
        const { response, body } = await execute(
            url,
            "PATCH",
            "application/json",
            patchRequest,
            null,
            false
        );

        if (response.statusCode >= 200 && response.statusCode < 210) {
            console.log("searchable configuration updated successfully!");
        }
    }
}

common.validate(
    [
        "list",
        "ls",
        "show",
        "create",
        "delete",
        "upload",
        "describe",
        "clear",
        "token",
        "analyze",
        "hexbin",
        "config",
        "vs",
        "virtualize"
    ],
    [process.argv[2]],
    program
);
program.parse(process.argv);
