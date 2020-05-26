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
import * as gis from "./gisUtil";
import * as fs from "fs";
import * as tmp from "tmp";
import * as summary from "./summary";
let cq = require("block-queue");
import { isBoolean } from "util";
import { ApiError } from "./api-error";
const gsv = require("geojson-validation");
const path = require('path');
import * as moment from 'moment';

let hexbin = require('./hexbin');
const zoomLevelsMap = require('./zoomLevelsMap.json');
let choiceList: { name: string, value: string }[] = [];
const bboxDirections = ["west", "south", "east", "north"];
const questions = [
    {
        type: "checkbox",
        name: "tagChoices",
        message: "Select attributes to be added as tags, like key@value",
        choices: choiceList
    },
    {
        type: "checkbox",
        name: "idChoice",
        message:
            "Select attributes to be used as the GeoJSON Feature ID (must be unique)",
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

const activityLogAction = [
    {
        type: "list",
        name: "actionChoice",
        message: "Select action for activity log",
        choices: choiceList
    }
]

const activityLogConfiguration = [
    {
        type: "list",
        name: "storageMode",
        message: "Select storage mode for activity log",
        choices: [{name: 'full - store whole object on change', value: 'FULL'}, {name: 'diff - store only the changed properties', value: 'DIFF_ONLY'}]
    },
    {
        type: "list",
        name: "state",
        message: "Select state (number of change history to be kept) for activity log",
        choices: [{name: '1', value: '1'},{name: '2', value: '2'},{name: '3', value: '3'},{name: '4', value: '4'},{name: '5', value: '5'}]
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

const streamconfirmationPrompt = [{
    type: 'confirm',
    name: 'streamconfirmation',
    message: 'Do you want to enable streaming in upload? This will be considerably faster, and will enable you to upload much larger CSVs and GeoJSON files',
    default: false
}]

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
        client,
        "enableUUID": true
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
            console.log("Operation FAILED - Insufficient rights to perform action");
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
    const responseType = contentType.indexOf('json') !== -1 ? 'json' : 'text';
    const reqJson = {
        url: uri,
        method: method,
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": contentType,
            "App-Name": "HereCLI"
        },
        json: method === "GET" ? undefined : data,
        allowGetBody: true,
        responseType: responseType
    };


    const response = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        let message = (response.body && response.body.constructor != String) ? JSON.stringify(response.body) : response.body;
        //throw new Error("Invalid response - " + message);
        throw new ApiError(response.statusCode, message);
    }
    return response;
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
    if (!uri.startsWith("http")) {
        uri = common.xyzRoot() + uri;
    }
    const responseType = contentType.indexOf('json') !== -1 ? 'json' : 'text';
    const reqJson = {
        url: uri,
        method: method,
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": contentType,
            "Content-Encoding": "gzip",
            "Accept-Encoding": "gzip"
        },
        decompress: true,
        body: method === "GET" ? undefined : zippedData,
        allowGetBody: true,
        responseType: responseType
    };

    let response = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210) {
        if (response.statusCode >= 500 && retry > 0) {
            await new Promise(done => setTimeout(done, 1000));
            response = await execInternalGzip(uri, method, contentType, data, token, --retry);
        } else {
            //   throw new Error("Invalid response :" + response.statusCode);
            throw new ApiError(response.statusCode, response.body);
        }
    }
    return response;
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
    .option("--token <token>", "a external token to access another user's spaces")
    .option("--filter <filter>", "a comma separted strings to filter spaces")
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
    const response = await execute(uri, "GET", cType, "", options.token);
    if (response.body.length == 0) {
        console.log("No XYZ space found");
    } else {
        let fields = ["id", "title", "description"];
        if (options.prop.length > 0) {
            fields = options.prop;
        }
        let result = response.body;
        if(options.filter){
            const filterArray = options.filter.split(",");
            result = result.filter((element: any) => {
                for (var i=0; i<filterArray.length; i++) {
                    if(element.title.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1 || (element.description && element.description.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1)){
                        return true;
                    }
                }
            });
        }
        if (options.raw) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            common.drawNewTable(result, fields, [10, 40, 60]);
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
    .option("--token <token>", "a external token to access another user's space")
    .action(function (id, options) {
        (async () => {
            try {
                console.warn('\x1b[33m%s\x1b[0m',"[WARNING] 'describe' command is deprecated and will be removed in next release. Please use 'config' command with '--stats' option.");
                let featureCollection = await getSpaceDataFromXyz(id, options);
                summary.summarize(featureCollection.features, id, false);
            } catch (error) {
                handleError(error, true);
            }
        })();
    });

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
    .option("--token <token>", "an external token to access another user's space")
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
        let response = await execute(
            getUrI(String(cHandle)),
            "GET",
            cType,
            "",
            options.token,
            true
        );
        const jsonOut = response.body;
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
    .description('create fixed height hexbins (and their centroids) using points in an XYZ space, and upload them to another space')
    .option("-c, --cellsize <cellsize>", "size of hexgrid cells in meters, comma-separate multiple values")
    .option("-i, --ids", "add IDs of features counted within the hexbin as an array in the hexbin's feature property")
    .option("-p, --groupBy <groupBy>", "name of the feature property by which hexbin counts will be further grouped")
    .option("-a, --aggregate <aggregate>", "name of the feature property used for aggregating sum value of all the features inside a hexbin")
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
                await common.verifyProLicense();
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
                let newSpaceData = await createNewSpaceAndUpdateMetadata('hexbin', sourceId, options);
                id = newSpaceData.id;
                let cellSizeSet = new Set<string>();
                let zoomLevelSet = new Set<string>();
                if (newSpaceData.client && newSpaceData.client.cellSizes) {
                    newSpaceData.client.cellSizes.forEach((item: string) => cellSizeSet.add(item));
                }
                if (newSpaceData.client && newSpaceData.client.zoomLevels) {
                    newSpaceData.client.zoomLevels.forEach((item: string) => zoomLevelSet.add(item));
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

export async function createNewSpaceUpdateMetadata(newSpaceType: string, sourceId: string, sourceSpaceData: any, updateSourceMetadata: boolean = true, newSpacetoken: string | null = null) {
    let newSpaceConfig = {
        title: newSpaceType+ ' space of ' + sourceSpaceData.title,
        message: newSpaceType + ' space created for source spaceId - ' + sourceSpaceData.id + ' , title - ' + sourceSpaceData.title,
        client: {
            sourceSpaceId: sourceId,
            type: newSpaceType
        },
        token: newSpacetoken
    }
    let newspaceData = await createSpace(newSpaceConfig);
    if (updateSourceMetadata) {
        await updateClientSpaceWithNewSpaceId(newSpaceType, sourceId, newspaceData.id);
    }
    return newspaceData;
}

async function updateClientSpaceWithNewSpaceId(newSpaceType: string, sourceId: string, newSpaceId: string) {
    const uri = "/hub/spaces/" + sourceId + "?clientId=cli";
    const cType = "application/json";
    const key = newSpaceType + 'SpaceId';
    const data = {
        client: {
            [key] : newSpaceId
        }
    }
    const response = await execute(uri, "PATCH", cType, data);
    return response.body;
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
    const response = await execute(uri, "PATCH", cType, data, token);
    return response.body;
}

async function getBoundingBoxFromUser() {
    const answer: any = await inquirer.prompt(bboxQuestions);
    //bounding box - minLon,minLat,maxLon,maxLat
    return answer.minx + "," + answer.miny + "," + answer.maxx + "," + answer.maxy;
}

export async function getSpaceMetaData(id: string, token: string | null = null) {
    const uri = "/hub/spaces/" + id + "?clientId=cli&skipCache=true";
    const cType = "application/json";
    const response = await execute(uri, "GET", cType, "", token);
    return response.body;
}

function getKeyByValue(object: any, value: any) {
    return Object.keys(object).find(key => object[key] === value);
}

async function getCentreLatitudeOfSpace(spaceId: string, token: string | null = null) {
    const body = await getSpaceStatistics(spaceId, token);
    let bbox = body.bbox.value;
    const centreLatitude = (bbox[1] + bbox[3]) / 2;
    return centreLatitude;
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
    .option("--all", "iterate over entire XYZ space to get entire data of space, output will be shown on the console in geojson format")
    .option("--geojsonl", "to print output of --all in geojsonl format")
    .option("-c, --chunk [chunk]", "chunk size to use in --all option, default 5000")
    .option("--token <token>", "a external token to access another user's space")
    .option("-p, --prop <prop>", "selection of properties, use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt>")
    .option("-w, --web", "display XYZ space on http://geojson.tools")
    .option("-v, --vector", "inspect and analyze using XYZ Space Invader and tangram.js")
    .option("-s, --search <propfilter>", "search expression in \"double quotes\", use single quote to signify string value,  use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt> (Use '+' for AND , Operators : >,<,<=,<=,=,!=) (use comma separated values to search multiple values of a property) {e.g. \"p.name=John,Tom+p.age<50+p.phone='9999999'+p.zipcode=123456\"}")
    .option("--spatial","indicate to make spatial search on the space")
    .option("--radius <radius>", "indicate to make radius spatial search or to thicken input geometry (in meters)")
    .option("--center <center>", "comma separated lon,lat values to specify the center point for radius search")
    .option("--feature <feature>", "comma separated spaceid,featureid values to specify reference geometry (taken from feature) for spatial query")
    .option("--geometry <geometry>", "geometry file to upload for spatial query ( single Feature in geojson file )")
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
    let requestMethod = "GET";
    let postData: string = "";

    uri = uri + "/" + id;

    if(options.vector && options.spatial) {
        console.log("options 'vector' and 'spatial' can not be used together");
        process.exit(1);
    }

    if(options.limit && options.all){
        console.log("options 'limit' and 'all' can not be used together");
        process.exit(1);
    }

    if(options.spatial && !(options.radius || options.center || options.feature || options.geometry)) {
        console.log("spatial option needs one of the following options to search - center, radius, feature or geometry");
        process.exit(1);
    }

    if(options.center && !options.radius){
        console.log("'radius' option is required for center spatial search to work");
        process.exit(1);
    }

    if(options.web && options.geometry) {
        console.log("usage of options web and geometry together is not supported yet, please try option web with radius, feature/center options");
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
            if(options.geojsonl){
                if (data.features && data.features.length > 0) {
                    data.features.forEach((element: any) => {
                        console.log(JSON.stringify(element));
                    });
                } 
            } else {
                console.log(JSON.stringify(data, null, 2));
            }
        };
    }

    cType = "application/geo+json";
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
            const expression = replaceOpearators(options.search);
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
                const refspace = refspacefeature[0];
                const reffeature = refspacefeature[1];
                uri = uri + "&" + "refSpaceId="+refspace+"&refFeatureId="+reffeature;
                if(options.radius) {
                    uri = uri + "&" + "radius="+ options.radius;
                }
            } else if(options.geometry) {
                let geometryinput = JSON.parse(await transform.read(options.geometry, false));
                if(geometryinput.type && geometryinput.type == 'FeatureCollection') {
                    console.log("you have supplied FeatureCollection instead of GeoJson-Geometry. Kindly supply one Feature or GeoJson-Geometry.");
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
    if (options.vector) {
        await launchXYZSpaceInvader(id, options.tags ? "&tags=" + options.tags : "", options.token);
    }
    else if (options.web) {
        //console.log(uri);
        await launchHereGeoJson(uri, options.token);
    } else {
        const response = await execute(
            uri,
            requestMethod,
            cType,
            postData,
            options.token
        );
        if (response.statusCode >= 200 && response.statusCode < 210) {

            let fields = [
                "id",
                "geometry.type",
                "tags",
                "createdAt",
                "updatedAt"
            ];
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

program
    .command("delete <id>")
    .description("delete the XYZ space with the given id")
    .option("--force", "skip the confirmation prompt")
    .option("--token <token>", "a external token to delete another user's space")
    .action(async (geospaceId, options) => {
        //console.log("geospaceId:"+"/geospace/"+geospaceId);
        

        deleteSpace(geospaceId, options)
            .catch((error) => {
                handleError(error, true);
            })

    });

async function deleteSpace(geospaceId: string, options:any) {

    if (!options.force) {
        await printDeleteWarning(geospaceId, options);
        console.log("Are you sure you want to delete the given space?");
        const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);

        const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
        if (termsResp !== "y" && termsResp !== "yes") {
            console.log("CANCELLED !");
            process.exit(1);
        }
    }

    const response = await execute(
        "/hub/spaces/" + geospaceId + "?clientId=cli",
        "DELETE",
        "application/json",
        "",
        options.token
    );
    if (response.statusCode >= 200 && response.statusCode < 210)
        console.log("XYZ space '" + geospaceId + "' deleted successfully");
}

program
    .command("create")
    .description("create a new XYZ space")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for XYZ space")
    .option("-d, --message [message]", "Short description ")
    .option("--token <token>", "a external token to create space in other user's account")
    .option("-s, --schema [schemadef]", "set json schema definition (local filepath / http link) for your space, all future data for this space will be validated for the schema")
    .action(options => createSpace(options)
        .catch(error => {
            handleError(error);
        }));

async function createSpace(options: any) {
    if (options) {
        if (!options.title) {
            options.title = "a new XYZ space created from commandline";
        }
        if (!options.message) {
            options.message = "a new XYZ space created from commandline";
        }
    }
    let gp: any = getGeoSpaceProfiles(options.title, options.message, options.client);

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

            let processors = getSchemaProcessorProfile(schemaDef);

            gp['processors'] = processors;
        }
    }


    const response = await execute("/hub/spaces?clientId=cli", "POST", "application/json", gp, options.token);
    console.log("XYZ space '" + response.body.id + "' created successfully");
    return response.body;
}

program
    .command("clear <id>")
    .description("clear data from XYZ space")
    .option("-t, --tags <tags>", "tags for the XYZ space")
    .option("-i, --ids <ids>", "ids for the XYZ space")
    .option("--token <token>", "a external token to clear another user's space data")
    .option("--force", "skip the confirmation prompt")
    .action(async (id, options) => {
        
        clearSpace(id, options).catch((error) => {
            handleError(error, true);
        })
    })

async function clearSpace(id: string, options: any) {

    if (!options.force) {
        if (!options.ids) {
            await printDeleteWarning(id, options);
        }
        console.log("Are you sure you want to clear data?");
        const answer = await inquirer.prompt<{ confirmed?: string }>(questionConfirm);

        const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
        if (termsResp !== "y" && termsResp !== "yes") {
            console.log("CANCELLED !");
            process.exit(1);
        }
    }

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

    const response = await execute(
        "/hub/spaces/" + id + "/features?" + finalOpt + "&clientId=cli",
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
    console.log("loading space details..");
    const jsonStats = await getStatsAndBasicForSpace(id);
    if (options.tags) {
        const tagsArray = options.tags.split(",").filter((x: any) => x != "")

        let tagsStats = jsonStats.tags.value.filter((tagStat: any) => tagsArray.indexOf(tagStat.key) >= 0).map((tagStat: any) => { tagStat['tag'] = tagStat.key; tagsArray.splice(tagsArray.indexOf(tagStat.key), 1); return tagStat; });

        for (const tag of tagsArray) {
            tagsStats.push({ tag: tag, count: 0 });
        }
        console.log("space details")
        const statsAll = [{ key: "space title", value: jsonStats.spacedef ? jsonStats.spacedef.title : "" }, { key: "space description", value: jsonStats.spacedef ? jsonStats.spacedef.description : "" }];
        common.drawTable(statsAll, ["key", "value"]);

        if (tagsStats && tagsStats.length > 0) {
            console.log("number of features matching for the tag(s) you have entered");
        }
        common.drawTable(tagsStats, ["tag", "count"]);
    } else {
        console.log("details of space and feature(s) being affected by this action");
        const statsAll = [{ key: "space title", value: jsonStats.spacedef ? jsonStats.spacedef.title : "" }, { key: "space description", value: jsonStats.spacedef ? jsonStats.spacedef.description : "" }];
        common.drawTable(statsAll, ["key", "value"]);

        const realStats =[{ key: "total features", value: jsonStats.count.value, estimated: jsonStats.count.estimated }, { key: "geometry types", value: jsonStats.geometryTypes.value, estimated: jsonStats.geometryTypes.estimated }]
        common.drawNewTable(realStats, ["key", "value", "estimated"], [20,20,20]);
        // OR we could print a normal statement like below.
        // console.log("There are total " + jsonStats.count.value + " features consisting geometry type(s) " + jsonStats.geometryTypes.value + " in the space.");

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

    const response = await requestAsync(options);
    if (response.statusCode != 200) {
        console.log("Error while fetching maxrights :" + response.body);
        return;
    }

    const tokenInfo = JSON.parse(response.body);
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

const validDateTags = ['year', 'month', 'week', 'weekday', 'year_month', 'year_week', 'hour'];
program
    .command("upload [id]")
    .description("upload GeoJSON, CSV, or a Shapefile to the given id -- if no spaceID is given, a new space will be created")
    .option("-f, --file <file>", "upload local GeoJSON, Shapefile, GPX, or CSV files (or GeoJSON/CSV URLs)")
    .option("-c, --chunk [chunk]", "chunk size, default 200 -- use lower values (e.g. 1-10) to allow safer uploads of large geometries, use higher values (e.g. 500-10000) for faster uploads of smaller geometries")
    .option("-t, --tags [tags]", "fixed tags for the XYZ space")
    .option("--token <token>", "a external token to upload data to another user's space")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    //     .option("-z, --alt [alt]", "altitude field name") // this breaks geojson
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a —point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option("-p, --ptag [ptag]", "property name(s) to be used to add tags, property_name@value, best for limited quantitative values")
    .option("-i, --id [id]", "property name(s) to be used as the feature ID (must be unique) -- multiple values can be comma separated")
    .option("-a, --assign","interactive mode to analyze and select fields to be used as tags and unique feature IDs")
    .option("-u, --unique","option to enforce uniqueness of the id by generating a unique ID based on feature hash") // is this redundant? might be from before we hashed property by default? or does this allow duplicates to be uploaded?
    .option("-o, --override", "override default property hash feature ID generation and use existing GeoJSON feature IDs")
    .option("-s, --stream", "streaming data support for fast and/or large csv and geojson uploads")
    .option('-d, --delimiter [,]', 'alternate delimiter used in CSV', ',')
    .option('-q, --quote ["]', 'quote used in CSV', '"')
    .option('-e, --errors', 'print data upload errors')
    .option('--string-fields <stringFields>', 'property name(s) of CSV string fields *not* to be automatically converted into numbers or booleans (e.g. number-like census geoids, postal codes with leading zeros)')
    .option('--groupby <groupby>', 'groupby a csv features with a particular property')
    .option('--date <date>', 'property name(s) of feature that needs to be converted to date')
    .option('--datetag [datetagString]', 'comma separated list of date tags to be added for date fields. possible options - year, month, week, weekday, year_month, year_week')
    .option('--dateprops [datepropsString]', 'comma separated list of date properties to be added for date fields. possible options - year, month, week, weekday, year_month, year_week')
    .option('--noCoords', 'upload CSV files with no coordinates, generate null geometry')
    .action(async function (id, options) {
        if(options.datetag && !options.date){
            console.log("--datetag option is only allowed with --date option");
            process.exit(1);
        }
        if (options.dateprops && !options.date) {
            console.log("--dateprops option is only allowed with --date option");
            process.exit(1);
        }
        if(options.datetag){
            if(!(options.datetag == true || options.datetag == undefined)){
                options.datetag.split(',').forEach((tag: string) => {
                    if(!validDateTags.includes(tag)){
                        console.log(tag + " is not a valid option. List of valid options - " + validDateTags);
                        process.exit(1);
                    }
                });
            }
        }
        if (options.dateprops) {
            if (!(options.dateprops == true || options.dateprops == undefined)) {
                options.dateprops.split(',').forEach((tag: string) => {
                    if (!validDateTags.includes(tag)) {
                        console.log(tag + " is not a valid option. List of valid options - " + validDateTags);
                        process.exit(1);
                    }
                });
            }
        }
        if(options.groupby && !(options.file.toLowerCase().indexOf(".csv") != -1 || options.file.toLowerCase().indexOf(".txt") != -1)){
            console.log("'groupby' option is only allowed with csv files");
            process.exit(1);
        }
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
            
            if(!options.stream && !(options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".gpx") != -1)){
                const streamInput = await inquirer.prompt<{ streamconfirmation?: boolean }>(streamconfirmationPrompt);
                if(streamInput.streamconfirmation){
                    options.stream = true;
                }
            }
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


export async function uploadToXyzSpace(id: string, options: any) {
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

    if(!options.stream && options.file && !(options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".gpx") != -1)){
        console.log("you can stream your uploads of CSV, GeoJSON and GeoJSONL files using the -s option. This will allow you to upload very large files, and will dramatically reduce the upload time for files of any size.");
    }

    if (options.file) {
        const fs = require("fs");
        if (options.file.toLowerCase().indexOf(".geojsonl") != -1) {
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
        } else if (options.file.toLowerCase().indexOf(".shp") != -1) {
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

        } else {
            if (!options.stream) {
                let result = await transform.read(
                    options.file,
                    false
                );
                let object = JSON.parse(result);
                if(!(object.features && object.features.length > 0 && object.features[0].type == 'Feature')){
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
                        "' uploaded to XYZ space '" +
                        id +
                        "'"
                    );
                else
                    console.log(
                        "data upload to XYZ space '" + id + "' completed"
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
                    "XYZ upload will generate unique IDs based on a hash of properties for all features by default (no features will be overwritten). See upload -h for more options.",
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
            const fId = common.createUniqueId(idStr, item);
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
                        item.properties['xyz_timestamp_'+element] = dateValue.valueOf();
                        item.properties['xyz_iso8601_'+element] = dateValue.toISOString(true).substring(0,dateValue.toISOString(true).length-6);
                        if(options.datetag){
                            addDatetimeTag(dateValue, element, options, finalTags);
                        }
                        if(options.dateprops){
                            addDatetimeProperty(dateValue, element, options, item);
                        }              
                    }
                });
            } catch(e){
                console.log("Invalid time format - " + e.message);
                process.exit(1);
            }    
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

function addDatetimeTag(dateValue:moment.Moment, element:string, options: any, finalTags: Array<string>){
    dateValue.locale('en');
    let allTags = false;
    if (options.datetag == true || options.datetag == undefined) {
        allTags = true;
    }
    let inputTagsList = [];
    if (!allTags) {
        inputTagsList = options.datetag.split(',');
    }
    if (allTags || inputTagsList.includes('year')) {
        addTagsToList(dateValue.year().toString(), 'date_' + element + '_year', finalTags);
    }
    if (allTags || inputTagsList.includes('month')) {
        addTagsToList(dateValue.format('MMMM'), 'date_' + element + '_month', finalTags);
    }
    if (allTags || inputTagsList.includes('year_month')) {
        addTagsToList(dateValue.year().toString() + '-' + ("0" + (dateValue.month() + 1)).slice(-2).toString(), 'date_' + element + '_year_month', finalTags);
    }
    if (allTags || inputTagsList.includes('week')) {
        addTagsToList(("0" + (dateValue.week())).slice(-2), 'date_' + element + '_week', finalTags);
    }
    if (allTags || inputTagsList.includes('year_week')) {
        addTagsToList(dateValue.year().toString() + '-' + ("0" + (dateValue.week())).slice(-2), 'date_' + element + '_year_week', finalTags);
    }
    if (allTags || inputTagsList.includes('weekday')) {
        addTagsToList(dateValue.format('dddd'), 'date_' + element + '_weekday', finalTags);
    }
    if (allTags || inputTagsList.includes('hour')) {
        addTagsToList(("0" + (dateValue.hour())).slice(-2), 'date_' + element + '_hour', finalTags);
    }
}

function addDatetimeProperty(dateValue:moment.Moment, element:string, options: any, item: any){
    dateValue.locale('en');
    let allTags = false;
    if (options.dateprops == true || options.dateprops == undefined) {
        allTags = true;
    }
    let inputTagsList = [];
    if (!allTags) {
        inputTagsList = options.dateprops.split(',');
    }
    if (allTags || inputTagsList.includes('year')) {
        item.properties['date_' + element + '_year'] = dateValue.year().toString();
    }
    if (allTags || inputTagsList.includes('month')) {
        item.properties['date_' + element + '_month'] = dateValue.format('MMMM');
    }
    if (allTags || inputTagsList.includes('year_month')) {
        item.properties['date_' + element + '_year_month'] = dateValue.year().toString() + '-' + ("0" + (dateValue.month() + 1)).slice(-2).toString();
    }
    if (allTags || inputTagsList.includes('week')) {
        item.properties['date_' + element + '_week'] = ("0" + (dateValue.week())).slice(-2);
    }
    if (allTags || inputTagsList.includes('year_week')) {
        item.properties['date_' + element + '_year_week'] = dateValue.year().toString() + '-' + ("0" + (dateValue.week())).slice(-2);
    }
    if (allTags || inputTagsList.includes('weekday')) {
        item.properties['date_' + element + '_weekday'] = dateValue.format('dddd');
    }
    if (allTags || inputTagsList.includes('hour')) {
        item.properties['date_' + element + '_hour'] = ("0" + (dateValue.hour())).slice(-2);
    }
}

function addTagsToList(value: string, tp: string, finalTags: string[]) {
    value = value.toString().toLowerCase();
    value = value.replace(/\s+/g, "_");
    value = value.replace(/,+/g, "_");
    value = value.replace(/&+/g, "_and_");
    value = value.replace(/\++/g, "_plus_");
    value = value.replace(/#+/g, "_num_");
    tp = tp.replace(/\s+/g, "_");
    //finalTags.push(value); // should we add tags with no @ an option?
    finalTags.push(tp + "@" + value);
    return finalTags;
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
    const response = await execute(
        url,
        "PUT",
        "application/geo+json",
        JSON.stringify(fc),
        null,
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

async function launchHereGeoJson(uri: string, token: string) {
    if(!token){
        token = await common.verify(true);
    }
    const accessAppend =
        uri.indexOf("?") == -1
            ? "?access_token=" + token
            : "&access_token=" + token;
    const open = require("open");
    open(
        "http://geojson.tools/index.html?url=" +
        common.xyzRoot() +
        uri +
        accessAppend
        , { wait: false });
}

async function launchXYZSpaceInvader(spaceId: string, tags: string, token: string) {
    if(!token){
        token = await common.verify(true);
    }
    const uri = "https://s3.amazonaws.com/xyz-demo/scenes/xyz_tangram/index.html?space=" + spaceId + "&token=" + token + tags; //TODO add property search values
    const open = require("open");
    open(
        uri
        , { wait: false });
}

async function getStatsAndBasicForSpace(spaceId: string) {
    let statsbody = await getSpaceStatistics(spaceId);
    statsbody['spacedef'] = await getSpaceMetaData(spaceId);
    return statsbody;
}


program
    .command("config <id>")
    .description("configure/view advanced XYZ features for space")
    .option("--shared <flag>", "set your space as shared / public (default is false)")
    //.option("-a,--autotag <tagrules>", "set conditional tagging rules")
    .option("-t,--title [title]", "set title for the space")
    .option("-d,--message [message]", "set description for the space")
    .option("-c,--copyright [copyright]", "set copyright text for the space")
    .option("--cacheTTL <cacheTTL>", "set cacheTTL value for the space with valid number")
    .option("--stats", "see detailed space statistics")
    .option("--token <token>", "a external token to access another user's space config and stats information")
    .option("-r, --raw", "show raw json output")
    .option("-s,--schema [schemadef]", "view or set schema definition (local filepath / http link) for your space, applicable on future data, use with add/delete/update")
    .option("--searchable", "view or configure searchable properties of an xyz space, use with add/delete/update")
    .option("--tagrules", "add, remove, view the conditional rules to tag your features automatically, use with add/delete/update -- at present all tag rules will be applied synchronously before features are stored ( mode : sync )")
    .option("--delete", "use with schema/searchable/tagrules options to remove the respective configurations")
    .option("--add", "use with schema/searchable/tagrules options to add/set the respective configurations")
    .option("--update", "use with tagrules options to update the respective configurations")
    .option("--view", "use with schema/searchable/tagrules options to view the respective configurations")
    .option("--activitylog","configure activity logs for your space interactively")

    .action(function (id, options) {
        configXyzSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    })

async function configXyzSpace(id: string, options: any) {
    if(options.schema || options.searchable || options.tagrules || options.activitylog){
        await common.verifyProLicense();
    }

    let patchRequest: any = {};
    let spacedef: any = null;

    let counter = ( options.schema ? 1 : 0 ) + ( options.searchable ? 1 : 0 ) + ( options.tagrules ? 1 : 0 ) + ( options.activitylog ? 1 : 0 )

    if (counter > 1) {
        console.log("conflicting options, searchable/schema/tagrules/activitylog options can not be used together.")
        process.exit(1);
    }

    if ((options.schema || options.searchable || options.tagrules || options.activitylog) &&
        (options.shared || options.title || options.message || options.copyright || options.stats)) {
        console.log("conflicting options, searchable/schema/tagrules options can be used only with add/update/view/delete options")
        process.exit(1);
    }

    if (!(options.schema || options.searchable || options.tagrules) &&
        (options.delete || options.add || options.view)) {
        console.log("invalid options, add/view/delete options cannot be used without searchable/schema/tagrules options")
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
    } else if (options.activitylog) {
        await activityLogConfig(id, options);
        process.exit(1);
    } else if (options.schema) {
        spacedef = await getSpaceMetaData(id);
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
    if (options.cacheTTL) {
        if(isNaN(options.cacheTTL)){
            console.log("cacheTTL option only accepts valid Number. Please provide valid number");
            process.exit(1);
        }
        patchRequest['cacheTTL'] = options.message;
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
        if ((options.schema == true && options.delete != true) || options.view) {
            if (spacedef.processors) {
                if(Array.isArray(spacedef.processors)){
                    let i = spacedef.processors.length;
                    while (i--) {
                        let processor = spacedef.processors[i];
                        if (processor.id === 'schema-validator') {
                            const response = await execute(processor.params.schemaUrl, "GET", "application/json", "");
                            console.log(JSON.stringify(response.body, null, 3));
                            process.exit(1);
                        }
                    }
                } else {
                    let schemaValidatorProcessor = spacedef.processors['schema-validator'];
                    if(schemaValidatorProcessor && schemaValidatorProcessor.length > 0){
                        const response = await execute(schemaValidatorProcessor[0].params.schemaUrl, "GET", "application/json", "");
                        console.log(JSON.stringify(response.body, null, 3));
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
        const response = await execute(
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
        const body = await getSpaceStatistics(id,options.token)
        if (options.raw) {
            console.log(body);
        } else {
            showSpaceStats(body);
        }
    } else {
        let result = await getSpaceMetaData(id,options.token);
        if (options.raw) {
            console.log(result);
        } else {
            showSpaceConfig(result);
        }
    }
}


async function activityLogConfig(id:string, options:any) {
    let enableMode = options.enable;
    await common.verifyProLicense();
    let patchRequest:any = {};

    let tabledata:any = {};
    let spacedef = await getSpaceMetaData(id);
    let enabled = false;
    //console.log(JSON.stringify(spacedef));
    if(spacedef.listeners) {
        const listeners:any = spacedef.listeners;
        const listenerIds = Object.keys(listeners);
        if(listenerIds.indexOf("activity-log-writer") > -1 || listenerIds.indexOf("activity-log") > -1) {
            for(let listenerid of listenerIds) {
                let listenerar = listeners[listenerid];
                for(let listener of listenerar) {
                    if(listenerid === 'activity-log-writer') {
                        tabledata.status = 'ENABLED';
                        tabledata.storage_mode = listener.params && listener.params.storageMode ? listener.params.storageMode : 'default';
                        tabledata.activitylog_space_id = listener.params ? listener.params.spaceId : '';
                    } else if (listenerid === 'activity-log') {
                        tabledata.state = listener.params && listener.params.states ? listener.params.states : 'default';
                    }
                }
            }

            if(Object.keys(tabledata).length > 0) {
                enabled = true;
                console.log("activity log is enabled for this space with below configurations.");
                console.table(tabledata);
            }
        } else {
            console.log("activity log for this space is not enabled.")
        }
    } else {
        console.log("activity log for this space is not enabled.")
    }
    
    if(enabled) {
        choiceList.push({'name': 'disable activity log for this space', 'value': 'disable'});
        choiceList.push({'name': 'reconfigure activity log for the space', 'value' : 'configure'});
    } else {
        choiceList.push({'name': 'enable activity log for this space', 'value': 'configure'});
    }
    choiceList.push({'name': 'cancel operation', 'value': 'abort'});

    const answer: any = await inquirer.prompt(activityLogAction);
    const actionChoice = answer.actionChoice;
    
    if(actionChoice == 'abort') {
        process.exit(1);
    } else if (actionChoice == 'disable') {
        patchRequest['listeners'] = {"activity-log": null};
    } else if(actionChoice == 'configure') {
        const configAnswer:any = await inquirer.prompt(activityLogConfiguration);
        //console.log(JSON.stringify(configAnswer));

        const storageMode = Array.isArray(configAnswer.storageMode) ? configAnswer.storageMode[0] : configAnswer.storageMode;
        const state = Array.isArray(configAnswer.state) ? configAnswer.state[0] : configAnswer.state;
        
        let listenerDef:any = getEmptyAcitivityLogListenerProfile();
        listenerDef['params'] = {};
        listenerDef['params'].states = state
        listenerDef['params'].storageMode = storageMode        
        patchRequest['listeners'] = {"activity-log": [listenerDef]};
    } else {
        console.log("please select only one option");
        process.exit(1);
    }
   //console.log(JSON.stringify(patchRequest));
    if(Object.keys(patchRequest).length > 0) {
    const url = `/hub/spaces/${id}?clientId=cli`
        const response = await execute(
                url,
                "PATCH",
                "application/json",
                patchRequest,
                null,
                false
            );

        if(response.statusCode >= 200 && response.statusCode < 210) {
            console.log("activity log configuration updated successfully, it may take a few seconds to take effect and reflect.");
        }
    } 
    //console.log(options);

}

function getEmptyAcitivityLogListenerProfile() {
    return {
            "id": "activity-log",
            "params": null,
            "eventTypes": [
                "ModifySpaceEvent.request"
            ]
        }
}


export async function getSpaceStatistics(id: string, token: string | null = null) {
    const uri = "/hub/spaces/" + id + "/statistics?clientId=cli&skipCache=true";
    const cType = "application/json";
    const response = await execute(uri, "GET", cType, "", token);
    return response.body;
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
    spaceconfigs.push({ property: 'enableUUID', value: spacedef.enableUUID || false });
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
                if (spacedef.listeners.hasOwnProperty(key) && spacedef.listeners[key].length > 0) {
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
    .command("join <id>")
    .description("{XYZ Pro} create a new virtual XYZ space with a CSV and a space with geometries, associating by feature ID")    
    .option("-f, --file <file>", "csv to be uploaded and associated")
    .option("-k, --keyField <keyField>", "field in csv file to become feature id")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a —point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option('-d, --delimiter [,]', 'alternate delimiter used in csv', ',')
    .option('-q, --quote ["]', 'quote used in csv', '"')
    .option("--token <token>", "a external token to create another user's spaces")
    .option("-s, --stream", "streaming data for faster uploads and large csv support")
    .option('--string-fields <stringFields>', 'property name(s) of CSV string fields *not* to be automatically converted into numbers or booleans (e.g. number-like census geoids, postal codes with leading zeros)')
    .action(function (id, options) {
        createJoinSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    })

async function createJoinSpace(id:string, options:any){
    await common.verifyProLicense();
    if(!options.file){
        console.log("ERROR : Please specify file for upload");
        return;
    }
    //setting title and message for new space creation
    options.title = path.parse(options.file).name + ' to be joined with ' +  id + ' in a virtual space';
    options.message = 'space data to be joined with ' + id + ' in new virtual space ';
    const response:any = await createSpace(options).catch(err => 
        {
            handleError(err);
            process.exit(1);                                           
        });
    const secondSpaceid = response.id;
    options.id = options.keyField;
    options.noCoords = true;
    options.askUserForId = true;
    await uploadToXyzSpace(secondSpaceid, options);

    //setting title and message for virtual space creation
    options.title = 'virtual space created from ' + id +  ' and data file space ' + secondSpaceid;
    options.message = 'virtual space created from ' + id +  ' and data file space ' + secondSpaceid;
    options.associate = secondSpaceid + ',' + id;
    await createVirtualSpace(options);
    return;
}

program
    .command("virtualize")
    .alias("vs")
    .description("{xyz pro} create a new virtual XYZ space")
    .option("-t, --title [title]", "Title for virtual XYZ space")
    .option("-d, --message [message]", "set description for the space")
    .option("-g, --group [spaceids]", "Group the spaces (all objects of each space will be part of the response) - enter comma separated space ids")
    .option("-a, --associate [spaceids]", "Associate the spaces. Features with same id will be merged into one feature. Enter comma separated space ids [space1,space2] -- space1 properties will be merged into space2 features.")
    .action(options => createVirtualSpace(options).catch((err) => { handleError(err) }));

async function createVirtualSpace(options: any) {

    await common.verifyProLicense();

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
    const response = await execute("/hub/spaces?clientId=cli", "POST", "application/json", gp);
    if (response.statusCode >= 200 && response.statusCode < 210) {
        console.log("virtual xyzspace '" + response.body.id + "' created successfully");
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
    if (match) {
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
    await common.verifyProLicense();
    let patchRequest: any = {};
    let spacedef = await getSpaceMetaData(id);
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
                    if (taggingRules && Object.keys(taggingRules).length > 0) {
                        patchRequest['processors']['rule-tagger'] = [];
                        patchRequest['processors']['rule-tagger'].push(ruleTagger);
                    }
                    if (taggingRulesAsync && Object.keys(taggingRulesAsync).length > 0) {
                        patchRequest['processors']['rule-tagger-async'] = [];
                        patchRequest['processors']['rule-tagger-async'].push(ruleTaggerAsync);
                    }
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
        const response = await execute(
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
    await common.verifyProLicense();
    let patchRequest: any = {};
    let spacedef = await getSpaceMetaData(id);

    let stats = await getSpaceStatistics(id);

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
                    console.log("All the properties of your space are currently searchable by default since your space size (feature count) is less than 10,000");
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
                    console.log("All the properties of your space are currently searchable by default since your space size (feature count) is less than 10,000");
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
        const response = await execute(
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

program
    .command("gis <id>")
    .description("{xyz pro} perform gis operations with space data")
    .option("--centroid", "calculates centroids of Line and Polygon features and uploads in a different space")
    .option("--length", "calculates length of LineString features")
    .option("--area", "calculates area of Polygon features")
    .option("--voronoi", "calculates Voronoi Polygons of point features and uploads in different space")
    .option("--tin", "calculates Delaunay Polygons of point features and uploads in different space")
    .option("--property <property>", "populates Delaunay polygons' properties based on the specified feature property")
    .option("-c, --chunk [chunk]", "chunk size, default 20 -- default for polygons, increase for faster point feature uploads")
    .option("-t, --tags <tags>", "source space tags to filter on")
    .option("--samespace", "option to upload centroids/voronoi/tin to same space, use tags to filter")
    .action(function (id, options) {
        gis.performGisOperation(id, options).catch((error) => {
            handleError(error, true);
        });
    });

export async function createNewSpaceAndUpdateMetadata(newSpaceType: string, sourceId: string, options: any){
    let newSpaceId;
    let sourceSpaceData = await getSpaceMetaData(sourceId, options.readToken);
    let newspaceData;
    let clientKey = newSpaceType + 'SpaceId';
    if ((sourceSpaceData.shared == true && await isOtherOwnerSpace(sourceSpaceData.owner)) || options.readToken) {
        console.log("shared space or readToken found, creating new " + newSpaceType + " space");
        newspaceData = await createNewSpaceUpdateMetadata(newSpaceType, sourceId, sourceSpaceData, false, options.writeToken);
        newSpaceId = newspaceData.id;
    } else if (!sourceSpaceData.client || !sourceSpaceData.client[clientKey]) {
        console.log("No " + newSpaceType + " space found, creating new " + newSpaceType + " space");
        newspaceData = await createNewSpaceUpdateMetadata(newSpaceType, sourceId, sourceSpaceData, true, options.writeToken);
        newSpaceId = newspaceData.id;
    } else {
        try {
            console.log("using exisitng " + newSpaceType + " space - " + sourceSpaceData.client[clientKey]);
            newSpaceId = sourceSpaceData.client[clientKey];
            newspaceData = await getSpaceMetaData(newSpaceId, options.writeToken);
        } catch (error) {
            if (error.statusCode && (error.statusCode == 404 || error.statusCode == 403)) {
                console.log("looks like existing " + newSpaceType + " space " + newSpaceId + " has been deleted or you don't have sufficient rights, creating new one ");
                newspaceData = await createNewSpaceUpdateMetadata(newSpaceType, sourceId, sourceSpaceData, true, options.writeToken);
                newSpaceId = newspaceData.id;
            } else {
                throw error;
            }
        }
    }
    return newspaceData;
}


// program
//     .command("activitylog <id>")
//     .description("enable, disable or view the activity log for your xyz space. activity log lets to see thru the history of feature modification")
//     .option("--enable", "enable activitylog for the space")
//     .option("--disable", "disable activitylog for the space")
//     .option("--state <state>", "number of history trail for a feature you would like to keep, please enter a number")
//     .option("--diff", "starage mode : store only the changed properties, not full feature")
//     .option("--full", "storage mode : store full feature, if the feature is modified")
//     .option("--view", "view the details of activitylog for the space")
//     .action(function (id,options) {
//         activityLogConfig(id,options).catch((error) => handleError(error, true));
//     })


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
        "virtualize",
        "gis",
        "join"
    ],
    [process.argv[2]],
    program
);
program.parse(process.argv);
