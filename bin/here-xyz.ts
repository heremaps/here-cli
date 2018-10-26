#!/usr/bin/env node

/*
  Copyright (C) 2018 HERE Europe B.V.
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

//let hexbin = require('/Users/nisar/OneDrive - HERE Global B.V/home/github/hexbin');
let hexbin = require('hexbin');
const md5 = require('md5');
const request = require("request");
let choiceList: { name: string, value: string}[] = [];
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

function getGeoSpaceProfiles(title: string, description: string) {
    return {
        title,
        description
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
            "Content-Type": contentType
        },
        body: method === "GET" ? undefined : data
    };

    const { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210)
        throw new Error("Invalid response");
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
    token: string
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

    const { response, body } = await requestAsync(reqJson);
    if (response.statusCode < 200 || response.statusCode > 210)
        throw new Error("Invalid response");
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
        const uri = "/hub/spaces";
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
    });

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

program
    .command("describe <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
        (async () => {
            var features = await getSpaceDataFromXyz(id,options);
            summary.summarize(features,id, false);
        })();    
    });

function getSpaceDataFromXyz(id: string, options: any) {
    return new Promise<any[]>(function (resolve, reject) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (handle: string) {
            let uri = "/hub/spaces/" + id;
            const spFunction = "iterate";
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit;
                if (handle) {
                    uri = uri + "&handle=" + handle;
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
        (async () => {

            try {
                let cHandle = 0;
                process.stdout.write("Operation may take a while. Please wait .....");
                do {
                    process.stdout.write(".");
                    let jsonOut = await execute(
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
                } while (cHandle >= 0 && recordLength < options.totalRecords);
                process.stdout.write("\n");
                resolve(features);
            } catch (error) {
                console.error(`getting data from xyz space failed: ${error}`);
                reject(error);
            }
        })();
    });
}    

program
    .command("analyze <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (handle: string) {
            let uri = "/hub/spaces/" + id;
            const spFunction = "iterate";
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit;
                if (handle) {
                    uri = uri + "&handle=" + handle;
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
        (async () => {
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
                inquirer.prompt(questionAnalyze).then((answers: any) => {
                    properties = answers.properties;
                    if (properties && properties.length > 0) {
                        summary.analyze(features, properties, id);
                    } else {
                        console.log("No property selected to analyze");
                    }
                });
            } catch (error) {
                console.error(`describe failed: ${error}`);
            }
        })();
    });

program
    .command('hexbin <id>')
    .description('create hexgrid out of xyz space data and upload it to space')
    .option("-c, --cellsize <cellsize>", "size of hexgrid cell in meters")
    .option("-i, --ids", "add ids of features as array inside property of created hexagon feature")
    .option("-p, --groupBy <groupBy>", "Name of the Property using which hexbin counts will be further grouped")
    .action(function (id,options) {
      (async () => {
        try{
        options.totalRecords = Number.MAX_SAFE_INTEGER;
        //options.token = 'Ef87rh2BTh29U-tyUx9NxQ';
        const features = await getSpaceDataFromXyz(id,options);
        let cellSizes:number[] = [];
        if (!options.cellsize) {
            cellSizes.push(2000);
        } else {
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
        }

        cellSizes.forEach(function (cellsize : number) {
        //    (async () => {
            console.log("Creating hexbins for the space data with size " + cellsize);
            let hexFeatures = hexbin.calculateHexGrids(features, cellsize, options.ids, options.groupBy);
            console.log("uploading the hexagon grids to space with size " + cellsize);

            let centroidFeatures:any[] = [];
            hexFeatures.forEach(function (hexFeature : any) {
                let geometry = {"type":"Point","coordinates":hexFeature.properties.centroid};
                let hashId = md5(JSON.stringify(geometry));
                centroidFeatures.push({type:"Feature","geometry":geometry,"properties":hexFeature.properties,"id":hashId});
            });
            //hexFeatures = hexFeatures.concat(centroidFeatures);
            /*  
            fs.writeFile('out.json', JSON.stringify({type:"FeatureCollection",features:hexFeatures}), (err) => {  
                if (err) throw err;
            });
            */
            
            let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
            fs.writeFileSync(tmpObj.name, JSON.stringify({type:"FeatureCollection",features:hexFeatures}));
            options.tags = 'hexbin_'+cellsize;
            options.file = tmpObj.name;
            options.override = true;
            uploadToXyzSpace(id,options);

            tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'hex', postfix: '.json' });
            fs.writeFileSync(tmpObj.name, JSON.stringify({type:"FeatureCollection",features:centroidFeatures}));
            options.tags = 'centroid_'+cellsize+',hexbin_'+cellsize;
            options.file = tmpObj.name;
            options.override = true;
            uploadToXyzSpace(id,options);
        //});
        });
        } catch (error) {
            console.error(`hexbin creation failed: ${error}`);
            process.exit(1);
        }
      })();
    });

