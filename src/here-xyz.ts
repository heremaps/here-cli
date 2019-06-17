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
const gsv = require("geojson-validation");

let hexbin = require('./hexbin');
const zoomLevelsMap = require('./zoomLevelsMap.json');;
let choiceList: { name: string, value: string}[] = [];
const bboxDirections = ["west","south","east","north"];
const questions = [
    {
        type: "checkbox",
        name: "tagChoices",
        message: "Select attributes which needs to be added as tags like key@value",
        choices: choiceList
    },
    {
        type: "checkbox",
        name: "idChoice",
        message:
            "Select attributes which would be used as Id, please note that ID field has to be unique",
        choices: choiceList
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

program.version("0.1.0");

function getGeoSpaceProfiles(title: string, description: string, client: any) {
    return {
        title,
        description,
        client
    };
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
    const isJson = contentType == "application/json" ? true : false;
    const reqJson = {
        url: common.xyzRoot() + uri,
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
    if (response.statusCode < 200 || response.statusCode > 210){
        let message = (response.body && response.body.constructor != String)?JSON.stringify(response.body):response.body;
        throw new Error("Invalid response - " + message);
    }
    return body;
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
    retry : number=3
) {
    const zippedData = await gzip(data);
    const isJson = contentType == "application/json" ? true : false;

    const reqJson = {
        url: common.xyzRoot() + uri,
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
    if (response.statusCode < 200 || response.statusCode > 210){
        if(response.statusCode>=500){
            await new Promise(done => setTimeout(done, 1000));
            body = execInternalGzip(uri,method,contentType,data,token,retry--);
        }else{
            throw new Error("Invalid response :"+response.statusCode);
        }
    }
    return body;
}

async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false) {
    if(!token){
        token = await common.verify();
    }
    return await execInternal(uri, method, contentType, data, token, gzip);
}

program
    .command("list")
    .alias("ls")
    .description("information about available xyz spaces")
    .option("-r, --raw", "show raw xyzspace definition")
    .option(
        "-p, --prop <prop>",
        "property fields to include in table",
        collect,
        []
    )
    .action(async function(options) {
        listSpaces(options)
    });

async function listSpaces(options:any){
    const uri = "/hub/spaces?clientId=cli";
    const cType = "application/json";
    let tableFunction = common.drawTable;
    if (options.raw) {
        tableFunction = function(data: any, columns: any) {
            try {
                console.log(JSON.stringify(JSON.parse(data), null, 2));
            } catch (e) {
                console.log(JSON.stringify(data, null, 2));
            }
        };
    }
    const body = await execute(uri, "GET", cType, "");
    if (body.length == 0) {
        console.log("No xyzspace found");
    } else {
        let fields = ["id", "title", "description"];
        if (options.prop.length > 0) {
            fields = options.prop;
        }
        tableFunction(body, fields);
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
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
        (async () => {
            let featureCollection = await getSpaceDataFromXyz(id,options);
            summary.summarize(featureCollection.features,id, false);
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
            if(options.bbox){
                spFunction = "bbox";
                options.limit = 100000;//Max limit of records space api supports 
            } else {
                spFunction = "iterate";
            }
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit  + "&clientId=cli";
                if(options.bbox){
                    var bboxarray = options.bbox.split(",");
                    if(bboxarray.length !== 4){
                        console.error(`boundingbox input size is not proper - "${options.bbox}"`);
                        process.exit(1);
                    }
                    console.log(bboxarray);
                    bboxarray.forEach(function (item : string, i: number) {
                        if (item && item != "") {
                            let number = parseInt(item.toLowerCase());
                            if (isNaN(number)){
                                console.error(`Loading space data using boudning box failed - boundingbox input "${item}" is not a valid number`);
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
                if(cHandle === 0){
                    process.stdout.write("Operation may take a while. Please wait .....");
                }
                do {
                    process.stdout.write(".");
                    jsonOut = await execute(
                        getUrI(String(cHandle)),
                        "GET",
                        cType,
                        "",
                        options.token,
                        true
                    );

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
                    if(options.currentHandleOnly){
                        cHandle = -1;
                        break;
                    }
                } while (cHandle >= 0 && recordLength < options.totalRecords);
                process.stdout.write("\n");
                jsonOut.features = features;
                resolve(jsonOut);
            } catch (error) {
                console.error(`getting data from xyz space failed: ${error}`);
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
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
        analyzeSpace(id, options);
    });

    async function analyzeSpace(id:string, options:any) {
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
        try {
            let cHandle = 0;
            process.stdout.write("Operation may take a while. Please wait .....");
            do {
                process.stdout.write(".");
                let body = await execute(
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
        } catch (error) {
            console.error(`describe failed: ${error}`);
        }
        //})();
    };

    program
    .command('hexbin <id>')
    .description('create hexbins (and their centroids) using points in an XYZ space and upload them to another space')
    .option("-c, --cellsize <cellsize>", "size of hexgrid cells in meters, comma-separate multiple values")
    .option("-i, --ids", "add IDs of features counted within the hexbin as an array inside the property of the hexbin created")
    .option("-p, --groupBy <groupBy>", "name of the feature property by which hexbin counts will be further grouped")
    .option("-r, --readToken <readToken>", "token of another user's source space, from which points will be read")
    .option("-w, --writeToken <writeToken>", "token of another user's target space to which hexbins will be written")
    //.option("-d, --destSpace <destSpace>", "Destination Space name where hexbins and centroids will be uploaded")
    .option("-t, --tags <tags>", "only make hexbins for features in the source space that match the specific tag(s), comma-separate multiple values")
    .option("-b, --bbox <bbox>", "only create hexbins for records inside a specified bounding box - minLon,minLat,maxLon,maxLat")
    .option("-l, --latitude <latitude>", "latitude which will be used for converting cellSize from meters to degrees")
    .option("-z, --zoomLevels <zoomLevels>", "create hexbins optimized for zoom levels -- comma separate multiple values, (-z 8,10,12) or dash for continuous range (-z 10-15)")
    .action(function (id,options) {
      (async () => {
        try{
        //TODO - Fix negative values problem for bbox options
        const sourceId = id;
        options.totalRecords = Number.MAX_SAFE_INTEGER;
        //options.token = 'Ef87rh2BTh29U-tyUx9NxQ';
        if(options.readToken){
            options.token = options.readToken;
        }
        /*
        const features = (await getSpaceDataFromXyz(id,options)).features;
        if(features.length === 0){
            console.log("No features is available to create hexbins");
            process.exit();
        }
        */
        let cellSizes:number[] = [];
        if (options.zoomLevels) {
            options.zoomLevels.split(",").forEach(function (item : string) {
                if (item && item != "") {
                    let zoomLevels = item.split("-");
                    if(zoomLevels.length === 1){
                        let number = parseInt(zoomLevels[0].toLowerCase());
                        if (isNaN(number) || number < 1 || number > 16){
                            console.error(`hexbin creation failed: zoom level input "${zoomLevels[0]}" is not a valid between 1-16`);
                            process.exit(1);
                        }
                        cellSizes.push(parseInt(zoomLevelsMap[number]));
                    } else if(zoomLevels.length !== 2){
                        console.error(`hexbin creation failed: zoom level input "${item}" is not a valid sequence`);
                        process.exit(1);
                    } else {
                        let lowNumber = parseInt(zoomLevels[0].toLowerCase());
                        let highNumber = parseInt(zoomLevels[1].toLowerCase());
                        if (isNaN(lowNumber) || isNaN(highNumber) || (lowNumber > highNumber) || lowNumber < 1 || lowNumber > 16 || highNumber < 1 || highNumber > 16){
                            console.error(`hexbin creation failed: zoom level input "${zoomLevels}" is not a valid sequence between 1-16`);
                            process.exit(1);
                        }
                        for (var i = lowNumber; i <= highNumber; i++) {
                            cellSizes.push(parseInt(zoomLevelsMap[i]));
                        }
                    }
                }
            });
        } else if (options.cellsize){
            options.cellsize.split(",").forEach(function (item : string) {
                if (item && item != "") {
                    let number = parseInt(item.toLowerCase());
                    if (isNaN(number)){
                        console.error(`hexbin creation failed: cellsize input "${item}" is not a valid number`);
                        process.exit(1);
                    } 
                    cellSizes.push(number);
                }
            });
        } else {
            cellSizes.push(2000);
        }
        if(!options.latitude){
            options.latitude = await getCentreLatitudeOfSpace(id,options.readToken);
            if(!options.latitude){
                options.latitude = 0;
            }
        }
        let cellSizeHexFeaturesMap = new Map();
        options.currentHandleOnly = true;
        options.handle = 0;
        let cHandle;
        console.log("Creating hexbins for the space data");
        do {
            let jsonOut = await getSpaceDataFromXyz(id,options);
            cHandle = jsonOut.handle;
            options.handle = jsonOut.handle;
            if (jsonOut.features) {
                const features = jsonOut.features;
                /*
                if(features.length === 0 && !options.handle){
                    console.log("No features is available to create hexbins");
                    process.exit();
                }
                */
                for(const cellsize of cellSizes){
                    //(async () => {
                    //console.log("Creating hexbins for the space data with size " + cellsize);
                    let hexFeatures = cellSizeHexFeaturesMap.get(cellsize);
                    hexFeatures = hexbin.calculateHexGrids(features, cellsize, options.ids, options.groupBy, options.latitude, hexFeatures);
                    cellSizeHexFeaturesMap.set(cellsize, hexFeatures);
                    //console.log("uploading the hexagon grids to space with size " + cellsize);
                }
            } else {
                cHandle = -1;
            }
        } while (cHandle >= 0);
        /*
        if(options.destSpace){
            id = options.destSpace;
        } else {
        */
        let sourceSpaceData = await getSpaceMetaData(sourceId, options.readToken);
        let newspaceData;
        if(!sourceSpaceData.client || !sourceSpaceData.client.hexbinSpaceId){
            let newSpaceConfig = {
                title:'hexbin space of ' + sourceSpaceData.title,
                description: 'hexbin space of ' + sourceSpaceData.title,
                client: {
                    sourceSpaceId: sourceId,
                    type: 'hexbin'
                }
            }
            console.log("No hexbin space found, creating hexbin space");
            newspaceData = await createSpace(newSpaceConfig);
            id = newspaceData.id;
            await updateClientHexbinSpaceId(sourceId, id);
        } else {
            console.log("using exisitng hexbin space - " + sourceSpaceData.client.hexbinSpaceId);
            id = sourceSpaceData.client.hexbinSpaceId;
            newspaceData = await getSpaceMetaData(id, options.writeToken);
        }   
        let cellSizeSet = new Set<string>();
        let zoomLevelSet = new Set<string>();
        if(newspaceData.client && newspaceData.client.cellSizes){
            newspaceData.client.cellSizes.forEach((item: string) => cellSizeSet.add(item));
        }
        if(newspaceData.client && newspaceData.client.zoomLevels){
            newspaceData.client.zoomLevels.forEach((item: string) => zoomLevelSet.add(item));
        }

        options.token = null;
        if(options.writeToken){
            options.token = options.writeToken;
        }
        //cellSizes.forEach(function (cellsize : number) {
        for(const cellsize of cellSizes){
           //(async () => {
            //console.log("Creating hexbins for the space data with size " + cellsize);
            let hexFeatures = cellSizeHexFeaturesMap.get(cellsize);
            let logStat = "uploading the hexagon grids to space with size " + cellsize;
            cellSizeSet.add(cellsize+"");
            if(options.zoomLevels){
                const zoomNumber = getKeyByValue(zoomLevelsMap,cellsize); 
                logStat += " / zoom Level " + zoomNumber;
                zoomLevelSet.add(zoomNumber+"");
            }
            console.log(logStat);
            //console.log("data to be uploaded - " + JSON.stringify(hexFeatures));

            let centroidFeatures:any[] = [];
            var i = hexFeatures.length;
            while (i--) {
                let isValidHexagon = true;
                hexFeatures[i].geometry.coordinates[0].forEach(function (coordinate : Array<number>) {
                    if(coordinate[0] < -180 || coordinate[0] > 180 || coordinate[1] > 90 || coordinate[1] < -90){
                        isValidHexagon = false;
                        console.log("Invalid hexagon which is created outside of permissable range - " + coordinate);
                    }
                });
                if (isValidHexagon) { 
                    let geometry = {"type":"Point","coordinates":hexFeatures[i].properties.centroid};
                    let hashId = common.md5Sum(JSON.stringify(geometry)+'_'+cellsize);
                    centroidFeatures.push({type:"Feature","geometry":geometry,"properties":hexFeatures[i].properties,"id":hashId});
                } else {
                    console.log("Invalid hexagon is getting created, ignoring this - " + JSON.stringify(hexFeatures[i]));
                    hexFeatures.splice(i, 1);
                }
            }

            //hexFeatures = hexFeatures.concat(centroidFeatures);
            /*  
            fs.writeFile('out.json', JSON.stringify({type:"FeatureCollection",features:hexFeatures}), (err) => {  
                if (err) throw err;
            });
            */
            
            let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
            fs.writeFileSync(tmpObj.name, JSON.stringify({type:"FeatureCollection",features:hexFeatures}));
            options.tags = 'hexbin_'+cellsize+',cell_'+cellsize+',hexbin';
            if(options.zoomLevels){
                const zoomNumber = getKeyByValue(zoomLevelsMap,cellsize); 
                options.tags += ',zoom'+zoomNumber + ',zoom' + zoomNumber + '_hexbin';
            }
            //if(options.destSpace){
                options.tags += ','+sourceId;
            //}
            options.file = tmpObj.name;
            options.override = true;
            await uploadToXyzSpace(id,options);

            tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
            fs.writeFileSync(tmpObj.name, JSON.stringify({type:"FeatureCollection",features:centroidFeatures}));
            options.tags = 'centroid_'+cellsize+',cell_'+cellsize+',centroid';
            if(options.zoomLevels){
                const zoomNumber = getKeyByValue(zoomLevelsMap,cellsize); 
                options.tags += ',zoom'+zoomNumber + ',zoom' + zoomNumber + '_centroid';
            }
            //if(options.destSpace){
                options.tags += ','+sourceId;
            //}
            options.file = tmpObj.name;
            options.override = true;
            await uploadToXyzSpace(id,options);
        //});
        }
        await updateCellSizeAndZoomLevelsInHexbinSpace(id, Array.from(zoomLevelSet), Array.from(cellSizeSet));
        console.log("hexbins written to space " +  id + " from points in source space " + sourceId);
        //});
        } catch (error) {
            console.error(`hexbin creation failed: ${error}`);
            process.exit(1);
        }
      })();
});

async function updateClientHexbinSpaceId(sourceId: string, hexbinId: string){
    const uri = "/hub/spaces/" + sourceId + "?clientId=cli";
    const cType = "application/json";
    const data = {
        client : {
            hexbinSpaceId:hexbinId
        }
    }
    const body = await execute(uri, "PATCH", cType, data);
    return body;
}

async function updateCellSizeAndZoomLevelsInHexbinSpace(id: string, zoomLevels: string[], cellSizes: string[]){
    const uri = "/hub/spaces/" + id + "?clientId=cli";
    const cType = "application/json";
    const data = {
        client : {
            zoomLevels: zoomLevels,
            cellSizes: cellSizes
        }
    }
    const body = await execute(uri, "PATCH", cType, data);
    return body;
}

async function getSpaceMetaData(id:string, token: string | null = null){
    const uri = "/hub/spaces/" + id + "?clientId=cli";
    const cType = "application/json";
    const body = await execute(uri, "GET", cType, "", token);
    return body;
}

function getKeyByValue(object: any, value: any) {
    return Object.keys(object).find(key => object[key] === value);
}

async function getCentreLatitudeOfSpace(spaceId: string, token: string | null = null){
    const body = await getStatisticsData(spaceId, token);
    let bbox = body.bbox.value;
    const centreLatitude = (bbox[1] + bbox[3])/ 2;
    return centreLatitude;
}

async function getStatisticsData(spaceId: string, token: string | null = null){
    const body = await execute(
        "/hub/spaces/" + spaceId + "/statistics",
        "GET",
        "application/json",
        null,
        token,
        true
    );
    return body;
}

program
    .command("show <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw xyzspace content")
    .option(
        "-p, --prop <prop>",
        "property fields to include in table",
        collect,
        []
    )
    .option("-w, --web", "display xyzspace on http://geojson.tools")
    .option("-v, --vector", "display xyzspace in Tangram") 
    .action(function(id,options){
        showSpace(id,options);
    });
    async function showSpace(id:string, options:any) {
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
            cType = "application/geo+json";
        }
        if (options.vector) {
            await launchXYZSpaceInvader(id,options.tags?"&tags="+options.tags:"");
        }
        else if (options.web) {
            await launchHereGeoJson(uri);
        } else {
            const body = await execute(
                uri,
                "GET",
                cType,
                ""
            );
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
            if (options.prop.length > 0) {
                fields = options.prop;
            }
            tableFunction(options.raw ? body : allFeatures, fields);
        }
    }

program
    .command("delete <id>")
    .description("delete the xyzspace with the given id")
    .action(async geospaceId => {
        //console.log("geospaceId:"+"/geospace/"+geospaceId);
        deleteSpace(geospaceId);
    });

    async function deleteSpace(geospaceId:string){
        await execute(
            "/hub/spaces/" + geospaceId + "?clientId=cli",
            "DELETE",
            "application/json",
            "",
        );
        console.log("xyzspace '" + geospaceId + "' deleted successfully");
    }

program
    .command("create")
    .description("create a new xyzspace")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for xyzspace")
    .option("-d, --message [message]", "Short description ")
    .action(options => createSpace(options));

    async function createSpace(options:any){
        if (options) {
            if (!options.title) {
                options.title = "a new xyzspace created from commandline";
            }
            if (!options.message) {
                options.message = "a new xyzspace created from commandline";
            }
        }
        let gp = getGeoSpaceProfiles(options.title, options.message, options.client);
        const body = await execute("/hub/spaces?clientId=cli", "POST", "application/json", gp);
        console.log("xyzspace '" + body.id + "' created successfully");
        return body;
    }

program
    .command("clear <id>")
    .description("clear data from xyz space")
    .option("-t, --tags [tags]", "tags for the xyz space")
    .option("-i, --ids [ids]", "ids for the xyz space")
    .action((id,options)=>clearSpace(id,options));
        
    async function clearSpace(id:string, options:any) {
        if (!options.ids && !options.tags) {
            options.tags="*";
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
        const data = await execute(
            "/hub/spaces/" + id + "/features?" + finalOpt + "&clientId=cli",
            "DELETE",
            "application/geo+json",
            null,
        );
        console.log("data cleared successfully.");
    }

program
    .command("token")
    .description("list all xyz token ")
    .action(()=>listTokens());
    
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
        common.drawTable(tokenInfo.tokens, [
            "id",
            "type",
            "iat",
            "description"
        ]);
    }

program
    .command("upload <id>")
    .description("upload a local geojson file to the given id")
    .option("-f, --file <file>", "geojson file to upload")
    .option("-c, --chunk [chunk]", "chunk size")
    .option("-t, --tags [tags]", "tags for the xyz space")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --alt [alt]", "altitude field name")
    .option("-p, --ptag [ptag]", "property names to be used to add tag")
    .option("-i, --id [id]", "property name(s) to be used as the feature ID")
    .option(
        "-a, --assign",
        "list the sample data and allows you to assign fields which needs to be selected as tags"
    )
    .option(
        "-u, --unique",
        "option to enforce uniqueness to the id by creating a hash of feature and use that as id"
    )
    .option("-o, --override", "override the data even if it share same id")
    .option("-s, --stream", "streaming data support for large file uploads")
    .action(function (id, options) {
        uploadToXyzSpace(id, options);
    });

function collate(result:Array<any>){
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

function streamingQueue(){
    let queue = cq(10,function (task:any,done:Function) {
        uploadData(task.id, task.options, task.tags, task.fc, 
        true, task.options.ptag, task.options.file, task.options.id)
        .then(x=>{
            queue.uploadCount += task.fc.features.length;
            process.stdout.write("\ruploaded feature count :"+queue.uploadCount+", failed feature count :"+queue.failedCount);
            queue.chunksize--;
            done(); 
        }).catch((err) => {
            queue.failedCount += task.fc.features.length;
            process.stdout.write("\ruploaded feature count :"+queue.uploadCount+", failed feature count :"+queue.failedCount);
            queue.chunksize--;
            done();
        });
    });     
    queue.uploadCount=0;
    queue.chunksize=0;
    queue.failedCount=0;
    queue.send= async function(obj:any){
        while(this.chunksize>25){
            await new Promise(done => setTimeout(done, 1000));
        }
        this.push(obj);
        this.chunksize++;
    }
    queue.shutdown =async ()=>{
        queue.shutdown=true;
        while(queue.chunksize!=0){
            await new Promise(done => setTimeout(done, 1000));
        }
        return true;
    }
    return queue;
}

function taskQueue(size:number=8,totalTaskSize:number){
    let queue = cq(size,function (task:any,done:Function) {
        iterateChunk(task.chunk,task.url)
        .then(x=>{
            queue.uploadCount += 1;
            queue.chunksize--;
            process.stdout.write("\ruploaded " + ((queue.uploadCount / totalTaskSize) * 100).toFixed(2) + "%");
            done();
        }).catch((err) => {
            queue.failedCount += 1;
            queue.chunksize--;
            console.log("failed features " + ((queue.failedCount / totalTaskSize) * 100).toFixed(2) + "%");
            done();
        });
    });     
    queue.uploadCount=0;
    queue.chunksize=0;
    queue.failedCount=0;
    queue.send= async function(obj:any){
        queue.push(obj);
        queue.chunksize++;
        while(queue.chunksize>25){
            await new Promise(done => setTimeout(done, 1000));
        }
    }
    queue.shutdown =async ()=>{
        queue.shutdown=true;
        while(queue.chunksize!=0){
            await new Promise(done => setTimeout(done, 1000));
        }
        return true;
    }
    return queue;
}


async function uploadToXyzSpace(id: string, options: any){
    //(async () => {
        let tags = "";
        if (options.tags) {
            tags = options.tags;
        }
        //Default chunk size set as 200
        if (!options.chunk) {
            options.chunk = 200;
        }

        if (options.unique && options.override) {
            console.log(
                "conflicting options together. You may need to use either unique or override. Refer to 'here xyz upload -h' for help"
            );
            process.exit(1);
        } else if (!options.override) {
            options.unique = true;
        }

        if(options.assign && options.stream){
            console.log(
                "conflicting options together. You cannot choose assign mode while selecting streaming option"
            );
            process.exit(1);
        }

        if (options.file) {
            const fs = require("fs");
            if (options.file.indexOf(".geojsonl") != -1) {
                if(!options.stream){
                    const result:any=await transform.readLineFromFile(options.file, 100);
                    await uploadData(id, options, tags, { type: "FeatureCollection", features: collate(result) }, true, options.ptag, options.file, options.id);
                }else{                    
                    let queue = streamingQueue();
                    await transform.readLineAsChunks(options.file, options.chunk?options.chunk:1000,function(result:any){
                        return new Promise((res,rej)=>{
                            ( async()=>{
                                if(result.length>0){
                                    await queue.send({id:id,options:options,tags:tags,fc:{ type: "FeatureCollection", features: collate(result) },retryCount:3});
                                }
                                res(queue);
                            })();  
                        });                        
                    });
                    while(queue.chunksize!=0){
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
            } else if (options.file.indexOf(".csv") != -1) {
                if(!options.stream){
                    let result = await transform.read(
                        options.file,
                        true
                    );
                    const object = {
                            features: transform.transform(
                                result,
                                options.lat,
                                options.lon,
                                options.alt
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
                }else{
                    let queue = streamingQueue();
                    await transform.readCSVAsChunks(options.file, options.chunk?options.chunk:1000,function(result:any){
                        return new Promise((res,rej)=>{
                            ( async()=>{
                                if(result.length>0){
                                    const fc = {
                                        features: transform.transform(
                                            result,
                                            options.lat,
                                            options.lon,
                                            options.alt
                                        ),
                                        type: "FeatureCollection"
                                    };
                                    await queue.send({id:id,options:options,tags:tags,fc:fc,retryCount:3});
                                    res(queue);
                                }
                            })();  
                        });    

                    });
                    while(queue.chunksize!=0){
                        await new Promise(done => setTimeout(done, 1000));
                    }
                }
            } else {
                if(!options.stream){
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
                }else{
                    let queue = streamingQueue();
                    let c=0;
                    await transform.readGeoJsonAsChunks(options.file, options.chunk?options.chunk:1000,async function(result:any){
                                if(result.length>0){
                                    const fc = {
                                        features: result,
                                        type: "FeatureCollection"
                                    };
                                    await queue.send({id:id,options:options,tags:tags,fc:fc,retryCount:3});
                                }
                                return queue;
                    });
                    while(queue.chunksize!=0){
                        await new Promise(done => setTimeout(done, 1000));
                    }
                }
            }
        } else {
            const getStdin = require("get-stdin");
            getStdin().then((str: string) => {
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
    uid: string
) {
    return new Promise((resolve, reject) => { 

        if (object.type == "Feature") {
            object = { features: [object], type: "FeatureCollection" };
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
                    options.id
                ).then(x=>resolve(x)).catch((error) => reject(error));

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
                options.id
            ).then(x=>resolve(x)).catch((error) => reject(error));
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
    uid: string
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

            try{
               if(options.stream){
                    await iterateChunks([featureOut],"/hub/spaces/" + id + "/features" + "?clientId=cli",0,1,options.token);
               }else{
                    const chunks = options.chunk
                        ? chunkify(featureOut, parseInt(options.chunk))
                        : [featureOut];
                    await iterateChunks(chunks,"/hub/spaces/" + id + "/features" + "?clientId=cli",0,chunks.length,options.token);
                    // let tq =  taskQueue(8,chunks.length);
                    // chunks.forEach(chunk=>{
                    //     tq.send({chunk:chunk,url:"/hub/spaces/" + id + "/features"});
                    // });
                    // await tq.shutdown();
               }
            }catch(e){
                reject(e);
                return;
            }
            if(!options.stream){
                if (isFile)
                    console.log(
                        "'" +
                        options.file +
                        "' uploaded to xyzspace '" +
                        id +
                        "' successfully"
                    );
                else
                    console.log(
                        "data upload to xyzspace '" + id + "' completed successfully"
                    );

                summary.summarize(featureOut, id, true);
                
            }
            resolve(true);
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
            "We detected duplicate records, only the first was uploaded.\nFind the below records which are duplicated\n"
        );
        common.drawTable(duplicates, ["id", "geometry", "properties"]);
        console.log(
            "uploaded " +
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
    finalTags.push(value);
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

async function iterateChunks(chunks: any, url: string, index: number, chunkSize: number, token: string) {
    const item = chunks.shift();
    const fc = { type: "FeatureCollection", features: item };
    const body = await execute(
        url,
        "PUT",
        "application/geo+json",
        JSON.stringify(fc),
        token,
        true
    );

    index++;
    if (index == chunkSize) {
        process.stdout.write("\ruploaded " + ((index / chunkSize) * 100).toFixed(2) + "%\n");
        return;
    }

    process.stdout.write("\ruploaded " + ((index / chunkSize) * 100).toFixed(2) + "%");
    await iterateChunks(chunks, url, index, chunkSize, token);
}
async function iterateChunk(chunk: any, url: string) {
    const fc = { type: "FeatureCollection", features: chunk };
    const body = await execute(
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
    ,{wait:false});
}

async function launchXYZSpaceInvader(spaceId: string,tags:string) {
    const token = await common.verify(true);
    const uri = "https://s3.amazonaws.com/xyz-demo/scenes/xyz_tangram/index.html?space=" + spaceId + "&token=" + token+tags;
    const opn = require("opn");
    opn(
        uri
    ,{wait:false});
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
        "hexbin"
    ],
    [process.argv[2]],
    program
);
program.parse(process.argv);
