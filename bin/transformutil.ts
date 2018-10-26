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

import * as shapefile from "shapefile";
import * as fs from "fs";
import * as tmp from "tmp";
import * as request from "request";
import * as readline from "readline";
import { requestAsync } from "./requestAsync";
import { deprecate } from "util";

const latArray = ["y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"];
const lonArray = ["x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon"];
const altArray = ["z", "zcoord", "zcoordinate", "coordz", "coordinatez", "altitude", "alt"];

export type FeatureCollection = {
    "type": "FeatureCollection",
    "features": Array<any>
};

export function readShapeFile(path: string) {
    if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
        return new Promise<FeatureCollection>((resolve, reject) =>
            tmp.file({ mode: 0o644, prefix: '', postfix: '.shp' }, function _tempFileCreated(err, tempFilePath, fd) {
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
            })
        );
    } else {
        return readShapeFileInternal(path);
    }
}

async function readShapeFileInternal(path: string): Promise<FeatureCollection> {
    const fc: FeatureCollection = { "type": "FeatureCollection", "features": [] };
    const source = await shapefile.open(path, undefined, { encoding: "UTF-8" });

    while (true) {
        const result = await source.read();

        if (result.done)
            return fc;

        fc.features.push(result.value);
    }
}

export async function read(path: string, needConversion: boolean) {
    if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
        return await readDataFromURL(path, needConversion);
    } else {
        return readDataFromFile(path, needConversion);
    }
}

async function readDataFromURL(path: string, needConversion: boolean) {
    const { response, body } = await requestAsync({ url: path });
    if (response.statusCode != 200)
        throw new Error("Error requesting: " + body);

    if (needConversion)
        return dataToJson(body);
    else
        return body;
}

function readDataFromFile(path: string, needConversion: boolean) {
    const file_data = fs.readFileSync(path, { encoding: 'utf8' });
    if (needConversion)
        return dataToJson(file_data);
    else
        return file_data;
}

function dataToJson(file_data: string) {
    const csvjson = require('csvjson');
    const options = {
        delimiter: ",", // optional
        quote: '"' // optional
    };
    const result = csvjson.toObject(file_data, options);
    return result;
}

export function transform(result: any[], latField: string, lonField: string, altField: string) {
    const objects: any[] = [];
    result.forEach(function (value) {
        const ggson = toGeoJsonFeature(value, latField, lonField, altField);
        if (ggson)
            objects.push(ggson);
    });
    return objects;
}

function toGeoJsonFeature(object: any, latField: string, lonField: string, altField: string) {
    const props: any = {};
    let lat = undefined;
    let lon = undefined;
    let alt = undefined;
    for (const k in object) {
        if (lonField == k.toLowerCase()) {
            lon = object[lonField];
        } else if (latField == k.toLowerCase()) {
            lat = object[latField];
        } else if (altField == k.toLowerCase()) {
            alt = object[altField];
        } else if (!latField && isLat(k)) {
            lat = object[k];
        } else if (!lonField && isLon(k)) {
            lon = object[k];
        } else if (!altField && isAlt(k)) {
            alt = object[k];
        } else {
            props[k] = object[k];
        }
    }
    if (!lat) {
        console.log("Could not identify latitude");
        return null;
    } else if (!lon) {
        console.log("Could not identify longitude");
        return null;
    }
    return { type: "Feature", geometry: toGeometry(lat, lon, alt), properties: props };
}

function toGeometry(lat: string, lon: string, alt?: string | undefined) {
    try {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        const altitude = alt ? parseFloat(alt) : undefined;
        return toPoint(latitude, longitude, altitude);
    } catch {
    }
}

function toPoint(latitude: number, longitude: number, altitude?: number | undefined) {
    const coordinates = (altitude) ? [longitude, latitude, altitude] : [longitude, latitude];
    return {
        "type": "Point",
        "coordinates": coordinates
    };
}

function isLat(k: string) {
    return latArray.includes(k.toLowerCase());
}

function isAlt(k: string) {
    return altArray.includes(k.toLowerCase());
}

function isLon(k: string) {
    return lonArray.includes(k.toLowerCase());
}

function readData(path: string, postfix: string): Promise<string> {
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
                .on('error', function(err) {
                    reject(err);
                }).pipe(dest);
            });
        } else {
            resolve(path);
        }
    });
}

/*
chunckSize should be used later to stream data
*/
export function readLineFromFile(incomingPath: string, chunckSize = 100) {
    return readData(incomingPath, 'geojsonl').then(path => {
        return new Promise((resolve, reject) => {
            const dataArray = new Array<any>();
            const instream = fs.createReadStream(path);
            const outstream = new (require('stream'))();

            const rl = readline.createInterface(instream, outstream);

            rl.on('line', (line: string) => dataArray.push(JSON.parse(line)));
            rl.on("error", err => reject(err));
            rl.on('close', () => resolve(dataArray));
        });
    });
}


export function readLineAsChunks(incomingPath: string, chunckSize:number,streamFuntion:Function) {
    return readData(incomingPath, 'geojsonl').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array<any>();
            var LineByLineReader = require('line-by-line'),
            lr = new LineByLineReader(path);
            lr.on('error', function (err:any) {
                console.log(err);
                throw err;
            });
            lr.on('line', async function (line:any) {
                dataArray.push(JSON.parse(line));
                if(dataArray.length>=chunckSize){
                    lr.pause();
                    await streamFuntion(dataArray);
                    lr.resume();
                    dataArray=new Array<any>();
                }
            });
            lr.on('end', function () {
                streamFuntion(dataArray)
            });
        });
    });
}


export function readCSVAsChunks(incomingPath: string, chunckSize:number,streamFuntion:Function) {
    return readData(incomingPath, 'csv').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array<any>();
            var csv = require("fast-csv");
            var stream = fs.createReadStream(incomingPath);
            let csvstream = csv.fromStream(stream, {headers : true}).on("data", function(data:any){
                dataArray.push(data);
                if(dataArray.length>=chunckSize){
                    streamFuntion(dataArray)
                    dataArray=new Array<any>();
                }
            }).on("end", function(){
                streamFuntion(dataArray)
            });
        });
    });
}
                


