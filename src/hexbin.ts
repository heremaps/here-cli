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

import * as turf from '@turf/helpers';
import * as common from "./common";

const cosines: number[] = [];
const sines: number[] = [];
for (let i = 0; i < 6; i++) {
    const angle = 2 * Math.PI / 6 * i;
    cosines.push(Math.cos(angle));
    sines.push(Math.sin(angle));
}
const hexagonAngle = 0.523598776; //30 degrees in radians

function getHexBin(feature: any, cellSize: number, isMeters: boolean){
    const point = feature.geometry.coordinates;
    let degreesCellSize;
    if(isMeters){
        degreesCellSize = (cellSize/1000)/(111.111 * Math.cos(point[1] * Math.PI / 180));
    } else {
        degreesCellSize = cellSize;
    }
    const finalHexRootPoint = getSelectedHexagon(point[1],point[0],degreesCellSize);
    let data= hexagon(finalHexRootPoint,degreesCellSize,degreesCellSize,null,cosines,sines);
    return data;
}

//here x and y is inverse, x is latitude and y is longitude
function getSelectedHexagon(x: number, y: number, degreesCellSize: number){
    let xinverse, yinverse = false;
    if(x < 0){
        xinverse = true;
        x = -x;
    }
    if(y < 0){
        yinverse = true;
        y = -y;
    }
    let hexRootPoint = getMoldulusHexagon(x,y,degreesCellSize);
    if(xinverse){
        hexRootPoint[1] = -hexRootPoint[1];
    }
    if(yinverse){
        hexRootPoint[0] = -hexRootPoint[0];
    }
    return hexRootPoint;
}

//here x and y is inverse, x is latitude and y is longitude
function getMoldulusHexagon(x:number, y:number, degreesCellSize:number)
{
    //y = y - (degreesCellSize / 2); //decrease hlaf cellsize because our grid is not starting from 0,0 which is having half hexagon
    const c = Math.sin(hexagonAngle) * degreesCellSize; //height between side length and hex top point
    const gridHeight = degreesCellSize + c;
    const halfWidth = Math.cos(hexagonAngle) * degreesCellSize;
    const gridWidth = halfWidth * 2;

    // Find the row and column of the box that the point falls in.
    let row;
    let column;

    if (y < (degreesCellSize / 2)){
        row = -1;
        if(x < halfWidth) {
            column = 0;
        } else {
            column = Math.ceil( (x - halfWidth) / gridWidth);
        }
    } else {
        y = y - (degreesCellSize / 2);
        row = Math.floor(y / gridHeight);
        const rowIsOdd = row % 2 == 1;

        // Is the row an odd number?
        if (rowIsOdd)// Yes: Offset x to match the indent of the row
            column = Math.floor((x - halfWidth) / gridWidth);
        else// No: Calculate normally
            column = Math.floor(x / gridWidth);

        // Work out the position of the point relative to the box it is in
        const relY = y - (row * gridHeight) //- (degreesCellSize / 2);//decrease half cellsize because our grid is not starting from 0,0 which is having half hexagon
        let relX;

        if (rowIsOdd) {
            relX = (x - (column * gridWidth)) - halfWidth;
        } else {
            relX = x - (column * gridWidth);
        }

        const m = c / halfWidth;
        if (relY < (-m * relX) + c) // LEFT edge
        {
            row--;
            if (!rowIsOdd && row > 0){
                column--;
            }
        } else if (relY < (m * relX) - c) // RIGHT edge
        {
            row--;
            if (rowIsOdd || row < 0){
                column++;
            }
        }
    }
    //console.log("hexagon row " + row + " , column " + column);

    const lat = (column * gridWidth + ((row % 2) * halfWidth)) + halfWidth;
    const lon = (row * (c + degreesCellSize)) +  c + (degreesCellSize);
    return [round(lon,6),round(lat,6)];
}

function round(value:number, decimals:number) {
    if(!("" + value).includes("e")) {
        return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
    } else {
        var arr = ("" + value).split("e");
        var sig = "";
        if(+arr[1] + decimals > 0) {
          sig = "+";
        }
        return Number(+(Math.round(Number(+arr[0] + "e" + sig + (+arr[1] + decimals))) + "e-" + decimals));
      }
}

/**
 * Creates hexagon
 *
 * @private
 * @param {Array<number>} center of the hexagon
 * @param {number} rx half hexagon width
 * @param {number} ry half hexagon height
 * @param {Object} properties passed to each hexagon
 * @param {Array<number>} cosines precomputed
 * @param {Array<number>} sines precomputed
 * @returns {Feature<Polygon>} hexagon
 */
function hexagon(center:number[], rx:number, ry:number, properties:any, cosines:number[], sines:number[]): any {
    const vertices = [];
    for (let i = 0; i < 6; i++) {
        const x = round(center[0] + rx * cosines[i],6);
        const y = round(center[1] + ry * sines[i],6);
        vertices.push([x, y]);
    }
    //first and last vertex must be the same
    vertices.push(vertices[0].slice());
    let feature = turf.polygon([vertices], properties);
    feature.properties.centroid = center;
    return feature;
}

