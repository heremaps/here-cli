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

import * as zlib from "zlib";
import { requestAsync } from "./requestAsync";
import * as program from "commander";
import * as common from "./common";
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
const open = require("open");
const XLSX = require('xlsx');
import * as moment from 'moment';
import * as glob from 'glob';
import { option } from "commander";
import { execInternal, handleError} from "./common";
import * as xyzutil from "./xyzutil";

import * as hexbin from "./hexbin";
const zoomLevelsMap = require('./zoomLevelsMap.json');
const h3ZoomLevelResolutionMap = require('./h3ZoomLevelResolutionMap.json');
let choiceList: { name: string, value: string }[] = [];

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

const sharingQuestion = [
    {
        type: "list",
        name: "sharingChoice",
        message: "Please select the shared spaces option",
        choices: [{name: 'request access to a space', value: 'newSharing'}, {name: 'list spaces you requested', value: 'request'}, {name: 'approve the requests of others', value: 'approval'}, {name: 'list spaces you are sharing', value: 'sharing'},{name: 'modify/revoke requests of others to share your spaces', value:'modifySharing'}]
    }
];

const sharingSpaceQuestion = [
    {
        type: "input",
        name: "sharingSpaceId",
        message: "Enter the spaceId you want access"
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

const geocoderAction = [
    {
        type: "list",
        name: "actionChoice",
        message: "Select action for geocoder",
        choices: choiceList
    }
];

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
];

const geocoderConfiguration = [
    {
        type: 'confirm',
        name: 'reverseGeocoderConfirmation',
        message: 'Do you want to enable reverse geocoding (coordinates to address)?',
        default: false
    },
    {
        type: 'confirm',
        name: 'forwardGeocoderConfirmation',
        message: 'Do you want to enable forward geocoding? (address to coordinates)',
        default: true
    }
];

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

program
    .command("list")
    .alias("ls")
    .description("information about available Data Hub spaces")
    .option("-r, --raw", "show raw Data Hub space definition")
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

//TODO - fix test execution and remove this method and directly use common module method
async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false) {
    if (!token) {
        token = await common.verify();
    }
    return await execInternal(uri, method, contentType, data, token, gzip, true);
}

async function listSpaces(options: any) {
    let result = await getListOfSpaces(options.token);
    if (result.length == 0) {
        console.log("No Data Hub space found");
    } else {
        let fields = ["id", "title", "description"];
        if (options.prop.length > 0) {
            fields = options.prop;
        }
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

async function getListOfSpaces(token: string | null = null){
    const uri = "?clientId=cli";
    const cType = "application/json";
    const response = await execute(uri, "GET", cType, "", token);
    return response.body;
}

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

program
    .command("analyze <id>")
    .description("property-based analysis of the content of the given [id], 500,000 feature limit")
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
        let uri = id;
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

    let analyseChoiceList = common.createChoiceList({ features: features });
    const questionAnalyze = [
        {
            type: "checkbox",
            name: "properties",
            message: "Select the properties to analyze",
            choices: analyseChoiceList
        }
    ];
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
    .description('create fixed height hexbins (and their centroids) using points in a Data Hub space, and upload them to another space')
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
    .option("--h3", "uses h3 library to create hexbins")
    .option("--resolution <resolution>", "h3 resolution (1-15) - comma separate multiple values(-z 8,10,12) or dash for continuous range(-z 10-15)")
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
                if(options.h3 && !(options.zoomLevels || options.resolution)){
                    console.error(`Please specify --zoomLevels or --resolution with --h3 option`);
                    process.exit(1);
                }
                if(!options.h3 && options.resolution){
                    console.error(`Please specify --h3 option with --resolution option`);
                    process.exit(1);
                }

                let cellSizes = new Set<number>();
                let zoomNumbers: number[] = [];
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
                                if(options.h3){
                                    cellSizes.add(parseInt(h3ZoomLevelResolutionMap[number]));
                                } else {
                                    cellSizes.add(parseInt(zoomLevelsMap[number]));
                                }
                                zoomNumbers.push(number);
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
                                    if(options.h3){
                                        cellSizes.add(parseInt(h3ZoomLevelResolutionMap[i]));
                                    } else {
                                        cellSizes.add(parseInt(zoomLevelsMap[i]));
                                    }
                                    zoomNumbers.push(i);
                                }
                            }
                        }
                    });
                } else if(options.resolution){
                    options.resolution.split(",").forEach(function (item: string) {
                        if (item && item != "") {
                            let resolution = item.split("-");
                            if (resolution.length === 1) {
                                let number = parseInt(resolution[0].toLowerCase());
                                if (isNaN(number) || number < 1 || number > 15) {
                                    console.error(`hexbin creation failed: resolution input "${resolution[0]}" is not a valid between 1-15`);
                                    process.exit(1);
                                }
                                cellSizes.add(number);
                            } else if (resolution.length !== 2) {
                                console.error(`hexbin creation failed: resolution input "${item}" is not a valid sequence`);
                                process.exit(1);
                            } else {
                                let lowNumber = parseInt(resolution[0].toLowerCase());
                                let highNumber = parseInt(resolution[1].toLowerCase());
                                if (isNaN(lowNumber) || isNaN(highNumber) || (lowNumber > highNumber) || lowNumber < 1 || lowNumber > 15 || highNumber < 1 || highNumber > 15) {
                                    console.error(`hexbin creation failed: resolution input "${resolution}" must be between 1-15`);
                                    process.exit(1);
                                }
                                for (var i = lowNumber; i <= highNumber; i++) {
                                    cellSizes.add(i);
                                }
                            }
                        }
                    });
                } else if (options.cellsize) {
                    if(options.h3){
                        console.error(`cellSize option is not available with --h3 option. please use --zoomLevels option`);
                        process.exit(1);
                    }
                    options.cellsize.split(",").forEach(function (item: string) {
                        if (item && item != "") {
                            let number = parseInt(item.toLowerCase());
                            if (isNaN(number)) {
                                console.error(`hexbin creation failed: cellsize input "${item}" is not a valid number`);
                                process.exit(1);
                            }
                            cellSizes.add(number);
                        }
                    });
                } else {
                    cellSizes.add(2000);
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
                console.log("Creating " + (options.h3 ? "h3": "") + " hexbins for the space data");
                do {
                    let jsonOut = await xyzutil.getSpaceDataFromXyz(id, options);
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
                            hexFeatures = hexbin.calculateHexGrids(features, cellsize, options.ids, options.groupBy, options.aggregate, options.latitude,options.h3, hexFeatures);
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
                        let logStat = "uploading the hexagon grids to space with " + (options.h3 ? "resolution ":"size ") + cellsize;
                        cellSizeSet.add(cellsize + "");
                        if (options.zoomLevels) {
                            let zoomNumberArr;
                            if(options.h3){
                                zoomNumberArr = getKeyArrayByValue(h3ZoomLevelResolutionMap, cellsize);
                            } else {
                                zoomNumberArr = getKeyArrayByValue(zoomLevelsMap, cellsize);
                            }
                            for(const zoomNumber of zoomNumberArr) {
                                logStat += " / zoom Level " + zoomNumber;
                                zoomLevelSet.add(zoomNumber + "");
                            }
                        }
                        console.log(logStat);
                        //console.log("data to be uploaded - " + JSON.stringify(hexFeatures));

                        let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
                        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: hexFeatures }));
                        if(options.h3){
                            options.tags = 'hexbin_h3_' + cellsize + ',h3_' + cellsize + ',hexbin,h3';
                        } else {
                            options.tags = 'hexbin_' + cellsize + ',cell_' + cellsize + ',hexbin';
                        }
                        if (options.zoomLevels || options.h3) {
                            let zoomNumberArr;
                            if(options.h3){
                                zoomNumberArr = getKeyArrayByValue(h3ZoomLevelResolutionMap, cellsize);
                            } else {
                                zoomNumberArr = getKeyArrayByValue(zoomLevelsMap, cellsize);
                            }
                            for(const zoomNumber of zoomNumberArr){
                                options.tags += ',zoom' + zoomNumber + ',zoom' + zoomNumber + '_hexbin';
                            }
                        }
                        //if(options.destSpace){
                        options.tags += ',' + sourceId;
                        //}
                        options.file = tmpObj.name;
                        options.stream = true;
                        await xyzutil.uploadToXyzSpace(id, options);

                        tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
                        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: centroidFeatures }));
                        if(options.h3){
                            options.tags = 'centroid_h3_' + cellsize + ',h3_' + cellsize + ',centroid,h3';
                        } else {
                            options.tags = 'centroid_' + cellsize + ',cell_' + cellsize + ',centroid';
                        }
                        if (options.zoomLevels || options.h3) {
                            let zoomNumberArr;
                            if(options.h3){
                                zoomNumberArr = getKeyArrayByValue(h3ZoomLevelResolutionMap, cellsize);
                            } else {
                                zoomNumberArr = getKeyArrayByValue(zoomLevelsMap, cellsize);
                            }
                            for(const zoomNumber of zoomNumberArr){
                                options.tags += ',zoom' + zoomNumber + ',zoom' + zoomNumber + '_centroid';
                            }
                        }
                        //if(options.destSpace){
                        options.tags += ',' + sourceId;
                        //}
                        options.file = tmpObj.name;
                        options.stream = true;
                        await xyzutil.uploadToXyzSpace(id, options);
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
    let newspaceData = await xyzutil.createSpace(newSpaceConfig);
    if (updateSourceMetadata) {
        await updateClientSpaceWithNewSpaceId(newSpaceType, sourceId, newspaceData.id);
    }
    return newspaceData;
}

