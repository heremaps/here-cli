#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const zlib = require("zlib");
const requestAsync_1 = require("./requestAsync");
const program = require("commander");
const common = require("./common");
const sso = require("./sso");
const inquirer = require("inquirer");
const transform = require("./transformutil");
const summary = require("./summary");
let cq = require("block-queue");
const gsv = require("geojson-validation");
let choiceList = [];
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
        message: "Select attributes which would be used as Id, please note that ID field has to be unique",
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
function getGeoSpaceProfiles(title, description) {
    return {
        title,
        description
    };
}
function execInternal(uri, method, contentType, data, token, gzip) {
    return __awaiter(this, void 0, void 0, function* () {
        if (gzip) {
            return yield execInternalGzip(uri, method, contentType, data, token);
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
        const { response, body } = yield requestAsync_1.requestAsync(reqJson);
        if (response.statusCode < 200 || response.statusCode > 210) {
            let message = (response.body && response.body.constructor != String) ? JSON.stringify(response.body) : response.body;
            throw new Error("Invalid response - " + message);
        }
        return body;
    });
}
function gzip(data) {
    return new Promise((resolve, reject) => zlib.gzip(data, (error, result) => {
        if (error)
            reject(error);
        else
            resolve(result);
    }));
}
function execInternalGzip(uri, method, contentType, data, token, retry = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        const zippedData = yield gzip(data);
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
        let { response, body } = yield requestAsync_1.requestAsync(reqJson);
        if (response.statusCode < 200 || response.statusCode > 210) {
            if (response.statusCode >= 500) {
                yield new Promise(done => setTimeout(done, 1000));
                body = execInternalGzip(uri, method, contentType, data, token, retry--);
            }
            else {
                throw new Error("Invalid response :" + response.statusCode);
            }
        }
        return body;
    });
}
function execute(uri, method, contentType, data, token = null, gzip = false) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!token) {
            token = yield common.verify();
        }
        return yield execInternal(uri, method, contentType, data, token, gzip);
    });
}
program
    .command("list")
    .alias("ls")
    .description("information about available xyz spaces")
    .option("-r, --raw", "show raw xyzspace definition")
    .option("-p, --prop <prop>", "property fields to include in table", collect, [])
    .action(function (options) {
    return __awaiter(this, void 0, void 0, function* () {
        listSpaces(options);
    });
});
function listSpaces(options) {
    return __awaiter(this, void 0, void 0, function* () {
        const uri = "/hub/spaces?clientId=cli";
        const cType = "application/json";
        let tableFunction = common.drawTable;
        if (options.raw) {
            tableFunction = function (data, columns) {
                try {
                    console.log(JSON.stringify(JSON.parse(data), null, 2));
                }
                catch (e) {
                    console.log(JSON.stringify(data, null, 2));
                }
            };
        }
        const body = yield execute(uri, "GET", cType, "");
        if (body.length == 0) {
            console.log("No xyzspace found");
        }
        else {
            let fields = ["id", "title", "description"];
            if (options.prop.length > 0) {
                fields = options.prop;
            }
            tableFunction(body, fields);
        }
    });
}
function collect(val, memo) {
    memo.push(val);
    return memo;
}
program
    .command("describe <id>")
    .description("gives the summary details of the given space [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
    (() => __awaiter(this, void 0, void 0, function* () {
        var features = yield getSpaceDataFromXyz(id, options);
        summary.summarize(features, id, false);
    }))();
});
function getSpaceDataFromXyz(id, options) {
    return new Promise(function (resolve, reject) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (handle) {
            let uri = "/hub/spaces/" + id;
            const spFunction = "iterate";
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
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
        (() => __awaiter(this, void 0, void 0, function* () {
            try {
                let cHandle = 0;
                process.stdout.write("Operation may take a while. Please wait .....");
                do {
                    process.stdout.write(".");
                    let jsonOut = yield execute(getUrI(String(cHandle)), "GET", cType, "", options.token, true);
                    if (jsonOut.constructor !== {}.constructor) {
                        jsonOut = JSON.parse(jsonOut);
                    }
                    cHandle = jsonOut.handle;
                    if (jsonOut.features) {
                        recordLength += jsonOut.features.length;
                        features = features.concat(jsonOut.features);
                    }
                    else {
                        cHandle = -1;
                    }
                } while (cHandle >= 0 && recordLength < options.totalRecords);
                process.stdout.write("\n");
                resolve(features);
            }
            catch (error) {
                console.error(`getting data from xyz space failed: ${error}`);
                reject(error);
            }
        }))();
    });
}
program
    .command("analyze <id>")
    .description("property based analysis of the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-p, --token <token>", "a external token to access space")
    .action(function (id, options) {
    analyzeSpace(id, options);
});
function analyzeSpace(id, options) {
    return __awaiter(this, void 0, void 0, function* () {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (handle) {
            let uri = "/hub/spaces/" + id;
            const spFunction = "iterate";
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
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
        //(async () => {
        try {
            let cHandle = 0;
            process.stdout.write("Operation may take a while. Please wait .....");
            do {
                process.stdout.write(".");
                let body = yield execute(getUrI(String(cHandle)), "GET", cType, "", options.token, true);
                const jsonOut = JSON.parse(body);
                cHandle = jsonOut.handle;
                if (jsonOut.features) {
                    recordLength += jsonOut.features.length;
                    features = features.concat(jsonOut.features);
                }
                else {
                    cHandle = -1;
                }
            } while (cHandle >= 0 && recordLength < totalRecords);
            process.stdout.write("\n");
            createQuestionsList({ features: features });
            let properties = null;
            let answers = yield inquirer.prompt(questionAnalyze);
            //then((answers: any) => {
            properties = answers.properties;
            if (properties && properties.length > 0) {
                summary.analyze(features, properties, id);
            }
            else {
                console.log("No property selected to analyze");
            }
            //});
        }
        catch (error) {
            console.error(`describe failed: ${error}`);
        }
        //})();
    });
}
program
    .command("show <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-h, --handle <handle>", "The handle to continue the iteration")
    .option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw xyzspace content")
    .option("-p, --prop <prop>", "property fields to include in table", collect, [])
    .option("-w, --web", "display xyzspace on http://geojson.tools")
    .action(function (id, options) {
    showSpace(id, options);
});
function showSpace(id, options) {
    return __awaiter(this, void 0, void 0, function* () {
        let uri = "/hub/spaces";
        let cType = "application/json";
        let tableFunction = common.drawTable;
        uri = uri + "/" + id;
        if (options.raw) {
            tableFunction = function (data, columns) {
                try {
                    console.log(JSON.stringify(JSON.parse(data), null, 2));
                }
                catch (e) {
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
            uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
            if (options.handle) {
                uri = uri + "&handle=" + options.handle;
            }
            if (options.tags) {
                uri = uri + "&tags=" + options.tags;
            }
            cType = "application/geo+json";
        }
        if (options.web) {
            yield launchHereGeoJson(uri);
        }
        else {
            const body = yield execute(uri, "GET", cType, "");
            let fields = [
                "id",
                "geometry.type",
                "tags",
                "createdAt",
                "updatedAt"
            ];
            const allFeatures = JSON.parse(body).features;
            if (!options.raw) {
                allFeatures.forEach((element) => {
                    element.tags = element.properties["@ns:com:here:xyz"].tags;
                    element.updatedAt = common.timeStampToLocaleString(element.properties["@ns:com:here:xyz"].updatedAt);
                    element.createdAt = common.timeStampToLocaleString(element.properties["@ns:com:here:xyz"].createdAt);
                });
            }
            if (options.prop.length > 0) {
                fields = options.prop;
            }
            tableFunction(options.raw ? body : allFeatures, fields);
        }
    });
}
program
    .command("delete <id>")
    .description("delete the xyzspace with the given id")
    .action((geospaceId) => __awaiter(this, void 0, void 0, function* () {
    //console.log("geospaceId:"+"/geospace/"+geospaceId);
    deleteSpace(geospaceId);
}));
function deleteSpace(geospaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield execute("/hub/spaces/" + geospaceId + "?clientId=cli", "DELETE", "application/json", "");
        console.log("xyzspace '" + geospaceId + "' deleted successfully");
    });
}
program
    .command("create")
    .description("create a new xyzspace")
    // .option("-tmin, --tileMinLevel [tileMinLevel]", "Minimum Supported Tile Level")
    // .option("-tmax, --tileMaxLevel [tileMaxLevel]", "Maximum Supported Tile Level")
    .option("-t, --title [title]", "Title for xyzspace")
    .option("-d, --message [message]", "Short description ")
    .action(options => createSpace(options));
function createSpace(options) {
    return __awaiter(this, void 0, void 0, function* () {
        if (options) {
            if (!options.title) {
                options.title = "a new xyzspace created from commandline";
            }
            if (!options.message) {
                options.message = "a new xyzspace created from commandline";
            }
        }
        const gp = getGeoSpaceProfiles(options.title, options.message);
        const body = yield execute("/hub/spaces?clientId=cli", "POST", "application/json", gp);
        console.log("xyzspace '" + body.id + "' created successfully");
    });
}
program
    .command("clear <id>")
    .description("clear data from xyz space")
    .option("-t, --tags [tags]", "tags for the xyz space")
    .option("-i, --ids [ids]", "ids for the xyz space")
    .action((id, options) => clearSpace(id, options));
function clearSpace(id, options) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!options.ids && !options.tags) {
            options.tags = "*";
        }
        let tagOption = options.tags
            ? options.tags
                .split(",")
                .filter((x) => !"") // ### TODO ???
                .map((x) => "tags=" + x)
                .join("&")
            : "";
        if (tagOption != "") {
            tagOption += "&";
        }
        let idOption = options.ids
            ? options.ids
                .split(",")
                .filter((x) => !"") // ### TODO ???
                .map((x) => "id=" + x)
                .join("&")
            : "";
        let finalOpt = tagOption + idOption;
        //console.log("/hub/spaces/"+id+"/features?"+deleteOptions);
        const data = yield execute("/hub/spaces/" + id + "/features?" + finalOpt + "&clientId=cli", "DELETE", "application/geo+json", null);
        console.log("data cleared successfully.");
    });
}
program
    .command("token")
    .description("list all xyz token ")
    .action(() => listTokens());