function calculateHexGrids(features:any[], cellSize:number, isAddIds:boolean, groupByProperty:string, cellSizeLatitude: number, existingHexFeatures:any[]){
    let gridMap: any={};
    if(existingHexFeatures && Array.isArray(existingHexFeatures)){
        existingHexFeatures.forEach(function (hexFeature){
            gridMap[hexFeature.id] = hexFeature;
        });
    }
    let maxCount = 0;
    //let minCount = Number.MAX_SAFE_INTEGER;
    let groupPropertyCount: any = {};
    const degreesCellSize = (cellSize/1000)/(111.111 * Math.cos(cellSizeLatitude * Math.PI / 180));
    features.forEach(function (feature, i){
      if (feature.geometry.type.toLowerCase() === 'point') {
        if(!(feature.properties != null && feature.properties['@ns:com:here:xyz'] != null 
            && feature.properties['@ns:com:here:xyz'].tags != null && feature.properties['@ns:com:here:xyz'].tags.includes('centroid'))){
        let x = getHexBin(feature, degreesCellSize, false);
        if (x) {
          let gridId = common.md5Sum(JSON.stringify(x.geometry));
          x.id = gridId;
          if (!x.properties) {
            x.properties = {};
            x.properties['count'] = 0;
          }
          let outGrid = x;
          if (gridMap[gridId]) {
            outGrid = gridMap[gridId];
          } else {
            if (isAddIds) {
              outGrid.properties.ids = new Array();
            }
            gridMap[gridId] = outGrid;
            outGrid.properties.count = 0;
          }
          outGrid.properties.count = outGrid.properties.count + 1;
          if(outGrid.properties.count > maxCount){
            maxCount = outGrid.properties.count;
          }
          /* 
          if(outGrid.properties.count < minCount){
            minCount = outGrid.properties.count;
          }*/
          if (isAddIds) {
            outGrid.properties.ids.push(feature.id);
          }

          //GroupBy property logic
          //console.log(groupByProperty);
          if(groupByProperty){
            let propertyValue = feature.properties[groupByProperty];
            //console.log(propertyValue);
            if (groupPropertyCount[propertyValue] == null || groupPropertyCount[propertyValue].maxCount == null) {
                groupPropertyCount[propertyValue] = {};
                groupPropertyCount[propertyValue].maxCount = 0;
            }
            if(outGrid.properties.subcount == null) {
                outGrid.properties.subcount = {};
            }
            if(outGrid.properties.subcount[propertyValue] == null){
                outGrid.properties.subcount[propertyValue] = {};
                outGrid.properties.subcount[propertyValue].count = 0;
            }
            outGrid.properties.subcount[propertyValue].count++;
            if(outGrid.properties.subcount[propertyValue].count > groupPropertyCount[propertyValue].maxCount){
                groupPropertyCount[propertyValue].maxCount = outGrid.properties.subcount[propertyValue].count;
            }
          }
          gridMap[gridId] = outGrid;
        } else {
          console.error("something went wrong and hexgrid is not available for feature - " + feature);
          throw new Error("something went wrong and hexgrid is not available for feature - " + feature);
        }
        }
      }
  });
    let hexFeatures=new Array();
    for(const k in gridMap){
        let feature = gridMap[k];
        //feature.properties.minCount = minCount;
        feature.properties.maxCount = maxCount;
        feature.properties.occupancy = feature.properties.count/maxCount;
        feature.properties.color = "hsla(" + (200 - Math.round(feature.properties.occupancy*100*2))  + ", 100%, 50%,0.51)";
        hexFeatures.push(feature);
        if(groupByProperty){
            for (const key of Object.keys(feature.properties.subcount)) {
                feature.properties.subcount[key].maxCount = groupPropertyCount[key].maxCount;
                feature.properties.subcount[key].occupancy = feature.properties.subcount[key].count/groupPropertyCount[key].maxCount;
                feature.properties.subcount[key].color = "hsla(" + (200 - Math.round(feature.properties.subcount[key].occupancy*100*2))  + ", 100%, 50%,0.51)";
                //console.log(key, JSON.stringify(feature.properties.subcount[key]));
            }
        }
    }
    return hexFeatures;
}

/** 
//let point = [13.4015825,52.473507];
let point = [
    //13.4015825,52.473507
    //0.4015825,0.473507
    //13.401877284049988,
    //      52.473625332625154
    //13.401110172271729,
    //      52.47341620511857
    //13.401729762554169,
    //      52.47346521946711
    0.003519058227539062,
          0.0005149841308648958
];
let feature = {'geometry':{'coordinates':point,'type':'Point'},'properties':{},'type':'Feature'};
//console.log(feature);
let result = getHexBin(feature,100);
//console.log(JSON.stringify(result));
let features = [];
features.push(feature);
features.push(result);
let featureCollection = {'type':'FeatureCollection','features':features};
console.log(JSON.stringify(featureCollection, null, 2));
*/
module.exports.getHexBin = getHexBin;
module.exports.calculateHexGrids = calculateHexGrids;