async function updateClientSpaceWithNewSpaceId(newSpaceType: string, sourceId: string, newSpaceId: string) {
    const uri = sourceId + "?clientId=cli";
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
    const uri = id + "?clientId=cli";
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

function getKeyByValue(object: any, value: any) {
    return Object.keys(object).find(key => object[key] === value);
}

function getKeyArrayByValue(object: any, value: any) {
    return Object.keys(object).filter(key => object[key] === value);
}

async function getCentreLatitudeOfSpace(spaceId: string, token: string | null = null) {
    const body = await xyzutil.getSpaceStatistics(spaceId, token);
    let bbox = body.bbox.value;
    const centreLatitude = (bbox[1] + bbox[3]) / 2;
    return centreLatitude;
}

program
    .command("show <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw Data Hub space content")
    .option("--all", "iterate over entire Data Hub space to get entire data of space, output will be shown on the console in GeoJSON format")
    .option("--geojsonl", "to print output of --all in geojsonl format")
    .option("-c, --chunk [chunk]", "chunk size to use in --all option, default 5000")
    .option("--token <token>", "a external token to access another user's space")
    .option("-p, --prop <prop>", "selection of properties, use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt>")
    .option("-w, --web", "display Data Hub space on http://geojson.tools")
    .option("-v, --vector", "inspect and analyze using Data Hub Space Invader and tangram.js")
    .option("-x, --permanent", "uses Permanent token for --web and --vector option")
    .option("-s, --search <propfilter>", "search expression in \"double quotes\", use single quote to signify string value,  use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt> (Use '+' for AND , Operators : >,<,<=,<=,=,!=) (use comma separated values to search multiple values of a property) {e.g. \"p.name=John,Tom+p.age<50+p.phone='9999999'+p.zipcode=123456\"}")
    .option("--spatial","perform a spatial search on a space using --center, --feature, or --geometry")
    .option("--h3 <h3>","h3 resolution level to be used to iterate through a large spatial search on a space")
    .option("--saveHexbins","save the h3 hexbin geometries used to iterate through a large spatial search on a space")
    .option("--targetSpace [targetSpace]","target space id where the results of h3 spatial search will be written")
    .option("--radius <radius>", "the radius to be used with a --spatial --center search, or to add a buffer to a line or polygon (in meters)")
    .option("--center <center>", "comma separated, double-quoted lon,lat values specifying the center point of a --radius search")
    .option("--feature <feature>", "comma separated 'spaceid,featureid' values specifying a reference geometry in another space for a spatial query")
    .option("--geometry <geometry>", "geometry file to be uploaded for a --spatial query (a single feature in geojson file)")
    .action(function (id, options) {
        xyzutil.showSpace(id, options)
            .catch((error) => {
                handleError(error, true);
            });
    });

program
    .command("delete <id>")
    .description("delete the Data Hub space with the given id")
    .option("--force", "skip the confirmation prompt")
    .option("--token <token>", "a external token to delete another user's space")
    .action(async (geospaceId, options) => {
        //console.log("geospaceId:"+"/geospace/"+geospaceId);
        xyzutil.deleteSpace(geospaceId, options)
            .catch((error) => {
                handleError(error, true);
            })

    });

program
    .command("create")
    .description("create a new Data Hub space")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for Data Hub space")
    .option("-d, --message [message]", "Short description ")
    .option("--token <token>", "a external token to create space in other user's account")
    .option("--enableUUID", "to enable UUID for the space, its needed for enabling activity log for the space, by default its false")
    .option("-s, --schema [schemadef]", "set json schema definition (local filepath / http link) for your space, all future data for this space will be validated for the schema")
    .action(options => xyzutil.createSpace(options)
        .catch(error => {
            handleError(error);
        }));

program
    .command("clear <id>")
    .description("clear data from Data Hub space")
    .option("-t, --tags <tags>", "tags for the Data Hub space")
    .option("-i, --ids <ids>", "IDs for the Data Hub space")
    .option("--token <token>", "a external token to clear another user's space data")
    .option("--force", "skip the confirmation prompt")
    .action(async (id, options) => {
        xyzutil.clearSpace(id, options).catch((error) => {
            handleError(error, true);
        })
    })

program
    .command("token")
    .description("list all Data Hub tokens ")
    .option("--console","opens web console for Data Hub")
    .action((options) => {
        if(options.console){
            console.log("opening Data Hub web console")
            open("https://xyz.api.here.com/console", { wait: false });
        } else {
            listTokens().catch((error) => {
                handleError(error);
            });
        }
    });

async function listTokens() {
    const tokenInfo = await common.getTokenList();
    const currentToken = await common.decryptAndGet("keyInfo", "No token found");
    console.log(
        "===================================================="
    );
    console.log("Current CLI token is : " + currentToken);
    console.log(
        "===================================================="
    );
    for(let token of tokenInfo){
        if(token.exp){
            token.type = "TEMPORARY";
        } else {
            token.type = "PERMANENT";
        }
    }
    common.drawNewTable(tokenInfo, ["tid", "type", "iat", "description"], [25, 10, 10, 70]);
}

const validDateTags = ['year', 'month', 'week', 'weekday', 'year_month', 'year_week', 'hour'];
program
    .command("upload [id]")
    .description("upload one or more GeoJSON, CSV, GPX, XLS, or a Shapefile to the given id -- if no spaceID is given, a new space will be created; GeoJSON feature IDs will be respected unless you override with -o or specify with -i; pipe GeoJSON via stdout using | here xyz upload spaceid")
    .option("-f, --file <file>", "comma separated list of local GeoJSON, GeoJSONL, Shapefile, CSV, GPX, or XLS files (or GeoJSON/CSV URLs); use a directory path and --batch [filetype] to upload all files of that type within a directory")
    .option("-c, --chunk [chunk]", "chunk size, default 200 -- use smaller values (1 to 10) to allow safer uploads of very large geometries (big polygons, many properties), use higher values (e.g. 500 to 5000) for faster uploads of small geometries (points and lines, few properties)")
    .option("-t, --tags [tags]", "fixed tags for features uploaded to the Data Hub space")
    .option("--token <token>", "a external token to upload data to another user's space")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a -—point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option("-p, --ptag [ptag]", "property name(s) to be used to add tags, property_name@value, most useful for a small number of quantitative values")
    .option("-i, --id [id]", "property name(s) to be used as the feature ID (must be unique) -- multiple values can be comma separated")
    .option("-a, --assign","interactive mode to analyze and select fields to be used as tags and unique feature IDs")
//     .option("-u, --unique","option to enforce uniqueness of the id by generating a unique ID based on feature hash") // is this redundant? might be from before we hashed property by default? or does this allow duplicates to be uploaded?
    .option("-o, --override", "override default feature ID and use property hash feature ID generation")
    .option("-s, --stream", "streaming support for upload  and/or large csv and geojson uploads using concurrent writes, tune chunk size with -c")
    .option('-d, --delimiter [,]', 'alternate delimiter used in CSV', ',')
    .option('-q, --quote ["]', 'quote used in CSV', '"')
    .option('-e, --errors', 'print data upload errors')
    .option('--string-fields <stringFields>', 'property name(s) of CSV string fields *not* to be automatically converted into numbers or booleans (e.g. number-like census geoids, postal codes with leading zeros)')
    .option('--groupby <groupby>', 'consolidate multiple rows of a CSV into a single feature based on a unique ID designated with -i; values of each row within the selected column will become top level properties within the consolidated feature')
    .option('--promote <promote>', 'comma separated column names which should not be nested within a top level property generated consolidated by --groupby')
    .option('--flatten', 'stores the --groupby consolidated output in flattened string separated by colon (:) instead of a nested object')
    .option('--date <date>', 'date-related property name(s) of a feature to be normalized as a ISO 8601 datestring (datahub_iso8601_[propertyname]), and unix timestamp (datahub_timestamp_[propertyname] ')
    .option('--datetag [datetagString]', 'comma separated list of granular date tags to be added via --date. possible options - year, month, week, weekday, year_month, year_week, hour')
    .option('--dateprops [datepropsString]', 'comma separated list of granular date properties to be added via --date. possible options - year, month, week, weekday, year_month, year_week, hour')
    .option('--noCoords', 'upload CSV files with no coordinates, generates null geometry and tagged with null_island (best used with -i and virtual spaces)')
    .option('--history [history]', 'repeat commands previously used to upload data to a space; save and recall a specific command using "--history save" and "--history fav" ')
    .option('--batch [batch]', 'upload all files of the same type within a directory; specify "--batch [geojson|geojsonl|csv|shp|gpx|xls]" (will inspect shapefile subdirectories); select directory with -f')
    .action(async function (id, options) {
        if(options.history){
            await executeHistoryCommand(id, options);
        }
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
        if(!options.groupby && (options.flatten || options.promote)){
            console.log(options.promote ? "'promote'": "'flatten'" + " option is only allowed with 'groupby' option");
            process.exit(1);
        }
        if (!id && options.file) {
            console.log("No space ID specified, creating a new Data Hub space for this upload.");
            id = await xyzutil.promptInputAndCreateSpace(path.parse(options.file).name);
            
            if(!options.stream && !(options.file.toLowerCase().indexOf(".shp") != -1 || options.file.toLowerCase().indexOf(".gpx") != -1 || options.file.toLowerCase().indexOf(".xls") != -1 || options.file.toLowerCase().indexOf(".xlsx") != -1 || options.file.toLowerCase().indexOf(".zip") != -1)){
                const streamInput = await inquirer.prompt<{ streamconfirmation?: boolean }>(streamconfirmationPrompt);
                if(streamInput.streamconfirmation){
                    options.stream = true;
                }
            }
        }
        xyzutil.uploadToXyzSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    });

async function executeHistoryCommand(id: string, options: any){
    const commandHistoryCount = 3;
    if(options.history && !id){
        console.log("spaceId is mandatory for --history option");
        process.exit(1);
    }
    console.log("Fetching command history for space - " + id);
    let spaceData = await xyzutil.getSpaceMetaData(id, options.token);
    let history: Array<any> = [];
    if(options.history == 'clear'){
        if(spaceData.client && spaceData.client.history){
            await xyzutil.updateCommandMetadata(id, options, true, null);
        }
        console.log("command history deleted");
    } else if(options.history == 'save'){
        if(spaceData.client && spaceData.client.history){
            history = spaceData.client.history;
            const chosenCommand = await askCommandSelectionPrompt(history);
            await xyzutil.updateCommandMetadata(id, options, false, chosenCommand);
            console.log("favourite command saved successfully");
        } else {
            console.log("No command history available");
        }
    } else {
        let commandString: string;
        if(options.history == 'fav'){
            if(spaceData.client && spaceData.client.favouriteCommand){
                commandString = spaceData.client.favouriteCommand;
            } else {
                console.log("No favourite command available to execute");
                process.exit(1);
            }
        } else {
            if(spaceData.client && spaceData.client.history){
                history = spaceData.client.history;
            } else {
                console.log("No command history available for this space");
                process.exit(1);
            }
            if (options.history === true) {
                commandString = await askCommandSelectionPrompt(history);
            } else {
                let number = parseFloat(options.history.toLowerCase());
                if (isNaN(number) || (number < 0 || number > (commandHistoryCount - 1))) {
                    console.log("Please enter valid number between 0 and " + (commandHistoryCount - 1) + " in --history option");
                    process.exit(1);
                }
                if ((number + 1)  > history.length) {
                    console.log("space contains only " + history.length + " commands as history, please give number below that");
                    process.exit(1);
                }
                commandString = history[number].command;
                let confirmationPrompt = [{
                    type: 'confirm',
                    name: 'confirmation',
                    message: 'Executing command - ' + commandString + ' , Do you want to proceed?',
                    default: true
                }];
                const input = await inquirer.prompt<{ confirmation?: boolean }>(confirmationPrompt);
                if(!input.confirmation){
                    console.log("Exiting");
                    process.exit(1);
                }
            }
        }
        let newArgvStringArray: Array<string> = process.argv.slice(0,3);
        newArgvStringArray = newArgvStringArray.concat(commandString.split(" ").slice(3));
        process.argv = newArgvStringArray;
        console.log("Executing command - " + "here xyz upload " + process.argv.slice(3).join(" "));
        options.history = null;
        await program.parseAsync(process.argv);//making async call so that main thread execution stops
    }
    process.exit(0);//Explicitly calling exit because we dont want the execution to continue and upload to be done twice
}

async function askCommandSelectionPrompt(history: Array<any>){
    if(history.length == 0){
        console.log("No command history available for this space");
        process.exit(0);
    }
    const commandSelectionPrompt = [
        {
            type: "list",
            name: "command",
            message: "Select command",
            choices: choiceList
        }
    ];
    history.forEach(function (item: any) {
        choiceList.push({'name': item.timestamp + " , " + item.command, 'value': item.command});
    });
    const answer: any = await inquirer.prompt(commandSelectionPrompt);
    const result = answer.command;
    return result;
}

function extractOption(callBack: any) {
    inquirer
        .prompt<{ choice: string }>([
            {
                name: "choice",
                type: "list",
                message:
                    "Data Hub upload will generate unique IDs based on a hash of properties for all features by default (no features will be overwritten). See upload -h for more options.",
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

program
    .command("config [id]")
    .description("configure/view advanced Data Hub features for space")
    .option("--shared <flag>", "set your space as shared (visible to other DataHub users -- default is false)")
    .option("--readonly <flag>", "set your space as readOnly (default is false)")
    //.option("-a,--autotag <tagrules>", "set conditional tagging rules")
    .option("-t,--title [title]", "set title for the space")
    .option("-d,--message [message]", "set description for the space")
    .option("-c,--copyright [copyright]", "set copyright text for the space")
    .option("--cacheTTL <cacheTTL>", "set cacheTTL value for the space with valid number")
    .option("--stats", "see detailed space statistics")
    .option("--token <token>", "a external token to access another user's space config and stats information")
    .option("-r, --raw", "show raw json output")
    .option("-s,--schema [schemadef]", "view or set schema definition (local filepath / http link) for your space, applicable on future data, use with add/delete/update")
    .option("--searchable", "view or configure searchable properties of the Data Hub space, use with add/delete/update")
    .option("--tagrules", "add, remove, view the conditional rules to tag your features automatically, use with add/delete/update -- at present all tag rules will be applied synchronously before features are stored ( mode : sync )")
    .option("--delete", "use with schema/searchable/tagrules options to remove the respective configurations")
    .option("--add", "use with schema/searchable/tagrules options to add/set the respective configurations")
    .option("--update", "use with tagrules options to update the respective configurations")
    .option("--view", "use with schema/searchable/tagrules options to view the respective configurations")
    .option("--activitylog","configure activity logs for your space interactively")
    //.option("--geocoder","configure forward or reverse geocoding for your space interactively")
    .option("--console","opens web console for Data Hub")
    .action(function (id, options) {
        if(options.console){
            console.log("opening Data Hub web console")
            open("https://xyz.api.here.com/console", { wait: false });
        } else {
            if(!id){
                console.log("error: missing required argument 'id'");
                process.exit(1);
            }
            configXyzSpace(id, options).catch((error) => {
                handleError(error, true);
            });
        }
    })

async function configXyzSpace(id: string, options: any) {
    if(options.schema || options.searchable || options.tagrules || options.activitylog || options.geocoder){
        await common.verifyProLicense();
    }

    let patchRequest: any = {};
    let spacedef: any = null;

    let counter = ( options.schema ? 1 : 0 ) + ( options.searchable ? 1 : 0 ) + ( options.tagrules ? 1 : 0 ) + ( options.activitylog ? 1 : 0 ) + ( options.geocoder ? 1 : 0 )

    if (counter > 1) {
        console.log("conflicting options, searchable/schema/tagrules/activitylog/geocoder options can not be used together.")
        process.exit(1);
    }

    if ((options.schema || options.searchable || options.tagrules || options.activitylog || options.geocoder) &&
        (options.shared || options.readonly || options.title || options.message || options.copyright || options.stats)) {
        console.log("conflicting options, searchable/schema/tagrules/activitylog/geocoder options can be used only with add/update/view/delete options")
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
    } else if (options.geocoder) {
        await geocoderConfig(id, options);
        process.exit(1);
    } else if (options.schema) {
        spacedef = await xyzutil.getSpaceMetaData(id);
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
            console.log("Note that if you set a space to shared=true, anyone with a Data Hub account will be able to view it. If you want to share a space but limit who can see it, consider generating a read token for that space using https://xyz.api.here.com/console or 'show -w/-v -x' and distributing that");
            console.log("Are you sure you want to mark the space as shared?");
            const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);
            const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
            if (termsResp !== "y" && termsResp !== "yes") {
                console.log("CANCELLED !");
                process.exit(1);
            } else {
                console.log("setting the space SHARED");
                patchRequest['shared'] = true;
            }
        } else {
            console.log("setting the space NOT SHARED");
            patchRequest['shared'] = false;
        }
    }

    if (options.readonly) {
        if (options.readonly == 'true') {
            console.log("Note that if you set a space to readOnly=true, you will not be able to write to the space");
            console.log("Are you sure you want to mark the space as readOnly?");
            const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);
            const termsResp = answer.confirmed ? answer.confirmed.toLowerCase() : 'no';
            if (termsResp !== "y" && termsResp !== "yes") {
                console.log("CANCELLED !");
                process.exit(1);
            } else {
                console.log("setting the space readOnly");
                patchRequest['readOnly'] = true;
            }
        } else {
            console.log("setting the space NOT readOnly");
            patchRequest['readOnly'] = false;
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
                    const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);

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
                patchRequest['processors'] = common.getSchemaProcessorProfile(schemaDef);
            }
            //patchRequest['processors'] = spacedef.processors;
        }
    }

    if (Object.keys(patchRequest).length > 0) {

        if (options.stats) {
            console.log("Request of stats will be ignored, stats option can only be used standalone or with -r/--raw")
        }

        const url = `${id}?clientId=cli`
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
        const body = await xyzutil.getSpaceStatistics(id,options.token)
        if (options.raw) {
            console.log(body);
        } else {
            showSpaceStats(body);
        }
    } else {
        let result = await xyzutil.getSpaceMetaData(id,options.token);
        if (options.raw) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            showSpaceConfig(result);
        }
    }
}


