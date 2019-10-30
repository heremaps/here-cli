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

import * as shapefile from "shapefile";
import * as fs from "fs";
import * as tmp from "tmp";
import * as request from "request";
import * as readline from "readline";
import { requestAsync } from "./requestAsync";
import * as proj4 from "proj4";
import * as inquirer from "inquirer";
import { deprecate } from "util";

const latArray = ["y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"];
const lonArray = ["x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon", "lng", "long", "longitud"];
const altArray = ["z", "zcoord", "zcoordinate", "coordz", "coordinatez", "altitude", "alt"];
const pointArray = ["p", "point", "points"];
const wgs84prjString = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

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
    let isPrjFilePresent : boolean = false;
    let prjFilePath = path.substring(0,path.lastIndexOf('.shp')) + ".prj";
    let prjFile: string = '';
    if (isPrjFilePresent = fs.existsSync(prjFilePath)) {
        console.log(prjFilePath + " file exists, using this file for crs transformation");
        prjFile = readDataFromFile(prjFilePath, false);
    }
    const source = await shapefile.open(path, undefined, { encoding: "UTF-8" });

    while (true) {
        const result = await source.read();

        if (result.done){
            return fc;
        }
        let feature = result.value;
        if(isPrjFilePresent && prjFile.toString().trim() != wgs84prjString.toString().trim()){
            feature = convertFeatureToPrjCrs(prjFile, feature);
        }

        fc.features.push(feature);
    }
}

function convertFeatureToPrjCrs(prjFile: string, feature: any){
    if(feature.geometry.type == "Point"){
        feature.geometry.coordinates = proj4(prjFile, wgs84prjString, feature.geometry.coordinates);
    } else if(feature.geometry.type == "MultiPoint" || feature.geometry.type == "LineString"){        
        let newCoordinates: any[] = [];
        feature.geometry.coordinates.forEach(function (value: number[]) {
            newCoordinates.push(proj4(prjFile, wgs84prjString,value));
        });
        feature.geometry.coordinates = newCoordinates;
    } else if(feature.geometry.type == "MultiLineString" || feature.geometry.type == "Polygon"){
        let newCoordinatesList: any[][] = [];
        feature.geometry.coordinates.forEach(function (coordinateList: number[][]) {
            let newCoordinates: any[] = [];
            newCoordinatesList.push(newCoordinates);
            coordinateList.forEach(function (value: number[]) {
                newCoordinates.push(proj4(prjFile, wgs84prjString,value));
            });
        });
        feature.geometry.coordinates = newCoordinatesList;
    } else if(feature.geometry.type == "MultiPolygon"){
        let newCoordinatesListArray: any[][][] = [];
        feature.geometry.coordinates.forEach(function (coordinateListArray: number[][][]) {
            let newCoordinatesList: any[][] = [];
            newCoordinatesListArray.push(newCoordinatesList);
            coordinateListArray.forEach(function (coordinateList: number[][]) {
                let newCoordinates: any[] = [];
                newCoordinatesList.push(newCoordinates);
                coordinateList.forEach(function (value: number[]) {
                    newCoordinates.push(proj4(prjFile, wgs84prjString,value));
                });
            });
        });
        feature.geometry.coordinates = newCoordinatesListArray;
    } else {
        console.log("Unsupported Geometry type - " + feature.geometry.type);
        process.exit(1);
    }
    return feature;
}

export async function read(path: string, needConversion: boolean, opt: any = null) {
    if (path.indexOf("http://") != -1 || path.indexOf("https://") != -1) {
        return await readDataFromURL(path, needConversion, opt);
    } else {
        return readDataFromFile(path, needConversion, opt);
    }
}

async function readDataFromURL(path: string, needConversion: boolean, opt: any = null) {
    const { response, body } = await requestAsync({ url: path });
    if (response.statusCode != 200)
        throw new Error("Error requesting: " + body);

    if (needConversion)
        return dataToJson(body, opt);
    else
        return body;
}

function readDataFromFile(path: string, needConversion: boolean, opt: any = null) {
    const file_data = fs.readFileSync(path, { encoding: 'utf8' });
    if (needConversion)
        return dataToJson(file_data, opt);
    else
        return file_data;
}

