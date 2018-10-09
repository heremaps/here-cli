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

var latArray = ["y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"];
var lonArray = ["x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon"];
var altArray = ["z", "zcoord", "zcoordinate", "coordz", "coordinatez", "altitude", "alt"];

function readShapeFile(path,callBack){
	if(path.indexOf("http://")!=-1 || path.indexOf("https://")!=-1){
	  var request = require('request');
          var fs = require('fs');
	  var tmp = require('tmp');
	  tmp.file({ mode: 0644, prefix: '', postfix: '.shp' }, function _tempFileCreated(err, tempFilePath, fd) {
  		if (err) throw err;
                var dest = fs.createWriteStream(tempFilePath);
		dest.on('finish', function (e) {
                    readShapeFileInternal(tempFilePath,callBack);
                });
		request.get(path)
        	.on('error', function(err) {
              	    console.log(err)
          	}).pipe(dest);
	  });
	}else{
	  readShapeFileInternal(path,callBack);
	}
}

function readShapeFileInternal(path,callBack){
        var shapefile = require("shapefile");
        var fc = {"type":"FeatureCollection","features":[]};
        shapefile.open(path,undefined, {encoding: "UTF-8"})
        .then(source => source.read()
        .then(function log(result) {
                if (result.done) {
                   callBack(fc);
                   return;
                }
                fc.features.push(result.value);
                return source.read().then(log);
        })).catch(error => console.error(error.stack));

}


function read(path,callBack,needConversion){
    if(path.indexOf("http://")!=-1||path.indexOf("https://")!=-1){
        readDataFromURL(path,callBack,needConversion);
    }else {
        readDataFromFile(path,callBack,needConversion);
    }
}
function readDataFromURL(path,callBack,needConversion){
    var request = require('request');
    request(path, function (error, response, body) {
        if(response.statusCode==200){
            if(needConversion)
                callBack(dataToJson(body));
            else
                callBack(body);
        }else{
            console.log("Failed to fetch data from :"+path);
        }
    });
}

function readDataFromFile(path,callBack,needConversion){
    var fs = require('fs'); 
    var file_data = fs.readFileSync(path, { encoding : 'utf8'});
    if(needConversion)
        callBack(dataToJson(file_data));
    else 
        callBack(file_data);
}


function readData(path,postfix){
    return new Promise((resolve,reject)=>{
        if(path.indexOf("http://")!=-1 || path.indexOf("https://")!=-1){
            const request = require('request');
            const fs = require('fs');
            const tmp = require('tmp');
            tmp.file({ mode: 0644, prefix: '', postfix: postfix }, function _tempFileCreated(err, tempFilePath, fd) {
                if (err) throw err;
                const dest = fs.createWriteStream(tempFilePath);
                dest.on('finish', function (e) {
                            resolve(tempFilePath);
                        });
                request.get(path)
                    .on('error', function(err) {
                            console.log(err)
                    }).pipe(dest);
            });
        }else{
            resolve(path);
        }
    });
	
}

/*
chunckSize should be used later to stream data
*/
function readLineFromFile(incomingPath,callBack,chunckSize=100) {
    readData(incomingPath,'geojsonl').then(path=>{
        const dataArray=new Array();
        const fs = require('fs'),
            readline = require('readline'),
            instream = fs.createReadStream(path),
            outstream = new (require('stream'))(),
            rl = readline.createInterface(instream, outstream);
        
        rl.on('line', function (line) {
            dataArray.push(JSON.parse(line));
        });
        
        rl.on('close', function (line) {
            callBack(dataArray,true);
        });
    });
}

function dataToJson(file_data){
    var csvjson = require('csvjson');
    var options = {
        delimiter :  "," , // optional
        quote     : '"' // optional
    };
    var result = csvjson.toObject(file_data, options);
    return result;
}

function transform(result,latField,lonField,altField){
    var objects = [];
    result.forEach(function (value) {
        var ggson = toGeoJsonFeature(value,latField,lonField,altField);
        if(ggson)
            objects.push(ggson);
    });
    return objects;
}

function toGeoJsonFeature(object,latField,lonField,altField){
    var props = new Object();
    var lat = null;
    var lon = null;
    var alt = null;
    for(var k in object){
        if(lonField==k.toLowerCase()){
            lon = object[lonField];
        }else if(latField==k.toLowerCase()){
            lat = object[latField];
        }else if(altField==k.toLowerCase()){
            alt = object[altField];
        }else if(!latField && isLat(k)){
            lat = object[k];
        }else if(!lonField && isLon(k)){
            lon=object[k];
        }else if(!altField && isAlt(k)){
            alt=object[k];
        }else{
            props[k] = object[k];
        }
    }
    if(!lat){
        console.log("Could not identify latitude");
        return null;
    }else if(!lon){
        console.log("Could not identify longitude");
        return null;
    }
    return {type:"Feature",geometry:toGeometry(lat,lon,alt),properties:props};
}

function toGeometry(lat,lon,alt){
    try{
        var latitude = parseFloat(lat);
        var longitude = parseFloat(lon);
        var altitude = (alt)?parseFloat(alt):null;
        return toPoint(latitude,longitude,altitude);
    }catch(e){

    }
}

function toPoint(latitude,longitude,altitude){
   var coordinates = (altitude)? [longitude, latitude,altitude]:[longitude, latitude];
   return  { 
                "type": "Point",
                "coordinates": coordinates
    };
}

function isLat(k){
    return latArray.find(function(element) {
        return element == k.toLowerCase();
    });
}

function isAlt(k){
    return altArray.find(function(element) {
        return element == k.toLowerCase();
    });
}

function isLon(k){
    return lonArray.find(function(element) {
        return element == k.toLowerCase();
    });
}
module.exports.read = read;
module.exports.transform = transform;
module.exports.readShapeFile = readShapeFile
module.exports.readLineFromFile = readLineFromFile

 