async function activityLogConfig(id:string, options:any) {
    await common.verifyProLicense();
    let patchRequest:any = {};

    let tabledata:any = {};
    let spacedef = await xyzutil.getSpaceMetaData(id);
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
        listenerDef['params'].states = parseInt(state);
        listenerDef['params'].storageMode = storageMode
        patchRequest['listeners'] = {"activity-log": [listenerDef]};
    } else {
        console.log("please select only one option");
        process.exit(1);
    }
    //console.log(JSON.stringify(patchRequest));
    if(Object.keys(patchRequest).length > 0) {
        const url = `${id}?clientId=cli`
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

async function geocoderConfig(id:string, options:any) {
    await common.verifyProLicense();
    let patchRequest:any = {};
    const apiKey = await common.getLocalApiKey();
    let tabledata:any = {};
    let spacedef = await xyzutil.getSpaceMetaData(id);
    let enabled = false;
    if(spacedef.processors) {
        const processors:any = spacedef.processors;
        let processor = processors['geocoder-preprocessor'];
        if(processor && processor[0]){
            tabledata = processor[0].params;
        }
        if(Object.keys(tabledata).length > 0) {
            enabled = true;
            console.log("geocoder is enabled for this space with below configurations.");
            delete tabledata.apiKey;
            console.table(tabledata);
        } else {
            console.log("geocoder for this space is not enabled.")
        }
    } else {
        console.log("geocoder for this space is not enabled.")
    }
    
    if(enabled) {
        choiceList.push({'name': 'disable geocoder for this space', 'value': 'disable'});
        choiceList.push({'name': 'reconfigure geocoder for the space', 'value' : 'configure'});
    } else {
        choiceList.push({'name': 'enable geocoder for this space', 'value': 'configure'});
    }
    choiceList.push({'name': 'cancel operation', 'value': 'abort'});

    const answer: any = await inquirer.prompt(geocoderAction);
    const actionChoice = answer.actionChoice;
    
    if(actionChoice == 'abort') {
        process.exit(1);
    } else if (actionChoice == 'disable') {
        patchRequest['processors'] = {"geocoder-preprocessor": null};
    } else if(actionChoice == 'configure') {
        let params : any = {};
        params['apiKey'] = apiKey;
        params = await configureGeocodeInteractively(params, options);        
        let processorDef:any = getEmptyGeocoderProcessorProfile();
        processorDef['params'] = params;       
        patchRequest['processors'] = {"geocoder-preprocessor": [processorDef]};
    } else {
        console.log("please select only one option");
        process.exit(1);
    }
    if(Object.keys(patchRequest).length > 0) {
    const url = `${id}?clientId=cli`
        const response = await execute(
                url,
                "PATCH",
                "application/json",
                patchRequest,
                null,
                false
            );

        if(response.statusCode >= 200 && response.statusCode < 210) {
            console.log("geocoder configuration updated successfully, it may take a few seconds to take effect and reflect.");
        }
    }
}

async function configureGeocodeInteractively(params: any, options: any){
    const geocoderInput = await inquirer.prompt<{ reverseGeocoderConfirmation?: boolean, forwardGeocoderConfirmation?: boolean }>(geocoderConfiguration);
    if(geocoderInput.reverseGeocoderConfirmation){
        params['doReverseGeocode'] = true;
    }
    if(geocoderInput.forwardGeocoderConfirmation){
        params['doForwardGeocode'] = true;
        let qualifiedQueryList: { name: string, value: string }[] = [{name:'country',value:'country'}, {name:'state',value:'state'} , {name:'county',value:'county'}, {name:'city',value:'city'}, {name:'district',value:'district'}, {name:'street',value:'street'}, {name:'houseNumber',value:'houseNumber'}, {name:'postalCode',value:'postalCode'}];
        let csvColumnsChoiceList: { name: string, value: string }[] = [];
        if(options.file){
            if(options.file.toLowerCase().indexOf(".csv") != -1){
                csvColumnsChoiceList = await getCsvColumnsChoiceList(options);
            } else {
                console.error("ERROR : forward geocoding is only allowed for csv files");
                process.exit(1);
            }
        }
        const qualifiedQueryConfirmation = [
            {
                type: 'confirm',
                name: 'qualifiedQueryConfirmation',
                message: 'Is your address data structured? (columns for city, state, etc)?',
                default: false
            }];
        const qqInput = await inquirer.prompt<{ qualifiedQueryConfirmation: boolean }>(qualifiedQueryConfirmation);
        params['forwardQualifiedQuery'] = {};
        if(qqInput.qualifiedQueryConfirmation){
            params = await getQualifiedQueryInput(params, csvColumnsChoiceList, qualifiedQueryList, false);
        } else {
            params['forwardQuery'] = [];
            let forwardColumnSelection;
            if(csvColumnsChoiceList.length > 0){
                forwardColumnSelection = [
                    {
                        type: "checkbox",
                        name: "columnChoices",
                        message: "Select columns to be used for geocoding",
                        choices: csvColumnsChoiceList
                    }
                ];
            } else {
                forwardColumnSelection = [
                    {
                        type: "input",
                        name: "columnChoices",
                        message: "Enter comma separated column names to be used for geocoding",
                    }
                ];
            }
            let answers: any = await inquirer.prompt(forwardColumnSelection);
            let columnNames: string[];
            if(csvColumnsChoiceList.length > 0){
                columnNames = answers.columnChoices;
            } else {
                columnNames = answers.columnChoices.split(',');
            }
            columnNames.forEach((key: string) => {
                params['forwardQuery'].push("$"+key);
            });
        }
        const suffixConfirmationPrompt = [{
            type: 'confirm',
            name: 'suffixConfirmation',
            message: 'Do you want to add fix suffix strings to geocoding search?',
            default: false
        }];
        if(qualifiedQueryList.length > 0){
            const suffixConfirmationPromptInput = await inquirer.prompt<{ suffixConfirmation: boolean}>(suffixConfirmationPrompt);
            if(suffixConfirmationPromptInput.suffixConfirmation) {
                params = await getQualifiedQueryInput(params, csvColumnsChoiceList, qualifiedQueryList, true);
            }
        }
        const verbositySelection = [{
            type: "list",
            name: "verbosity",
            message: "Select verbosity level for forward geocoding",
            choices: [{name: 'NONE', value: 'NONE'},{name: 'MIN', value: 'MIN'},{name: 'MORE', value: 'MORE'},{name: 'ALL', value: 'ALL'}]
        }];
        const verbositySelectionInput = await inquirer.prompt<{ verbosity?: string }>(verbositySelection);
        if(verbositySelectionInput.verbosity){
            params['verbosity'] = verbositySelectionInput.verbosity;
        }
    }
    return params;
}

async function getQualifiedQueryInput(params: any, csvColumnsChoiceList: { name: string, value: string }[], qualifiedQueryList: { name: string, value: string }[], isSuffix: boolean){
    const continueQQConfirmation = [
        {
            type: 'confirm',
            name: 'continueQQConfirmation',
            message: 'Do you want to add more qualified query parameters?',
            default: false
        }];
    
    const forwardQualifiedKeySelection = [
        {
            type: 'list',
            name: 'forwardQualifiedKey',
            message: 'Please select qualified query type',
            choices: qualifiedQueryList
        }];
    
    let forwardQualifiedColumnSelection;
    if(csvColumnsChoiceList.length > 0){
        forwardQualifiedColumnSelection = [
            {
                type: "list",
                name: "forwardQualifiedColumn",
                message: "Select column to be used for qualified parameter",
                choices: csvColumnsChoiceList
            }
        ];
    } else {
        forwardQualifiedColumnSelection = [
            {
                type: "input",
                name: "forwardQualifiedColumn",
                message: "Enter the column name to be used for qualified parameter",
            }
        ];
    }
    const forwardSuffixValueSelection = [
        {
            type: 'input',
            name: 'suffix',
            message: 'Enter fixed suffix string to be used for qualified parameter'
        }
    ]
    let continueQQInput = true;
    while(continueQQInput && qualifiedQueryList.length > 0){
        const forwardQualifiedKeySelectionInput = await inquirer.prompt<{ forwardQualifiedKey: string }>(forwardQualifiedKeySelection);
        if(isSuffix){
            const forwardSuffixValueSelectionInput = await inquirer.prompt<{ suffix: string }>(forwardSuffixValueSelection);
            params['forwardQualifiedQuery'][forwardQualifiedKeySelectionInput.forwardQualifiedKey] = forwardSuffixValueSelectionInput.suffix;
        } else {
            const forwardQualifiedColumnSelectionInput = await inquirer.prompt<{ forwardQualifiedColumn: string }>(forwardQualifiedColumnSelection);
            params['forwardQualifiedQuery'][forwardQualifiedKeySelectionInput.forwardQualifiedKey] = "$" + forwardQualifiedColumnSelectionInput.forwardQualifiedColumn;
        }
        for(var i = 0; i < qualifiedQueryList.length; i++){
            if(qualifiedQueryList[i].value == forwardQualifiedKeySelectionInput.forwardQualifiedKey){
                qualifiedQueryList.splice(i, 1);
                break;
            }
        }
        const continueQQConfirmationInput = await inquirer.prompt<{ continueQQConfirmation: boolean }>(continueQQConfirmation);
        continueQQInput = continueQQConfirmationInput.continueQQConfirmation;
    }
    return params;
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

function getEmptyGeocoderProcessorProfile() {
    return {
            "id": "geocoder-preprocessor",
            "params": null
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
    spaceconfigs.push({ property: 'enableUUID', value: spacedef.enableUUID || false });
    spaceconfigs.push({ property: 'client', value: JSON.stringify(spacedef.client) });
    spaceconfigs.push({ property: 'shared', value: spacedef.shared || false });
    spaceconfigs.push({ property: 'readOnly', value: spacedef.readOnly || false });

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

const validVerbosityLevels = ["NONE", "MIN", "MORE", "ALL"];
/*
program
    .command("geocode [id]")
    .description("{Data Hub Add-on} create a new space with a CSV and configures geocoder processor on it") 
    .option("-t, --title [title]", "Title for Data Hub space")
    .option("-d, --message [message]", "Short description ")   
    .option("-f, --file <file>", "file to be uploaded and associated")
    .option("-i, --keyField <keyField>", "field in csv file to become feature id")
    .option("--keys <keys>", "comma separated property names of csvProperty and space property")
    .option("--forward <forward>", "comma separated property names to be used for forward geocoding")
    .option("--reverse", "reverse geocoding")
    .option("--suffix <suffix>", "comma separated suffix string to be used for forward geocoding")
    .option("--verbosity <verbosity>", "verbosity level to be used for forward geocoding")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a —point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option('-d, --delimiter [,]', 'alternate delimiter used in csv', ',')
    .option('-q, --quote ["]', 'quote used in csv', '"')
    .option("-s, --stream", "streaming data for faster uploads and large csv support")
    .action(function (id, options) {
        createGeocoderSpace(id, options).catch((error) => {
            handleError(error, true);
        });
    })
*/

async function createGeocoderSpace(id:string, options:any){
    await common.verifyProLicense();
    if(!options.file){
        console.log("ERROR : Please specify file for upload");
        return;
    }
    if(options.forward && options.reverse){
        console.log("ERROR : Please specify only one option from forward or reverse");
        return;
    }
    if(options.verbosity && !validVerbosityLevels.includes(options.verbosity.toUpperCase())){
        console.log("ERROR : Please specify valid verbosity level - " + validVerbosityLevels);
        return;
    }
    let params : any = {};
    params['apiKey'] = await common.getLocalApiKey();;
    if(!options.forward && !options.reverse){
        params = await configureGeocodeInteractively(params, options);
    }
    if(options.reverse){
        params['doReverseGeocode'] = true;
    }
    if(options.forward){
        params['doForwardGeocode'] = true;
        params['forwardQuery'] = options.forward.split(',').map((x: string) => "$"+x.trim());
        if(options.suffix){
            const suffixArray: string[] = options.suffix.split(',').map((x: string) => x.trim());;
            params['forwardQuery'] = params['forwardQuery'].concat(suffixArray);
        }
        if(options.verbosity){
            params['verbosity'] = options.verbosity.toUpperCase();
        }
    }
    let processorDef:any = getEmptyGeocoderProcessorProfile();
    processorDef['params'] = params;       
    if(id){
        let patchRequest:any = {};
        patchRequest['processors'] = {"geocoder-preprocessor": [processorDef]};
        const url = `${id}?clientId=cli`
        const response = await execute(
                url,
                "PATCH",
                "application/json",
                patchRequest,
                null,
                false
            );
    } else {
        if(!options.title){
            options.title = (options.forward ? "forward" : " reverse") + " geocode " + path.parse(options.file).name;
        }
        if(!options.message){
            options.message = (options.forward ? "forward" : " reverse") + " geocode " + path.parse(options.file).name;
        }
        options.processors = {"geocoder-preprocessor": [processorDef]};
        const spaceData:any = await xyzutil.createSpace(options).catch(err => 
            {
                handleError(err);
                process.exit(1);                                           
            });
        id = spaceData.id;
    }
    options.id = options.keyField;
    options.noCoords = true;
    options.geocode = true;
    await xyzutil.uploadToXyzSpace(id, options);
}

async function getCsvColumnsChoiceList(options: any){
    let csvColumnsChoiceList: { name: string, value: string }[] = [];
    const rows = await transform.getFirstNRowsOfCsv(options, 3);
    for (let i = 0; i < rows.length; i++) {
        let j = 0;
        for (let key in rows[0]) {
            if (i === 0) {
                const desc =
                    "" +
                    (1 + j++) +
                    " : " +
                    key +
                    " : " +
                    rows[i][key];
                    csvColumnsChoiceList.push({ name: desc, value: key });
            } else {
                csvColumnsChoiceList[j].name = csvColumnsChoiceList[j].name + " , " + rows[i][key];
                j++;
            }
        }
    }
    return csvColumnsChoiceList;
}

program
    .command("sharing")
    .description("configure/view sharing information for Data Hub spaces")
    .option("--request [request]", "view and configure existing data hub space sharing requests")
    .option("--approval", "view and configure existing data hub space approval requests")
    .option("--retract <retract>", "retract your requests to share another user's space")
    .action(async function (options) {
        try{
            await common.verifyProLicense();
            if(options.request && options.approval){
                console.log("ERROR : Only one of the --request or --approval option allowed");
                return;
            }
            if(!options.request && !options.approval && !options.retract){
                const answer: any = await inquirer.prompt(sharingQuestion);
                const result = answer.sharingChoice;
                if(result === 'newSharing'){
                    const spaceIdAnswer: any = await inquirer.prompt(sharingSpaceQuestion);
                    if(spaceIdAnswer.sharingSpaceId == ''){
                        console.log("ERROR : Please enter a valid spaceId");
                        return;
                    }
                    options.request = spaceIdAnswer.sharingSpaceId;
                } else if(result === 'request') {
                    options.request = true;
                } else if(result === 'approval'){
                    options.approval = true;
                } else if(result == 'sharing'){
                    await showExistingSharings();
                } else if(result == 'modifySharing'){
                    let existingSharings = await common.getExistingSharing();
                    existingSharings = await addTitleInSharingList(existingSharings, true);
                    if(existingSharings.length == 0){
                        console.log("No spaces are shared");
                        return;
                    }
                    let choiceList: { name: string, value: any }[] = [];
                    for(let sharing of existingSharings){
                        choiceList.push({name: sharing.spaceId + " '" + sharing.title + "' " + sharing.emailId + ' ' + sharing.urm, value: {id: sharing.id, title: sharing.title}});
                    }
                    const sharingModifyQuestion = [
                        {
                            type: "list",
                            name: "sharingId",
                            message: "Please select the sharing you want to revoke/modfiy",
                            choices: choiceList
                        }
                    ];
                    const sharingAnswer: any = await inquirer.prompt(sharingModifyQuestion);
                    const sharingId = sharingAnswer.sharingId.id;
                    let actionList = [{name:'Revoke', value: 'revoke'}];
                    if(sharingAnswer.sharingId.title != "SPACE IS DELETED"){
                        actionList.push({name: 'Modify', value: 'modify'});
                    }
                    const actionSelectionPrompt = [ {
                        type: "list",
                        name: "action",
                        message: "Please select your decision",
                        choices: actionList
                    }];
                    const actionAnswer: any = await inquirer.prompt(actionSelectionPrompt);
                    const action = actionAnswer.action;
                    if(action == 'revoke'){
                        await common.deleteSharing(sharingId);
                        console.log("Sharing revoked successfully");
                    } else if(action == 'modify'){
                        const urm = await askSharingRightsQuestion();
                        await common.modifySharingRights(sharingId, urm);
                        console.log("Sharing rights modified successfully");
                    }
                }
            }
            if(options.request){
                if(options.request != true){
                    const newSharingRequest = await common.createNewSharingRequest(options.request);
                    console.log("New sharing request created with id - " + newSharingRequest.id);
                } else {
                    await showExistingSharingRequests();
                }
            } else if(options.approval){
                await showExistingApprovals();
            } else if(options.retract){
                let sharingRequests = await common.getSharingRequests();
                let status = null;
                for(let sharingRequest of sharingRequests){
                    if(sharingRequest.id == options.retract){
                        status = sharingRequest.status;
                        break;
                    }
                }
                if(!status){
                    console.log("Sharing request with id " + options.retract + " does not exist. Please give valid sharingId");
                    return;
                } else if(status == 'ACCEPTED'){
                    await common.deleteSharing(options.retract);
                } else {
                    await common.deleteSharingRequest(options.retract);
                }
                console.log("Sharing request retracted successfully");
            }
        } catch(error) {
            console.log(error.statusCode);
            handleError(error, false);
        }
    });

async function showExistingSharingRequests(){
    let sharingRequests = await common.getSharingRequests();
    sharingRequests = await addTitleInSharingList(sharingRequests, false);
    //TODO - check how to give delete operation
    common.drawNewTable(sharingRequests, ['id', 'spaceId','title', 'urm','status']);
}

async function showExistingSharings(){
    let existingSharings = await common.getExistingSharing();
    existingSharings = await addTitleInSharingList(existingSharings, true);
    //TODO - check how to give delete and update operation
    common.drawNewTable(existingSharings, ['id', 'spaceId','title', 'emailId', 'urm','status']);
}

async function addTitleInSharingList(sharingList: any[], isOwner: boolean){
    let spaceMap = new Map<string,any>();
    if(isOwner){
        let spaceList = await getListOfSpaces();
        for(let space of spaceList){
            spaceMap.set(space.id, space);
        }
    }   
    for(let sharing of sharingList){
        let spaceData;
        if(isOwner){
            spaceData = spaceMap.get(sharing.spaceId);
        } else {
            try{
                if(sharing.status == 'ACCEPTED'){
                    spaceData = await xyzutil.getSpaceMetaData(sharing.spaceId);
                } else {
                    spaceData = {'title': ''};
                }
            } catch(error){
                if(!error.statusCode || error.statusCode != 404){
                    throw error;
                }
            }
        }
        if(spaceData){
            sharing.title = spaceData.title;
        } else {
            sharing.title = "SPACE IS DELETED";
        }
    }
    return sharingList;
}

async function showExistingApprovals(){
    let existingApprovals = await common.getExistingApprovals();
    existingApprovals = await addTitleInSharingList(existingApprovals, true);
    let choiceList: { name: string, value: any }[] = [];
    for(let sharingApproval of existingApprovals){
        if(sharingApproval.status == 'PENDING'){
            choiceList.push({name: sharingApproval.spaceId + " '" + sharingApproval.title + "' " + sharingApproval.emailId, value: { id: sharingApproval.id, title: sharingApproval.title}});
        }
    }
    if(choiceList.length === 0){
        console.log("No approvals pending.");
    } else {
        const approvalSelectionPrompt = [
            {
                type: "list",
                name: "sharingId",
                message: "Select sharing request for approval",
                choices: choiceList
            }
        ];
        const answer: any = await inquirer.prompt(approvalSelectionPrompt);
        const sharingId = answer.sharingId.id;
        let verdictList = [{name:'reject', value: 'reject'}];
        if(answer.sharingId.title != "SPACE IS DELETED"){
            verdictList.push({name: 'accept', value: 'accept'});
        }
        const verdictSelectionPrompt = [ {
            type: "list",
            name: "verdict",
            message: "Please select your decision",
            choices: verdictList
        }];
        const verdictAnswer: any = await inquirer.prompt(verdictSelectionPrompt);
        const verdict = verdictAnswer.verdict; 
        let urm;
        if(verdict === 'accept'){
            urm = await askSharingRightsQuestion();
        }
        await common.putSharingApproval(sharingId, verdict, urm);
        console.log("sharing request " + sharingId + " " + verdict + "ed successfully");
    }
}

async function askSharingRightsQuestion(){
    const rightsSelectionPrompt = [
        {
            type: "checkbox",
            name: "urm",
            message: "Select the rights for the sharing",
            choices: [{name: 'readFeatures', value: 'readFeatures'},{name: 'createFeatures', value: 'createFeatures'},{name: 'updateFeatures', value: 'updateFeatures'}]
        }
    ];
    const rightsAnswer: any = await inquirer.prompt(rightsSelectionPrompt);
    const urm = rightsAnswer.urm;
    if(urm.length === 0){
        console.log("ERROR : Please select atleast one right for sharing approval");
        process.exit(1);
    }
    return urm;
}

program
    .command("join <id>")
    .description("{Data Hub Add-on} create a new virtual Data Hub space with a CSV and a space with geometries, associating by feature ID")
    .option("-f, --file <file>", "csv to be uploaded and associated")
    .option("-i, --keyField <keyField>", "field in csv file to become feature id")
    .option("--keys <keys>", "comma separated property names of csvProperty and space property")
    .option("--filter <filter>", "additional filter search to be used with --keys option")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a —point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option('-d, --delimiter [,]', 'alternate delimiter used in csv', ',')
    .option('-q, --quote ["]', 'quote used in csv', '"')
    .option("--token <token>", "a external token to create another user's spaces")
    .option("-s, --stream", "streaming data for faster uploads and large csv support")
    .option('--string-fields <stringFields>', 'property name(s) of CSV string fields *not* to be automatically converted into numbers or boolean (e.g. number-like census geoids, postal codes with leading zeros)')
    .option('--groupby <groupby>', 'consolidate multiple rows of a CSV into a single feature based on a unique ID designated with -i; values of each row within the selected column will become top level properties within the consolidated feature')
    .option('--promote <promote>', 'comma separated colunm names which should not be nested')
    .option('--flatten', 'stores the groupby operation output in flatten format seprated by colon (:)')
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
    if(options.keyField && options.keys){
        console.log("only one option allowed, please give either 'keyField' or 'keys' and not both");
        process.exit(1);
    }
    if(options.keys){
        options.primarySpace = id;
        const keysArray = options.keys.split(",");
        if(keysArray.length !== 2){
            console.log("please give proper propInCSV,propInSpace in --keys option");
            process.exit(1);
        }
        options.csvProperty = keysArray[0];
        options.spaceProperty = keysArray[1];
        options.ignoreLogs = true;
    }
    if(!options.keys && options.filter){
        console.log("--filter option is only allowed with --keys option");
        process.exit(1);
    }
    //setting title and message for new space creation
    options.title = path.parse(options.file).name + ' to be joined with ' +  id + ' in a virtual space';
    options.message = 'space data to be joined with ' + id + ' in new virtual space ';
    const response:any = await xyzutil.createSpace(options).catch(err =>
    {
        handleError(err);
        process.exit(1);
    });
    const secondSpaceid = response.id;
    options.id = options.keyField;
    options.noCoords = true;
    options.askUserForId = true;
    await xyzutil.uploadToXyzSpace(secondSpaceid, options);

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
    .description("{Data Hub Add-on} create a new virtual Data Hub space")
    .option("-t, --title [title]", "Title for virtual Data Hub space")
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
        console.log("virtual Data Hub space '" + response.body.id + "' created successfully");
    }
}

function createVirtualSpaceTitle(spaceids: any[], isAssociate: boolean) {
    let title = "Data Hub Virtual Space, " + spaceids[0];
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
        spaceData[i] = await xyzutil.getSpaceMetaData(spaceids[i]);
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
    let spacedef = await xyzutil.getSpaceMetaData(id);
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
                    const answer = await inquirer.prompt<{ confirmed?: string }>(common.questionConfirm);
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

        const url = `${id}?clientId=cli`;
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
//     .description("view or configure searchable properties of an Data Hub space")
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
    let spacedef = await xyzutil.getSpaceMetaData(id);

    let stats = await xyzutil.getSpaceStatistics(id);

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

        const url = `${id}?clientId=cli`
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
    .description("{Data Hub Add-on} perform gis operations with space data")
    .option("--centroid", "calculates centroids of Line and Polygon features and uploads to a different space")
    .option("--length", "calculates length of LineString features and adds it as new properties")
    .option("--area", "calculates area of Polygon features and adds as new properties")
    .option("--voronoi", "calculates Voronoi Polygons of point features and uploads in different space")
    .option("--delaunay", "calculates Delaunay Polygons of point features and uploads in different space")
    .option("--neighbours", "calculates Delaunay neighbours of each point feature and store the ids in the xyz_delaunay_neighbours array")
    //.option("--property <property>", "populates Delaunay polygons' properties based on the specified feature property")
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
    let sourceSpaceData = await xyzutil.getSpaceMetaData(sourceId, options.readToken);
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
            newspaceData = await xyzutil.getSpaceMetaData(newSpaceId, options.writeToken);
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
//     .description("enable, disable or view the activity log for your Data Hub space. activity log lets to see thru the history of feature modification")
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
        "clear",
        "token",
        "analyze",
        "hexbin",
        "config",
        "vs",
        "virtualize",
        "gis",
        "join",
        "sharing"
    ],
    [process.argv[2]],
    program
);
program.name('here xyz').parse(process.argv);