function dataToJson(file_data: string, opt: any = null) {
    const csvjson = require('csvjson');
    const result = csvjson.toObject(file_data, opt);
    return result;
}

export async function transform(result: any[], options: any) {
    const objects: any[] = [];
    if(options.assign && result.length > 0){
        await setStringFieldsFromUser(result[0],options);
    }
    if(!options.stream){
        await toGeoJsonFeature(result[0], options, true);//calling this to ask Lat Lon question to the user for only one time
    }
    for (const i in result) {
        const ggson = await toGeoJsonFeature(result[i], options, false);
        if (ggson) {
            objects.push(ggson);
        }
    }
    return objects;
}

async function setStringFieldsFromUser(object:any, options: any){
    let choiceList = createQuestionsList(object);
    const stringFieldQuestion = [
        {
            type: "checkbox",
            name: "stringFieldChoice",
            message:
                "Select attributes which should be stored as String even though they are numbers/boolean (especially where leading zeros are important e.g. postal codes, FIPS codes)",
            choices: choiceList
        }
    ];
    let answers: any = await inquirer.prompt(stringFieldQuestion);
    if (options.stringFields === undefined || options.stringFields == '') {
        options.stringFields = "";
    } else {
        options.stringFields = options.stringFields + ",";
    }
    options.stringFields = options.stringFields + answers.stringFieldChoice;
}

async function toGeoJsonFeature(object: any, options: any, isAskQuestion: boolean = false) {
    //latField: string, lonField: string, altField: string, pointField: string, stringFields: string = '') {
    const props: any = {};
    let lat = undefined;
    let lon = undefined;
    let alt = undefined;
    for (const k in object) {
        let key = k.trim();
        if (key == options.point) { // we shouldn't automatically look for a field called points
            //console.log('extracting lat/lon from',pointField,object[k])
            const point = object[k].match(/([-]?\d+.[.]\d+)/g);
            if(point) {
                lat = point[0];
                lon = point[1];
            }
        }else if (options.lonField && options.lonField.toLowerCase() == k.toLowerCase()) {
            lon = object[options.lonField];
        } else if (options.latField && options.latField.toLowerCase() == k.toLowerCase()) {
            lat = object[options.latField];
        } else if (options.altField && options.altField.toLowerCase() == k.toLowerCase()) {
            alt = object[options.altField];
        } else if (!options.latField && isLat(key)) {
            lat = object[k];
        } else if (!options.lonField && isLon(key)) {
            lon = object[k];
        } else if (!options.altField && isAlt(key)) {
            alt = object[k];
        } else {
            if(!(options.stringFields && options.stringFields.split(",").includes(k)) && isNumeric(object[k])){
                props[key] = parseFloat(object[k]);
            } else if(!(options.stringFields && options.stringFields.split(",").includes(k)) && isBoolean(object[k].trim())){
                props[key] = object[k].trim().toLowerCase() == 'true' ? true : false;
            } else {
                props[key] = object[k].trim();
            }
        }
    }
    if(isAskQuestion){
        if (!options.allowNullLatLons) {
            if(lat == null || isNaN(parseFloat(lat))){
                let choiceList = createQuestionsList(object);
                const questions = [
                    {
                        type: "list",
                        name: "latChoice",
                        message: "Select property which should be used for Latitude",
                        choices: choiceList
                    }
                ];
                let latAnswer : any = await inquirer.prompt(questions);
                console.log("new Latitude field selected - " + latAnswer.latChoice);
                options.latField = latAnswer.latChoice;
                lat = object[options.latField];
            }
            if(lon == null || isNaN(parseFloat(lon))){
                let choiceList = createQuestionsList(object);
                const questions = [
                    {
                        type: "list",
                        name: "lonChoice",
                        message: "Select property which should be used for Longitude",
                        choices: choiceList
                    }
                ];
                let lonAnswer : any = await inquirer.prompt(questions);
                console.log("new Longitude field selected - " + lonAnswer.lonChoice);
                options.lonField = lonAnswer.lonChoice;
                lon = object[options.lonField];
            }
        }
        if(options.askUserForId && !options.id && !object['id']){
            let choiceList = createQuestionsList(object);
            const questions = [
                {
                    type: "list",
                    name: "idChoice",
                    message: "Select property which should be used as featureID",
                    choices: choiceList
                }
            ];
            let idAnswer : any = await inquirer.prompt(questions);
            console.log("new featureID field selected - " + idAnswer.idChoice);
            options.id = idAnswer.idChoice;
        }
    }
    
    const geometry = toGeometry(lat, lon, alt);
    if(geometry == null){
        props["@ns:com:here:xyz"]={};
        if(lat == null || lat == '' || parseFloat(lat) == 0 || lon == null || lon == '' || parseFloat(lon) == 0){
            props["@ns:com:here:xyz"]["tags"] = ['null_island'];
        } else {
            props["@ns:com:here:xyz"]["tags"] = ['invalid'];
        }
    }
    return { type: "Feature", geometry: geometry, properties: props };
}