function listTokens() {
    return __awaiter(this, void 0, void 0, function* () {
        const dataStr = yield common.decryptAndGet("accountInfo", "No here account configure found. Try running 'here configure account'");
        const appInfo = common.getSplittedKeys(dataStr);
        if (!appInfo) {
            throw new Error("Account information out of date. Please re-run 'here configure'");
        }
        const cookie = yield sso.executeWithCookie(appInfo[0], appInfo[1]);
        const options = {
            url: common.xyzRoot() + "/token-api/token",
            method: "GET",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json"
            }
        };
        const { response, body } = yield requestAsync_1.requestAsync(options);
        if (response.statusCode != 200) {
            console.log("Error while fetching maxrights :" + body);
            return;
        }
        const tokenInfo = JSON.parse(body);
        const currentToken = yield common.decryptAndGet("keyInfo", "No token found");
        console.log("====================================================");
        console.log("Current CLI token is : " + currentToken);
        console.log("====================================================");
        common.drawTable(tokenInfo.tokens, [
            "id",
            "type",
            "iat",
            "description"
        ]);
    });
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
    .option("-a, --assign", "list the sample data and allows you to assign fields which needs to be selected as tags")
    .option("-u, --unique", "option to enforce uniqueness to the id by creating a hash of feature and use that as id")
    .option("-o, --override", "override the data even if it share same id")
    .option("-s, --stream", "streaming data support for large file uploads")
    .action(function (id, options) {
    uploadToXyzSpace(id, options);
});
function collate(result) {
    return result.reduce((features, feature) => {
        if (feature.type === "Feature") {
            features.push(feature);
        }
        else if (feature.type === "FeatureCollection") {
            features = features.concat(feature.features);
        }
        else {
            console.log("Unknown type" + feature.type);
        }
        return features;
    }, []);
}
function streamingQueue() {
    let queue = cq(10, function (task, done) {
        uploadData(task.id, task.options, task.tags, task.fc, true, task.options.ptag, task.options.file, task.options.id)
            .then(x => {
            queue.uploadCount += task.fc.features.length;
            process.stdout.write("\ruploaded feature count :" + queue.uploadCount + ", failed feature count :" + queue.failedCount);
            queue.chunksize--;
            done();
        }).catch((err) => {
            queue.failedCount += task.fc.features.length;
            process.stdout.write("\ruploaded feature count :" + queue.uploadCount + ", failed feature count :" + queue.failedCount);
            queue.chunksize--;
            done();
        });
    });
    queue.uploadCount = 0;
    queue.chunksize = 0;
    queue.failedCount = 0;
    queue.send = function (obj) {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.chunksize > 25) {
                yield new Promise(done => setTimeout(done, 1000));
            }
            this.push(obj);
            this.chunksize++;
        });
    };
    queue.shutdown = () => __awaiter(this, void 0, void 0, function* () {
        queue.shutdown = true;
        while (queue.chunksize != 0) {
            yield new Promise(done => setTimeout(done, 1000));
        }
        return true;
    });
    return queue;
}
function taskQueue(size = 8, totalTaskSize) {
    let queue = cq(size, function (task, done) {
        iterateChunk(task.chunk, task.url)
            .then(x => {
            queue.uploadCount += 1;
            queue.chunksize--;
            console.log("uploaded " + ((queue.uploadCount / totalTaskSize) * 100).toFixed(2) + "%");
            done();
        }).catch((err) => {
            queue.failedCount += 1;
            queue.chunksize--;
            console.log("failed features " + ((queue.failedCount / totalTaskSize) * 100).toFixed(2) + "%");
            done();
        });
    });
    queue.uploadCount = 0;
    queue.chunksize = 0;
    queue.failedCount = 0;
    queue.send = function (obj) {
        return __awaiter(this, void 0, void 0, function* () {
            queue.push(obj);
            queue.chunksize++;
            while (queue.chunksize > 25) {
                yield new Promise(done => setTimeout(done, 1000));
            }
        });
    };
    queue.shutdown = () => __awaiter(this, void 0, void 0, function* () {
        queue.shutdown = true;
        while (queue.chunksize != 0) {
            yield new Promise(done => setTimeout(done, 1000));
        }
        return true;
    });
    return queue;
}
function uploadToXyzSpace(id, options) {
    return __awaiter(this, void 0, void 0, function* () {
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
            console.log("conflicting options together. You may need to use either unique or override. Refer to 'here xyz upload -h' for help");
            process.exit(1);
        }
        else if (!options.override) {
            options.unique = true;
        }
        if (options.assign && options.stream) {
            console.log("conflicting options together. You cannot choose assign mode while selecting streaming option");
            process.exit(1);
        }
        if (options.file) {
            const fs = require("fs");
            if (options.file.indexOf(".geojsonl") != -1) {
                if (!options.stream) {
                    const result = yield transform.readLineFromFile(options.file, 100);
                    yield uploadData(id, options, tags, { type: "FeatureCollection", features: collate(result) }, true, options.ptag, options.file, options.id);
                }
                else {
                    let queue = streamingQueue();
                    yield transform.readLineAsChunks(options.file, options.chunk ? options.chunk : 1000, function (result) {
                        return new Promise((res, rej) => {
                            (() => __awaiter(this, void 0, void 0, function* () {
                                if (result.length > 0) {
                                    yield queue.send({ id: id, options: options, tags: tags, fc: { type: "FeatureCollection", features: collate(result) }, retryCount: 3 });
                                }
                                res(queue);
                            }))();
                        });
                    });
                    while (queue.chunksize != 0) {
                        yield new Promise(done => setTimeout(done, 1000));
                    }
                }
            }
            else if (options.file.indexOf(".shp") != -1) {
                let result = yield transform.readShapeFile(options.file);
                yield uploadData(id, options, tags, result, true, options.ptag, options.file, options.id);
            }
            else if (options.file.indexOf(".csv") != -1) {
                if (!options.stream) {
                    let result = yield transform.read(options.file, true);
                    const object = {
                        features: transform.transform(result, options.lat, options.lon, options.alt),
                        type: "FeatureCollection"
                    };
                    yield uploadData(id, options, tags, object, true, options.ptag, options.file, options.id);
                }
                else {
                    let queue = streamingQueue();
                    yield transform.readCSVAsChunks(options.file, options.chunk ? options.chunk : 1000, function (result) {
                        return new Promise((res, rej) => {
                            (() => __awaiter(this, void 0, void 0, function* () {
                                if (result.length > 0) {
                                    const fc = {
                                        features: transform.transform(result, options.lat, options.lon, options.alt),
                                        type: "FeatureCollection"
                                    };
                                    yield queue.send({ id: id, options: options, tags: tags, fc: fc, retryCount: 3 });
                                    res(queue);
                                }
                            }))();
                        });
                    });
                    while (queue.chunksize != 0) {
                        yield new Promise(done => setTimeout(done, 1000));
                    }
                }
            }
            else {
                if (!options.stream) {
                    let result = yield transform.read(options.file, false);
                    yield uploadData(id, options, tags, JSON.parse(result), true, options.ptag, options.file, options.id);
                }
                else {
                    let queue = streamingQueue();
                    let c = 0;
                    yield transform.readGeoJsonAsChunks(options.file, options.chunk ? options.chunk : 1000, function (result) {
                        return __awaiter(this, void 0, void 0, function* () {
                            if (result.length > 0) {
                                const fc = {
                                    features: result,
                                    type: "FeatureCollection"
                                };
                                yield queue.send({ id: id, options: options, tags: tags, fc: fc, retryCount: 3 });
                            }
                            return queue;
                        });
                    });
                    while (queue.chunksize != 0) {
                        yield new Promise(done => setTimeout(done, 1000));
                    }
                }
            }
        }
        else {
            const getStdin = require("get-stdin");
            getStdin().then((str) => {
                try {
                    const obj = JSON.parse(str);
                    uploadData(id, options, tags, obj, false, options.ptag, null, options.id);
                }
                catch (e) {
                    console.log("Empty or invalid input to upload. Refer to 'here xyz upload -h' for help");
                }
            });
        }
        //})();
    });
}
function createQuestionsList(object) {
    for (let i = 0; i < 3 && i < object.features.length; i++) {
        let j = 0;
        for (let key in object.features[0].properties) {
            if (i === 0) {
                const desc = "" +
                    (1 + j++) +
                    " : " +
                    key +
                    " : " +
                    object.features[i].properties[key];
                choiceList.push({ name: desc, value: key });
            }
            else {
                choiceList[j].name =
                    choiceList[j].name + " , " + object.features[i].properties[key];
                j++;
            }
        }
    }
    return questions;
}
function uploadData(id, options, tags, object, isFile, tagProperties, fileName, uid) {
    return new Promise((resolve, reject) => {
        if (object.type == "Feature") {
            object = { features: [object], type: "FeatureCollection" };
        }
        if (options.assign) {
            //console.log("assign mode on");
            const questions = createQuestionsList(object);
            inquirer.prompt(questions).then((answers) => {
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
                uploadDataToSpaceWithTags(id, options, tags, object, false, options.ptag, fileName, options.id).then(x => resolve(x)).catch((error) => reject(error));
            });
        }
        else {
            uploadDataToSpaceWithTags(id, options, tags, object, false, options.ptag, fileName, options.id).then(x => resolve(x)).catch((error) => reject(error));
        }
    });
}
function uploadDataToSpaceWithTags(id, options, tags, object, isFile, tagProperties, fileName, uid) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            gsv.valid(object, function (valid, errs) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (!valid) {
                        console.log(errs);
                        reject(errs);
                        return;
                    }
                    const featureOut = yield mergeAllTags(object.features, tags, tagProperties, fileName, uid, options);
                    try {
                        if (options.stream) {
                            yield iterateChunks([featureOut], "/hub/spaces/" + id + "/features" + "?clientId=cli", 0, 1, options.token);
                        }
                        else {
                            const chunks = options.chunk
                                ? chunkify(featureOut, parseInt(options.chunk))
                                : [featureOut];
                            yield iterateChunks(chunks, "/hub/spaces/" + id + "/features" + "?clientId=cli", 0, chunks.length, options.token);
                            // let tq =  taskQueue(8,chunks.length);
                            // chunks.forEach(chunk=>{
                            //     tq.send({chunk:chunk,url:"/hub/spaces/" + id + "/features"});
                            // });
                            // await tq.shutdown();
                        }
                    }
                    catch (e) {
                        reject(e);
                        return;
                    }
                    if (!options.stream) {
                        if (isFile)
                            console.log("'" +
                                options.file +
                                "' uploaded to xyzspace '" +
                                id +
                                "' successfully");
                        else
                            console.log("data upload to xyzspace '" + id + "' completed successfully");
                        summary.summarize(featureOut, id, true);
                    }
                    resolve(true);
                });
            });
        });
    });
}
function extractOption(callBack) {
    inquirer
        .prompt([
        {
            name: "choice",
            type: "list",
            message: "xyz upload will generate unique IDs for all features by default (no features will be overwritten). See upload -h for more options.",
            choices: ["continue", "quit"],
            default: 0
        }
    ])
        .then(answers => {
        if (answers.choice === "continue") {
            callBack();
        }
        else {
            process.exit();
        }
    });
}
function mergeAllTags(features, tags, tagProperties, fileName, idStr, options) {
    return __awaiter(this, void 0, void 0, function* () {
        let inputTags = [];
        tags.split(",").forEach(function (item) {
            if (item && item != "")
                inputTags.push(item.toLowerCase());
        });
        const tps = tagProperties ? tagProperties.split(",") : null;
        let checkId = false;
        const featureMap = [];
        const duplicates = new Array();
        features.forEach(function (item) {
            let finalTags = inputTags.slice();
            let origId = null;
            //Generate id only if doesnt exist
            if (!item.id && idStr) {
                const fId = createUniqueId(idStr, item);
                if (fId && fId != "") {
                    item.id = fId;
                }
            }
            else {
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
                tps.forEach(function (tp) {
                    if (item.properties[tp]) {
                        if (Array.isArray(item.properties[tp])) {
                            for (let i in item.properties[tp]) {
                                addTagsToList(item.properties[tp][i], tp, finalTags);
                            }
                        }
                        else {
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
            console.log("***************************************************************");
            console.log("We detected duplicate records, only the first was uploaded.\nFind the below records which are duplicated\n");
            common.drawTable(duplicates, ["id", "geometry", "properties"]);
            console.log("uploaded " +
                featuresOut.length +
                " out of " +
                features.length +
                " records");
            console.log("***************************************************************\n");
            return featuresOut;
        }
        else {
            return features;
        }
    });
}
function addTagsToList(value, tp, finalTags) {
    value = value.toString().toLowerCase();
    value = value.replace(/\s+/g, "_");
    finalTags.push(value);
    finalTags.push(tp + "@" + value);
    return finalTags;
}
function createUniqueId(idStr, item) {
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
function uniqArray(a) {
    return Array.from(new Set(a));
}
function getFileName(fileName) {
    try {
        const path = require("path");
        let bName = path.basename(fileName);
        if (bName.indexOf(".") != -1) {
            bName = bName.substring(0, bName.lastIndexOf("."));
        }
        return bName;
    }
    catch (e) {
        return null;
    }
}
function iterateChunks(chunks, url, index, chunkSize, token) {
    return __awaiter(this, void 0, void 0, function* () {
        const item = chunks.shift();
        const fc = { type: "FeatureCollection", features: item };
        const body = yield execute(url, "PUT", "application/geo+json", JSON.stringify(fc), token, true);
        index++;
        if (index == chunkSize) {
            return;
        }
        console.log("uploaded " + ((index / chunkSize) * 100).toFixed(2) + "%");
        yield iterateChunks(chunks, url, index, chunkSize, token);
    });
}
function iterateChunk(chunk, url) {
    return __awaiter(this, void 0, void 0, function* () {
        const fc = { type: "FeatureCollection", features: chunk };
        const body = yield execute(url, "PUT", "application/geo+json", JSON.stringify(fc), null, true);
        return body;
    });
}
function chunkify(data, chunksize) {
    let chunks = [];
    for (const k in data) {
        const item = data[k];
        if (!chunks.length || chunks[chunks.length - 1].length == chunksize)
            chunks.push([]);
        chunks[chunks.length - 1].push(item);
    }
    return chunks;
}
function launchHereGeoJson(uri) {
    return __awaiter(this, void 0, void 0, function* () {
        const token = yield common.verify();
        const accessAppend = uri.indexOf("?") == -1
            ? "?access_token=" + token
            : "&access_token=" + token;
        const opn = require("opn");
        opn("http://geojson.tools/index.html?url=" +
            common.xyzRoot() +
            uri +
            accessAppend, { wait: false });
    });
}
common.validate([
    "list",
    "show",
    "create",
    "delete",
    "upload",
    "describe",
    "clear",
    "token",
    "analyze"
], [process.argv[2]], program);
program.parse(process.argv);