program
    .command("show <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw xyzspace content")
    .option(
        "-p, --prop <prop>",
        "property fields to include in table",
        collect,
        []
    )
    .option("-w, --web", "display xyzspace on http://geojson.tools")
    .action(async function (id, options) {
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
        const spFunction = options.handle ? "iterate" : "search";
        if (options.limit) {
            uri = uri + "/" + spFunction + "?limit=" + options.limit;
            if (options.handle) {
                uri = uri + "&handle=" + options.handle;
            }
            if (options.tags) {
                uri = uri + "&tags=" + options.tags;
            }
            cType = "application/geo+json";
        }
        if (options.web) {
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
            const allFeatures = JSON.parse(body).features;
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
    });

program
    .command("delete <id>")
    .description("delete the xyzspace with the given id")
    .action(async geospaceId => {
        //console.log("geospaceId:"+"/geospace/"+geospaceId);
        await execute(
            "/hub/spaces/" + geospaceId,
            "DELETE",
            "application/json",
            "",
        );
        console.log("xyzspace '" + geospaceId + "' deleted successfully");
    });

program
    .command("create")
    .description("create a new xyzspace")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for xyzspace")
    .option("-d, --message [message]", "Short description ")
    .option("-p, --profile [profile]", "Select a profile")
    .action(async options => {
        if (options) {
            if (!options.title) {
                options.title = "a new xyzspace created from commandline";
            }
            if (!options.message) {
                options.message = "a new xyzspace created from commandline";
            }
        }
        const gp = getGeoSpaceProfiles(options.title, options.message);
        const body = await execute("/hub/spaces/", "POST", "application/json", gp);
        console.log("xyzspace '" + body.id + "' created successfully");
    });

program
    .command("clear")
    .description("clear data from xyz space")
    .option("-t, --tags [tags]", "tags for the xyz space")
    .option("-i, --ids [ids]", "ids for the xyz space")
    .action(async function (id, options) {
        if (!options.ids && !options.tags) {
            console.log("At least -t or -i should be provided as a query parameter.");
            process.exit(1);
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
            "/hub/spaces/" + id + "/features?" + finalOpt,
            "DELETE",
            "application/geo+json",
            null,
        );
        console.log("data cleared successfully.");
    });

program
    .command("token")
    .description("list all xyz token ")
    .action(async function (id) {
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
                Cookie: cookie,
                "Content-Type": "application/json"
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
    });

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
    .action(function (id, options) {
        uploadToXyzSpace(id, options);
    });

function uploadToXyzSpace(id: string, options: any){
    (async () => {
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

        if (options.file) {
            const fs = require("fs");
            if (options.file.indexOf(".geojsonl") != -1) {
                transform.readLineFromFile(options.file, 100).then((result: any) => {
                    const totalFeatures = result.reduce((features: any, feature: any) => {
                        if (feature.type === "Feature") {
                            features.push(feature);
                        } else if (feature.type === "FeatureCollection") {
                            features = features.concat(feature.features);
                        } else {
                            console.log("Unknown type" + feature.type);
                        }
                        return features
                    }, []);
                    uploadData(id, options, tags, { type: "FeatureCollection", features: totalFeatures }, true, options.ptag, options.file, options.id);
                });
            } else if (options.file.indexOf(".shp") != -1) {
                let result = await transform.readShapeFile(
                    options.file,
                );
                uploadData(
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
                uploadData(
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
                let result = await transform.read(
                    options.file,
                    false
                );
                uploadData(
                    id,
                    options,
                    tags,
                    JSON.parse(result),
                    true,
                    options.ptag,
                    options.file,
                    options.id
                );
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
    })();
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
            );
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
        );
    }
}

function uploadDataToSpaceWithTags(
    id: string,
    options: any,
    tags: any,
    object: any,
    isFile: boolean,
    tagProperties: any,
    fileName: string | null,
    uid: string
) {
    const gsv = require("geojson-validation");
    gsv.valid(object, async function (valid: boolean, errs: any) {
        if (!valid) {
            console.log(errs);
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

        const chunks = options.chunk
            ? chunkify(featureOut, parseInt(options.chunk))
            : [featureOut];
        const chunkSize = chunks.length;
        const index = 0;
        await iterateChunks(
            chunks,
            "/hub/spaces/" + id + "/features",
            index,
            chunkSize,
        );
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

async function iterateChunks(chunks: any, url: string, index: number, chunkSize: number) {
    const item = chunks.shift();
    const fc = { type: "FeatureCollection", features: item };
    const body = await execute(
        url,
        "PUT",
        "application/geo+json",
        JSON.stringify(fc),
        null,
        true
    );

    index++;
    if (index == chunkSize) {
        return;
    }

    console.log("uploaded " + ((index / chunkSize) * 100).toFixed(2) + "%");
    await iterateChunks(chunks, url, index, chunkSize);
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
    const token = await common.verify();
    const accessAppend =
        uri.indexOf("?") == -1
            ? "?access_token=" + token
            : "&access_token=" + token;
    const opn = require("open");
    opn(
        "http://geojson.tools/index.html?url=" +
        common.xyzRoot() +
        uri +
        accessAppend
    );
}

common.validate(
    [
        "list",
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