function createQuestionsList(object: any) {
    let choiceList: { name: string, value: string }[] = [];
    for (const k in object) {
        choiceList.push({ name: k + ' : ' + object[k], value: k });
    }
    return choiceList;
}

function isNumeric(n: string) { 
    return !isNaN(Number(n)) && !isNaN(parseFloat(n)) && isFinite(parseFloat(n)); 
}

function isBoolean(n: string) { 
    return n.toLowerCase() == 'true' || n.toLowerCase() == 'false';
}

function toGeometry(lat: string, lon: string, alt?: string | undefined) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    const altitude = alt ? parseFloat(alt) : undefined;
    if((isNaN(latitude) || latitude == 0) && (isNaN(longitude) || longitude == 0)) {
        return null;
    }
    return toPoint(latitude, longitude, altitude);
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

function isPoint(k: string) {
    return pointArray.includes(k.toLowerCase())
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
                (async()=>{
                    const queue = await streamFuntion(dataArray);
                    await queue.shutdown();
                    console.log("");
                    resolve();
                })();
            });
        });
    });
}


export function readCSVAsChunks(incomingPath: string, chunckSize:number,options:any, streamFuntion:Function) {
    let isQuestionAsked : boolean = false;
    return readData(incomingPath, 'csv').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array<any>();
            var csv = require("fast-csv");
            var stream = fs.createReadStream(path);
            let csvstream = csv.parseStream(stream, {headers : true}).on("data", async function(data:any){
                if(!isQuestionAsked){
                    csvstream.pause();
                    await toGeoJsonFeature(data, options, true);//calling this to ask Lat Lon question to the user for only one time
                    isQuestionAsked = true;
                    csvstream.resume();
                }
                dataArray.push(data);
                if(dataArray.length >=chunckSize){
                    //console.log('dataArray '+chunckSize);
                    csvstream.pause();
                    (async()=>{
                        await streamFuntion(dataArray);
                        csvstream.resume();
                        dataArray=new Array<any>();
                    })();
                }
            }).on("end", function(){
                (async()=>{
                    const queue = await streamFuntion(dataArray);
                    await queue.shutdown();
                    console.log("");
                    resolve();
                })();
            });
        });
    });
}
                


export function readGeoJsonAsChunks(incomingPath: string, chunckSize:number,streamFuntion:Function) {
    return readData(incomingPath, 'geojson').then(path => {
        return new Promise((resolve, reject) => {
            let dataArray = new Array<any>();
            const JSONStream = require('JSONStream');
            const  es = require('event-stream');
            const fileStream = fs.createReadStream(path, {encoding: 'utf8'});
            let stream = fileStream.pipe(JSONStream.parse('features.*'));
            stream.pipe(es.through(async function (data:any) {
                dataArray.push(data);
                if(dataArray.length >=chunckSize){
                    stream.pause();
                    fileStream.pause();
                    await streamFuntion(dataArray);
                    dataArray=new Array<any>();
                    stream.resume();
                    fileStream.resume();
                }
                return data;
            },function end () {
                if(dataArray.length >0){
                    (async()=>{
                        const queue = await streamFuntion(dataArray);
                        await queue.shutdown();
                        console.log("");
                        dataArray=new Array<any>();
                    })();
                }
                resolve();
            }));
         });
    });
}
                
