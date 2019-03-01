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
const shapefile = require("shapefile");
const fs = require("fs");
const tmp = require("tmp");
const request = require("request");
const readline = require("readline");
const requestAsync_1 = require("./requestAsync");
const latArray = ["y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"];
const lonArray = ["x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon"];
const altArray = ["z", "zcoord", "zcoordinate", "coordz", "coordinatez", "altitude", "alt"];
function readShapeFile(path) {
    if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
        return new Promise((resolve, reject) => tmp.file({ mode: 0o644, prefix: '', postfix: '.shp' }, function _tempFileCreated(err, tempFilePath, fd) {
            if (err)
                reject(err);
            const dest = fs.createWriteStream(tempFilePath);
            dest.on('finish', function (err) {
                if (err)
                    reject(err);
                else
                    resolve(readShapeFileInternal(tempFilePath));
            });
            request.get(path)
                .on('error', err => reject(err))
                .pipe(dest);
        }));
    }
    else {
        return readShapeFileInternal(path);
    }
}
exports.readShapeFile = readShapeFile;
function readShapeFileInternal(path) {
    return __awaiter(this, void 0, void 0, function* () {
        const fc = { "type": "FeatureCollection", "features": [] };
        const source = yield shapefile.open(path, undefined, { encoding: "UTF-8" });
        while (true) {
            const result = yield source.read();
            if (result.done)
                return fc;
            fc.features.push(result.value);
        }
    });
}
function read(path, needConversion) {
    return __awaiter(this, void 0, void 0, function* () {
        if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
            return yield readDataFromURL(path, needConversion);
        }
        else {
            return readDataFromFile(path, needConversion);
        }
    });
}
exports.read = read;
function readDataFromURL(path, needConversion) {
    return __awaiter(this, void 0, void 0, function* () {
        const { response, body } = yield requestAsync_1.requestAsync({ url: path });
        if (response.statusCode != 200)
            throw new Error("Error requesting: " + body);
        if (needConversion)
            return dataToJson(body);
        else
            return body;
    });
}
function readDataFromFile(path, needConversion) {
    const file_data = fs.readFileSync(path, { encoding: 'utf8' });
    if (needConversion)
        return dataToJson(file_data);
    else
        return file_data;
}
function dataToJson(file_data) {
    const csvjson = require('csvjson');
    const options = {
        delimiter: ",",
        quote: '"' // optional
    };
    const result = csvjson.toObject(file_data, options);
    return result;
}
function transform(result, latField, lonField, altField) {
    const objects = [];
    result.forEach(function (value) {
        const ggson = toGeoJsonFeature(value, latField, lonField, altField);
        if (ggson)
            objects.push(ggson);
    });
    return objects;
}
exports.transform = transform;
function toGeoJsonFeature(object, latField, lonField, altField) {
    const props = {};
    let lat = undefined;
    let lon = undefined;
    let alt = undefined;
    for (const k in object) {
        if (lonField == k.toLowerCase()) {
            lon = object[lonField];
        }
        else if (latField == k.toLowerCase()) {
            lat = object[latField];
        }
        else if (altField == k.toLowerCase()) {
            alt = object[altField];
        }
        else if (!latField && isLat(k)) {
            lat = object[k];
        }
        else if (!lonField && isLon(k)) {
            lon = object[k];
        }
        else if (!altField && isAlt(k)) {
            alt = object[k];
        }
        else {
            props[k] = object[k];
        }
    }
    if (!lat) {
        console.log("Could not identify latitude");
        return null;
    }
    else if (!lon) {
        console.log("Could not identify longitude");
        return null;
    }
    return { type: "Feature", geometry: toGeometry(lat, lon, alt), properties: props };
}
function toGeometry(lat, lon, alt) {
    try {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        const altitude = alt ? parseFloat(alt) : undefined;
        return toPoint(latitude, longitude, altitude);
    }
    catch (_a) {
    }
}
function toPoint(latitude, longitude, altitude) {
    const coordinates = (altitude) ? [longitude, latitude, altitude] : [longitude, latitude];
    return {
        "type": "Point",
        "coordinates": coordinates
    };
}
function isLat(k) {
    return latArray.includes(k.toLowerCase());
}
function isAlt(k) {
    return altArray.includes(k.toLowerCase());
}
function isLon(k) {
    return lonArray.includes(k.toLowerCase());
}
function readData(path, postfix) {
    return new Promise((resolve, reject) => {
        if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
            tmp.file({ mode: 0o644, prefix: '', postfix: postfix }, (err, tempFilePath, fd) => {
                if (err)
                    reject(err);
                const dest = fs.createWriteStream(tempFilePath);
                dest.on('finish', function (e) {
                    resolve(tempFilePath);
                });
                request.get(path)
                    .on('error', function (err) {
                    reject(err);
                }).pipe(dest);
            });
        }
        else {
            resolve(path);
        }
    });
}
/*
chunckSize should be used later to stream data
*/
function readLineFromFile(incomingPath, chunckSize = 100) {
    return readData(incomingPath, 'geojsonl').then(path => {
        return new Promise((resolve, reject) => {
            const dataArray = new Array();
            const instream = fs.createReadStream(path);
            const outstream = new (require('stream'))();
            const rl = readline.createInterface(instream, outstream);
            rl.on('line', (line) => dataArray.push(JSON.parse(line)));
            rl.on("error", err => reject(err));
            rl.on('close', () => resolve(dataArray));
        });
    });
}
exports.readLineFromFile = readLineFromFile;
function readLineAsChunks(incomingPath, chunckSize, streamFuntion) {
    return readData(incomingPath, 'geojsonl').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array();
            var LineByLineReader = require('line-by-line'), lr = new LineByLineReader(path);
            lr.on('error', function (err) {
                console.log(err);
                throw err;
            });
            lr.on('line', function (line) {
                return __awaiter(this, void 0, void 0, function* () {
                    dataArray.push(JSON.parse(line));
                    if (dataArray.length >= chunckSize) {
                        lr.pause();
                        yield streamFuntion(dataArray);
                        lr.resume();
                        dataArray = new Array();
                    }
                });
            });
            lr.on('end', function () {
                (() => __awaiter(this, void 0, void 0, function* () {
                    const queue = yield streamFuntion(dataArray);
                    yield queue.shutdown();
                    console.log("");
                    resolve();
                }))();
            });
        });
    });
}
exports.readLineAsChunks = readLineAsChunks;
function readCSVAsChunks(incomingPath, chunckSize, streamFuntion) {
    return readData(incomingPath, 'csv').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array();
            var csv = require("fast-csv");
            var stream = fs.createReadStream(path);
            let csvstream = csv.fromStream(stream, { headers: true }).on("data", function (data) {
                dataArray.push(data);
                if (dataArray.length >= chunckSize) {
                    //console.log('dataArray '+chunckSize);
                    csvstream.pause();
                    (() => __awaiter(this, void 0, void 0, function* () {
                        yield streamFuntion(dataArray);
                        csvstream.resume();
                        dataArray = new Array();
                    }))();
                }
            }).on("end", function () {
                (() => __awaiter(this, void 0, void 0, function* () {
                    const queue = yield streamFuntion(dataArray);
                    yield queue.shutdown();
                    console.log("");
                    resolve();
                }))();
            });
        });
    });
}
exports.readCSVAsChunks = readCSVAsChunks;
function readGeoJsonAsChunks(incomingPath, chunckSize, streamFuntion) {
    return readData(incomingPath, 'geojson').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array();
            const JSONStream = require('JSONStream');
            const es = require('event-stream');
            const fileStream = fs.createReadStream(path, { encoding: 'utf8' });
            let stream = fileStream.pipe(JSONStream.parse('features.*'));
            stream.pipe(es.through(function (data) {
                return __awaiter(this, void 0, void 0, function* () {
                    dataArray.push(data);
                    if (dataArray.length >= chunckSize) {
                        stream.pause();
                        fileStream.pause();
                        yield streamFuntion(dataArray);
                        dataArray = new Array();
                        stream.resume();
                        fileStream.resume();
                    }
                    return data;
                });
            }, function end() {
                if (dataArray.length > 0) {
                    (() => __awaiter(this, void 0, void 0, function* () {
                        const queue = yield streamFuntion(dataArray);
                        yield queue.shutdown();
                        console.log("");
                        dataArray = new Array();
                    }))();
                }
                resolve();
            }));
        });
    });
}
exports.readGeoJsonAsChunks = readGeoJsonAsChunks;
